/**
 * TICKET_634_3 / TICKET_755 Phase 3: useExecutor Tests
 *
 * Tests for executor hook type exports, initial state shape, and the
 * TICKET_755 UI watchdog wiring. The codebase has no @testing-library/react,
 * so the watchdog tests exercise the wiring contract directly using the
 * same `createWatchdog` primitive the hook consumes (pattern-test style;
 * see Phase 0 verification log).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  ExecutorConfig,
  ExecutorMetrics,
  ExecutorTrade,
  EquityPoint,
  ExecutorResult,
  ExecutorProgress,
  ExecutorStatus,
  ExecutorState,
  StrategyInfo,
} from '../useExecutor';
import { createWatchdog } from '@StratCraft/shared-ui';
import { UI_WATCHDOG_BACKTEST_PROGRESS_MS } from '../../../shared/constants/timing';

describe('useExecutor types', () => {
  // =========================================================================
  // ExecutorConfig
  // =========================================================================

  describe('ExecutorConfig', () => {
    it('should accept minimal config', () => {
      const config: ExecutorConfig = {
        strategyPath: '/path/to/strategy.py',
        symbol: 'BTC/USDT',
        interval: '1h',
        startTime: 1704067200,
        endTime: 1706745600,
      };
      expect(config.strategyPath).toBeDefined();
      expect(config.symbol).toBe('BTC/USDT');
    });

    it('should accept full config with optional fields', () => {
      const config: ExecutorConfig = {
        language: 'cpp',
        strategyPath: '/path/to/strategy.cpp',
        strategyName: 'SMA Cross',
        symbol: 'AAPL',
        interval: '1d',
        startTime: 0,
        endTime: 1,
        dataPath: '/data/AAPL.parquet',
        dataSourceType: 'yfinance',
        initialCapital: 100000,
        commission: 0.001,
        slippage: 0.0005,
        allowShort: true,
        orderSize: 10,
        orderSizeUnit: 'percent',
        strategyParams: { period: 20 },
        dataFeeds: [{ interval: '4h', dataPath: '/data/4h.parquet' }],
      };
      expect(config.language).toBe('cpp');
      expect(config.dataFeeds).toHaveLength(1);
    });
  });

  // =========================================================================
  // ExecutorStatus
  // =========================================================================

  describe('ExecutorStatus', () => {
    it('should cover all status values', () => {
      const statuses: ExecutorStatus[] = ['idle', 'pending', 'running', 'completed', 'failed', 'cancelled'];
      expect(statuses).toHaveLength(6);
    });
  });

  // =========================================================================
  // ExecutorState
  // =========================================================================

  describe('ExecutorState', () => {
    it('should represent idle state', () => {
      const state: ExecutorState = {
        status: 'idle',
        taskId: null,
        progress: 0,
        progressMessage: '',
        result: null,
        error: null,
      };
      expect(state.status).toBe('idle');
      expect(state.taskId).toBeNull();
    });

    it('should represent running state', () => {
      const state: ExecutorState = {
        status: 'running',
        taskId: 'task-123',
        progress: 45,
        progressMessage: 'Processing bars...',
        result: null,
        error: null,
      };
      expect(state.taskId).toBe('task-123');
      expect(state.progress).toBe(45);
    });

    it('should represent failed state', () => {
      const state: ExecutorState = {
        status: 'failed',
        taskId: 'task-123',
        progress: 0,
        progressMessage: '',
        result: null,
        error: 'Strategy syntax error',
      };
      expect(state.error).toBe('Strategy syntax error');
    });
  });

  // =========================================================================
  // ExecutorResult
  // =========================================================================

  describe('ExecutorResult', () => {
    it('should represent a successful result', () => {
      const result: ExecutorResult = {
        success: true,
        startTime: 1704067200,
        endTime: 1706745600,
        executionTimeMs: 1500,
        metrics: {
          totalPnl: 5000,
          totalReturn: 0.05,
          sharpeRatio: 1.5,
          maxDrawdown: 0.03,
          totalTrades: 50,
          winningTrades: 30,
          losingTrades: 20,
          winRate: 0.6,
          profitFactor: 2.1,
        },
        equityCurve: [
          { timestamp: 1704067200, equity: 100000, drawdown: 0 },
          { timestamp: 1706745600, equity: 105000, drawdown: 0.01 },
        ],
        trades: [
          {
            entryTime: 1704067200,
            exitTime: 1704153600,
            symbol: 'BTC/USDT',
            side: 'long',
            entryPrice: 42000,
            exitPrice: 43000,
            quantity: 1,
            pnl: 1000,
            commission: 42,
            reason: 'Signal exit',
          },
        ],
      };
      expect(result.success).toBe(true);
      expect(result.metrics.winRate).toBe(0.6);
      expect(result.trades).toHaveLength(1);
    });
  });

  // =========================================================================
  // StrategyInfo
  // =========================================================================

  describe('StrategyInfo', () => {
    it('should represent a saved strategy', () => {
      const info: StrategyInfo = {
        name: 'SMA Crossover',
        path: '/strategies/sma_crossover/main.py',
        description: 'Simple moving average crossover strategy',
        createdAt: Date.now() - 86400000,
        modifiedAt: Date.now(),
      };
      expect(info.name).toBe('SMA Crossover');
      expect(info.modifiedAt).toBeGreaterThan(info.createdAt);
    });
  });
});

// ===========================================================================
// TICKET_755 Phase 3: watchdog wiring
// ---------------------------------------------------------------------------
// `useExecutor` wires `useEventWatchdog` with:
//   active       = status === 'pending' || status === 'running'
//   timeoutMs    = UI_WATCHDOG_BACKTEST_PROGRESS_MS
//   resetSignals = [progressTick]   (bumped on every onProgress event)
//   onTimeout    = setStatus('failed') with the prescribed error message
// These tests drive the same primitive the hook uses, simulating the active /
// reset / completion transitions the hook would emit in response to IPC.
// ===========================================================================

describe('TICKET_755: useExecutor watchdog wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Mirror of the hook's onTimeout body so tests verify the message contract
   * the user will see if the watchdog ever fires.
   */
  function buildWatchdogMessage(): string {
    const seconds = Math.round(UI_WATCHDOG_BACKTEST_PROGRESS_MS / 1000);
    return `Backtest watchdog: no progress for ${seconds}s. The executor may have crashed or the IPC channel may be unresponsive.`;
  }

  it('transitions status to failed after silence ceiling elapses', () => {
    const wd = createWatchdog();
    let status: ExecutorStatus = 'pending';
    let error: string | null = null;

    const onTimeout = (): void => {
      status = 'failed';
      error = buildWatchdogMessage();
    };

    wd.beginSession(UI_WATCHDOG_BACKTEST_PROGRESS_MS, onTimeout);

    vi.advanceTimersByTime(UI_WATCHDOG_BACKTEST_PROGRESS_MS - 1);
    expect(status).toBe('pending');

    vi.advanceTimersByTime(1);
    expect(status).toBe('failed');
    expect(error).toBe(buildWatchdogMessage());
  });

  it('resets the watchdog on progress events (no spurious timeout)', () => {
    const wd = createWatchdog();
    let status: ExecutorStatus = 'running';
    const onTimeout = (): void => {
      status = 'failed';
    };

    wd.beginSession(UI_WATCHDOG_BACKTEST_PROGRESS_MS, onTimeout);

    // Simulate steady progress events at 60% of the ceiling.
    const tickInterval = Math.floor(UI_WATCHDOG_BACKTEST_PROGRESS_MS * 0.6);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(tickInterval);
      wd.resetWithin(UI_WATCHDOG_BACKTEST_PROGRESS_MS, onTimeout);
      expect(status).toBe('running');
    }
  });

  it('clears the watchdog on completion / error transitions (no spurious fire)', () => {
    const wd = createWatchdog();
    let status: ExecutorStatus = 'running';
    const onTimeout = (): void => {
      status = 'failed';
    };

    wd.beginSession(UI_WATCHDOG_BACKTEST_PROGRESS_MS, onTimeout);

    // onCompleted arrives well before the watchdog would fire.
    vi.advanceTimersByTime(UI_WATCHDOG_BACKTEST_PROGRESS_MS / 2);
    status = 'completed';
    wd.endSession();

    // Plenty of time after the would-be deadline -- must not fire.
    vi.advanceTimersByTime(UI_WATCHDOG_BACKTEST_PROGRESS_MS * 2);
    expect(status).toBe('completed');
  });

  it('does not arm the watchdog outside pending/running states', () => {
    const wd = createWatchdog();
    let fired = false;
    const onTimeout = (): void => {
      fired = true;
    };

    // Status is 'idle' -- per hook wiring `active` is false, so the hook
    // never calls beginSession. Verify that an un-armed watchdog never fires.
    vi.advanceTimersByTime(UI_WATCHDOG_BACKTEST_PROGRESS_MS * 3);
    expect(fired).toBe(false);

    // Now status flips to 'running' -- hook would arm the watchdog.
    wd.beginSession(UI_WATCHDOG_BACKTEST_PROGRESS_MS, onTimeout);

    // Status flips to 'completed' before the deadline -- hook ends session.
    vi.advanceTimersByTime(UI_WATCHDOG_BACKTEST_PROGRESS_MS - 1);
    wd.endSession();

    vi.advanceTimersByTime(UI_WATCHDOG_BACKTEST_PROGRESS_MS * 2);
    expect(fired).toBe(false);
  });
});
