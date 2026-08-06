/**
 * Electron-free owning core for Strategy Builder persistence reads and
 * recycle-bin mutations.
 *
 * Both Electron Main and MCP inject a connection to the same SQLite database.
 * Keeping the SQL and mutation-result checks here prevents the IPC and MCP
 * surfaces from reconstructing the business contract independently.
 */

export interface SqliteRunResult {
  changes: number;
}

export interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): SqliteRunResult;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
}

export interface DeletedStrategyRecord {
  [key: string]: unknown;
  id: number;
  deleted_at: string;
}

export interface ListDeletedStrategiesOptions {
  limit?: number;
  offset?: number;
}

export type ParentKind = 'algorithm' | 'signal';

export interface AuditEntry {
  id: number;
  algorithm_id: number;
  signal_source: string;
  regime: string | null;
  llm_provider: string;
  llm_model: string;
  d1_completeness: number;
  d2_similarity: number;
  d3_indicator_fit: number;
  d4_code_quality: number;
  d5_robustness: number;
  overall_score: number;
  star_rating: number;
  audit_detail: string;
  code_hash: string;
  ast_fingerprint: string;
  create_time: string;
  parent_kind: ParentKind;
}

export interface AuditListFilters {
  signal_source?: string;
  llm_provider?: string;
  llm_model?: string;
  min_star?: number;
  max_star?: number;
  limit?: number;
}

const DEFAULT_AUDIT_LIMIT = 100;

export function listDeletedStrategies(
  db: SqliteDatabase,
  options: ListDeletedStrategiesOptions = {},
): DeletedStrategyRecord[] {
  let sql = `
    SELECT *
    FROM nona_algorithms
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `;
  const params: Record<string, unknown> = {};

  if (options.limit !== undefined) {
    sql += ' LIMIT @limit';
    params.limit = options.limit;
  }
  if (options.offset !== undefined) {
    sql += options.limit === undefined ? ' LIMIT -1' : '';
    sql += ' OFFSET @offset';
    params.offset = options.offset;
  }

  return db.prepare(sql).all(params) as DeletedStrategyRecord[];
}

export function restoreDeletedStrategy(db: SqliteDatabase, id: number): void {
  const result = db.prepare(
    'UPDATE nona_algorithms SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL',
  ).run(id);
  if (result.changes === 0) {
    throw new Error(`Record ${id} not found in nona_algorithms or not deleted`);
  }
}

export function purgeDeletedStrategy(db: SqliteDatabase, id: number): void {
  const result = db.prepare(
    'DELETE FROM nona_algorithms WHERE id = ? AND deleted_at IS NOT NULL',
  ).run(id);
  if (result.changes === 0) {
    throw new Error(`Record ${id} not found in nona_algorithms or not soft-deleted`);
  }
}

export function getAuditByAlgorithm(
  db: SqliteDatabase,
  algorithmId: number,
): AuditEntry | null {
  const row = db.prepare(`
    SELECT *
    FROM v_strategy_audit_all
    WHERE algorithm_id = ?
    ORDER BY create_time DESC
    LIMIT 1
  `).get(algorithmId);
  return (row as AuditEntry | undefined) ?? null;
}

export function listAuditEntries(
  db: SqliteDatabase,
  filters: AuditListFilters = {},
): AuditEntry[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.signal_source) {
    clauses.push('signal_source = @signal_source');
    params.signal_source = filters.signal_source;
  }
  if (filters.llm_provider) {
    clauses.push('llm_provider = @llm_provider');
    params.llm_provider = filters.llm_provider;
  }
  if (filters.llm_model) {
    clauses.push('llm_model = @llm_model');
    params.llm_model = filters.llm_model;
  }
  if (filters.min_star !== undefined) {
    clauses.push('star_rating >= @min_star');
    params.min_star = filters.min_star;
  }
  if (filters.max_star !== undefined) {
    clauses.push('star_rating <= @max_star');
    params.max_star = filters.max_star;
  }

  let sql = 'SELECT * FROM v_strategy_audit_all';
  if (clauses.length > 0) {
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }
  sql += ' ORDER BY create_time DESC LIMIT @limit';
  params.limit = filters.limit || DEFAULT_AUDIT_LIMIT;

  return db.prepare(sql).all(params) as AuditEntry[];
}
