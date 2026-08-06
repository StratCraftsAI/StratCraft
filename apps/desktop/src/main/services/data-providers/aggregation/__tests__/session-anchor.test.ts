/**
 * TICKET_196_12 Step 5 -- session-anchored bucket alignment.
 *
 * The highest-risk part of enabling 2h/4h aggregation: a wrong anchor silently
 * shifts every aggregated bar. These tests pin:
 *   - the provider asset-class -> anchor mapping,
 *   - the DST-aware 09:30 ET session-open resolution (EST and EDT),
 *   - UTC vs RTH bucket flooring,
 *   - a reference 4h equity boundary against a known exchange-native instant.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveSessionAnchor,
  rthSessionOpenEpochSeconds,
  bucketStartEpochSeconds,
} from '../session-anchor';

/** Epoch seconds for an ISO-8601 instant (always UTC 'Z'). */
function ts(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

describe('resolveSessionAnchor', () => {
  it('returns rth-equity when any equity class is present', () => {
    expect(resolveSessionAnchor(['stock', 'etf'])).toBe('rth-equity'); // alpaca
    expect(resolveSessionAnchor(['stock', 'etf', 'crypto', 'forex', 'index'])).toBe('rth-equity'); // yfinance
    expect(resolveSessionAnchor(['index'])).toBe('rth-equity');
  });

  it('returns utc for 24/7-only providers', () => {
    expect(resolveSessionAnchor(['crypto'])).toBe('utc'); // ccxt
    expect(resolveSessionAnchor(['forex'])).toBe('utc');
    expect(resolveSessionAnchor(['crypto', 'forex'])).toBe('utc');
  });

  it('returns utc for an empty asset-type set', () => {
    expect(resolveSessionAnchor([])).toBe('utc');
  });
});

describe('rthSessionOpenEpochSeconds -- DST aware', () => {
  it('resolves 09:30 ET = 13:30 UTC during EDT (summer)', () => {
    // 2024-07-15 is EDT (UTC-4): 09:30 ET == 13:30 UTC.
    const open = rthSessionOpenEpochSeconds(ts('2024-07-15T18:00:00Z')); // any intraday instant that day
    expect(open).toBe(ts('2024-07-15T13:30:00Z'));
  });

  it('resolves 09:30 ET = 14:30 UTC during EST (winter)', () => {
    // 2024-01-15 is EST (UTC-5): 09:30 ET == 14:30 UTC.
    const open = rthSessionOpenEpochSeconds(ts('2024-01-15T20:00:00Z'));
    expect(open).toBe(ts('2024-01-15T14:30:00Z'));
  });

  it('maps every intraday instant of a session to the same open', () => {
    const a = rthSessionOpenEpochSeconds(ts('2024-07-15T13:30:00Z')); // at the open
    const b = rthSessionOpenEpochSeconds(ts('2024-07-15T15:45:00Z')); // mid-session
    const c = rthSessionOpenEpochSeconds(ts('2024-07-15T19:55:00Z')); // near close
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe(ts('2024-07-15T13:30:00Z'));
  });
});

describe('bucketStartEpochSeconds -- utc anchor', () => {
  const FOUR_H = 4 * 3600;
  it('floors to the UTC 4h grid (00/04/08/12/16/20 UTC)', () => {
    expect(bucketStartEpochSeconds(ts('2024-07-15T13:30:00Z'), FOUR_H, 'utc'))
      .toBe(ts('2024-07-15T12:00:00Z'));
    expect(bucketStartEpochSeconds(ts('2024-07-15T03:59:59Z'), FOUR_H, 'utc'))
      .toBe(ts('2024-07-15T00:00:00Z'));
    expect(bucketStartEpochSeconds(ts('2024-07-15T20:00:00Z'), FOUR_H, 'utc'))
      .toBe(ts('2024-07-15T20:00:00Z'));
  });
});

describe('bucketStartEpochSeconds -- rth-equity anchor', () => {
  const FOUR_H = 4 * 3600;
  const TWO_H = 2 * 3600;

  it('anchors the first 4h equity bucket exactly to the 09:30 ET open (EDT)', () => {
    // EDT open = 13:30 UTC. The first 4h bucket covers 13:30-17:30 UTC.
    const open = ts('2024-07-15T13:30:00Z');
    expect(bucketStartEpochSeconds(ts('2024-07-15T13:30:00Z'), FOUR_H, 'rth-equity')).toBe(open);
    expect(bucketStartEpochSeconds(ts('2024-07-15T15:00:00Z'), FOUR_H, 'rth-equity')).toBe(open);
    expect(bucketStartEpochSeconds(ts('2024-07-15T17:29:59Z'), FOUR_H, 'rth-equity')).toBe(open);
    // Second bucket starts at 17:30 UTC (== 13:30 ET).
    expect(bucketStartEpochSeconds(ts('2024-07-15T17:30:00Z'), FOUR_H, 'rth-equity'))
      .toBe(ts('2024-07-15T17:30:00Z'));
  });

  it('anchors the first 4h equity bucket to the open under EST too', () => {
    // EST open = 14:30 UTC. First 4h bucket covers 14:30-18:30 UTC.
    const open = ts('2024-01-15T14:30:00Z');
    expect(bucketStartEpochSeconds(ts('2024-01-15T14:30:00Z'), FOUR_H, 'rth-equity')).toBe(open);
    expect(bucketStartEpochSeconds(ts('2024-01-15T18:29:59Z'), FOUR_H, 'rth-equity')).toBe(open);
    expect(bucketStartEpochSeconds(ts('2024-01-15T18:30:00Z'), FOUR_H, 'rth-equity'))
      .toBe(ts('2024-01-15T18:30:00Z'));
  });

  it('anchors 2h equity buckets to the open (09:30/11:30/13:30/15:30 ET)', () => {
    const open = ts('2024-07-15T13:30:00Z'); // 09:30 EDT
    expect(bucketStartEpochSeconds(ts('2024-07-15T13:30:00Z'), TWO_H, 'rth-equity')).toBe(open);
    expect(bucketStartEpochSeconds(ts('2024-07-15T15:29:59Z'), TWO_H, 'rth-equity')).toBe(open);
    // 11:30 ET == 15:30 UTC.
    expect(bucketStartEpochSeconds(ts('2024-07-15T15:30:00Z'), TWO_H, 'rth-equity'))
      .toBe(ts('2024-07-15T15:30:00Z'));
    // 13:30 ET == 17:30 UTC.
    expect(bucketStartEpochSeconds(ts('2024-07-15T17:30:00Z'), TWO_H, 'rth-equity'))
      .toBe(ts('2024-07-15T17:30:00Z'));
  });

  it('floors a pre-market bar into the bucket below the open (negative offset)', () => {
    // 08:00 ET (12:00 UTC EDT) is 1.5h before the 09:30 open -> first bucket
    // below the open boundary: open - 4h = 09:30 UTC.
    const preMarket = ts('2024-07-15T12:00:00Z');
    expect(bucketStartEpochSeconds(preMarket, FOUR_H, 'rth-equity'))
      .toBe(ts('2024-07-15T09:30:00Z'));
  });

  it('UTC and RTH anchors DIFFER for the same 4h equity bar (the drift this fixes)', () => {
    const bar = ts('2024-07-15T15:00:00Z'); // 11:00 ET, mid first RTH 4h bucket
    const utc = bucketStartEpochSeconds(bar, FOUR_H, 'utc');         // 12:00 UTC grid
    const rth = bucketStartEpochSeconds(bar, FOUR_H, 'rth-equity');  // 13:30 UTC open
    expect(utc).toBe(ts('2024-07-15T12:00:00Z'));
    expect(rth).toBe(ts('2024-07-15T13:30:00Z'));
    expect(utc).not.toBe(rth); // a UTC-floored equity bucket is mis-anchored by 90 min
  });
});
