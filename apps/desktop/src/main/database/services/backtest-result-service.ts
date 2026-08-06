/**
 * BacktestResultService
 *
 * TICKET_153: Backtest Result Persistence
 *
 * CRUD operations for desktop_backtest_results table.
 * Stores V3 executor backtest results for history queries.
 */

import { DatabaseManager } from '../db-manager';
import { ExecutorConfig, ExecutorResult } from '../../services/executor-service';
import { basename } from 'path';

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
  candles_json: string | null;  // TICKET_360 GAP-2 (column exists but unused, candles re-fetched from parquet)
  data_path: string | null;     // TICKET_363: Parquet file path for candle re-fetch after restart
  execution_time_ms: number | null;
  order_size: number | null;
  order_size_unit: string | null;
  is_dry_run: number;           // TICKET_498: 1 for dry run, 0 for normal
  dry_run_info_json: string | null; // TICKET_498: JSON serialized dryRunInfo
  created_at: string;
}

export class BacktestResultService {
  constructor(private db: DatabaseManager) {}

  /**
   * Save backtest result to database
   * TICKET_163: Uses config.strategyName if provided, otherwise extracts from strategyPath
   */
  saveResult(taskId: string, config: ExecutorConfig, result: ExecutorResult): void {
    // TICKET_163: Prefer user-provided strategyName over filename extraction
    const strategyName = config.strategyName || basename(config.strategyPath, '.py');

    // TICKET_360_1: candles_json removed from INSERT (candles re-fetched from parquet cache)
    // TICKET_498: Added is_dry_run + dry_run_info_json columns
    const isDryRun = result.dryRunInfo?.isDryRun ? 1 : 0;
    const dryRunInfoJson = result.dryRunInfo ? JSON.stringify(result.dryRunInfo) : null;

    const stmt = this.db.prepare(`
      INSERT INTO desktop_backtest_results (
        task_id, strategy_name, symbol, timeframe, start_date, end_date,
        initial_capital, final_capital, total_pnl, total_return,
        sharpe_ratio, sortino_ratio, max_drawdown, win_rate, profit_factor,
        total_trades, winning_trades, losing_trades,
        trades_json, equity_curve_json, execution_time_ms,
        order_size, order_size_unit, data_path,
        is_dry_run, dry_run_info_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      taskId,
      strategyName,
      config.data.symbol,
      config.data.interval,
      new Date(config.data.startTime * 1000).toISOString(),
      new Date(config.data.endTime * 1000).toISOString(),
      config.execution.initialCapital,
      result.metrics.totalPnl + config.execution.initialCapital, // final_capital
      result.metrics.totalPnl,
      result.metrics.totalReturn,
      result.metrics.sharpeRatio,
      null, // sortino_ratio (not in current ExecutorResult)
      result.metrics.maxDrawdown,
      result.metrics.winRate,
      result.metrics.profitFactor,
      result.metrics.totalTrades,
      result.metrics.winningTrades,
      result.metrics.losingTrades,
      JSON.stringify(result.trades),
      JSON.stringify(result.equityCurve),
      result.executionTimeMs,
      config.execution.orderSize ?? null,
      config.execution.orderSizeUnit ?? null,
      // TICKET_363: Resolve dataPath from primary data or finest-granularity dataFeed
      config.data.dataPath || config.dataFeeds?.[0]?.dataPath || null,
      isDryRun,
      dryRunInfoJson
    );
  }

  /**
   * Get backtest history ordered by created_at DESC.
   * TICKET_498: Excludes dry run results by default.
   */
  getHistory(limit: number = 50, includeDryRun: boolean = false): BacktestResultRecord[] {
    const sql = includeDryRun
      ? 'SELECT * FROM desktop_backtest_results ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM desktop_backtest_results WHERE is_dry_run = 0 ORDER BY created_at DESC LIMIT ?';
    const stmt = this.db.prepare(sql);
    return stmt.all(limit) as BacktestResultRecord[];
  }

  /**
   * Get single result by task ID
   */
  getByTaskId(taskId: string): BacktestResultRecord | null {
    const stmt = this.db.prepare('SELECT * FROM desktop_backtest_results WHERE task_id = ?');
    return (stmt.get(taskId) as BacktestResultRecord) || null;
  }

  /**
   * Delete result by task ID
   */
  deleteByTaskId(taskId: string): void {
    const stmt = this.db.prepare('DELETE FROM desktop_backtest_results WHERE task_id = ?');
    stmt.run(taskId);
  }
}
