/**
 * Alt-Data History Persistence
 *
 * TICKET_196_7_7 P4.1 step (b): persist every AlternativeFactorRow that flows
 * through an `IAlternativeDataProvider.startLiveStream()` `onRow` callback
 * into the `alt_data_history` SQLite table (migration v52). Without this
 * persistence the Scoreboard live-IC writer (P4.1 step (c), score_alt_one.py)
 * has no record of what the provider published over the live observation
 * window -- the rows are otherwise piped straight into the ccxt plugin host's
 * stdin bridge and discarded.
 *
 * Design:
 *   * Registration-time wrapper. `wrapProviderWithHistoryPersistence()` returns
 *     a proxy whose `startLiveStream()` injects the persistence INSERT into
 *     the user-supplied `onRow` callback. The four concrete providers (FRED,
 *     Marketaux, CFTC COT, Binance Funding) are unchanged -- one
 *     bootstrap-level call covers all of them and any future provider that
 *     implements the interface.
 *   * `INSERT OR IGNORE`. The PK is (provider_id, series_id, event_time,
 *     knowledge_time, vintage_id) with `vintage_id NOT NULL DEFAULT ''` (see
 *     migration v52 -- SQLite rejects expressions in PRIMARY KEY column lists,
 *     hence the sentinel). Polling providers re-fetch overlapping windows on
 *     every tick; OR IGNORE turns those duplicates into silent no-ops without
 *     re-throwing on the live-stream tick path.
 *   * Error isolation. A DB write failure (disk full, table locked, etc.)
 *     MUST NOT break the live stream -- callers downstream of `onRow` (the
 *     C++ live-engine stdin bridge in the ccxt plugin host) are independent
 *     of the local persistence layer. Failures are logged via appLog and the
 *     user-supplied `onRow` is still invoked.
 *   * Lazy DB resolution. `getDatabaseManager()` is called inside the INSERT
 *     closure, not at module-load time, so a bootstrap order that registers
 *     alt-data providers before the DB has been initialised does not crash
 *     (it just no-ops persistence until the DB is ready). The next FRED tick
 *     would then write the row.
 *
 * Out of scope: ergonomic reader. score_alt_one.py (P4.1 step (c)) opens the
 * same SQLite file directly via `better-sqlite3` or `sqlite3` (TBD); there is
 * no TypeScript read API here.
 */

import type { Database } from 'better-sqlite3';
import { appLog } from '../../../utils/logger';
import { getDatabaseManager } from '../../../database/db-manager';
import type {
  AlternativeFactorRow,
} from '../../../../shared/types/signal-discovery';
import type { IAlternativeDataProvider } from './types';

const LOG_PREFIX = '[AltDataHistory]';

const INSERT_SQL = `
  INSERT OR IGNORE INTO alt_data_history
    (provider_id, series_id, category, symbol,
     event_time, knowledge_time, value, vintage_id, captured_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

let cachedDb: Database | null = null;
let warned = false;

function resolveDb(): Database | null {
  if (cachedDb) return cachedDb;
  try {
    cachedDb = getDatabaseManager().getDb();
    return cachedDb;
  } catch (err) {
    if (!warned) {
      const msg = err instanceof Error ? err.message : String(err);
      appLog.warn(`${LOG_PREFIX} DB not initialised yet; skipping persistence (${msg})`);
      warned = true;
    }
    return null;
  }
}

/**
 * Persist a single row. Returns true if a row was written, false if duplicate
 * or DB unavailable. Throws nothing -- error isolation is a hard contract.
 */
export function persistAltDataRow(row: AlternativeFactorRow): boolean {
  const db = resolveDb();
  if (!db) return false;

  try {
    const result = db.prepare(INSERT_SQL).run(
      row.source_provider,
      row.factor_name,
      row.category,
      row.symbol ?? null,
      row.event_time,
      row.knowledge_time,
      row.value,
      row.vintage_id ?? '',
      Date.now(),
    );
    return result.changes > 0;
  } catch (err) {
    // Disk-full, schema-mismatch, locked table -- all must not break the live
    // stream. Log once per (provider, series) to avoid log floods on a
    // sustained failure.
    const msg = err instanceof Error ? err.message : String(err);
    appLog.error(
      `${LOG_PREFIX} INSERT failed for ${row.source_provider}/${row.factor_name} ` +
        `@ ${row.knowledge_time}: ${msg}`,
    );
    return false;
  }
}

/**
 * Return a provider proxy whose `startLiveStream` injects an
 * `alt_data_history` INSERT into the user-supplied `onRow` callback. All
 * other methods (`fetchFactorData`, identity fields) pass through unchanged.
 *
 * The original provider object is NOT mutated -- the proxy is a fresh object
 * implementing the same interface. Safe to call multiple times; each call
 * returns a new proxy.
 */
export function wrapProviderWithHistoryPersistence(
  provider: IAlternativeDataProvider,
): IAlternativeDataProvider {
  if (!provider.startLiveStream) {
    // No live stream -> no persistence hook to inject. Pass through.
    return provider;
  }

  const originalStart = provider.startLiveStream.bind(provider);

  const wrapped: IAlternativeDataProvider = {
    id: provider.id,
    name: provider.name,
    source: provider.source,
    vintage_supported: provider.vintage_supported,
    live_streaming_supported: provider.live_streaming_supported,
    fetchFactorData: provider.fetchFactorData.bind(provider),
    startLiveStream: (params, onRow, onError, pollIntervalMs) => {
      const persistedOnRow = (row: AlternativeFactorRow): void => {
        // Persist first; even if the user-supplied callback throws (e.g. an
        // upstream consumer crashes the stdin bridge), the row is still on
        // disk for the next scoreboard tick to replay.
        persistAltDataRow(row);
        onRow(row);
      };
      return originalStart(params, persistedOnRow, onError, pollIntervalMs);
    },
  };

  return wrapped;
}

/** Test-only: clear the cached DB handle so each test starts from a clean slate. */
export function _resetAltDataHistoryCacheForTests(): void {
  cachedDb = null;
  warned = false;
}
