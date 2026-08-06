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
import type {
  AlgorithmInsertData,
  AlgorithmRecord,
} from '../../../shared/types/algorithm';

// ============================================================================
// Types
// ============================================================================

/**
 * The nona_algorithms row shapes live in `shared/types/algorithm.ts` -- they are
 * cross-process data contracts consumed by the shared Hub entity map and by
 * plugin renderers through the `@shared/*` alias. Declaring them here and
 * re-exporting from shared created a `shared -> main` dependency that dragged
 * the entire Electron main-process graph into every plugin typecheck.
 * Re-exported so existing main-side importers keep their path.
 */
export type {
  AlgorithmInsertData,
  AlgorithmRecord,
} from '../../../shared/types/algorithm';

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
