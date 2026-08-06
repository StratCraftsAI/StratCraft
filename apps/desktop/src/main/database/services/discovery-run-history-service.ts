/**
 * DiscoveryRunHistoryService
 *
 * TICKET_741 / TICKET_767: persist Signal Discovery run history across app
 * restarts. Mirrors the in-memory DiscoveryRunEntry on
 * useSignalDiscoveryStore.ts.
 *
 * Snapshot handling (option (b) per TICKET_741 reopen note):
 * - `snapshot_json` holds JSON.stringify(DiscoveryRunSnapshot)
 * - serialization failures fall back to NULL; the row is still inserted
 * - on read, JSON.parse failures fall back to snapshot=undefined; the row
 *   is still returned (metadata-only render)
 *
 * Pattern: BacktestResultService (same constructor / prepare-run-all style).
 */

import { DatabaseManager } from '../db-manager';
import { dbLog } from '../../utils/logger';

export interface DiscoveryRunHistoryRecord {
  id: string;
  timestamp: number;
  status: string;
  saturation_level: string;
  signal_count: number;
  signal_name: string | null;
  config_signal_layer: string;
  config_categories_json: string | null;
  config_hypotheses_count: number;
  config_batch_size: number;
  snapshot_json: string | null;
  created_at: string;
  run_number: number | null;
}

export interface DiscoveryRunHistoryUpdate {
  status?: string;
  signal_name?: string | null;
  signal_count?: number;
  saturation_level?: string;
  snapshot_json?: string | null;
}

export class DiscoveryRunHistoryService {
  constructor(private db: DatabaseManager) {}

  /**
   * Insert or replace a run history row. Called on every terminal transition
   * (completed / error / cancelled) and on initial running-state insert.
   *
   * TICKET_912 Phase 2: auto-assigns `run_number = MAX(run_number) + 1`
   * on first insert. Subsequent updates (INSERT OR REPLACE on the same id)
   * preserve the existing run_number via COALESCE.
   */
  saveRun(entry: Omit<DiscoveryRunHistoryRecord, 'created_at' | 'run_number'>): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO desktop_discovery_run_history (
        id, timestamp, status, saturation_level, signal_count, signal_name,
        config_signal_layer, config_categories_json, config_hypotheses_count,
        config_batch_size, snapshot_json, run_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        COALESCE(
          (SELECT run_number FROM desktop_discovery_run_history WHERE id = ?),
          (SELECT COALESCE(MAX(run_number), 0) + 1 FROM desktop_discovery_run_history)
        )
      )
    `);
    stmt.run(
      entry.id,
      entry.timestamp,
      entry.status,
      entry.saturation_level,
      entry.signal_count,
      entry.signal_name,
      entry.config_signal_layer,
      entry.config_categories_json,
      entry.config_hypotheses_count,
      entry.config_batch_size,
      entry.snapshot_json,
      entry.id,
    );
  }

  /**
   * Load run history ordered by created_at DESC.
   */
  getHistory(limit: number = 50): DiscoveryRunHistoryRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM desktop_discovery_run_history
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as DiscoveryRunHistoryRecord[];
  }

  /**
   * Delete a single run by ID.
   */
  deleteById(id: string): void {
    const stmt = this.db.prepare('DELETE FROM desktop_discovery_run_history WHERE id = ?');
    stmt.run(id);
  }

  /**
   * Partial update -- typically a status transition from running to a terminal
   * state with the final snapshot serialized.
   */
  updateRun(id: string, update: DiscoveryRunHistoryUpdate): void {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (update.status !== undefined) {
      setClauses.push('status = ?');
      params.push(update.status);
    }
    if (update.signal_name !== undefined) {
      setClauses.push('signal_name = ?');
      params.push(update.signal_name);
    }
    if (update.signal_count !== undefined) {
      setClauses.push('signal_count = ?');
      params.push(update.signal_count);
    }
    if (update.saturation_level !== undefined) {
      setClauses.push('saturation_level = ?');
      params.push(update.saturation_level);
    }
    if (update.snapshot_json !== undefined) {
      setClauses.push('snapshot_json = ?');
      params.push(update.snapshot_json);
    }

    if (setClauses.length === 0) {
      dbLog.warn(`[DiscoveryRunHistory] updateRun called with no fields for id=${id}`);
      return;
    }

    params.push(id);
    const stmt = this.db.prepare(
      `UPDATE desktop_discovery_run_history SET ${setClauses.join(', ')} WHERE id = ?`,
    );
    stmt.run(...params);
  }
}
