/**
 * AuditService - Unit Tests
 *
 * TICKET_546: Tests for strategy audit database operations.
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

import { AuditService, type AuditInsertData } from '../audit-service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockImplementation(() => ({
      run: mockRun,
      get: mockGet,
      all: mockAll,
    }));
    service = new AuditService(mockDb);
  });

  describe('insertAudit', () => {
    it('inserts audit record into strategy_audit for parent_kind=algorithm', () => {
      mockRun.mockReturnValue({ lastInsertRowid: 42 });

      const data: AuditInsertData = {
        parent_kind: 'algorithm',
        algorithm_id: 100,
        signal_source: 'indicator_detector_trend',
        regime: 'trend',
        llm_provider: 'CLAUDE',
        llm_model: 'qwen-plus',
        d1_completeness: 5.0,
        d2_similarity: 4.0,
        d3_indicator_fit: 5.0,
        d4_code_quality: 4.0,
        d5_robustness: 3.0,
        overall_score: 4.35,
        star_rating: 4,
        audit_detail: '{}',
        code_hash: 'abc123',
        ast_fingerprint: 'def456',
      };

      const id = service.insertAudit(data);
      expect(id).toBe(42);
      expect(mockPrepare).toHaveBeenCalledTimes(1);
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO strategy_audit');
      expect(sql).not.toContain('strategy_audit_signal');
      // TICKET_762: parent_kind must NOT be bound -- it is not a column.
      const { parent_kind, ...row } = data;
      expect(mockRun).toHaveBeenCalledWith(row);
    });

    it('TICKET_762: inserts into strategy_audit_signal for parent_kind=signal', () => {
      mockRun.mockReturnValue({ lastInsertRowid: 77 });
      const data: AuditInsertData = {
        parent_kind: 'signal',
        algorithm_id: 200,
        signal_source: 'signal_discovery',
        regime: null,
        llm_provider: 'openai',
        llm_model: 'gpt-5',
        d1_completeness: 4, d2_similarity: 4, d3_indicator_fit: 4,
        d4_code_quality: 4, d5_robustness: 4,
        overall_score: 4, star_rating: 4,
        audit_detail: '{}', code_hash: 'h', ast_fingerprint: 'a',
      };

      const id = service.insertAudit(data);
      expect(id).toBe(77);
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO strategy_audit_signal');
      const { parent_kind, ...row } = data;
      expect(mockRun).toHaveBeenCalledWith(row);
    });

    it('handles bigint lastInsertRowid', () => {
      mockRun.mockReturnValue({ lastInsertRowid: BigInt(99) });
      const data: AuditInsertData = {
        parent_kind: 'algorithm',
        algorithm_id: 1, signal_source: 'exit', regime: null,
        llm_provider: 'CLAUDE', llm_model: 'test',
        d1_completeness: 3, d2_similarity: 3, d3_indicator_fit: 3,
        d4_code_quality: 3, d5_robustness: 3,
        overall_score: 3, star_rating: 3,
        audit_detail: '{}', code_hash: 'a', ast_fingerprint: 'b',
      };
      expect(service.insertAudit(data)).toBe(99);
    });

    it('throws and logs on database error', () => {
      mockRun.mockImplementation(() => { throw new Error('DB write error'); });
      const data: AuditInsertData = {
        parent_kind: 'algorithm',
        algorithm_id: 1, signal_source: 'exit', regime: null,
        llm_provider: 'CLAUDE', llm_model: 'test',
        d1_completeness: 3, d2_similarity: 3, d3_indicator_fit: 3,
        d4_code_quality: 3, d5_robustness: 3,
        overall_score: 3, star_rating: 3,
        audit_detail: '{}', code_hash: 'a', ast_fingerprint: 'b',
      };
      expect(() => service.insertAudit(data)).toThrow('DB write error');
    });
  });

  describe('getByAlgorithmId', () => {
    it('reads from v_strategy_audit_all view (TICKET_762)', () => {
      mockGet.mockReturnValue({ id: 1, algorithm_id: 42, parent_kind: 'signal' });
      service.getByAlgorithmId(42);
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('FROM v_strategy_audit_all');
      expect(sql).not.toMatch(/FROM\s+strategy_audit\b/);
    });

    it('returns record when found', () => {
      const record = { id: 1, algorithm_id: 42, star_rating: 4 };
      mockGet.mockReturnValue(record);
      expect(service.getByAlgorithmId(42)).toBe(record);
    });

    it('returns null when not found', () => {
      mockGet.mockReturnValue(undefined);
      expect(service.getByAlgorithmId(999)).toBeNull();
    });

    it('throws and logs on database error', () => {
      mockGet.mockImplementation(() => { throw new Error('DB read error'); });
      expect(() => service.getByAlgorithmId(1)).toThrow('DB read error');
    });
  });

  describe('listAudits', () => {
    it('reads from v_strategy_audit_all view (TICKET_762)', () => {
      mockAll.mockReturnValue([]);
      service.listAudits();
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('FROM v_strategy_audit_all');
      expect(sql).not.toMatch(/FROM\s+strategy_audit\b/);
    });

    it('returns all records with no filters', () => {
      const records = [{ id: 1 }, { id: 2 }];
      mockAll.mockReturnValue(records);
      expect(service.listAudits()).toBe(records);
    });

    it('applies signal_source filter', () => {
      mockAll.mockReturnValue([]);
      service.listAudits({ signal_source: 'exit' });
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('signal_source = @signal_source');
    });

    it('applies star rating range filter', () => {
      mockAll.mockReturnValue([]);
      service.listAudits({ min_star: 3, max_star: 5 });
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('star_rating >= @min_star');
      expect(sql).toContain('star_rating <= @max_star');
    });

    it('applies llm_provider filter', () => {
      mockAll.mockReturnValue([]);
      service.listAudits({ llm_provider: 'CLAUDE' });
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('llm_provider = @llm_provider');
    });

    it('applies llm_model filter', () => {
      mockAll.mockReturnValue([]);
      service.listAudits({ llm_model: 'qwen-plus' });
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('llm_model = @llm_model');
    });

    it('applies all filters combined', () => {
      mockAll.mockReturnValue([]);
      service.listAudits({
        signal_source: 'exit',
        llm_provider: 'CLAUDE',
        llm_model: 'qwen-plus',
        min_star: 2,
        max_star: 5,
        limit: 50,
      });
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('signal_source = @signal_source');
      expect(sql).toContain('llm_provider = @llm_provider');
      expect(sql).toContain('llm_model = @llm_model');
      expect(sql).toContain('star_rating >= @min_star');
      expect(sql).toContain('star_rating <= @max_star');
      expect(sql).toContain('LIMIT @limit');
      expect(mockAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      );
    });

    it('uses custom limit when provided', () => {
      mockAll.mockReturnValue([]);
      service.listAudits({ limit: 10 });
      expect(mockAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 }),
      );
    });

    it('defaults limit to 100 when not provided', () => {
      mockAll.mockReturnValue([]);
      service.listAudits({});
      expect(mockAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 }),
      );
    });

    it('throws and logs on database error', () => {
      mockAll.mockImplementation(() => { throw new Error('DB list error'); });
      expect(() => service.listAudits()).toThrow('DB list error');
    });
  });

  describe('getExistingHashes', () => {
    it('reads from v_strategy_audit_all view -- D2 dedup spans both pools (TICKET_762)', () => {
      mockAll.mockReturnValue([]);
      service.getExistingHashes('signal_discovery');
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('FROM v_strategy_audit_all');
      expect(sql).not.toMatch(/FROM\s+strategy_audit\b/);
    });

    it('returns hashes with parsed indicators', () => {
      mockAll.mockReturnValue([
        {
          code_hash: 'h1',
          ast_fingerprint: 'fp1',
          audit_detail: JSON.stringify({ indicators_detected: ['EMA', 'RSI'] }),
        },
      ]);
      const result = service.getExistingHashes('indicator_detector_trend');
      expect(result).toHaveLength(1);
      expect(result[0].code_hash).toBe('h1');
      expect(result[0].indicators).toEqual(['EMA', 'RSI']);
    });

    it('handles invalid JSON in audit_detail', () => {
      mockAll.mockReturnValue([
        { code_hash: 'h1', ast_fingerprint: 'fp1', audit_detail: 'invalid-json' },
      ]);
      const result = service.getExistingHashes('exit');
      expect(result[0].indicators).toEqual([]);
    });

    it('handles missing indicators_detected in parsed JSON', () => {
      mockAll.mockReturnValue([
        { code_hash: 'h1', ast_fingerprint: 'fp1', audit_detail: '{}' },
      ]);
      const result = service.getExistingHashes('exit');
      expect(result[0].indicators).toEqual([]);
    });

    it('uses custom limit parameter', () => {
      mockAll.mockReturnValue([]);
      service.getExistingHashes('exit', 50);
      expect(mockAll).toHaveBeenCalledWith('exit', 50);
    });

    it('uses default limit of 200', () => {
      mockAll.mockReturnValue([]);
      service.getExistingHashes('exit');
      expect(mockAll).toHaveBeenCalledWith('exit', 200);
    });

    it('throws and logs on database error', () => {
      mockAll.mockImplementation(() => { throw new Error('DB hash error'); });
      expect(() => service.getExistingHashes('exit')).toThrow('DB hash error');
    });
  });

});
