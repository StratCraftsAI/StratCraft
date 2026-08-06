/**
 * TICKET_077_29 Phase 2: unit tests for the Tier-0 universe-slice registry.
 *
 * Covers:
 *   - `UniverseSliceSpec` / `RankingMetricId` type shape (compile-time)
 *   - `DataSourceSlot.slice` optionality + backward compat with legacy slots
 *   - `getSymbolsForSlot` applies the top-N clip when `slot.slice` is set
 *   - `getSymbolsForSlot` is a no-op when `slot.slice` is `null` or absent
 *   - `getRankingMetricsFor` per (provider, subset) shape rules:
 *       * yfinance + yf_us_equity / yf_sp500_full -> EQUITY_METRICS
 *       * yfinance + yf_g10_fx                    -> [] (hide-on-empty)
 *       * yfinance + yf_sector_etfs               -> [] (hide-on-empty)
 *       * alpaca / Shape A equity                 -> EQUITY_METRICS
 *       * ccxt                                    -> CRYPTO_METRICS
 *       * dukascopy                               -> [] (hide-on-empty)
 *       * akshare/tushare/baostock                -> [] (no static registry yet)
 *   - `getDefaultSliceFor` returns a sensible (topN, metric) per (provider, subset)
 *   - `getKnownUniverseSize` returns finite size for known, Infinity for unknown
 *
 * @see TICKET_077_29 (Phase 2)
 * @see TICKET_077_29_M1 (sweep wrapper adoption -- this file's caller)
 */

import { describe, it, expect } from 'vitest';
import {
  type DataSourceSlot,
  type UniverseSliceSpec,
  type RankingMetricId,
  type RankingMetricOption,
  getSymbolsForSlot,
  getRankingMetricsFor,
  getDefaultSliceFor,
  getKnownUniverseSize,
  SP500_TOP65,
  SP500_500,
  CRYPTO_TOP40_CCXT,
  G10_FX_YFINANCE,
  G10_FX_DUKASCOPY,
  US_SECTOR_ETFS,
} from './provider-registry';

describe('TICKET_077_29 Phase 2: slice type shape', () => {
  it('UniverseSliceSpec has { topN: number, rankingMetric: RankingMetricId }', () => {
    const spec: UniverseSliceSpec = { topN: 50, rankingMetric: 'market_cap' };
    expect(spec.topN).toBe(50);
    expect(spec.rankingMetric).toBe('market_cap');
  });

  it('RankingMetricId is an opaque string type at Tier 0', () => {
    const id: RankingMetricId = 'dollar_volume';
    expect(typeof id).toBe('string');
  });

  it('DataSourceSlot.slice is optional (legacy slots without it still type-check)', () => {
    const legacy: DataSourceSlot = { provider: 'alpaca', subset: null, symbols: [] };
    expect(legacy.slice).toBeUndefined();
    const sliced: DataSourceSlot = {
      provider: 'alpaca', subset: null, symbols: [],
      slice: { topN: 50, rankingMetric: 'dollar_volume' },
    };
    expect(sliced.slice?.topN).toBe(50);
    const nullSlice: DataSourceSlot = {
      provider: 'alpaca', subset: null, symbols: [], slice: null,
    };
    expect(nullSlice.slice).toBeNull();
  });
});

describe('TICKET_077_29 Phase 2: getSymbolsForSlot is slice-aware', () => {
  it('returns full universe when slice is absent (legacy path unchanged)', () => {
    const slot: DataSourceSlot = { provider: 'alpaca', subset: null, symbols: [] };
    expect(getSymbolsForSlot(slot)).toEqual([...SP500_TOP65]);
  });

  it('returns full universe when slice is null', () => {
    const slot: DataSourceSlot = {
      provider: 'alpaca', subset: null, symbols: [], slice: null,
    };
    expect(getSymbolsForSlot(slot)).toEqual([...SP500_TOP65]);
  });

  it('clips alpaca to first N when slice.topN < universe size', () => {
    const slot: DataSourceSlot = {
      provider: 'alpaca', subset: null, symbols: [],
      slice: { topN: 10, rankingMetric: 'dollar_volume' },
    };
    const syms = getSymbolsForSlot(slot);
    expect(syms).toHaveLength(10);
    expect(syms).toEqual(SP500_TOP65.slice(0, 10));
  });

  it('clips yfinance + yf_sp500_full to first N', () => {
    const slot: DataSourceSlot = {
      provider: 'yfinance', subset: 'yf_sp500_full', symbols: [],
      slice: { topN: 50, rankingMetric: 'market_cap' },
    };
    const syms = getSymbolsForSlot(slot);
    expect(syms).toHaveLength(50);
    expect(syms).toEqual(SP500_500.slice(0, 50));
  });

  it('does NOT clip when topN >= universe size (returns full list)', () => {
    const slot: DataSourceSlot = {
      provider: 'alpaca', subset: null, symbols: [],
      slice: { topN: 999, rankingMetric: 'dollar_volume' },
    };
    expect(getSymbolsForSlot(slot)).toEqual([...SP500_TOP65]);
  });

  it('does NOT clip when topN is 0 or negative (treats as no slice)', () => {
    const slotZero: DataSourceSlot = {
      provider: 'alpaca', subset: null, symbols: [],
      slice: { topN: 0, rankingMetric: 'dollar_volume' },
    };
    expect(getSymbolsForSlot(slotZero)).toEqual([...SP500_TOP65]);
    const slotNeg: DataSourceSlot = {
      provider: 'alpaca', subset: null, symbols: [],
      slice: { topN: -1, rankingMetric: 'dollar_volume' },
    };
    expect(getSymbolsForSlot(slotNeg)).toEqual([...SP500_TOP65]);
  });

  it('does NOT clip when topN is Infinity', () => {
    const slot: DataSourceSlot = {
      provider: 'alpaca', subset: null, symbols: [],
      slice: { topN: Number.POSITIVE_INFINITY, rankingMetric: 'dollar_volume' },
    };
    expect(getSymbolsForSlot(slot)).toEqual([...SP500_TOP65]);
  });

  it('ccxt slice clips the default crypto top-40 list', () => {
    const slot: DataSourceSlot = {
      provider: 'ccxt', subset: null, symbols: [],
      slice: { topN: 5, rankingMetric: 'volume_30d' },
    };
    expect(getSymbolsForSlot(slot)).toEqual(CRYPTO_TOP40_CCXT.slice(0, 5));
  });

  it('slice is a no-op on an empty resolved universe (no negative-index slice bug)', () => {
    const slot: DataSourceSlot = {
      provider: 'yfinance', subset: 'yf_nonexistent', symbols: [],
      slice: { topN: 10, rankingMetric: 'market_cap' },
    };
    expect(getSymbolsForSlot(slot)).toEqual([]);
  });
});

describe('TICKET_077_29 Phase 2: getRankingMetricsFor', () => {
  it('yfinance + yf_us_equity returns equity metrics including market_cap and dollar_volume', () => {
    const metrics = getRankingMetricsFor('yfinance', 'yf_us_equity');
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics.map(m => m.value)).toContain('market_cap');
    expect(metrics.map(m => m.value)).toContain('dollar_volume');
  });

  it('yfinance + yf_sp500_full returns equity metrics', () => {
    const metrics = getRankingMetricsFor('yfinance', 'yf_sp500_full');
    expect(metrics.map(m => m.value)).toContain('market_cap');
  });

  it('yfinance + yf_g10_fx returns [] (FX has no top-N ranking axis)', () => {
    expect(getRankingMetricsFor('yfinance', 'yf_g10_fx')).toEqual([]);
  });

  it('yfinance + yf_sector_etfs returns [] (universe is the 11 SPDRs; no slicing)', () => {
    expect(getRankingMetricsFor('yfinance', 'yf_sector_etfs')).toEqual([]);
  });

  it('alpaca (Shape A equity) returns equity metrics', () => {
    const metrics = getRankingMetricsFor('alpaca', null);
    expect(metrics.map(m => m.value)).toContain('dollar_volume');
  });

  it('ccxt returns crypto metrics including volume_30d', () => {
    const metrics = getRankingMetricsFor('ccxt', null);
    expect(metrics.map(m => m.value)).toContain('volume_30d');
  });

  it('dukascopy returns [] (FX has no meaningful ranking axis)', () => {
    expect(getRankingMetricsFor('dukascopy', null)).toEqual([]);
  });

  it('akshare/tushare/baostock return [] (no static registry yet)', () => {
    expect(getRankingMetricsFor('akshare', null)).toEqual([]);
    expect(getRankingMetricsFor('tushare', null)).toEqual([]);
    expect(getRankingMetricsFor('baostock', null)).toEqual([]);
  });

  it('every returned option has a non-empty string label', () => {
    const metrics = getRankingMetricsFor('alpaca', null);
    for (const m of metrics as RankingMetricOption[]) {
      expect(typeof m.label).toBe('string');
      expect(m.label.length).toBeGreaterThan(0);
    }
  });
});

describe('TICKET_077_29 Phase 2: getDefaultSliceFor', () => {
  it('yfinance + yf_us_equity defaults to topN=50, market_cap', () => {
    const spec = getDefaultSliceFor('yfinance', 'yf_us_equity');
    expect(spec.topN).toBe(50);
    expect(spec.rankingMetric).toBe('market_cap');
  });

  it('alpaca defaults to topN=50, dollar_volume', () => {
    const spec = getDefaultSliceFor('alpaca', null);
    expect(spec.topN).toBe(50);
    expect(spec.rankingMetric).toBe('dollar_volume');
  });

  it('ccxt defaults to topN=50, volume_30d', () => {
    const spec = getDefaultSliceFor('ccxt', null);
    expect(spec.topN).toBe(50);
    expect(spec.rankingMetric).toBe('volume_30d');
  });

  it('returns a UniverseSliceSpec shape even for providers with no metrics', () => {
    const spec = getDefaultSliceFor('akshare', null);
    expect(typeof spec.topN).toBe('number');
    expect(typeof spec.rankingMetric).toBe('string');
  });
});

describe('TICKET_077_29 Phase 2: getKnownUniverseSize', () => {
  it('yfinance + yf_us_equity returns SP500_TOP65.length', () => {
    expect(getKnownUniverseSize('yfinance', 'yf_us_equity')).toBe(SP500_TOP65.length);
  });

  it('yfinance + yf_sp500_full returns SP500_500.length', () => {
    expect(getKnownUniverseSize('yfinance', 'yf_sp500_full')).toBe(SP500_500.length);
  });

  it('yfinance + yf_g10_fx returns G10_FX_YFINANCE.length', () => {
    expect(getKnownUniverseSize('yfinance', 'yf_g10_fx')).toBe(G10_FX_YFINANCE.length);
  });

  it('yfinance + yf_sector_etfs returns US_SECTOR_ETFS.length', () => {
    expect(getKnownUniverseSize('yfinance', 'yf_sector_etfs')).toBe(US_SECTOR_ETFS.length);
  });

  it('alpaca returns SP500_TOP65.length', () => {
    expect(getKnownUniverseSize('alpaca', null)).toBe(SP500_TOP65.length);
  });

  it('ccxt returns CRYPTO_TOP40_CCXT.length (statically-known top-40)', () => {
    expect(getKnownUniverseSize('ccxt', null)).toBe(CRYPTO_TOP40_CCXT.length);
  });

  it('dukascopy returns G10_FX_DUKASCOPY.length', () => {
    expect(getKnownUniverseSize('dukascopy', null)).toBe(G10_FX_DUKASCOPY.length);
  });

  it('returns Infinity for providers with no static size (akshare/tushare/baostock)', () => {
    expect(getKnownUniverseSize('akshare', null)).toBe(Infinity);
    expect(getKnownUniverseSize('tushare', null)).toBe(Infinity);
    expect(getKnownUniverseSize('baostock', null)).toBe(Infinity);
  });

  it('unknown yfinance subset returns Infinity', () => {
    expect(getKnownUniverseSize('yfinance', 'yf_unknown_subset')).toBe(Infinity);
  });
});
