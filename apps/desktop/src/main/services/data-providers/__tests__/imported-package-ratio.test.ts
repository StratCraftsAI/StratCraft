/**
 * TICKET_919_9 -- unit tests for computePackageCalendarRatios.
 *
 * The property under test: a 24/7 stream yields ratio ~1.0, a 24/5
 * stream yields ratio ~7/5 = 1.4, and one stale-near-end symbol
 * does not pull the package median.
 */

import { describe, it, expect } from 'vitest';
import { computePackageCalendarRatios } from '../imported-package-ratio';
import { BAR_SECONDS } from '../../../../shared/constants/bar-seconds';

const DAY = 86400;
const SEC = (iso: string) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000);

function syntheticContiguousRow(interval: string, firstSec: number, days: number) {
  const barSec = BAR_SECONDS[interval];
  // True 24/7: rowCount = (spanSec + barSec) / barSec
  const spanSec = days * DAY;
  const lastSec = firstSec + spanSec - barSec;
  const rowCount = Math.floor((lastSec - firstSec + barSec) / barSec);
  return { interval, firstTimestamp: firstSec, lastTimestamp: lastSec, rowCount };
}

function syntheticForexRow(interval: string, firstSec: number, days: number) {
  const barSec = BAR_SECONDS[interval];
  // 24/5: only 5 out of every 7 days carries bars.
  const spanSec = days * DAY;
  const lastSec = firstSec + spanSec - barSec;
  const rowCount = Math.floor(((days * 5) / 7) * (DAY / barSec));
  return { interval, firstTimestamp: firstSec, lastTimestamp: lastSec, rowCount };
}

describe('computePackageCalendarRatios', () => {
  it('returns ~1.0 for a synthetic 24/7 1h stream over 1 year', () => {
    const rows = ['BTC-USD', 'ETH-USD', 'SOL-USD'].map(() =>
      syntheticContiguousRow('1h', SEC('2024-01-01'), 365),
    );
    const ratios = computePackageCalendarRatios(rows);
    expect(ratios['1h']).toBeCloseTo(1.0, 3);
  });

  it('returns ~1.4 for a synthetic 24/5 30m forex stream', () => {
    const rows = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF'].map(() =>
      syntheticForexRow('30m', SEC('2020-01-01'), 7 * 100),
    );
    const ratios = computePackageCalendarRatios(rows);
    expect(ratios['30m']).toBeCloseTo(1.4, 1);
  });

  it('is robust to one stale-near-end outlier (median property)', () => {
    const good = ['A', 'B', 'C', 'D'].map(() =>
      syntheticContiguousRow('1d', SEC('2020-01-01'), 1000),
    );
    // Outlier: same span on disk, but only 10% of expected bars (early delisting).
    const outlier = syntheticContiguousRow('1d', SEC('2020-01-01'), 1000);
    outlier.rowCount = Math.floor(outlier.rowCount * 0.1);
    const ratios = computePackageCalendarRatios([...good, outlier]);
    // Median of [1, 1, 1, 1, 10] is 1, not 2.8.
    expect(ratios['1d']).toBeCloseTo(1.0, 3);
  });

  it('omits intervals that have no usable rows (no fabrication)', () => {
    const ratios = computePackageCalendarRatios([
      { interval: '1h', firstTimestamp: 0, lastTimestamp: 0, rowCount: 1 }, // skip (rowCount<=1)
      { interval: '1d', firstTimestamp: 10 * DAY, lastTimestamp: 0, rowCount: 5 }, // skip (reversed: span = -10d + 1d < 0)
      { interval: 'tick', firstTimestamp: 0, lastTimestamp: 86400, rowCount: 1000 }, // skip (unknown tf)
    ]);
    expect(ratios).toEqual({});
  });

  it('skips non-finite spans and non-integer row counts', () => {
    const ratios = computePackageCalendarRatios([
      { interval: '1h', firstTimestamp: Number.NaN, lastTimestamp: 0, rowCount: 100 },
      { interval: '1h', firstTimestamp: 0, lastTimestamp: 3600, rowCount: 1.5 },
    ]);
    expect(ratios).toEqual({});
  });

  it('returns an empty object for an empty input array', () => {
    expect(computePackageCalendarRatios([])).toEqual({});
  });

  it('aggregates per interval independently', () => {
    const rows = [
      syntheticContiguousRow('1h', SEC('2024-01-01'), 365),
      syntheticForexRow('30m', SEC('2020-01-01'), 7 * 100),
    ];
    const ratios = computePackageCalendarRatios(rows);
    expect(ratios['1h']).toBeCloseTo(1.0, 3);
    expect(ratios['30m']).toBeCloseTo(1.4, 1);
  });
});
