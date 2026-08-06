/**
 * Plugin Telemetry State Service (TICKET_805_2)
 *
 * Persists once-only emit timestamps for promo telemetry events that cannot
 * derive their gating from in-memory state alone:
 *
 * - `first_run_emitted_at`  -- guards `marketplace.promo.first_run` so it
 *   fires exactly once per (install, activation) pair. Activation events
 *   recur every app start; without a persisted gate, the event would
 *   double-fire on every launch.
 *
 * - `install_with_promo_at` -- captures the install timestamp at the moment
 *   `marketplace.promo.install` is detected, so the later entitlement
 *   transition (expires_at != null -> null) can compute `days_since_install`
 *   for `marketplace.promo.converted`. The current entitlement payload alone
 *   cannot answer "was this user ever on promo".
 *
 * Storage: `plugin_telemetry_state` table (migration v59). Keyed by
 * `plugin_id`. Both timestamp columns are UNIX epoch millis to match repo
 * convention.
 */

import { getDatabaseManager } from '../database/db-manager';
import { dbLog } from '../utils/logger';

interface PluginTelemetryStateRow {
  plugin_id: string;
  first_run_emitted_at: number | null;
  install_with_promo_at: number | null;
}

function getRow(pluginId: string): PluginTelemetryStateRow | null {
  const db = getDatabaseManager().getDb();
  const stmt = db.prepare(
    'SELECT plugin_id, first_run_emitted_at, install_with_promo_at FROM plugin_telemetry_state WHERE plugin_id = ?'
  );
  const row = stmt.get(pluginId) as PluginTelemetryStateRow | undefined;
  return row ?? null;
}

/**
 * Atomically mark `first_run` as emitted for `pluginId`.
 *
 * Returns `true` if this call performed the transition (caller SHOULD emit
 * the telemetry event). Returns `false` if the row already has a non-null
 * `first_run_emitted_at` (caller MUST NOT emit -- the event already fired
 * in a prior session).
 *
 * The read-modify-write happens inside a single better-sqlite3 transaction
 * (synchronous, serialised), so two activations racing across IPC handlers
 * cannot both observe "not yet emitted" and double-fire.
 */
export function markFirstRunEmittedIfFirst(pluginId: string, nowMs: number): boolean {
  const db = getDatabaseManager().getDb();
  const txn = db.transaction((id: string, ts: number): boolean => {
    const existing = db
      .prepare('SELECT first_run_emitted_at FROM plugin_telemetry_state WHERE plugin_id = ?')
      .get(id) as { first_run_emitted_at: number | null } | undefined;

    if (existing && existing.first_run_emitted_at != null) {
      return false;
    }

    db.prepare(`
      INSERT INTO plugin_telemetry_state (plugin_id, first_run_emitted_at)
      VALUES (?, ?)
      ON CONFLICT(plugin_id) DO UPDATE SET first_run_emitted_at = excluded.first_run_emitted_at
    `).run(id, ts);

    return true;
  });

  return txn(pluginId, nowMs);
}

/**
 * Record the install timestamp at the moment a promo-install was detected.
 *
 * Overwrites any prior value: a fresh install replaces the previous
 * "had promo" timestamp. If the user uninstalls + reinstalls during promo
 * the new install timestamp is what `converted` should measure against.
 */
export function setInstallWithPromoAt(pluginId: string, nowMs: number): void {
  const db = getDatabaseManager().getDb();
  const stmt = db.prepare(`
    INSERT INTO plugin_telemetry_state (plugin_id, install_with_promo_at)
    VALUES (?, ?)
    ON CONFLICT(plugin_id) DO UPDATE SET install_with_promo_at = excluded.install_with_promo_at
  `);
  stmt.run(pluginId, nowMs);
}

/**
 * Read the recorded promo-install timestamp, or `null` if none.
 */
export function getInstallWithPromoAt(pluginId: string): number | null {
  return getRow(pluginId)?.install_with_promo_at ?? null;
}

/**
 * Clear the promo-install timestamp after `converted` has been emitted.
 *
 * Once-only semantics: a single promo-install -> permanent-buyout transition
 * yields exactly one `converted` event. The column is set NULL (rather than
 * deleting the row) to preserve any `first_run_emitted_at` recorded there.
 */
export function clearInstallWithPromoAt(pluginId: string): void {
  const db = getDatabaseManager().getDb();
  const stmt = db.prepare(
    'UPDATE plugin_telemetry_state SET install_with_promo_at = NULL WHERE plugin_id = ?'
  );
  stmt.run(pluginId);
}

/**
 * Test-only: wipe all rows. Production code must not call this.
 */
export function __resetForTest(): void {
  try {
    const db = getDatabaseManager().getDb();
    db.prepare('DELETE FROM plugin_telemetry_state').run();
  } catch (err) {
    dbLog.warn('[plugin-telemetry-state] reset skipped:', err);
  }
}
