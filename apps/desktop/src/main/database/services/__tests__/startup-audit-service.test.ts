/**
 * StartupAuditService - Unit Tests
 *
 * TICKET_560_2: Tests for startup audit database operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrepare = vi.fn();
const mockRun = vi.fn();
const mockGet = vi.fn();
const mockAll = vi.fn();

vi.mock('../../../utils/logger', () => ({
  dbLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockDb = {
  prepare: mockPrepare,
} as any;

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { StartupAuditService, type StartupAuditInsertData } from '../startup-audit-service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StartupAuditService', () => {
  let service: StartupAuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockImplementation(() => ({
      run: mockRun,
      get: mockGet,
      all: mockAll,
    }));
    service = new StartupAuditService(mockDb);
  });

  describe('insertAudit', () => {
    it('inserts audit record and returns id', () => {
      mockRun.mockReturnValue({ lastInsertRowid: 1 });

      const data: StartupAuditInsertData = {
        session_id: 'test-session-123',
        status: 'success',
        node_version: '20.11.1',
        electron_version: '28.0.0',
        platform: 'linux',
        startup_duration_ms: 1500,
      };

      const id = service.insertAudit(data);
      expect(id).toBe(1);
      expect(mockPrepare).toHaveBeenCalledTimes(1);
      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: 'test-session-123',
          status: 'success',
          node_version: '20.11.1',
          electron_version: '28.0.0',
          platform: 'linux',
          startup_duration_ms: 1500,
        }),
      );
    });

    it('handles bigint lastInsertRowid', () => {
      mockRun.mockReturnValue({ lastInsertRowid: BigInt(42) });

      const data: StartupAuditInsertData = {
        session_id: 'test-bigint',
        status: 'success',
      };

      expect(service.insertAudit(data)).toBe(42);
    });

    it('defaults optional fields to null or 0', () => {
      mockRun.mockReturnValue({ lastInsertRowid: 1 });

      const data: StartupAuditInsertData = {
        session_id: 'minimal',
        status: 'success',
      };

      service.insertAudit(data);
      const params = mockRun.mock.calls[0][0];
      expect(params.migration_561_status).toBeNull();
      expect(params.migration_561_dirs_copied).toBe(0);
      expect(params.migration_561_files_copied).toBe(0);
      expect(params.migration_561_files_skipped).toBe(0);
      expect(params.migration_561_error).toBeNull();
      expect(params.db_schema_version).toBeNull();
      expect(params.db_migrations_applied).toBe(0);
      expect(params.db_integrity_ok).toBe(1);
      expect(params.db_recovery_attempted).toBe(0);
      expect(params.plugins_discovered).toBe(0);
      expect(params.plugins_loaded).toBe(0);
      expect(params.plugins_failed).toBeNull();
      expect(params.python_path).toBeNull();
      expect(params.executor_available).toBe(0);
      expect(params.node_version).toBeNull();
      expect(params.electron_version).toBeNull();
      expect(params.platform).toBeNull();
      expect(params.startup_duration_ms).toBeNull();
      expect(params.phase_durations).toBeNull();
      expect(params.warnings).toBeNull();
    });

    it('passes migration-561 fields when provided', () => {
      mockRun.mockReturnValue({ lastInsertRowid: 1 });

      const data: StartupAuditInsertData = {
        session_id: 'migration-test',
        status: 'warning',
        migration_561_status: 'migrated',
        migration_561_dirs_copied: 3,
        migration_561_files_copied: 15,
        migration_561_files_skipped: 2,
      };

      service.insertAudit(data);
      const params = mockRun.mock.calls[0][0];
      expect(params.migration_561_status).toBe('migrated');
      expect(params.migration_561_dirs_copied).toBe(3);
      expect(params.migration_561_files_copied).toBe(15);
      expect(params.migration_561_files_skipped).toBe(2);
    });

    it('throws and logs on database error', () => {
      mockRun.mockImplementation(() => { throw new Error('DB write error'); });

      const data: StartupAuditInsertData = {
        session_id: 'error-test',
        status: 'success',
      };

      expect(() => service.insertAudit(data)).toThrow('DB write error');
    });
  });

  describe('getLatest', () => {
    it('returns record when found', () => {
      const record = { id: 1, session_id: 'abc', status: 'success' };
      mockGet.mockReturnValue(record);
      expect(service.getLatest()).toBe(record);
    });

    it('returns null when no records exist', () => {
      mockGet.mockReturnValue(undefined);
      expect(service.getLatest()).toBeNull();
    });

    it('throws and logs on database error', () => {
      mockGet.mockImplementation(() => { throw new Error('DB read error'); });
      expect(() => service.getLatest()).toThrow('DB read error');
    });

    it('uses stable sort with id DESC tiebreaker', () => {
      mockGet.mockReturnValue({ id: 1 });
      service.getLatest();
      const sql = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('ORDER BY create_time DESC, id DESC');
    });
  });

  describe('list', () => {
    it('returns records with default limit', () => {
      const records = [{ id: 1 }, { id: 2 }];
      mockAll.mockReturnValue(records);

      const result = service.list();
      expect(result).toBe(records);
      expect(mockAll).toHaveBeenCalledWith(20, 0);
    });

    it('uses custom limit when provided', () => {
      mockAll.mockReturnValue([]);
      service.list(5);
      expect(mockAll).toHaveBeenCalledWith(5, 0);
    });

    it('throws and logs on database error', () => {
      mockAll.mockImplementation(() => { throw new Error('DB list error'); });
      expect(() => service.list()).toThrow('DB list error');
    });

    it('uses stable sort with id DESC tiebreaker', () => {
      mockAll.mockReturnValue([]);
      service.list();
      const sql = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('ORDER BY create_time DESC, id DESC');
    });
  });
});
