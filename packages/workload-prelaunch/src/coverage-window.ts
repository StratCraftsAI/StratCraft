/**
 * TICKET_1370 R10/AC27+AC28: derive the maximal common executable window from
 * physical storage coverage.
 *
 * The window materially changes scope, cost, and duration, so it cannot come
 * from a fixed date, a host-clock lookback, a prompt-supplied range, or a UI
 * placeholder. It is derived from the first/last timestamp already indexed for
 * every selected symbol x timeframe cell:
 *
 *   derivedStartUtc        = max(each cell's first timestamp)
 *   derivedEndUtcExclusive = min(each cell's last timestamp + cell interval)
 *
 * The `+ interval` term converts the last *bar's* opening timestamp into the
 * instant that bar closes, which is the exclusive end of usable data.
 *
 * This module owns the arithmetic only. Reading coverage belongs to the storage
 * owner, which passes cells in; nothing here opens a parquet file or reads
 * history.
 */

import type {
  FactorMiningCoverageCell,
  FactorMiningCoverageWindow,
} from '@StratCraft/types';
import { toCalendarDateUtc, toCanonicalUtcInstant } from './date-window';

export class WorkloadCoverageError extends Error {
  constructor(message: string, readonly remediation: string) {
    super(message);
    this.name = 'WorkloadCoverageError';
    this.code = 'MINING_COVERAGE_UNAVAILABLE';
  }

  readonly code: 'MINING_COVERAGE_UNAVAILABLE';
}

const TIMEFRAME_MS: Readonly<Record<string, number>> = {
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

export function timeframeIntervalMs(timeframe: string): number {
  const interval = TIMEFRAME_MS[timeframe];
  if (interval === undefined) {
    throw new WorkloadCoverageError(
      `Timeframe '${timeframe}' has no known bar interval.`,
      'Select a supported timeframe.',
    );
  }
  return interval;
}

/**
 * Intersect every selected cell's physical coverage.
 *
 * Refuses rather than narrowing silently: a cell with no coverage, or an empty
 * intersection, means the requested scope is not executable, and inventing a
 * window would produce a plan whose reviewed cost does not match what runs.
 */
export function deriveCoverageWindow(
  cells: readonly FactorMiningCoverageCell[],
  snapshotVersion: string,
): FactorMiningCoverageWindow {
  if (cells.length === 0) {
    throw new WorkloadCoverageError(
      'No symbol and timeframe cells were selected, so no data window can be derived.',
      'Select the market scope and timeframes first.',
    );
  }
  let startMs = Number.NEGATIVE_INFINITY;
  let endExclusiveMs = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    if (!Number.isFinite(cell.firstTimestampMs) || !Number.isFinite(cell.lastTimestampMs)) {
      throw new WorkloadCoverageError(
        `Physical coverage for ${cell.symbol} ${cell.timeframe} is missing or unreadable.`,
        'Download or repair the data for this symbol and timeframe, then resolve a fresh review.',
      );
    }
    const cellEndExclusive = cell.lastTimestampMs + timeframeIntervalMs(cell.timeframe);
    if (cell.firstTimestampMs > startMs) startMs = cell.firstTimestampMs;
    if (cellEndExclusive < endExclusiveMs) endExclusiveMs = cellEndExclusive;
  }
  if (endExclusiveMs <= startMs) {
    throw new WorkloadCoverageError(
      'The selected symbols and timeframes have no common data window.',
      'Narrow the market scope or timeframes to cells whose coverage overlaps, then resolve a fresh review.',
    );
  }
  return {
    startUtc: toCanonicalUtcInstant(startMs),
    endUtcExclusive: toCanonicalUtcInstant(endExclusiveMs),
    minimumDate: toCalendarDateUtc(startMs),
    // The picker offers inclusive dates, so the last selectable day is the one
    // containing the final closed bar -- one millisecond before the exclusive
    // end, which excludes a midnight-aligned end from advertising a day that
    // holds no data.
    maximumDate: toCalendarDateUtc(endExclusiveMs - 1),
    snapshotVersion,
  };
}
