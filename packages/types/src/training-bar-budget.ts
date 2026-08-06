/**
 * TICKET_1326 F1 -- the single owner of the training-bar budget.
 *
 * "How many bars does this sweep train on?" is a function of
 * `(timeframe, workload)`. Before this module, three call sites each
 * hardcoded one point from that space and one ceiling refused two of them:
 *
 *   D1  MCP `start_sweep` schema default        1000   (> ceiling: rejected)
 *   D2  Electron UI store default                100   (Preview-tuned)
 *   D3  `TRAINING_BARS_DEFAULTS` per-timeframe   5000..260  (batch-tuned)
 *   C1  `DISCOVERY_LOOKBACK_BARS_MAX`            500   (Preview-tuned, applied to all)
 *
 * The root cause was not a wrong number -- it was that two different
 * workloads shared one ceiling. This module names the workload, so each
 * gets the bound it was actually tuned for:
 *
 *   - `preview`  interactive Tool Sweep run. Small and fast; the operator is
 *                waiting. Retains C1 = 500 verbatim, which is the guard
 *                TICKET_870 / TICKET_871_1 added after a fossil `730`
 *                silently disabled Run on load. Do NOT raise it.
 *   - `batch`    sweep / scheduler / programmatic re-run. No slider, nobody
 *                waiting, and the training window must span multiple market
 *                regimes (Lopez de Prado, *AFML* ch. 7). Admits D3's table
 *                and TICKET_1262's mandated `TRAINING_BARS=8000`.
 *
 * This module lives in `@StratCraft/types` because it is the only package
 * every tier already depends on: the Electron main process, the MCP
 * standalone server, and the plugin UI (which cannot import from
 * `apps/desktop` per PLUGIN_TICKET_009 tier rules) must all resolve the
 * SAME budget for the same inputs -- that is the whole point (TICKET_1329
 * UAC1/UAC2). Any surface keeping its own literal reintroduces the defect.
 *
 * Scope boundary (TICKET_1326 sec.7): this module makes the existing
 * policies reachable and consistent. It does not re-derive D3's
 * statistical values or TICKET_1262's 8000.
 */

import {
  INTERVAL_1m,
  INTERVAL_5m,
  INTERVAL_15m,
  INTERVAL_30m,
  INTERVAL_1h,
  INTERVAL_4h,
  INTERVAL_1d,
  INTERVAL_1w,
} from './interval-constants';
import { asTrainingBars, type TrainingBars } from './signal-discovery-types';

/**
 * The two dispatch workloads. Named rather than boolean so a third
 * (e.g. a future `live` tier) extends the union instead of inverting a
 * flag at every call site.
 */
export const TRAINING_BAR_WORKLOADS = ['preview', 'batch'] as const;
export type TrainingBarWorkload = (typeof TRAINING_BAR_WORKLOADS)[number];

/** Default workload when a call site does not state one.
 *
 *  `preview` is deliberately the default: it is the *narrower* bound, so an
 *  un-migrated or newly written call site that forgets to declare its
 *  workload gets the conservative Preview ceiling and a loud rejection --
 *  never a silently oversized batch window. Fail-closed on the resource
 *  dimension (TICKET_856: fallbacks must be intentional and
 *  safety-preserving). */
export const TRAINING_BAR_WORKLOAD_DEFAULT: TrainingBarWorkload = 'preview';

/**
 * Lower bound, shared by both workloads. Below ~5 bars nothing downstream
 * is statistically meaningful regardless of who dispatched.
 *
 * This is the value formerly known as `DISCOVERY_LOOKBACK_BARS_MIN`.
 */
export const TRAINING_BARS_MIN = 5;

/**
 * `preview` ceiling -- C1, unchanged at 500.
 *
 * TICKET_870 / TICKET_871_1: this is the bound that keeps the Tool Sweep
 * slider and the IPC validator in agreement. It exists so an out-of-range
 * persisted value cannot disable Run on load. TICKET_1326 F2 requires that
 * it is NOT raised globally -- raising it is how the Preview guard gets
 * lost. It is narrowed to the `preview` workload instead.
 */
export const TRAINING_BARS_PREVIEW_MAX = 500;

/**
 * `batch` ceiling.
 *
 * Sized to admit the two existing batch policies this ticket must not
 * re-derive: D3's largest entry (1m -> 5000) and TICKET_1262's mandated
 * `TRAINING_BARS=8000` for ML template sweeps. 10000 is the next round
 * headroom above both, and matches the `100-10000` range the MCP
 * `start_sweep` schema already advertised in its own description text --
 * so this bound formalises a documented intent rather than inventing one.
 *
 * This is NOT a licence to raise it further. Concurrency and memory are
 * governed separately (TICKET_1071 `SWEEP_MAX_CONCURRENCY=6`); a larger
 * window multiplies per-arm RSS.
 */
export const TRAINING_BARS_BATCH_MAX = 10000;

/** Per-workload bounds. F2's replacement for the single mode-independent C1. */
export const TRAINING_BAR_WORKLOAD_BOUNDS: Readonly<
  Record<TrainingBarWorkload, { readonly min: number; readonly max: number }>
> = {
  preview: { min: TRAINING_BARS_MIN, max: TRAINING_BARS_PREVIEW_MAX },
  batch: { min: TRAINING_BARS_MIN, max: TRAINING_BARS_BATCH_MAX },
} as const;

/**
 * D3 -- default training-bar budget per timeframe for `batch` dispatch.
 *
 * Tuned to Marcos Lopez de Prado (*Advances in Financial Machine
 * Learning*, ch. 7): training windows should span multiple market regimes
 * -- on 1d this means ~2 years, on 1h ~6 months.
 *
 * Relocated verbatim from `apps/desktop/src/shared/constants/signal-discovery.ts`
 * (`TRAINING_BARS_DEFAULTS`) so the plugin tier and the MCP server can read
 * the same table the Electron main process reads. Values are unchanged --
 * retuning them is explicitly out of scope (TICKET_1326 sec.7).
 *
 * Historical note preserved from the original: this replaced a
 * `lookbackBars: 365` (days-thinking) constant in `live-scheduler.ts`,
 * which would have collapsed to ~15 days on 1h after the bars-unit
 * migration.
 */
export const TRAINING_BARS_BATCH_DEFAULTS: Readonly<Record<string, number>> = {
  [INTERVAL_1m]: 5000,
  [INTERVAL_5m]: 3000,
  [INTERVAL_15m]: 2500,
  [INTERVAL_30m]: 2000,
  [INTERVAL_1h]: 2000,
  [INTERVAL_4h]: 1000,
  [INTERVAL_1d]: 500,
  [INTERVAL_1w]: 260,
} as const;

/** Fallback default when the timeframe is absent from the batch table. */
export const TRAINING_BARS_BATCH_FALLBACK = 1000;

/**
 * `preview` default -- D2, unchanged at 100.
 *
 * TICKET_870 / TICKET_871_1: a deliberate Preview-era budget, "well inside
 * the ceiling, fast on 1h." Unlike the batch table this is intentionally
 * NOT per-timeframe: the Preview workload's constraint is operator
 * wall-clock, which does not vary with bar width.
 */
export const TRAINING_BARS_PREVIEW_DEFAULT = 100;

/** Inputs to the resolver. */
export interface TrainingBarBudgetRequest {
  /** Bar interval, e.g. '5m'. Absent/unknown -> the workload's fallback. */
  readonly timeframe?: string | null;
  /** Dispatch workload; omitted defaults to the conservative `preview`. */
  readonly workload?: TrainingBarWorkload;
}

/** The resolved budget plus the bounds that apply to it. */
export interface TrainingBarBudget {
  /** The default budget for these inputs. */
  readonly bars: TrainingBars;
  /** Inclusive lower bound a caller-supplied override must satisfy. */
  readonly min: number;
  /** Inclusive upper bound a caller-supplied override must satisfy. */
  readonly max: number;
  /** Workload actually applied (after defaulting). */
  readonly workload: TrainingBarWorkload;
  /** True when `timeframe` was absent/unknown and the fallback was used.
   *  Surfaced so an agent can state the basis of the number it reports
   *  (TICKET_1327 sec.5: no lookback slider; the agent states the basis). */
  readonly usedFallback: boolean;
}

/** Type guard for the workload union -- for validating wire input. */
export function isTrainingBarWorkload(v: unknown): v is TrainingBarWorkload {
  return typeof v === 'string' && (TRAINING_BAR_WORKLOADS as readonly string[]).includes(v);
}

/**
 * TICKET_1326 F1 -- resolve the training-bar budget.
 *
 * The sole source of every training-bar default and every training-bar
 * bound in the codebase. Every surface (MCP `start_sweep`, the Electron UI
 * store, the CLI chain) delegates here; none keeps a literal (F3/F5, AC5).
 *
 * Guarantee that closes the live defect: the returned `bars` ALWAYS
 * satisfies the returned `min`/`max`, for every workload and every
 * timeframe -- so no advertised default can be rejected by its own
 * validator (AC6). The batch table is clamped rather than trusted, which
 * keeps that invariant true even if a future edit to
 * `TRAINING_BARS_BATCH_DEFAULTS` overshoots the ceiling.
 */
export function resolveTrainingBarBudget(
  request: TrainingBarBudgetRequest = {},
): TrainingBarBudget {
  const workload = request.workload ?? TRAINING_BAR_WORKLOAD_DEFAULT;
  const { min, max } = TRAINING_BAR_WORKLOAD_BOUNDS[workload];

  // Preview is timeframe-independent by design (see the constant's note),
  // so `usedFallback` is only meaningful for batch.
  if (workload === 'preview') {
    return {
      bars: asTrainingBars(clamp(TRAINING_BARS_PREVIEW_DEFAULT, min, max)),
      min,
      max,
      workload,
      usedFallback: false,
    };
  }

  const tf = typeof request.timeframe === 'string' ? request.timeframe.trim() : '';
  const tabled = tf ? TRAINING_BARS_BATCH_DEFAULTS[tf] : undefined;
  const usedFallback = tabled === undefined;
  const raw = usedFallback ? TRAINING_BARS_BATCH_FALLBACK : tabled;

  return {
    bars: asTrainingBars(clamp(raw, min, max)),
    min,
    max,
    workload,
    usedFallback,
  };
}

/**
 * Validate a caller-supplied override against the workload's bounds.
 *
 * Shared so the IPC validator, the MCP handler, and the UI slider all
 * reject the same values with the same message -- the divergence this
 * ticket exists to end. Returns `null` when acceptable.
 */
export function validateTrainingBarOverride(
  value: unknown,
  workload: TrainingBarWorkload = TRAINING_BAR_WORKLOAD_DEFAULT,
): { readonly min: number; readonly max: number } | null {
  const { min, max } = TRAINING_BAR_WORKLOAD_BOUNDS[workload];
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    return { min, max };
  }
  return null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
