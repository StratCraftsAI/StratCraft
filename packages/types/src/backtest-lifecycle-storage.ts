/**
 * Authoritative storage contract for the persisted backtest lifecycle.
 *
 * Electron IPC and the standalone MCP server both inject their own
 * better-sqlite3 handle into these pure functions. Keeping the SQL and
 * not-found semantics here prevents the two user surfaces from drifting.
 */

export interface SqliteRunResult {
  changes: number;
}

export interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): SqliteRunResult;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
}

export interface CheckpointInfo {
  taskId: string;
  barIndex: number;
  totalBars: number;
  createdAt: string;
  progressPercent: number;
  intermediateResults?: {
    metrics?: Record<string, unknown>;
    trades?: unknown[];
    equityCurve?: unknown[];
  };
  dataValidation: 'valid' | 'file_missing';
}

interface CheckpointRow {
  task_id: string;
  bar_index: number;
  created_at: string;
  checkpoint_data: string;
}

function requireDeleted(changes: number, entity: string, id: string | number): number {
  if (changes === 0) {
    throw new Error(`${entity} ${id} not found`);
  }
  return changes;
}

export function listBacktestTaskHistory(db: SqliteDatabase, limit: number): unknown[] {
  return db.prepare(`
    SELECT task_id, strategy_name, status, error_message, created_at, finished_at
    FROM desktop_backtest_task_history
    WHERE status IN ('failed', 'cancelled')
    ORDER BY finished_at DESC
    LIMIT ?
  `).all(limit);
}

export function deleteBacktestTaskHistory(db: SqliteDatabase, taskId: string): number {
  const result = db.prepare(
    'DELETE FROM desktop_backtest_task_history WHERE task_id = ?',
  ).run(taskId);
  return requireDeleted(result.changes, 'Backtest task history', taskId);
}

export function deleteBacktestResult(db: SqliteDatabase, taskId: string): number {
  const result = db.prepare(
    'DELETE FROM desktop_backtest_results WHERE task_id = ?',
  ).run(taskId);
  return requireDeleted(result.changes, 'Backtest result', taskId);
}

export function listBacktestCheckpoints(db: SqliteDatabase): unknown[] {
  return db.prepare(`
    SELECT task_id, MAX(bar_index) AS bar_index, MAX(created_at) AS created_at
    FROM checkpoints
    GROUP BY task_id
    ORDER BY created_at DESC
  `).all();
}

export function getBacktestCheckpoint(
  db: SqliteDatabase,
  taskId: string,
  fileExists: (path: string) => boolean,
): CheckpointInfo {
  const row = db.prepare(`
    SELECT task_id, bar_index, created_at, checkpoint_data
    FROM checkpoints
    WHERE task_id = ?
    ORDER BY bar_index DESC
    LIMIT 1
  `).get(taskId) as CheckpointRow | undefined;
  if (!row) {
    throw new Error(`Backtest checkpoint ${taskId} not found`);
  }

  const checkpointData = JSON.parse(row.checkpoint_data) as {
    data_info?: {
      total_bars?: number;
      source_type?: string;
      parquet_path?: string;
    };
    intermediate_results?: CheckpointInfo['intermediateResults'];
  };
  const totalBars = checkpointData.data_info?.total_bars ?? 0;
  const parquetPath = checkpointData.data_info?.parquet_path;
  const dataValidation =
    checkpointData.data_info?.source_type === 'parquet' &&
    parquetPath &&
    !fileExists(parquetPath)
      ? 'file_missing'
      : 'valid';

  return {
    taskId: row.task_id,
    barIndex: row.bar_index,
    totalBars,
    createdAt: row.created_at,
    progressPercent: totalBars > 0
      ? Math.round((row.bar_index / totalBars) * 100)
      : 0,
    intermediateResults: checkpointData.intermediate_results,
    dataValidation,
  };
}

export function deleteBacktestCheckpoint(db: SqliteDatabase, taskId: string): number {
  const result = db.prepare('DELETE FROM checkpoints WHERE task_id = ?').run(taskId);
  const deleted = requireDeleted(result.changes, 'Backtest checkpoint', taskId);
  const resumeTable = db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'backtest_resume_config'
  `).get();
  if (resumeTable) {
    db.prepare('DELETE FROM backtest_resume_config WHERE task_id = ?').run(taskId);
  }
  return deleted;
}

export function getBacktestRun(db: SqliteDatabase, runId: number): unknown {
  const run = db.prepare('SELECT * FROM nona_backtest_run WHERE id = ?').get(runId);
  if (!run) {
    throw new Error(`Backtest run ${runId} not found`);
  }
  return {
    ...(run as Record<string, unknown>),
    books: db.prepare(
      'SELECT * FROM nona_backtest_book WHERE run_id = ? ORDER BY id ASC',
    ).all(runId),
    signals: db.prepare(
      'SELECT * FROM nona_backtest_run_signal WHERE run_id = ? ORDER BY id ASC',
    ).all(runId),
    combinator: db.prepare(
      'SELECT * FROM nona_backtest_run_combinator WHERE run_id = ?',
    ).get(runId) ?? null,
  };
}

export function deleteBacktestRun(db: SqliteDatabase, runId: number): number {
  const result = db.prepare('DELETE FROM nona_backtest_run WHERE id = ?').run(runId);
  return requireDeleted(result.changes, 'Backtest run', runId);
}
