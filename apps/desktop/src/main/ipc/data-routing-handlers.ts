/**
 * Data Routing IPC handlers (TICKET_927_2_2 section 5).
 *
 * Channels:
 *   - `dataRouting:listMarkets`        -> { market, providers, preference }[]
 *   - `dataRouting:getMarketPreference`-> DataProviderId[]
 *   - `dataRouting:setMarketPreference`-> { ok: true } | { ok: false, error }
 *
 * The renderer's Settings "Data routing" sub-panel reads `listMarkets` to
 * render one row per MarketId, and writes via `setMarketPreference` when
 * the user reorders. The cache-invalidation event `data-routing:preference-changed`
 * fires inside `writeMarketPreference` -- consumers (readiness caches in
 * TICKET_927_2_4) subscribe directly via `subscribeToPreferenceChange`.
 */

import { ipcMain } from 'electron';
import { MARKET_IDS, isMarketId, type MarketId } from '@StratCraft/types';
import { isDataProviderId, type DataProviderId } from '@StratCraft/types';
import { getDataProviderManager } from '../services/data-providers/provider-manager';
import {
  readMarketPreference,
  writeMarketPreference,
} from '../services/data-providers/data-routing';
import { ipcLog } from '../utils/logger';

export interface MarketRoutingRow {
  market: MarketId;
  /** Registration-order candidate provider ids. */
  candidates: string[];
  /** Stored preference list (DataProviderId[]). Empty = registration order. */
  preference: DataProviderId[];
}

export function registerDataRoutingHandlers(): void {
  ipcMain.handle('dataRouting:listMarkets', () => {
    const mgr = getDataProviderManager();
    const rows: MarketRoutingRow[] = [];
    for (const market of MARKET_IDS) {
      const candidates = mgr
        .resolveProvidersForMarket(market)
        .map(p => p.id);
      // Stored preference (may name providers not currently registered).
      const preference = [...readMarketPreference(market)];
      rows.push({ market, candidates, preference });
    }
    return rows;
  });

  ipcMain.handle('dataRouting:getMarketPreference', (_event, market: string) => {
    if (!isMarketId(market)) {
      ipcLog.warn(`[DATA_ROUTING] getMarketPreference rejected unknown MarketId '${market}'`);
      return { ok: false as const, error: `Unknown MarketId '${market}'`, i18nKey: 'dataRouting.validation.unknownMarketId' };
    }
    return { ok: true as const, preference: [...readMarketPreference(market)] };
  });

  ipcMain.handle(
    'dataRouting:setMarketPreference',
    (_event, market: string, preference: unknown) => {
      if (!isMarketId(market)) {
        ipcLog.warn(`[DATA_ROUTING] setMarketPreference rejected unknown MarketId '${market}'`);
        return { ok: false as const, error: `Unknown MarketId '${market}'`, i18nKey: 'dataRouting.validation.unknownMarketId' };
      }
      if (!Array.isArray(preference)) {
        return { ok: false as const, error: 'preference must be an array', i18nKey: 'dataRouting.validation.preferenceMustBeArray' };
      }
      const validated: DataProviderId[] = [];
      for (const id of preference) {
        if (!isDataProviderId(id)) {
          return { ok: false as const, error: `Unknown DataProviderId '${String(id)}'`, i18nKey: 'dataRouting.validation.unknownDataProviderId' };
        }
        validated.push(id);
      }
      try {
        writeMarketPreference(market, validated);
        return { ok: true as const };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ipcLog.warn(`[DATA_ROUTING] setMarketPreference failed: ${msg}`);
        return { ok: false as const, error: msg };
      }
    },
  );

  ipcLog.info('[DATA_ROUTING] IPC handlers registered');
}
