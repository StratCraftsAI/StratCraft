/**
 * Interval Constants and Utilities
 *
 * TICKET_254: ClickHouse Multi-Timeframe Support
 *
 * Centralizes interval-to-minutes mapping for consistent SQL aggregation
 * across the application.
 */

// ---------------------------------------------------------------------------
// Named interval constants (TICKET_1023_2)
//
// Imported from the Tier 0 canonical source (packages/types) and re-exported.
// Use these instead of raw string literals throughout the codebase.
// ---------------------------------------------------------------------------
import {
  INTERVAL_1m,
  INTERVAL_5m,
  INTERVAL_15m,
  INTERVAL_30m,
  INTERVAL_1h,
  INTERVAL_2h,
  INTERVAL_4h,
  INTERVAL_1d,
  INTERVAL_1w,
  INTERVAL_1M,
  ALL_INTERVALS,
} from '@StratCraft/types';

export {
  INTERVAL_1m,
  INTERVAL_5m,
  INTERVAL_15m,
  INTERVAL_30m,
  INTERVAL_1h,
  INTERVAL_2h,
  INTERVAL_4h,
  INTERVAL_1d,
  INTERVAL_1w,
  INTERVAL_1M,
  ALL_INTERVALS,
};

// Interval to minutes mapping (intraday intervals only)
export const INTERVAL_MINUTES: Record<string, number> = {
  [INTERVAL_1m]:  1,
  [INTERVAL_5m]:  5,
  [INTERVAL_15m]: 15,
  [INTERVAL_30m]: 30,
  [INTERVAL_1h]:  60,
  [INTERVAL_2h]:  120,
  [INTERVAL_4h]:  240,
} as const;

// Daily and larger intervals (use date-based aggregation, not minute-based)
export const DAILY_INTERVALS = [INTERVAL_1d, INTERVAL_1w, INTERVAL_1M] as const;
export type DailyInterval = (typeof DAILY_INTERVALS)[number];

/**
 * Parse interval string to minutes
 * @returns number of minutes for intraday intervals, null for daily/weekly/monthly
 */
export function parseIntervalToMinutes(interval: string): number | null {
  if (DAILY_INTERVALS.includes(interval as DailyInterval)) {
    return null;
  }
  return INTERVAL_MINUTES[interval] ?? null;
}

/**
 * Check if interval is daily or larger (1d, 1w, 1M)
 */
export function isDailyOrLarger(interval: string): boolean {
  return DAILY_INTERVALS.includes(interval as DailyInterval);
}

/**
 * Get all supported intraday intervals
 */
export function getIntradayIntervals(): string[] {
  return Object.keys(INTERVAL_MINUTES);
}

/**
 * Validate if interval is supported
 */
export function isValidInterval(interval: string): boolean {
  return interval in INTERVAL_MINUTES || DAILY_INTERVALS.includes(interval as DailyInterval);
}

/**
 * TICKET_954_1 Change 4: parse interval string to native bar length in
 * milliseconds. Used by the scoreboard writer to convert the Python
 * envelope's `last_observation_at_ms` into `staleness_bars` (an integer
 * bar count, the schema's canonical unit) and by the roster panel reader.
 *
 * TICKET_1308 7D: moved to the Tier 0 `@StratCraft/types` package so the
 * public release tree does not pull the commercial `@StratCraft/roster-store`.
 * Re-exported here so every project-wide `intervals.ts` importer keeps its
 * import path and there is ONE runtime definition (TICKET_854 reuse).
 */
export { intervalToMs } from '@StratCraft/types';
