/**
 * TICKET_230: Executor Result Converter
 *
 * Converts stratforge-runner result JSON (snake_case wire format) to the
 * TypeScript camelCase ExecutorResult shape consumed by the UI.
 *
 * Naming note (TICKET_751_2): the wire-format JSON is produced by the C++
 * stratforge-runner (TICKET_681), not a Python process. Type/variable names
 * use "ExecutorRaw*" / "raw*" to reflect that.
 *
 * @see TICKET_230_RESULT_FIELD_NAME_CONVERSION.md
 */

import type { ExecutorResult, ExecutorMetrics, ExecutorTrade, EquityPoint } from '../components/ui';

/**
 * Raw result structure from stratforge-runner (snake_case JSON wire format).
 */
interface ExecutorRawResult {
  success?: boolean;
  error_message?: string;
  start_time?: number;
  end_time?: number;
  execution_time_ms?: number;
  metrics?: {
    total_pnl?: number;
    total_return?: number;
    sharpe_ratio?: number;
    max_drawdown?: number;
    total_trades?: number;
    winning_trades?: number;
    losing_trades?: number;
    win_rate?: number;
    profit_factor?: number;
  };
  equity_curve?: EquityPoint[];
  trades?: ExecutorRawTrade[];
}

interface ExecutorRawTrade {
  entry_time?: number;
  exit_time?: number;
  symbol?: string;
  side?: string;
  entry_price?: number;
  exit_price?: number;
  quantity?: number;
  pnl?: number;
  commission?: number;
  reason?: string;
}

/**
 * Convert snake_case metrics from stratforge-runner to TypeScript camelCase.
 */
function convertMetrics(rawMetrics?: ExecutorRawResult['metrics']): ExecutorMetrics {
  return {
    totalPnl: rawMetrics?.total_pnl ?? 0,
    totalReturn: rawMetrics?.total_return ?? 0,
    sharpeRatio: rawMetrics?.sharpe_ratio ?? 0,
    maxDrawdown: rawMetrics?.max_drawdown ?? 0,
    totalTrades: rawMetrics?.total_trades ?? 0,
    winningTrades: rawMetrics?.winning_trades ?? 0,
    losingTrades: rawMetrics?.losing_trades ?? 0,
    winRate: rawMetrics?.win_rate ?? 0,
    profitFactor: rawMetrics?.profit_factor ?? 0,
  };
}

/**
 * Convert a snake_case trade record from stratforge-runner to camelCase.
 */
function convertTrade(rawTrade: ExecutorRawTrade): ExecutorTrade {
  return {
    entryTime: rawTrade.entry_time ?? 0,
    exitTime: rawTrade.exit_time ?? 0,
    symbol: rawTrade.symbol ?? '',
    side: rawTrade.side ?? '',
    entryPrice: rawTrade.entry_price ?? 0,
    exitPrice: rawTrade.exit_price ?? 0,
    quantity: rawTrade.quantity ?? 0,
    pnl: rawTrade.pnl ?? 0,
    commission: rawTrade.commission ?? 0,
    reason: rawTrade.reason ?? '',
  };
}

/**
 * Convert the stratforge-runner raw result (snake_case JSON) to the TypeScript
 * camelCase ExecutorResult expected by the UI.
 *
 * @param rawResult - Raw result from stratforge-runner (snake_case fields).
 * @returns ExecutorResult with camelCase fields
 */
export function convertExecutorRawResultToExecutorResult(rawResult: unknown): ExecutorResult {
  const result = rawResult as ExecutorRawResult;

  return {
    success: result.success ?? false,
    errorMessage: result.error_message,
    startTime: result.start_time ?? 0,
    endTime: result.end_time ?? 0,
    executionTimeMs: result.execution_time_ms ?? 0,
    metrics: convertMetrics(result.metrics),
    equityCurve: result.equity_curve ?? [],
    trades: (result.trades ?? []).map(convertTrade),
    candles: [], // Candles come from incremental data, not final result
  };
}
