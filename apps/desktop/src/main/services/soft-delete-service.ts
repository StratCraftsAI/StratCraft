/**
 * Soft-Delete Service
 *
 * TICKET_580_6: Soft-Delete / Recycle Bin (30-Day Retention)
 *
 * Two-phase singleton pattern (same as database-backup-service.ts).
 * Provides:
 * - Soft-delete (set deleted_at timestamp)
 * - Restore (clear deleted_at)
 * - List deleted records
 * - Purge (hard delete a soft-deleted record)
 * - Auto-purge (remove records older than RETENTION_DAYS)
 */

import { createLogger } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import type { DatabaseManager } from '../database/db-manager';
import {
  listDeletedStrategies,
  purgeDeletedStrategy,
  restoreDeletedStrategy,
} from '@StratCraft/strategy-persistence-store';

const softDeleteLog = createLogger('SOFT-DELETE');

// =============================================================================
// Constants
// =============================================================================

/** Tables that support soft-delete */
export const SOFT_DELETE_TABLES = [
  'nona_algorithms',
  'nona_signal',
  'saved_strategies',
  'nona_ai_conversations',
] as const;

export type SoftDeleteTable = (typeof SOFT_DELETE_TABLES)[number];

/** Number of days before auto-purge removes soft-deleted records */
export const RETENTION_DAYS = 30;

// =============================================================================
// SoftDeleteService
// =============================================================================

export class SoftDeleteService {
  constructor(private db: DatabaseManager) {}

  /**
   * Validate that the table supports soft-delete.
   */
  private validateTable(table: string): asserts table is SoftDeleteTable {
    if (!SOFT_DELETE_TABLES.includes(table as SoftDeleteTable)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.softDelete.tableNotSupported', { table, validTables: SOFT_DELETE_TABLES.join(', ') }));
    }
  }

  /**
   * Soft-delete a record by setting deleted_at to current timestamp.
   */
  softDelete(table: string, id: number | string): void {
    this.validateTable(table);

    const stmt = this.db.prepare(
      `UPDATE ${table} SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`
    );
    const info = stmt.run(id);

    if (info.changes === 0) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.softDelete.recordNotFoundOrDeleted', { id: String(id), table }));
    }

    softDeleteLog.info(`[SoftDeleteService] Soft-deleted record ${id} from ${table}`);
  }

  /**
   * Restore a soft-deleted record by clearing deleted_at.
   */
  restore(table: string, id: number | string): void {
    this.validateTable(table);

    if (table === 'nona_algorithms') {
      restoreDeletedStrategy(this.db, Number(id));
      softDeleteLog.info(`[SoftDeleteService] Restored record ${id} in ${table}`);
      return;
    }

    const stmt = this.db.prepare(
      `UPDATE ${table} SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`
    );
    const info = stmt.run(id);

    if (info.changes === 0) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.softDelete.recordNotFoundOrNotDeleted', { id: String(id), table }));
    }

    // For conversations, also restore status from 'deleted' to 'active'
    if (table === 'nona_ai_conversations') {
      this.db.prepare(
        `UPDATE nona_ai_conversations SET status = 'active' WHERE id = ? AND status = 'deleted'`
      ).run(id);
    }

    softDeleteLog.info(`[SoftDeleteService] Restored record ${id} in ${table}`);
  }

  /**
   * List soft-deleted records for a given table.
   */
  listDeleted(
    table: string,
    options?: { limit?: number; offset?: number }
  ): Record<string, unknown>[] {
    this.validateTable(table);

    if (table === 'nona_algorithms') {
      return listDeletedStrategies(this.db, options);
    }

    let query = `SELECT * FROM ${table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`;

    const params: Record<string, unknown> = {};

    if (options?.limit) {
      query += ` LIMIT @limit`;
      params.limit = options.limit;
    }

    if (options?.offset) {
      query += ` OFFSET @offset`;
      params.offset = options.offset;
    }

    const stmt = this.db.prepare(query);
    return stmt.all(params) as Record<string, unknown>[];
  }

  /**
   * Hard-delete a soft-deleted record (permanent removal).
   * Only works on records that are already soft-deleted.
   */
  purge(table: string, id: number | string): void {
    this.validateTable(table);

    if (table === 'nona_algorithms') {
      purgeDeletedStrategy(this.db, Number(id));
      softDeleteLog.info(`[SoftDeleteService] Purged record ${id} from ${table}`);
      return;
    }

    const stmt = this.db.prepare(
      `DELETE FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`
    );
    const info = stmt.run(id);

    if (info.changes === 0) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.softDelete.recordNotFoundOrNotSoftDeleted', { id: String(id), table }));
    }

    softDeleteLog.info(`[SoftDeleteService] Purged record ${id} from ${table}`);
  }

  /**
   * Auto-purge records that have been soft-deleted for longer than RETENTION_DAYS.
   * Called on app startup after migrations complete.
   * CASCADE will clean up child records (backtest_results, ai_messages, etc.).
   */
  autoPurge(): { purgedCounts: Record<string, number> } {
    const purgedCounts: Record<string, number> = {};

    for (const table of SOFT_DELETE_TABLES) {
      const stmt = this.db.prepare(
        `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-${RETENTION_DAYS} days')`
      );
      const info = stmt.run();
      purgedCounts[table] = info.changes;

      if (info.changes > 0) {
        softDeleteLog.info(
          `[SoftDeleteService] Auto-purged ${info.changes} record(s) from ${table} (older than ${RETENTION_DAYS} days)`
        );
      }
    }

    return { purgedCounts };
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: SoftDeleteService | null = null;

/**
 * Initialize the SoftDeleteService singleton.
 */
export function initializeSoftDeleteService(db: DatabaseManager): SoftDeleteService {
  if (instance) {
    softDeleteLog.warn('[SoftDeleteService] Already initialized, returning existing instance');
    return instance;
  }
  instance = new SoftDeleteService(db);
  return instance;
}

/**
 * Get the initialized SoftDeleteService singleton.
 */
export function getSoftDeleteService(): SoftDeleteService {
  if (!instance) {
    throw new Error('[SoftDeleteService] Not initialized. Call initializeSoftDeleteService() first.');
  }
  return instance;
}

/**
 * Reset singleton (for testing).
 */
export function resetSoftDeleteService(): void {
  instance = null;
}
