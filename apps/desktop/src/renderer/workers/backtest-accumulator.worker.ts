/**
 * TICKET_400: Backtest data accumulation Web Worker.
 *
 * Single long-lived Worker managing Map<taskId, TaskAccumulator>.
 * Receives incremental data from main thread, accumulates via mutable push (O(1)),
 * self-throttles render output at 100ms intervals with LTTB/OHLC downsampling.
 * On COMPLETE, sends final RENDER_UPDATE + FULL_DATA with complete arrays.
 */

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  WEquityPoint,
  WCandle,
  WTrade,
  WMetrics,
  RenderPayload,
} from './backtest-accumulator.protocol';

import { CHART_MAX_RENDER_POINTS, CHART_RENDER_INTERVAL_MS } from '../../shared/constants/rendering';
// TICKET_854: shared in-app LTTB (also used by the main-process IPC
// decimation layer). Plugin-alias-free import, safe inside a Worker.
import { downsampleLTTB } from '../../shared/utils/downsample-lttb';

// ---------------------------------------------------------------------------
// Downsample utilities
// ---------------------------------------------------------------------------

const MAX_RENDER_POINTS = CHART_MAX_RENDER_POINTS;

function downsampleOHLC(candles: WCandle[], maxPoints: number): WCandle[] {
  if (candles.length <= maxPoints) return candles;
  const bucketSize = candles.length / maxPoints;
  const result: WCandle[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(Math.floor((i + 1) * bucketSize), candles.length);
    let low = candles[start].low;
    let high = candles[start].high;
    for (let j = start + 1; j < end; j++) {
      if (candles[j].low < low) low = candles[j].low;
      if (candles[j].high > high) high = candles[j].high;
    }
    result.push({
      timestamp: candles[start].timestamp,
      open: candles[start].open,
      high,
      low,
      close: candles[end - 1].close,
      volume: 0,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Task Accumulator
// ---------------------------------------------------------------------------

interface TaskAccumulator {
  equityCurve: WEquityPoint[];
  candles: WCandle[];
  trades: WTrade[];
  metrics: WMetrics | null;
  processedBars: number;
  totalBars: number;
  dirty: boolean;
}

function createAccumulator(): TaskAccumulator {
  return {
    equityCurve: [],
    candles: [],
    trades: [],
    metrics: null,
    processedBars: 0,
    totalBars: 0,
    dirty: false,
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const tasks = new Map<string, TaskAccumulator>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
const RENDER_INTERVAL_MS = CHART_RENDER_INTERVAL_MS;

function postMsg(msg: WorkerToMainMessage): void {
  (self as unknown as { postMessage: (msg: WorkerToMainMessage) => void }).postMessage(msg);
}

// ---------------------------------------------------------------------------
// Map snake_case trade fields to camelCase
// ---------------------------------------------------------------------------

function mapTrade(t: Record<string, unknown>): WTrade {
  return {
    entryTime: (t.entry_time as number) ?? (t.entryTime as number) ?? 0,
    exitTime: (t.exit_time as number) ?? (t.exitTime as number) ?? 0,
    symbol: (t.symbol as string) ?? '',
    side: (t.side as string) ?? '',
    entryPrice: (t.entry_price as number) ?? (t.entryPrice as number) ?? 0,
    exitPrice: (t.exit_price as number) ?? (t.exitPrice as number) ?? 0,
    quantity: (t.quantity as number) ?? 0,
    pnl: (t.pnl as number) ?? 0,
    commission: (t.commission as number) ?? 0,
    reason: (t.reason as string) ?? '',
  };
}

// ---------------------------------------------------------------------------
// Build render payload (downsampled)
// ---------------------------------------------------------------------------

function buildRenderPayload(acc: TaskAccumulator): RenderPayload {
  return {
    equityCurve: downsampleLTTB(acc.equityCurve, MAX_RENDER_POINTS, p => p.equity),
    candles: downsampleOHLC(acc.candles, MAX_RENDER_POINTS),
    trades: acc.trades.length <= MAX_RENDER_POINTS
      ? acc.trades
      : acc.trades.filter((_, i) => i % Math.ceil(acc.trades.length / MAX_RENDER_POINTS) === 0),
    metrics: acc.metrics,
    processedBars: acc.processedBars,
    totalBars: acc.totalBars,
    totalEquityCount: acc.equityCurve.length,
    totalCandleCount: acc.candles.length,
    totalTradeCount: acc.trades.length,
  };
}

// ---------------------------------------------------------------------------
// Self-throttled render tick
// ---------------------------------------------------------------------------

function renderTick(): void {
  for (const [taskId, acc] of tasks) {
    if (!acc.dirty) continue;
    acc.dirty = false;
    postMsg({
      type: 'RENDER_UPDATE',
      taskId,
      payload: buildRenderPayload(acc),
    });
  }
}

function ensureTimer(): void {
  if (tickTimer !== null) return;
  tickTimer = setInterval(renderTick, RENDER_INTERVAL_MS);
}

function maybeStopTimer(): void {
  if (tasks.size === 0 && tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'INIT_TASK': {
      tasks.set(msg.taskId, createAccumulator());
      ensureTimer();
      break;
    }

    case 'INCREMENT': {
      let acc = tasks.get(msg.taskId);
      if (!acc) {
        // Auto-init if INIT_TASK was missed
        acc = createAccumulator();
        tasks.set(msg.taskId, acc);
        ensureTimer();
      }

      const inc = msg.increment;

      // Mutable push: O(1) amortized
      if (inc.newCandles) {
        for (let i = 0; i < inc.newCandles.length; i++) {
          acc.candles.push(inc.newCandles[i]);
        }
      }
      if (inc.newEquityPoints) {
        for (let i = 0; i < inc.newEquityPoints.length; i++) {
          acc.equityCurve.push(inc.newEquityPoints[i]);
        }
      }
      if (inc.newTrades) {
        for (let i = 0; i < inc.newTrades.length; i++) {
          acc.trades.push(mapTrade(inc.newTrades[i]));
        }
      }
      if (inc.currentMetrics) {
        acc.metrics = {
          totalPnl: inc.currentMetrics.totalPnl || 0,
          totalReturn: inc.currentMetrics.totalReturn || 0,
          sharpeRatio: inc.currentMetrics.sharpeRatio || 0,
          maxDrawdown: inc.currentMetrics.maxDrawdown || 0,
          totalTrades: inc.currentMetrics.totalTrades || 0,
          winningTrades: inc.currentMetrics.winningTrades || 0,
          losingTrades: inc.currentMetrics.losingTrades || 0,
          winRate: inc.currentMetrics.winRate || 0,
          profitFactor: inc.currentMetrics.profitFactor || 0,
        };
      }
      if (typeof inc.processedBars === 'number') acc.processedBars = inc.processedBars;
      if (typeof inc.totalBars === 'number') acc.totalBars = inc.totalBars;

      acc.dirty = true;
      break;
    }

    case 'COMPLETE': {
      const acc = tasks.get(msg.taskId);
      if (!acc) break;

      // Immediate final render update with latest downsampled data
      postMsg({
        type: 'RENDER_UPDATE',
        taskId: msg.taskId,
        payload: buildRenderPayload(acc),
      });

      // Full-resolution data for DB persistence
      postMsg({
        type: 'FULL_DATA',
        taskId: msg.taskId,
        payload: {
          equityCurve: acc.equityCurve,
          candles: acc.candles,
          trades: acc.trades,
        },
      });

      // Keep accumulator alive briefly for any late messages, then clean up
      tasks.delete(msg.taskId);
      maybeStopTimer();
      break;
    }

    case 'DESTROY_TASK': {
      tasks.delete(msg.taskId);
      maybeStopTimer();
      break;
    }
  }
};
