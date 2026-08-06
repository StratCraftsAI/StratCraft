/**
 * NonaSignalService Unit Tests
 *
 * TICKET_762 Step 2: Confirms NonaSignalService binds inherited AlgorithmService
 * logic to the nona_signal table without any behavioral divergence.
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

vi.mock('../../../utils/algorithm-data-extractor', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual };
});

import { NonaSignalService } from '../nona-signal-service';
import { AlgorithmService, type AlgorithmInsertData } from '../algorithm-service';
import type { DatabaseManager } from '../../db-manager';

function createMockDb() {
  const stmtMock = {
    run: vi.fn().mockReturnValue({ lastInsertRowid: 42, changes: 1 }),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  };
  const db = {
    prepare: vi.fn().mockReturnValue(stmtMock),
    transaction: vi.fn((fn: () => any) => fn),
  } as unknown as DatabaseManager;
  return { db, stmtMock };
}

describe('NonaSignalService', () => {
  let db: DatabaseManager;
  let stmtMock: ReturnType<typeof createMockDb>['stmtMock'];
  let service: NonaSignalService;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db, stmtMock } = createMockDb());
    service = new NonaSignalService(db);
  });

  // =========================================================================
  // Inheritance + table binding
  // =========================================================================

  describe('class shape', () => {
    it('should be an instance of AlgorithmService (inherits all methods)', () => {
      expect(service).toBeInstanceOf(AlgorithmService);
    });

    it('should bind to nona_signal in SELECT (getSync)', () => {
      service.getSync(1);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('FROM nona_signal');
      expect(sql).not.toContain('FROM nona_algorithms');
    });

    it('should apply soft-delete filter (deleted_at IS NULL) on read', () => {
      // TICKET_762: nona_signal must be registered as a SOFT_DELETE_TABLE so
      // inherited reads skip soft-deleted rows.
      service.getSync(1);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('deleted_at IS NULL');
    });

    it('should set version=1 on insert (VERSIONED_TABLES)', async () => {
      stmtMock.get
        .mockReturnValueOnce(undefined)   // existsByName -> false
        .mockReturnValueOnce(undefined);  // findSoftDeletedByName -> no tombstone

      const data: AlgorithmInsertData = {
        code: 'SIG001',
        strategy_name: 'Discovered Signal',
        strategy_type: 1,
        classification_metadata: '{}',
        user_id: 'user-1',
      };

      await service.insertAlgorithm(data);

      // Third prepare = INSERT (1st=existsByName, 2nd=findSoftDeletedByName)
      const insertParams = stmtMock.run.mock.calls[0][0];
      expect(insertParams.version).toBe(1);
    });
  });

  // =========================================================================
  // insertAlgorithm targets nona_signal
  // =========================================================================

  describe('insertAlgorithm', () => {
    it('should INSERT INTO nona_signal and run existsByName against nona_signal', async () => {
      stmtMock.get
        .mockReturnValueOnce(undefined)   // existsByName -> false
        .mockReturnValueOnce(undefined);  // findSoftDeletedByName -> no tombstone

      const data: AlgorithmInsertData = {
        code: 'SIG002',
        strategy_name: 'RSI Divergence',
        strategy_type: 1,
        classification_metadata: '{"signal_source":"signal_discovery"}',
        user_id: 'user-1',
      };

      const result = await service.insertAlgorithm(data);

      expect(result).toEqual({ id: 42, strategy_name: 'RSI Divergence' });
      const calls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0]).toContain('SELECT 1 FROM nona_signal');
      // calls[1] = findSoftDeletedByName, calls[2] = INSERT
      expect(calls[2][0]).toContain('INSERT INTO nona_signal');
      // Critical: must NOT leak into nona_algorithms
      expect(calls[0][0]).not.toContain('nona_algorithms');
      expect(calls[2][0]).not.toContain('nona_algorithms');
    });

    it('persists first-class bar_interval when provided', async () => {
      stmtMock.get
        .mockReturnValueOnce(undefined)   // existsByName -> false
        .mockReturnValueOnce(undefined);  // findSoftDeletedByName -> no tombstone

      await service.insertAlgorithm({
        code: 'SIG907',
        strategy_name: 'Intraday Signal',
        strategy_type: 1,
        classification_metadata: '{"signal_source":"tool_sweep_rsi"}',
        metadata: '{"bar_interval":"1h"}',
        bar_interval: '1h',
        user_id: 'user-1',
      });

      // calls[2] = INSERT (0=existsByName, 1=findSoftDeletedByName)
      const insertSql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[2][0] as string;
      expect(insertSql).toContain('bar_interval');
      const insertParams = stmtMock.run.mock.calls[0][0] as Record<string, unknown>;
      expect(insertParams.bar_interval).toBe('1h');
    });

    it('should auto-rename on collision and INSERT renamed row into nona_signal', async () => {
      stmtMock.get
        .mockReturnValueOnce({ '1': 1 }) // 'Sig' exists in nona_signal
        .mockReturnValueOnce(undefined)   // 'Sig_v2' does not (generateUniqueName)
        .mockReturnValueOnce(undefined);  // findSoftDeletedByName -> no tombstone

      const data: AlgorithmInsertData = {
        code: 'SIG003',
        strategy_name: 'Sig',
        strategy_type: 1,
        classification_metadata: '{}',
        user_id: 'user-1',
      };

      const result = await service.insertAlgorithm(data);

      expect(result.strategy_name).toBe('Sig_v2');
      // calls[3] = INSERT (0=existsByName, 1=generateUniqueName, 2=findSoftDeletedByName)
      const insertSql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[3][0] as string;
      expect(insertSql).toContain('INSERT INTO nona_signal');
    });
  });

  // =========================================================================
  // Inherited query methods target nona_signal
  // =========================================================================

  describe('getAlgorithmsByUserId', () => {
    it('should SELECT FROM nona_signal', async () => {
      await service.getAlgorithmsByUserId('user-1');
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('FROM nona_signal');
      expect(sql).toContain('deleted_at IS NULL');
    });
  });

  describe('getAlgorithmsBySignalSource', () => {
    it('should SELECT FROM nona_signal with signal_source prefix filter', async () => {
      await service.getAlgorithmsBySignalSource('user-1', {
        signalSourcePrefix: 'signal_discovery',
      });
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('FROM nona_signal');
      expect(sql).toContain("json_extract(classification_metadata, '$.signal_source') LIKE @signalSourcePattern");
    });
  });

  describe('getCoverageSummary', () => {
    it('should aggregate FROM nona_signal', () => {
      service.getCoverageSummary('user-1');
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('FROM nona_signal');
      expect(sql).not.toContain('FROM nona_algorithms');
    });
  });

  describe('updateAuditStatus', () => {
    it('should UPDATE nona_signal SET audit_status', async () => {
      await service.updateAuditStatus(1, 'completed');
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE nona_signal');
      expect(sql).toContain('audit_status = @audit_status');
    });
  });

  describe('updateBackendValidationReport', () => {
    it('should UPDATE nona_signal SET backend_validation_report', async () => {
      await service.updateBackendValidationReport(1, '{"score":0.9}');
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE nona_signal');
      expect(sql).toContain('backend_validation_report = @backend_validation_report');
    });
  });

  // =========================================================================
  // Soft-delete behavior
  // =========================================================================

  describe('delete (soft-delete)', () => {
    it('should soft-delete nona_signal rows via UPDATE deleted_at', async () => {
      await service.delete(7);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE nona_signal');
      expect(sql).toContain("deleted_at = datetime('now')");
      // Must NOT fall through to a hard DELETE FROM nona_signal
      expect(sql).not.toContain('DELETE FROM nona_signal');
    });
  });

  // =========================================================================
  // TICKET_783_3: cached_stats_json accessors
  //
  // The column is the *only* nona_signal field whose semantics diverge from
  // nona_algorithms -- it carries the Bayesian prior the Alpha Factory
  // aggregator (TICKET_783_1/3) consumes. NULL / unparseable / shape-invalid
  // payloads degrade to "no prior" (return null) rather than throwing, per
  // the design doc's NULL handling.
  // =========================================================================

  describe('TICKET_783_3 getCachedStats', () => {
    it('returns null when the row does not exist', () => {
      stmtMock.get.mockReturnValue(undefined);

      const result = service.getCachedStats(99);

      expect(result).toBeNull();
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('FROM nona_signal');
      expect(sql).toContain('cached_stats_json');
      expect(sql).toContain('deleted_at IS NULL');
    });

    it('returns null when cached_stats_json column is NULL', () => {
      stmtMock.get.mockReturnValue({ cached_stats_json: null });

      expect(service.getCachedStats(1)).toBeNull();
    });

    it('returns null when cached_stats_json is an empty string', () => {
      stmtMock.get.mockReturnValue({ cached_stats_json: '' });

      expect(service.getCachedStats(1)).toBeNull();
    });

    it('parses and returns a well-formed payload', () => {
      const payload = {
        schema_version: 1,
        lifetime_sharpe: 1.42,
        lifetime_n_trades: 87,
        lifetime_n_bars: 1260,
        last_updated_at: '2026-05-17T12:34:56Z',
        source: 'discovery_round_3',
      };
      stmtMock.get.mockReturnValue({ cached_stats_json: JSON.stringify(payload) });

      expect(service.getCachedStats(1)).toEqual(payload);
    });

    it('returns null on unparseable JSON (corrupted row degrades to no-prior)', () => {
      stmtMock.get.mockReturnValue({ cached_stats_json: '{not-json' });

      expect(service.getCachedStats(1)).toBeNull();
    });

    it('returns null on unsupported schema_version', () => {
      stmtMock.get.mockReturnValue({
        cached_stats_json: JSON.stringify({
          schema_version: 99,
          lifetime_sharpe: 1.0,
          lifetime_n_trades: 10,
          lifetime_n_bars: 100,
          last_updated_at: '2026-05-17T00:00:00Z',
          source: 'discovery_round_3',
        }),
      });

      expect(service.getCachedStats(1)).toBeNull();
    });

    it('returns null on shape-invalid payload (missing fields)', () => {
      stmtMock.get.mockReturnValue({
        cached_stats_json: JSON.stringify({
          schema_version: 1,
          lifetime_sharpe: 'not-a-number',
        }),
      });

      expect(service.getCachedStats(1)).toBeNull();
    });

    it('returns null on shape-invalid payload (wrong source)', () => {
      stmtMock.get.mockReturnValue({
        cached_stats_json: JSON.stringify({
          schema_version: 1,
          lifetime_sharpe: 1.0,
          lifetime_n_trades: 10,
          lifetime_n_bars: 100,
          last_updated_at: '2026-05-17T00:00:00Z',
          source: 'made_up_source',
        }),
      });

      expect(service.getCachedStats(1)).toBeNull();
    });
  });

  describe('TICKET_783_3 setCachedStats', () => {
    it('writes the payload with schema_version=1 and uses UPDATE on nona_signal', () => {
      stmtMock.run.mockReturnValue({ changes: 1, lastInsertRowid: 0 });

      service.setCachedStats(7, {
        lifetime_sharpe: 1.42,
        lifetime_n_trades: 87,
        lifetime_n_bars: 1260,
        last_updated_at: '2026-05-17T12:34:56Z',
        source: 'discovery_round_3',
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE nona_signal');
      expect(sql).toContain('cached_stats_json = ?');
      expect(sql).toContain('deleted_at IS NULL');

      const [json, id] = stmtMock.run.mock.calls[0] as [string, number];
      expect(id).toBe(7);
      const parsed = JSON.parse(json);
      expect(parsed.schema_version).toBe(1);
      expect(parsed.lifetime_sharpe).toBe(1.42);
      expect(parsed.source).toBe('discovery_round_3');
    });

    it('throws when no row matches (signal id missing or soft-deleted)', () => {
      stmtMock.run.mockReturnValue({ changes: 0, lastInsertRowid: 0 });

      expect(() =>
        service.setCachedStats(999, {
          lifetime_sharpe: 1.0,
          lifetime_n_trades: 1,
          lifetime_n_bars: 1,
          last_updated_at: '2026-05-17T00:00:00Z',
          source: 'discovery_round_3',
        }),
      ).toThrow(/no nona_signal row with id=999/);
    });
  });

  describe('TICKET_783_3 clearCachedStats', () => {
    it('sets cached_stats_json to NULL on the matching row', () => {
      service.clearCachedStats(7);

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE nona_signal');
      expect(sql).toContain('cached_stats_json = NULL');
      expect(stmtMock.run).toHaveBeenCalledWith(7);
    });
  });
});
