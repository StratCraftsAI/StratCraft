/**
 * AlgorithmService Unit Tests
 *
 * TICKET_424_2B: Tests for algorithm-specific methods that delegate to EntityService
 * and custom query logic (signal source filtering).
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

// TICKET_709: Allow the real generateUniqueName to run (it calls existsByName on the service)
vi.mock('../../../utils/algorithm-data-extractor', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual };
});

import { AlgorithmService, type AlgorithmInsertData } from '../algorithm-service';
import type { DatabaseManager } from '../../db-manager';

function createMockDb() {
  const stmtMock = {
    run: vi.fn().mockReturnValue({ lastInsertRowid: 10, changes: 1 }),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  };
  const db = {
    prepare: vi.fn().mockReturnValue(stmtMock),
    transaction: vi.fn((fn: () => any) => fn),
  } as unknown as DatabaseManager;
  return { db, stmtMock };
}

describe('AlgorithmService', () => {
  let db: DatabaseManager;
  let stmtMock: ReturnType<typeof createMockDb>['stmtMock'];
  let service: AlgorithmService;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db, stmtMock } = createMockDb());
    service = new AlgorithmService(db);
  });

  // =========================================================================
  // Constructor
  // =========================================================================

  describe('constructor', () => {
    it('should set tableName to nona_algorithms', () => {
      // Verify by calling a method that uses tableName
      service.getSync(1);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('nona_algorithms');
    });
  });

  // =========================================================================
  // insertAlgorithm
  // =========================================================================

  describe('insertAlgorithm', () => {
    it('should return { id, strategy_name } when no collision', async () => {
      // existsByName returns no match, findSoftDeletedByName returns no match
      stmtMock.get
        .mockReturnValueOnce(undefined)   // existsByName: no active row
        .mockReturnValueOnce(undefined);  // findSoftDeletedByName: no tombstone

      const data: AlgorithmInsertData = {
        code: 'ALGO001',
        strategy_name: 'Test Strategy',
        strategy_type: 1,
        classification_metadata: '{}',
        user_id: 'user-1',
      };

      const result = await service.insertAlgorithm(data);

      expect(result).toEqual({ id: 10, strategy_name: 'Test Strategy' });
      // First prepare = existsByName SELECT, second = findSoftDeletedByName, third = INSERT
      const calls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0]).toContain('SELECT 1 FROM nona_algorithms');
      expect(calls[2][0]).toContain('INSERT INTO nona_algorithms');
    });

    it('should auto-rename with _v2 suffix on single collision', async () => {
      // First existsByName('My Strat', ...) -> exists
      // Second existsByName('My Strat_v2', ...) -> does not exist (generateUniqueName)
      // Third findSoftDeletedByName('My Strat_v2', ...) -> no tombstone
      stmtMock.get
        .mockReturnValueOnce({ '1': 1 })  // existsByName('My Strat') -> true
        .mockReturnValueOnce(undefined)    // existsByName('My Strat_v2') -> false
        .mockReturnValueOnce(undefined);   // findSoftDeletedByName -> no tombstone

      const data: AlgorithmInsertData = {
        code: 'ALGO002',
        strategy_name: 'My Strat',
        strategy_type: 1,
        classification_metadata: '{}',
        user_id: 'user-1',
      };

      const result = await service.insertAlgorithm(data);

      expect(result).toEqual({ id: 10, strategy_name: 'My Strat_v2' });
      expect(data.strategy_name).toBe('My Strat_v2');
    });

    it('should auto-rename with _v3 suffix on multiple collisions', async () => {
      // existsByName('Dup') -> true
      // existsByName('Dup_v2') -> true (via generateUniqueName loop)
      // existsByName('Dup_v3') -> false
      // findSoftDeletedByName('Dup_v3') -> no tombstone
      stmtMock.get
        .mockReturnValueOnce({ '1': 1 })  // 'Dup' exists
        .mockReturnValueOnce({ '1': 1 })  // 'Dup_v2' exists
        .mockReturnValueOnce(undefined)    // 'Dup_v3' does not exist
        .mockReturnValueOnce(undefined);   // findSoftDeletedByName -> no tombstone

      const data: AlgorithmInsertData = {
        code: 'ALGO003',
        strategy_name: 'Dup',
        strategy_type: 1,
        classification_metadata: '{}',
        user_id: 'user-1',
      };

      const result = await service.insertAlgorithm(data);

      expect(result).toEqual({ id: 10, strategy_name: 'Dup_v3' });
    });

    it('should undelete soft-deleted row instead of inserting duplicate', async () => {
      // existsByName -> false (deleted_at IS NULL finds nothing)
      // findSoftDeletedByName -> found tombstone with id=42
      stmtMock.get
        .mockReturnValueOnce(undefined)   // existsByName: no active row
        .mockReturnValueOnce({ id: 42 }); // findSoftDeletedByName: tombstone found

      const data: AlgorithmInsertData = {
        code: 'ALGO_UNDELETE',
        strategy_name: 'Deleted Strat',
        strategy_type: 1,
        classification_metadata: '{}',
        user_id: 'user-1',
      };

      const result = await service.insertAlgorithm(data);

      expect(result).toEqual({ id: 42, strategy_name: 'Deleted Strat' });
      // First prepare: existsByName SELECT
      // Second prepare: findSoftDeletedByName SELECT
      // Third prepare: UPDATE (undelete)
      const calls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0]).toContain('deleted_at IS NULL');
      expect(calls[1][0]).toContain('deleted_at IS NOT NULL');
      expect(calls[2][0]).toContain('UPDATE');
    });

    it('should insert new row when no active and no soft-deleted row exists', async () => {
      stmtMock.get
        .mockReturnValueOnce(undefined)   // existsByName: no active row
        .mockReturnValueOnce(undefined);  // findSoftDeletedByName: no tombstone

      const data: AlgorithmInsertData = {
        code: 'ALGO_FRESH',
        strategy_name: 'Fresh Strat',
        strategy_type: 1,
        classification_metadata: '{}',
        user_id: 'user-1',
      };

      const result = await service.insertAlgorithm(data);

      expect(result).toEqual({ id: 10, strategy_name: 'Fresh Strat' });
      const calls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[2][0]).toContain('INSERT INTO');
    });

    it('should re-throw errors from save()', async () => {
      stmtMock.get
        .mockReturnValueOnce(undefined)   // existsByName -> false
        .mockReturnValueOnce(undefined);  // findSoftDeletedByName -> no tombstone
      stmtMock.run.mockImplementation(() => {
        throw new Error('SQLITE_ERROR: table nona_algorithms has no column named bad_col');
      });

      const data: AlgorithmInsertData = {
        code: 'ALGO004',
        strategy_name: 'Some Strategy',
        strategy_type: 1,
        classification_metadata: '{}',
        user_id: 'user-1',
      };

      await expect(service.insertAlgorithm(data)).rejects.toThrow(
        'SQLITE_ERROR: table nona_algorithms has no column named bad_col'
      );
    });

    it('should re-throw non-Error thrown values', async () => {
      stmtMock.get
        .mockReturnValueOnce(undefined)   // existsByName -> false
        .mockReturnValueOnce(undefined);  // findSoftDeletedByName -> no tombstone
      stmtMock.run.mockImplementation(() => {
        throw 'raw string error';
      });

      const data: AlgorithmInsertData = {
        code: 'ALGO005',
        strategy_name: 'Another Strategy',
        strategy_type: 1,
        classification_metadata: '{}',
        user_id: 'user-1',
      };

      await expect(service.insertAlgorithm(data)).rejects.toBe('raw string error');
    });

    it('should include all optional fields in insert', async () => {
      stmtMock.get
        .mockReturnValueOnce(undefined)   // existsByName -> false
        .mockReturnValueOnce(undefined);  // findSoftDeletedByName -> no tombstone

      const data: AlgorithmInsertData = {
        code: 'ALGO006',
        strategy_name: 'Full Strategy',
        strategy_type: 2,
        classification_metadata: '{"signal_source":"indicator_rsi"}',
        strategy_rules: '{"rules":[]}',
        description: 'A test strategy',
        file_path: '/path/to/file.py',
        prompt_template: 'Generate a strategy',
        user_id: 'user-2',
        category: 'momentum',
        metadata: '{"key":"value"}',
        record_type: 'algorithm',
        is_system: 0,
        activate: 1,
        status: 1,
        pnl: '100.50',
        sync_status: 'synced',
        local_only: 0,
        version: 1,
      };

      const result = await service.insertAlgorithm(data);
      expect(result.id).toBe(10);
      expect(result.strategy_name).toBe('Full Strategy');

      // Third prepare call is INSERT (1st=existsByName, 2nd=findSoftDeletedByName)
      const insertSql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[2][0] as string;
      expect(insertSql).toContain('INSERT INTO nona_algorithms');
      expect(insertSql).toContain('strategy_rules');
      expect(insertSql).toContain('description');
      expect(insertSql).toContain('file_path');
      expect(insertSql).toContain('prompt_template');
      expect(insertSql).toContain('category');
      expect(insertSql).toContain('metadata');
    });
  });

  // =========================================================================
  // getAlgorithmById
  // =========================================================================

  describe('getAlgorithmById', () => {
    it('should delegate to get() and return record', async () => {
      const record = { id: 5, code: 'A1', strategy_name: 'S1' };
      stmtMock.get.mockReturnValue(record);

      const result = await service.getAlgorithmById(5);
      expect(result).toEqual(record);
    });

    it('should return null when not found', async () => {
      stmtMock.get.mockReturnValue(undefined);
      const result = await service.getAlgorithmById(999);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // updateAlgorithm
  // =========================================================================

  describe('updateAlgorithm', () => {
    it('should delegate to update()', async () => {
      await service.updateAlgorithm(1, { strategy_name: 'Updated' });
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE nona_algorithms');
    });

    it('should update multiple fields at once', async () => {
      await service.updateAlgorithm(5, {
        strategy_name: 'Renamed',
        description: 'New description',
        status: 2,
        pnl: '250.00',
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE nona_algorithms');
      expect(sql).toContain('strategy_name = @strategy_name');
      expect(sql).toContain('description = @description');
      expect(sql).toContain('status = @status');
      expect(sql).toContain('pnl = @pnl');
      expect(sql).toContain('WHERE id = @id');
    });

    it('should pass correct params to statement run', async () => {
      await service.updateAlgorithm(7, { code: 'NEW_CODE' });

      const params = stmtMock.run.mock.calls[0][0];
      expect(params.code).toBe('NEW_CODE');
      expect(params.id).toBe(7);
    });

    it('should forward expectedVersion to optimistic locking', async () => {
      await service.updateAlgorithm(7, { code: 'NEW_CODE' }, 3);

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const params = stmtMock.run.mock.calls[0][0];
      expect(sql).toContain('AND version = @expectedVersion');
      expect(params.expectedVersion).toBe(3);
    });

    it('should be a no-op when data is empty', async () => {
      await service.updateAlgorithm(1, {});
      // updateSync returns early when keys.length === 0, so prepare is never called
      expect(db.prepare).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getAlgorithmsByUserId
  // =========================================================================

  describe('getAlgorithmsByUserId', () => {
    it('should query machine-scoped algorithms without user_id filter', async () => {
      stmtMock.all.mockReturnValue([{ id: 1 }, { id: 2 }]);
      const results = await service.getAlgorithmsByUserId('user-1');

      expect(results).toHaveLength(2);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).not.toContain('user_id = @user_id');
      expect(sql).toContain('deleted_at IS NULL');
    });

    it('should add strategy_type filter when provided', async () => {
      await service.getAlgorithmsByUserId('user-1', { strategy_type: 2 });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('strategy_type = @strategy_type');
    });

    it('should apply limit and offset', async () => {
      await service.getAlgorithmsByUserId('user-1', { limit: 10, offset: 5 });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('LIMIT @limit');
      expect(sql).toContain('OFFSET @offset');
      expect(sql).toContain('ORDER BY create_time DESC');
    });
  });

  // =========================================================================
  // getAlgorithmsBySignalSource
  // =========================================================================

  describe('getAlgorithmsBySignalSource', () => {
    it('should build SQL with json_extract LIKE pattern', async () => {
      await service.getAlgorithmsBySignalSource('user-1', {
        signalSourcePrefix: 'indicator_',
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain("json_extract(classification_metadata, '$.signal_source') LIKE @signalSourcePattern");
      expect(sql).not.toContain('user_id = @userId');
      const params = stmtMock.all.mock.calls[0][0];
      expect(params.signalSourcePattern).toBe('indicator_%');
      expect(params.userId).toBeUndefined();
    });

    it('should add optional strategy_type filter', async () => {
      await service.getAlgorithmsBySignalSource('user-1', {
        signalSourcePrefix: 'detector_',
        strategy_type: 3,
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('strategy_type = @strategy_type');
      const params = stmtMock.all.mock.calls[0][0];
      expect(params.strategy_type).toBe(3);
    });

    it('should apply limit and offset', async () => {
      await service.getAlgorithmsBySignalSource('user-1', {
        signalSourcePrefix: 'x_',
        limit: 20,
        offset: 10,
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('LIMIT @limit');
      expect(sql).toContain('OFFSET @offset');
    });

    it('should not include strategy_type when undefined', async () => {
      await service.getAlgorithmsBySignalSource('user-1', {
        signalSourcePrefix: 'momentum_',
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).not.toContain('strategy_type');
      expect(sql).toContain('ORDER BY create_time DESC');
    });

    it('should not include LIMIT when limit is 0 or undefined', async () => {
      await service.getAlgorithmsBySignalSource('user-1', {
        signalSourcePrefix: 'trend_',
        limit: 0,
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).not.toContain('LIMIT');
    });

    it('should not include OFFSET when offset is 0 or undefined', async () => {
      await service.getAlgorithmsBySignalSource('user-1', {
        signalSourcePrefix: 'trend_',
        offset: 0,
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).not.toContain('OFFSET');
    });

    it('should apply limit without offset', async () => {
      await service.getAlgorithmsBySignalSource('user-1', {
        signalSourcePrefix: 'alpha_',
        limit: 50,
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('LIMIT @limit');
      expect(sql).not.toContain('OFFSET');
      const params = stmtMock.all.mock.calls[0][0];
      expect(params.limit).toBe(50);
    });

    it('should apply offset without limit', async () => {
      await service.getAlgorithmsBySignalSource('user-1', {
        signalSourcePrefix: 'beta_',
        offset: 5,
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).not.toContain('LIMIT');
      expect(sql).toContain('OFFSET @offset');
      const params = stmtMock.all.mock.calls[0][0];
      expect(params.offset).toBe(5);
    });

    it('should combine all filters: strategy_type + limit + offset', async () => {
      const mockRecords = [{ id: 1 }, { id: 2 }];
      stmtMock.all.mockReturnValue(mockRecords);

      const result = await service.getAlgorithmsBySignalSource('user-1', {
        signalSourcePrefix: 'detector_',
        strategy_type: 5,
        limit: 10,
        offset: 20,
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).not.toContain('user_id = @userId');
      expect(sql).toContain('deleted_at IS NULL');
      expect(sql).toContain("json_extract(classification_metadata, '$.signal_source') LIKE @signalSourcePattern");
      expect(sql).toContain('strategy_type = @strategy_type');
      expect(sql).toContain('ORDER BY create_time DESC');
      expect(sql).toContain('LIMIT @limit');
      expect(sql).toContain('OFFSET @offset');

      const params = stmtMock.all.mock.calls[0][0];
      expect(params.userId).toBeUndefined();
      expect(params.signalSourcePattern).toBe('detector_%');
      expect(params.strategy_type).toBe(5);
      expect(params.limit).toBe(10);
      expect(params.offset).toBe(20);

      expect(result).toEqual(mockRecords);
    });

    it('should return results from stmt.all()', async () => {
      const mockData = [
        { id: 10, strategy_name: 'Strat A' },
        { id: 11, strategy_name: 'Strat B' },
      ];
      stmtMock.all.mockReturnValue(mockData);

      const result = await service.getAlgorithmsBySignalSource('user-1', {
        signalSourcePrefix: 'indicator_',
      });

      expect(result).toEqual(mockData);
      expect(result).toHaveLength(2);
    });
  });

  // =========================================================================
  // existsByName
  // =========================================================================

  describe('existsByName', () => {
    it('should return true when a matching record exists', async () => {
      stmtMock.get.mockReturnValue({ '1': 1 });

      const result = await service.existsByName('My Strategy', 'user-1');

      expect(result).toBe(true);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('strategy_name = @strategyName');
      expect(sql).toContain('user_id = @userId');
      expect(sql).toContain('deleted_at IS NULL');
      expect(sql).toContain('LIMIT 1');
      const params = stmtMock.get.mock.calls[0][0];
      expect(params.strategyName).toBe('My Strategy');
      expect(params.userId).toBe('user-1');
    });

    it('should return false when no matching record exists', async () => {
      stmtMock.get.mockReturnValue(undefined);

      const result = await service.existsByName('Nonexistent', 'user-2');

      expect(result).toBe(false);
    });

    it('should return false when get returns null', async () => {
      stmtMock.get.mockReturnValue(null);

      const result = await service.existsByName('Null Strategy', 'user-3');

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // getCoverageSummary
  // =========================================================================

  describe('getCoverageSummary', () => {
    it('should query grouped coverage summary for all local algorithms', () => {
      const mockSummary: import('../algorithm-service').CoverageSummaryRow[] = [
        { regime: 'bull', signal_source: 'indicator_rsi', indicator_combo: 'rsi+macd', variant_count: 5 },
        { regime: 'bear', signal_source: 'detector_volume', indicator_combo: 'volume', variant_count: 3 },
      ];
      stmtMock.all.mockReturnValue(mockSummary);

      const result = service.getCoverageSummary('user-1');

      expect(result).toEqual(mockSummary);
      expect(result).toHaveLength(2);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain("json_extract(classification_metadata, '$.components.indicator.regime_type') AS regime");
      expect(sql).toContain("json_extract(classification_metadata, '$.signal_source') AS signal_source");
      expect(sql).toContain("json_extract(classification_metadata, '$.feature_fingerprint.indicator_combo') AS indicator_combo");
      expect(sql).toContain('COUNT(*) AS variant_count');
      expect(sql).toContain('GROUP BY regime, signal_source, indicator_combo');
      expect(sql).toContain('ORDER BY variant_count DESC');
      expect(sql).not.toContain('user_id = @userId');
      expect(sql).toContain('deleted_at IS NULL');
      expect(stmtMock.all).toHaveBeenCalledWith();
    });

    it('should return empty array when no coverage data exists', () => {
      stmtMock.all.mockReturnValue([]);

      const result = service.getCoverageSummary('user-empty');

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getSubsetDetail
  // =========================================================================

  describe('getSubsetDetail', () => {
    it('should query subset detail with default limit', () => {
      const mockDetail: import('../algorithm-service').SubsetDetailRow[] = [
        { strategy_name: 'RSI Momentum', class_name: 'RsiMomentum', feature_fingerprint: 'fp1', trading_style: 'swing' },
      ];
      stmtMock.all.mockReturnValue(mockDetail);

      const result = service.getSubsetDetail('user-1', 'indicator_rsi', 'bull');

      expect(result).toEqual(mockDetail);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain("json_extract(classification_metadata, '$.class_name') AS class_name");
      expect(sql).toContain("json_extract(classification_metadata, '$.feature_fingerprint') AS feature_fingerprint");
      expect(sql).toContain("json_extract(classification_metadata, '$.trading_style') AS trading_style");
      expect(sql).toContain("json_extract(classification_metadata, '$.signal_source') = @signalSource");
      expect(sql).toContain("json_extract(classification_metadata, '$.components.indicator.regime_type') = @regime");
      expect(sql).not.toContain('user_id = @userId');
      expect(sql).toContain('ORDER BY create_time DESC');
      expect(sql).toContain('LIMIT @limit');

      const params = stmtMock.all.mock.calls[0][0];
      expect(params.signalSource).toBe('indicator_rsi');
      expect(params.regime).toBe('bull');
      expect(params.limit).toBe(30); // default limit
    });

    it('should use custom limit when provided', () => {
      stmtMock.all.mockReturnValue([]);

      service.getSubsetDetail('user-1', 'detector_volume', 'bear', 5);

      const params = stmtMock.all.mock.calls[0][0];
      expect(params.limit).toBe(5);
    });

    it('should return empty array when no matching strategies', () => {
      stmtMock.all.mockReturnValue([]);

      const result = service.getSubsetDetail('user-1', 'nonexistent', 'sideways');

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getAlgorithmsByUserId - additional edge cases
  // =========================================================================

  describe('getAlgorithmsByUserId (additional)', () => {
    it('should not include limit/offset when not provided', async () => {
      await service.getAlgorithmsByUserId('user-1', { strategy_type: 1 });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('strategy_type = @strategy_type');
      expect(sql).toContain('ORDER BY create_time DESC');
      // EntityService.find uses truthy check on limit/offset, so 0 and undefined won't add clauses
      expect(sql).not.toContain('LIMIT');
      expect(sql).not.toContain('OFFSET');
    });

    it('should work without any options', async () => {
      stmtMock.all.mockReturnValue([{ id: 100 }]);

      const result = await service.getAlgorithmsByUserId('user-x');

      expect(result).toEqual([{ id: 100 }]);
    });
  });
});
