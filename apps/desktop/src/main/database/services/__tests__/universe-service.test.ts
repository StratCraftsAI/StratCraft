/**
 * UniverseService - Unit Tests
 *
 * TICKET_880_5_1: CRUD for user_universe + user_universe_symbol.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRun = vi.fn();
const mockGet = vi.fn();
const mockAll = vi.fn();
const mockPrepare = vi.fn();
const mockExec = vi.fn();
const mockTransaction = vi.fn();

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
  exec: mockExec,
  transaction: mockTransaction,
} as any;

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { UniverseService } from '../universe-service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UniverseService', () => {
  let service: UniverseService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockImplementation(() => ({
      run: mockRun,
      get: mockGet,
      all: mockAll,
    }));
    service = new UniverseService(mockDb);
    mockTransaction.mockImplementation((fn: () => unknown) => {
      return () => fn();
    });
  });

  describe('list', () => {
    it('queries universes for provider with symbol count', () => {
      mockAll.mockReturnValue([
        { id: 1, name: 'sp500_top50', provider: 'alpaca', basedOn: 'sp500_top50', updatedAt: 1000, symbolCount: 50, targetSize: null },
      ]);

      const result = service.list('alpaca');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('sp500_top50');
      expect(result[0].symbolCount).toBe(50);
      expect(mockPrepare).toHaveBeenCalledTimes(1);
      const sql = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('WHERE u.provider = ?');
      expect(sql).toContain('COUNT(s.symbol) AS symbolCount');
      expect(mockAll).toHaveBeenCalledWith('alpaca');
    });

    it('returns targetSize from DB column', () => {
      mockAll.mockReturnValue([
        { id: 1, name: 'sp500_top50', provider: 'alpaca', basedOn: 'sp500_top50', updatedAt: 1000, symbolCount: 65, targetSize: 50 },
      ]);

      const result = service.list('alpaca');
      expect(result[0].targetSize).toBe(50);
      const sql = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('u.target_size AS targetSize');
    });
  });

  describe('get', () => {
    it('returns universe with symbols when found', () => {
      mockGet.mockReturnValue({
        id: 1, name: 'sp500_top50', provider: 'alpaca', basedOn: 'sp500_top50', updatedAt: 1000, targetSize: null,
      });
      mockAll.mockReturnValue([{ symbol: 'AAPL' }, { symbol: 'MSFT' }]);

      const result = service.get(1);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('sp500_top50');
      expect(result!.symbols).toEqual(['AAPL', 'MSFT']);
      expect(result!.symbolCount).toBe(2);
      expect(result!.targetSize).toBeNull();
    });

    it('returns targetSize when set', () => {
      mockGet.mockReturnValue({
        id: 1, name: 'sp500_top50', provider: 'alpaca', basedOn: 'sp500_top50', updatedAt: 1000, targetSize: 50,
      });
      mockAll.mockReturnValue([{ symbol: 'AAPL' }]);

      const result = service.get(1);
      expect(result!.targetSize).toBe(50);
      const sql = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('u.target_size AS targetSize');
    });

    it('returns null when universe not found', () => {
      mockGet.mockReturnValue(undefined);
      expect(service.get(999)).toBeNull();
    });
  });

  describe('create', () => {
    it('creates universe and returns id', () => {
      mockRun.mockReturnValue({ lastInsertRowid: 5 });

      const result = service.create({ name: 'test', provider: 'alpaca' });
      expect(result.id).toBe(5);
    });

    it('inserts symbols when provided', () => {
      mockRun.mockReturnValue({ lastInsertRowid: 3 });

      service.create({ name: 'test', provider: 'alpaca', symbols: ['AAPL', 'MSFT'] });

      // 1 universe INSERT + 2 symbol INSERTs = 3 prepare calls
      // (transaction wraps, but the inner fn calls prepare)
      const runCalls = mockRun.mock.calls;
      // First call: universe insert params (name, provider, null, now, now)
      expect(runCalls[0][0]).toBe('test');
      expect(runCalls[0][1]).toBe('alpaca');
      // Second + third: symbol inserts (universeId, symbol, now)
      expect(runCalls[1][0]).toBe(3);
      expect(runCalls[1][1]).toBe('AAPL');
      expect(runCalls[2][0]).toBe(3);
      expect(runCalls[2][1]).toBe('MSFT');
    });
  });

  describe('update', () => {
    it('renames universe', () => {
      service.update({ id: 1, name: 'renamed' });
      const sql = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('name = ?');
      expect(sql).toContain('updated_at = ?');
      expect(mockRun).toHaveBeenCalledWith('renamed', expect.any(Number), 1);
    });

    it('does nothing when no fields provided', () => {
      service.update({ id: 1 });
      expect(mockRun).not.toHaveBeenCalled();
    });

    it('sets targetSize', () => {
      service.update({ id: 1, targetSize: 50 });
      const sql = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('target_size = ?');
      expect(sql).toContain('updated_at = ?');
      expect(mockRun).toHaveBeenCalledWith(50, expect.any(Number), 1);
    });

    it('clears targetSize to null', () => {
      service.update({ id: 1, targetSize: null });
      const sql = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('target_size = ?');
      expect(mockRun).toHaveBeenCalledWith(null, expect.any(Number), 1);
    });

    it('updates both name and targetSize atomically', () => {
      service.update({ id: 1, name: 'newname', targetSize: 30 });
      const sql = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('name = ?');
      expect(sql).toContain('target_size = ?');
      expect(mockRun).toHaveBeenCalledWith('newname', 30, expect.any(Number), 1);
    });
  });

  describe('delete', () => {
    it('deletes universe by id', () => {
      service.delete(7);
      expect(mockRun).toHaveBeenCalledWith(7);
      const sql = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('DELETE FROM user_universe WHERE id = ?');
    });
  });

  describe('addSymbols', () => {
    it('inserts symbols with INSERT OR IGNORE for idempotency', () => {
      service.addSymbols({ universeId: 1, symbols: ['AAPL', 'TSLA'] });

      const insertSql = mockPrepare.mock.calls[0][0];
      expect(insertSql).toContain('INSERT OR IGNORE INTO user_universe_symbol');
      expect(mockRun).toHaveBeenCalledTimes(3); // 2 symbol inserts + 1 updated_at
    });

    it('does nothing for empty symbols array', () => {
      service.addSymbols({ universeId: 1, symbols: [] });
      expect(mockPrepare).not.toHaveBeenCalled();
    });

    it('updates updated_at on the parent universe', () => {
      service.addSymbols({ universeId: 1, symbols: ['AAPL'] });

      const updateSql = mockPrepare.mock.calls[1][0];
      expect(updateSql).toContain('UPDATE user_universe SET updated_at');
    });
  });

  describe('removeSymbols', () => {
    it('deletes specified symbols', () => {
      service.removeSymbols({ universeId: 1, symbols: ['AAPL', 'TSLA'] });

      const deleteSql = mockPrepare.mock.calls[0][0];
      expect(deleteSql).toContain('DELETE FROM user_universe_symbol WHERE universe_id = ? AND symbol = ?');
      // 2 symbol deletes + 1 updated_at update
      expect(mockRun).toHaveBeenCalledTimes(3);
    });

    it('does nothing for empty symbols array', () => {
      service.removeSymbols({ universeId: 1, symbols: [] });
      expect(mockPrepare).not.toHaveBeenCalled();
    });
  });
});
