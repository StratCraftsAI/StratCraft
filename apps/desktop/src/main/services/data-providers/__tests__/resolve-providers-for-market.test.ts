/**
 * TICKET_927_2_2 acceptance tests (section 10).
 *
 * (a) multi-provider market resolves in user-preferred order when preference set
 * (b) multi-provider market falls back to registration order when preference empty
 * (c) single-provider market resolves to that provider regardless of preference
 * (d) unsupported market returns [] and does not throw
 * (e) register() throws on empty supportedMarkets and on invalid MarketId values
 * (f) preference change emits the cache-invalidation event
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks: stub PluginConfigManager so tests do not touch the filesystem.
// ---------------------------------------------------------------------------

interface StoredConfig {
  services: Record<string, { enabled: boolean }>;
  preferences?: Record<string, unknown>;
}

const stubStore: Record<string, StoredConfig> = {};

vi.mock('../../plugin-config-manager', () => ({
  getPluginConfigManager: () => ({
    loadUserConfig: (pluginId: string): StoredConfig => {
      return stubStore[pluginId] ?? { services: {} };
    },
    saveUserConfig: (pluginId: string, config: StoredConfig) => {
      stubStore[pluginId] = config;
    },
  }),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  appLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeProvider(id: string, supportedMarkets: readonly string[]) {
  return {
    id,
    name: id,
    capabilities: { requiresAuth: false, cacheSchema: 'OHLCV_V1_CANONICAL' },
    supportedMarkets,
    checkConnection: vi.fn().mockResolvedValue({ connected: true, latencyMs: 1 }),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TICKET_927_2_2: DataProviderManager.resolveProvidersForMarket', () => {
  let DataProviderManager: typeof import('../provider-manager').DataProviderManager;
  let dataRouting: typeof import('../data-routing');

  beforeEach(async () => {
    vi.resetModules();
    for (const k of Object.keys(stubStore)) delete stubStore[k];
    const mod = await import('../provider-manager');
    DataProviderManager = mod.DataProviderManager;
    dataRouting = await import('../data-routing');
    dataRouting._clearPreferenceChangeListenersForTest();
  });

  afterEach(() => {
    dataRouting._clearPreferenceChangeListenersForTest();
  });

  // -------------------------------------------------------------------------
  // (a) multi-provider market resolves in user-preferred order when set
  // -------------------------------------------------------------------------
  describe('(a) user preference ordering', () => {
    it('reorders candidates to match preference list', () => {
      const mgr = new DataProviderManager();
      const yfinance = fakeProvider('yfinance', ['yfinance_us_equity']);
      const alpaca = fakeProvider('alpaca', ['yfinance_us_equity']);
      mgr.register(yfinance);
      mgr.register(alpaca);

      dataRouting.writeMarketPreference('yfinance_us_equity', ['alpaca', 'yfinance']);

      const resolved = mgr.resolveProvidersForMarket('yfinance_us_equity');
      expect(resolved.map(p => p.id)).toEqual(['alpaca', 'yfinance']);
    });

    it('places named providers first, registration-order tail after', () => {
      const mgr = new DataProviderManager();
      const a = fakeProvider('yfinance', ['yfinance_us_equity']);
      const b = fakeProvider('alpaca', ['yfinance_us_equity']);
      const c = fakeProvider('clickhouse', ['yfinance_us_equity']);
      mgr.register(a);
      mgr.register(b);
      mgr.register(c);

      dataRouting.writeMarketPreference('yfinance_us_equity', ['clickhouse']);

      const resolved = mgr.resolveProvidersForMarket('yfinance_us_equity');
      expect(resolved.map(p => p.id)).toEqual([
        'clickhouse',
        'yfinance',
        'alpaca',
      ]);
    });

    it('ignores unknown DataProviderIds in stored preference (filtered at read)', () => {
      const mgr = new DataProviderManager();
      mgr.register(fakeProvider('yfinance', ['yfinance_us_equity']));
      mgr.register(fakeProvider('alpaca', ['yfinance_us_equity']));

      stubStore['com.stratcraft.data-routing'] = {
        services: {},
        preferences: {
          'data.providerPreference.yfinance_us_equity': ['nonexistent_provider', 'alpaca'],
        },
      };

      const resolved = mgr.resolveProvidersForMarket('yfinance_us_equity');
      expect(resolved.map(p => p.id)).toEqual(['alpaca', 'yfinance']);
    });
  });

  // -------------------------------------------------------------------------
  // (b) multi-provider market falls back to registration order
  // -------------------------------------------------------------------------
  describe('(b) registration-order fallback', () => {
    it('returns providers in registration order when no preference set', () => {
      const mgr = new DataProviderManager();
      mgr.register(fakeProvider('yfinance', ['yfinance_us_equity']));
      mgr.register(fakeProvider('alpaca', ['yfinance_us_equity']));

      const resolved = mgr.resolveProvidersForMarket('yfinance_us_equity');
      expect(resolved.map(p => p.id)).toEqual(['yfinance', 'alpaca']);
    });

    it('returns registration order when stored preference is an empty array', () => {
      const mgr = new DataProviderManager();
      mgr.register(fakeProvider('yfinance', ['yfinance_us_equity']));
      mgr.register(fakeProvider('alpaca', ['yfinance_us_equity']));

      dataRouting.writeMarketPreference('yfinance_us_equity', []);

      const resolved = mgr.resolveProvidersForMarket('yfinance_us_equity');
      expect(resolved.map(p => p.id)).toEqual(['yfinance', 'alpaca']);
    });

    it('returns registration order when stored preference is malformed (not an array)', () => {
      const mgr = new DataProviderManager();
      mgr.register(fakeProvider('yfinance', ['yfinance_us_equity']));
      mgr.register(fakeProvider('alpaca', ['yfinance_us_equity']));

      stubStore['com.stratcraft.data-routing'] = {
        services: {},
        preferences: { 'data.providerPreference.yfinance_us_equity': 'alpaca' },
      };

      const resolved = mgr.resolveProvidersForMarket('yfinance_us_equity');
      expect(resolved.map(p => p.id)).toEqual(['yfinance', 'alpaca']);
    });
  });

  // -------------------------------------------------------------------------
  // (c) single-provider market resolves to that provider regardless
  // -------------------------------------------------------------------------
  describe('(c) single-provider passthrough', () => {
    it('returns the sole claimant even when preference names a different id', () => {
      const mgr = new DataProviderManager();
      // Only dukascopy claims dukascopy_forex.
      mgr.register(fakeProvider('yfinance', ['yfinance_us_equity']));
      mgr.register(fakeProvider('dukascopy', ['dukascopy_forex']));

      // Preference names a provider that does NOT claim the market.
      dataRouting.writeMarketPreference('dukascopy_forex', ['yfinance']);

      const resolved = mgr.resolveProvidersForMarket('dukascopy_forex');
      expect(resolved.map(p => p.id)).toEqual(['dukascopy']);
    });

    it('takes the fast path (does not consult preference store) for single-provider markets', () => {
      const mgr = new DataProviderManager();
      mgr.register(fakeProvider('dukascopy', ['dukascopy_forex']));

      const spy = vi.spyOn(dataRouting, 'readMarketPreference');
      try {
        const resolved = mgr.resolveProvidersForMarket('dukascopy_forex');
        expect(resolved.map(p => p.id)).toEqual(['dukascopy']);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  // -------------------------------------------------------------------------
  // (d) unsupported market returns [] and does not throw
  // -------------------------------------------------------------------------
  describe('(d) unsupported market', () => {
    it('returns empty array for a MarketId no registered provider claims', () => {
      const mgr = new DataProviderManager();
      mgr.register(fakeProvider('alpaca', ['alpaca_us_equity']));

      // No provider claims 'dukascopy_forex'.
      const resolved = mgr.resolveProvidersForMarket('dukascopy_forex');
      expect(resolved).toEqual([]);
    });

    it('does not throw on unsupported -- caller surfaces as UNSUPPORTED', () => {
      const mgr = new DataProviderManager();
      // Empty registry.
      expect(() => mgr.resolveProvidersForMarket('dukascopy_forex')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // (e) register() throws on empty supportedMarkets and invalid MarketId
  // -------------------------------------------------------------------------
  describe('(e) register() boot-time validation (TICKET_857 fail-fast)', () => {
    it('throws on supportedMarkets: []', () => {
      const mgr = new DataProviderManager();
      expect(() =>
        mgr.register({
          id: 'broken',
          name: 'Broken',
          capabilities: {},
          supportedMarkets: [],
          checkConnection: () => Promise.resolve({ connected: true }),
        } as any),
      ).toThrow(/no supportedMarkets/);
    });

    it('throws when supportedMarkets field is missing entirely', () => {
      const mgr = new DataProviderManager();
      expect(() =>
        mgr.register({
          id: 'broken',
          name: 'Broken',
          capabilities: {},
          checkConnection: () => Promise.resolve({ connected: true }),
        } as any),
      ).toThrow(/no supportedMarkets/);
    });

    it('throws on a non-array supportedMarkets', () => {
      const mgr = new DataProviderManager();
      expect(() =>
        mgr.register({
          id: 'broken',
          name: 'Broken',
          capabilities: {},
          supportedMarkets: 'yfinance_us_equity',
          checkConnection: () => Promise.resolve({ connected: true }),
        } as any),
      ).toThrow(/no supportedMarkets/);
    });

    it('throws on a supportedMarkets entry that is not a valid MarketId', () => {
      const mgr = new DataProviderManager();
      expect(() =>
        mgr.register({
          id: 'broken',
          name: 'Broken',
          capabilities: {},
          supportedMarkets: ['yfinance_us_equity', 'not_a_market'],
          checkConnection: () => Promise.resolve({ connected: true }),
        } as any),
      ).toThrow(/invalid MarketId 'not_a_market'/);
    });

    it('accepts valid supportedMarkets and stores the provider', () => {
      const mgr = new DataProviderManager();
      const p = fakeProvider('yfinance', ['yfinance_us_equity', 'yfinance_forex']);
      mgr.register(p);
      expect(mgr.getProvider('yfinance')).toBe(p);
    });
  });

  // -------------------------------------------------------------------------
  // (f) preference change emits the cache-invalidation event
  // -------------------------------------------------------------------------
  describe('(f) preference-changed event', () => {
    it('fires data-routing:preference-changed when writeMarketPreference is called', () => {
      const listener = vi.fn();
      const unsubscribe = dataRouting.subscribeToPreferenceChange(listener);

      dataRouting.writeMarketPreference('dukascopy_forex', ['dukascopy', 'yfinance']);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        market: 'dukascopy_forex',
        preference: ['dukascopy', 'yfinance'],
      });

      unsubscribe();
    });

    it('does not fire for unrelated subscribers after unsubscribe', () => {
      const listener = vi.fn();
      const unsubscribe = dataRouting.subscribeToPreferenceChange(listener);
      unsubscribe();

      dataRouting.writeMarketPreference('dukascopy_forex', ['dukascopy']);
      expect(listener).not.toHaveBeenCalled();
    });

    it('rejects writes that name an unknown DataProviderId (TICKET_857)', () => {
      expect(() =>
        dataRouting.writeMarketPreference('yfinance_us_equity', ['totally_made_up' as any]),
      ).toThrow(/not a valid DataProviderId/);
    });

    it('rejects reads/writes for invalid MarketId values', () => {
      expect(() =>
        dataRouting.readMarketPreference('not_a_market' as any),
      ).toThrow(/not a valid MarketId/);
      expect(() =>
        dataRouting.writeMarketPreference('not_a_market' as any, []),
      ).toThrow(/not a valid MarketId/);
    });
  });
});

// ---------------------------------------------------------------------------
// Per-provider supportedMarkets contract -- pin the table from section 3.
// ---------------------------------------------------------------------------

describe('TICKET_927_2_2: provider supportedMarkets declarations (section 3 table)', () => {
  // Each provider self-declares supportedMarkets statically; the test imports
  // the class and instantiates it (most providers are pure data with no I/O
  // in the constructor) to read the declaration.

  // yfinance, dukascopy, baostock, akshare, and tushare have no I/O
  // in the constructor and can be instantiated directly. alpaca and ccxt
  // pull dynamic Pro paths -- we instantiate them via the same import the
  // manager uses.

  it.each([
    { file: '../yfinance-provider',  cls: 'YFinanceProvider',  id: 'yfinance',
      markets: ['yfinance_us_equity', 'yfinance_forex', 'yfinance_synthetic_crypto'] },
    { file: '../dukascopy-provider', cls: 'DukascopyProvider', id: 'dukascopy',
      markets: ['dukascopy_forex'] },
    { file: '../baostock-provider',  cls: 'BaoStockProvider',  id: 'baostock',
      markets: ['baostock_cn_a_share'] },
    { file: '../tushare-provider',   cls: 'TushareProvider',   id: 'tushare',
      markets: ['tushare_cn_a_share'] },
    { file: '../akshare-provider',   cls: 'AKShareProvider',   id: 'akshare',
      markets: ['akshare_cn_a_share'] },
  ])('$id declares supportedMarkets = $markets', async ({ file, cls, id, markets }) => {
    const mod: any = await import(file);
    const instance = new mod[cls]();
    expect(instance.id).toBe(id);
    expect(Array.from(instance.supportedMarkets)).toEqual(markets);
  });

  it('alpaca declares supportedMarkets = [alpaca_us_equity]', async () => {
    const { AlpacaProvider } = await import('../alpaca-provider');
    const p = new AlpacaProvider();
    expect(p.id).toBe('alpaca');
    expect(Array.from(p.supportedMarkets)).toEqual(['alpaca_us_equity']);
  });

  it('ccxt declares supportedMarkets = [ccxt_spot, ccxt_perp]', async () => {
    const { CCXTProvider } = await import('../ccxt-provider');
    const p = new CCXTProvider();
    expect(p.id).toBe('ccxt');
    expect(Array.from(p.supportedMarkets)).toEqual(['ccxt_spot', 'ccxt_perp']);
  });
});
