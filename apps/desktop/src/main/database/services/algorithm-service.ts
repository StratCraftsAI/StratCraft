/**
 * AlgorithmService - Service layer for nona_algorithms table operations
 *
 * Handles:
 * - Inserting LLM-generated algorithms
 * - Querying algorithms by ID, name, type
 * - Updating algorithm metadata
 *
 * Related: 
 * - TICKET_115: Algorithm Storage Implementation
 * - TICKET_117_1: Data Hub Pattern
 */

import { DatabaseManager } from '../db-manager';
import { EntityService } from './entity-service';

// ============================================================================
// Types
// ============================================================================

/**
 * Data required to insert a new algorithm into database
 */
export interface AlgorithmInsertData {
  code: string;
  strategy_name: string;
  strategy_type: number;
  classification_metadata: string; // JSON string
  strategy_rules?: string; // JSON string
  description?: string;
  file_path?: string;
  prompt_template?: string;
  user_id: string;
  category?: string;
  metadata?: string; // JSON string
  /**
   * TICKET_907_1_1: first-class signal bar interval on nona_signal.
   * Kept optional because nona_algorithms does not carry this column and
   * legacy nona_signal rows remain nullable.
   */
  bar_interval?: string | null;
  record_type?: string;
  is_system?: number;
  activate?: number;
  status?: number;
  pnl?: string;
  sync_status?: string;
  local_only?: number;
  version?: number;
  audit_status?: 'pending' | 'completed' | 'failed' | 'skipped';
  backend_validation_report?: string | null;
  /**
   * TICKET_196_7_6_4 D4 / TICKET_196_7_0_2 (migration v51): absolute path
   * to the v2 signal artifact directory for file-backed signal kinds
   * (currently `factor_talib_*` via FactorArtifactLoader). Persisted into
   * the `artifact_path` column on `nona_signal` / `nona_algorithms`.
   */
  artifact_path?: string;
  /**
   * TICKET_927_1_2_A: per-signal market-of-applicability JSON column on
   * `nona_signal` (added by migration v87 / TICKET_927_1_2). Canonical
   * shape is `MarketScope.toJson()` -- sorted, deduped JSON array of
   * MarketId strings. Set non-null on every new discovery write by
   * `persistSignal()`; nona_algorithms ignores it because the column is
   * nona_signal-only. Optional at the InsertData layer so non-signal
   * callers (e.g. legacy `nona_algorithms` writes) compile without
   * change.
   */
  market_scope?: string;
}

/**
 * Complete algorithm record from database
 */
export interface AlgorithmRecord {
  id: number;
  code: string;
  file_path: string | null;
  strategy_name: string | null;
  description: string | null;
  strategy_type: number;
  classification_metadata: string | null;
  record_type: string;
  category: string | null;
  metadata: string | null;
  bar_interval?: string | null;
  pnl: string;
  user_id: string | null;
  is_system: number;
  status: number;
  activate: number;
  create_time: string;
  update_time: string;
  sync_status: string;
  last_sync_time: string | null;
  local_only: number;
  strategy_rules: string | null;
  prompt_template: string | null;
  version: number;
  deleted_at: string | null;
  compile_status: 'pending' | 'success' | 'error' | null;
  compile_error: string | null;
  compile_hash: string | null;
  compile_artifact_path: string | null;
  compiled_at: number | null;
  audit_status: 'pending' | 'completed' | 'failed' | 'skipped' | null;
  backend_validation_report: string | null;
}

/**
 * TICKET_709: Return type for insertAlgorithm with auto-dedup
 * strategy_name may differ from input if a collision was resolved.
 */
export interface AlgorithmInsertResult {
  id: number;
  strategy_name: string;
}

/**
 * TICKET_437_2: L1 coverage summary row (GROUP BY regime, signal_source, indicator_combo)
 */
export interface CoverageSummaryRow {
  regime: string | null;
  signal_source: string | null;
  indicator_combo: string | null;
  variant_count: number;
}

/**
 * TICKET_437_2: L2 subset detail row (per-strategy fingerprint for focused dedup)
 */
export interface SubsetDetailRow {
  strategy_name: string | null;
  class_name: string | null;
  feature_fingerprint: string | null;
  trading_style: string | null;
}

// ============================================================================
// AlgorithmService
// ============================================================================

export class AlgorithmService extends EntityService<AlgorithmRecord> {
  /**
   * TICKET_762: tableName is parameterized so NonaSignalService can bind the
   * same logic to 'nona_signal'. Default 'nona_algorithms' preserves all
   * existing call sites.
   */
  constructor(db: DatabaseManager, tableName: string = 'nona_algorithms') {
    super(db, tableName);
  }

  private async generateUniqueName(baseName: string, userId: string): Promise<string> {
    let suffix = 2;
    let candidate = `${baseName}_v${suffix}`;
    while (await this.existsByName(candidate, userId)) {
      suffix++;
      candidate = `${baseName}_v${suffix}`;
    }
    return candidate;
  }

  /**
   * Insert a new algorithm into the database with automatic name dedup.
   * TICKET_709: Centralizes name collision resolution (existsByName + generateUniqueName)
   * so all callers get automatic dedup without duplicating logic.
   *
   * Returns { id, strategy_name } -- strategy_name may differ from input if renamed.
   */
  async insertAlgorithm(data: AlgorithmInsertData): Promise<AlgorithmInsertResult> {
    // TICKET_709: Auto-dedup -- resolve name collision before insert
    if (await this.existsByName(data.strategy_name, data.user_id)) {
      data.strategy_name = await this.generateUniqueName(data.strategy_name, data.user_id);
    }

    // TICKET_1028_1: If a soft-deleted row exists with the same name, undelete
    // and update it instead of inserting a duplicate. existsByName filters
    // deleted_at IS NULL so it misses soft-deleted rows; without this check the
    // INSERT hits the UNIQUE constraint on (strategy_name, user_id) when the
    // index does not yet carry the partial WHERE clause (migration v107).
    const tombstone = this.findSoftDeletedByName(data.strategy_name, data.user_id);
    if (tombstone) {
      const { id: existingId, ...updateFields } = { id: tombstone.id, ...data } as any;
      updateFields.deleted_at = null;
      updateFields.deleted_reason = null;
      updateFields.update_time = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await this.update(tombstone.id, updateFields);
      return { id: tombstone.id, strategy_name: data.strategy_name };
    }

    const id = await this.save(data as any);
    return { id: id as number, strategy_name: data.strategy_name };
  }

  /**
   * TICKET_1028_1: Find a soft-deleted row by (strategy_name, user_id).
   * Returns { id } if found, null otherwise. Used by insertAlgorithm to
   * undelete instead of inserting a duplicate.
   */
  private findSoftDeletedByName(
    strategyName: string,
    userId: string,
  ): { id: number } | null {
    const stmt = this.db.prepare(
      `SELECT id FROM ${this.tableName} WHERE strategy_name = @strategyName AND user_id = @userId AND deleted_at IS NOT NULL LIMIT 1`,
    );
    const row = stmt.get({ strategyName, userId }) as { id: number } | undefined;
    return row ?? null;
  }

  /**
   * Get algorithm by ID (Aliased for compatibility)
   */
  async getAlgorithmById(id: number): Promise<AlgorithmRecord | null> {
    return this.get(id);
  }

  /**
   * Update algorithm fields (Aliased for compatibility)
   */
  async updateAlgorithm(
    id: number,
    data: Partial<AlgorithmInsertData>,
    expectedVersion?: number,
  ): Promise<void> {
    return this.update(id, data as any, expectedVersion);
  }

  /**
   * TICKET_641_8: Update audit status for an algorithm
   */
  async updateAuditStatus(id: number, status: 'pending' | 'completed' | 'failed' | 'skipped'): Promise<void> {
    return this.update(id, { audit_status: status } as any);
  }

  /**
   * TICKET_650 Phase 4: Persist backend validation report JSON
   */
  async updateBackendValidationReport(id: number, report: string): Promise<void> {
    return this.update(id, { backend_validation_report: report } as any);
  }

  /**
   * TICKET_437: Check if a strategy name already exists for a given user
   */
  async existsByName(strategyName: string, userId: string): Promise<boolean> {
    const stmt = this.db.prepare(
      `SELECT 1 FROM ${this.tableName} WHERE strategy_name = @strategyName AND user_id = @userId AND deleted_at IS NULL LIMIT 1`
    );
    return !!stmt.get({ strategyName, userId });
  }

  /**
   * Get algorithms by user ID (Specific query logic)
   */
  async getAlgorithmsByUserId(
    userId?: string,
    options?: { strategy_type?: number; limit?: number; offset?: number }
  ): Promise<AlgorithmRecord[]> {
    const filters: Record<string, any> = {};
    if (options?.strategy_type !== undefined) {
      filters.strategy_type = options.strategy_type;
    }

    return this.find(filters, {
      limit: options?.limit,
      offset: options?.offset,
      orderBy: 'create_time DESC'
    });
  }

  /**
   * TICKET_210: Get algorithms by user ID with signal_source prefix filter
   * Filters by extracting signal_source from classification_metadata JSON
   */
  async getAlgorithmsBySignalSource(
    userId: string | undefined,
    options: {
      strategy_type?: number;
      signalSourcePrefix: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<AlgorithmRecord[]> {
    const { strategy_type, signalSourcePrefix, limit, offset } = options;

    let query = `
      SELECT * FROM ${this.tableName}
      WHERE deleted_at IS NULL
      AND json_extract(classification_metadata, '$.signal_source') LIKE @signalSourcePattern
    `;

    const params: Record<string, any> = {
      signalSourcePattern: `${signalSourcePrefix}%`,
    };

    if (strategy_type !== undefined) {
      query += ` AND strategy_type = @strategy_type`;
      params.strategy_type = strategy_type;
    }

    query += ` ORDER BY create_time DESC`;

    if (limit) {
      query += ` LIMIT @limit`;
      params.limit = limit;
    }

    if (offset) {
      query += ` OFFSET @offset`;
      params.offset = offset;
    }

    const stmt = this.db.prepare(query);
    return stmt.all(params) as AlgorithmRecord[];
  }

  /**
   * TICKET_437_2 L1: Get coverage summary grouped by regime, signal_source, indicator_combo
   */
  getCoverageSummary(_userId?: string): CoverageSummaryRow[] {
    const query = `
      SELECT
        json_extract(classification_metadata, '$.components.indicator.regime_type') AS regime,
        json_extract(classification_metadata, '$.signal_source') AS signal_source,
        json_extract(classification_metadata, '$.feature_fingerprint.indicator_combo') AS indicator_combo,
        COUNT(*) AS variant_count
      FROM ${this.tableName}
      WHERE deleted_at IS NULL
      GROUP BY regime, signal_source, indicator_combo
      ORDER BY variant_count DESC
    `;
    const stmt = this.db.prepare(query);
    return stmt.all() as CoverageSummaryRow[];
  }

  /**
   * TICKET_437_2 L2: Get per-strategy detail for a specific signal_source + regime subset
   */
  getSubsetDetail(
    _userId: string,
    signalSource: string,
    regime: string,
    limit = 30,
  ): SubsetDetailRow[] {
    const query = `
      SELECT
        strategy_name,
        json_extract(classification_metadata, '$.class_name') AS class_name,
        json_extract(classification_metadata, '$.feature_fingerprint') AS feature_fingerprint,
        json_extract(classification_metadata, '$.trading_style') AS trading_style
      FROM ${this.tableName}
      WHERE deleted_at IS NULL
        AND json_extract(classification_metadata, '$.signal_source') = @signalSource
        AND json_extract(classification_metadata, '$.components.indicator.regime_type') = @regime
      ORDER BY create_time DESC
      LIMIT @limit
    `;
    const stmt = this.db.prepare(query);
    return stmt.all({ signalSource, regime, limit }) as SubsetDetailRow[];
  }
}
