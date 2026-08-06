/**
 * TICKET_580_1: Database File Permission Hardening Tests
 *
 * Verifies that DatabaseManager sets owner-only permissions (0o600)
 * on database files and 0o700 on data directories on Unix systems,
 * and skips chmod on Windows.
 *
 * Note: better-sqlite3 native module is mocked to avoid NODE_MODULE_VERSION
 * mismatch in vitest environment (pre-existing issue).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/mock/app',
    isPackaged: false,
  },
}));

const { mockPragma, mockClose, mockBackup, mockDatabase } = vi.hoisted(() => ({
  mockPragma: vi.fn().mockReturnValue('wal'),
  mockClose: vi.fn(),
  mockBackup: vi.fn(),
  mockDatabase: vi.fn(),
}));

function createMockDatabaseHandle() {
  return {
    pragma: mockPragma,
    close: mockClose,
    backup: mockBackup,
    prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), get: vi.fn() }),
    exec: vi.fn(),
    open: true,
  };
}

vi.mock('better-sqlite3', () => {
  return {
    default: mockDatabase,
  };
});

vi.mock('../../utils/logger', () => ({
  dbLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../shared/constants/database', () => ({
  SQLITE_MMAP_SIZE_CAP: 2_000_000_000,
}));

vi.mock('../../shared/constants/formatting', () => ({
  SQL_LOG_TRUNCATE_LENGTH: 200,
}));

import { DatabaseManager, resetDatabaseManager } from '../db-manager';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DatabaseManager - Permission Hardening (TICKET_580_1)', () => {
  let testDbPath: string;
  let tempDir: string;
  const originalPlatform = process.platform;

  beforeEach(() => {
    mockDatabase.mockImplementation(createMockDatabaseHandle);
    mockPragma.mockReturnValue('wal');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'StratCraft-perm-test-'));
    testDbPath = path.join(tempDir, 'test.db');
    resetDatabaseManager();
  });

  afterEach(() => {
    resetDatabaseManager();
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('Unix (Linux/macOS)', () => {
    it('should set 0o600 on database file on Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      fs.writeFileSync(testDbPath, ''); // Mock DB doesn't create real file
      const chmodSpy = vi.spyOn(fs, 'chmodSync');

      new DatabaseManager({ filename: testDbPath });

      expect(chmodSpy).toHaveBeenCalledWith(testDbPath, 0o600);
      chmodSpy.mockRestore();
    });

    it('should set 0o600 on database file on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      fs.writeFileSync(testDbPath, '');
      const chmodSpy = vi.spyOn(fs, 'chmodSync');

      new DatabaseManager({ filename: testDbPath });

      expect(chmodSpy).toHaveBeenCalledWith(testDbPath, 0o600);
      chmodSpy.mockRestore();
    });

    it('should set 0o600 on WAL file if it exists', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      // Pre-create DB + WAL files to simulate better-sqlite3 behavior
      fs.writeFileSync(testDbPath, '');
      const walPath = testDbPath + '-wal';
      fs.writeFileSync(walPath, '');

      const chmodSpy = vi.spyOn(fs, 'chmodSync');

      new DatabaseManager({ filename: testDbPath });

      expect(chmodSpy).toHaveBeenCalledWith(testDbPath, 0o600);
      expect(chmodSpy).toHaveBeenCalledWith(walPath, 0o600);
      chmodSpy.mockRestore();
    });

    it('should set 0o600 on SHM file if it exists', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      // Pre-create DB + SHM files to simulate better-sqlite3 behavior
      fs.writeFileSync(testDbPath, '');
      const shmPath = testDbPath + '-shm';
      fs.writeFileSync(shmPath, '');

      const chmodSpy = vi.spyOn(fs, 'chmodSync');

      new DatabaseManager({ filename: testDbPath });

      expect(chmodSpy).toHaveBeenCalledWith(testDbPath, 0o600);
      expect(chmodSpy).toHaveBeenCalledWith(shmPath, 0o600);
      chmodSpy.mockRestore();
    });

    it('should create new parent directory with mode 0o700', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const nestedDir = path.join(tempDir, 'nested-perm-test');
      const nestedDbPath = path.join(nestedDir, 'test.db');
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync');

      new DatabaseManager({ filename: nestedDbPath });

      expect(mkdirSpy).toHaveBeenCalledWith(
        nestedDir,
        expect.objectContaining({ recursive: true, mode: 0o700 })
      );
      mkdirSpy.mockRestore();
    });

    it('should not throw if chmod fails', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const chmodSpy = vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => {
        new DatabaseManager({ filename: testDbPath });
      }).not.toThrow();

      chmodSpy.mockRestore();
    });
  });

  describe('Windows', () => {
    it('should skip chmod on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const chmodSpy = vi.spyOn(fs, 'chmodSync');

      new DatabaseManager({ filename: testDbPath });

      expect(chmodSpy).not.toHaveBeenCalled();
      chmodSpy.mockRestore();
    });

    it('should create directory without mode on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const nestedDir = path.join(tempDir, 'win-test');
      const nestedDbPath = path.join(nestedDir, 'test.db');
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync');

      new DatabaseManager({ filename: nestedDbPath });

      const call = mkdirSpy.mock.calls.find(c => c[0] === nestedDir);
      expect(call).toBeDefined();
      expect((call![1] as Record<string, unknown>).mode).toBeUndefined();

      mkdirSpy.mockRestore();
    });
  });
});
