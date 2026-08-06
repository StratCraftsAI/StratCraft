/**
 * TICKET_958_4 -- unit tests for the trading-calendar lookup.
 *
 * Pins behavior the AC #1 / AC #5 invariants rely on. Failures here mean the
 * write-boundary day-set check is silently wrong; a pin on these dates is
 * the right diagnostic surface (TICKET_858).
 */

import { describe, it, expect } from 'vitest';
import {
  enumerateTradingDays,
  assertKnownTradingCalendar,
  formatTradingDay,
} from '../trading-calendars';

const MS_PER_DAY = 86_400_000;
const utc = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d);

describe('enumerateTradingDays / NYSE (JSON-backed)', () => {
  it('counts 5 trading days in a regular Mon-Fri', () => {
    // 2025-01-13 (Mon) .. 2025-01-17 (Fri): all are regular trading days.
    // (Picked this week deliberately -- 2025-01-09 is the National Day of
    // Mourning for President Carter, so the obvious Jan 6-10 window has
    // only 4 trading days, not 5.)
    const days = enumerateTradingDays('NYSE', utc(2025, 1, 13), utc(2025, 1, 17));
    expect(days).toHaveLength(5);
    expect(formatTradingDay(days[0])).toBe('2025-01-13');
    expect(formatTradingDay(days[4])).toBe('2025-01-17');
  });

  it('excludes weekends', () => {
    // 2025-01-13 (Mon) .. 2025-01-19 (Sun): includes one weekend; 5 trading days.
    const days = enumerateTradingDays('NYSE', utc(2025, 1, 13), utc(2025, 1, 19));
    expect(days).toHaveLength(5);
    expect(days.map(formatTradingDay)).not.toContain('2025-01-18'); // Sat
    expect(days.map(formatTradingDay)).not.toContain('2025-01-19'); // Sun
  });

  it('excludes the 2025-01-09 National Day of Mourning (Carter)', () => {
    // Window contains 2025-01-09 (Thu); the calendar JSON encodes the
    // executive-order market closure, so the day is absent from the result.
    const days = enumerateTradingDays('NYSE', utc(2025, 1, 6), utc(2025, 1, 10));
    expect(days).toHaveLength(4);
    expect(days.map(formatTradingDay)).not.toContain('2025-01-09');
  });

  it('excludes Christmas Day (federal holiday)', () => {
    // 2025-12-22 (Mon) .. 2025-12-26 (Fri): Christmas Day Thu 12-25 is OUT.
    // Christmas Eve 12-24 is a half day but COUNTS as a trading day.
    const days = enumerateTradingDays('NYSE', utc(2025, 12, 22), utc(2025, 12, 26));
    const labels = days.map(formatTradingDay);
    expect(labels).not.toContain('2025-12-25');
    expect(labels).toContain('2025-12-24'); // early close, still a trading day
    expect(labels).toContain('2025-12-26');
  });

  it('reproduces TICKET_958_3 Finding 4 expected set (3 days that were silently dropped)', () => {
    // The 3 days the live AAPL/5m cache was missing on 2026-06-14:
    // 2026-03-20 (Fri), 2026-04-20 (Mon), 2026-05-20 (Wed).
    // All are regular NYSE trading days. The invariant must SEE all three.
    for (const [y, m, d] of [[2026, 3, 20], [2026, 4, 20], [2026, 5, 20]] as const) {
      const days = enumerateTradingDays('NYSE', utc(y, m, d), utc(y, m, d));
      expect(days).toHaveLength(1);
      expect(formatTradingDay(days[0])).toBe(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  });

  it('throws RangeError outside JSON coverage window', () => {
    expect(() => enumerateTradingDays('NYSE', utc(2019, 12, 31), utc(2020, 1, 5))).toThrow(RangeError);
    expect(() => enumerateTradingDays('NYSE', utc(2030, 12, 25), utc(2031, 1, 5))).toThrow(RangeError);
  });
});

describe('enumerateTradingDays / XSHG_XSHE (JSON-backed)', () => {
  it('excludes National Day Golden Week 2025', () => {
    // 2025-09-29 (Mon) .. 2025-10-10 (Fri); National Day holiday closes
    // SSE/SZSE for ~7 sessions in early October.
    const days = enumerateTradingDays('XSHG_XSHE', utc(2025, 9, 29), utc(2025, 10, 10));
    const labels = days.map(formatTradingDay);
    expect(labels).toContain('2025-09-29');
    expect(labels).toContain('2025-09-30');
    // Oct 1-7 inclusive are all closed.
    for (const day of ['2025-10-01', '2025-10-02', '2025-10-03', '2025-10-06', '2025-10-07']) {
      expect(labels).not.toContain(day);
    }
  });
});

describe('enumerateTradingDays / CRYPTO_24_7 (synthetic)', () => {
  it('returns every calendar day in the window', () => {
    const days = enumerateTradingDays('CRYPTO_24_7', utc(2025, 1, 1), utc(2025, 1, 7));
    expect(days).toHaveLength(7);
    expect(days.map(formatTradingDay)).toEqual([
      '2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04',
      '2025-01-05', '2025-01-06', '2025-01-07',
    ]);
  });
});

describe('enumerateTradingDays / FX_5_24 (synthetic)', () => {
  it('excludes Sat and Sun', () => {
    // 2025-01-06 (Mon) .. 2025-01-12 (Sun)
    const days = enumerateTradingDays('FX_5_24', utc(2025, 1, 6), utc(2025, 1, 12));
    expect(days).toHaveLength(5);
    const labels = days.map(formatTradingDay);
    expect(labels).not.toContain('2025-01-11'); // Sat
    expect(labels).not.toContain('2025-01-12'); // Sun
  });

  it('excludes FX global closures: Jan 1, Dec 25, Dec 26', () => {
    // 2025-01-01 (Wed), 2025-12-25 (Thu), 2025-12-26 (Fri)
    const jan1 = enumerateTradingDays('FX_5_24', utc(2025, 1, 1), utc(2025, 1, 1));
    expect(jan1).toHaveLength(0);

    const dec25 = enumerateTradingDays('FX_5_24', utc(2025, 12, 25), utc(2025, 12, 25));
    expect(dec25).toHaveLength(0);

    const dec26 = enumerateTradingDays('FX_5_24', utc(2025, 12, 26), utc(2025, 12, 26));
    expect(dec26).toHaveLength(0);
  });

  it('does NOT exclude NYSE-only holidays (FX trades through them)', () => {
    // 2025-02-17 (Mon) = Presidents Day: NYSE closed, FX open.
    const days = enumerateTradingDays('FX_5_24', utc(2025, 2, 17), utc(2025, 2, 17));
    expect(days).toHaveLength(1);
    expect(formatTradingDay(days[0])).toBe('2025-02-17');
  });

  it('FX holiday on weekend does not affect the count', () => {
    // 2022-01-01 is Saturday -- already excluded by weekend rule.
    // Dec 27-31 2021: Mon-Fri, but Dec 27 (Mon after Christmas) is not
    // an FX closure -- only 25/26 are. Dec 31 is a regular FX day.
    const jan1Week = enumerateTradingDays('FX_5_24', utc(2021, 12, 27), utc(2022, 1, 2));
    const labels = jan1Week.map(formatTradingDay);
    expect(labels).toEqual(['2021-12-27', '2021-12-28', '2021-12-29', '2021-12-30', '2021-12-31']);
  });

  it('reproduces the Dukascopy 2016-01-01 + 2021-01-01 exclusion', () => {
    // Both are Fridays -- were falsely expected, causing CacheWriteIntegrityError.
    expect(enumerateTradingDays('FX_5_24', utc(2016, 1, 1), utc(2016, 1, 1))).toHaveLength(0);
    expect(enumerateTradingDays('FX_5_24', utc(2021, 1, 1), utc(2021, 1, 1))).toHaveLength(0);
  });
});

describe('enumerateTradingDays / NONE', () => {
  it('throws when called with NONE', () => {
    expect(() => enumerateTradingDays('NONE', utc(2025, 1, 1), utc(2025, 1, 7))).toThrow(
      /short-circuit the invariant/,
    );
  });
});

describe('enumerateTradingDays / empty window', () => {
  it('returns [] when end < start', () => {
    expect(enumerateTradingDays('NYSE', utc(2025, 1, 10), utc(2025, 1, 6))).toEqual([]);
  });
});

describe('assertKnownTradingCalendar', () => {
  it('passes on known values', () => {
    expect(() => assertKnownTradingCalendar('NYSE', 'test-provider')).not.toThrow();
    expect(() => assertKnownTradingCalendar('XSHG_XSHE', 'test-provider')).not.toThrow();
    expect(() => assertKnownTradingCalendar('CRYPTO_24_7', 'test-provider')).not.toThrow();
    expect(() => assertKnownTradingCalendar('FX_5_24', 'test-provider')).not.toThrow();
    expect(() => assertKnownTradingCalendar('NONE', 'test-provider')).not.toThrow();
  });

  it('throws on unknown values', () => {
    expect(() => assertKnownTradingCalendar('LSE', 'test-provider')).toThrow(/not a known value/);
    expect(() => assertKnownTradingCalendar('', 'test-provider')).toThrow(/not a known value/);
  });
});
