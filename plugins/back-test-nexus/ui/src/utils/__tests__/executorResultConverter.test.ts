/**
 * TICKET_634_4: executorResultConverter Tests (back-test-nexus)
 *
 * Tests for stratforge-runner snake_case JSON to TypeScript camelCase
 * result conversion (TICKET_230). Per TICKET_751_2, naming reflects the
 * C++ executor wire format rather than the deprecated Python pipeline.
 *
 * TICKET_1225 P5: additional tests for warmupEndTimestamp + feedBarCounts.
 */
import { describe, it, expect } from 'vitest';
import { convertExecutorRawResultToExecutorResult } from '../executorResultConverter';
import type { ExecutorResult, FeedBarCountEntry } from '../../components/ui/backtest-result/types';

describe('convertExecutorRawResultToExecutorResult', () => {
  it('should convert snake_case fields to camelCase', () => {
    const rawResult = {
      success: true,
      error_message: undefined,
      start_time: 1704067200,
      end_time: 1706745600,
      execution_time_ms: 1500,
      metrics: {
        total_pnl: 5000,
        total_return: 0.05,
        sharpe_ratio: 1.5,
        max_drawdown: 0.03,
        total_trades: 50,
        winning_trades: 30,
        losing_trades: 20,
        win_rate: 0.6,
        profit_factor: 2.1,
      },
      equity_curve: [
        { timestamp: 1704067200, equity: 100000, drawdown: 0 },
      ],
      trades: [
        {
          entry_time: 1704067200,
          exit_time: 1704153600,
          symbol: 'BTC/USDT',
          side: 'long',
          entry_price: 42000,
          exit_price: 43000,
          quantity: 1,
          pnl: 1000,
          commission: 42,
          reason: 'Signal exit',
        },
      ],
    };

    const result = convertExecutorRawResultToExecutorResult(rawResult);

    // Top-level fields
    expect(result.success).toBe(true);
    expect(result.startTime).toBe(1704067200);
    expect(result.endTime).toBe(1706745600);
    expect(result.executionTimeMs).toBe(1500);

    // Metrics
    expect(result.metrics.totalPnl).toBe(5000);
    expect(result.metrics.sharpeRatio).toBe(1.5);
    expect(result.metrics.maxDrawdown).toBe(0.03);
    expect(result.metrics.winRate).toBe(0.6);
    expect(result.metrics.profitFactor).toBe(2.1);

    // Equity curve
    expect(result.equityCurve).toHaveLength(1);

    // Trades
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryTime).toBe(1704067200);
    expect(result.trades[0].exitTime).toBe(1704153600);
    expect(result.trades[0].entryPrice).toBe(42000);
    expect(result.trades[0].exitPrice).toBe(43000);
    expect(result.trades[0].pnl).toBe(1000);

    // Candles always empty (come from incremental data)
    expect(result.candles).toEqual([]);
  });

  it('should handle empty/missing result', () => {
    const result = convertExecutorRawResultToExecutorResult({});

    expect(result.success).toBe(false);
    expect(result.startTime).toBe(0);
    expect(result.endTime).toBe(0);
    expect(result.executionTimeMs).toBe(0);
    expect(result.metrics.totalPnl).toBe(0);
    expect(result.metrics.totalTrades).toBe(0);
    expect(result.equityCurve).toEqual([]);
    expect(result.trades).toEqual([]);
  });

  it('should handle missing metrics', () => {
    const result = convertExecutorRawResultToExecutorResult({ success: true });
    expect(result.metrics.totalPnl).toBe(0);
    expect(result.metrics.sharpeRatio).toBe(0);
  });

  it('should handle missing trades', () => {
    const result = convertExecutorRawResultToExecutorResult({ success: true });
    expect(result.trades).toEqual([]);
  });

  it('should convert error_message to errorMessage', () => {
    const result = convertExecutorRawResultToExecutorResult({
      success: false,
      error_message: 'Strategy failed',
    });
    expect(result.errorMessage).toBe('Strategy failed');
  });

  it('should handle trade with missing fields', () => {
    const result = convertExecutorRawResultToExecutorResult({
      trades: [{ symbol: 'AAPL' }],
    });
    const trade = result.trades[0];
    expect(trade.symbol).toBe('AAPL');
    expect(trade.entryTime).toBe(0);
    expect(trade.exitTime).toBe(0);
    expect(trade.entryPrice).toBe(0);
    expect(trade.quantity).toBe(0);
    expect(trade.reason).toBe('');
  });
});

// =========================================================================
// TICKET_1225 P5: warmupEndTimestamp + feedBarCounts result DTO tests
// =========================================================================

describe('TICKET_1225 P5: ExecutorResult JSON shape compliance', () => {
  it('parses warmupEndTimestamp from camelCase result JSON', () => {
    // Simulates the JSON.parse path used by executor-service.ts
    const json = JSON.stringify({
      success: true,
      startTime: 1704067200000,
      endTime: 1706745600000,
      executionTimeMs: 1500,
      warmupEndTimestamp: 1704153600000,
      metrics: { totalPnl: 0, totalReturn: 0, sharpeRatio: 0, maxDrawdown: 0, totalTrades: 0 },
      equityCurve: [],
      trades: [],
      candles: [],
    });

    const result = JSON.parse(json) as ExecutorResult;
    expect(result.warmupEndTimestamp).toBe(1704153600000);
  });

  it('parses feedBarCounts from camelCase result JSON', () => {
    const feedBarCounts: FeedBarCountEntry[] = [
      { index: 0, interval: '1h', bars: 147134 },
      { index: 1, interval: '1M', bars: 288 },
    ];

    const json = JSON.stringify({
      success: true,
      startTime: 1704067200000,
      endTime: 1706745600000,
      executionTimeMs: 1500,
      feedBarCounts,
      metrics: { totalPnl: 0, totalReturn: 0, sharpeRatio: 0, maxDrawdown: 0, totalTrades: 0 },
      equityCurve: [],
      trades: [],
      candles: [],
    });

    const result = JSON.parse(json) as ExecutorResult;
    expect(result.feedBarCounts).toHaveLength(2);
    expect(result.feedBarCounts![0].index).toBe(0);
    expect(result.feedBarCounts![0].interval).toBe('1h');
    expect(result.feedBarCounts![0].bars).toBe(147134);
    expect(result.feedBarCounts![1].index).toBe(1);
    expect(result.feedBarCounts![1].interval).toBe('1M');
    expect(result.feedBarCounts![1].bars).toBe(288);
  });

  it('absent P5 fields are undefined (backward compat with older runner)', () => {
    const json = JSON.stringify({
      success: true,
      startTime: 0,
      endTime: 0,
      executionTimeMs: 0,
      metrics: { totalPnl: 0, totalReturn: 0, sharpeRatio: 0, maxDrawdown: 0, totalTrades: 0 },
      equityCurve: [],
      trades: [],
      candles: [],
    });

    const result = JSON.parse(json) as ExecutorResult;
    expect(result.warmupEndTimestamp).toBeUndefined();
    expect(result.feedBarCounts).toBeUndefined();
  });
});
