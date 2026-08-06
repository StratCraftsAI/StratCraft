/**
 * Data Provider Defaults Service - Main Process
 * TICKET_811: Tool Sweep BYOK provider gate + default-provider picker.
 *
 * Persists the user's "default data provider" pointer per domain. Today
 * the only meaningful domain is `us_equity` (Alpaca / Alpha Vantage /
 * Polygon); future domains (china_a_share via BaoStock, FX via
 * Dukascopy commercial, etc.) add their own keys to the same object.
 *
 * Why a dedicated single-purpose service (mirrors locale-service,
 * consent-service, onboarding-service):
 *   - One responsibility = one tightly typed surface area; new prefs
 *     in unrelated domains get their own service rather than turning
 *     this one into a generic bag.
 *   - The IPC contract is narrow: get returns the full object, set
 *     accepts a (domain, providerId|null) tuple and validates both
 *     against an allowlist. A renderer cannot use this surface to
 *     scribble into other settings -- root-cause-safe gating without
 *     a generic "userPrefs" bag.
 *   - Delegates persistence to the shared SQLite owner used by both
 *     Electron and MCP. electron-store is read only for one-time migration.
 */

import Store from 'electron-store';
import { BrowserWindow } from 'electron';
import { appLog } from '../utils/logger';
import { getDatabaseManager } from '../database/db-manager';
import {
  DataProviderDefaultsStore,
  SUPPORTED_DEFAULT_DOMAINS,
  UserDataValidationError,
  type DataProviderDefaults,
  type DefaultDomain,
  type SqliteDatabase,
} from '@StratCraft/user-data-store';

const store = new Store();
const STORE_KEY = 'dataProviderDefaults';

/**
 * Domains the gate currently supports. Adding a domain here is the
 * single point where a new BYOK family (e.g. crypto BYOK) joins the
 * default-pointer system.
 */
export { SUPPORTED_DEFAULT_DOMAINS };
export type { DataProviderDefaults, DefaultDomain };

function getStore(): DataProviderDefaultsStore {
  return new DataProviderDefaultsStore(
    getDatabaseManager() as unknown as SqliteDatabase,
  );
}

function migrateLegacyDefaults(): void {
  const legacy = store.get(STORE_KEY);
  if (legacy && typeof legacy === 'object') {
    const typedStore = getStore();
    for (const domain of SUPPORTED_DEFAULT_DOMAINS) {
      const providerId = (legacy as Record<string, unknown>)[domain];
      if (typeof providerId !== 'string') continue;
      try {
        typedStore.set(domain, providerId);
      } catch (error) {
        if (!(error instanceof UserDataValidationError)) throw error;
        appLog.warn(`[DATA_PROVIDER_DEFAULTS] ignored invalid legacy ${domain}: ${error.message}`);
      }
    }
    store.delete(STORE_KEY);
  }
}

function broadcastDefaults(defaults: DataProviderDefaults): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('dataProviderDefaults:changed', defaults);
    }
  }
}

/**
 * Read the full defaults object. Returns an empty object when nothing
 * has been persisted yet -- callers treat "no key set" as "no default,"
 * which is exactly the path that triggers the picker modal.
 */
export function getDataProviderDefaults(): DataProviderDefaults {
  migrateLegacyDefaults();
  return getStore().get();
}

/**
 * Persist a default pointer for a domain. Passing `null` clears the
 * pointer (rejects the field entirely from the stored object).
 *
 * Returns `{ ok: true }` on success, `{ ok: false, error }` when the
 * domain or providerId is not in the allowlist -- the renderer can
 * treat that as a programming error and log it; the radio in
 * Settings should never produce an invalid value because it iterates
 * the same allowlist on the contribution side.
 */
export function setDataProviderDefault(
  domain: string,
  providerId: string | null,
): { ok: true } | { ok: false; error: string } {
  try {
    migrateLegacyDefaults();
    const defaults = getStore().set(domain, providerId);
    broadcastDefaults(defaults);
    appLog.info(`[DATA_PROVIDER_DEFAULTS] ${domain}=${providerId ?? '<cleared>'}`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
