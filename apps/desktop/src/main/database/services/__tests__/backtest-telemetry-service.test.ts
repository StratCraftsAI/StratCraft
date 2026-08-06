/**
 * BacktestTelemetryService Unit Tests
 *
 * TICKET_1010: Tests for per-cockpit backtest telemetry tracking.
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

import {
  BacktestTelemetryService,
  resolveBuilderMode,
  type BuilderMode,
} from '../backtest-telemetry-service';
import type { DatabaseManager } from '../../db-manager';

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

describe('BacktestTelemetryService', () => {
  let db: DatabaseManager;
  let stmtMock: ReturnType<typeof createMockDb>['stmtMock'];
  let service: BacktestTelemetryService;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db, stmtMock } = createMockDb());
    service = new BacktestTelemetryService(db);
  });

  describe('recordStart', () => {
    it('inserts a started record with all fields', () => {
      service.recordStart('task_123', 'aiLibero', {
        strategyName: 'MyStrat',
        symbol: 'AAPL',
        timeframe: '1h',
      });

      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO desktop_backtest_telemetry'));
      expect(stmtMock.run).toHaveBeenCalledWith('task_123', 'aiLibero', 'MyStrat', 'AAPL', '1h');
    });

    it('handles null symbol and timeframe', () => {
      service.recordStart('task_456', 'regimeDetector', {
        strategyName: 'Detector',
      });

      expect(stmtMock.run).toHaveBeenCalledWith('task_456', 'regimeDetector', 'Detector', null, null);
    });
  });

  describe('recordSuccess', () => {
    it('inserts a success record referencing the started row', () => {
      service.recordSuccess('task_123', 5432);

      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("'success'"));
      expect(stmtMock.run).toHaveBeenCalledWith(5432, 'task_123');
    });
  });

  describe('recordFailure', () => {
    it('inserts a failed record with reason and detail', () => {
      service.recordFailure('task_789', 'compilation_error', 'g++ error: undefined reference', 3000);

      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("'failed'"));
      expect(stmtMock.run).toHaveBeenCalledWith(
        'compilation_error',
        'g++ error: undefined reference',
        3000,
        'task_789',
      );
    });

    it('truncates failure_detail to 500 chars', () => {
      const longDetail = 'x'.repeat(600);
      service.recordFailure('task_long', 'runtime_crash', longDetail, 1000);

      expect(stmtMock.run).toHaveBeenCalledWith(
        'runtime_crash',
        'x'.repeat(500),
        1000,
        'task_long',
      );
    });

    it('handles null failure_detail', () => {
      service.recordFailure('task_cancel', 'user_cancel', null, 500);

      expect(stmtMock.run).toHaveBeenCalledWith(
        'user_cancel',
        null,
        500,
        'task_cancel',
      );
    });

    it('handles null execution_time_ms', () => {
      service.recordFailure('task_timeout', 'timeout', 'timed out', null);

      expect(stmtMock.run).toHaveBeenCalledWith(
        'timeout',
        'timed out',
        null,
        'task_timeout',
      );
    });
  });

  describe('getByMode', () => {
    it('returns zero counts when table is empty', () => {
      stmtMock.all.mockReturnValue([]);
      const result = service.getByMode();

      expect(result.regimeDetector).toEqual({ success: 0, failed: 0 });
      expect(result.aiLibero).toEqual({ success: 0, failed: 0 });
      expect(result.strategyStudio).toEqual({ success: 0, failed: 0 });
    });

    it('maps DB rows to the BacktestsByMode structure', () => {
      stmtMock.all.mockReturnValue([
        { builder_mode: 'aiLibero', success_count: 5, failed_count: 2 },
        { builder_mode: 'regimeDetector', success_count: 0, failed_count: 3 },
      ]);

      const result = service.getByMode();

      expect(result.aiLibero).toEqual({ success: 5, failed: 2 });
      expect(result.regimeDetector).toEqual({ success: 0, failed: 3 });
      expect(result.strategyStudio).toEqual({ success: 0, failed: 0 });
    });

    it('ignores unknown builder_mode values from DB', () => {
      stmtMock.all.mockReturnValue([
        { builder_mode: 'unknownMode', success_count: 99, failed_count: 1 },
      ]);

      const result = service.getByMode();
      expect((result as unknown as Record<string, unknown>)['unknownMode']).toBeUndefined();
    });
  });
});

describe('resolveBuilderMode', () => {
  const cases: Array<[{ strategyType: number; signalSource: string | null }, BuilderMode]> = [
    [{ strategyType: 9, signalSource: 'indicator_detector_rsi' }, 'regimeDetector'],
    [{ strategyType: 3, signalSource: 'indicator_entry_ma' }, 'regimeEntry'],
    [{ strategyType: 7, signalSource: 'watchlist' }, 'marketObserver'],
    [{ strategyType: 1, signalSource: 'llmtrader' }, 'traderEntry'],
    [{ strategyType: 1, signalSource: 'aiLibero' }, 'aiLibero'],
    [{ strategyType: 1, signalSource: 'aiStudio' }, 'strategyStudio'],
    [{ strategyType: 6, signalSource: 'risk_override' }, 'exitStrategy'],
    [{ strategyType: 1, signalSource: 'strategy_catalog_v2' }, 'catalogStrategy'],
  ];

  it.each(cases)('maps %j to %s', (input, expected) => {
    expect(resolveBuilderMode(input)).toBe(expected);
  });

  it('falls back to strategyStudio for unclassified', () => {
    expect(resolveBuilderMode({ strategyType: 99, signalSource: 'other' })).toBe('strategyStudio');
    expect(resolveBuilderMode({ strategyType: 1, signalSource: null })).toBe('strategyStudio');
  });
});
