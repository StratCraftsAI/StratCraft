/**
 * Signal Source Service API
 *
 * TICKET_425: Unified Service API Layer
 * TICKET_612: Reads from normalized saved_strategies table
 *
 * Read operations for saved_strategies + saved_strategy_components tables.
 */

import { getDatabaseManager } from '../../database/db-manager';
import { ApiResponse } from './types';

export async function listSignalSources(limit: number = 50): Promise<ApiResponse<unknown[]>> {
  try {
    const db = getDatabaseManager();
    const rows = db.prepare(`
      SELECT ss.id, ss.name, ss.source_type,
             ss.backtest_sharpe, ss.backtest_max_drawdown, ss.backtest_win_rate,
             CASE WHEN xc.id IS NOT NULL THEN 1 ELSE 0 END AS has_exit
      FROM saved_strategies ss
      LEFT JOIN saved_strategy_components xc ON xc.strategy_id = ss.id AND xc.role = 'exit'
      WHERE ss.deleted_at IS NULL
      ORDER BY ss.id DESC
      LIMIT ?
    `).all(limit);
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
