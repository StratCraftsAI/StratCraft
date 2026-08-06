/**
 * Backtest result tool handlers.
 * Pure functions with injected DB dependency for testability.
 *
 * TICKET_425: Bridge + fallback pattern.
 * TICKET_490: Added run_backtest and get_backtest_status handlers.
 * Tries Service API bridge first, falls back to direct SQL.
 */
import type Database from 'better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { McpToolResult } from './tool-result';
import { discoverServiceApi } from '../bridge/discovery';
import * as apiClient from '../bridge/api-client';
import { describeT } from '../i18n.js';
import { electronNotRunning } from './electron-guard';
import { resolveDbPath } from '../db';
import {
  deleteBacktestCheckpoint,
  deleteBacktestResult,
  deleteBacktestRun,
  deleteBacktestTaskHistory,
  getBacktestCheckpoint,
  getBacktestRun,
  listBacktestCheckpoints,
  listBacktestTaskHistory,
} from '@StratCraft/types';

function jsonResult(value: unknown): McpToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

function checkpointDbPath(): string {
  return path.join(path.dirname(resolveDbPath()), 'checkpoints.db');
}

function discoverBacktestServiceApi() {
  return discoverServiceApi();
}

function withCheckpointDb<T>(
  writable: boolean,
  operation: (db: Database.Database) => T,
): T {
  const dbPath = checkpointDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error('Backtest checkpoint store not found');
  }
  const db = new BetterSqlite3(dbPath, { readonly: !writable });
  try {
    return operation(db);
  } finally {
    db.close();
  }
}

export async function handleListBacktestResults(db: Database.Database, params: { limit: number }): Promise<McpToolResult> {
  // TICKET_1276 P2 Batch A: Class-S storage read (sole path). Opens the same
  // `desktop_backtest_results` SQLite the Electron main process does via the
  // guarded shared open helper (`db.ts`); the former bridge-first branch is
  // gone. A DB/query error surfaces explicitly (TICKET_858).
  // TICKET_498: Exclude dry run results from listing
  const rows = db.prepare(`
    SELECT task_id, strategy_name, symbol, timeframe,
           start_date, end_date, initial_capital, final_capital,
           total_pnl, total_return, sharpe_ratio, max_drawdown,
           win_rate, profit_factor, total_trades,
           winning_trades, losing_trades, execution_time_ms, created_at
    FROM desktop_backtest_results
    WHERE is_dry_run = 0 OR is_dry_run IS NULL
    ORDER BY created_at DESC
    LIMIT ?
  `).all(params.limit);

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }],
  };
}

export async function handleGetBacktestResult(db: Database.Database, params: { task_id: string }): Promise<McpToolResult> {
  // TICKET_1276 P2 Batch A: Class-S storage read (sole path). Direct
  // `desktop_backtest_results` SQL via the guarded shared open helper (`db.ts`);
  // the former bridge-first branch is gone. Not-found surfaces as an explicit
  // error (TICKET_858), never a silently empty answer.
  const row = db.prepare(`
    SELECT * FROM desktop_backtest_results WHERE task_id = ?
  `).get(params.task_id);

  if (!row) {
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.resultNotFound', 'Backtest result with task_id=%s not found').replace('%s', params.task_id) }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(row, null, 2) }],
  };
}

/**
 * TICKET_490: Run a backtest on a stored algorithm.
 * Bridge-only (no SQL fallback -- execution requires Electron running).
 */
export async function handleRunBacktest(
  _db: Database.Database,
  params: {
    algorithm_id: number;
    symbol?: string;
    interval?: string;
    start_date?: string;
    end_date?: string;
    initial_capital?: number;
    commission?: number;
    slippage?: number;
    allow_short?: boolean;
    data_source?: string;
    dry_run?: boolean;
  },
): Promise<McpToolResult> {
  const config = discoverBacktestServiceApi();
  if (!config) return electronNotRunning('run_backtest');

  try {
    const response = await apiClient.runBacktest(config, params);
    if (response.success && response.data) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.executionFailed', 'Backtest execution failed: %s').replace('%s', response.error || describeT('handlers.strategies.unknownError', 'Unknown error')) }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.executionError', 'Backtest execution error: %s').replace('%s', error instanceof Error ? error.message : String(error)) }],
      isError: true,
    };
  }
}

/**
 * TICKET_1010: Get per-cockpit backtest telemetry (success/failure counts).
 * Direct SQL only (telemetry is local DB, no bridge needed).
 */
export async function handleGetBacktestTelemetryByMode(db: Database.Database): Promise<McpToolResult> {
  const ALL_MODES = [
    'regimeDetector', 'regimeEntry', 'marketObserver', 'traderEntry',
    'aiLibero', 'strategyStudio', 'exitStrategy', 'catalogStrategy',
  ];

  try {
    const rows = db.prepare(`
      SELECT
        builder_mode,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
      FROM desktop_backtest_telemetry
      WHERE status IN ('success', 'failed')
      GROUP BY builder_mode
    `).all() as Array<{ builder_mode: string; success_count: number; failed_count: number }>;

    const result: Record<string, { success: number; failed: number }> = {};
    for (const mode of ALL_MODES) {
      result[mode] = { success: 0, failed: 0 };
    }
    for (const row of rows) {
      if (row.builder_mode in result) {
        result[row.builder_mode] = { success: row.success_count, failed: row.failed_count };
      }
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.telemetryError', 'Telemetry query error: %s').replace('%s', error instanceof Error ? error.message : String(error)) }],
      isError: true,
    };
  }
}

/**
 * TICKET_490 + TICKET_1235_4 F4: Get backtest task status.
 * Bridge-only (status requires Electron running).
 * F4: unified status contract -- the bridge handler already reconciles
 * executor-queue and DB sources into a single response.
 */
export async function handleGetBacktestStatus(
  _db: Database.Database,
  params: { task_id: string },
): Promise<McpToolResult> {
  const config = discoverBacktestServiceApi();
  if (!config) return electronNotRunning('get_backtest_status');

  try {
    const response = await apiClient.getBacktestStatus(config, params.task_id);
    if (response.success && response.data) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.statusFailed', 'Backtest status query failed: %s').replace('%s', response.error || describeT('handlers.strategies.unknownError', 'Unknown error')) }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.statusError', 'Backtest status error: %s').replace('%s', error instanceof Error ? error.message : String(error)) }],
      isError: true,
    };
  }
}

/**
 * TICKET_1235_4 F1: Cancel a backtest task.
 * Bridge-only (cancel requires Electron running).
 * Idempotent: cancelling a finished task returns its terminal state.
 */
export async function handleCancelBacktest(
  _db: Database.Database,
  params: { task_id: string },
): Promise<McpToolResult> {
  const config = discoverBacktestServiceApi();
  if (!config) return electronNotRunning('cancel_backtest');

  try {
    const response = await apiClient.cancelBacktest(config, params.task_id);
    if (response.success && response.data) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.cancelFailed', 'Backtest cancel failed: %s').replace('%s', response.error || describeT('handlers.strategies.unknownError', 'Unknown error')) }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.cancelError', 'Backtest cancel error: %s').replace('%s', error instanceof Error ? error.message : String(error)) }],
      isError: true,
    };
  }
}

/**
 * TICKET_1235_4 F2: Get backtest queue status.
 * Bridge-only (queue state requires Electron running).
 */
export async function handleGetBacktestQueue(
  _db: Database.Database,
): Promise<McpToolResult> {
  const config = discoverBacktestServiceApi();
  if (!config) return electronNotRunning('get_backtest_queue');

  try {
    const response = await apiClient.getBacktestQueue(config);
    if (response.success && response.data) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.queueFailed', 'Backtest queue query failed: %s').replace('%s', response.error || describeT('handlers.strategies.unknownError', 'Unknown error')) }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.queueError', 'Backtest queue error: %s').replace('%s', error instanceof Error ? error.message : String(error)) }],
      isError: true,
    };
  }
}

/**
 * TICKET_1235_4 F3: Cancel all backtest tasks.
 * Bridge-only (cancel requires Electron running).
 * Destructive: cancels all sessions' work.
 */
export async function handleCancelAllBacktests(
  _db: Database.Database,
  params: { confirm: boolean },
): Promise<McpToolResult> {
  if (!params.confirm) {
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.cancelAllRequiresConfirm', 'cancel_all_backtests requires confirm=true. This is a destructive operation that cancels ALL queued and running backtests.') }],
      isError: true,
    };
  }

  const config = discoverBacktestServiceApi();
  if (!config) return electronNotRunning('cancel_all_backtests');

  try {
    const response = await apiClient.cancelAllBacktests(config);
    if (response.success && response.data) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.cancelAllFailed', 'Cancel all backtests failed: %s').replace('%s', response.error || describeT('handlers.strategies.unknownError', 'Unknown error')) }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.backtests.cancelAllError', 'Cancel all backtests error: %s').replace('%s', error instanceof Error ? error.message : String(error)) }],
      isError: true,
    };
  }
}

export async function handleGetBacktestPhase(
  _db: Database.Database,
  params: { task_id: string },
): Promise<McpToolResult> {
  const config = discoverBacktestServiceApi();
  if (!config) return electronNotRunning('get_backtest_phase');
  try {
    const response = await apiClient.getBacktestPhase(config, params.task_id);
    return response.success && response.data
      ? jsonResult(response.data)
      : errorResult(response.error || `Backtest task ${params.task_id} not found`);
  } catch (error) {
    return errorResult(`Backtest phase query error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleGetBacktestTaskHistory(
  db: Database.Database,
  params: { limit: number },
): Promise<McpToolResult> {
  try {
    return jsonResult(listBacktestTaskHistory(db, params.limit));
  } catch (error) {
    return errorResult(`Backtest task history query error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleDeleteBacktestResult(
  db: Database.Database,
  params: { task_id: string; confirm: boolean },
): Promise<McpToolResult> {
  if (!params.confirm) return errorResult('delete_backtest_result requires confirm=true');
  try {
    return jsonResult({ taskId: params.task_id, deleted: deleteBacktestResult(db, params.task_id) });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

export async function handleDeleteBacktestTaskHistory(
  db: Database.Database,
  params: { task_id: string; confirm: boolean },
): Promise<McpToolResult> {
  if (!params.confirm) return errorResult('delete_backtest_task_history requires confirm=true');
  try {
    return jsonResult({ taskId: params.task_id, deleted: deleteBacktestTaskHistory(db, params.task_id) });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

export async function handleListCheckpoints(
  _db: Database.Database,
): Promise<McpToolResult> {
  const dbPath = checkpointDbPath();
  if (!fs.existsSync(dbPath)) return jsonResult([]);
  try {
    return jsonResult(withCheckpointDb(false, listBacktestCheckpoints));
  } catch (error) {
    return errorResult(`Checkpoint list error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleGetCheckpoint(
  _db: Database.Database,
  params: { task_id: string },
): Promise<McpToolResult> {
  try {
    return jsonResult(withCheckpointDb(
      false,
      (db) => getBacktestCheckpoint(db, params.task_id, fs.existsSync),
    ));
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

export async function handleResumeBacktest(
  _db: Database.Database,
  params: { task_id: string },
): Promise<McpToolResult> {
  const config = discoverBacktestServiceApi();
  if (!config) return electronNotRunning('resume_backtest');
  try {
    const response = await apiClient.resumeBacktest(config, params.task_id);
    return response.success && response.data
      ? jsonResult(response.data)
      : errorResult(response.error || `Backtest checkpoint ${params.task_id} could not be resumed`);
  } catch (error) {
    return errorResult(`Backtest resume error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleDeleteCheckpoint(
  _db: Database.Database,
  params: { task_id: string; confirm: boolean },
): Promise<McpToolResult> {
  if (!params.confirm) return errorResult('delete_checkpoint requires confirm=true');
  try {
    return jsonResult({
      taskId: params.task_id,
      deleted: withCheckpointDb(
        true,
        (db) => deleteBacktestCheckpoint(db, params.task_id),
      ),
    });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

export async function handleGetBacktestCandles(
  _db: Database.Database,
  params: { task_id: string },
): Promise<McpToolResult> {
  const config = discoverBacktestServiceApi();
  if (!config) return electronNotRunning('get_backtest_candles');
  try {
    const response = await apiClient.getBacktestCandles(config, params.task_id);
    return response.success && response.data
      ? jsonResult(response.data)
      : errorResult(response.error || 'Backtest candle query failed');
  } catch (error) {
    return errorResult(`Backtest candle query error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleGetBacktestRun(
  db: Database.Database,
  params: { run_id: number },
): Promise<McpToolResult> {
  try {
    return jsonResult(getBacktestRun(db, params.run_id));
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

export async function handleDeleteBacktestRun(
  db: Database.Database,
  params: { run_id: number; confirm: boolean },
): Promise<McpToolResult> {
  if (!params.confirm) return errorResult('delete_backtest_run requires confirm=true');
  try {
    return jsonResult({ runId: params.run_id, deleted: deleteBacktestRun(db, params.run_id) });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
