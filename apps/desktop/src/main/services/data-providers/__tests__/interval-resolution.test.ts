/**
 * Unit-test matrix for interval-resolution (TICKET_196_12 Step 2).
 *
 * Exercises resolveFetchPlan over {6 providers} x {10 central timeframes},
 * plus intervalToMinutes / isIntervalReachable / invalid-target paths.
 *
 * The module logic is the spec: native if in the provider's native set; else
 * aggregate from the COARSEST native bar strictly finer than the target whose
 * minutes evenly divide the target's minutes; else unsupported.
 */
import { describe, it, expect } from 'vitest';
import type { IDataProvider } from '../types';
import {
  resolveFetchPlan,
  isIntervalReachable,
  intervalToMinutes,
  type FetchPlan,
} from '../interval-resolution';

const ALL_TIMEFRAMES = [
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '1d',
  '1w',
  '1M',
] as const;

type TF = (typeof ALL_TIMEFRAMES)[number];

/**
 * Build a lightweight fake provider. resolveFetchPlan only reads
 * provider.id and provider.capabilities.nativeIntervals.
 */
function fakeProvider(id: string, nativeIntervals: string[]): IDataProvider {
  return {
    id,
    capabilities: { nativeIntervals },
  } as unknown as IDataProvider;
}

const NATIVE_SETS: Record<string, string[]> = {
  alpaca: ['1m', '5m', '15m', '30m', '1h', '1d'],
  ccxt: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
  yfinance: ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1M'],
  clickhouse: ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'],
  dukascopy: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
  baostock: ['5m', '15m', '30m', '1h', '1d', '1w', '1M'],
};

/**
 * Helper plan builders mirroring the module's discriminated union.
 */
function native(tf: TF): FetchPlan {
  return { mode: 'native', fetchInterval: tf };
}
function aggregate(baseInterval: string, target: TF): FetchPlan {
  return { mode: 'aggregate', baseInterval, target };
}

/**
 * Expected plan per provider per timeframe. Derived from and verified against
 * the module's actual computed output (see report). 'unsupported' is asserted
 * loosely (mode + reason prose) because the reason string is free text.
 */
const EXPECTED: Record<string, Record<TF, FetchPlan | 'unsupported'>> = {
  alpaca: {
    '1m': native('1m'),
    '5m': native('5m'),
    '15m': native('15m'),
    '30m': native('30m'),
    '1h': native('1h'),
    '2h': aggregate('1h', '2h'),
    '4h': aggregate('1h', '4h'),
    '1d': native('1d'),
    '1w': aggregate('1d', '1w'),
    '1M': aggregate('1d', '1M'),
  },
  ccxt: {
    '1m': native('1m'),
    '5m': native('5m'),
    '15m': native('15m'),
    '30m': native('30m'),
    '1h': native('1h'),
    '2h': aggregate('1h', '2h'),
    '4h': native('4h'),
    '1d': native('1d'),
    '1w': aggregate('1d', '1w'),
    '1M': aggregate('1d', '1M'),
  },
  yfinance: {
    '1m': native('1m'),
    '5m': native('5m'),
    '15m': native('15m'),
    '30m': native('30m'),
    '1h': native('1h'),
    '2h': aggregate('1h', '2h'),
    '4h': aggregate('1h', '4h'),
    '1d': native('1d'),
    '1w': native('1w'),
    '1M': native('1M'),
  },
  clickhouse: {
    '1m': native('1m'),
    '5m': native('5m'),
    '15m': native('15m'),
    '30m': native('30m'),
    '1h': native('1h'),
    '2h': native('2h'),
    '4h': native('4h'),
    '1d': native('1d'),
    '1w': aggregate('1d', '1w'),
    '1M': aggregate('1d', '1M'),
  },
  dukascopy: {
    '1m': native('1m'),
    '5m': native('5m'),
    '15m': native('15m'),
    '30m': native('30m'),
    '1h': native('1h'),
    '2h': aggregate('1h', '2h'),
    '4h': native('4h'),
    '1d': native('1d'),
    '1w': aggregate('1d', '1w'),
    '1M': aggregate('1d', '1M'),
  },
  baostock: {
    '1m': 'unsupported',
    '5m': native('5m'),
    '15m': native('15m'),
    '30m': native('30m'),
    '1h': native('1h'),
    '2h': aggregate('1h', '2h'),
    '4h': aggregate('1h', '4h'),
    '1d': native('1d'),
    '1w': native('1w'),
    '1M': native('1M'),
  },
};

describe('resolveFetchPlan -- full provider x timeframe matrix', () => {
  for (const [providerId, nativeIntervals] of Object.entries(NATIVE_SETS)) {
    describe(providerId, () => {
      const provider = fakeProvider(providerId, nativeIntervals);
      for (const tf of ALL_TIMEFRAMES) {
        const expected = EXPECTED[providerId][tf];
        it(`${tf} -> ${
          expected === 'unsupported' ? 'unsupported' : expected.mode
        }`, () => {
          const plan = resolveFetchPlan(provider, tf);
          if (expected === 'unsupported') {
            expect(plan.mode).toBe('unsupported');
            if (plan.mode === 'unsupported') {
              expect(plan.reason).toEqual(expect.any(String));
              expect(plan.reason.length).toBeGreaterThan(0);
              expect(plan.reason).toContain(providerId);
            }
          } else {
            expect(plan).toEqual(expected);
          }
        });
      }
    });
  }
});

describe('intervalToMinutes', () => {
  it('maps known central intervals to minutes', () => {
    expect(intervalToMinutes('1m')).toBe(1);
    expect(intervalToMinutes('1h')).toBe(60);
    expect(intervalToMinutes('2h')).toBe(120);
    expect(intervalToMinutes('4h')).toBe(240);
    expect(intervalToMinutes('1d')).toBe(1440);
    expect(intervalToMinutes('1w')).toBe(10080);
    expect(intervalToMinutes('1M')).toBe(43200);
  });

  it('returns null for an unknown interval string', () => {
    expect(intervalToMinutes('3h')).toBeNull();
    expect(intervalToMinutes('banana')).toBeNull();
  });
});

describe('isIntervalReachable', () => {
  it('is true when the target is native or aggregatable', () => {
    const alpaca = fakeProvider('alpaca', NATIVE_SETS.alpaca);
    expect(isIntervalReachable(alpaca, '4h')).toBe(true); // aggregate from 1h
    expect(isIntervalReachable(alpaca, '1h')).toBe(true); // native
  });

  it('is false when no native or finer bar can serve the target', () => {
    const baostock = fakeProvider('baostock', NATIVE_SETS.baostock);
    expect(isIntervalReachable(baostock, '1m')).toBe(false); // no finer bar
  });
});

describe('invalid target interval', () => {
  it('returns unsupported for a non-central interval on any provider', () => {
    for (const [providerId, nativeIntervals] of Object.entries(NATIVE_SETS)) {
      const provider = fakeProvider(providerId, nativeIntervals);
      const plan = resolveFetchPlan(provider, '3h');
      expect(plan.mode).toBe('unsupported');
    }
  });
});
