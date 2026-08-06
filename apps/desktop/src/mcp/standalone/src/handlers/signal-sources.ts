/**
 * Signal source tool handlers.
 * Pure functions with injected DB dependency for testability.
 *
 * TICKET_612: Reads from normalized saved_strategies table.
 * TICKET_1276 P2 Batch A: Class-S storage read -- opens the same SQLite the
 * Electron main process does via the guarded shared open helper (`db.ts`). The
 * former Desktop bridge-first branch was deleted; the direct SQL from the
 * normalized tables is now the SOLE path. A DB/query error surfaces explicitly
 * (TICKET_858) -- never a silently smaller answer.
 */
import type Database from 'better-sqlite3';
import type { McpToolResult } from './tool-result';

export async function handleListSignalSources(db: Database.Database, params: { limit: number }): Promise<McpToolResult> {
  // Direct SQL (sole path) from normalized tables
  const rows = db.prepare(`
    SELECT ss.id, ss.name, ss.source_type,
           ss.backtest_sharpe, ss.backtest_max_drawdown, ss.backtest_win_rate,
           CASE WHEN xc.id IS NOT NULL THEN 1 ELSE 0 END AS has_exit
    FROM saved_strategies ss
    LEFT JOIN saved_strategy_components xc ON xc.strategy_id = ss.id AND xc.role = 'exit'
    ORDER BY ss.id DESC
    LIMIT ?
  `).all(params.limit);

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }],
  };
}
