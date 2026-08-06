/**
 * TICKET_196_12_1 Phase 1 -- expected-bar-count estimator.
 *
 * Pure sibling of `pull-window.ts` (deliberately a SEPARATE module so importing
 * it does NOT drag in `provider-manager` / the data-provider registry that
 * pull-window's other helpers need; the cache layer and its many unit tests can
 * import this without registering providers).
 *
 * Computes the expected NATIVE bar count over a closed calendar span using the
 * SAME provider-self-declared calendar machinery as `pullBarsToCalendarMs`
 * (BAR_SECONDS + capabilities.calendarPaddingRatio). It is the exact inverse of
 * the "N bars -> calendar ms" sizing used at fetch-plan time:
 *   calendarMs = bars * barSec * 1000 * ratio   =>   bars = calendarSpanSec / (barSec * ratio)
 */

import { BAR_SECONDS } from '../../../shared/constants/bar-seconds';

/** Minimal provider shape this estimator needs -- avoids importing IDataProvider
 * (and thus the registry) into pure-math consumers. */
export interface CalendarRatioProvider {
  id: string;
  capabilities: { calendarPaddingRatio?: Readonly<Record<string, number>> };
}

/**
 * Expected NATIVE bar count for a CONTIGUOUS series spanning the closed
 * interval [firstSec, lastSec] (both inclusive, Unix seconds).
 *
 * The padding ratio already encodes the fraction of calendar time the market is
 * OPEN (equity ~3.4x intraday / ~1.4x daily because weekends, holidays and the
 * overnight close are not traded; crypto/FX = 1.0). Dividing the calendar span
 * by the ratio therefore yields the number of bars a CONTIGUOUS series is
 * expected to contain -- with weekend/holiday closures already accounted for.
 * This is the property that prevents the TICKET_362 regression: a normal
 * Fri->Mon or holiday gap is EXPECTED, not flagged as a hole; only a span whose
 * row_count falls materially below this calendar expectation indicates a true
 * interior gap (an interrupted/partial download).
 *
 * Takes the provider instance directly (not an id) so a caller that already
 * holds the provider -- e.g. DataCacheManager.doEnsureData -- needs no registry
 * round-trip, and so stub providers in tests work without registration.
 *
 * Contract:
 *   - `timeframe` must be a key in BAR_SECONDS; unknown throws (fail-fast).
 *   - `lastSec == firstSec` -> 1 bar; reversed span -> 0.
 *   - provider with no calendarPaddingRatio, or missing the requested timeframe,
 *     falls back to ratio 1.0 (24/7 market) -- identical to pullBarsToCalendarMs.
 *
 * Returns the expected bar count as a real number (NOT rounded): callers apply
 * their own tolerance. Both endpoints are inclusive bars, so the span is
 * `last - first` plus one bar; the `+barSec` makes a single-bar series expect 1.
 */
export function expectedBarsForRange(
  provider: CalendarRatioProvider,
  timeframe: string,
  firstSec: number,
  lastSec: number,
): number {
  const barSec = BAR_SECONDS[timeframe];
  if (!barSec) {
    throw new Error(
      `[expectedBarsForRange] unknown timeframe '${timeframe}'. ` +
      `Valid keys are listed in BAR_SECONDS (shared/constants/bar-seconds.ts). ` +
      `(provider '${provider.id}', TICKET_196_12_1 Phase 1)`,
    );
  }
  if (!(lastSec > firstSec)) {
    // Same-bar or reversed span: a series can hold at most the single first bar.
    return lastSec === firstSec ? 1 : 0;
  }
  const ratio = provider.capabilities.calendarPaddingRatio?.[timeframe] ?? 1.0;
  const spanSec = (lastSec - firstSec) + barSec; // inclusive of both endpoints
  return spanSec / (barSec * ratio);
}
