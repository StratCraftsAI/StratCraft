/**
 * Factor tool handlers.
 * Pure functions with injected DB dependency for testability.
 *
 * TICKET_1276 P2 Batch A: Class-S storage read -- opens the same SQLite the
 * Electron main process does via the guarded shared open helper (`db.ts`). The
 * former Desktop bridge-first branch was deleted; the direct `nona_factors` SQL
 * is now the SOLE path. A DB/query error surfaces explicitly (TICKET_858) --
 * never a silently smaller answer.
 */
import type Database from 'better-sqlite3';
import type { McpToolResult } from './tool-result';

export async function handleListFactors(db: Database.Database, params: { limit: number }): Promise<McpToolResult> {
  // Direct SQL (sole path)
  const rows = db.prepare(`
    SELECT id, factor_id, name, source, category, ic, sharpe, created_at
    FROM nona_factors
    ORDER BY created_at DESC
    LIMIT ?
  `).all(params.limit);

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }],
  };
}
