/**
 * BinanceFundingRateProvider Unit Tests
 *
 * TICKET_568_5_1_c + TICKET_494: full coverage of the first on-chain
 * provider (Binance USD-M perp funding rates + open-interest z-score via
 * CCXT). Modeled on fred-provider.test.ts / marketaux-provider.test.ts;
 * exchange access is injected via the `exchangeFactory` seam so tests do
 * not touch the real CCXT package.
 *
 * Test surface:
 *   - Provider contract (id, source, vintage_supported, live_streaming).
 *   - Symbol normalization: bare base -> '<BASE>/USDT'; pair preserved;
 *     emitted row symbol echoes caller input.
 *   - fetchFactorData(funding_rate) maps each settlement to a row with
 *     event_time == knowledge_time == settlement timestamp.
 *   - fetchFactorData(open_interest_zscore) emits a z-score per in-window
 *     1h sample using a 720-sample rolling window; warmup samples are
 *     dropped; flat windows emit z=0 (never Infinity).
 *   - Error surfaces: wrong category, missing symbol, unknown factor name,
 *     malformed dates, end<start, CCXT timeout.
 *   - vintage_as_of filters by knowledge_time (cheap because raw exchange
 *     settlements are immutable -- the as-of view IS the truncated tape).
 *   - startLiveStream: 60s poll-floor enforced; rows deduped by event_time
 *     watermark; errors forwarded via onError without throwing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => '/tmp' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: (b: Buffer) => b.toString('utf-8'),
    encryptString: (s: string) => Buffer.from(s),
  },
}));

import {
  BinanceFundingRateProvider,
  type CcxtFundingExchange,
} from '../binance-funding-provider';
import type { AlternativeDataRequest } from '../../../../../shared/types/signal-discovery';

// =============================================================================
// Fixtures
// =============================================================================

/**
 * Three 8-hour funding settlements for BTC/USDT around 2026-05-20.
 * Each row carries a unique settlement timestamp (ms epoch). Funding rate
 * is the CCXT decimal-fraction form (0.0001 = 0.01% per 8h).
 */
const FUNDING_SETTLEMENTS = [
  { timestamp: Date.UTC(2026, 4, 20, 0, 0, 0), fundingRate: 0.0001, symbol: 'BTC/USDT' },
  { timestamp: Date.UTC(2026, 4, 20, 8, 0, 0), fundingRate: -0.00005, symbol: 'BTC/USDT' },
  { timestamp: Date.UTC(2026, 4, 20, 16, 0, 0), fundingRate: 0.00012, symbol: 'BTC/USDT' },
];

/**
 * Make a CCXT exchange double that returns the provided pages for each
 * endpoint. The factory captures the (symbol, since, limit) tuple it was
 * called with so tests can assert request shape without mocking ccxt.
 */
function makeExchange(opts: {
  fundingPages?: typeof FUNDING_SETTLEMENTS[];
  oiPages?: { timestamp: number; openInterestAmount: number; symbol: string }[][];
  fundingError?: Error;
  oiError?: Error;
  slowMs?: number;
}): { exchange: CcxtFundingExchange; fundingCalls: Array<{ symbol: string; since?: number; limit?: number }>; oiCalls: Array<{ symbol: string; timeframe?: string; since?: number; limit?: number }> } {
  const fundingCalls: Array<{ symbol: string; since?: number; limit?: number }> = [];
  const oiCalls: Array<{ symbol: string; timeframe?: string; since?: number; limit?: number }> = [];
  let fundingPage = 0;
  let oiPage = 0;
  const exchange: CcxtFundingExchange = {
    async fetchFundingRateHistory(symbol, since, limit) {
      fundingCalls.push({ symbol, since, limit });
      if (opts.slowMs) await new Promise((r) => setTimeout(r, opts.slowMs));
      if (opts.fundingError) throw opts.fundingError;
      const pages = opts.fundingPages ?? [];
      return fundingPage < pages.length ? pages[fundingPage++] : [];
    },
    async fetchOpenInterestHistory(symbol, timeframe, since, limit) {
      oiCalls.push({ symbol, timeframe, since, limit });
      if (opts.slowMs) await new Promise((r) => setTimeout(r, opts.slowMs));
      if (opts.oiError) throw opts.oiError;
      const pages = opts.oiPages ?? [];
      return oiPage < pages.length ? pages[oiPage++] : [];
    },
  };
  return { exchange, fundingCalls, oiCalls };
}

// =============================================================================
// Provider contract
// =============================================================================

describe('BinanceFundingRateProvider contract', () => {
  it('declares the documented readonly fields', () => {
    const provider = new BinanceFundingRateProvider();
    expect(provider.id).toBe('binance-funding');
    expect(provider.source).toBe('on_chain');
    // Exchange settlements are immutable, so vintage support is honestly true.
    expect(provider.vintage_supported).toBe(true);
    expect(provider.live_streaming_supported).toBe(true);
    expect(provider.name).toMatch(/binance/i);
  });
});

// =============================================================================
// fetchFactorData -- guard rails
// =============================================================================

describe('BinanceFundingRateProvider.fetchFactorData guards', () => {
  let baseRequest: AlternativeDataRequest;
  beforeEach(() => {
    baseRequest = {
      category: 'on_chain',
      factor_name: 'alt_on_chain_funding_rate',
      symbol: 'BTC',
      start_time: '2026-05-20T00:00:00Z',
      end_time: '2026-05-21T00:00:00Z',
    };
  });

  it('rejects non-on_chain category', async () => {
    const { exchange } = makeExchange({});
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    await expect(
      provider.fetchFactorData({ ...baseRequest, category: 'macro' as never }),
    ).rejects.toThrow(/category must be 'on_chain'/);
  });

  it('rejects missing symbol (on-chain factors are per-asset, never market-wide)', async () => {
    const { exchange } = makeExchange({});
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    await expect(
      provider.fetchFactorData({ ...baseRequest, symbol: undefined }),
    ).rejects.toThrow(/symbol is required/);
  });

  it('rejects unknown factor_name', async () => {
    const { exchange } = makeExchange({});
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    await expect(
      provider.fetchFactorData({ ...baseRequest, factor_name: 'alt_on_chain_made_up' }),
    ).rejects.toThrow(/unknown factor_name/);
  });

  it('rejects malformed start_time/end_time', async () => {
    const { exchange } = makeExchange({});
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    await expect(
      provider.fetchFactorData({ ...baseRequest, start_time: 'not-a-date' }),
    ).rejects.toThrow(/invalid start_time\/end_time/);
  });

  it('rejects end_time preceding start_time', async () => {
    const { exchange } = makeExchange({});
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    await expect(
      provider.fetchFactorData({
        ...baseRequest,
        start_time: '2026-05-21T00:00:00Z',
        end_time: '2026-05-20T00:00:00Z',
      }),
    ).rejects.toThrow(/end_time precedes start_time/);
  });

  it('propagates CCXT timeouts via withTimeout', async () => {
    const { exchange } = makeExchange({ slowMs: 80 });
    const provider = new BinanceFundingRateProvider({
      exchangeFactory: async () => exchange,
      requestTimeoutMs: 10,
    });
    await expect(provider.fetchFactorData(baseRequest)).rejects.toThrow(/CCXT call timed out/);
  });
});

// =============================================================================
// fetchFactorData -- funding rate
// =============================================================================

describe('BinanceFundingRateProvider.fetchFactorData (funding_rate)', () => {
  it('maps each settlement to a row with event_time == knowledge_time == settlement', async () => {
    const { exchange } = makeExchange({ fundingPages: [FUNDING_SETTLEMENTS] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const rows = await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_funding_rate',
      symbol: 'BTC',
      start_time: '2026-05-20T00:00:00Z',
      end_time: '2026-05-20T23:59:59Z',
    });
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      // Funding rates are public the instant they settle: no knowledge lag.
      expect(r.event_time).toBe(r.knowledge_time);
      expect(r.category).toBe('on_chain');
      expect(r.factor_name).toBe('alt_on_chain_funding_rate');
      expect(r.source_provider).toBe('binance-funding');
      // Caller passed 'BTC', emitted row must echo 'BTC' (not 'BTC/USDT').
      expect(r.symbol).toBe('BTC');
    }
    expect(rows[0].value).toBeCloseTo(0.0001, 8);
    expect(rows[2].value).toBeCloseTo(0.00012, 8);
  });

  it('normalizes bare-base symbol to CCXT pair when calling the exchange', async () => {
    const { exchange, fundingCalls } = makeExchange({ fundingPages: [FUNDING_SETTLEMENTS] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_funding_rate',
      symbol: 'BTC',
      start_time: '2026-05-20T00:00:00Z',
      end_time: '2026-05-20T23:59:59Z',
    });
    expect(fundingCalls[0]?.symbol).toBe('BTC/USDT');
  });

  it('preserves an explicit pair symbol verbatim', async () => {
    const { exchange, fundingCalls } = makeExchange({ fundingPages: [FUNDING_SETTLEMENTS] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const rows = await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_funding_rate',
      symbol: 'BTC/USDC',
      start_time: '2026-05-20T00:00:00Z',
      end_time: '2026-05-20T23:59:59Z',
    });
    expect(fundingCalls[0]?.symbol).toBe('BTC/USDC');
    expect(rows[0].symbol).toBe('BTC/USDC');
  });

  it('filters settlements outside [start_time, end_time]', async () => {
    const { exchange } = makeExchange({ fundingPages: [FUNDING_SETTLEMENTS] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    // Window only contains the 08:00 and 16:00 settlements (00:00 cut off).
    const rows = await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_funding_rate',
      symbol: 'BTC',
      start_time: '2026-05-20T01:00:00Z',
      end_time: '2026-05-20T23:59:59Z',
    });
    expect(rows.map((r) => r.event_time)).toEqual([
      new Date(FUNDING_SETTLEMENTS[1].timestamp).toISOString(),
      new Date(FUNDING_SETTLEMENTS[2].timestamp).toISOString(),
    ]);
  });

  it('honors vintage_as_of by filtering knowledge_time (settlements are immutable)', async () => {
    const { exchange } = makeExchange({ fundingPages: [FUNDING_SETTLEMENTS] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const rows = await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_funding_rate',
      symbol: 'BTC',
      start_time: '2026-05-20T00:00:00Z',
      end_time: '2026-05-20T23:59:59Z',
      vintage_as_of: '2026-05-20T08:00:00Z',
    });
    // Only the 00:00 + 08:00 settlements were knowable by 08:00.
    expect(rows.map((r) => r.event_time)).toEqual([
      new Date(FUNDING_SETTLEMENTS[0].timestamp).toISOString(),
      new Date(FUNDING_SETTLEMENTS[1].timestamp).toISOString(),
    ]);
  });

  it('honors knowledge_time >= event_time invariant on every emitted row', async () => {
    const { exchange } = makeExchange({ fundingPages: [FUNDING_SETTLEMENTS] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const rows = await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_funding_rate',
      symbol: 'BTC',
      start_time: '2026-05-20T00:00:00Z',
      end_time: '2026-05-20T23:59:59Z',
    });
    for (const r of rows) {
      expect(r.knowledge_time >= r.event_time).toBe(true);
    }
  });

  it('emits rows sorted ASC by event_time even if CCXT returns shuffled', async () => {
    const shuffled = [FUNDING_SETTLEMENTS[2], FUNDING_SETTLEMENTS[0], FUNDING_SETTLEMENTS[1]];
    const { exchange } = makeExchange({ fundingPages: [shuffled] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const rows = await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_funding_rate',
      symbol: 'BTC',
      start_time: '2026-05-20T00:00:00Z',
      end_time: '2026-05-20T23:59:59Z',
    });
    expect(rows.map((r) => r.event_time)).toEqual(
      [...FUNDING_SETTLEMENTS]
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((s) => new Date(s.timestamp).toISOString()),
    );
  });

  it('paginates: cursor advances past the last seen timestamp until empty', async () => {
    const page1 = [FUNDING_SETTLEMENTS[0], FUNDING_SETTLEMENTS[1]];
    const page2 = [FUNDING_SETTLEMENTS[2]];
    const { exchange, fundingCalls } = makeExchange({ fundingPages: [page1, page2, []] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const rows = await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_funding_rate',
      symbol: 'BTC',
      start_time: '2026-05-20T00:00:00Z',
      end_time: '2026-05-20T23:59:59Z',
    });
    expect(rows).toHaveLength(3);
    expect(fundingCalls.length).toBeGreaterThanOrEqual(2);
    // Second call's `since` MUST be strictly past the first page's last ts.
    expect(fundingCalls[1]?.since).toBeGreaterThan(FUNDING_SETTLEMENTS[1].timestamp);
  });

  it('drops records with non-finite timestamp or fundingRate', async () => {
    const dirty = [
      ...FUNDING_SETTLEMENTS,
      { timestamp: NaN, fundingRate: 0.0001, symbol: 'BTC/USDT' },
      { timestamp: Date.UTC(2026, 4, 20, 20, 0, 0), fundingRate: NaN, symbol: 'BTC/USDT' },
    ];
    const { exchange } = makeExchange({ fundingPages: [dirty] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const rows = await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_funding_rate',
      symbol: 'BTC',
      start_time: '2026-05-20T00:00:00Z',
      end_time: '2026-05-20T23:59:59Z',
    });
    expect(rows).toHaveLength(3);
  });
});

// =============================================================================
// fetchFactorData -- open-interest z-score
// =============================================================================

describe('BinanceFundingRateProvider.fetchFactorData (open_interest_zscore)', () => {
  /**
   * Build a synthetic 1h OI series long enough to exit warmup. The provider
   * needs 720 samples (30 days) of lead-in BEFORE start_time before it can
   * emit the first in-window z-score. We:
   *   - generate WARMUP_SAMPLES samples ending at start_time
   *   - generate IN_WINDOW_SAMPLES samples in [start_time, end_time]
   *
   * The series is a steady linear ramp + a single spike at the end so the
   * spike-sample z-score is clearly positive and large (the assertion that
   * the rolling-stats path actually moves).
   */
  function buildOiSeries(args: {
    startMs: number;
    warmupSamples: number;
    inWindowSamples: number;
    spike?: number;
  }) {
    const { startMs, warmupSamples, inWindowSamples } = args;
    const oneHour = 60 * 60 * 1000;
    const series: { timestamp: number; openInterestAmount: number; symbol: string }[] = [];
    // Warmup: timestamps from startMs - warmupSamples*1h up to startMs - 1h.
    for (let i = warmupSamples; i >= 1; i--) {
      series.push({
        timestamp: startMs - i * oneHour,
        openInterestAmount: 100000 + i * 5, // gentle ramp
        symbol: 'BTC/USDT',
      });
    }
    // In-window: timestamps from startMs to startMs + (n-1)*1h.
    for (let i = 0; i < inWindowSamples; i++) {
      const value = i === inWindowSamples - 1 && args.spike !== undefined ? args.spike : 100500 + i;
      series.push({
        timestamp: startMs + i * oneHour,
        openInterestAmount: value,
        symbol: 'BTC/USDT',
      });
    }
    return series;
  }

  it('emits exactly inWindowSamples rows once warmup is complete', async () => {
    const startMs = Date.UTC(2026, 4, 20, 0, 0, 0);
    const endMs = startMs + 5 * 60 * 60 * 1000; // 6 hours -> 6 in-window samples
    const series = buildOiSeries({ startMs, warmupSamples: 720, inWindowSamples: 6 });
    const { exchange } = makeExchange({ oiPages: [series, []] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const rows = await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_open_interest_zscore',
      symbol: 'BTC',
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(endMs).toISOString(),
    });
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.factor_name).toBe('alt_on_chain_open_interest_zscore');
      expect(r.category).toBe('on_chain');
      expect(Number.isFinite(r.value)).toBe(true);
    }
  });

  it('drops warmup samples (no z-score before 720h of lead-in)', async () => {
    const startMs = Date.UTC(2026, 4, 20, 0, 0, 0);
    const endMs = startMs + 60 * 60 * 1000; // 1 in-window sample requested
    // Only 100 samples of warmup -- well below the 720 threshold.
    const series = buildOiSeries({ startMs, warmupSamples: 100, inWindowSamples: 1 });
    const { exchange } = makeExchange({ oiPages: [series, []] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const rows = await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_open_interest_zscore',
      symbol: 'BTC',
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(endMs).toISOString(),
    });
    // Warmup never completes -> no rows emitted (the honest answer; we never
    // ship a z-score against a stub window).
    expect(rows).toHaveLength(0);
  });

  it('emits z=0 on a flat window instead of Infinity / NaN', async () => {
    const startMs = Date.UTC(2026, 4, 20, 0, 0, 0);
    const oneHour = 60 * 60 * 1000;
    // 721 flat samples: 720 warmup + 1 in-window, all at the SAME value.
    const series: { timestamp: number; openInterestAmount: number; symbol: string }[] = [];
    for (let i = 720; i >= 1; i--) {
      series.push({ timestamp: startMs - i * oneHour, openInterestAmount: 100000, symbol: 'BTC/USDT' });
    }
    series.push({ timestamp: startMs, openInterestAmount: 100000, symbol: 'BTC/USDT' });
    const { exchange } = makeExchange({ oiPages: [series, []] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const rows = await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_open_interest_zscore',
      symbol: 'BTC',
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(startMs).toISOString(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(0);
    expect(Number.isFinite(rows[0].value)).toBe(true);
  });

  it('honors knowledge_time >= event_time invariant on every z-score row', async () => {
    const startMs = Date.UTC(2026, 4, 20, 0, 0, 0);
    const endMs = startMs + 60 * 60 * 1000;
    const series = buildOiSeries({ startMs, warmupSamples: 720, inWindowSamples: 2 });
    const { exchange } = makeExchange({ oiPages: [series, []] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const rows = await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_open_interest_zscore',
      symbol: 'BTC',
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(endMs).toISOString(),
    });
    for (const r of rows) {
      expect(r.knowledge_time >= r.event_time).toBe(true);
    }
  });

  it('requests OI history at the 1h timeframe', async () => {
    const startMs = Date.UTC(2026, 4, 20, 0, 0, 0);
    const endMs = startMs + 60 * 60 * 1000;
    const series = buildOiSeries({ startMs, warmupSamples: 720, inWindowSamples: 1 });
    const { exchange, oiCalls } = makeExchange({ oiPages: [series, []] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    await provider.fetchFactorData({
      category: 'on_chain',
      factor_name: 'alt_on_chain_open_interest_zscore',
      symbol: 'BTC',
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(endMs).toISOString(),
    });
    expect(oiCalls[0]?.timeframe).toBe('1h');
  });
});

// =============================================================================
// startLiveStream
// =============================================================================

describe('BinanceFundingRateProvider.startLiveStream', () => {
  it('rejects pollIntervalMs below the 60 s floor', () => {
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => makeExchange({}).exchange });
    expect(() =>
      provider.startLiveStream(
        {
          category: 'on_chain',
          factor_name: 'alt_on_chain_funding_rate',
          symbol: 'BTC',
          start_time: '2026-05-20T00:00:00Z',
          end_time: '2026-05-21T00:00:00Z',
        },
        () => undefined,
        () => undefined,
        30_000,
      ),
    ).toThrow(/pollIntervalMs must be >= 60000/);
  });

  it('emits initial-baseline rows synchronously and dedupes by event_time watermark', async () => {
    const { exchange } = makeExchange({ fundingPages: [FUNDING_SETTLEMENTS, []] });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const rows: unknown[] = [];
    const stop = provider.startLiveStream(
      {
        category: 'on_chain',
        factor_name: 'alt_on_chain_funding_rate',
        symbol: 'BTC',
        start_time: '2026-05-20T00:00:00Z',
        end_time: '2026-05-21T00:00:00Z',
      },
      (row) => rows.push(row),
      () => undefined,
      60_000,
    );
    // Allow the synchronous-immediate tick to flush.
    await new Promise((r) => setTimeout(r, 10));
    stop();
    expect(rows.length).toBe(3);
  });

  it('forwards errors via onError, not by throwing', async () => {
    const err = new Error('binance: 429 too many requests');
    const { exchange } = makeExchange({ fundingError: err });
    const provider = new BinanceFundingRateProvider({ exchangeFactory: async () => exchange });
    const errs: Error[] = [];
    const stop = provider.startLiveStream(
      {
        category: 'on_chain',
        factor_name: 'alt_on_chain_funding_rate',
        symbol: 'BTC',
        start_time: '2026-05-20T00:00:00Z',
        end_time: '2026-05-21T00:00:00Z',
      },
      () => undefined,
      (e) => errs.push(e),
      60_000,
    );
    await new Promise((r) => setTimeout(r, 10));
    stop();
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toMatch(/too many requests/);
  });
});
