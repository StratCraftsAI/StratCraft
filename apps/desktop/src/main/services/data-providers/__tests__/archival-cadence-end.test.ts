/**
 * TICKET_919_10 -- unit tests for resolveArchivalCadenceEndMs.
 *
 * The property under test: window-end anchors on the cohort's freshness
 * evidence (p90 of per-symbol lastTimestamp) floored to the cadence's
 * last published boundary -- NOT on `Date.now()`, which over-shoots a
 * monthly-archive package's true tail by up to ~45 days. Outliers in
 * either direction (one user-extended symbol, one stale tail) must not
 * yank the anchor.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveArchivalCadenceEndMs,
  type ResolvedSymbolTail,
} from '../archival-cadence-end';

const SEC = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const MS = (iso: string) => new Date(iso).getTime();

function cohortAt(symbols: string[], lastTsSec: number): ResolvedSymbolTail[] {
  return symbols.map((s) => ({ symbol: s, lastTimestamp: lastTsSec }));
}

function uniformCohort(size: number, lastTsSec: number): ResolvedSymbolTail[] {
  return Array.from({ length: size }, (_, i) => ({
    symbol: `S${i}`,
    lastTimestamp: lastTsSec,
  }));
}

describe('resolveArchivalCadenceEndMs', () => {
  // 2026-06-10T09:55:00Z -- the wall-clock when Run #51 was launched
  // (apps/desktop/logs/main.log:49117). Use it as the canonical asOf in
  // tests so the assertions are dated against the same evidence the
  // ticket cites.
  const ASOF_MS = MS('2026-06-10T09:55:00Z');

  describe('realtime', () => {
    it('returns asOfMs verbatim (bit-exact today\'s behaviour)', () => {
      const cohort = cohortAt(['A', 'B'], SEC('2026-06-10T09:54:00Z'));
      expect(resolveArchivalCadenceEndMs('realtime', cohort, ASOF_MS)).toBe(ASOF_MS);
    });

    it('returns asOfMs even with an empty cohort', () => {
      expect(resolveArchivalCadenceEndMs('realtime', [], ASOF_MS)).toBe(ASOF_MS);
    });
  });

  describe('empty / defensive', () => {
    it('falls through to asOfMs when cohort is empty (no evidence to anchor on)', () => {
      expect(resolveArchivalCadenceEndMs('monthly_archive', [], ASOF_MS)).toBe(ASOF_MS);
    });

    it('falls through to asOfMs when every cohort entry has a non-finite timestamp', () => {
      const broken: ResolvedSymbolTail[] = [
        { symbol: 'X', lastTimestamp: NaN },
        { symbol: 'Y', lastTimestamp: 0 },
        { symbol: 'Z', lastTimestamp: -1 },
      ];
      expect(resolveArchivalCadenceEndMs('monthly_archive', broken, ASOF_MS)).toBe(ASOF_MS);
    });
  });

  describe('snapshot', () => {
    it('returns the cohort p90 with no archival floor applied', () => {
      // 10-symbol cohort, all at 2026-03-15. p90 == sorted[9] == that
      // timestamp; no monthly floor reshapes it.
      const ts = SEC('2026-03-15T12:00:00Z');
      const cohort = uniformCohort(10, ts);
      expect(resolveArchivalCadenceEndMs('snapshot', cohort, ASOF_MS)).toBe(ts * 1000);
    });

    it('honours a one-symbol cohort\'s timestamp regardless of asOf', () => {
      const ts = SEC('2025-12-31T23:59:00Z');
      const cohort: ResolvedSymbolTail[] = [{ symbol: 'X', lastTimestamp: ts }];
      expect(resolveArchivalCadenceEndMs('snapshot', cohort, ASOF_MS)).toBe(ts * 1000);
    });
  });

  describe('monthly_archive -- the Run #51 case', () => {
    it('floors to end-of-month when cohort p90 lands mid-month', () => {
      // 60 forex symbols all at 2026-05-29 23:00 UTC (the HistData May
      // 2026 release tail). p90 == that timestamp. The May floor is
      // 2026-05-31 23:59:59. min(p90, floor) == p90 -- correct: the
      // data on disk only reaches 2026-05-29, the floor exists to
      // prevent claiming further, not to project forward.
      const tail = SEC('2026-05-29T23:00:00Z');
      const cohort = uniformCohort(60, tail);
      const endMs = resolveArchivalCadenceEndMs('monthly_archive', cohort, ASOF_MS);
      expect(endMs).toBe(tail * 1000);
    });

    it('caps the cohort p90 at end-of-month when p90 lies mid-next-month', () => {
      // Pathological: most of the cohort somehow sits at 2026-06-15,
      // but the package is declared monthly_archive. Floor to 2026-06-30
      // 23:59:59; min(p90, floor) == p90 == 2026-06-15. The floor
      // would only bite if p90 crossed past month-end, which is
      // contradicted by the cadence declaration -- this is the
      // belt-and-braces case.
      const p90 = SEC('2026-06-15T08:00:00Z');
      const cohort = uniformCohort(50, p90);
      const endMs = resolveArchivalCadenceEndMs('monthly_archive', cohort, ASOF_MS);
      expect(endMs).toBe(p90 * 1000);
    });

    it('is robust to a handful of user-extended outliers (p90, not max)', () => {
      // 60-symbol cohort: 54 at the May tail, 6 hand-extended to year-end.
      // p90 == sorted[54] == May tail. `max` would have picked the
      // year-end outlier and yanked the anchor 7 months into a
      // guaranteed-empty future.
      const tail = SEC('2026-05-29T23:00:00Z');
      const outlier = SEC('2026-12-31T23:59:00Z');
      const cohort: ResolvedSymbolTail[] = [
        ...uniformCohort(54, tail),
        ...uniformCohort(6, outlier).map((s, i) => ({ ...s, symbol: `OUT${i}` })),
      ];
      const endMs = resolveArchivalCadenceEndMs('monthly_archive', cohort, ASOF_MS);
      // p90 lands at sorted[54] == tail; floor for tail is May-31; min == tail.
      expect(endMs).toBe(tail * 1000);
    });

    it('is robust to a few stale tails at the low end (p90 still uses the bulk)', () => {
      // 60-symbol cohort: 4 stale at 2024-12-31, 56 fresh at 2026-05-29.
      // p90 == sorted[54] -- index 54 of the sorted ascending array is
      // a 2026-05-29 entry (indices 0..3 are stale, 4..59 are fresh).
      const stale = SEC('2024-12-31T23:00:00Z');
      const fresh = SEC('2026-05-29T23:00:00Z');
      const cohort: ResolvedSymbolTail[] = [
        ...uniformCohort(4, stale).map((s, i) => ({ ...s, symbol: `STA${i}` })),
        ...uniformCohort(56, fresh),
      ];
      const endMs = resolveArchivalCadenceEndMs('monthly_archive', cohort, ASOF_MS);
      expect(endMs).toBe(fresh * 1000);
    });

    it('handles a single-symbol cohort (p90 == that timestamp)', () => {
      const ts = SEC('2026-04-30T22:00:00Z');
      const cohort: ResolvedSymbolTail[] = [{ symbol: 'X', lastTimestamp: ts }];
      const endMs = resolveArchivalCadenceEndMs('monthly_archive', cohort, ASOF_MS);
      // April floor == 2026-04-30 23:59:59; cohort tail is 22:00 of
      // the same day -> min == cohort tail.
      expect(endMs).toBe(ts * 1000);
    });
  });

  describe('weekly_archive', () => {
    it('floors to ISO-week Sunday 23:59:59 UTC', () => {
      // 2026-06-10 is a Wednesday. Cohort p90 at that mid-week
      // timestamp should floor to Sunday 2026-06-14 23:59:59 -- but
      // because the data only reaches Wednesday, min(p90, floor) ==
      // p90. The floor only bites if cohort crossed past Sunday.
      const wed = SEC('2026-06-10T08:00:00Z');
      const cohort = uniformCohort(20, wed);
      const endMs = resolveArchivalCadenceEndMs('weekly_archive', cohort, ASOF_MS);
      expect(endMs).toBe(wed * 1000);
    });

    it('on a Sunday, the floor coincides with the cohort point', () => {
      // 2026-06-14 is a Sunday. The Sunday-23:59:59 floor == that day
      // end. A cohort whose p90 is Sunday 12:00 floors to itself.
      const sun = SEC('2026-06-14T12:00:00Z');
      const cohort = uniformCohort(20, sun);
      const endMs = resolveArchivalCadenceEndMs('weekly_archive', cohort, ASOF_MS);
      expect(endMs).toBe(sun * 1000);
    });
  });

  describe('daily_eod', () => {
    it('floors to end-of-UTC-day (23:59:59)', () => {
      // Cohort at 2026-06-09 14:30 UTC. The June-9 EOD floor is
      // 2026-06-09 23:59:59. min(p90, floor) == p90 -- the data
      // only reaches 14:30, the floor exists to prevent claiming the
      // rest of the day's bars before they exist.
      const ts = SEC('2026-06-09T14:30:00Z');
      const cohort = uniformCohort(15, ts);
      const endMs = resolveArchivalCadenceEndMs('daily_eod', cohort, ASOF_MS);
      expect(endMs).toBe(ts * 1000);
    });
  });

  describe('determinism', () => {
    it('returns the same value for the same inputs every call (no Date.now() leakage)', () => {
      const cohort = uniformCohort(30, SEC('2026-05-29T23:00:00Z'));
      const a = resolveArchivalCadenceEndMs('monthly_archive', cohort, ASOF_MS);
      const b = resolveArchivalCadenceEndMs('monthly_archive', cohort, ASOF_MS);
      const c = resolveArchivalCadenceEndMs('monthly_archive', cohort, ASOF_MS);
      expect(a).toBe(b);
      expect(b).toBe(c);
    });
  });
});
