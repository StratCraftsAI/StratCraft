/**
 * Shared Backtest Types
 *
 * TICKET_157: Unified backtest configuration types
 *
 * Single source of truth for backtest config used across:
 * - Plugin layer (BacktestDataConfigPanel)
 * - Host layer (BacktestPage)
 * - Preload (IPC bridge)
 * - Main process (v3-handlers, executor-service)
 */

import type { FeedPlan } from '@StratCraft/types';

// =============================================================================
// Order Size
// =============================================================================

export type OrderSizeUnit = 'cash' | 'percent' | 'shares';

// =============================================================================
// Backtest Data Config (UI layer)
// =============================================================================

/**
 * Backtest configuration from UI
 * Used by: Plugin BacktestDataConfigPanel, Host BacktestPage
 */
export interface BacktestDataConfig {
  // Data source
  symbol: string;
  dataSource: string;

  // Time range
  startDate: string;  // ISO date string (YYYY-MM-DD)
  endDate: string;    // ISO date string (YYYY-MM-DD)
  timeframe: string;  // '1m', '5m', '15m', '1h', '4h', '1d', etc.

  // Execution parameters
  initialCapital: number;
  orderSize: number;
  orderSizeUnit: OrderSizeUnit;

  // TICKET_1130 Phase 3: confidence-weighted sizing toggle
  confidenceWeightedSizing?: boolean;
}

// =============================================================================
// Executor Request (IPC layer)
// =============================================================================

/**
 * TICKET_248 Phase 2: Data feed for a specific timeframe
 */
export interface DataFeedConfig {
  interval: string;   // e.g., '1d', '1h'
  dataPath: string;   // Path to parquet file
}

/**
 * Request to run backtest via IPC
 * Used by: preload/index.ts, v3-handlers.ts
 */
export interface BacktestExecutorRequest {
  // TICKET_352_5: Caller-generated task ID (renderer creates before async chain)
  taskId?: string;

  // TICKET_650 Phase 2: Primary algorithm DB ID for pre-compilation gate
  algorithmId?: number | string;

  // Strategy
  // TICKET_690: All strategies are C++ only
  language?: 'cpp';
  strategyPath: string;
  strategyName?: string;  // TICKET_163: User-provided name for backtest result
  compilerPath?: string;
  runnerPath?: string;
  cppIncludePaths?: string[];
  cppStrategyArtifactPath?: string;

  // Data source (transformed from BacktestDataConfig)
  symbol: string;
  interval: string;      // same as timeframe (primary/default)
  startTime: number;     // Unix timestamp
  endTime: number;       // Unix timestamp
  dataPath?: string;
  dataSourceType?: string;

  // TICKET_248 Phase 2: Multi-timeframe data feeds (legacy; prefer feedPlan)
  dataFeeds?: DataFeedConfig[];

  // TICKET_1225 P4: FeedPlan from the code generator (P3). Opaquely forwarded
  // from the renderer into the executor; the renderer never constructs or edits it.
  feedPlan?: FeedPlan;

  // Execution parameters
  initialCapital?: number;
  commission?: number;
  slippage?: number;
  allowShort?: boolean;

  // Order size
  orderSize?: number;
  orderSizeUnit?: OrderSizeUnit;

  // TICKET_1130: Total symbol count for equal-weight sizing (100% / symbolCount)
  symbolCount?: number;

  // TICKET_1130 Phase 2: scale position size by signal confidence [0,1]
  confidenceWeightedSizing?: boolean;

  // Strategy parameters
  strategyParams?: Record<string, unknown>;

  /** TICKET_398: Dry run mode for LLM call estimation */
  dryRun?: boolean;
}

// =============================================================================
// Executor Config (Main process layer)
// =============================================================================

/**
 * Full executor configuration
 * Used by: executor-service.ts
 */
export interface ExecutorConfig {
  pluginName?: 'cpp_backtest' | 'live' | string;
  // TICKET_690: All strategies are C++ only
  language?: 'cpp';
  // TICKET_352_5: Caller-generated task ID passed through from renderer
  taskId?: string;

  strategyPath: string;
  strategyName?: string;  // TICKET_163: User-provided name for backtest result
  frameworkPath: string;
  outputDir: string;
  compilerPath?: string;
  runnerPath?: string;
  cppIncludePaths?: string[];
  cppStrategyArtifactPath?: string;

  data: {
    symbol: string;
    interval: string;
    startTime: number;
    endTime: number;
    dataPath: string;
    dataSourceType: string;
  };

  // TICKET_248 Phase 2: Multi-timeframe data feeds (legacy; prefer feedPlan)
  dataFeeds?: DataFeedConfig[];

  // TICKET_1225 P4: FeedPlan from the code generator. Serialized into
  // config.json as the `feeds[]` array by executor-service.ts.
  feedPlan?: FeedPlan;

  execution: {
    initialCapital: number;
    commission: number;
    slippage: number;
    allowShort: boolean;
    maxPositionSize: number;
    orderSize?: number;
    orderSizeUnit?: OrderSizeUnit;
    // TICKET_1130: Total symbol count for equal-weight sizing
    symbolCount?: number;
    // TICKET_1130 Phase 2: scale position size by signal confidence
    confidenceWeightedSizing?: boolean;
  };

  strategy: {
    params: Record<string, unknown>;
  };
}

// =============================================================================
// Backtest Result Record (Database layer)
// =============================================================================

/**
 * Backtest result stored in database
 * Used by: backtest-result-service.ts, history queries
 */
export interface BacktestResultRecord {
  task_id: string;
  strategy_name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  final_capital: number;
  total_pnl: number | null;
  total_return: number | null;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  max_drawdown: number | null;
  win_rate: number | null;
  profit_factor: number | null;
  total_trades: number | null;
  winning_trades: number | null;
  losing_trades: number | null;
  trades_json: string | null;
  equity_curve_json: string | null;
  execution_time_ms: number | null;
  order_size: number | null;
  order_size_unit: string | null;
  created_at: string;
}

// =============================================================================
// Constants
// =============================================================================

const SECONDS_PER_DAY = 86400;

// =============================================================================
// Helper: Transform UI config to Executor request
// =============================================================================

/**
 * Transform BacktestDataConfig to BacktestExecutorRequest
 * Centralizes the transformation logic
 * TICKET_163: Added strategyName parameter
 */
export function toExecutorRequest(
  dataConfig: BacktestDataConfig,
  strategyPath: string,
  dataPath?: string,
  strategyName?: string
): BacktestExecutorRequest {
  return {
    strategyPath,
    strategyName,  // TICKET_163: Pass user-provided name
    symbol: dataConfig.symbol,
    interval: dataConfig.timeframe,
    startTime: Math.floor(new Date(dataConfig.startDate).getTime() / 1000),
    // TICKET_362: endDate means "include data through this entire day"
    // Convert to 23:59:59 UTC so C++ filterByTimeRangeOptimized includes all intraday bars
    endTime: Math.floor(new Date(dataConfig.endDate).getTime() / 1000) + SECONDS_PER_DAY - 1,
    dataPath,
    dataSourceType: 'parquet',
    initialCapital: dataConfig.initialCapital,
    orderSize: dataConfig.orderSize,
    orderSizeUnit: dataConfig.orderSizeUnit,
  };
}
