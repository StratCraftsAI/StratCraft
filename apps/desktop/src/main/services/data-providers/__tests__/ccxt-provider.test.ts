/**
 * Unit tests for CCXTProvider
 *
 * @see ../ccxt-provider.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchOHLCV = vi.fn();
const mockLoadMarkets = ((initialValue) => vi.fn(async () => initialValue))({});

vi.mock('ccxt', () => ({
  binance: vi.fn(() => ({
    fetchOHLCV: mockFetchOHLCV,
    loadMarkets: mockLoadMarkets,
    symbols: ['BTC/USDT', 'ETH/USDT', 'BTC/ETH', 'SOL/USDT', 'ETHBTC'],
  })),
}));

vi.mock('../../../utils/logger', () => ({
  appLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../../shared/constants/data-providers', () => ({
  CCXT_MAX_CANDLES_PER_REQUEST: 1000,
}));

vi.mock('../../../../shared/constants/timing', () => ({
  MS_PER_SECOND: 1000,
  MS_PER_DAY: 86_400_000,
}));

vi.mock('../../../i18n/main-strings', () => ({
  mainT: vi.fn((_locale: string, _ns: string, key: string, params?: Record<string, string | number>) => {
    if (!params) return key;
    return `${key}: ${JSON.stringify(params)}`;
  }),
}));

vi.mock('../../locale-service', () => ({
  getCurrentMainLocale: ((initialValue) => vi.fn(() => initialValue))('en_US'),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CCXTProvider', () => {
  let CCXTProvider: typeof import('../ccxt-provider').CCXTProvider;
  let provider: InstanceType<typeof CCXTProvider>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset module to clear exchangeCache
    vi.resetModules();
    const mod = await import('../ccxt-provider');
    CCXTProvider = mod.CCXTProvider;
    provider = new CCXTProvider();
  });

  describe('static properties', () => {
    it('has correct id and name', () => {
      expect(provider.id).toBe('ccxt');
      expect(provider.name).toBe('CCXT Crypto (Free)');
    });

    it('has correct capabilities', () => {
      expect(provider.capabilities.requiresAuth).toBe(false);
      expect(provider.capabilities.supportsSearch).toBe(true);
      expect(provider.capabilities.assetTypes).toContain('crypto');
      expect(provider.capabilities.intervals).toContain('1m');
      expect(provider.capabilities.intervals).toContain('4h');
      expect(provider.capabilities.intervals).toContain('1d');
    });
  });

  describe('queryOHLCV()', () => {
    it('fetches candles with timestamp-based pagination and converts ms to seconds', async () => {
      const startMs = new Date('2024-01-01').getTime();
      const candle1Ts = startMs;
      const candle2Ts = startMs + 86_400_000;

      mockFetchOHLCV.mockResolvedValueOnce([
        [candle1Ts, 42000, 43000, 41000, 42500, 1000],
        [candle2Ts, 42500, 44000, 42000, 43500, 1500],
      ]);

      const rows = await provider.queryOHLCV('BTC/USDT', '1d', '2024-01-01', '2024-01-10');

      expect(mockFetchOHLCV).toHaveBeenCalledWith('BTC/USDT', '1d', startMs, 1000);
      expect(rows).toHaveLength(2);
      expect(rows[0].timestamp).toBe(Math.floor(candle1Ts / 1000));
      expect(rows[0].open).toBe(42000);
      expect(rows[1].timestamp).toBe(Math.floor(candle2Ts / 1000));
    });

    it('stops pagination when fewer candles than limit returned', async () => {
      mockFetchOHLCV.mockResolvedValueOnce([
        [new Date('2024-01-01').getTime(), 100, 110, 90, 105, 500],
      ]);

      const rows = await provider.queryOHLCV('BTC/USDT', '1d', '2024-01-01', '2024-12-31');

      expect(mockFetchOHLCV).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
    });

    it('stops when candle timestamps exceed endDate', async () => {
      const endMs = new Date('2024-01-05').getTime();
      const beyondEnd = endMs + 86_400_000;

      mockFetchOHLCV.mockResolvedValueOnce([
        [new Date('2024-01-04').getTime(), 100, 110, 90, 105, 500],
        [beyondEnd, 110, 120, 100, 115, 600],
      ]);

      const rows = await provider.queryOHLCV('BTC/USDT', '1d', '2024-01-01', '2024-01-05');

      // Only the candle before endMs should be included
      expect(rows).toHaveLength(1);
    });

    it('includes bars on the endDate day (chunk-boundary coverage)', async () => {
      const endDayStart = new Date('2024-09-16').getTime();
      const endDayBar = endDayStart + 3_600_000;

      mockFetchOHLCV.mockResolvedValueOnce([
        [endDayStart, 100, 110, 90, 105, 500],
        [endDayBar, 101, 111, 91, 106, 600],
      ]);

      const rows = await provider.queryOHLCV('BTC/USDT', '1h', '2024-09-16', '2024-09-16');

      expect(rows).toHaveLength(2);
      expect(rows[0].timestamp).toBe(Math.floor(endDayStart / 1000));
      expect(rows[1].timestamp).toBe(Math.floor(endDayBar / 1000));
    });

    it('throws for unsupported interval', async () => {
      await expect(provider.queryOHLCV('BTC/USDT', '3m', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.unsupportedInterval/);
    });
  });

  describe('searchSymbols()', () => {
    it('applies relevance sorting on market symbols', async () => {
      const response = await provider.searchSymbols('BTC');

      // TICKET_641_10: Response is wrapped { results, totalCount, truncated }
      expect(response).toHaveProperty('results');
      expect(response).toHaveProperty('totalCount');
      expect(response).toHaveProperty('truncated');

      // BTC/ETH and BTC/USDT start with BTC, ETHBTC only contains it
      expect(response.results.length).toBeGreaterThanOrEqual(3);

      // Exact match or prefix matches should come before contains
      const symbols = response.results.map(r => r.symbol);
      const btcPrefixIdx = symbols.findIndex(s => s.startsWith('BTC'));
      const containsIdx = symbols.findIndex(s => !s.toUpperCase().startsWith('BTC'));
      if (btcPrefixIdx !== -1 && containsIdx !== -1) {
        expect(btcPrefixIdx).toBeLessThan(containsIdx);
      }
    });

    it('respects limit parameter', async () => {
      const response = await provider.searchSymbols('BTC', 2);
      expect(response.results.length).toBeLessThanOrEqual(2);
    });

    it('returns crypto type for all results', async () => {
      const response = await provider.searchSymbols('ETH');
      for (const r of response.results) {
        expect(r.type).toBe('crypto');
      }
    });

    it('returns truncated: true when matches exceed limit', async () => {
      // BTC matches many symbols; limit=1 should truncate
      const response = await provider.searchSymbols('BTC', 1);
      expect(response.results.length).toBe(1);
      expect(response.totalCount).toBeGreaterThan(1);
      expect(response.truncated).toBe(true);
    });

    it('returns truncated: false when matches fit within limit', async () => {
      // Search for exact match that returns few results
      const response = await provider.searchSymbols('BTC/USDT', 100);
      expect(response.truncated).toBe(false);
      expect(response.totalCount).toBe(response.results.length);
    });
  });

  describe('checkConnection()', () => {
    it('probes BTC/USDT and returns connected', async () => {
      mockFetchOHLCV.mockResolvedValueOnce([[Date.now(), 42000, 43000, 41000, 42500, 100]]);

      const status = await provider.checkConnection();

      expect(status.connected).toBe(true);
      expect(status.latencyMs).toBeDefined();
      // Verify BTC/USDT probe
      expect(mockFetchOHLCV).toHaveBeenCalledWith('BTC/USDT', '1d', undefined, 1);
    });

    it('returns disconnected on error', async () => {
      mockFetchOHLCV.mockRejectedValueOnce(new Error('Network error'));

      const status = await provider.checkConnection();

      expect(status.connected).toBe(false);
      expect(status.error).toContain('Network error');
    });
  });

  describe('getSymbolDateRange()', () => {
    it('probes earliest and latest candles', async () => {
      const earliest = new Date('2017-08-17').getTime();
      const latest = new Date('2024-12-15').getTime();

      mockFetchOHLCV
        .mockResolvedValueOnce([[earliest, 4000, 4200, 3800, 4100, 10000]])  // earliest
        .mockResolvedValueOnce([[latest, 42000, 43000, 41000, 42500, 5000]]); // latest

      const range = await provider.getSymbolDateRange('BTC/USDT');

      expect(range.startTime).toBe('2017-08-17');
      expect(range.endTime).toBe('2024-12-15');
      expect(mockFetchOHLCV).toHaveBeenCalledTimes(2);
      // Earliest: start from 0
      expect(mockFetchOHLCV).toHaveBeenCalledWith('BTC/USDT', '1d', 0, 1);
      // Latest: undefined start
      expect(mockFetchOHLCV).toHaveBeenCalledWith('BTC/USDT', '1d', undefined, 1);
    });

    it('returns null when no candles found', async () => {
      mockFetchOHLCV
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const range = await provider.getSymbolDateRange('UNKNOWN/USDT');

      expect(range.startTime).toBeNull();
      expect(range.endTime).toBeNull();
    });
  });

  describe('lazy exchange initialization', () => {
    it('caches exchange after first call', async () => {
      mockFetchOHLCV.mockResolvedValue([[Date.now(), 100, 110, 90, 105, 500]]);

      await provider.checkConnection();
      await provider.checkConnection();

      // loadMarkets should only be called once due to caching
      expect(mockLoadMarkets).toHaveBeenCalledTimes(1);
    });
  });
});
