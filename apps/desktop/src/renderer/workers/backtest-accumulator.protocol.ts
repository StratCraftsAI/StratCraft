/**
 * TICKET_400: Web Worker protocol types for backtest data accumulation.
 *
 * Defines the message contract between main thread and the accumulator Worker.
 * The Worker holds canonical full-resolution arrays; main thread receives
 * downsampled slices (~2000 points) during execution, full data on completion.
 */

// ---------------------------------------------------------------------------
// Shared data shapes (duplicated from store types to avoid DOM-dependent imports)
// ---------------------------------------------------------------------------

export interface WEquityPoint {
  timestamp: number;
  equity: number;
  drawdown: number;
}

export interface WCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WTrade {
  entryTime: number;
  exitTime: number;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  commission: number;
  reason: string;
}

export interface WMetrics {
  totalPnl: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
}

// ---------------------------------------------------------------------------
// Main -> Worker messages
// ---------------------------------------------------------------------------

export interface InitTaskMessage {
  type: 'INIT_TASK';
  taskId: string;
}

export interface IncrementMessage {
  type: 'INCREMENT';
  taskId: string;
  increment: {
    newCandles?: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>;
    newEquityPoints?: Array<{ timestamp: number; equity: number; drawdown: number }>;
    newTrades?: Array<Record<string, unknown>>;
    currentMetrics?: Record<string, number>;
    processedBars?: number;
    totalBars?: number;
  };
}

export interface CompleteMessage {
  type: 'COMPLETE';
  taskId: string;
}

export interface DestroyTaskMessage {
  type: 'DESTROY_TASK';
  taskId: string;
}

export type MainToWorkerMessage =
  | InitTaskMessage
  | IncrementMessage
  | CompleteMessage
  | DestroyTaskMessage;

// ---------------------------------------------------------------------------
// Worker -> Main messages
// ---------------------------------------------------------------------------

/** Throttled render-ready payload with downsampled data */
export interface RenderUpdateMessage {
  type: 'RENDER_UPDATE';
  taskId: string;
  payload: RenderPayload;
}

export interface RenderPayload {
  equityCurve: WEquityPoint[];
  candles: WCandle[];
  trades: WTrade[];
  metrics: WMetrics | null;
  processedBars: number;
  totalBars: number;
  /** Total counts of full-resolution data (for summary display) */
  totalEquityCount: number;
  totalCandleCount: number;
  totalTradeCount: number;
}

/** Full-resolution data sent once on completion for DB persistence */
export interface FullDataMessage {
  type: 'FULL_DATA';
  taskId: string;
  payload: FullDataPayload;
}

export interface FullDataPayload {
  equityCurve: WEquityPoint[];
  candles: WCandle[];
  trades: WTrade[];
}

export type WorkerToMainMessage = RenderUpdateMessage | FullDataMessage;
