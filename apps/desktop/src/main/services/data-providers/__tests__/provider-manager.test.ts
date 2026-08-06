/**
 * Unit tests for DataProviderManager, initializeDataProviderManager, getDataProviderManager
 * TICKET_883: Added cache, cold-cache, TTL, in-flight dedup, refreshSingleProvider tests
 *
 * @see ../provider-manager.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks -- must be declared before dynamic import
// ---------------------------------------------------------------------------

// TICKET_927_2_2: register() now requires non-empty supportedMarkets; the
// initializeDataProviderManager() tests below exercise the real registration
// path so mocks MUST mirror the production declarations.
vi.mock('../yfinance-provider', () => ({
  YFinanceProvider: class {
    id = 'yfinance'; name = 'Yahoo Finance';
    capabilities = { requiresAuth: false, cacheSchema: 'OHLCV_V1_CANONICAL' };
    supportedMarkets = ['yfinance_us_equity', 'yfinance_forex', 'yfinance_synthetic_crypto'];
    async checkConnection() { return { connected: true, latencyMs: 10 }; }
  },
}));
vi.mock('../alpaca-provider', () => ({
  AlpacaProvider: class {
    id = 'alpaca'; name = 'Alpaca Markets';
    capabilities = { requiresAuth: false, cacheSchema: 'OHLCV_V1_CANONICAL' };
    supportedMarkets = ['alpaca_us_equity'];
    async checkConnection() { return { connected: true, latencyMs: 10 }; }
  },
}));
vi.mock('../dukascopy-provider', () => ({
  DukascopyProvider: class {
    id = 'dukascopy'; name = 'Dukascopy';
    capabilities = { requiresAuth: false, cacheSchema: 'OHLCV_V1_CANONICAL' };
    supportedMarkets = ['dukascopy_forex'];
    async checkConnection() { return { connected: true, latencyMs: 10 }; }
  },
}));
vi.mock('../ccxt-provider', () => ({
  CCXTProvider: class {
    id = 'ccxt'; name = 'CCXT Crypto (Free)';
    capabilities = { requiresAuth: false, cacheSchema: 'OHLCV_V1_CANONICAL' };
    supportedMarkets = ['ccxt_spot', 'ccxt_perp'];
    async checkConnection() { return { connected: true, latencyMs: 10 }; }
  },
}));
vi.mock('../baostock-provider', () => ({
  BaoStockProvider: class {
    id = 'baostock'; name = 'BaoStock A-Share (Free)';
    capabilities = { requiresAuth: false, cacheSchema: 'OHLCV_V1_CANONICAL' };
    supportedMarkets = ['baostock_cn_a_share'];
    async checkConnection() { return { connected: true, latencyMs: 10 }; }
  },
}));
vi.mock('../akshare-provider', () => ({
  AKShareProvider: class {
    id = 'akshare'; name = 'AKShare A-Share (Free)';
    capabilities = { requiresAuth: false, cacheSchema: 'OHLCV_V1_CANONICAL' };
    supportedMarkets = ['akshare_cn_a_share'];
    async checkConnection() { return { connected: true, latencyMs: 10 }; }
  },
}));
vi.mock('../tushare-provider', () => ({
  TushareProvider: class {
    id = 'tushare'; name = 'Tushare Pro A-Share';
    capabilities = { requiresAuth: true, cacheSchema: 'OHLCV_V1_CANONICAL' };
    supportedMarkets = ['tushare_cn_a_share'];
    async checkConnection() { return { connected: true, latencyMs: 10 }; }
  },
}));

vi.mock('../../../utils/logger', () => ({
  appLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../i18n/main-strings', () => ({
  mainT: vi.fn((_locale: string, _ns: string, key: string, params?: Record<string, string | number>) => {
    if (!params) return key;
    return `${key}: ${JSON.stringify(params)}`;
  }),
}));

vi.mock('../../distribution-service', () => ({
  isPublicRelease: () => true,
}));

vi.mock('../../locale-service', () => ({
  getCurrentMainLocale: vi.fn().mockReturnValue('en_US'),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(id: string, opts?: {
  connected?: boolean;
  reason?: string;
  latencyMs?: number;
  error?: string;
  checkDelay?: number;
  checkThrows?: boolean;
  /** TICKET_927_2_2: defaults to a single dummy MarketId so register() accepts the stub. */
  supportedMarkets?: ReadonlyArray<string>;
}) {
  const { connected = true, reason, latencyMs = 5, error, checkDelay = 0, checkThrows = false, supportedMarkets = ['yfinance_us_equity'] } = opts ?? {};
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    capabilities: { requiresAuth: false, cacheSchema: 'OHLCV_V1_CANONICAL' },
    supportedMarkets,
    checkConnection: vi.fn().mockImplementation(() => {
      if (checkThrows) return Promise.reject(new Error('boom'));
      const result = { connected, latencyMs, error, reason };
      return checkDelay > 0
        ? new Promise(r => setTimeout(() => r(result), checkDelay))
        : Promise.resolve(result);
    }),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests for DataProviderManager class
// ---------------------------------------------------------------------------

describe('DataProviderManager', () => {
  let DataProviderManager: typeof import('../provider-manager').DataProviderManager;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../provider-manager');
    DataProviderManager = mod.DataProviderManager;
  });

  // TICKET_927_2_2: every provider used in these tests carries a dummy
  // supportedMarkets so register() validation accepts the stub.
  const DUMMY_MARKETS = ['yfinance_us_equity'];

  describe('register()', () => {
    it('adds a provider', () => {
      const mgr = new DataProviderManager();
      const provider = { id: 'test', name: 'Test', capabilities: { cacheSchema: 'OHLCV_V1_CANONICAL' }, supportedMarkets: DUMMY_MARKETS } as any;
      mgr.register(provider);
      expect(mgr.getProvider('test')).toBe(provider);
    });

    it('overwrites an existing provider with the same id', () => {
      const mgr = new DataProviderManager();
      const p1 = { id: 'dup', name: 'First', capabilities: { cacheSchema: 'OHLCV_V1_CANONICAL' }, supportedMarkets: DUMMY_MARKETS } as any;
      const p2 = { id: 'dup', name: 'Second', capabilities: { cacheSchema: 'OHLCV_V1_CANONICAL' }, supportedMarkets: DUMMY_MARKETS } as any;
      mgr.register(p1);
      mgr.register(p2);
      expect(mgr.getProvider('dup').name).toBe('Second');
    });
  });

  describe('getProvider()', () => {
    it('returns registered provider', () => {
      const mgr = new DataProviderManager();
      const provider = { id: 'abc', name: 'ABC', capabilities: { cacheSchema: 'OHLCV_V1_CANONICAL' }, supportedMarkets: DUMMY_MARKETS } as any;
      mgr.register(provider);
      expect(mgr.getProvider('abc')).toBe(provider);
    });

    it('throws for unknown id and lists available providers', () => {
      const mgr = new DataProviderManager();
      mgr.register({ id: 'a', name: 'A', capabilities: { cacheSchema: 'OHLCV_V1_CANONICAL' }, supportedMarkets: DUMMY_MARKETS } as any);
      mgr.register({ id: 'b', name: 'B', capabilities: { cacheSchema: 'OHLCV_V1_CANONICAL' }, supportedMarkets: DUMMY_MARKETS } as any);
      expect(() => mgr.getProvider('missing')).toThrow(/providers\.notFound/);
      expect(() => mgr.getProvider('missing')).toThrow(/a, b/);
    });
  });

  describe('getDefaultProvider()', () => {
    it('returns the first registered provider', () => {
      const mgr = new DataProviderManager();
      const first = { id: 'first', name: 'First', capabilities: { cacheSchema: 'OHLCV_V1_CANONICAL' }, supportedMarkets: DUMMY_MARKETS } as any;
      mgr.register(first);
      mgr.register({ id: 'second', name: 'Second', capabilities: { cacheSchema: 'OHLCV_V1_CANONICAL' }, supportedMarkets: DUMMY_MARKETS } as any);
      expect(mgr.getDefaultProvider()).toBe(first);
    });

    it('throws when no providers are registered', () => {
      const mgr = new DataProviderManager();
      expect(() => mgr.getDefaultProvider()).toThrow(/providers\.noneRegistered/);
    });
  });

  describe('listProviders()', () => {
    it('returns all providers with capabilities', () => {
      const mgr = new DataProviderManager();
      const caps = { requiresAuth: false, supportsSearch: true, cacheSchema: 'OHLCV_V1_CANONICAL' };
      mgr.register({ id: 'x', name: 'X', capabilities: caps, supportedMarkets: DUMMY_MARKETS } as any);
      mgr.register({ id: 'y', name: 'Y', capabilities: caps, supportedMarkets: DUMMY_MARKETS } as any);

      const list = mgr.listProviders();
      expect(list).toHaveLength(2);
      expect(list[0]).toEqual({ id: 'x', name: 'X', capabilities: caps });
      expect(list[1]).toEqual({ id: 'y', name: 'Y', capabilities: caps });
    });
  });
});

// ---------------------------------------------------------------------------
// TICKET_883: Provider status cache tests
// ---------------------------------------------------------------------------

describe('Provider status cache (TICKET_883)', () => {
  let DataProviderManager: typeof import('../provider-manager').DataProviderManager;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const mod = await import('../provider-manager');
    DataProviderManager = mod.DataProviderManager;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getCachedProviders() -- cold cache', () => {
    it('returns all registered providers with status=checking when cache is empty', () => {
      const mgr = new DataProviderManager();
      mgr.register(makeProvider('alpha'));
      mgr.register(makeProvider('beta'));

      const cached = mgr.getCachedProviders();
      expect(cached).toHaveLength(2);
      expect(cached[0].status).toBe('checking');
      expect(cached[1].status).toBe('checking');
      expect(cached[0].id).toBe('alpha');
      expect(cached[1].id).toBe('beta');
    });

    it('includes capabilities in cold-cache response', () => {
      const mgr = new DataProviderManager();
      const p = makeProvider('test');
      p.capabilities = { requiresAuth: true, supportsSearch: false, cacheSchema: 'OHLCV_V1_CANONICAL' };
      mgr.register(p);

      const cached = mgr.getCachedProviders();
      expect(cached[0].capabilities).toEqual({ requiresAuth: true, supportsSearch: false, cacheSchema: 'OHLCV_V1_CANONICAL' });
    });
  });

  describe('refreshAllProviders()', () => {
    it('populates cache with real connection status', async () => {
      const mgr = new DataProviderManager();
      mgr.register(makeProvider('ok', { connected: true, latencyMs: 42 }));
      mgr.register(makeProvider('fail', { connected: false, reason: 'not-configured' }));

      await mgr.refreshAllProviders();

      const cached = mgr.getCachedProviders();
      expect(cached).toHaveLength(2);

      const ok = cached.find(c => c.id === 'ok')!;
      expect(ok.status).toBe('connected');
      expect(ok.latencyMs).toBe(42);

      const fail = cached.find(c => c.id === 'fail')!;
      expect(fail.status).toBe('not-configured');
    });

    it('maps disconnected status correctly', async () => {
      const mgr = new DataProviderManager();
      mgr.register(makeProvider('dc', { connected: false }));

      await mgr.refreshAllProviders();
      const cached = mgr.getCachedProviders();
      expect(cached[0].status).toBe('disconnected');
    });

    it('catches checkConnection errors and sets status=error', async () => {
      const mgr = new DataProviderManager();
      mgr.register(makeProvider('broken', { checkThrows: true }));

      await mgr.refreshAllProviders();
      const cached = mgr.getCachedProviders();
      expect(cached[0].status).toBe('error');
      expect(cached[0].error).toBe('boom');
    });

    it('fires statusChangeListener on status change', async () => {
      const mgr = new DataProviderManager();
      mgr.register(makeProvider('a', { connected: true }));
      const listener = vi.fn();
      mgr.onStatusChange(listener);

      await mgr.refreshAllProviders();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toHaveLength(1);
      expect(listener.mock.calls[0][0][0].status).toBe('connected');
    });

    it('does not fire listener when status unchanged on second refresh', async () => {
      const mgr = new DataProviderManager();
      mgr.register(makeProvider('stable', { connected: true }));
      const listener = vi.fn();
      mgr.onStatusChange(listener);

      await mgr.refreshAllProviders();
      expect(listener).toHaveBeenCalledTimes(1);

      await mgr.refreshAllProviders();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('in-flight deduplication', () => {
    it('two concurrent refreshAllProviders() share one promise', async () => {
      const mgr = new DataProviderManager();
      const p = makeProvider('slow', { connected: true, checkDelay: 50 });
      mgr.register(p);

      const p1 = mgr.refreshAllProviders();
      const p2 = mgr.refreshAllProviders();

      vi.advanceTimersByTime(100);
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toEqual(r2);
      expect(p.checkConnection).toHaveBeenCalledTimes(1);
    });

    it('refreshPromise is cleared after completion, allowing a fresh refresh', async () => {
      const mgr = new DataProviderManager();
      const p = makeProvider('twice', { connected: true });
      mgr.register(p);

      await mgr.refreshAllProviders();
      await mgr.refreshAllProviders();

      expect(p.checkConnection).toHaveBeenCalledTimes(2);
    });
  });

  describe('isCacheStale()', () => {
    it('returns true before any refresh', () => {
      const mgr = new DataProviderManager();
      expect(mgr.isCacheStale()).toBe(true);
    });

    it('returns false immediately after refresh', async () => {
      const mgr = new DataProviderManager();
      mgr.register(makeProvider('a', { connected: true }));
      await mgr.refreshAllProviders();
      expect(mgr.isCacheStale()).toBe(false);
    });

    it('returns true after TTL expires (5 minutes)', async () => {
      const mgr = new DataProviderManager();
      mgr.register(makeProvider('a', { connected: true }));
      await mgr.refreshAllProviders();

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(mgr.isCacheStale()).toBe(true);
    });
  });

  describe('refreshSingleProvider()', () => {
    it('updates cache for a single provider', async () => {
      const mgr = new DataProviderManager();
      mgr.register(makeProvider('alpha', { connected: true }));
      mgr.register(makeProvider('beta', { connected: false }));

      await mgr.refreshAllProviders();

      const betaProvider = mgr.getProvider('beta') as any;
      betaProvider.checkConnection.mockResolvedValue({ connected: true, latencyMs: 1 });

      const entry = await mgr.refreshSingleProvider('beta');
      expect(entry!.status).toBe('connected');

      const cached = mgr.getCachedProviders();
      const beta = cached.find(c => c.id === 'beta')!;
      expect(beta.status).toBe('connected');
    });

    it('returns null for unregistered provider id', async () => {
      const mgr = new DataProviderManager();
      const result = await mgr.refreshSingleProvider('nonexistent');
      expect(result).toBeNull();
    });

    it('fires statusChangeListener when single-provider status changes', async () => {
      const mgr = new DataProviderManager();
      mgr.register(makeProvider('x', { connected: true }));
      await mgr.refreshAllProviders();

      const listener = vi.fn();
      mgr.onStatusChange(listener);

      const p = mgr.getProvider('x') as any;
      p.checkConnection.mockResolvedValue({ connected: false });

      await mgr.refreshSingleProvider('x');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not fire listener when single-provider status is unchanged', async () => {
      const mgr = new DataProviderManager();
      mgr.register(makeProvider('x', { connected: true }));
      await mgr.refreshAllProviders();

      const listener = vi.fn();
      mgr.onStatusChange(listener);

      await mgr.refreshSingleProvider('x');
      expect(listener).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests for singleton functions
// ---------------------------------------------------------------------------

describe('Singleton lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('initializeDataProviderManager()', () => {
    it('registers the five public base providers', async () => {
      const { initializeDataProviderManager, getDataProviderManager } = await import('../provider-manager');
      initializeDataProviderManager();
      await new Promise(resolve => setTimeout(resolve, 0));
      const mgr = getDataProviderManager();
      const list = mgr.listProviders();
      expect(list).toHaveLength(5);

      const ids = list.map(p => p.id);
      expect(ids).toContain('yfinance');
      expect(ids).toContain('dukascopy');
      expect(ids).toContain('baostock');
      expect(ids).toContain('akshare');
      expect(ids).toContain('tushare');
    });

    it('logs warning on duplicate initialization', async () => {
      const { initializeDataProviderManager } = await import('../provider-manager');
      const { appLog } = await import('../../../utils/logger');

      initializeDataProviderManager();
      initializeDataProviderManager();

      expect(appLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('Already initialized'),
      );
    });

    it('refreshes public providers after registration', async () => {
      const { initializeDataProviderManager, getDataProviderManager } = await import('../provider-manager');
      initializeDataProviderManager();
      await new Promise(resolve => setTimeout(resolve, 50));

      const mgr = getDataProviderManager();
      const cached = mgr.getCachedProviders();
      const hasRealStatus = cached.some(c => c.status !== 'checking');
      expect(hasRealStatus).toBe(true);
    });
  });

  describe('getDataProviderManager()', () => {
    it('returns instance after initialization', async () => {
      const { initializeDataProviderManager, getDataProviderManager } = await import('../provider-manager');
      initializeDataProviderManager();
      const mgr = getDataProviderManager();
      expect(mgr).toBeDefined();
      expect(mgr.listProviders().length).toBeGreaterThan(0);
    });

    it('throws before initialization', async () => {
      const { getDataProviderManager } = await import('../provider-manager');
      expect(() => getDataProviderManager()).toThrow(/not initialized/);
    });
  });
});

// ---------------------------------------------------------------------------
// TICKET_883 Phase 3: Invalidation trigger tests
// ---------------------------------------------------------------------------

describe('TICKET_883 Phase 3: resolveDataProviderFromCredential()', () => {
  let resolveDataProviderFromCredential: typeof import('../provider-manager').resolveDataProviderFromCredential;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../provider-manager');
    resolveDataProviderFromCredential = mod.resolveDataProviderFromCredential;
  });

  it('resolves alpaca.apiKeyId to alpaca', () => {
    expect(resolveDataProviderFromCredential('com.stratcraft.back-test-nexus', 'alpaca.apiKeyId')).toBe('alpaca');
  });

  it('resolves alpaca.apiSecretKey to alpaca', () => {
    expect(resolveDataProviderFromCredential('com.stratcraft.back-test-nexus', 'alpaca.apiSecretKey')).toBe('alpaca');
  });

  it('resolves alphaVantage.apiKey to alpha_vantage', () => {
    expect(resolveDataProviderFromCredential('com.stratcraft.back-test-nexus', 'alphaVantage.apiKey')).toBe('alpha_vantage');
  });

  it('resolves polygon.apiKey to polygon', () => {
    expect(resolveDataProviderFromCredential('com.stratcraft.back-test-nexus', 'polygon.apiKey')).toBe('polygon');
  });

  it('returns null for unknown credential key', () => {
    expect(resolveDataProviderFromCredential('com.stratcraft.back-test-nexus', 'unknown.key')).toBeNull();
  });

  it('returns null for wrong pluginId even with valid key', () => {
    expect(resolveDataProviderFromCredential('com.other.plugin', 'alpaca.apiKeyId')).toBeNull();
  });

  it('returns null for LLM credential keys', () => {
    expect(resolveDataProviderFromCredential('com.stratcraft.back-test-nexus', 'llm.openai.apiKey')).toBeNull();
  });
});

describe('TICKET_883 Phase 3: updateProviderStatus()', () => {
  let DataProviderManager: typeof import('../provider-manager').DataProviderManager;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../provider-manager');
    DataProviderManager = mod.DataProviderManager;
  });

  it('sets status directly without checkConnection', () => {
    const mgr = new DataProviderManager();
    const p = makeProvider('clickhouse', { connected: true });
    mgr.register(p);

    mgr.updateProviderStatus('clickhouse', 'disconnected');

    const cached = mgr.getCachedProviders();
    const ch = cached.find(c => c.id === 'clickhouse')!;
    expect(ch.status).toBe('disconnected');
    expect(p.checkConnection).not.toHaveBeenCalled();
  });

  it('includes error string when provided', () => {
    const mgr = new DataProviderManager();
    mgr.register(makeProvider('clickhouse'));

    mgr.updateProviderStatus('clickhouse', 'error', 'Connection refused');

    const cached = mgr.getCachedProviders();
    expect(cached[0].error).toBe('Connection refused');
  });

  it('fires statusChangeListener when status differs from cached', async () => {
    const mgr = new DataProviderManager();
    mgr.register(makeProvider('ch', { connected: true }));
    await mgr.refreshAllProviders();

    const listener = vi.fn();
    mgr.onStatusChange(listener);

    mgr.updateProviderStatus('ch', 'disconnected');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not fire listener when status unchanged', async () => {
    const mgr = new DataProviderManager();
    mgr.register(makeProvider('ch', { connected: true }));
    await mgr.refreshAllProviders();

    const listener = vi.fn();
    mgr.onStatusChange(listener);

    mgr.updateProviderStatus('ch', 'connected');
    expect(listener).not.toHaveBeenCalled();
  });

  it('fires listener on first set (no prior cache entry)', () => {
    const mgr = new DataProviderManager();
    mgr.register(makeProvider('ch'));

    const listener = vi.fn();
    mgr.onStatusChange(listener);

    mgr.updateProviderStatus('ch', 'disconnected');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('silently skips unregistered provider', () => {
    const mgr = new DataProviderManager();
    const listener = vi.fn();
    mgr.onStatusChange(listener);

    mgr.updateProviderStatus('nonexistent', 'disconnected');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('TICKET_1327 F2: DATA_PROVIDER_CREDENTIALS is the shared definition', () => {
  // TICKET_1327 F2: this describe block used to assert the shape of a
  // main-process MIRROR of the plugin's credential map. The mirror is deleted;
  // `provider-manager.ts` now re-exports the single definition from
  // `@StratCraft/types`, so these tests assert the re-export and the shape of
  // the one owner.
  //
  // Two facts worth recording about the old mirror, both symptomatic of the
  // drift TICKET_1327 exists to end:
  //   1. It was an ARRAY of `{ providerId, pluginId, keys }`; the shared owner
  //      is a RECORD keyed by provider id with `requiredKeys` -- the same shape
  //      the renderer gate already used.
  //   2. The assertion below used to read "exactly 3 entries: alpaca,
  //      alpha_vantage, polygon" while the mirror it tested actually contained
  //      FOUR (it also had tushare). The test had silently drifted from its own
  //      subject.
  it('re-exports the same object as the shared owner (no local copy)', async () => {
    vi.resetModules();
    const { DATA_PROVIDER_CREDENTIALS } = await import('../provider-manager');
    const shared = await import('@StratCraft/types');
    // Identity, not deep equality: a second copy would pass `toEqual` while
    // reintroducing exactly the divergence risk F2 removes.
    expect(DATA_PROVIDER_CREDENTIALS).toBe(shared.DATA_PROVIDER_CREDENTIALS);
  });

  it('covers all four BYOK providers, including tushare', async () => {
    vi.resetModules();
    const { DATA_PROVIDER_CREDENTIALS } = await import('../provider-manager');
    expect(Object.keys(DATA_PROVIDER_CREDENTIALS).sort())
      .toEqual(['alpaca', 'alpha_vantage', 'polygon', 'tushare']);
  });

  it('all entries use pluginId com.stratcraft.back-test-nexus', async () => {
    vi.resetModules();
    const { DATA_PROVIDER_CREDENTIALS } = await import('../provider-manager');
    for (const entry of Object.values(DATA_PROVIDER_CREDENTIALS)) {
      expect(entry.pluginId).toBe('com.stratcraft.back-test-nexus');
    }
  });

  it('alpaca has two required keys (apiKeyId + apiSecretKey)', async () => {
    vi.resetModules();
    const { DATA_PROVIDER_CREDENTIALS } = await import('../provider-manager');
    expect([...DATA_PROVIDER_CREDENTIALS.alpaca.requiredKeys])
      .toEqual(['alpaca.apiKeyId', 'alpaca.apiSecretKey']);
  });
});
