/**
 * Interval Constants (TICKET_1023_2)
 *
 * Named interval string constants for use across the entire project.
 * This is the Tier 0 canonical source; apps/desktop/src/shared/constants/intervals.ts
 * re-exports the same values with additional utility functions.
 *
 * Plugins MUST import from '@StratCraft/types' (this package) rather than
 * from apps/desktop/src/shared/constants/ (tier violation).
 */

export const INTERVAL_1m  = '1m'  as const;
export const INTERVAL_5m  = '5m'  as const;
export const INTERVAL_15m = '15m' as const;
export const INTERVAL_30m = '30m' as const;
export const INTERVAL_1h  = '1h'  as const;
export const INTERVAL_2h  = '2h'  as const;
export const INTERVAL_4h  = '4h'  as const;
export const INTERVAL_1d  = '1d'  as const;
export const INTERVAL_1w  = '1w'  as const;
export const INTERVAL_1M  = '1M'  as const;

/** All supported intervals in ascending order of bar width. */
export const ALL_INTERVALS = [
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m,
  INTERVAL_1h, INTERVAL_2h, INTERVAL_4h,
  INTERVAL_1d, INTERVAL_1w, INTERVAL_1M,
] as const;

/**
 * TICKET_1225 P3: Canonical rank for interval ordering.
 * Lower rank = finer (shorter) bar duration.
 * Used by the FeedPlan builder to determine execution feed (finest TF)
 * and to sort context feeds coarsest-last.
 */
export const INTERVAL_RANK: Readonly<Record<string, number>> = {
  [INTERVAL_1m]:  0,
  [INTERVAL_5m]:  1,
  [INTERVAL_15m]: 2,
  [INTERVAL_30m]: 3,
  [INTERVAL_1h]:  4,
  [INTERVAL_2h]:  5,
  [INTERVAL_4h]:  6,
  [INTERVAL_1d]:  7,
  [INTERVAL_1w]:  8,
  [INTERVAL_1M]:  9,
} as const;

/**
 * TICKET_1225 P3: Compare two intervals by canonical rank.
 * Returns true when `a` is strictly finer (shorter duration) than `b`.
 */
export function isIntervalFinerThan(a: string, b: string): boolean {
  const ra = INTERVAL_RANK[a];
  const rb = INTERVAL_RANK[b];
  if (ra === undefined || rb === undefined) {
    throw new Error(`Unknown interval in comparison: '${ra === undefined ? a : b}'`);
  }
  return ra < rb;
}

const MS_PER_DAY = 86_400_000;

const INTERVAL_MINUTES: Readonly<Record<string, number>> = {
  [INTERVAL_1m]: 1,
  [INTERVAL_5m]: 5,
  [INTERVAL_15m]: 15,
  [INTERVAL_30m]: 30,
  [INTERVAL_1h]: 60,
  [INTERVAL_2h]: 120,
  [INTERVAL_4h]: 240,
};

const DAILY_INTERVALS_SET = new Set<string>([INTERVAL_1d, INTERVAL_1w, INTERVAL_1M]);

/**
 * TICKET_1306_2 / TICKET_1308 7D: Parse an interval string to native bar
 * length in milliseconds.
 *
 * Moved here from `@StratCraft/roster-store` so public-tree code
 * (`shared/constants/intervals.ts`) can re-export without pulling a
 * commercial package dependency.
 */
export function intervalToMs(interval: string): number | null {
  const mins = INTERVAL_MINUTES[interval];
  if (mins !== undefined) return mins * 60_000;
  if (interval === INTERVAL_1d) return MS_PER_DAY;
  if (interval === INTERVAL_1w) return 7 * MS_PER_DAY;
  if (interval === INTERVAL_1M) return 30 * MS_PER_DAY;
  return null;
}
