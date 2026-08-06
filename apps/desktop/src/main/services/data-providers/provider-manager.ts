/**
 * Data Provider Manager
 *
 * TICKET_292: Lightweight registry + router for data providers.
 * TICKET_883: Provider status cache -- cached snapshot, TTL, in-flight dedup.
 *
 * @see TICKET_292_MULTI_SOURCE_DATA_PROVIDER_INTERFACE.md
 * @see TICKET_883_PROVIDER_STATUS_CACHE_UNIFIED_LOADING.md
 */

import { IDataProvider, ProviderCapabilities } from './types';
import { YFinanceProvider } from './yfinance-provider';
import { DukascopyProvider } from './dukascopy-provider';
import { AKShareProvider } from './akshare-provider';
import { TushareProvider } from './tushare-provider';
import { BaoStockProvider } from './baostock-provider';
import { DatabentoProvider } from './databento-provider';  // TICKET_958
import { isPublicRelease } from '../distribution-service';  // TICKET_631 / TICKET_635
import { appLog } from '../../utils/logger';
import { mainT } from '../../i18n/main-strings';
import { getCurrentMainLocale } from '../locale-service';
import {
  isMarketId, type MarketId, type AnyMarketId, DATA_CREDENTIAL_KEYS,
  PROVIDER_ALPACA, PROVIDER_ALPHA_VANTAGE, PROVIDER_POLYGON, PROVIDER_TUSHARE,
} from '@StratCraft/types';  // TICKET_927_2_2, TICKET_1023_6, TICKET_1023_8
import { readMarketPreference } from './data-routing';  // TICKET_927_2_2 section 5

export type ProviderStatusValue = 'connected' | 'disconnected' | 'not-configured' | 'error' | 'checking';

export interface ProviderStatusEntry {
  id: string;
  name: string;
  status: ProviderStatusValue;
  capabilities: ProviderCapabilities;
  latencyMs?: number;
  error?: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * TICKET_1327 F2: the main-process MIRROR that used to live here is DELETED.
 *
 * It was introduced by TICKET_883 Phase 3 as a hand-maintained copy of the
 * plugin's `BYOK_PROVIDER_CREDENTIALS` (`universes.ts`), with the source
 * location named in a comment and nothing enforcing agreement. The two copies
 * had in fact already diverged -- this side carried `tushare`, the renderer
 * gate did not -- which is exactly the silent cross-surface availability skew
 * TICKET_1327 exists to end.
 *
 * The single definition now lives in `@StratCraft/types`
 * (`DATA_PROVIDER_CREDENTIALS`), which both the plugin tier and this process
 * may import. Re-exported here under the same names so existing consumers
 * (`credential-handlers.ts`) keep working, but there is no second copy to keep
 * in lockstep. A reintroduced mirror fails `provider-availability.1327` (AC2).
 */
export {
  DATA_PROVIDER_CREDENTIALS,
  resolveDataProviderFromCredential,
} from '@StratCraft/types';

/**
 * TICKET_927_2_2: stable sort -- the providers whose id appears in
 * `preference` come first in the listed order; the rest keep their
 * relative registration-order position. Unknown ids in `preference`
 * are skipped (already filtered at read time, but this function is
 * defensively idempotent).
 */
function sortByPreference(
  candidates: IDataProvider[],
  preference: ReadonlyArray<string>,
): IDataProvider[] {
  const candidateById = new Map(candidates.map(p => [p.id, p]));
  const named: IDataProvider[] = [];
  const seen = new Set<string>();
  for (const id of preference) {
    const p = candidateById.get(id);
    if (p && !seen.has(id)) {
      named.push(p);
      seen.add(id);
    }
  }
  const rest = candidates.filter(p => !seen.has(p.id));
  return [...named, ...rest];
}

export class DataProviderManager {
  private providers = new Map<string, IDataProvider>();
  private statusCache = new Map<string, ProviderStatusEntry>();
  private cacheBuiltAt = 0;
  private refreshPromise: Promise<ProviderStatusEntry[]> | null = null;
  private statusChangeListener: ((entries: ProviderStatusEntry[]) => void) | null = null;

  register(provider: IDataProvider): void {
    // TICKET_927_2_2 / TICKET_857: fail-fast at boot. A provider with no
    // declared MarketIds, or one declaring an unknown MarketId, is a build
    // bug -- surface it now, not silently at gate time.
    if (!Array.isArray(provider.supportedMarkets) || provider.supportedMarkets.length === 0) {
      throw new Error(
        `[DataProviderManager] Provider '${provider.id}' declares no supportedMarkets`,
      );
    }
    for (const market of provider.supportedMarkets) {
      if (!isMarketId(market)) {
        throw new Error(
          `[DataProviderManager] Provider '${provider.id}' declares invalid MarketId '${String(market)}'`,
        );
      }
    }
    // TICKET_958_5 AC #1: fail-fast at boot when a provider omits the
    // canonical OHLCV cache-schema declaration. The capability is the
    // contractual promise that `queryOHLCV` rows round-trip through
    // `OHLCV_SCHEMA` without column rename; a provider that forgets to
    // declare it would silently bypass the cross-provider canonical
    // round-trip test (TICKET_958_5 AC #3) until someone hand-runs it.
    // Surface the miss at register() time, per TICKET_857 fail-fast.
    if (provider.capabilities.cacheSchema !== 'OHLCV_V1_CANONICAL') {
      throw new Error(
        `[DataProviderManager] Provider '${provider.id}' declares unknown ` +
          `cacheSchema '${String(provider.capabilities.cacheSchema)}' -- ` +
          `only 'OHLCV_V1_CANONICAL' is supported (TICKET_958_5)`,
      );
    }
    appLog.info(`[DataProviderManager] Registered provider: ${provider.id} (${provider.name})`);
    this.providers.set(provider.id, provider);
  }

  /**
   * TICKET_927_2_2: enumerate providers that can serve a market, ordered
   * by user preference (`data.providerPreference.<MarketId>`) then
   * registration order.
   *
   * Returns `[]` when no provider claims this market. The caller
   * (DataReadinessGate, TICKET_927_2_4) MUST treat the empty result as
   * `unsupported` and surface it via `DataManifestEntry.unsupported`.
   * Throwing here would prevent the gate from enumerating every market
   * in its report -- per TICKET_858 surfacing happens at the gate layer,
   * not by collapsing the routing-empty case to a thrown error here.
   *
   * Stable: providers named in `preference` come first in the listed
   * order; providers not named keep their registration-order position
   * after the named block. No alphabetical / latency-weighted / "smart"
   * default (section 6 explicitly refuses smart defaults).
   */
  resolveProvidersForMarket(market: AnyMarketId): IDataProvider[] {
    const registrationOrder = Array.from(this.providers.values());
    const candidates = registrationOrder.filter(
      p => p.supportedMarkets.includes(market as MarketId),
    );
    // Fast path: 0 or 1 candidate -- preference list cannot reorder.
    if (candidates.length <= 1) return candidates;

    const preference = readMarketPreference(market as MarketId);
    if (preference.length === 0) return candidates;

    return sortByPreference(candidates, preference);
  }

  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  getProvider(id: string): IDataProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      const available = Array.from(this.providers.keys()).join(', ');
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.notFound', { id, available }));
    }
    return provider;
  }

  getDefaultProvider(): IDataProvider {
    const first = this.providers.values().next();
    if (first.done) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.noneRegistered'));
    }
    return first.value;
  }

  listProviders(): Array<{ id: string; name: string; capabilities: ProviderCapabilities }> {
    return Array.from(this.providers.values()).map(p => ({
      id: p.id,
      name: p.name,
      capabilities: p.capabilities,
    }));
  }

  onStatusChange(listener: (entries: ProviderStatusEntry[]) => void): void {
    this.statusChangeListener = listener;
  }

  getCachedProviders(): ProviderStatusEntry[] {
    if (this.statusCache.size === 0) {
      return Array.from(this.providers.values()).map(p => ({
        id: p.id,
        name: p.name,
        status: 'checking' as const,
        capabilities: p.capabilities,
      }));
    }
    return Array.from(this.statusCache.values());
  }

  isCacheStale(): boolean {
    return this.cacheBuiltAt === 0 || (Date.now() - this.cacheBuiltAt) > CACHE_TTL_MS;
  }

  getCacheAge(): number {
    return Date.now() - this.cacheBuiltAt;
  }

  async refreshAllProviders(): Promise<ProviderStatusEntry[]> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  updateProviderStatus(providerId: string, status: ProviderStatusValue, error?: string): void {
    const provider = this.providers.get(providerId);
    if (!provider) {
      appLog.debug(`[DataProviderManager] updateProviderStatus: '${providerId}' not registered, skipping`);
      return;
    }

    const prev = this.statusCache.get(providerId);
    const entry: ProviderStatusEntry = {
      id: provider.id,
      name: provider.name,
      status,
      capabilities: provider.capabilities,
      error,
    };
    this.statusCache.set(providerId, entry);

    if (!prev || prev.status !== status) {
      this.statusChangeListener?.(this.getCachedProviders());
    }
  }

  async refreshSingleProvider(providerId: string): Promise<ProviderStatusEntry | null> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      appLog.debug(`[DataProviderManager] refreshSingleProvider: '${providerId}' not registered, skipping`);
      return null;
    }

    const entry = await this.checkOneProvider(provider);
    const prev = this.statusCache.get(providerId);
    this.statusCache.set(providerId, entry);

    if (!prev || prev.status !== entry.status) {
      this.statusChangeListener?.(this.getCachedProviders());
    }

    return entry;
  }

  private async doRefresh(): Promise<ProviderStatusEntry[]> {
    const providers = Array.from(this.providers.values());

    const entries = await Promise.all(providers.map(p => this.checkOneProvider(p)));

    const changed: ProviderStatusEntry[] = [];
    for (const entry of entries) {
      const prev = this.statusCache.get(entry.id);
      if (!prev || prev.status !== entry.status) {
        changed.push(entry);
      }
      this.statusCache.set(entry.id, entry);
    }

    this.cacheBuiltAt = Date.now();
    appLog.info(`[DataProviderManager] Cache refreshed: ${entries.length} providers, ${changed.length} status changes`);

    if (changed.length > 0) {
      this.statusChangeListener?.(this.getCachedProviders());
    }

    return entries;
  }

  private async checkOneProvider(provider: IDataProvider): Promise<ProviderStatusEntry> {
    try {
      const conn = await provider.checkConnection();
      let status: ProviderStatusValue;
      if (conn.connected) {
        status = 'connected';
      } else if (conn.reason === 'not-configured') {
        status = 'not-configured';
      } else {
        status = 'disconnected';
      }
      return {
        id: provider.id,
        name: provider.name,
        status,
        capabilities: provider.capabilities,
        latencyMs: conn.latencyMs,
        error: conn.error,
      };
    } catch (error) {
      appLog.warn(`[DataProviderManager] checkConnection failed for ${provider.id}:`, error);
      return {
        id: provider.id,
        name: provider.name,
        status: 'error',
        capabilities: provider.capabilities,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: DataProviderManager | null = null;

/**
 * TICKET_632_1: Load and register Pro-only data providers via dynamic import.
 * These modules are excluded from the public release build by publish-community.sh.
 */
async function registerProProviders(manager: DataProviderManager): Promise<void> {
  const { AlpacaProvider } = await import('./alpaca-provider');
  const { CCXTProvider } = await import('./ccxt-provider');

  manager.register(new AlpacaProvider());
  manager.register(new CCXTProvider());

  appLog.info(`[DataProviderManager] Pro providers registered, total: ${manager.listProviders().length}`);
}

export function initializeDataProviderManager(): void {
  if (instance) {
    appLog.warn('[DataProviderManager] Already initialized, skipping');
    return;
  }

  instance = new DataProviderManager();

  // All distributions: free data providers
  instance.register(new YFinanceProvider());
  instance.register(new DukascopyProvider());
  instance.register(new AKShareProvider());
  instance.register(new TushareProvider());
  instance.register(new BaoStockProvider());

  // TICKET_958: Databento local-parquet research provider. Research-only --
  // registered ONLY when STRATCRAFT_RESEARCH_MODE=1, so packaged builds for
  // end users never surface Databento in any UI flow (the picker, the
  // readiness gate, the sweep selector are all driven by the registered
  // provider list). This is the "Not BYOK / Not network" gating from
  // TICKET_958 Part A: there is no BYOK credential to gate on, so the
  // gate lives at registration time instead.
  if (process.env.STRATCRAFT_RESEARCH_MODE === '1') {
    instance.register(new DatabentoProvider());
    appLog.info('[DataProviderManager] STRATCRAFT_RESEARCH_MODE=1 -- Databento registered');
  }

  // TICKET_883: Chain startup refresh after Pro provider registration
  if (!isPublicRelease()) {
    registerProProviders(instance).then(() => {
      return instance!.refreshAllProviders();
    }).catch(err => {
      appLog.error(`[DataProviderManager] Startup refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  } else {
    appLog.info('[DataProviderManager] Public release: Pro-only data providers skipped');
    instance.refreshAllProviders().catch(err => {
      appLog.error(`[DataProviderManager] Startup refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  appLog.info(`[DataProviderManager] Initialized with ${instance.listProviders().length} base providers`);
}

export function getDataProviderManager(): DataProviderManager {
  if (!instance) {
    throw new Error('DataProviderManager not initialized. Call initializeDataProviderManager() first.');
  }
  return instance;
}
