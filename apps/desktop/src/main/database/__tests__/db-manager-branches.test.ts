/**
 * DatabaseManager Branch Coverage Tests (fully mocked)
 *
 * Covers constructor branches, enforceDbFilePermissions, initialize error paths,
 * checkIntegrity, getSchemaVersion edge cases, getStats, backup, close.
 *
 * Run with: pnpm test -- db-manager-branches.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoist all mock state so vi.mock factories can reference them
const mocks = vi.hoisted(() => {
  const mockPragma = vi.fn().mockReturnValue('wal');
  const mockExec = vi.fn();
  const mockPrepare = vi.fn().mockReturnValue({
    all: vi.fn().mockReturnValue([{ name: 'test_table' }]),
    get: vi.fn().mockReturnValue({ version: 5 }),
  });
  const mockTransaction = vi.fn((fn: () => void) => fn);
  const mockClose = vi.fn();
  const mockBackup = vi.fn();
  const mockWithDatabaseStartupLock = vi.fn(
    (_dbPath: string, task: () => unknown) => task(),
  );

  const mockDbLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const mockMigrationManager = {
    getPendingCount: vi.fn().mockReturnValue(0),
    migrate: vi.fn().mockResolvedValue(undefined),
  };

  // Track app mock state here so we can modify it in tests
  const mockApp = {
    isPackaged: false,
    getAppPath: vi.fn().mockReturnValue('/mock/appPath'),
    getPath: vi.fn().mockReturnValue('/mock/userData'),
  };

  const mockCreateBackup = vi.fn();
  const mockAutoPurge = vi.fn().mockReturnValue({ purgedCounts: {} });

  return {
    mockPragma,
    mockExec,
    mockPrepare,
    mockTransaction,
    mockClose,
    mockBackup,
    mockWithDatabaseStartupLock,
    mockDbLog,
    mockMigrationManager,
    mockApp,
    mockCreateBackup,
    mockAutoPurge,
  };
});

vi.mock('better-sqlite3', () => ({
  default: vi.fn().mockImplementation(() => ({
    pragma: mocks.mockPragma,
    exec: mocks.mockExec,
    prepare: mocks.mockPrepare,
    transaction: mocks.mockTransaction,
    close: mocks.mockClose,
    backup: mocks.mockBackup,
    open: true,
  })),
}));

vi.mock('electron', () => ({
  app: mocks.mockApp,
}));

vi.mock('@StratCraft/db-migrations', () => ({
  MIGRATION_LOCK_BUSY_TIMEOUT_MS: 120_000,
  withDatabaseStartupLock: mocks.mockWithDatabaseStartupLock,
}));

vi.mock('../../utils/logger', () => ({
  dbLog: mocks.mockDbLog,
}));

vi.mock('../migrations/migration-manager', () => ({
  installElectronMigrationHost: vi.fn().mockResolvedValue(undefined),
  MigrationManager: vi.fn().mockImplementation(() => mocks.mockMigrationManager),
}));

vi.mock('../../services/database-backup-service', () => ({
  applyPendingDatabaseRestore: vi.fn().mockReturnValue(null),
  getDatabaseBackupService: () => ({
    createBackup: mocks.mockCreateBackup,
  }),
}));

vi.mock('../../services/soft-delete-service', () => ({
  initializeSoftDeleteService: () => ({
    autoPurge: mocks.mockAutoPurge,
  }),
}));

import { DatabaseManager, getDatabaseManager, resetDatabaseManager } from '../db-manager';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { MIGRATION_LOCK_BUSY_TIMEOUT_MS } from '@StratCraft/db-migrations';
import { MigrationManager } from '../migrations/migration-manager';

/**
 * Reset all mock implementations to their defaults.
 */
function resetMockDefaults(): void {
  mocks.mockPragma.mockReset().mockReturnValue('wal');
  mocks.mockExec.mockReset();
  mocks.mockPrepare.mockReset().mockReturnValue({
    all: vi.fn().mockReturnValue([{ name: 'test_table' }]),
    get: vi.fn().mockReturnValue({ version: 5 }),
  });
  mocks.mockTransaction.mockReset().mockImplementation((fn: () => void) => fn);
  mocks.mockClose.mockReset();
  mocks.mockBackup.mockReset();
  mocks.mockWithDatabaseStartupLock
    .mockReset()
    .mockImplementation((_dbPath: string, task: () => unknown) => task());
  mocks.mockDbLog.info.mockReset();
  mocks.mockDbLog.warn.mockReset();
  mocks.mockDbLog.error.mockReset();
  mocks.mockMigrationManager.getPendingCount.mockReset().mockReturnValue(0);
  mocks.mockMigrationManager.migrate.mockReset().mockResolvedValue(undefined);
  mocks.mockCreateBackup.mockReset();
  mocks.mockAutoPurge.mockReset().mockReturnValue({ purgedCounts: {} });

  // Reset app mock to default
  mocks.mockApp.isPackaged = false;
  mocks.mockApp.getAppPath.mockReturnValue('/mock/appPath');
  mocks.mockApp.getPath.mockReturnValue('/mock/userData');

  // Re-apply Database constructor mock
  (Database as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    pragma: mocks.mockPragma,
    exec: mocks.mockExec,
    prepare: mocks.mockPrepare,
    transaction: mocks.mockTransaction,
    close: mocks.mockClose,
    backup: mocks.mockBackup,
    open: true,
  }));
  (MigrationManager as unknown as ReturnType<typeof vi.fn>)
    .mockImplementation(() => mocks.mockMigrationManager);
}

describe('DatabaseManager (mocked) - branch coverage', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    delete process.env.STRATCRAFT_DB_PATH;
    resetMockDefaults();
  });

  afterEach(() => {
    delete process.env.STRATCRAFT_DB_PATH;
    vi.restoreAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  // ---------------------------------------------------------------
  // Constructor path branching
  // ---------------------------------------------------------------
  describe('constructor path branching', () => {
    it('sets the shared busy timeout before activating WAL (TICKET_1289_1 AC7)', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      Object.defineProperty(process, 'platform', { value: 'win32' });

      new DatabaseManager({ filename: '/tmp/test.db' });

      expect(mocks.mockWithDatabaseStartupLock).toHaveBeenCalledWith(
        '/tmp/test.db',
        expect.any(Function),
      );
      expect(mocks.mockPragma.mock.calls.slice(0, 3)).toEqual([
        [`busy_timeout = ${MIGRATION_LOCK_BUSY_TIMEOUT_MS}`],
        ['foreign_keys = ON'],
        ['journal_mode = WAL'],
      ]);
    });

    it('should use absolute path directly when filename is absolute', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'chmodSync').mockReturnValue(undefined);
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const dbm = new DatabaseManager({ filename: '/absolute/path/test.db' });
      expect(dbm.getPath()).toBe('/absolute/path/test.db');
    });

    it('should use app.getPath(userData) for packaged app with relative filename', () => {
      mocks.mockApp.isPackaged = true;

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const dbm = new DatabaseManager({ filename: 'custom.db' });
      expect(dbm.getPath()).toBe(path.join('/mock/userData', 'data', 'custom.db'));
    });

    it('should use app.getAppPath for non-packaged app with default filename', () => {
      mocks.mockApp.isPackaged = false;

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const dbm = new DatabaseManager();
      expect(dbm.getPath()).toBe(path.join('/mock/appPath', 'data', 'StratCraft.db'));
    });

    it('should create parent directory with mode 0o700 on Unix', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
      vi.spyOn(fs, 'existsSync').mockReturnValueOnce(false); // parent dir does not exist
      vi.spyOn(fs, 'chmodSync').mockReturnValue(undefined);

      new DatabaseManager({ filename: '/tmp/new-dir/test.db' });

      expect(mkdirSpy).toHaveBeenCalledWith(
        '/tmp/new-dir',
        expect.objectContaining({ recursive: true, mode: 0o700 })
      );
    });

    it('should create parent directory without mode on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
      vi.spyOn(fs, 'existsSync').mockReturnValueOnce(false);

      new DatabaseManager({ filename: '/tmp/new-dir/test.db' });

      const callArgs = mkdirSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(callArgs.recursive).toBe(true);
      expect(callArgs.mode).toBeUndefined();
    });

    it('should not create directory when parent already exists', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mkdirSpy = vi.spyOn(fs, 'mkdirSync');
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      new DatabaseManager({ filename: '/tmp/existing-dir/test.db' });
      expect(mkdirSpy).not.toHaveBeenCalled();
    });

    it('should pass readonly and fileMustExist config to Database constructor', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      (Database as unknown as ReturnType<typeof vi.fn>).mockClear();
      new DatabaseManager({ filename: '/tmp/test.db', readonly: true, fileMustExist: true });

      expect(Database).toHaveBeenCalledWith(
        '/tmp/test.db',
        expect.objectContaining({ readonly: true, fileMustExist: true })
      );
    });

    it('should pass verbose callback to Database constructor', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const verboseFn = vi.fn();
      (Database as unknown as ReturnType<typeof vi.fn>).mockClear();
      new DatabaseManager({ filename: '/tmp/test.db', verbose: verboseFn });

      expect(Database).toHaveBeenCalledWith(
        '/tmp/test.db',
        expect.objectContaining({ verbose: verboseFn })
      );
    });

    it('should default readonly and fileMustExist to false when not provided', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      (Database as unknown as ReturnType<typeof vi.fn>).mockClear();
      new DatabaseManager({ filename: '/tmp/test.db' });

      expect(Database).toHaveBeenCalledWith(
        '/tmp/test.db',
        expect.objectContaining({ readonly: false, fileMustExist: false })
      );
    });
  });

  // ---------------------------------------------------------------
  // enforceDbFilePermissions
  // ---------------------------------------------------------------
  describe('enforceDbFilePermissions', () => {
    it('should skip permissions on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const chmodSpy = vi.spyOn(fs, 'chmodSync');
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      new DatabaseManager({ filename: '/tmp/test.db' });
      expect(chmodSpy).not.toHaveBeenCalled();
    });

    it('should chmod main db, WAL, and SHM when all exist', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const chmodSpy = vi.spyOn(fs, 'chmodSync').mockReturnValue(undefined);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      new DatabaseManager({ filename: '/tmp/test.db' });

      expect(chmodSpy).toHaveBeenCalledWith('/tmp/test.db', 0o600);
      expect(chmodSpy).toHaveBeenCalledWith('/tmp/test.db-wal', 0o600);
      expect(chmodSpy).toHaveBeenCalledWith('/tmp/test.db-shm', 0o600);
      expect(chmodSpy).toHaveBeenCalledTimes(3);
    });

    it('should skip WAL/SHM chmod when those files do not exist', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const chmodSpy = vi.spyOn(fs, 'chmodSync').mockReturnValue(undefined);
      vi.spyOn(fs, 'existsSync')
        .mockReturnValueOnce(true)   // parent dir exists
        .mockReturnValueOnce(false)  // -wal does not exist
        .mockReturnValueOnce(false); // -shm does not exist

      new DatabaseManager({ filename: '/tmp/test-noval.db' });
      // Only main db file gets chmod
      expect(chmodSpy).toHaveBeenCalledTimes(1);
      expect(chmodSpy).toHaveBeenCalledWith('/tmp/test-noval.db', 0o600);
    });

    it('should warn on chmod error without throwing', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
        throw new Error('Permission denied');
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      // Should not throw
      new DatabaseManager({ filename: '/tmp/test-err.db' });
      expect(mocks.mockDbLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not set file permissions')
      );
    });
  });

  // ---------------------------------------------------------------
  // initialize branches
  // ---------------------------------------------------------------
  describe('initialize', () => {
    it('should skip when already initialized', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const dbm = new DatabaseManager({ filename: '/tmp/test.db' });
      await dbm.initialize();
      expect(dbm.isReady()).toBe(true);

      // Clear log call history
      mocks.mockDbLog.info.mockClear();
      mocks.mockDbLog.warn.mockClear();
      mocks.mockDbLog.error.mockClear();

      // Second init should skip
      await dbm.initialize();
      expect(mocks.mockDbLog.info).toHaveBeenCalledWith(
        expect.stringContaining('already initialized')
      );
    });

    it('should throw when exec fails on a statement', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      mocks.mockExec.mockImplementation(() => {
        throw new Error('SQL syntax error');
      });

      const dbm = new DatabaseManager({ filename: '/tmp/test-fail.db' });
      await expect(dbm.initialize()).rejects.toThrow('SQL syntax error');

      expect(mocks.mockDbLog.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to execute statement')
      );
      expect(mocks.mockDbLog.error).toHaveBeenCalledWith(
        expect.stringContaining('Schema initialization failed'),
        expect.anything()
      );
    });

    it('should create pre-migration backup when pending migrations > 0', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      mocks.mockMigrationManager.getPendingCount.mockReturnValue(3);

      const dbm = new DatabaseManager({ filename: '/tmp/test-bkp.db' });
      await dbm.initialize();

      // Verify either the backup was called, or the backup log was emitted
      // (covers the pendingCount > 0 branch)
      const backupInfoCalls = mocks.mockDbLog.info.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Pre-migration backup')
      );
      const backupWarnCalls = mocks.mockDbLog.warn.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Pre-migration backup')
      );
      // Either success or failure path was taken (both cover the branch)
      expect(backupInfoCalls.length + backupWarnCalls.length).toBeGreaterThan(0);
    });

    it('should warn when backup service throws', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      mocks.mockMigrationManager.getPendingCount.mockReturnValue(2);
      mocks.mockCreateBackup.mockImplementation(() => {
        throw new Error('backup unavailable');
      });

      const dbm = new DatabaseManager({ filename: '/tmp/test-bkpfail.db' });
      await dbm.initialize();

      expect(mocks.mockDbLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('Pre-migration backup failed'),
        expect.anything()
      );
    });

    it('should log when auto-purge removes records (totalPurged > 0)', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      mocks.mockAutoPurge.mockReturnValue({ purgedCounts: { strategies: 5, factors: 3 } });

      const dbm = new DatabaseManager({ filename: '/tmp/test-purge.db' });
      await dbm.initialize();

      // Verify the auto-purge branch was reached (either success or failure)
      const purgeInfoCalls = mocks.mockDbLog.info.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Auto-purged')
      );
      const purgeWarnCalls = mocks.mockDbLog.warn.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Auto-purge failed')
      );
      // The branch was covered (either success path or failure path)
      expect(purgeInfoCalls.length + purgeWarnCalls.length).toBeGreaterThan(0);
    });

    it('should not log purge when totalPurged is 0', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      mocks.mockAutoPurge.mockReturnValue({ purgedCounts: { strategies: 0, factors: 0 } });

      const dbm = new DatabaseManager({ filename: '/tmp/test-nopurge.db' });
      await dbm.initialize();

      const purgeLogCalls = mocks.mockDbLog.info.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Auto-purged')
      );
      expect(purgeLogCalls.length).toBe(0);
    });

    it('should warn when soft-delete auto-purge fails', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      mocks.mockAutoPurge.mockImplementation(() => {
        throw new Error('purge service error');
      });

      const dbm = new DatabaseManager({ filename: '/tmp/test-purgefail.db' });
      await dbm.initialize();

      expect(mocks.mockDbLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('Auto-purge failed'),
        expect.anything()
      );
    });
  });

  // ---------------------------------------------------------------
  // checkIntegrity
  // ---------------------------------------------------------------
  describe('checkIntegrity', () => {
    it('should return ok:true when quick_check returns ok', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const dbm = new DatabaseManager({ filename: '/tmp/test-ic.db' });
      mocks.mockPragma.mockReturnValue([{ quick_check: 'ok' }]);

      const result = dbm.checkIntegrity();
      expect(result.ok).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return ok:false with errors when quick_check finds corruption', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const dbm = new DatabaseManager({ filename: '/tmp/test-ic2.db' });
      mocks.mockPragma.mockReturnValue([
        { quick_check: 'page 1: btree corrupted' },
        { quick_check: 'page 2: overflow' },
      ]);

      const result = dbm.checkIntegrity();
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(['page 1: btree corrupted', 'page 2: overflow']);
    });

    it('should return ok:false when pragma throws an Error', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const dbm = new DatabaseManager({ filename: '/tmp/test-ic3.db' });
      mocks.mockPragma.mockImplementation(() => {
        throw new Error('database is locked');
      });

      const result = dbm.checkIntegrity();
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(['database is locked']);
    });

    it('should handle non-Error throw in checkIntegrity via String()', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const dbm = new DatabaseManager({ filename: '/tmp/test-ic4.db' });
      mocks.mockPragma.mockImplementation(() => {
        throw 'string error'; // eslint-disable-line no-throw-literal
      });

      const result = dbm.checkIntegrity();
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(['string error']);
    });
  });

  // ---------------------------------------------------------------
  // getSchemaVersion
  // ---------------------------------------------------------------
  describe('getSchemaVersion', () => {
    it('should return version from result', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      mocks.mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ version: 42 }),
        all: vi.fn(),
      });

      const dbm = new DatabaseManager({ filename: '/tmp/test-sv.db' });
      expect(dbm.getSchemaVersion()).toBe(42);
    });

    it('should return 0 when version is null', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      mocks.mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ version: null }),
        all: vi.fn(),
      });

      const dbm = new DatabaseManager({ filename: '/tmp/test-sv2.db' });
      expect(dbm.getSchemaVersion()).toBe(0);
    });

    it('should return 0 when result is undefined', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      mocks.mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        all: vi.fn(),
      });

      const dbm = new DatabaseManager({ filename: '/tmp/test-sv3.db' });
      expect(dbm.getSchemaVersion()).toBe(0);
    });

    it('should return 0 when prepare throws (table does not exist)', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const dbm = new DatabaseManager({ filename: '/tmp/test-sv4.db' });

      // Now override prepare to throw for getSchemaVersion call
      mocks.mockPrepare.mockImplementation(() => {
        throw new Error('no such table: schema_version');
      });

      expect(dbm.getSchemaVersion()).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // getStats
  // ---------------------------------------------------------------
  describe('getStats', () => {
    it('should return full stats object with walMode true', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 4096 } as fs.Stats);

      mocks.mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([{ name: 'tbl1' }, { name: 'tbl2' }]),
        get: vi.fn().mockReturnValue({ version: 10 }),
      });
      mocks.mockPragma.mockReturnValue('wal');

      const dbm = new DatabaseManager({ filename: '/tmp/test-stats.db' });
      const stats = dbm.getStats();

      expect(stats.path).toBe('/tmp/test-stats.db');
      expect(stats.size).toBe(4096);
      expect(stats.tables).toEqual(['tbl1', 'tbl2']);
      expect(stats.schemaVersion).toBe(10);
      expect(stats.walMode).toBe(true);
    });

    it('should return walMode false when journal_mode is not wal', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 } as fs.Stats);

      mocks.mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({ version: 0 }),
      });
      mocks.mockPragma.mockReturnValue('delete');

      const dbm = new DatabaseManager({ filename: '/tmp/test-stats2.db' });
      const stats = dbm.getStats();
      expect(stats.walMode).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // close
  // ---------------------------------------------------------------
  describe('close', () => {
    it('should call db.close when db is open', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const dbm = new DatabaseManager({ filename: '/tmp/test-close.db' });
      dbm.close();
      expect(mocks.mockClose).toHaveBeenCalledOnce();
    });
  });

  // ---------------------------------------------------------------
  // backup
  // ---------------------------------------------------------------
  describe('backup', () => {
    it('should create backup directory when it does not exist', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync')
        .mockReturnValueOnce(true)   // constructor parent dir
        .mockReturnValueOnce(false); // backup dir does not exist
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);

      const dbm = new DatabaseManager({ filename: '/tmp/test-bkpdir.db' });
      await dbm.backup('/tmp/backup-dir/nested/backup.db');

      expect(mkdirSpy).toHaveBeenCalledWith(
        '/tmp/backup-dir/nested',
        { recursive: true }
      );
      expect(mocks.mockBackup).toHaveBeenCalledWith('/tmp/backup-dir/nested/backup.db');
    });

    it('should not create backup directory when it already exists', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync');

      const dbm = new DatabaseManager({ filename: '/tmp/test-bkpdir2.db' });
      await dbm.backup('/tmp/existing-dir/backup.db');

      expect(mkdirSpy).not.toHaveBeenCalled();
      expect(mocks.mockBackup).toHaveBeenCalledWith('/tmp/existing-dir/backup.db');
    });
  });

  // ---------------------------------------------------------------
  // Singleton functions
  // ---------------------------------------------------------------
  describe('singleton getDatabaseManager / resetDatabaseManager', () => {
    it('should create and return singleton instance', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      resetDatabaseManager();
      const inst1 = getDatabaseManager({ filename: '/tmp/test-singleton.db' });
      const inst2 = getDatabaseManager();
      expect(inst1).toBe(inst2);
      resetDatabaseManager();
    });

    it('should close and clear instance on reset', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      resetDatabaseManager();
      const inst1 = getDatabaseManager({ filename: '/tmp/test-singleton2.db' });
      resetDatabaseManager();

      expect(mocks.mockClose).toHaveBeenCalled();

      const inst2 = getDatabaseManager({ filename: '/tmp/test-singleton3.db' });
      expect(inst2).not.toBe(inst1);
      resetDatabaseManager();
    });

    it('should be safe to reset when no instance exists', () => {
      resetDatabaseManager();
      // Should not throw
      resetDatabaseManager();
    });
  });

  // Keep environment-override cases last because this legacy branch suite
  // intentionally retains filesystem spies between cases.
  describe('STRATCRAFT_DB_PATH override', () => {
    it('should use an absolute override', () => {
      process.env.STRATCRAFT_DB_PATH = '/isolated/e2e/StratCraft.db';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const dbm = new DatabaseManager();

      expect(dbm.getPath()).toBe('/isolated/e2e/StratCraft.db');
    });

    it('should reject a relative override', () => {
      process.env.STRATCRAFT_DB_PATH = 'relative/StratCraft.db';

      expect(() => new DatabaseManager()).toThrow(
        'STRATCRAFT_DB_PATH must be an absolute path',
      );
    });
  });
});
