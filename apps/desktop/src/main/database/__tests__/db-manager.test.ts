/**
 * DatabaseManager Unit Tests (real SQLite)
 *
 * Run with: pnpm test -- db-manager.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager, getDatabaseManager, resetDatabaseManager } from '../db-manager';
import { EMBEDDED_MIGRATIONS_FOR_TEST } from '../migrations/migration-manager';
import fs from 'fs';
import path from 'path';
import os from 'os';

const LATEST_SCHEMA_VERSION = Math.max(
  ...EMBEDDED_MIGRATIONS_FOR_TEST.map(m => m.version),
);

vi.mock('electron', () => ({
  app: {
    getAppPath: () => path.join(__dirname, '..'),
    getPath: () => os.tmpdir(),
    isPackaged: false,
  },
}));

describe('DatabaseManager', () => {
  let db: DatabaseManager;
  let testDbPath: string;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'StratCraft-test-'));
    testDbPath = path.join(tempDir, 'test.db');

    resetDatabaseManager();
    db = new DatabaseManager({ filename: testDbPath });
  });

  afterEach(() => {
    db.close();
    // Use rmSync with retries to handle Windows EBUSY (file handle release delay)
    const tempDir = path.dirname(testDbPath);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Best-effort cleanup; OS will reclaim temp files
    }
    resetDatabaseManager();
  });

  describe('Initialization', () => {
    it('should create database file', () => {
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it('should initialize schema', async () => {
      await db.initialize();
      expect(db.isReady()).toBe(true);
    });

    it('should create all tables', async () => {
      await db.initialize();
      const tables = db.getTables();

      expect(tables).toContain('nona_algorithms');
      expect(tables).toContain('nona_factors');
      expect(tables).toContain('alpha_factory_config');
      expect(tables).toContain('saved_strategies');
      expect(tables).toContain('saved_strategy_components');
      expect(tables).toContain('desktop_backtest_results');
      expect(tables).toContain('schema_version');
      expect(tables).toContain('plugin_registry');
    });

    it('should have schema_version table with current version', async () => {
      await db.initialize();
      const version = db.getSchemaVersion();
      expect(version).toBe(LATEST_SCHEMA_VERSION);
    });

    it('should skip initialization when already initialized', async () => {
      await db.initialize();
      expect(db.isReady()).toBe(true);
      // Second call should be a no-op (covers isInitialized branch)
      await db.initialize();
      expect(db.isReady()).toBe(true);
    });
  });

  describe('Prepared Statements', () => {
    it('should execute prepared statements', async () => {
      await db.initialize();

      const stmt = db.prepare('SELECT name FROM sqlite_master WHERE type=?');
      const result = stmt.all('table') as Array<{ name: string }>;
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Transactions', () => {
    it('should execute transactions atomically', async () => {
      await db.initialize();

      const transaction = db.transaction(() => {
        const insertStmt = db.prepare(`
          INSERT INTO nona_algorithms (code, strategy_name, user_id)
          VALUES (?, ?, ?)
        `);
        insertStmt.run('test code 1', 'Test Strategy 1', 'user1');
        insertStmt.run('test code 2', 'Test Strategy 2', 'user1');
      });

      transaction();

      const stmt = db.prepare('SELECT COUNT(*) as count FROM nona_algorithms');
      const result = stmt.get() as { count: number };
      expect(result.count).toBe(2);
    });

    it('should rollback on transaction failure', async () => {
      await db.initialize();

      const transaction = db.transaction(() => {
        const insertStmt = db.prepare(`
          INSERT INTO nona_algorithms (code, strategy_name, user_id)
          VALUES (?, ?, ?)
        `);
        insertStmt.run('test code', 'Test Strategy', 'user1');
        throw new Error('Test error');
      });

      expect(() => transaction()).toThrow('Test error');

      const stmt = db.prepare('SELECT COUNT(*) as count FROM nona_algorithms');
      const result = stmt.get() as { count: number };
      expect(result.count).toBe(0);
    });
  });

  describe('Schema Version', () => {
    it('should track schema version', async () => {
      await db.initialize();
      const version = db.getSchemaVersion();
      expect(version).toBe(LATEST_SCHEMA_VERSION);
    });

    it('should return 0 when schema_version table does not exist', () => {
      // Before initialize, schema_version table does not exist
      // This covers the catch branch in getSchemaVersion
      const version = db.getSchemaVersion();
      expect(version).toBe(0);
    });
  });

  describe('Database Stats', () => {
    it('should return database statistics', async () => {
      await db.initialize();
      const stats = db.getStats();

      expect(stats.path).toBe(testDbPath);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.tables.length).toBeGreaterThan(0);
      expect(stats.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(stats.walMode).toBe(true);
    });
  });

  describe('Foreign Keys', () => {
    it('should enforce foreign key constraints', async () => {
      await db.initialize();
      const foreignKeysEnabled = db.getDb().pragma('foreign_keys', { simple: true });
      expect(foreignKeysEnabled).toBe(1);
    });
  });

  describe('exec', () => {
    it('should execute SQL and return this for chaining', () => {
      const result = db.exec('CREATE TABLE test_exec_tbl (id INTEGER PRIMARY KEY)');
      expect(result).toBe(db);
    });
  });

  describe('getPath', () => {
    it('should return the database file path', () => {
      expect(db.getPath()).toBe(testDbPath);
    });
  });

  describe('checkIntegrity', () => {
    it('should return ok:true for a healthy database', () => {
      const result = db.checkIntegrity();
      expect(result.ok).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });

  // Note: backup() tests are in db-manager-branches.test.ts (mocked)
  // because better-sqlite3 backup() returns a Promise that conflicts with
  // afterEach db.close() timing in real-DB tests.

  describe('close', () => {
    it('should be safe to call close when db is already closed', () => {
      db.close();
      // Second close should not throw (covers db.open === false branch)
      db.close();
    });
  });

  describe('singleton', () => {
    it('getDatabaseManager should return the same instance on repeated calls', () => {
      resetDatabaseManager();
      const instance1 = getDatabaseManager({ filename: testDbPath });
      const instance2 = getDatabaseManager();
      expect(instance1).toBe(instance2);

      instance1.close();
      resetDatabaseManager();
      db = new DatabaseManager({ filename: testDbPath });
    });

    it('resetDatabaseManager should clear singleton and close db', () => {
      resetDatabaseManager();
      const instance = getDatabaseManager({ filename: testDbPath });
      expect(instance.getDb().open).toBe(true);

      resetDatabaseManager();
      const instance2 = getDatabaseManager({ filename: testDbPath });
      expect(instance2).not.toBe(instance);

      instance2.close();
      resetDatabaseManager();
      db = new DatabaseManager({ filename: testDbPath });
    });

    it('resetDatabaseManager should be safe when no instance exists', () => {
      resetDatabaseManager();
      // Should not throw when called with no existing instance
      resetDatabaseManager();
      db = new DatabaseManager({ filename: testDbPath });
    });
  });

  describe('constructor directory creation', () => {
    it('should create parent directory when it does not exist', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'StratCraft-newdir-'));
      const nestedPath = path.join(tempDir, 'subdir', 'deep', 'test.db');

      const dbm = new DatabaseManager({ filename: nestedPath });
      expect(fs.existsSync(path.dirname(nestedPath))).toBe(true);

      dbm.close();
      fs.rmSync(tempDir, { recursive: true });
    });
  });
});
