import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { dbLog } from '../utils/logger';
import { MigrationManager, installElectronMigrationHost } from './migrations/migration-manager';
import { SQLITE_MMAP_SIZE_CAP } from '../../shared/constants/database';
import { SQL_LOG_TRUNCATE_LENGTH } from '../../shared/constants/formatting';
import {
  MIGRATION_LOCK_BUSY_TIMEOUT_MS,
  withDatabaseStartupLock,
} from '@StratCraft/db-migrations';
import { applyPendingDatabaseRestore } from '../services/database-backup-service';

interface DatabaseConfig {
  filename?: string;
  /** Process-specific better-sqlite3 binary (required by headless Node). */
  nativeBinding?: string;
  readonly?: boolean;
  fileMustExist?: boolean;
  verbose?: (message?: unknown) => void;
}

function resolveDefaultNativeBinding(): string | undefined {
  const betterSqlite3Dir = path.dirname(require.resolve('better-sqlite3/package.json'));
  const binaryName = (process as NodeJS.Process & { versions: { electron?: string } }).versions.electron
    ? 'better_sqlite3.electron.node'
    : 'better_sqlite3.system.node';
  const processBinding = path.join(betterSqlite3Dir, binaryName);
  return fs.existsSync(processBinding) ? processBinding : undefined;
}

/**
 * DatabaseManager - SQLite database wrapper using better-sqlite3
 *
 * Features:
 * - Singleton pattern for single instance
 * - Auto-initialization of schema
 * - Transaction support
 * - WAL mode for better concurrency
 * - Type-safe prepared statements
 *
 * See: TICKET_110_DESKTOP_DATABASE_SCHEMA.md
 */
export class DatabaseManager {
  private db: Database.Database;
  private readonly dbPath: string;
  private isInitialized = false;

  constructor(config?: DatabaseConfig) {
    // TICKET_540 + TICKET_541: Support both absolute paths (for tests) and relative filenames
    // STEP 1: Determine database path
    if (config?.filename && path.isAbsolute(config.filename)) {
      // Absolute path (test environment)
      this.dbPath = config.filename;
    } else if (process.env.STRATCRAFT_DB_PATH) {
      // Explicit process-level override shared with the headless runtime.
      // This also gives packaged-public E2E runs a fully isolated database.
      if (!path.isAbsolute(process.env.STRATCRAFT_DB_PATH)) {
        throw new Error('STRATCRAFT_DB_PATH must be an absolute path');
      }
      this.dbPath = process.env.STRATCRAFT_DB_PATH;
    } else {
      // Relative filename (production environment)
      const dataDir = app.isPackaged
        ? path.join(app.getPath('userData'), 'data')
        : path.join(app.getAppPath(), 'data');

      this.dbPath = path.join(dataDir, config?.filename || 'StratCraft.db');
    }

    // STEP 2: Ensure parent directory exists (unified logic for both paths)
    const parentDir = path.dirname(this.dbPath);
    if (!fs.existsSync(parentDir)) {
      // TICKET_580_1: Owner-only directory permissions on Unix (Windows uses ACL)
      const dirMode = process.platform !== 'win32' ? { recursive: true, mode: 0o700 } : { recursive: true };
      fs.mkdirSync(parentDir, dirMode);
      dbLog.info(`[DatabaseManager] Created parent directory: ${parentDir}`);
    }

    dbLog.info(`[DatabaseManager] Initializing database at: ${this.dbPath}`);

    // STEP 3: Initialize database connection
    let restoredBackup: string | null = null;
    this.db = withDatabaseStartupLock(this.dbPath, () => {
      restoredBackup = applyPendingDatabaseRestore(this.dbPath);
      // TICKET_1289_1 AC7: WAL activation itself can take a SQLite lock. Both
      // hosts serialize this connection setup before the shared migration
      // engine takes over with BEGIN IMMEDIATE.
      const db = new Database(this.dbPath, {
        nativeBinding: config?.nativeBinding ?? resolveDefaultNativeBinding(),
        readonly: config?.readonly || false,
        fileMustExist: config?.fileMustExist || false,
        verbose: config?.verbose,
      });
      try {
        db.pragma(`busy_timeout = ${MIGRATION_LOCK_BUSY_TIMEOUT_MS}`);
        db.pragma('foreign_keys = ON');
        db.pragma('journal_mode = WAL');
        return db;
      } catch (error) {
        db.close();
        throw error;
      }
    });
    if (restoredBackup) {
      dbLog.info(`[DatabaseManager] Applied staged database restore: ${restoredBackup}`);
    }

    // Set synchronous to NORMAL for better performance
    this.db.pragma('synchronous = NORMAL');

    // Use memory for temp storage
    this.db.pragma('temp_store = MEMORY');

    // TICKET_1099: mmap_size = min(db_file_size, cap) — avoids stale-page SIGSEGV on long-running processes
    const mmapSize = this.computeMmapSize();
    this.db.pragma(`mmap_size = ${mmapSize}`);
    dbLog.info(`[DatabaseManager] mmap_size = ${(mmapSize / 1e6).toFixed(0)}MB`);

    // TICKET_580_1: Set owner-only file permissions on Unix (Windows ACL handles this)
    this.enforceDbFilePermissions();

    dbLog.info('[DatabaseManager] Database connection established');
    dbLog.info(`[DatabaseManager] Foreign keys: ${this.db.pragma('foreign_keys', { simple: true })}`);
    dbLog.info(`[DatabaseManager] Journal mode: ${this.db.pragma('journal_mode', { simple: true })}`);
  }

  private computeMmapSize(): number {
    try {
      const stat = fs.statSync(this.dbPath);
      return Math.min(stat.size, SQLITE_MMAP_SIZE_CAP);
    } catch {
      return 0;
    }
  }

  /**
   * TICKET_1099: Truncate the WAL file back to zero. Call between sweep batches
   * to prevent mmap stale-page faults during sustained multi-hour writes.
   */
  walCheckpoint(): void {
    const result = this.db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number; log: number; checkpointed: number }>;
    const row = result[0];
    dbLog.info(
      `[DatabaseManager] WAL checkpoint(TRUNCATE): busy=${row.busy} log=${row.log} checkpointed=${row.checkpointed}`,
    );
  }

  /**
   * TICKET_580_1: Enforce owner-only (0o600) permissions on database files.
   * Covers main DB, WAL journal, and SHM shared-memory files.
   * No-op on Windows where %APPDATA% ACL provides per-user isolation.
   */
  private enforceDbFilePermissions(): void {
    if (process.platform === 'win32') return;
    try {
      fs.chmodSync(this.dbPath, 0o600);
      const walPath = this.dbPath + '-wal';
      const shmPath = this.dbPath + '-shm';
      if (fs.existsSync(walPath)) fs.chmodSync(walPath, 0o600);
      if (fs.existsSync(shmPath)) fs.chmodSync(shmPath, 0o600);
      dbLog.info('[DatabaseManager] File permissions set to 600 (owner-only)');
    } catch (err) {
      dbLog.warn(`[DatabaseManager] Could not set file permissions: ${err}`);
    }
  }

  /**
   * Initialize database schema from schema.sql file
   *
   * This method:
   * 1. Reads the schema.sql file
   * 2. Splits it into individual statements
   * 3. Executes each statement in a transaction
   * 4. Marks database as initialized
   *
   * Safe to call multiple times (idempotent due to IF NOT EXISTS clauses)
   */
  /**
   * Embedded schema - avoids file path issues after webpack bundling
   */
  private static readonly EMBEDDED_SCHEMA = `
-- StratCraft Desktop Framework Schema - INFRASTRUCTURE ONLY
-- SQLite 3.38+

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      dbLog.info('[DatabaseManager] Database already initialized, skipping');
      return;
    }

    dbLog.info('[DatabaseManager] Starting schema initialization');

    const schema = DatabaseManager.EMBEDDED_SCHEMA;
    dbLog.info(`[DatabaseManager] Using embedded schema (${schema.length} bytes)`);

    // Split by semicolon, but be careful with triggers/functions
    const statements = this.splitSqlStatements(schema);

    dbLog.info(`[DatabaseManager] Executing ${statements.length} statements`);

    try {
      this.transaction(() => {
        let executedCount = 0;
        for (const statement of statements) {
          if (statement.trim().length > 0) {
            try {
              this.db.exec(statement);
              executedCount++;
            } catch (error) {
              dbLog.error(`[DatabaseManager] Failed to execute statement: ${statement.substring(0, SQL_LOG_TRUNCATE_LENGTH)}...`);
              throw error;
            }
          }
        }
        dbLog.info(`[DatabaseManager] Successfully executed ${executedCount} statements`);
      })();

      // TICKET_1308 7D: install migration host (dynamic commercial imports)
      await installElectronMigrationHost();

      // TICKET_117: Auto-run migrations (UP)
      const migrationManager = new MigrationManager(this);

      // TICKET_580_5: Pre-migration backup when pending migrations exist
      const pendingCount = migrationManager.getPendingCount();
      if (pendingCount > 0) {
        try {
          // Dynamic import to avoid circular dependency at module load time
          const { getDatabaseBackupService } = require('../services/database-backup-service');
          const backupService = getDatabaseBackupService();
          await backupService.createBackup(this, 'pre-migration');
          dbLog.info(`[DatabaseManager] Pre-migration backup created (${pendingCount} pending migrations)`);
        } catch (backupError) {
          dbLog.warn('[DatabaseManager] Pre-migration backup failed (continuing):', backupError);
        }
      }

      await migrationManager.migrate();

      // TICKET_580_6: Auto-purge soft-deleted records older than 30 days
      // Avoid a database-manager module cycle during startup initialization.
      try {
        const { initializeSoftDeleteService } = await import('../services/soft-delete-service');
        const softDeleteService = initializeSoftDeleteService(this);
        const { purgedCounts } = softDeleteService.autoPurge();
        const totalPurged: number = Object.values(purgedCounts).reduce((sum: number, c: unknown) => sum + (c as number), 0) as number;
        if (totalPurged > 0) {
          dbLog.info(`[DatabaseManager] Auto-purged ${totalPurged} expired soft-deleted record(s)`);
        }
      } catch (purgeError) {
        dbLog.warn('[DatabaseManager] Auto-purge failed (non-critical):', purgeError);
      }

      this.isInitialized = true;
      dbLog.info('[DatabaseManager] Schema initialization and migrations completed');

      // Verify tables were created
      const tables = this.getTables();
      dbLog.info(`[DatabaseManager] Database tables: ${tables.join(', ')}`);
    } catch (error) {
      dbLog.error('[DatabaseManager] Schema initialization failed:', error);
      throw error;
    }
  }

  /**
   * Split SQL file into individual statements
   * Handles multi-line statements and comments
   */
  private splitSqlStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inTrigger = false;

    const lines = sql.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (trimmed.length === 0 || trimmed.startsWith('--')) {
        continue;
      }

      // Track if we're inside a trigger definition
      if (trimmed.toUpperCase().startsWith('CREATE TRIGGER')) {
        inTrigger = true;
      }

      current += line + '\n';

      // End of statement detection
      if (trimmed.endsWith(';')) {
        if (inTrigger && trimmed.toUpperCase().includes('END;')) {
          inTrigger = false;
          statements.push(current.trim());
          current = '';
        } else if (!inTrigger) {
          statements.push(current.trim());
          current = '';
        }
      }
    }

    // Add any remaining statement
    if (current.trim().length > 0) {
      statements.push(current.trim());
    }

    return statements;
  }

  /**
   * Get list of tables in database
   */
  getTables(): string[] {
    const stmt = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const tables = stmt.all() as Array<{ name: string }>;
    return tables.map(t => t.name);
  }

  /**
   * Get database schema version
   */
  getSchemaVersion(): number {
    try {
      const stmt = this.db.prepare('SELECT MAX(version) as version FROM schema_version');
      const result = stmt.get() as { version: number | null } | undefined;
      return result?.version || 0;
    } catch {
      // Table doesn't exist yet
      return 0;
    }
  }

  /**
   * Execute a transaction
   *
   * Usage:
   * ```typescript
   * const transaction = db.transaction(() => {
   *   // Multiple database operations
   *   stmt1.run();
   *   stmt2.run();
   *   return result;
   * });
   *
   * const result = transaction();
   * ```
   */
  transaction<T>(fn: () => T): () => T {
    return this.db.transaction(fn);
  }

  /**
   * Execute a transaction in IMMEDIATE mode (`BEGIN IMMEDIATE`).
   *
   * TICKET_1289_1 AC7: the shared migration engine runs the pending batch under
   * an immediate transaction so a concurrent first-start (Electron + standalone
   * MCP racing the same DB) serializes on the RESERVED write lock at BEGIN,
   * rather than both reading version 0 and duplicate-applying. Satisfies the
   * `MigrationDb.transactionImmediate` contract of @StratCraft/db-migrations.
   */
  transactionImmediate<T>(fn: () => T): () => T {
    return this.db.transaction(fn).immediate;
  }

  /**
   * Run a SQLite `PRAGMA`. Exposed so the shared migration engine can set
   * `busy_timeout` before acquiring the migration write lock (AC7). Satisfies
   * the `MigrationDb.pragma` contract.
   */
  pragma(source: string): unknown {
    return this.db.pragma(source);
  }

  /**
   * Prepare a SQL statement
   *
   * Usage:
   * ```typescript
   * const stmt = db.prepare('SELECT * FROM nona_algorithms WHERE user_id = ?');
   * const rows = stmt.all(userId);
   * ```
   */
  prepare<T extends unknown[] = unknown[]>(sql: string): Database.Statement<T> {
    return this.db.prepare(sql);
  }

  /**
   * Execute a SQL statement directly (for DDL operations)
   */
  exec(sql: string): this {
    this.db.exec(sql);
    return this;
  }

  /**
   * Get the underlying better-sqlite3 Database instance
   *
   * Use with caution - prefer using the wrapped methods
   */
  getDb(): Database.Database {
    return this.db;
  }

  /**
   * Get database file path
   */
  getPath(): string {
    return this.dbPath;
  }

  /**
   * Check if database is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * TICKET_580_5: Run SQLite integrity check.
   * Uses PRAGMA quick_check (fast); full integrity_check only on failure.
   */
  checkIntegrity(): { ok: boolean; errors?: string[] } {
    try {
      const result = this.db.pragma('quick_check') as Array<{ quick_check: string }>;
      const ok = result.length === 1 && result[0].quick_check === 'ok';
      if (ok) {
        return { ok: true };
      }
      const errors = result.map(r => r.quick_check);
      return { ok: false, errors };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, errors: [msg] };
    }
  }

  /**
   * Close database connection
   *
   * Should be called on app shutdown
   */
  close(): void {
    if (this.db.open) {
      dbLog.info('[DatabaseManager] Closing database connection');
      this.db.close();
      dbLog.info('[DatabaseManager] Database connection closed');
    }
  }

  /**
   * Backup database to specified path
   */
  async backup(backupPath: string): Promise<void> {
    dbLog.info(`[DatabaseManager] Creating backup at: ${backupPath}`);

    const backupDir = path.dirname(backupPath);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    await this.db.backup(backupPath);
    dbLog.info('[DatabaseManager] Backup completed');
  }

  /**
   * Get database statistics
   */
  getStats(): {
    path: string;
    size: number;
    tables: string[];
    schemaVersion: number;
    walMode: boolean;
  } {
    const stats = fs.statSync(this.dbPath);

    return {
      path: this.dbPath,
      size: stats.size,
      tables: this.getTables(),
      schemaVersion: this.getSchemaVersion(),
      walMode: this.db.pragma('journal_mode', { simple: true }) === 'wal',
    };
  }
}

/**
 * Singleton instance
 */
let dbInstance: DatabaseManager | null = null;

/**
 * Get the singleton DatabaseManager instance
 *
 * Usage:
 * ```typescript
 * import { getDatabaseManager } from './db-manager';
 *
 * const db = getDatabaseManager();
 * await db.initialize();
 * ```
 */
export function getDatabaseManager(config?: DatabaseConfig): DatabaseManager {
  if (!dbInstance) {
    dbInstance = new DatabaseManager(config);
  }
  return dbInstance;
}

/**
 * Reset singleton instance (for testing)
 */
export function resetDatabaseManager(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
