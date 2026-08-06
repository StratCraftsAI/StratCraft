/**
 * BacktestTaskHistoryService
 *
 * TICKET_371: Persist cancelled/failed backtest tasks across app restart.
 *
 * Stores terminal-state tasks (completed, failed, cancelled) so they
 * remain visible in the bottom bar after app restart.
 */

import { DatabaseManager } from '../db-manager';
import {
  deleteBacktestTaskHistory,
  listBacktestTaskHistory,
  type SqliteDatabase,
} from '@StratCraft/types';

export interface TaskHistoryRecord {
  task_id: string;
  strategy_name: string;
  status: 'completed' | 'failed' | 'cancelled';
  error_message: string | null;
  created_at: number;
  finished_at: number;
}

export class BacktestTaskHistoryService {
  constructor(private db: DatabaseManager) {}

  /**
   * Save a terminal-state task to history.
   * Uses INSERT OR REPLACE to handle re-runs with the same taskId.
   */
  saveTask(record: Omit<TaskHistoryRecord, 'finished_at'>): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO desktop_backtest_task_history
        (task_id, strategy_name, status, error_message, created_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.task_id,
      record.strategy_name,
      record.status,
      record.error_message,
      record.created_at,
      Date.now()
    );
  }

  /**
   * Load cancelled/failed tasks ordered by finished_at DESC.
   * Completed tasks are already restored via BacktestResultService + OpenTabsService.
   */
  getTerminalTasks(limit: number = 50): TaskHistoryRecord[] {
    return listBacktestTaskHistory(
      this.db as unknown as SqliteDatabase,
      limit,
    ) as TaskHistoryRecord[];
  }

  /**
   * Delete a single task history record.
   */
  deleteByTaskId(taskId: string): void {
    deleteBacktestTaskHistory(this.db as unknown as SqliteDatabase, taskId);
  }
}
