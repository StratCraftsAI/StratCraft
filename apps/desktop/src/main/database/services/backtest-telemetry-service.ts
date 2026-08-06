/**
 * BacktestTelemetryService
 *
 * TICKET_1010: Per-cockpit success/failure tracking for the Backend Guided Agent.
 * Separate from desktop_backtest_results (which only stores successful metrics).
 * This table records lifecycle events: started -> success | failed.
 */

import { DatabaseManager } from '../db-manager';

export type BuilderMode =
  | 'regimeDetector'
  | 'regimeEntry'
  | 'marketObserver'
  | 'traderEntry'
  | 'aiLibero'
  | 'strategyStudio'
  | 'exitStrategy'
  | 'catalogStrategy';

export type TelemetryStatus = 'started' | 'success' | 'failed';

export type FailureReason =
  | 'compilation_error'
  | 'data_error'
  | 'timeout'
  | 'runtime_crash'
  | 'user_cancel';

export interface TelemetryRecord {
  id: number;
  task_id: string;
  builder_mode: BuilderMode;
  status: TelemetryStatus;
  failure_reason: string | null;
  failure_detail: string | null;
  strategy_name: string;
  symbol: string | null;
  timeframe: string | null;
  execution_time_ms: number | null;
  created_at: string;
}

export interface BacktestsByMode {
  regimeDetector: { success: number; failed: number };
  regimeEntry: { success: number; failed: number };
  marketObserver: { success: number; failed: number };
  traderEntry: { success: number; failed: number };
  aiLibero: { success: number; failed: number };
  strategyStudio: { success: number; failed: number };
  exitStrategy: { success: number; failed: number };
  catalogStrategy: { success: number; failed: number };
}

const MAX_FAILURE_DETAIL_LENGTH = 500;

export function resolveBuilderMode(algo: { strategyType: number; signalSource: string | null }): BuilderMode {
  const { strategyType, signalSource } = algo;
  if (strategyType === 9 && signalSource?.startsWith('indicator_detector')) return 'regimeDetector';
  if (strategyType === 3 && signalSource?.startsWith('indicator_entry'))   return 'regimeEntry';
  if (strategyType === 7 && signalSource === 'watchlist')                  return 'marketObserver';
  if (strategyType === 1 && signalSource === 'llmtrader')                  return 'traderEntry';
  if (strategyType === 1 && signalSource === 'aiLibero')                   return 'aiLibero';
  if (strategyType === 1 && signalSource === 'aiStudio')                   return 'strategyStudio';
  if (strategyType === 6 && signalSource === 'risk_override')              return 'exitStrategy';
  if (strategyType === 1 && signalSource?.startsWith('strategy_catalog'))  return 'catalogStrategy';
  return 'strategyStudio';
}

export class BacktestTelemetryService {
  constructor(private db: DatabaseManager) {}

  recordStart(
    taskId: string,
    builderMode: BuilderMode,
    config: { strategyName: string; symbol?: string; timeframe?: string },
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO desktop_backtest_telemetry
        (task_id, builder_mode, status, strategy_name, symbol, timeframe)
      VALUES (?, ?, 'started', ?, ?, ?)
    `);
    stmt.run(taskId, builderMode, config.strategyName, config.symbol ?? null, config.timeframe ?? null);
  }

  recordSuccess(taskId: string, executionTimeMs: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO desktop_backtest_telemetry
        (task_id, builder_mode, status, strategy_name, symbol, timeframe, execution_time_ms)
      SELECT task_id, builder_mode, 'success', strategy_name, symbol, timeframe, ?
      FROM desktop_backtest_telemetry
      WHERE task_id = ? AND status = 'started'
      LIMIT 1
    `);
    stmt.run(executionTimeMs, taskId);
  }

  recordFailure(
    taskId: string,
    failureReason: FailureReason,
    failureDetail: string | null,
    executionTimeMs: number | null,
  ): void {
    const truncatedDetail = failureDetail
      ? failureDetail.slice(0, MAX_FAILURE_DETAIL_LENGTH)
      : null;

    const stmt = this.db.prepare(`
      INSERT INTO desktop_backtest_telemetry
        (task_id, builder_mode, status, failure_reason, failure_detail, strategy_name, symbol, timeframe, execution_time_ms)
      SELECT task_id, builder_mode, 'failed', ?, ?, strategy_name, symbol, timeframe, ?
      FROM desktop_backtest_telemetry
      WHERE task_id = ? AND status = 'started'
      LIMIT 1
    `);
    stmt.run(failureReason, truncatedDetail, executionTimeMs, taskId);
  }

  getByMode(): BacktestsByMode {
    const rows = this.db.prepare(`
      SELECT
        builder_mode,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
      FROM desktop_backtest_telemetry
      WHERE status IN ('success', 'failed')
      GROUP BY builder_mode
    `).all() as Array<{ builder_mode: string; success_count: number; failed_count: number }>;

    const result: BacktestsByMode = {
      regimeDetector:  { success: 0, failed: 0 },
      regimeEntry:     { success: 0, failed: 0 },
      marketObserver:  { success: 0, failed: 0 },
      traderEntry:     { success: 0, failed: 0 },
      aiLibero:        { success: 0, failed: 0 },
      strategyStudio:  { success: 0, failed: 0 },
      exitStrategy:    { success: 0, failed: 0 },
      catalogStrategy: { success: 0, failed: 0 },
    };

    for (const row of rows) {
      const mode = row.builder_mode as BuilderMode;
      if (mode in result) {
        result[mode] = { success: row.success_count, failed: row.failed_count };
      }
    }

    return result;
  }
}
