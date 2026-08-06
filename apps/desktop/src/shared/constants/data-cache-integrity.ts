/**
 * TICKET_196_12_1 Phase 1 -- data-cache interior-integrity constants.
 *
 * Centralised here (TICKET_179 no-magic-numbers) for the calendar-aware
 * integrity probe in DataCacheManager.doEnsureData. The probe compares a cache
 * entry's stored row_count against the provider-calendar expected bar count for
 * its [first, last] span (see pull-window.ts `expectedBarsForRange`); a count
 * materially below the expectation signals a silently-tolerated INTERIOR gap
 * (an interrupted/partial download) that the endpoint-only needPrepend/needAppend
 * coverage check cannot see.
 */

/**
 * Fraction of the calendar-expected bar count a cache entry must retain to be
 * trusted as fully covered. Below this, the entry is treated as a coverage MISS
 * and its [first, last] span is re-fetched.
 *
 * 0.9 = tolerate a 10% shortfall. The expectation already nets out
 * weekends/holidays via the provider's calendarPaddingRatio, so a healthy
 * contiguous series sits at ~1.0; the 10% slack absorbs benign noise (a single
 * ad-hoc market holiday the ratio's average does not perfectly predict, an
 * early-close half day) WITHOUT masking a real multi-week interior hole, which
 * drops the ratio far below 0.9. Deliberately NOT 1.0 -- an exact match would
 * make every minor calendar-irregularity a false positive and resurrect the
 * TICKET_362 over-eager-refetch failure mode.
 */
export const CACHE_INTEGRITY_COVERAGE_THRESHOLD = 0.9;

/**
 * Minimum calendar-expected bar count before the integrity probe engages.
 * For very short spans the expected-bar estimate is too coarse (a handful of
 * bars over a few days is dominated by which specific days are holidays), so the
 * probe would be noisy. Below this many expected bars we defer to the existing
 * endpoint coverage decision and skip the integrity check.
 */
export const CACHE_INTEGRITY_MIN_EXPECTED_BARS = 30;

/**
 * TICKET_962 R3: when the TICKET_372 virtual coverage extension widens the
 * metadata's `first_timestamp` more than this many days BEFORE the actual
 * parquet `actualFirstTimestamp`, the `[DataCacheManager] Append complete`
 * log line escalates from INFO to WARN. Surfaces "you asked for 1.5 years
 * but only got 40 days" without a developer needing to read parquet by
 * hand. 7 days = a calendar week; anything beyond a week implies a
 * provider-lookback / window-mismatch worth investigating.
 *
 * Not advisory: a WARN is the only diagnostic surface for the metadata
 * vs parquet desync once it lands on disk (TICKET_858 no silent
 * divergence).
 */
export const VIRTUAL_EXTENSION_WARN_DAYS = 7;

/**
 * TICKET_958_3 AC #A: safety margin applied to `pullBarsToCalendarMs` so the
 * request layer over-fetches enough that the universe min-bars gate's actual
 * RTH-count from DuckDB clears the contract's `requiredPullBars`.
 *
 * Root cause this protects against: the per-timeframe `calendarPaddingRatio`
 * (e.g. 5.35 for equity 5m) is an ANNUAL AVERAGE derived from
 * `(24/6.5) * (365/252)`. A specific 56-day window that happens to start on
 * a Saturday, contain 3 market holidays, and end midweek has materially
 * fewer trading days than the annual ratio predicts. The ratio-only window
 * sizing produces 2652 RTH bars in such a window while the gate demands
 * 3017 -- the 12% gap caused TICKET_958 A1-S5 to refuse at the universe
 * gate even though the source parquet had 7020 bars of perfectly healthy
 * 5m data on disk.
 *
 * 0.25 (= 25% inflation) covers the empirically-observed worst-case window
 * boundary loss (~12%) plus generous head-room for half-day closures and
 * non-standard sweep window shapes. Applied at the request layer only --
 * the gate's RTH-count math is unchanged and remains the ground truth.
 *
 * This is deliberately a FAIL-LATE safety margin, not a math fix: the
 * proper, principled fix would be to do trading-day-aware window math at
 * the request site (count actual NYSE trading days in [start, end] and
 * derive `windowMs = tradingDays * 78 * 300s * 1000`). That requires a
 * trading-calendar dependency the codebase does not currently carry, so
 * the safety margin is the surgical alternative until a calendar lands.
 */
export const PULL_WINDOW_SAFETY_MARGIN = 0.25;

// TICKET_958_4 AC #6/#7: the heuristic day-set probe constants
// (`CACHE_INTEGRITY_DAY_PROBE_ENABLED`, `CACHE_INTEGRITY_DAY_PROBE_AUTHORITATIVE`,
// `CACHE_INTEGRITY_DAY_MISSING_THRESHOLD`) were removed when the SHADOW
// probe was retired in favour of a binary trading-day-set check sourced
// from `apps/desktop/src/shared/calendars/trading-calendars.ts`. The
// calendar JSON IS the truth -- a real trading day from the calendar is
// either present in the parquet or it is not, so a missing-fraction
// threshold has no principled meaning. The read-path lazy heal now lives
// in `DataCacheManager.assessTradingDayGap` and routes on
// `missingDays.length > 0`, not a fraction. Do NOT re-introduce these
// constants; see TICKET_958_4 AC #7 and the AC #5 design rationale.
