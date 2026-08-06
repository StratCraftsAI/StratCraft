/**
 * BacktestResultService Unit Tests
 *
 * TICKET_424_2C: Tests for backtest result persistence, field mapping,
 * history retrieval, and deletion.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  dbLog: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { BacktestResultService } from '../backtest-result-service';
import type { DatabaseManager } from '../../db-manager';
import type { ExecutorConfig, ExecutorResult } from '../../../services/executor-service';

function createMockDb() {
  const stmtMock = {
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  };
  const db = {
    prepare: vi.fn().mockReturnValue(stmtMock),
  } as unknown as DatabaseManager;
  return { db, stmtMock };
}

function createTestConfig(overrides?: Partial<ExecutorConfig>): ExecutorConfig {
  return {
    strategyPath: '/path/to/my_strategy.py',
    data: {
      symbol: 'AAPL',
      interval: '1h',
      startTime: 1700000000,
      endTime: 1700100000,
      dataPath: '/data/aapl.parquet',
    },
    execution: {
      initialCapital: 100000,
      orderSize: 100,
      orderSizeUnit: 'shares',
    },
    ...overrides,
  } as ExecutorConfig;
}

function createTestResult(): ExecutorResult {
  return {
    success: true,
    startTime: 1700000000,
    endTime: 1700100000,
    metrics: {
      totalPnl: 5000,
      totalReturn: 0.05,
      sharpeRatio: 1.5,
      maxDrawdown: -0.02,
      winRate: 0.6,
      profitFactor: 2.1,
      totalTrades: 50,
      winningTrades: 30,
      losingTrades: 20,
    },
    trades: [{
      entryTime: 1700000000,
      exitTime: 1700003600,
      symbol: 'AAPL',
      side: 'long',
      entryPrice: 100,
      exitPrice: 101,
      quantity: 100,
      pnl: 100,
      commission: 0,
      reason: 'signal',
    }],
    equityCurve: [
      { timestamp: 1700000000, equity: 100000, drawdown: 0 },
      { timestamp: 1700003600, equity: 100100, drawdown: 0 },
    ],
    candles: [],
    executionTimeMs: 1234,
  };
}

describe('BacktestResultService', () => {
  let db: DatabaseManager;
  let stmtMock: ReturnType<typeof createMockDb>['stmtMock'];
  let service: BacktestResultService;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db, stmtMock } = createMockDb());
    service = new BacktestResultService(db);
  });

  // =========================================================================
  // saveResult
  // =========================================================================

  describe('saveResult', () => {
    it('should map config+result to 26-column INSERT', () => {
      const config = createTestConfig();
      const result = createTestResult();

      service.saveResult('task-1', config, result);

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO desktop_backtest_results');
      expect(sql).toContain('task_id');
      expect(sql).toContain('data_path');
      // 26 placeholders (TICKET_498: added is_dry_run + dry_run_info_json)
      const questionMarks = sql.match(/\?/g);
      expect(questionMarks).toHaveLength(26);
    });

    it('should use config.strategyName when provided', () => {
      const config = createTestConfig({ strategyName: 'Custom Name' } as any);
      const result = createTestResult();

      service.saveResult('task-1', config, result);

      const args = stmtMock.run.mock.calls[0];
      expect(args[1]).toBe('Custom Name'); // second arg = strategy_name
    });

    it('should fall back to basename when strategyName not provided', () => {
      const config = createTestConfig();
      const result = createTestResult();

      service.saveResult('task-1', config, result);

      const args = stmtMock.run.mock.calls[0];
      expect(args[1]).toBe('my_strategy');
    });

    it('should convert startTime/endTime (seconds) to ISO dates', () => {
      const config = createTestConfig();
      const result = createTestResult();

      service.saveResult('task-1', config, result);

      const args = stmtMock.run.mock.calls[0];
      // args[4] = start_date, args[5] = end_date
      expect(args[4]).toBe(new Date(1700000000 * 1000).toISOString());
      expect(args[5]).toBe(new Date(1700100000 * 1000).toISOString());
    });

    it('should compute final_capital = totalPnl + initialCapital', () => {
      const config = createTestConfig();
      const result = createTestResult();

      service.saveResult('task-1', config, result);

      const args = stmtMock.run.mock.calls[0];
      // args[7] = final_capital
      expect(args[7]).toBe(105000); // 5000 + 100000
    });

    it('should serialize trades/equityCurve as JSON', () => {
      const config = createTestConfig();
      const result = createTestResult();

      service.saveResult('task-1', config, result);

      const args = stmtMock.run.mock.calls[0];
      // args[18] = trades_json, args[19] = equity_curve_json
      expect(args[18]).toBe(JSON.stringify(result.trades));
      expect(args[19]).toBe(JSON.stringify(result.equityCurve));
    });

    it('should resolve dataPath from config.data.dataPath', () => {
      const config = createTestConfig();
      const result = createTestResult();

      service.saveResult('task-1', config, result);

      const args = stmtMock.run.mock.calls[0];
      // args[23] = data_path
      expect(args[23]).toBe('/data/aapl.parquet');
    });

    it('should fall back to dataFeeds[0].dataPath when data.dataPath is empty', () => {
      const config = createTestConfig();
      (config.data as any).dataPath = '';
      (config as any).dataFeeds = [{ dataPath: '/feeds/data.parquet' }];
      const result = createTestResult();

      service.saveResult('task-1', config, result);

      const args = stmtMock.run.mock.calls[0];
      expect(args[23]).toBe('/feeds/data.parquet');
    });
  });

  // =========================================================================
  // getHistory
  // =========================================================================

  describe('getHistory', () => {
    it('should SELECT with ORDER BY DESC and LIMIT', () => {
      stmtMock.all.mockReturnValue([{ task_id: 't1' }]);
      const results = service.getHistory();

      expect(results).toHaveLength(1);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(sql).toContain('LIMIT ?');
      expect(stmtMock.all).toHaveBeenCalledWith(50); // default limit
    });

    it('should accept custom limit', () => {
      service.getHistory(10);
      expect(stmtMock.all).toHaveBeenCalledWith(10);
    });
  });

  // =========================================================================
  // getByTaskId
  // =========================================================================

  describe('getByTaskId', () => {
    it('should return record when found', () => {
      const record = { task_id: 'task-1', strategy_name: 'S1' };
      stmtMock.get.mockReturnValue(record);
      expect(service.getByTaskId('task-1')).toEqual(record);
    });

    it('should return null when not found', () => {
      stmtMock.get.mockReturnValue(undefined);
      expect(service.getByTaskId('missing')).toBeNull();
    });
  });

  // =========================================================================
  // deleteByTaskId
  // =========================================================================

  describe('deleteByTaskId', () => {
    it('should execute DELETE', () => {
      service.deleteByTaskId('task-1');
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('DELETE FROM desktop_backtest_results WHERE task_id = ?');
      expect(stmtMock.run).toHaveBeenCalledWith('task-1');
    });
  });
});
