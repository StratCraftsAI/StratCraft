/**
 * AuditService - Service layer for strategy audit tables.
 *
 * TICKET_546: Strategy Audit Scoring System
 * TICKET_762 Phase B (B2/B3): inserts dispatch between `strategy_audit`
 * (parent_kind='algorithm') and `strategy_audit_signal` (parent_kind='signal').
 * Reads use the union view `v_strategy_audit_all`. D2 similarity dedup
 * intentionally spans both pools (copying a Builder algorithm's hash into a
 * discovery signal should still flag as similar).
 *
 * Handles:
 * - Inserting audit records after strategy generation
 * - Querying audit by algorithm_id
 * - Listing audits with filters (model, star_rating, signal_source)
 * - Retrieving existing hashes for D2 similarity comparison
 */

import { DatabaseManager } from '../db-manager';
import { dbLog } from '../../utils/logger';
import type { ParentKind } from './parent-kind';
import {
  getAuditByAlgorithm,
  listAuditEntries,
} from '@StratCraft/strategy-persistence-store';

// ============================================================================
// Types
// ============================================================================

export interface AuditInsertData {
  /** TICKET_762: discriminates target table (strategy_audit vs strategy_audit_signal). */
  parent_kind: ParentKind;
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
  audit_detail: string; // JSON string
  code_hash: string;
  ast_fingerprint: string;
}

export interface AuditRecord {
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
  /** TICKET_762: read-side discriminator surfaced by v_strategy_audit_all. */
  parent_kind: ParentKind;
}

export interface ExistingHash {
  code_hash: string;
  ast_fingerprint: string;
  indicators: string[];
}

// ============================================================================
// Service
// ============================================================================

export class AuditService {
  constructor(private db: DatabaseManager) {}

  /**
   * Insert a new audit record into the parent-appropriate table.
   *
   * TICKET_762 (B2): `data.parent_kind` selects the target table:
   *   'algorithm' -> strategy_audit (FK -> nona_algorithms.id ON DELETE CASCADE)
   *   'signal'    -> strategy_audit_signal (FK -> nona_signal.id ON DELETE CASCADE)
   *
   * Table membership is the discriminator -- `parent_kind` is NOT a column on
   * either base table (it only appears on the read-side view). It is stripped
   * from the bound parameters before SQL execution.
   */
  insertAudit(data: AuditInsertData): number {
    const { parent_kind, ...row } = data;
    const tableName = parent_kind === 'signal' ? 'strategy_audit_signal' : 'strategy_audit';
    try {
      const stmt = this.db.prepare(`
        INSERT INTO ${tableName} (
          algorithm_id, signal_source, regime, llm_provider, llm_model,
          d1_completeness, d2_similarity, d3_indicator_fit, d4_code_quality, d5_robustness,
          overall_score, star_rating, audit_detail, code_hash, ast_fingerprint
        ) VALUES (
          @algorithm_id, @signal_source, @regime, @llm_provider, @llm_model,
          @d1_completeness, @d2_similarity, @d3_indicator_fit, @d4_code_quality, @d5_robustness,
          @overall_score, @star_rating, @audit_detail, @code_hash, @ast_fingerprint
        )
      `);
      const info = stmt.run(row);
      const id = typeof info.lastInsertRowid === 'bigint'
        ? Number(info.lastInsertRowid)
        : info.lastInsertRowid;
      dbLog.info(
        `[AuditService] Inserted audit id=${id} into ${tableName} ` +
        `for algorithm_id=${data.algorithm_id}, star_rating=${data.star_rating}`,
      );
      return id as number;
    } catch (error) {
      dbLog.error(`[AuditService] insertAudit (${tableName}) failed:`, error);
      throw error;
    }
  }

  /**
   * Get audit record by algorithm_id.
   *
   * TICKET_762 (B3): reads via `v_strategy_audit_all` so callers do not need to
   * know which parent table owns the row. `algorithm_id` is per-parent unique
   * (the two pools have disjoint id spaces by construction), so no parent_kind
   * filter is required.
   */
  getByAlgorithmId(algorithmId: number): AuditRecord | null {
    try {
      return getAuditByAlgorithm(this.db, algorithmId) as AuditRecord | null;
    } catch (error) {
      dbLog.error(`[AuditService] getByAlgorithmId failed for id ${algorithmId}:`, error);
      throw error;
    }
  }

  /**
   * List audit records with optional filters.
   */
  listAudits(filters: {
    signal_source?: string;
    llm_provider?: string;
    llm_model?: string;
    min_star?: number;
    max_star?: number;
    limit?: number;
  } = {}): AuditRecord[] {
    try {
      return listAuditEntries(this.db, filters) as AuditRecord[];
    } catch (error) {
      dbLog.error('[AuditService] listAudits failed:', error);
      throw error;
    }
  }

  /**
   * Get existing hashes for D2 similarity comparison.
   * Returns code_hash, ast_fingerprint, and detected indicators for algorithms
   * matching the given signal_source.
   *
   * TICKET_762 (B3): reads via `v_strategy_audit_all` so D2 dedup spans BOTH
   * pools (algorithm + signal). Cross-pool dedup is intentional -- copying a
   * Builder algorithm's hash into a discovery signal should still flag as
   * similar.
   */
  getExistingHashes(signalSource: string, limit: number = 200): ExistingHash[] {
    try {
      const stmt = this.db.prepare(`
        SELECT code_hash, ast_fingerprint, audit_detail
        FROM v_strategy_audit_all
        WHERE signal_source = ?
        ORDER BY create_time DESC
        LIMIT ?
      `);
      const rows = stmt.all(signalSource, limit) as Array<{
        code_hash: string;
        ast_fingerprint: string;
        audit_detail: string;
      }>;

      return rows.map((row) => {
        let indicators: string[] = [];
        try {
          const detail = JSON.parse(row.audit_detail);
          indicators = detail.indicators_detected || [];
        } catch {
          // Ignore JSON parse errors
        }
        return {
          code_hash: row.code_hash,
          ast_fingerprint: row.ast_fingerprint,
          indicators,
        };
      });
    } catch (error) {
      dbLog.error('[AuditService] getExistingHashes failed:', error);
      throw error;
    }
  }

}
