/**
 * EntityService Unit Tests
 *
 * TICKET_424_2A: Tests for generic CRUD operations, versioned/non-versioned tables,
 * optimistic locking, transactions, and error propagation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../utils/logger', () => ({
  dbLog: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { EntityService } from '../entity-service';
import type { DatabaseManager } from '../../db-manager';

// Minimal record type for testing
interface TestRecord {
  id: number;
  name: string;
  version?: number;
}

function createMockDb() {
  const runResult: { lastInsertRowid: number | bigint; changes: number } = {
    lastInsertRowid: 1,
    changes: 1,
  };
  const stmtMock = {
    run: vi.fn().mockReturnValue(runResult),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  };
  const db = {
    prepare: vi.fn().mockReturnValue(stmtMock),
    transaction: vi.fn((fn: () => any) => fn),
  } as unknown as DatabaseManager;
  return { db, stmtMock, runResult };
}

describe('EntityService', () => {
  let db: DatabaseManager;
  let stmtMock: ReturnType<typeof createMockDb>['stmtMock'];
  let runResult: ReturnType<typeof createMockDb>['runResult'];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db, stmtMock, runResult } = createMockDb());
  });

  // =========================================================================
  // saveSync
  // =========================================================================

  describe('saveSync', () => {
    it('should set version=1 for versioned table (nona_algorithms)', () => {
      const service = new EntityService<TestRecord>(db, 'nona_algorithms');
      service.saveSync({ name: 'test' });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO nona_algorithms');
      expect(sql).toContain('version');
      const params = stmtMock.run.mock.calls[0][0];
      expect(params.version).toBe(1);
    });

    it('should skip version for non-versioned table', () => {
      const service = new EntityService<TestRecord>(db, 'desktop_backtest_results');
      service.saveSync({ name: 'test' });

      const params = stmtMock.run.mock.calls[0][0];
      expect(params.version).toBeUndefined();
    });

    it('should build correct INSERT SQL and return lastInsertRowid', () => {
      const service = new EntityService<TestRecord>(db, 'some_table');
      runResult.lastInsertRowid = 42;
      const id = service.saveSync({ name: 'hello' });

      expect(id).toBe(42);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO some_table');
      expect(sql).toContain('@name');
    });

    it('should convert bigint lastInsertRowid to number', () => {
      const service = new EntityService<TestRecord>(db, 'some_table');
      runResult.lastInsertRowid = BigInt(99);
      const id = service.saveSync({ name: 'big' });

      expect(id).toBe(99);
      expect(typeof id).toBe('number');
    });

    it('should propagate DB errors', () => {
      stmtMock.run.mockImplementation(() => { throw new Error('DB write error'); });
      const service = new EntityService<TestRecord>(db, 'some_table');
      expect(() => service.saveSync({ name: 'fail' })).toThrow('DB write error');
    });
  });

  // =========================================================================
  // getSync
  // =========================================================================

  describe('getSync', () => {
    it('should return record by ID', () => {
      const record = { id: 1, name: 'found' };
      stmtMock.get.mockReturnValue(record);
      const service = new EntityService<TestRecord>(db, 'some_table');
      const result = service.getSync(1);

      expect(result).toEqual(record);
      expect(stmtMock.get).toHaveBeenCalledWith(1);
    });

    it('should return null when not found', () => {
      stmtMock.get.mockReturnValue(undefined);
      const service = new EntityService<TestRecord>(db, 'some_table');
      expect(service.getSync(999)).toBeNull();
    });

    it('should propagate DB errors', () => {
      stmtMock.get.mockImplementation(() => { throw new Error('DB read error'); });
      const service = new EntityService<TestRecord>(db, 'some_table');
      expect(() => service.getSync(1)).toThrow('DB read error');
    });

    it('should exclude soft-deleted records for nona_algorithms (TICKET_580_6)', () => {
      stmtMock.get.mockReturnValue({ id: 1, name: 'active' });
      const service = new EntityService<TestRecord>(db, 'nona_algorithms');
      service.getSync(1);

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('AND deleted_at IS NULL');
    });

    it('should not add soft-delete filter for non-soft-delete table', () => {
      stmtMock.get.mockReturnValue({ id: 1, name: 'active' });
      const service = new EntityService<TestRecord>(db, 'some_table');
      service.getSync(1);

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).not.toContain('deleted_at');
    });
  });

  // =========================================================================
  // find
  // =========================================================================

  describe('find', () => {
    it('should query all records with no filters', async () => {
      stmtMock.all.mockReturnValue([{ id: 1 }, { id: 2 }]);
      const service = new EntityService<TestRecord>(db, 'some_table');
      const results = await service.find();

      expect(results).toHaveLength(2);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).not.toContain('WHERE');
    });

    it('should apply filters as WHERE clauses', async () => {
      const service = new EntityService<TestRecord>(db, 'some_table');
      await service.find({ name: 'test', version: 1 });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('WHERE');
      expect(sql).toContain('name = @name');
      expect(sql).toContain('version = @version');
    });

    it('should apply orderBy, limit, and offset', async () => {
      const service = new EntityService<TestRecord>(db, 'some_table');
      await service.find({}, { orderBy: 'name ASC', limit: 10, offset: 5 });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('ORDER BY name ASC');
      expect(sql).toContain('LIMIT @limit');
      expect(sql).toContain('OFFSET @offset');
    });

    it('should add deleted_at IS NULL filter for soft-delete table (TICKET_580_6)', async () => {
      const service = new EntityService<TestRecord>(db, 'nona_algorithms');
      await service.find({ name: 'test' });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('WHERE');
      expect(sql).toContain('deleted_at IS NULL');
      expect(sql).toContain('name = @name');
    });

    it('should add deleted_at IS NULL even with no other filters for soft-delete table', async () => {
      const service = new EntityService<TestRecord>(db, 'nona_algorithms');
      await service.find();

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('WHERE deleted_at IS NULL');
    });
  });

  // =========================================================================
  // updateSync
  // =========================================================================

  describe('updateSync', () => {
    it('should build standard UPDATE without version check', () => {
      const service = new EntityService<TestRecord>(db, 'some_table');
      service.updateSync(1, { name: 'updated' });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE some_table SET');
      expect(sql).toContain('name = @name');
      expect(sql).not.toContain('expectedVersion');
    });

    it('should use optimistic locking with expectedVersion', () => {
      const service = new EntityService<TestRecord>(db, 'nona_algorithms');
      service.updateSync(1, { name: 'v2' }, 1);

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('version = version + 1');
      expect(sql).toContain('AND version = @expectedVersion');
    });

    it('should throw CONFLICT when changes=0 with expectedVersion', () => {
      runResult.changes = 0;
      const service = new EntityService<TestRecord>(db, 'some_table');
      expect(() => service.updateSync(1, { name: 'x' }, 1)).toThrow('CONFLICT');
    });

    it('should no-op when empty data', () => {
      const service = new EntityService<TestRecord>(db, 'some_table');
      service.updateSync(1, {});
      expect(db.prepare).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // deleteSync
  // =========================================================================

  describe('deleteSync', () => {
    it('should execute DELETE for non-soft-delete table', () => {
      const service = new EntityService<TestRecord>(db, 'some_table');
      service.deleteSync(5);

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('DELETE FROM some_table WHERE id = ?');
      expect(stmtMock.run).toHaveBeenCalledWith(5);
    });

    it('should soft-delete for nona_algorithms (TICKET_580_6)', () => {
      const service = new EntityService<TestRecord>(db, 'nona_algorithms');
      service.deleteSync(3);

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE nona_algorithms SET deleted_at');
      expect(sql).toContain('WHERE id = ?');
      expect(sql).toContain('AND deleted_at IS NULL');
      expect(sql).not.toContain('DELETE');
      expect(stmtMock.run).toHaveBeenCalledWith(3);
    });

    it('should propagate errors', () => {
      stmtMock.run.mockImplementation(() => { throw new Error('delete error'); });
      const service = new EntityService<TestRecord>(db, 'some_table');
      expect(() => service.deleteSync(1)).toThrow('delete error');
    });
  });

  // =========================================================================
  // hardDeleteSync (TICKET_580_6)
  // =========================================================================

  describe('hardDeleteSync', () => {
    it('should execute hard DELETE even for soft-delete table', () => {
      const service = new EntityService<TestRecord>(db, 'nona_algorithms');
      service.hardDeleteSync(7);

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('DELETE FROM nona_algorithms WHERE id = ?');
      expect(stmtMock.run).toHaveBeenCalledWith(7);
    });

    it('should propagate errors', () => {
      stmtMock.run.mockImplementation(() => { throw new Error('hard delete error'); });
      const service = new EntityService<TestRecord>(db, 'nona_algorithms');
      expect(() => service.hardDeleteSync(1)).toThrow('hard delete error');
    });
  });

  // =========================================================================
  // count
  // =========================================================================

  describe('count', () => {
    it('should count all records with no filters', async () => {
      stmtMock.get.mockReturnValue({ count: 42 });
      const service = new EntityService<TestRecord>(db, 'some_table');
      const result = await service.count();

      expect(result).toBe(42);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('SELECT COUNT(*)');
      expect(sql).not.toContain('WHERE');
    });

    it('should count with filters', async () => {
      stmtMock.get.mockReturnValue({ count: 5 });
      const service = new EntityService<TestRecord>(db, 'some_table');
      const result = await service.count({ name: 'test' });

      expect(result).toBe(5);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('WHERE');
      expect(sql).toContain('name = @name');
    });

    it('should add deleted_at IS NULL for soft-delete table (TICKET_580_6)', async () => {
      stmtMock.get.mockReturnValue({ count: 3 });
      const service = new EntityService<TestRecord>(db, 'nona_algorithms');
      await service.count();

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('WHERE deleted_at IS NULL');
    });
  });

  // =========================================================================
  // transaction
  // =========================================================================

  describe('transaction', () => {
    it('should wrap fn via db.transaction', async () => {
      const service = new EntityService<TestRecord>(db, 'some_table');
      const result = await service.transaction(() => 'txn-result');

      expect(db.transaction).toHaveBeenCalled();
      expect(result).toBe('txn-result');
    });
  });
});
