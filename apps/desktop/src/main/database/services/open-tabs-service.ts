/**
 * OpenTabsService
 *
 * TICKET_360 GAP-3: Persist open result tabs across app restart.
 *
 * Stores which backtest result tabs are open and which is active.
 * On app launch, renderer restores tabs from this table, loading
 * result data on-demand via Cache-Aside (TICKET_359).
 */

import { DatabaseManager } from '../db-manager';

export interface OpenTabRecord {
  task_id: string;
  strategy_name: string;
  is_active: number;  // 0 or 1 (SQLite boolean)
  last_accessed_at: number;
}

export class OpenTabsService {
  constructor(private db: DatabaseManager) {}

  /**
   * Save current open tabs state (replaces all previous entries).
   */
  saveOpenTabs(tabs: { taskId: string; strategyName: string; isActive: boolean; lastAccessedAt: number }[]): void {
    const deleteStmt = this.db.prepare('DELETE FROM desktop_open_tabs');
    const insertStmt = this.db.prepare(
      'INSERT INTO desktop_open_tabs (task_id, strategy_name, is_active, last_accessed_at) VALUES (?, ?, ?, ?)'
    );
    const existsStmt = this.db.prepare(
      'SELECT 1 FROM desktop_backtest_results WHERE task_id = ?'
    );

    const transaction = this.db.transaction(() => {
      deleteStmt.run();
      for (const tab of tabs) {
        if (existsStmt.get(tab.taskId)) {
          insertStmt.run(tab.taskId, tab.strategyName, tab.isActive ? 1 : 0, tab.lastAccessedAt);
        }
      }
    });

    transaction();
  }

  /**
   * Load all open tabs ordered by last_accessed_at.
   */
  getOpenTabs(): OpenTabRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM desktop_open_tabs ORDER BY last_accessed_at ASC'
    );
    return stmt.all() as OpenTabRecord[];
  }

  /**
   * Clear all open tabs (e.g., on explicit user action).
   */
  clearOpenTabs(): void {
    this.db.prepare('DELETE FROM desktop_open_tabs').run();
  }
}
