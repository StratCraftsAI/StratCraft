/**
 * Electron-free owning core for Strategy Builder list / get / soft-delete and
 * the generation-persist orchestration (TICKET_1306_4, findings D4/D5/D6).
 *
 * Before this module, Electron reached `nona_algorithms` through the backend
 * REST API while the MCP surface issued its own `nona_algorithms` SQL, so no
 * shared owner enforced consistency and the MCP persist path skipped the
 * TICKET_761 post-insert validation/audit/compile pipeline. This module makes
 * the SQLite table the single owner for the core local operations on BOTH
 * surfaces (TICKET_435 / TICKET_638 -- core strategy CRUD works offline).
 *
 * Both Electron Main and the MCP standalone inject a connection to the same
 * SQLite database. The neutral `persistStrategy` orchestration takes the
 * validation / audit / compile pipeline as INJECTED dependencies: a runtime
 * that cannot construct them (the MCP process has no compile/audit runtime)
 * MUST fail before insertion rather than persist a row that skips the pipeline
 * (TICKET_860 -- no refuse/skip as a silent feature gap; AC6).
 */

import type { SqliteDatabase } from './strategy-persistence-store';

/**
 * A single strategy row as returned by `list_strategies`. The projected shape
 * is stable across surfaces so the IPC and MCP envelopes only adapt transport.
 */
export interface StrategyListRow {
  id: number;
  code: string;
  strategy_name: string | null;
  strategy_type: number;
  category: string | null;
  signal_source: string | null;
  record_type: string;
  create_time: string;
  update_time: string;
}

export interface ListStrategiesParams {
  limit: number;
  strategyType?: number;
  signalSourcePrefix?: string;
}

/**
 * The `get_strategy` detail projection. `null` when the id is unknown or the
 * row is soft-deleted (`deleted_at IS NULL` filter is owned here).
 */
export interface StrategyDetailRow {
  id: number;
  code: string;
  strategy_name: string | null;
  description: string | null;
  strategy_type: number;
  classification_metadata: string | null;
  strategy_rules: string | null;
  category: string | null;
  record_type: string;
  file_path: string | null;
  create_time: string;
  update_time: string;
  version: number;
}

/**
 * Discriminated soft-delete request. Single-id and filter modes are mutually
 * exclusive; the caller validates exclusivity and surfaces the appropriate
 * transport error before calling into the owner.
 */
export type SoftDeleteStrategyRequest =
  | { mode: 'id'; id: number }
  | { mode: 'filter'; strategyType?: number; signalSourcePrefix?: string };

export interface SoftDeleteStrategyResult {
  deletedCount: number;
  deletedIds: number[];
}

/**
 * Raised by `softDeleteStrategy` when a single-id delete cannot proceed. The
 * caller maps `reason` to the surface-appropriate validation envelope.
 */
export class SoftDeleteStrategyError extends Error {
  constructor(
    public readonly reason:
      | 'not_found'
      | 'already_deleted'
      | 'system_protected',
    message: string,
  ) {
    super(message);
    this.name = 'SoftDeleteStrategyError';
  }
}

// ---------------------------------------------------------------------------
// List / Get (D4)
// ---------------------------------------------------------------------------

export function listStrategies(
  db: SqliteDatabase,
  params: ListStrategiesParams,
): StrategyListRow[] {
  const conditions = ['deleted_at IS NULL'];
  const bindValues: unknown[] = [];
  if (params.strategyType !== undefined) {
    conditions.push('strategy_type = ?');
    bindValues.push(params.strategyType);
  }
  if (params.signalSourcePrefix !== undefined) {
    conditions.push("json_extract(classification_metadata, '$.signal_source') LIKE ? || '%'");
    bindValues.push(params.signalSourcePrefix);
  }
  return db.prepare(`
    SELECT id, code, strategy_name, strategy_type, category,
           json_extract(classification_metadata, '$.signal_source') AS signal_source,
           record_type, create_time, update_time
    FROM nona_algorithms
    WHERE ${conditions.join(' AND ')}
    ORDER BY create_time DESC
    LIMIT ?
  `).all(...bindValues, params.limit) as StrategyListRow[];
}

export function getStrategy(
  db: SqliteDatabase,
  id: number,
): StrategyDetailRow | null {
  // TICKET_762 A2: read via v_algorithms_all so ids in either nona_algorithms
  // or nona_signal resolve. The view already filters deleted_at IS NULL. Both
  // surfaces share this projection -- the MCP path previously queried
  // nona_algorithms directly and would 404 on a nona_signal id.
  const row = db.prepare(`
    SELECT id, code, strategy_name, description, strategy_type,
           classification_metadata, strategy_rules, category,
           record_type, file_path, create_time, update_time, version
    FROM v_algorithms_all
    WHERE id = ?
  `).get(id);
  return (row as StrategyDetailRow | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Soft-delete (D5) -- single owner for `deleted_at` transitions + filters
// ---------------------------------------------------------------------------

export function softDeleteStrategy(
  db: SqliteDatabase,
  request: SoftDeleteStrategyRequest,
): SoftDeleteStrategyResult {
  if (request.mode === 'id') {
    const row = db.prepare(
      'SELECT id, strategy_name, is_system, deleted_at FROM nona_algorithms WHERE id = ?',
    ).get(request.id) as
      | { id: number; strategy_name: string; is_system: number; deleted_at: string | null }
      | undefined;

    if (!row) {
      throw new SoftDeleteStrategyError(
        'not_found',
        `Strategy with id=${request.id} not found`,
      );
    }
    if (row.deleted_at !== null) {
      throw new SoftDeleteStrategyError(
        'already_deleted',
        `Strategy with id=${request.id} is already deleted.`,
      );
    }
    if (row.is_system === 1) {
      throw new SoftDeleteStrategyError(
        'system_protected',
        `Strategy with id=${request.id} is a system algorithm and cannot be deleted.`,
      );
    }

    db.prepare(
      "UPDATE nona_algorithms SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL AND is_system = 0",
    ).run(request.id);

    return { deletedCount: 1, deletedIds: [row.id] };
  }

  // Batch mode. RETURNING makes the mutation result authoritative: deleted_ids
  // are the rows this UPDATE actually changed, not a pre-update snapshot that
  // can drift under another SQLite writer.
  const conditions = ['deleted_at IS NULL', 'is_system = 0'];
  const bindValues: unknown[] = [];
  if (request.strategyType !== undefined) {
    conditions.push('strategy_type = ?');
    bindValues.push(request.strategyType);
  }
  if (request.signalSourcePrefix !== undefined) {
    conditions.push("json_extract(classification_metadata, '$.signal_source') LIKE ? || '%'");
    bindValues.push(request.signalSourcePrefix);
  }
  const deletedRows = db.prepare(`
    UPDATE nona_algorithms
    SET deleted_at = datetime('now')
    WHERE ${conditions.join(' AND ')}
    RETURNING id
  `).all(...bindValues) as Array<{ id: number }>;
  const ids = deletedRows.map((r) => r.id);
  return { deletedCount: ids.length, deletedIds: ids };
}

// ---------------------------------------------------------------------------
// Local-name collision policy (shared by the MCP regime-detector persist)
// ---------------------------------------------------------------------------

/**
 * Resolve a non-colliding `strategy_name` for a local (user_id='local')
 * strategy, mirroring the storage collision-suffix policy. Only live rows
 * (`deleted_at IS NULL`) collide.
 */
export function resolveLocalStrategyName(
  db: SqliteDatabase,
  requestedName: string,
): string {
  const exists = db.prepare(`
    SELECT 1
    FROM nona_algorithms
    WHERE strategy_name = ? AND user_id = 'local' AND deleted_at IS NULL
    LIMIT 1
  `);
  if (!exists.get(requestedName)) return requestedName;

  let suffix = 2;
  while (exists.get(`${requestedName}_v${suffix}`)) suffix += 1;
  return `${requestedName}_v${suffix}`;
}
