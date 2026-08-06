import { describe, it, expect } from 'vitest';
import type {
  RegimeBarState,
  RegimeAdjustment,
  PerBucketRegimeAdjustment,
} from './regime-adjustment';
import type { MarketId } from './market-id';

describe('TICKET_927_1_4_B regime-adjustment tier-0 types', () => {
  it('RegimeBarState carries state + posterior', () => {
    const obs: RegimeBarState = { state: 0, posterior: 0.92 };
    expect(obs.state).toBe(0);
    expect(obs.posterior).toBe(0.92);
  });

  it('RegimeAdjustment carries regimeMap, allowedRegimes, optional minPosterior', () => {
    const regimeMap = new Map<number, RegimeBarState>([
      [1000, { state: 0, posterior: 0.9 }],
      [2000, { state: 1, posterior: 0.85 }],
    ]);
    const ra: RegimeAdjustment = {
      regimeMap,
      allowedRegimes: new Set([0]),
    };
    expect(ra.regimeMap.size).toBe(2);
    expect(ra.allowedRegimes.has(0)).toBe(true);
    expect(ra.allowedRegimes.has(1)).toBe(false);
    expect(ra.minPosterior).toBeUndefined();
  });

  it('RegimeAdjustment accepts explicit minPosterior', () => {
    const ra: RegimeAdjustment = {
      regimeMap: new Map(),
      allowedRegimes: new Set([0, 1]),
      minPosterior: 0.7,
    };
    expect(ra.minPosterior).toBe(0.7);
  });

  it('PerBucketRegimeAdjustment maps MarketId -> RegimeAdjustment', () => {
    const alpacaRa: RegimeAdjustment = {
      regimeMap: new Map([[1000, { state: 0, posterior: 0.9 }]]),
      allowedRegimes: new Set([0]),
    };
    const forexRa: RegimeAdjustment = {
      regimeMap: new Map([[1000, { state: 2, posterior: 0.8 }]]),
      allowedRegimes: new Set([0, 2]),
      minPosterior: 0.6,
    };
    const perBucket: PerBucketRegimeAdjustment = new Map<MarketId, RegimeAdjustment>([
      ['alpaca_us_equity', alpacaRa],
      ['dukascopy_forex', forexRa],
    ]);
    expect(perBucket.get('alpaca_us_equity')).toBe(alpacaRa);
    expect(perBucket.get('dukascopy_forex')).toBe(forexRa);
    expect(perBucket.get('ccxt_spot')).toBeUndefined();
  });

  it('absent market in PerBucketRegimeAdjustment = un-gated (no silent gap)', () => {
    const perBucket: PerBucketRegimeAdjustment = new Map<MarketId, RegimeAdjustment>([
      ['alpaca_us_equity', {
        regimeMap: new Map([[1000, { state: 0, posterior: 0.9 }]]),
        allowedRegimes: new Set([0]),
      }],
    ]);
    expect(perBucket.has('dukascopy_forex')).toBe(false);
    expect(perBucket.get('dukascopy_forex')).toBeUndefined();
  });
});
