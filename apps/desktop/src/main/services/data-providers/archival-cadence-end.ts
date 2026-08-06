/**
 * TICKET_919_10 -- archival-cadence-aware window-end anchor.
 *
 * Pure sibling of `pull-window.ts` / `expected-bars.ts`. Computes the
 * window-end timestamp (ms, UTC) that the orchestrator should anchor a
 * hydrate against when the universe lives in an imported package whose
 * publisher releases data on a schedule (HistData monthly archive,
 * Dukascopy month dumps, EOD Historical daily bundles, etc.).
 *
 * Today's `prehydratedEndMs = Date.now()` over-shoots the package's
 * actual tail by up to ~45 days for a `monthly_archive` queried in the
 * first half of the month; window pushdown then returns 0 rows for the
 * trailing gap and the universe min-bars preflight refuses the whole
 * template (the Run #51 symptom this ticket exists to fix). The fix is
 * to anchor on the package's own evidence (per-symbol lastTimestamp
 * cohort) rather than wall-clock, then floor to the cadence's last
 * completed boundary.
 *
 * Composition with TICKET_919_9: 919_9 owns `windowMs` (calendar-ratio
 * correctness, i.e. how many calendar ms 1402 30m bars need to fit a
 * 24/5 forex package); 919_10 owns `endMs` (anchor correctness, i.e.
 * which calendar instant is the last bar the package contains). The
 * caller pivots `startMs = endMs - windowMs`, NOT `Date.now() -
 * windowMs`. Both must land for the symptom to clear (see ticket's
 * composition table).
 *
 * Pure-function contract: no IO, no registry, no DB. The caller supplies
 * the cadence (read once from `imported_packages.archival_cadence`) and
 * the cohort (read once from `data_cache_files` for each resolved
 * symbol). Identical inputs return identical outputs forever -- this is
 * what makes a hydrate manifest reproducible under TICKET_802.
 */

import type { ArchivalCadence } from '../../../shared/constants/data-import';

/**
 * The per-symbol fact this helper consumes. Matches the subset of
 * `CacheRecord` (`first_timestamp` / `last_timestamp` / `row_count` --
 * stored as Unix seconds in SQLite) that the cohort statistics need.
 * Defined as a minimal interface so unit tests can build synthetic
 * cohorts without standing up the data-cache layer.
 */
export interface ResolvedSymbolTail {
  readonly symbol: string;
  /** Unix seconds. The package's last published bar for this symbol. */
  readonly lastTimestamp: number;
}

/**
 * Quantile index used for the cohort upper-bound. p90 is intentional:
 *   - max (p100) trips on a single user-extended outlier (one symbol
 *     hand-patched to 2030 yanks the anchor into a guaranteed-empty
 *     future).
 *   - p50 (median) under-uses data -- in a 60-symbol cohort it ignores
 *     the 30 most-recent symbols, wasting half the freshness signal.
 *   - p95 trips on a tiny tail: with 60 symbols, p95 (R-7) lands at
 *     sorted[56], so any 3 outliers in the top decile become the
 *     anchor.
 *   - p90 (R-7: `floor((n-1) * q)`) at 60 symbols lands at sorted[53] --
 *     the last index still in the bulk when the cohort has 6 outliers
 *     at the top. Tolerates a top-decile outlier band without giving
 *     up the bulk of the freshness signal. Empirically the right knee
 *     for monthly-archive packages which can have 1-3 hand-edited or
 *     corrupt-last-bar tails.
 *
 * Co-locating the constant here (not in `signal-discovery.ts`) because
 * its meaning is bounded to this algorithm; centralising it would lose
 * the why-this-not-p95 rationale that lives next to its use.
 */
const COHORT_UPPER_QUANTILE = 0.90;

/**
 * Resolve the calendar-ms end-anchor for a hydrate window.
 *
 * @param cadence  The package's declared release schedule. `realtime`
 *                 short-circuits to `asOfMs` (bit-exact today's
 *                 behaviour for registered providers, which have no
 *                 `imported_packages` row and therefore resolve to
 *                 `realtime` at the caller).
 * @param cohort   The per-symbol `lastTimestamp` evidence from the
 *                 universe's resolved symbols. After TICKET_919_8 this
 *                 cohort is already cleansed of window-non-intersecting
 *                 dead symbols, so the distribution reflects the
 *                 genuinely-usable cohort. Empty cohort -> `asOfMs`
 *                 (defensive: no evidence to anchor on, fall through
 *                 to wall-clock and let the downstream universe
 *                 min-bars preflight surface the all-empty case
 *                 unchanged from today).
 * @param asOfMs   The wall-clock anchor used as the upper bound for
 *                 `realtime` and the defensive fall-through. Threading
 *                 it as a parameter (rather than calling `Date.now()`
 *                 inside) keeps the helper pure and deterministically
 *                 unit-testable.
 *
 * @returns Unix milliseconds. Always rounded down to the second to
 *          match the integer-second domain SQLite stores.
 */
export function resolveArchivalCadenceEndMs(
  cadence: ArchivalCadence,
  cohort: ReadonlyArray<ResolvedSymbolTail>,
  asOfMs: number,
): number {
  if (cadence === 'realtime') return asOfMs;
  if (cohort.length === 0) return asOfMs;

  // Cohort upper-quantile of lastTimestamp -- the freshness signal,
  // robust to a few outliers in either direction.
  const sortedSec = cohort
    .map((s) => s.lastTimestamp)
    .filter((t) => Number.isFinite(t) && t > 0)
    .sort((a, b) => a - b);
  if (sortedSec.length === 0) return asOfMs;
  // R-7 / numpy default quantile (linear-interpolation form, floored):
  //   idx = floor((n - 1) * q)
  // The textbook `floor(n * q)` form lands one index too high on a
  // cohort whose outlier count exactly matches `(1 - q) * n`: a
  // 60-symbol cohort with 6 user-extended outliers gives
  // `floor(60 * 0.9) = 54`, which falls in the outlier band rather
  // than just below it. Using `(n - 1) * q` returns sorted[53] for
  // the same cohort, which is the last index still in the bulk -- so
  // a top-decile outlier band is genuinely excluded as the
  // co-located rationale comment claims.
  const idx = Math.max(
    0,
    Math.min(
      Math.floor((sortedSec.length - 1) * COHORT_UPPER_QUANTILE),
      sortedSec.length - 1,
    ),
  );
  const upperSec = sortedSec[idx];

  if (cadence === 'snapshot') {
    // No future publication expected; the cohort tail IS the truth.
    // No archival floor to apply -- a hand-curated dump's last bar is
    // wherever the user put it, and we honour that.
    return upperSec * 1000;
  }

  // Archive cadences: floor to the cadence's last completed boundary,
  // then take the min with the cohort upper-quantile so the anchor
  // never claims data further than what is on disk.
  const floorSec = floorToArchivalBoundary(upperSec, cadence);
  return Math.min(upperSec, floorSec) * 1000;
}

/**
 * Last second of the cadence's published unit that `pointSec` falls in.
 *
 * - monthly_archive: last second of the calendar month (UTC).
 * - weekly_archive : last second of the ISO week (Sunday 23:59:59 UTC).
 * - daily_eod      : last second of the UTC day.
 *
 * `snapshot` / `realtime` never reach this helper -- guarded above.
 * Defensive fall-through returns `pointSec` unchanged so a future
 * cadence added to the enum without a floor rule degrades gracefully
 * (the cohort upper-quantile becomes the anchor; safe, not silent).
 */
function floorToArchivalBoundary(pointSec: number, cadence: ArchivalCadence): number {
  const d = new Date(pointSec * 1000);
  if (cadence === 'monthly_archive') {
    // `new Date(Date.UTC(year, month + 1, 0))` -> last day of `month`.
    const last = new Date(Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      0,
      23, 59, 59,
    ));
    return Math.floor(last.getTime() / 1000);
  }
  if (cadence === 'weekly_archive') {
    // ISO week ends Sunday 23:59:59 UTC. `getUTCDay()` returns 0 for
    // Sunday, 1..6 for Mon..Sat -- map Sunday to 7 so the delta to
    // Sunday is always >= 0.
    const dayIdx = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    const sunday = new Date(Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() + (7 - dayIdx),
      23, 59, 59,
    ));
    return Math.floor(sunday.getTime() / 1000);
  }
  if (cadence === 'daily_eod') {
    const last = Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      23, 59, 59,
    );
    return Math.floor(last / 1000);
  }
  // Defensive: unrecognised cadence -> no floor applied. The cohort
  // upper-quantile (via the outer `Math.min`) becomes the effective
  // anchor. Future cadence additions to the enum get a sensible
  // degraded behaviour without a silent crash.
  return pointSec;
}
