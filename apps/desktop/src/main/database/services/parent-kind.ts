/**
 * ParentKind primitive (TICKET_762).
 *
 * Discriminator shared by the post-insert pipeline, AuditService, and the
 * upcoming compilation-service / read-resolver paths to pick between the
 * two algorithm-bearing tables introduced in TICKET_762:
 *
 *   'algorithm' -> nona_algorithms + strategy_audit + strategy_runs
 *   'signal'    -> nona_signal     + strategy_audit_signal + strategy_runs_signal
 *
 * Every algorithm-id-bearing call path that has to choose a table picks via
 * this single discriminator; no JSON sniffing, no `try-one-table-then-other`
 * fallbacks.
 */

import { DatabaseManager } from '../db-manager';

export type ParentKind = 'algorithm' | 'signal';

/**
 * TICKET_762 R1: resolve which parent table owns a given algorithm id.
 *
 * Used by write call sites that must pick a target table at runtime
 * (algorithm-compilation-service writeStatus / loadAlgorithm per R4, and
 * the algorithm:compile IPC handler). Pure-read call sites that just need
 * the row regardless of parent should prefer `FROM v_algorithms_all`
 * (defined in the same migration as the resolver) instead.
 *
 * Order matters: nona_algorithms is the older / larger pool and is checked
 * first to minimize SQLite work on the common case. Soft-deleted rows are
 * treated as absent.
 *
 * @returns 'algorithm' | 'signal' | null (id not found in either table)
 */
export function resolveParentKind(db: DatabaseManager, id: number): ParentKind | null {
  const inAlgo = db
    .prepare('SELECT 1 FROM nona_algorithms WHERE id = ? AND deleted_at IS NULL')
    .get(id);
  if (inAlgo) return 'algorithm';
  const inSignal = db
    .prepare('SELECT 1 FROM nona_signal WHERE id = ? AND deleted_at IS NULL')
    .get(id);
  if (inSignal) return 'signal';
  return null;
}
