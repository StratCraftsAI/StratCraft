/**
 * TICKET_958_4 -- Cache write-boundary invariants (AC #1, AC #4)
 * TICKET_1072_1 -- Soft gate: checkMissingTradingDays returns a
 *   diagnostic instead of throwing, so data is always written.
 *
 * These helpers run *before* `atomicWriteParquet` at every cache write site
 * (`fetchRange` post-loop, `doEnsureData` merge branch, `healInteriorGap`
 * post-merge).
 *
 * `checkMissingTradingDays` (TICKET_1072_1) returns a `MissingDaysResult`
 * so the caller can log + persist the gap without discarding the data.
 *
 * `assertMergeDoesNotShrinkDaySet` (AC #4) remains a hard throw -- a merge
 * that drops an existing day is a regression that would corrupt the cache.
 *
 * Both helpers consume `enumerateTradingDays` (TICKET_958_4 C1) -- the static,
 * checked-in JSON day-set for NYSE / XSHG_XSHE plus the synthetic
 * CRYPTO_24_7 / FX_5_24 / NONE calendars. A provider declaring
 * `tradingCalendar = 'NONE'` short-circuits both invariants
 * (imported-package providers are user-owned truth).
 */

import type { IDataProvider, OHLCVRow } from '../data-providers/types';
import {
  enumerateTradingDays,
  formatTradingDay,
} from '../../../shared/calendars/trading-calendars';

const MS_PER_SECOND = 1000;
const MS_PER_DAY = 86_400_000;
const MAX_MISSING_DAYS_IN_MESSAGE = 5;

/**
 * Error thrown by both `assertNoMissingTradingDays` (AC #1) and
 * `assertMergeDoesNotShrinkDaySet` (AC #4). Carries structured fields so
 * downstream code (UI, logs) can render the failure without re-parsing the
 * message. Propagates through `ensureSingle` / `ensureUniverse` per
 * TICKET_858 (no swallow, no fallback).
 */
export class CacheWriteIntegrityError extends Error {
  public readonly missingDays: number[];
  public readonly provider: string;
  public readonly interval: string;
  public readonly requestedRange: [number, number];
  public readonly kind: 'fetch-hole' | 'merge-shrink';

  constructor(
    message: string,
    fields: {
      missingDays: number[];
      provider: string;
      interval: string;
      requestedRange: [number, number];
      kind: 'fetch-hole' | 'merge-shrink';
    },
  ) {
    super(message);
    this.name = 'CacheWriteIntegrityError';
    this.missingDays = fields.missingDays;
    this.provider = fields.provider;
    this.interval = fields.interval;
    this.requestedRange = fields.requestedRange;
    this.kind = fields.kind;
  }
}

function startOfUtcDayMs(epochMs: number): number {
  return Math.floor(epochMs / MS_PER_DAY) * MS_PER_DAY;
}

/**
 * Build the set of UTC-midnight epoch-ms present in `rows`. Rows carry
 * Unix-seconds timestamps (`IDataProvider` contract -- types.ts:242).
 */
function daySetFromRows(rows: ReadonlyArray<OHLCVRow>): Set<number> {
  const out = new Set<number>();
  for (const r of rows) {
    out.add(startOfUtcDayMs(r.timestamp * MS_PER_SECOND));
  }
  return out;
}

function formatMissingDays(missing: number[]): string {
  const head = missing
    .slice(0, MAX_MISSING_DAYS_IN_MESSAGE)
    .map(formatTradingDay)
    .join(', ');
  const tail =
    missing.length > MAX_MISSING_DAYS_IN_MESSAGE
      ? `, +${missing.length - MAX_MISSING_DAYS_IN_MESSAGE} more`
      : '';
  return `${head}${tail}`;
}

/**
 * TICKET_1072_1 -- result of a trading-day completeness check.
 * Returned by `checkMissingTradingDays`; callers log any gaps as warnings
 * and persist `completeness` + `missingDays` to metadata.
 */
export interface MissingDaysResult {
  missingDays: number[];
  expectedDays: number;
  actualDays: number;
  completeness: number;
  calendar: string;
}

const PERFECT_RESULT: MissingDaysResult = {
  missingDays: [],
  expectedDays: 0,
  actualDays: 0,
  completeness: 1.0,
  calendar: 'NONE',
};

/**
 * TICKET_1072_1 -- non-throwing trading-day completeness diagnostic.
 *
 * Checks every trading day in `[startMs, endMs]` (per the provider's
 * declared calendar) is represented by at least one row in `rows`.
 * Returns a `MissingDaysResult` so the caller can decide what to do
 * (log, persist, surface in UI) without discarding the data.
 *
 * Providers with `tradingCalendar === 'NONE'` short-circuit to
 * completeness 1.0 (imported-package providers are user-owned truth).
 */
export function checkMissingTradingDays(
  rows: ReadonlyArray<OHLCVRow>,
  provider: IDataProvider,
  interval: string,
  startMs: number,
  endMs: number,
): MissingDaysResult {
  const calendar = provider.capabilities.tradingCalendar;
  if (calendar === 'NONE') return { ...PERFECT_RESULT, calendar };
  if (endMs < startMs) return { ...PERFECT_RESULT, calendar };

  const expected = enumerateTradingDays(calendar, startMs, endMs);
  if (expected.length === 0) return { missingDays: [], expectedDays: 0, actualDays: 0, completeness: 1.0, calendar };

  const todayMs = startOfUtcDayMs(Date.now());
  const actual = daySetFromRows(rows);
  const missing = expected.filter((d) => d !== todayMs && !actual.has(d));
  const actualDays = expected.length - missing.length;

  return {
    missingDays: missing,
    expectedDays: expected.length,
    actualDays,
    completeness: expected.length > 0 ? actualDays / expected.length : 1.0,
    calendar,
  };
}

/**
 * Format a `MissingDaysResult` into a human-readable warning message.
 * Returns `null` when completeness is 1.0 (no warning needed).
 */
export function formatMissingDaysWarning(
  result: MissingDaysResult,
  providerId: string,
  rowCount: number,
  startMs: number,
  endMs: number,
): string | null {
  if (result.missingDays.length === 0) return null;
  return (
    `Provider ${providerId} returned ${rowCount} rows over ` +
    `[${formatTradingDay(startMs)}, ${formatTradingDay(endMs)}] missing ` +
    `${result.missingDays.length} trading day${result.missingDays.length === 1 ? '' : 's'} ` +
    `(${result.calendar}): ${formatMissingDays(result.missingDays)} ` +
    `(completeness ${(result.completeness * 100).toFixed(1)}%)`
  );
}

/**
 * TICKET_958_4 AC #1 -- write-boundary trading-day invariant (legacy throw).
 *
 * Delegates to `checkMissingTradingDays` and throws on any gap. Retained
 * for test backward-compatibility; production call sites should use
 * `checkMissingTradingDays` directly (TICKET_1072_1).
 */
export function assertNoMissingTradingDays(
  rows: ReadonlyArray<OHLCVRow>,
  provider: IDataProvider,
  interval: string,
  startMs: number,
  endMs: number,
): void {
  const result = checkMissingTradingDays(rows, provider, interval, startMs, endMs);
  if (result.missingDays.length === 0) return;

  throw new CacheWriteIntegrityError(
    `Provider ${provider.id} returned ${rows.length} rows over ` +
      `[${formatTradingDay(startMs)}, ${formatTradingDay(endMs)}] missing ` +
      `${result.missingDays.length} trading day${result.missingDays.length === 1 ? '' : 's'} ` +
      `(${result.calendar}): ${formatMissingDays(result.missingDays)}`,
    {
      missingDays: result.missingDays,
      provider: provider.id,
      interval,
      requestedRange: [startMs, endMs],
      kind: 'fetch-hole',
    },
  );
}

/**
 * TICKET_958_4 AC #4 -- merge-never-shrinks-day-set invariant.
 *
 * Asserts that every trading day present in `existingRows` is still present
 * in `mergedRows`. Defends against a future provider regression returning
 * fewer rows than the existing cache holds for the overlapped window:
 * without this check, the merge would silently corrupt the cache; with it,
 * the existing file stays intact and the error surfaces.
 *
 * Unlike AC #1 this check does NOT consult the trading calendar -- it
 * operates purely on the set difference between existing and merged. That
 * makes it correct even for `tradingCalendar === 'NONE'` providers (imported
 * packages): a merge that would drop an existing day in an imported file is
 * still a bug, regardless of whether the user's calendar matches any standard.
 */
export function assertMergeDoesNotShrinkDaySet(
  existingRows: ReadonlyArray<OHLCVRow>,
  mergedRows: ReadonlyArray<OHLCVRow>,
  provider: IDataProvider,
  symbol: string,
  interval: string,
): void {
  if (existingRows.length === 0) return;

  const existingDays = daySetFromRows(existingRows);
  const mergedDays = daySetFromRows(mergedRows);
  const dropped: number[] = [];
  for (const d of existingDays) {
    if (!mergedDays.has(d)) dropped.push(d);
  }
  if (dropped.length === 0) return;

  dropped.sort((a, b) => a - b);
  throw new CacheWriteIntegrityError(
    `Merge for ${symbol}/${interval}/${provider.id} would drop ` +
      `${dropped.length} day${dropped.length === 1 ? '' : 's'} that existed in cache ` +
      `(existing=${existingRows.length} merged=${mergedRows.length}). ` +
      `Missing: ${formatMissingDays(dropped)}. ` +
      `Indicates either a provider regression or a dedup bug -- aborting ` +
      `write to preserve the existing cache.`,
    {
      missingDays: dropped,
      provider: provider.id,
      interval,
      requestedRange: [dropped[0], dropped[dropped.length - 1]],
      kind: 'merge-shrink',
    },
  );
}
