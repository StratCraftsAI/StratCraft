/**
 * NonaSignalService - Service layer for the nona_signal table.
 *
 * TICKET_762 Step 2: dedicated table for batch-generated discovery signals.
 * The nona_signal schema mirrors nona_algorithms exactly, so this service
 * subclasses AlgorithmService and only overrides the bound table name via
 * the constructor. All insertAlgorithm name-dedup, audit-status,
 * signal-source filter, and coverage-summary logic is inherited unchanged.
 *
 * TICKET_783_3 Step B: a small dedicated read/write path for the
 * `cached_stats_json` column (added in migration v46). This is the *only*
 * nona_signal column whose semantics diverge from nona_algorithms -- it
 * carries the Bayesian prior the Alpha Factory combinator's aggregator
 * (TICKET_783_1/3) consumes. The column is opaque JSON; this service is the
 * single point that validates / parses / serialises it so the rest of the
 * codebase can treat it as a typed record.
 *
 * No business-logic divergence from AlgorithmService beyond the
 * cached_stats_json accessor is permitted in this ticket; broader
 * divergence is a follow-up per TICKET_762 Non-Goals.
 */

import { DatabaseManager } from '../db-manager';
import { AlgorithmService } from './algorithm-service';
import { dbLog } from '../../utils/logger';

// TICKET_783_3: JSON shape of nona_signal.cached_stats_json. Versioned so the
// shape can evolve without breaking older rows (the aggregator falls back to
// "no prior" if `schema_version` is unknown, matching the NULL-column path).
//
// `source` records who wrote the row: `discovery_round_3` is the path
// implemented in TICKET_783_3 Step C; other sources (cross-run learning,
// manual override) are out of scope.
export interface CachedStatsPayload {
  schema_version: 1;
  lifetime_sharpe: number;
  lifetime_n_trades: number;
  lifetime_n_bars: number;
  last_updated_at: string;
  source: 'discovery_round_3' | 'manual';
}

const CACHED_STATS_SCHEMA_VERSION = 1 as const;

export class NonaSignalService extends AlgorithmService {
  constructor(db: DatabaseManager) {
    super(db, 'nona_signal');
  }

  /**
   * TICKET_783_3: Read the parsed cached_stats payload for one signal.
   *
   * Returns null when the row does not exist, when the column is NULL
   * (no prior available), or when the stored JSON is unparseable / of an
   * unsupported schema version. Unparseable rows are logged but never
   * thrown: per the design doc, a corrupted prior degrades to "no prior"
   * gracefully, the same way NULL does.
   */
  getCachedStats(signalId: number): CachedStatsPayload | null {
    const stmt = this.db.prepare(
      `SELECT cached_stats_json FROM nona_signal WHERE id = ? AND deleted_at IS NULL`
    );
    const row = stmt.get(signalId) as { cached_stats_json: string | null } | undefined;
    if (!row || row.cached_stats_json === null || row.cached_stats_json === '') {
      return null;
    }
    try {
      const parsed = JSON.parse(row.cached_stats_json) as Partial<CachedStatsPayload>;
      if (parsed.schema_version !== CACHED_STATS_SCHEMA_VERSION) {
        dbLog.warn(
          `[NonaSignalService] cached_stats_json schema_version=${parsed.schema_version} ` +
            `unsupported for signal ${signalId}; treating as no-prior`
        );
        return null;
      }
      if (
        typeof parsed.lifetime_sharpe !== 'number' ||
        typeof parsed.lifetime_n_trades !== 'number' ||
        typeof parsed.lifetime_n_bars !== 'number' ||
        typeof parsed.last_updated_at !== 'string' ||
        (parsed.source !== 'discovery_round_3' && parsed.source !== 'manual')
      ) {
        dbLog.warn(
          `[NonaSignalService] cached_stats_json shape invalid for signal ${signalId}; ` +
            `treating as no-prior`
        );
        return null;
      }
      return {
        schema_version: CACHED_STATS_SCHEMA_VERSION,
        lifetime_sharpe: parsed.lifetime_sharpe,
        lifetime_n_trades: parsed.lifetime_n_trades,
        lifetime_n_bars: parsed.lifetime_n_bars,
        last_updated_at: parsed.last_updated_at,
        source: parsed.source,
      };
    } catch (err) {
      dbLog.warn(
        `[NonaSignalService] cached_stats_json parse failed for signal ${signalId}: ` +
          (err instanceof Error ? err.message : String(err))
      );
      return null;
    }
  }

  /**
   * TICKET_783_3: Write the cached_stats payload for one signal.
   *
   * Serialises with a fixed `schema_version` and the caller's payload.
   * Throws if the signal id does not exist (parent ticket: silent failures
   * mask data loss; the Discovery save path expects the row it just wrote
   * to be writable).
   */
  setCachedStats(signalId: number, payload: Omit<CachedStatsPayload, 'schema_version'>): void {
    const serialised = JSON.stringify({
      schema_version: CACHED_STATS_SCHEMA_VERSION,
      ...payload,
    });
    const stmt = this.db.prepare(
      `UPDATE nona_signal SET cached_stats_json = ? WHERE id = ? AND deleted_at IS NULL`
    );
    const result = stmt.run(serialised, signalId);
    if (result.changes === 0) {
      throw new Error(
        `NonaSignalService.setCachedStats: no nona_signal row with id=${signalId} (deleted or missing)`
      );
    }
  }

  /**
   * TICKET_783_3: Clear the cached_stats payload for one signal.
   *
   * The `nona_signal` row stays put -- only the prior is forgotten. Used
   * when a prior is invalidated (e.g. a future cross-run-learning refresh
   * that detects schema drift).
   */
  clearCachedStats(signalId: number): void {
    const stmt = this.db.prepare(
      `UPDATE nona_signal SET cached_stats_json = NULL WHERE id = ? AND deleted_at IS NULL`
    );
    stmt.run(signalId);
  }
}
