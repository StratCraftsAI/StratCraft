/**
 * Backtest Types and Interfaces
 *
 * Core type definitions for the backtest engine.
 */

import type { OHLCV, OHLCVSeries, Interval, Timestamp } from '@shared/types';

// =============================================================================
// Backtest Configuration
// =============================================================================

/**
 * Backtest configuration
 */
export interface BacktestConfig {
  [key: string]: unknown;
  // Capital
  initialCapital: number;
  currency: string;

  // Costs
  commission: number;          // Commission rate (e.g., 0.001 = 0.1%)
  slippage: number;            // Slippage rate
  marginRate: number;          // Margin/leverage (1.0 = no leverage)

  // Risk
  riskFreeRate: number;        // Annual risk-free rate for Sharpe

  // Execution
  fillModel: FillModel;
  allowPartialFills: boolean;
  checkVolume: boolean;
  maxVolumePercent: number;    // Max % of bar volume per order

  // Risk limits
  maxPositionSize: number;     // Max position as % of equity
  maxDrawdown: number;         // Max drawdown before stopping
  stopOnMaxDrawdown: boolean;
}

export type FillModel = 'close' | 'next_open' | 'vwap';

/**
 * Backtest request
 */
export interface BacktestRequest {
  // Strategy
  strategyId: string;
  strategyParams?: Record<string, unknown>;

  // Data
  symbol: string;
  interval: Interval;
  startDate: string;           // ISO date
  endDate: string;             // ISO date

  // Configuration
  config?: Partial<BacktestConfig>;
}

// =============================================================================
// Orders and Trades
// =============================================================================

/**
 * Order side
 */
export type OrderSide = 'buy' | 'sell';

/**
 * Order type
 */
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';

/**
 * Order status
 */
export type OrderStatus =
  | 'pending'
  | 'submitted'
  | 'partial'
  | 'filled'
  | 'cancelled'
  | 'rejected'
  | 'expired';

/**
 * Order definition
 */
export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;              // For limit orders
  stopPrice?: number;          // For stop orders
  status: OrderStatus;
  filledQuantity: number;
  avgFillPrice: number;
  commission: number;
  createdAt: Timestamp;
  filledAt?: Timestamp;
  cancelledAt?: Timestamp;
  parentId?: string;           // For bracket orders
  tag?: string;                // User tag
}

/**
 * Trade (filled order)
 */
export interface Trade {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  commission: number;
  slippage: number;
  timestamp: Timestamp;
  barIndex: number;
  pnl?: number;                // Realized P&L (for closing trades)
  pnlPercent?: number;
  tag?: string;
}

/**
 * Position
 */
export interface Position {
  symbol: string;
  quantity: number;            // Positive = long, negative = short
  avgPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number;
  openedAt: Timestamp;
  lastUpdatedAt: Timestamp;
}

// =============================================================================
// Signals and Strategy
// =============================================================================

/**
 * Trading signal
 */
export interface Signal {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity?: number;           // If not set, use position sizing
  price?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  tag?: string;
  timestamp: Timestamp;
}

/**
 * Strategy context - passed to strategy on each bar
 */
export interface StrategyContext {
  // Current state
  bar: OHLCV;
  barIndex: number;
  timestamp: Timestamp;
  symbol: string;

  // Historical data
  bars: OHLCV[];
  lookback: (n: number) => OHLCV[];

  // Portfolio state
  equity: number;
  cash: number;
  position: Position | null;
  positions: Map<string, Position>;
  orders: Order[];

  // Actions
  buy: (quantity?: number, options?: OrderOptions) => Signal;
  sell: (quantity?: number, options?: OrderOptions) => Signal;
  close: (options?: OrderOptions) => Signal | null;
  cancel: (orderId: string) => void;
  cancelAll: () => void;

  // Utilities
  log: (message: string) => void;
  getParam: <T>(name: string, defaultValue: T) => T;
}

export interface OrderOptions {
  type?: OrderType;
  price?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  tag?: string;
}

/**
 * Strategy interface
 */
export interface Strategy {
  id: string;
  name: string;
  description?: string;
  version?: string;

  // Parameters
  params: StrategyParam[];

  // Lifecycle
  init?: (ctx: StrategyContext) => void;
  onBar: (ctx: StrategyContext) => Signal | Signal[] | void;
  onOrderFilled?: (ctx: StrategyContext, order: Order, trade: Trade) => void;
  onEnd?: (ctx: StrategyContext) => void;
}

export interface StrategyParam {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: unknown[];
  description?: string;
}

// =============================================================================
// Backtest Results
// =============================================================================

/**
 * Equity curve point
 */
export interface EquityPoint {
  timestamp: Timestamp;
  barIndex: number;
  equity: number;
  cash: number;
  positionValue: number;
  drawdown: number;
  drawdownPercent: number;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  // Returns
  totalReturn: number;
  totalReturnPercent: number;
  annualizedReturn: number;
  cagr: number;                // Compound Annual Growth Rate

  // Risk
  volatility: number;          // Annualized volatility
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;

  // Drawdown
  maxDrawdown: number;
  maxDrawdownPercent: number;
  maxDrawdownDuration: number; // In days
  avgDrawdown: number;

  // Trades
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  avgWinPercent: number;
  avgLossPercent: number;
  profitFactor: number;
  payoffRatio: number;         // Avg win / Avg loss
  expectancy: number;

  // Exposure
  avgExposure: number;         // Average % of capital in market
  maxExposure: number;
  timeInMarket: number;        // % of time with open position

  // Other
  totalCommission: number;
  totalSlippage: number;
}

/**
 * Monthly returns
 */
export interface MonthlyReturn {
  year: number;
  month: number;
  return: number;
  returnPercent: number;
}

/**
 * Backtest result
 */
export interface BacktestResult {
  // Request info
  request: BacktestRequest;
  config: BacktestConfig;

  // Status
  status: 'completed' | 'stopped' | 'error';
  error?: string;

  // Time
  startedAt: Timestamp;
  completedAt: Timestamp;
  durationMs: number;

  // Data range
  dataStart: Timestamp;
  dataEnd: Timestamp;
  totalBars: number;

  // Results
  metrics: PerformanceMetrics;
  trades: Trade[];
  equityCurve: EquityPoint[];
  monthlyReturns: MonthlyReturn[];
  orders: Order[];

  // Final state
  finalEquity: number;
  finalCash: number;
  finalPositions: Position[];
}

// =============================================================================
// Backtest Engine Events
// =============================================================================

export type BacktestEventType =
  | 'started'
  | 'progress'
  | 'bar'
  | 'signal'
  | 'order'
  | 'trade'
  | 'completed'
  | 'stopped'
  | 'error';

export interface BacktestEvent {
  type: BacktestEventType;
  timestamp: Timestamp;
  data?: unknown;
}

export interface BacktestProgressEvent extends BacktestEvent {
  type: 'progress';
  data: {
    currentBar: number;
    totalBars: number;
    percent: number;
    currentDate: string;
  };
}

// =============================================================================
// Optimization
// =============================================================================

export interface OptimizationRequest {
  strategyId: string;
  symbol: string;
  interval: Interval;
  startDate: string;
  endDate: string;
  config?: Partial<BacktestConfig>;

  // Parameters to optimize
  paramRanges: ParamRange[];

  // Optimization settings
  method: OptimizationMethod;
  metric: OptimizationMetric;
  maxIterations?: number;
}

export interface ParamRange {
  name: string;
  min: number;
  max: number;
  step: number;
}

export type OptimizationMethod = 'grid' | 'random' | 'genetic';
export type OptimizationMetric = 'sharpe' | 'return' | 'calmar' | 'sortino' | 'custom';

export interface OptimizationResult {
  request: OptimizationRequest;
  bestParams: Record<string, unknown>;
  bestMetric: number;
  allResults: Array<{
    params: Record<string, unknown>;
    metric: number;
    result: BacktestResult;
  }>;
  durationMs: number;
}
