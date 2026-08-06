/**
 * Data Routing -- per-market provider preference settings.
 *
 * TICKET_927_2_2 section 5: persists `data.providerPreference.<MarketId>`
 * lists through `PluginConfigManager` under the host plugin id
 * `com.stratcraft.data-routing`. The shape is intentionally **not** a
 * `Record<MarketId, DataProviderId[]>` constant in code -- the source of
 * truth lives in the user-config.json file, not in code.
 *
 * Single source of truth (TICKET_854): every read of a per-market preference
 * goes through `readMarketPreference`. The provider manager
 * (`provider-manager.ts:resolveProvidersForMarket`) is the only caller in
 * the routing hot path; the Settings panel calls `writeMarketPreference`
 * which fires the cache-invalidation event consumed by readiness caches
 * (TICKET_927_2_4).
 */

import { EventEmitter } from 'events';
import type { MarketId } from '@StratCraft/types';
import { isMarketId, isDataProviderId, type DataProviderId } from '@StratCraft/types';
import { getPluginConfigManager } from '../plugin-config-manager';
import { appLog } from '../../utils/logger';

// =============================================================================
// Constants
// =============================================================================

/** Host plugin id under which per-market preferences are persisted. */
export const DATA_ROUTING_PLUGIN_ID = 'com.stratcraft.data-routing';

/** Settings-key prefix per ticket section 5: `data.providerPreference.<MarketId>`. */
export const MARKET_PREFERENCE_KEY_PREFIX = 'data.providerPreference.';

/**
 * Event fired when any per-market preference is written. Consumers
 * (readiness caches in TICKET_927_2_4) subscribe to invalidate their
 * cached resolutions without an app restart.
 */
export const PREFERENCE_CHANGED_EVENT = 'data-routing:preference-changed';

export interface PreferenceChangePayload {
  /** The MarketId whose preference list changed. */
  market: MarketId;
  /** The new ordered list of DataProviderIds. */
  preference: ReadonlyArray<DataProviderId>;
}

// =============================================================================
// Event bus
// =============================================================================

const routingBus = new EventEmitter();
routingBus.setMaxListeners(50);

/**
 * Subscribe to per-market preference changes. Returns an unsubscribe
 * function. Listeners are called synchronously, in registration order,
 * after the write completes.
 */
export function subscribeToPreferenceChange(
  listener: (payload: PreferenceChangePayload) => void,
): () => void {
  routingBus.on(PREFERENCE_CHANGED_EVENT, listener);
  return () => {
    routingBus.off(PREFERENCE_CHANGED_EVENT, listener);
  };
}

/** Removes every listener -- test-only hygiene. */
export function _clearPreferenceChangeListenersForTest(): void {
  routingBus.removeAllListeners(PREFERENCE_CHANGED_EVENT);
}

// =============================================================================
// Storage key shape
// =============================================================================

export function marketPreferenceKey(market: MarketId): string {
  return `${MARKET_PREFERENCE_KEY_PREFIX}${market}`;
}

// =============================================================================
// Read / Write API
// =============================================================================

/**
 * Reads the per-market preference list. Returns `[]` when no preference
 * is set, when the stored value is malformed, or when a stored
 * DataProviderId is unknown to the runtime. Section 4 of the ticket
 * treats `[]` as "use registration order" -- so a malformed value
 * silently degrades to registration order rather than crashing the
 * routing path.
 *
 * Malformed reads are logged (TICKET_858: surface, do not silently
 * absorb) but not thrown -- registration order is a safe fallback
 * shape, not a silent failure.
 */
export function readMarketPreference(market: MarketId): ReadonlyArray<DataProviderId> {
  if (!isMarketId(market)) {
    throw new Error(
      `[data-routing] readMarketPreference: '${market}' is not a valid MarketId`,
    );
  }

  const cfg = getPluginConfigManager().loadUserConfig(DATA_ROUTING_PLUGIN_ID);
  const raw = cfg.preferences?.[marketPreferenceKey(market)];

  if (raw === undefined || raw === null) {
    return [];
  }

  if (!Array.isArray(raw)) {
    appLog.warn(
      `[data-routing] preference for '${market}' is not an array (got ${typeof raw}); falling back to registration order`,
    );
    return [];
  }

  const filtered: DataProviderId[] = [];
  for (const entry of raw) {
    if (isDataProviderId(entry)) {
      filtered.push(entry);
    } else {
      appLog.warn(
        `[data-routing] preference for '${market}' contains unknown DataProviderId '${String(entry)}'; dropping`,
      );
    }
  }
  return filtered;
}

/**
 * Writes the per-market preference list and fires
 * `data-routing:preference-changed`. The ordering of `preference` is
 * the user's preferred routing order -- the first id wins ties against
 * registration order in `resolveProvidersForMarket`.
 *
 * Rejects unknown MarketId or unknown DataProviderId at the boundary
 * (TICKET_857 fail-fast at I/O boundary; a malformed write would
 * silently corrupt routing on the next read).
 */
export function writeMarketPreference(
  market: MarketId,
  preference: ReadonlyArray<DataProviderId>,
): void {
  if (!isMarketId(market)) {
    throw new Error(
      `[data-routing] writeMarketPreference: '${market}' is not a valid MarketId`,
    );
  }
  for (const id of preference) {
    if (!isDataProviderId(id)) {
      throw new Error(
        `[data-routing] writeMarketPreference: '${id}' is not a valid DataProviderId`,
      );
    }
  }

  const mgr = getPluginConfigManager();
  const cfg = mgr.loadUserConfig(DATA_ROUTING_PLUGIN_ID);
  const next = {
    ...cfg,
    services: cfg.services ?? {},
    preferences: {
      ...(cfg.preferences ?? {}),
      [marketPreferenceKey(market)]: [...preference],
    },
  };
  mgr.saveUserConfig(DATA_ROUTING_PLUGIN_ID, next);

  routingBus.emit(PREFERENCE_CHANGED_EVENT, {
    market,
    preference: [...preference],
  } satisfies PreferenceChangePayload);
}
