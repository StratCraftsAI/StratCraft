/**
 * TICKET_849 Phase D3 -- provider-aware pull-window sizing.
 *
 * Before Phase D3, calendar inflation for "N market bars -> calendar ms"
 * lived in a global `EQUITY_CALENDAR_RATIO` table inside
 * `shared/constants/signal-discovery.ts`, accessed via
 * `trainingBarsToCalendarMs(bars, timeframe, assetClass)`. Callers had to
 * reverse-map a provider id string to an asset class through
 * `inferAssetClass('yfinance' -> 'equity')` -- adding a new provider
 * forced you to touch the orchestrator's heuristic.
 *
 * Phase D3 moves the per-timeframe ratio table into each provider's
 * `capabilities.calendarPaddingRatio`, and gives callers one entry
 * point: `pullBarsToCalendarMs(bars, timeframe, providerId)`. The
 * provider self-declares its own calendar; the orchestrator no longer
 * needs to know whether ClickHouse currently serves equity or crypto.
 *
 * TICKET_919_9 -- imported-package branch. Before 919_9, an unregistered
 * provider id (BYOD imported package -- `forex`, custom DuckDB import,
 * etc.) silently fell back to ratio=1.0 (24/7 market). That broke the
 * mixed fan-out prehydrate for 24/5 forex packages: a 1402-bar 30m
 * dispatch sized for 29.2 calendar days actually delivered only ~363
 * bars per symbol (real ratio ~1.4), failing the universe min-bars
 * gate and refusing every template across 60 symbols (Run #51).
 *
 * The fix: imported packages self-declare a per-interval
 * `calendarPaddingRatio` at import time
 * (`imported_packages.calendar_padding_ratio_json`, v85), and this
 * function reads it via `getDataCacheManager().getImportedPackage(...)`.
 * Imported packages without a ratio for the requested timeframe THROW
 * (TICKET_857 / 858) with a re-import recovery message -- the back-fill
 * makes that throw unreachable in practice, but it is the correct
 * fail-fast guard rather than a quiet 24/7 default.
 *
 * Pure module from the consumer's perspective: it reads the provider
 * registry once per call, no IO, no caching beyond the registry's own.
 *
 * Contract:
 *   - `bars` >= 0; non-finite or negative throws.
 *   - `timeframe` must be a key in `BAR_SECONDS`; unknown throws.
 *   - `providerId` matches an `imported_packages.package_name` row
 *     (BYOD) -> read its self-declared ratio; throw if the requested
 *     timeframe is absent.
 *   - `providerId` matches a registered live provider -> read its
 *     `capabilities.calendarPaddingRatio`; absent timeframe -> 1.0.
 *   - Unknown id (test harness, fake) -> ratio = 1.0.
 *
 * Migration shim: `trainingBarsToCalendarMs` in
 * `shared/constants/signal-discovery.ts` is retained for the renderer
 * and the validator (paths that do not own a provider id). It is now
 * documented as the asset-class fallback; new code must use this
 * function.
 */

import {
  type TrainingBars,
} from '@StratCraft/types';
import { BAR_SECONDS } from '../../../shared/constants/bar-seconds';
import { PULL_WINDOW_SAFETY_MARGIN } from '../../../shared/constants/data-cache-integrity';
import { getDataProviderManager } from './provider-manager';
import { getDataCacheManager } from '../data-cache-manager';

/**
 * Convert a training-bar budget into a calendar-millisecond window
 * by reading the provider's self-declared calendar padding ratio.
 *
 * @returns calendar-ms window (rounded up so manifests never
 *   under-fetch).
 */
export function pullBarsToCalendarMs(
  bars: TrainingBars | number,
  timeframe: string,
  providerId: string,
): number {
  const barsValue = bars as number;
  if (!Number.isFinite(barsValue) || barsValue < 0) {
    throw new Error(
      `[pullBarsToCalendarMs] bars must be a non-negative finite number; ` +
      `got ${barsValue} (TICKET_849 Phase D3).`,
    );
  }
  const sec = BAR_SECONDS[timeframe];
  if (!sec) {
    throw new Error(
      `[pullBarsToCalendarMs] unknown timeframe '${timeframe}'. ` +
      `Valid keys are listed in BAR_SECONDS (shared/constants/bar-seconds.ts).`,
    );
  }
  // TICKET_919_9: imported-package branch FIRST. The fact that a
  // providerId names a BYOD package (rather than a registered live
  // provider) is owned by `imported_packages` -- read it via DCM. The
  // package's self-declared per-interval ratio was persisted at import
  // time by `registerImportedPackage`; absent timeframes throw rather
  // than silently fall back to 1.0 (per TICKET_857 / 858).
  const importedPkg = getDataCacheManager().getImportedPackage(providerId);
  if (importedPkg) {
    const ratio = importedPkg.calendarPaddingRatio[timeframe];
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) {
      throw new Error(
        `[pullBarsToCalendarMs] imported package '${providerId}' has no ` +
        `calendar_padding_ratio for timeframe '${timeframe}'. ` +
        `Re-import the package, or the v85 backfill found no usable bars ` +
        `for this interval (row_count <= 1 / reversed timestamps). ` +
        `(TICKET_919_9 -- no 24/7 fallback is allowed for imported packages.)`,
      );
    }
    return Math.ceil(barsValue * sec * 1000 * ratio);
  }

  const mgr = getDataProviderManager();
  let ratio = 1.0;
  if (mgr.hasProvider(providerId)) {
    ratio = mgr.getProvider(providerId).capabilities.calendarPaddingRatio?.[timeframe] ?? 1.0;
  }
  return Math.ceil(barsValue * sec * 1000 * ratio);
}

/**
 * TICKET_958_3 AC #A: request-side window sizing with safety margin.
 *
 * `pullBarsToCalendarMs` returns the calendar window for the AVERAGE case
 * (annual-mean ratio). For a specific window starting on a Saturday with 3
 * embedded holidays, that average understates the calendar days needed to
 * collect `bars` RTH bars -- and the universe min-bars gate counts ACTUAL
 * RTH rows from DuckDB, so it refuses the sweep even though the source has
 * plenty of data.
 *
 * This wrapper is the request-side entry point: it inflates the average
 * window by `PULL_WINDOW_SAFETY_MARGIN` so the gate's actual count clears
 * `requiredPullBars`. Use this everywhere the orchestrator / driver / job
 * queue computes the START of a fetch window from a target bar count.
 *
 * Do NOT use this for the interior-integrity probe (`expectedBarsForRange`)
 * or any reading that asks "given a parquet's actual [first, last] span,
 * how many bars should it contain?" -- those readers compare against the
 * unbiased ratio, and inflating their expectation would make a perfectly
 * filled cache look 20% short and trigger spurious heals.
 *
 * Live evidence (2026-06-14 09:58 UTC, TICKET_958_3 reconcile run):
 *   request: 600 RTH bars at 5m equity, ratio=5.35
 *   pullBarsToCalendarMs       -> ~56 calendar days -> ~2652 actual RTH bars
 *   pullBarsToCalendarMsRequest -> ~70 calendar days -> ~3315 actual RTH bars
 *   gate's requiredPullBars(600, walk-forward k=5) = 3017
 *   -> margin clears the gate, base does not.
 */
export function pullBarsToCalendarMsRequest(
  bars: TrainingBars | number,
  timeframe: string,
  providerId: string,
): number {
  const baseMs = pullBarsToCalendarMs(bars, timeframe, providerId);
  return Math.ceil(baseMs * (1 + PULL_WINDOW_SAFETY_MARGIN));
}

/**
 * Derive a calendar-day start-date string ('YYYY-MM-DD') given a
 * training-bar budget and a provider. Centralises the `new
 * Date(Date.now() - windowMs).toISOString().split('T')[0]` idiom that
 * appeared at every Phase D2 callsite.
 *
 * Returns the calendar date that is `windowMs` ago in UTC -- the same
 * surface area the orchestrator already feeds into
 * `getDataStorageService().ensureUniverse({ startDate })`.
 */
export function pullStartDateForBars(
  bars: TrainingBars | number,
  timeframe: string,
  providerId: string,
  nowMs: number = Date.now(),
): string {
  const windowMs = pullBarsToCalendarMs(bars, timeframe, providerId);
  return new Date(nowMs - windowMs).toISOString().split('T')[0];
}

/**
 * Convenience wrapper for callers that have no concrete provider id
 * (single-asset paths that go through `ensureSingle` without naming a
 * provider, validator / correlation-check paths). Reads the default
 * provider's `calendarPaddingRatio` -- matches the pre-Phase-D3
 * `inferAssetClass(undefined) === 'equity'` semantics because the
 * default provider is always an equity provider (yfinance in the
 * public release, Alpaca on the BYOK path).
 *
 * Use the explicit `pullBarsToCalendarMs(..., providerId)` form when
 * the caller knows which provider it is dispatching against; this
 * helper is the fallback for paths whose provider identity is
 * `ensureSingle`-managed.
 */
export function pullBarsToCalendarMsDefault(
  bars: TrainingBars | number,
  timeframe: string,
): number {
  const providerId = getDataProviderManager().getDefaultProvider().id;
  return pullBarsToCalendarMs(bars, timeframe, providerId);
}

/**
 * TICKET_958_3 AC #A: request-side variant of `pullBarsToCalendarMsDefault`.
 * See `pullBarsToCalendarMsRequest` for the rationale. Use this at any
 * single-asset request site that computes a fetch start-date from a
 * training-bar budget; do NOT use it for interior-integrity readers.
 */
export function pullBarsToCalendarMsRequestDefault(
  bars: TrainingBars | number,
  timeframe: string,
): number {
  const providerId = getDataProviderManager().getDefaultProvider().id;
  return pullBarsToCalendarMsRequest(bars, timeframe, providerId);
}

const MAX_LOOKBACK_RE = /^(\d+)([dwmy])$/i;
const MAX_LOOKBACK_UNIT_MS: Record<string, number> = {
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  m: 30 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

// TICKET_962 P1: exported so `data-cache-manager.ensureData` can clamp the
// requested window against `provider.capabilities.maxLookback` directly --
// the single source of truth for "what spec strings are legal". Re-use over
// re-implement (TICKET_854). Fail-fast on unknown unit (TICKET_857).
export function parseMaxLookbackMs(spec: string): number {
  const m = MAX_LOOKBACK_RE.exec(spec);
  if (!m) {
    throw new Error(
      `[parseMaxLookbackMs] invalid maxLookback spec '${spec}'; ` +
      `expected e.g. '7d', '60d', '730d'.`,
    );
  }
  return parseInt(m[1], 10) * MAX_LOOKBACK_UNIT_MS[m[2].toLowerCase()];
}

/**
 * TICKET_955: check whether a requested calendar-time window exceeds
 * the provider's declared `maxLookback` for a given timeframe.
 *
 * Returns `null` if the window is within limits (or the provider
 * declares no limit for that timeframe). Otherwise returns a
 * diagnostic object describing the constraint violation.
 *
 * TICKET_970_2 NOTE: this helper is NO LONGER the primary surface for
 * the Run Backtest Layer 1 pre-run capability gate. The gate now goes
 * through `DataAvailabilityCatalog.computeEffectiveReplayWindow`
 * (L0+L1+training+requested -- single surface shared with Layer 5 +
 * sweep pre-flight). This helper stays available for the data-fetch
 * call sites (`fetchOhlcvWithFallback` and friends) that still need a
 * pure L0 check at the bar-fetch boundary; new gate logic must go
 * through the catalog, not here.
 */
export function checkProviderMaxLookback(
  providerId: string,
  timeframe: string,
  requestedWindowMs: number,
): { maxLookbackMs: number; maxLookbackSpec: string; requestedDays: number; maxDays: number } | null {
  const mgr = getDataProviderManager();
  if (!mgr.hasProvider(providerId)) return null;
  const caps = mgr.getProvider(providerId).capabilities;
  if (!caps.maxLookback) return null;
  const spec = caps.maxLookback[timeframe];
  if (!spec) return null;
  const maxMs = parseMaxLookbackMs(spec);
  if (requestedWindowMs <= maxMs) return null;
  return {
    maxLookbackMs: maxMs,
    maxLookbackSpec: spec,
    requestedDays: Math.ceil(requestedWindowMs / (24 * 60 * 60 * 1000)),
    maxDays: Math.floor(maxMs / (24 * 60 * 60 * 1000)),
  };
}
