/**
 * Producer-agnostic interval fetch-plan resolver
 *
 * TICKET_196_12 Step 2: the single source of truth that decides, for a given
 * provider and a target timeframe, HOW that timeframe is obtained:
 *
 *   - `native`      -> the provider's upstream API serves the target directly
 *                      (target is in `capabilities.nativeIntervals`).
 *   - `aggregate`   -> the target is NOT native, but the provider has a strictly
 *                      finer native bar that evenly divides the target, so the
 *                      target can be produced losslessly by rolling that finer
 *                      bar up via the aggregation service (DATA_001).
 *   - `unsupported` -> neither native nor reachable by aggregation (no finer
 *                      native bar divides evenly into the target).
 *
 * This replaces the per-provider hand-rolled "native vs aggregate vs throw"
 * fragments (each independently wrong in a different way) with ONE central,
 * exhaustively-tested decision. It is a PURE function (no I/O) so it can be
 * reused everywhere: by `getCapabilities().intervals` derivation (Step 3), by
 * the single-timeframe cache path (Step 4), and by the shared unsupported-error
 * contract (Step 6).
 *
 * Central-map driven (TICKET_179 no-magic-numbers, TICKET_854 reuse): the only
 * per-provider hand-authored datum is `capabilities.nativeIntervals`; the
 * minute-arithmetic comes from `@shared/constants/intervals`.
 *
 * @see TICKET_196_12_UNIFIED_ALL_TIMEFRAME_PROVIDER_SUPPORT.md
 */

import type { IDataProvider } from './types';
import {
  parseIntervalToMinutes,
  isValidInterval,
  isDailyOrLarger,
  INTERVAL_1d, INTERVAL_1w, INTERVAL_1M,
  ALL_INTERVALS,
} from '@shared/constants/intervals';

/**
 * Minutes-per-bar for the daily-and-larger intervals, which
 * `parseIntervalToMinutes` deliberately returns `null` for (it only knows
 * intraday). We need a total ordering across the WHOLE central set so the
 * resolver can compare e.g. `1h` (60) against `1d` (1440) and decide which is
 * finer. Calendar months are normalised to 30 days purely for ordering /
 * divisibility comparison -- aggregation never crosses the intraday<->daily
 * boundary in practice (a provider that serves `1d` natively never needs to
 * aggregate `1d` from `1h`), so the exact day-count only matters for ordering.
 */
const DAILY_INTERVAL_MINUTES: Readonly<Record<string, number>> = {
  [INTERVAL_1d]: 1440,
  [INTERVAL_1w]: 10080,
  [INTERVAL_1M]: 43200, // 30d nominal -- ordering/divisibility only
} as const;

/**
 * Total-order minutes for ANY central interval (intraday or daily+).
 * Returns null only for a string that is not a recognised central interval.
 */
export function intervalToMinutes(interval: string): number | null {
  if (isDailyOrLarger(interval)) {
    return DAILY_INTERVAL_MINUTES[interval] ?? null;
  }
  return parseIntervalToMinutes(interval);
}

/**
 * The full central timeframe set in canonical (ascending) order. This is the
 * universe `getCapabilities().intervals` is derived against (Step 3). Order
 * matters: derived `intervals` is emitted in THIS order regardless of the order
 * the provider listed its native set, so the snapshot is stable.
 *
 * Mirrors `shared/constants/intervals.ts` (INTERVAL_MINUTES intraday +
 * DAILY_INTERVALS). Kept as an explicit ordered list because the central map is
 * an object (insertion-ordered but semantically unordered) and the daily set is
 * a separate const; this is the one place that fixes their joint ordering.
 */
export const CENTRAL_TIMEFRAMES: readonly string[] = ALL_INTERVALS;

/**
 * Derive the set of timeframes a provider can SERVE (natively or by
 * aggregation) from its hand-authored native set. This is the Step-3
 * replacement for the per-provider hand-written `intervals: [...]` array:
 * `getCapabilities().intervals = deriveSupportedIntervals(nativeIntervals)`.
 *
 * Pure and side-effect-free so it can run at class-field-init time. It takes the
 * native set directly (not the provider) precisely so a provider literal can
 * call `deriveSupportedIntervals(['1m', ...])` inline without referencing
 * `this`.
 *
 * Returns central timeframes (in CENTRAL_TIMEFRAMES order) that are reachable,
 * i.e. native OR aggregatable from a finer native bar that evenly divides them.
 */
export function deriveSupportedIntervals(nativeIntervals: readonly string[]): string[] {
  // Reuse resolveFetchPlan via a minimal provider shim so the reachability
  // logic lives in exactly ONE place (TICKET_854). Only `id` (for error prose,
  // unused here) and `capabilities.nativeIntervals` are read.
  const shim = {
    id: '<derive>',
    capabilities: { nativeIntervals },
  } as unknown as IDataProvider;
  return CENTRAL_TIMEFRAMES.filter((tf) => isIntervalReachable(shim, tf));
}

/** The provider's upstream API serves this timeframe directly. */
export interface NativeFetchPlan {
  mode: 'native';
  /** The interval to pass straight through to the provider (== target). */
  fetchInterval: string;
}

/**
 * The target is produced by fetching a finer native bar and rolling it up via
 * the aggregation service.
 */
export interface AggregateFetchPlan {
  mode: 'aggregate';
  /** The finer native interval to fetch from the provider. */
  baseInterval: string;
  /** The interval to aggregate up to (== the requested target). */
  target: string;
}

/** The provider cannot serve this timeframe natively or by aggregation. */
export interface UnsupportedFetchPlan {
  mode: 'unsupported';
  /** Structured, user-facing reason (feeds the Step 6 error contract). */
  reason: string;
}

export type FetchPlan = NativeFetchPlan | AggregateFetchPlan | UnsupportedFetchPlan;

/**
 * Resolve how `provider` should obtain `target`.
 *
 * Decision order:
 *  1. target in nativeIntervals                        -> native
 *  2. some nativeInterval strictly finer than target,
 *     and evenly divides target                        -> aggregate (from the
 *        COARSEST such native bar -- minimises fetch volume, e.g. prefer 1h
 *        over 1m when producing 4h)
 *  3. otherwise                                         -> unsupported
 *
 * @throws never -- always returns a discriminated plan (unsupported carries the reason).
 */
export function resolveFetchPlan(provider: IDataProvider, target: string): FetchPlan {
  const nativeIntervals = provider.capabilities.nativeIntervals;

  if (!isValidInterval(target)) {
    return {
      mode: 'unsupported',
      reason:
        `'${provider.id}' was asked for interval '${target}', which is not a ` +
        `recognised timeframe. Valid timeframes: 1m, 5m, 15m, 30m, 1h, 2h, 4h, 1d, 1w, 1M.`,
    };
  }

  // 1. Native passthrough.
  if (nativeIntervals.includes(target)) {
    return { mode: 'native', fetchInterval: target };
  }

  // 2. Aggregation candidate search.
  const targetMinutes = intervalToMinutes(target);
  if (targetMinutes !== null) {
    let best: { interval: string; minutes: number } | null = null;
    for (const native of nativeIntervals) {
      const nativeMinutes = intervalToMinutes(native);
      if (nativeMinutes === null) continue;
      // Strictly finer AND evenly divides the target (lossless rollup).
      if (nativeMinutes < targetMinutes && targetMinutes % nativeMinutes === 0) {
        // Prefer the COARSEST qualifying native bar (largest minutes) to
        // minimise the number of base bars fetched and aggregated.
        if (best === null || nativeMinutes > best.minutes) {
          best = { interval: native, minutes: nativeMinutes };
        }
      }
    }
    if (best !== null) {
      return { mode: 'aggregate', baseInterval: best.interval, target };
    }
  }

  // 3. Genuinely unsupported.
  return {
    mode: 'unsupported',
    reason:
      `Provider '${provider.id}' cannot serve timeframe '${target}': it is not ` +
      `native (native set = [${nativeIntervals.join(', ')}]) and there is no ` +
      `finer native bar that evenly divides into it to aggregate from.`,
  };
}

/**
 * Convenience predicate: is `target` reachable (native OR aggregate) for this
 * provider? Used by the Step 3 `getCapabilities().intervals` derivation.
 */
export function isIntervalReachable(provider: IDataProvider, target: string): boolean {
  return resolveFetchPlan(provider, target).mode !== 'unsupported';
}
