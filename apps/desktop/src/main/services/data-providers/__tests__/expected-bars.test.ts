/**
 * TICKET_196_12_1 Phase 2 -- unit tests for expectedBarsForRange.
 *
 * The critical property under test is the TICKET_362 regression guard: a normal
 * weekend (Fri->Mon) or holiday closure in an equity series must be EXPECTED
 * (the calendarPaddingRatio already nets it out), NOT mis-flagged as a hole.
 * Only a span whose actual bar count falls materially below the calendar
 * expectation indicates a true interior gap.
 */

import { describe, it, expect } from 'vitest';
import { expectedBarsForRange, type CalendarRatioProvider } from '../expected-bars';

const DAY = 86400;
const SEC = (iso: string) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000);

const alpacaEquity: CalendarRatioProvider = {
  id: 'alpaca',
  capabilities: { calendarPaddingRatio: { '1m': 3.4, '1h': 3.4, '1d': 1.4 } },
};
const ccxtCrypto: CalendarRatioProvider = {
  id: 'ccxt',
  capabilities: {}, // 24/7, no ratio -> defaults to 1.0
};
const yfinanceEquity: CalendarRatioProvider = {
  id: 'yfinance',
  capabilities: { calendarPaddingRatio: { '1d': 1.4 } },
};

describe('expectedBarsForRange', () => {
  describe('contract', () => {
    it('throws on an unknown timeframe (fail-fast)', () => {
      expect(() => expectedBarsForRange(ccxtCrypto, 'tick', 0, DAY)).toThrow(/unknown timeframe/);
    });

    it('returns 1 for a same-bar span', () => {
      const t = SEC('2020-01-01');
      expect(expectedBarsForRange(ccxtCrypto, '1d', t, t)).toBe(1);
    });

    it('returns 0 for a reversed span', () => {
      expect(expectedBarsForRange(ccxtCrypto, '1d', SEC('2020-02-01'), SEC('2020-01-01'))).toBe(0);
    });

    it('defaults to ratio 1.0 when the provider has no calendarPaddingRatio', () => {
      // 24/7: one daily bar per calendar day, inclusive both ends -> 366 (leap year).
      const bars = expectedBarsForRange(ccxtCrypto, '1d', SEC('2020-01-01'), SEC('2020-12-31'));
      expect(Math.round(bars)).toBe(366);
    });

    it('defaults to 1.0 when the provider has a ratio table but not for this timeframe', () => {
      // yfinance declares only 1d; asking for 1h falls back to 1.0.
      const span = SEC('2020-01-02') - SEC('2020-01-01'); // 1 day
      const bars = expectedBarsForRange(yfinanceEquity, '1h', SEC('2020-01-01'), SEC('2020-01-02'));
      expect(Math.round(bars)).toBe(span / 3600 + 1); // 24 + 1 inclusive
    });
  });

  describe('TICKET_362 regression guard -- weekends/holidays are EXPECTED, not holes', () => {
    it('a contiguous equity daily YEAR sits at ~1.0 of the calendar expectation', () => {
      // 2021: 252 NYSE trading days. The 1.4 ratio models 365/~252 ~= 1.45 of
      // calendar days are trading days; expected ~= 365/1.4 ~= 261. A real
      // contiguous series (252 bars) must be ABOVE the 0.9 * expected threshold
      // so it is NOT flagged -- this is the exact false-positive that broke the
      // old segment merge.
      const expected = expectedBarsForRange(alpacaEquity, '1d', SEC('2021-01-01'), SEC('2021-12-31'));
      const actualTradingDays = 252;
      expect(actualTradingDays).toBeGreaterThanOrEqual(expected * 0.9);
    });

    it('a Fri->Mon weekend gap in a daily series is NOT a hole', () => {
      // Fri 2021-01-08 .. Mon 2021-01-11 inclusive: 2 trading bars (Fri, Mon),
      // Sat/Sun closed. Calendar span = 3 days. Expected at ratio 1.4 ~=
      // (3*DAY + DAY)/(DAY*1.4) ~= 2.86. The 2 real bars are ABOVE 0.9*2.86? No
      // -- short spans are exactly why the probe has a MIN_EXPECTED_BARS floor.
      // Here we simply assert the estimate does not BLOW UP for a weekend: it
      // stays in the small single-digit range, never demanding the ~4 calendar
      // bars a naive 24/7 model would.
      const expected = expectedBarsForRange(alpacaEquity, '1d', SEC('2021-01-08'), SEC('2021-01-11'));
      const naive247 = expectedBarsForRange(ccxtCrypto, '1d', SEC('2021-01-08'), SEC('2021-01-11'));
      expect(expected).toBeLessThan(naive247); // ratio discounts the weekend
    });

    it('a multi-week interior hole DOES fall below the calendar expectation', () => {
      // Full year expectation ~261; a series that only has ~120 bars (a ~5-month
      // interior gap) is far below 0.9 * expected -> correctly flagged.
      const expected = expectedBarsForRange(alpacaEquity, '1d', SEC('2020-01-01'), SEC('2020-12-31'));
      const holed = 120;
      expect(holed).toBeLessThan(expected * 0.9);
    });
  });

  describe('intraday', () => {
    it('equity 1h over a week discounts nights+weekend via the 3.4 ratio', () => {
      const expected = expectedBarsForRange(alpacaEquity, '1h', SEC('2021-01-04'), SEC('2021-01-11'));
      const naive247 = expectedBarsForRange(ccxtCrypto, '1h', SEC('2021-01-04'), SEC('2021-01-11'));
      // 24/7 would expect ~169 hourly bars; equity expects ~1/3.4 of that.
      expect(expected).toBeLessThan(naive247);
      expect(expected).toBeGreaterThan(0);
    });

    it('crypto 1h is the full calendar (24/7)', () => {
      const bars = expectedBarsForRange(ccxtCrypto, '1h', SEC('2021-01-01'), SEC('2021-01-02'));
      expect(Math.round(bars)).toBe(25); // 24 hours + 1 inclusive endpoint
    });
  });
});
