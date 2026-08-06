/**
 * FileService Unit Tests
 *
 * TICKET_424_3H: Tests for file registration, resolution, finding,
 * removal, and orphaned file cleanup.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockExistsSync,
  mockStatSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockCopyFileSync,
  mockUnlinkSync,
  mockReaddirSync,
  mockCalculateChecksum,
  mockCalculateFileChecksum,
  mockValidatePath,
  mockValidateMimeType,
  mockGetSharedDirectory,
  mockGenerateUniqueFileName,
  mockRandomUUID,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockCopyFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockCalculateChecksum: vi.fn(),
  mockCalculateFileChecksum: vi.fn(),
  mockValidatePath: vi.fn(),
  mockValidateMimeType: vi.fn(),
  mockGetSharedDirectory: vi.fn(),
  mockGenerateUniqueFileName: vi.fn(),
  mockRandomUUID: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    statSync: mockStatSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    copyFileSync: mockCopyFileSync,
    unlinkSync: mockUnlinkSync,
    readdirSync: mockReaddirSync,
  },
  existsSync: mockExistsSync,
  statSync: mockStatSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  copyFileSync: mockCopyFileSync,
  unlinkSync: mockUnlinkSync,
  readdirSync: mockReaddirSync,
}));

vi.mock('path', () => ({
  default: {
    join: (...args: string[]) => args.join('/'),
  },
  join: (...args: string[]) => args.join('/'),
}));

vi.mock('crypto', () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock('../../../utils/file-security', () => ({
  calculateChecksum: mockCalculateChecksum,
  calculateFileChecksum: mockCalculateFileChecksum,
  validatePath: mockValidatePath,
  validateMimeType: mockValidateMimeType,
  getSharedDirectory: mockGetSharedDirectory,
  generateUniqueFileName: mockGenerateUniqueFileName,
  BLOB_STORAGE_THRESHOLD: 1024 * 1024,  // 1MB
  MAX_FILE_SIZE: 100 * 1024 * 1024,     // 100MB
}));

vi.mock('../../../utils/logger', () => ({
  dbLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { FileService } from '../file-service';
import type { DatabaseManager } from '../../db-manager';

function createMockDb() {
  const stmtMock = {
    run: vi.fn().mockReturnValue({ lastInsertRowid: 1, changes: 1 }),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  };
  const db = {
    prepare: vi.fn().mockReturnValue(stmtMock),
    transaction: vi.fn((fn: () => any) => fn),
  } as unknown as DatabaseManager;
  return { db, stmtMock };
}

describe('FileService', () => {
  let db: DatabaseManager;
  let stmtMock: ReturnType<typeof createMockDb>['stmtMock'];
  let service: FileService;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db, stmtMock } = createMockDb());
    service = new FileService(db);
    mockRandomUUID.mockReturnValue('test-uuid-1234');
    mockValidateMimeType.mockReturnValue(true);
    mockValidatePath.mockReturnValue(true);
    mockCalculateChecksum.mockReturnValue('sha256-abc');
    mockCalculateFileChecksum.mockReturnValue('sha256-def');
    mockGetSharedDirectory.mockReturnValue('/shared/strategy');
    mockGenerateUniqueFileName.mockReturnValue('unique-file.py');
  });

  // =========================================================================
  // registerFile
  // =========================================================================

  describe('registerFile', () => {
    it('should store small file (<1MB) as BLOB', async () => {
      const content = Buffer.alloc(512); // 512 bytes, below threshold

      const id = await service.registerFile(
        { name: 'test.py', type: 'strategy', content },
        'user1'
      );

      expect(id).toBe('test-uuid-1234');
      expect(mockCalculateChecksum).toHaveBeenCalledWith(content);
      // Verify INSERT was called (via prepare)
      expect(db.prepare).toHaveBeenCalled();
    });

    it('should store large file (>=1MB) as external path', async () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 2 * 1024 * 1024 }); // 2MB

      const id = await service.registerFile(
        { name: 'large.dat', type: 'data', sourcePath: '/tmp/large.dat' },
        'user1'
      );

      expect(id).toBe('test-uuid-1234');
      expect(mockCopyFileSync).toHaveBeenCalledWith('/tmp/large.dat', '/shared/strategy/unique-file.py');
      expect(mockCalculateFileChecksum).toHaveBeenCalled();
    });

    it('should generate checksum for content', async () => {
      const content = Buffer.from('test content');

      await service.registerFile(
        { name: 'test.txt', type: 'config', content },
        'user1'
      );

      expect(mockCalculateChecksum).toHaveBeenCalledWith(content);
    });

    it('should throw on invalid MIME type', async () => {
      mockValidateMimeType.mockReturnValue(false);

      await expect(service.registerFile(
        { name: 'test.py', type: 'strategy', content: Buffer.from('x'), mimeType: 'image/png' },
        'user1'
      )).rejects.toThrow('MIME type');
    });

    it('should throw when neither content nor sourcePath provided', async () => {
      await expect(service.registerFile(
        { name: 'test.py', type: 'strategy' },
        'user1'
      )).rejects.toThrow('Either content or sourcePath must be provided');
    });
  });

  // =========================================================================
  // resolveFile
  // =========================================================================

  describe('resolveFile', () => {
    it('should return buffer for BLOB storage', async () => {
      const content = Buffer.from('file content');
      stmtMock.get.mockReturnValue({
        id: 'f1',
        storage_type: 'blob',
        content,
        external_path: null,
      });

      const result = await service.resolveFile('f1');

      expect(result).toEqual({ type: 'buffer', data: content });
    });

    it('should return path for external storage', async () => {
      mockExistsSync.mockReturnValue(true);
      stmtMock.get.mockReturnValue({
        id: 'f1',
        storage_type: 'external',
        content: null,
        external_path: '/shared/data/file.dat',
      });

      const result = await service.resolveFile('f1');

      expect(result).toEqual({ type: 'path', data: '/shared/data/file.dat' });
    });

    it('should throw on missing file record', async () => {
      stmtMock.get.mockReturnValue(undefined);

      await expect(service.resolveFile('missing')).rejects.toThrow('not found');
    });
  });

  // =========================================================================
  // findFiles
  // =========================================================================

  describe('findFiles', () => {
    it('should filter by type', async () => {
      stmtMock.all.mockReturnValue([
        { id: 'f1', name: 'a.py', type: 'strategy', tags: null },
      ]);

      const results = await service.findFiles({ type: 'strategy' });

      expect(results).toHaveLength(1);
    });

    it('should filter by tags (post-filter)', async () => {
      stmtMock.all.mockReturnValue([
        { id: 'f1', name: 'a.py', tags: '["ml","alpha"]' },
        { id: 'f2', name: 'b.py', tags: '["basic"]' },
      ]);

      const results = await service.findFiles({ tags: ['ml'] });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('f1');
    });

    it('should filter by name_pattern', async () => {
      stmtMock.all.mockReturnValue([
        { id: 'f1', name: 'strategy_alpha.py', tags: null },
        { id: 'f2', name: 'config.json', tags: null },
      ]);

      const results = await service.findFiles({ name_pattern: 'alpha' });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('f1');
    });
  });

  // =========================================================================
  // removeFile
  // =========================================================================

  describe('removeFile', () => {
    it('should delete record and physical file by default', async () => {
      mockExistsSync.mockReturnValue(true);
      stmtMock.get.mockReturnValue({
        id: 'f1',
        storage_type: 'external',
        external_path: '/shared/data/file.dat',
      });

      await service.removeFile('f1');

      expect(mockUnlinkSync).toHaveBeenCalledWith('/shared/data/file.dat');
    });

    it('should delete record only when deletePhysicalFile=false', async () => {
      stmtMock.get.mockReturnValue({
        id: 'f1',
        storage_type: 'external',
        external_path: '/shared/data/file.dat',
      });

      await service.removeFile('f1', false);

      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('should throw when file record not found', async () => {
      stmtMock.get.mockReturnValue(undefined);

      await expect(service.removeFile('missing')).rejects.toThrow('not found');
    });
  });

  // =========================================================================
  // cleanupOrphanedFiles
  // =========================================================================

  describe('cleanupOrphanedFiles', () => {
    it('should remove files without DB records', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['orphan.dat']);
      mockGetSharedDirectory.mockReturnValue('/shared/strategy');

      // First call returns count=0 (orphaned)
      stmtMock.get.mockReturnValue({ count: 0 });

      const count = await service.cleanupOrphanedFiles();

      expect(count).toBeGreaterThan(0);
      expect(mockUnlinkSync).toHaveBeenCalled();
    });
  });
});
