/**
 * Lookback constraint utilities shared between DownloadQueuePanel and BacktestPage.
 *
 * TICKET_340_1: Original implementation in DownloadQueuePanel
 * TICKET_364: Extracted to shared module for reuse in BacktestPage auto-adjust
 */

const MS_PER_DAY = 86400000;

/**
 * Parse maxLookback duration string to milliseconds.
 * Supports: '7d', '60d', '730d', '24h', '60m' format.
 */
export function parseLookbackMs(lookback: string): number {
  const match = lookback.match(/^(\d+)([dhm])$/);
  if (!match) return Infinity;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'd') return value * MS_PER_DAY;
  if (unit === 'h') return value * 3600000;
  if (unit === 'm') return value * 60000;
  return Infinity;
}

/**
 * Compute earliest allowed startDate for a given interval.
 * Returns null if no constraint applies.
 */
export function computeMinStartDate(
  interval: string,
  maxLookback: Record<string, string> | undefined,
  endDate: string,
): string | null {
  if (!maxLookback || !endDate) return null;
  const limit = maxLookback[interval];
  if (!limit) return null;
  const limitMs = parseLookbackMs(limit);
  if (limitMs === Infinity) return null;
  const end = new Date(endDate);
  const min = new Date(end.getTime() - limitMs);
  return min.toISOString().slice(0, 10);
}
