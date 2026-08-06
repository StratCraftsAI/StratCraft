/**
 * TICKET_1331 F1 -- the single owner of the batch training WINDOW contract.
 *
 * "How far back does this sweep train?" had no owner and no expression. The
 * CatBoost chain trained on ALL available history -- 1,886,122 bars per symbol
 * for 5m forex, spanning 2000-05-30 to 2026-06-26 (measured on
 * `EURUSD_5m.parquet`, 2026-07-30). The manifests declared
 * `"start_date": "2000-01-01"` / `"end_date": "2025-12-31"`, which reads as a
 * deliberate window, but `fit_universe.py` consults neither field on the
 * holdout path: `start_date` is read only under the walk-forward branch
 * (`fit_universe.py:773`), which the chain never takes. A declared-but-inert
 * window is worse than no window -- an operator reading the manifest concludes
 * the run is bounded.
 *
 * WHY THIS IS NOT `resolveTrainingBarBudget` (TICKET_1331 sec.2):
 * That resolver returns a BAR COUNT, and its `batch` table gives `5m -> 3000`.
 * TICKET_1329 P4 was originally scheduled as "make the chain call it like every
 * other surface"; doing so would have cut 5m training from 26 years to about
 * TEN DAYS while reporting that a conflicting-defaults root cause was fixed.
 * The two are different quantities for different constraints -- bars for an
 * interactive preview's wall-clock and per-arm RSS, TIME for a research chain's
 * regime coverage. This module does not unify them and must not grow a bar
 * count; `training-bar-budget.ts` must not grow a time span.
 *
 * WHY `@StratCraft/types`: the TICKET_1329 sec.5.5 lesson -- it is the only
 * package the plugin tier, the Electron main process, and the MCP standalone
 * server all already import. A window default that cannot be read by every
 * surface re-diverges the moment a third surface needs it. Nothing here may
 * import from `apps/desktop` (PLUGIN_TICKET_009 tier rules).
 *
 * PURITY CONTRACT (inherited from `sweep-launch.ts`): every function here is
 * pure. No `fs`, no `process.env`, and no `Date.now()` -- the caller supplies
 * `nowMs`. That is what lets the identical resolution run in the Electron main
 * process, in the MCP server, and -- via a thin bridge -- in bash.
 */

/**
 * The default training window, in years, for `batch` dispatch.
 *
 * TWO YEARS. The reasoning (TICKET_1331 sec.3):
 *
 *   - Regime coverage without regime obsolescence. Lopez de Prado (*AFML*
 *     ch. 7) requires a span covering multiple market regimes; the same
 *     chapter's argument against unbounded windows is that structural breaks
 *     make distant history actively MISLEADING, not merely uninformative. Two
 *     years of 5m forex is ~185,000 bars per symbol at ~92k bars/year --
 *     ample sample, current distribution.
 *   - 26 years is not a longer version of 2 years. The 2000-2008 forex
 *     microstructure (wider spreads, pre-algorithmic flow, different session
 *     liquidity) is a different data-generating process; pooling it with
 *     2024-2026 biases the fit toward a market that no longer exists.
 *   - It is the span the existing batch policy was already expressing.
 *     `TRAINING_BARS_BATCH_DEFAULTS` maps `1d -> 500` and documents its own
 *     reasoning as "on 1d this means ~2 years" (`training-bar-budget.ts`).
 *     That table simply had no way to say it for 5m, where 2 years is 185k
 *     bars against a 10,000 ceiling.
 *   - Resource dimension: per-arm frames shrink ~10x, which directly relieves
 *     the per-arm RSS that TICKET_1071 records as the OOM cause.
 *
 * This is a DEFAULT, not a cap: `resolveTrainingWindow` accepts an explicit
 * override, and `TRAINING_WINDOW_ALL` keeps full history reachable.
 */
export const TRAINING_WINDOW_YEARS_DEFAULT = 2;

/**
 * The token that selects full available history.
 *
 * Retained deliberately: the pre-TICKET_1331 behaviour must stay REACHABLE, so
 * an operator who genuinely wants 26 years is not driven back to hand-editing a
 * tracked manifest (the TICKET_1325 anti-pattern). It must never be SILENT --
 * `describeTrainingWindow` states it explicitly, which is the whole difference
 * between this and the defect.
 */
export const TRAINING_WINDOW_ALL = 'all' as const;

/**
 * Bounds on an explicit window, in years.
 *
 * The lower bound is one quarter: below that, a `batch` window cannot span even
 * one regime, and the request is far more likely a units mistake (months typed
 * as years) than an intent. The upper bound is 30, above the 26 years any
 * symbol in the histdata forex set actually has -- so it bounds typos
 * (`200` for `20`) without ever clipping a real request. Beyond real coverage,
 * `TRAINING_WINDOW_ALL` is the honest way to ask for everything.
 */
export const TRAINING_WINDOW_YEARS_MIN = 0.25;
export const TRAINING_WINDOW_YEARS_MAX = 30;

/** Mean tropical year in days -- the conversion basis for years -> seconds.
 *  365.2425 (the Gregorian mean) rather than 365, so a multi-year window does
 *  not drift a day per four years against the calendar date an operator has in
 *  mind. */
const DAYS_PER_YEAR = 365.2425;
const SECONDS_PER_DAY = 86400;

/** Where the effective window came from.
 *
 *  Reported in the launch log for the TICKET_1325 F5 reason: a one-line log
 *  must distinguish "the operator asked for 2 years" from "the operator asked
 *  for nothing and got the default". Without the source, a bounded run is
 *  indistinguishable from a run whose bound was an accident. */
export type TrainingWindowSource = 'default' | 'explicit' | 'all';

/** A resolved training window. */
export interface TrainingWindow {
  /** Inclusive lower bound, epoch SECONDS -- the unit `load_ohlcv` filters on
   *  (`ohlcv_parquet.py`). `null` only for the `all` selection. */
  readonly startS: number | null;
  /** Exclusive upper bound, epoch SECONDS. `null` for `all`, and also for a
   *  bounded window: the chain trains up to the newest available bar, so
   *  pinning an upper bound would silently discard fresh data. */
  readonly endS: number | null;
  /** Effective span in years; `null` for `all`. */
  readonly years: number | null;
  readonly source: TrainingWindowSource;
}

export interface TrainingWindowError {
  readonly ok: false;
  /** Caller-facing: names the offending value AND the accepted forms (the
   *  TICKET_1325 AC3 refusal shape). */
  readonly error: string;
}

export interface TrainingWindowOk {
  readonly ok: true;
  readonly window: TrainingWindow;
}

export type TrainingWindowResult = TrainingWindowOk | TrainingWindowError;

export interface TrainingWindowRequest {
  /** The operator's selection: a number of years, a numeric string, the
   *  `'all'` token, or absent/empty for the default. */
  readonly years?: unknown;
  /** Reference "now", epoch MILLISECONDS. Supplied by the caller because this
   *  module is pure -- see the purity contract above. */
  readonly nowMs: number;
}

/**
 * TICKET_1331 F1 -- resolve a training-window selection.
 *
 * FAIL-FAST, NOT CLAMP: an out-of-range or unparseable value is refused naming
 * the value and the accepted forms. Clamping would silently train on a
 * different span than the operator asked for, and the resulting run would look
 * successful -- the same failure mode TICKET_1325 F2 rejected for timeframes.
 *
 * Guarantee closing the UAC4 invariant for this contract: the default
 * (`TRAINING_WINDOW_YEARS_DEFAULT`) always satisfies
 * `[TRAINING_WINDOW_YEARS_MIN, TRAINING_WINDOW_YEARS_MAX]`, so no advertised
 * default can be rejected by this function -- pinned by a test.
 */
export function resolveTrainingWindow(
  request: TrainingWindowRequest,
): TrainingWindowResult {
  const { nowMs } = request;
  if (!Number.isFinite(nowMs)) {
    return {
      ok: false,
      error: `Training window requires a finite reference time; got nowMs=${JSON.stringify(nowMs)}.`,
    };
  }

  const raw = request.years;
  const token = typeof raw === 'string' ? raw.trim() : raw;

  // Absent / empty -> the default. Not an error (mirrors the timeframe
  // selection: an omitted selection IS the default, TICKET_1325 AC2).
  if (token === undefined || token === null || token === '') {
    return {
      ok: true,
      window: buildWindow(TRAINING_WINDOW_YEARS_DEFAULT, nowMs, 'default'),
    };
  }

  if (typeof token === 'string' && token.toLowerCase() === TRAINING_WINDOW_ALL) {
    return {
      ok: true,
      window: { startS: null, endS: null, years: null, source: 'all' },
    };
  }

  const years = Number(token);
  if (!Number.isFinite(years)) {
    return { ok: false, error: refusal(token) };
  }
  if (years < TRAINING_WINDOW_YEARS_MIN || years > TRAINING_WINDOW_YEARS_MAX) {
    return { ok: false, error: refusal(token) };
  }

  return { ok: true, window: buildWindow(years, nowMs, 'explicit') };
}

function refusal(value: unknown): string {
  return (
    `Invalid training window ${JSON.stringify(value)}. ` +
    `Expected a number of years between ${TRAINING_WINDOW_YEARS_MIN} and ` +
    `${TRAINING_WINDOW_YEARS_MAX}, or '${TRAINING_WINDOW_ALL}' for full ` +
    `available history. Omit for the default (${TRAINING_WINDOW_YEARS_DEFAULT}).`
  );
}

/**
 * Build a bounded window ending at `nowMs`.
 *
 * `endS` stays `null` rather than being pinned to `nowMs`: the chain must train
 * up to the newest available bar, and a parquet can contain bars stamped ahead
 * of the launching host's clock (the histdata 5m set already extends to
 * 2026-06-26). An upper bound at "now" would silently discard them -- a bounded
 * read must never become a truncated one.
 */
function buildWindow(
  years: number,
  nowMs: number,
  source: TrainingWindowSource,
): TrainingWindow {
  const nowS = Math.floor(nowMs / 1000);
  const spanS = Math.round(years * DAYS_PER_YEAR * SECONDS_PER_DAY);
  return { startS: nowS - spanS, endS: null, years, source };
}

/** Convert a resolved window's `startS` to the `YYYY-MM-DD` form the manifest's
 *  `start_date` field carries. `null` for `all`.
 *
 *  Day granularity matches the manifest field's existing shape. The chain
 *  writes `window_start_ms` alongside it for the precise bound, exactly as
 *  TICKET_1133 prefers -- `start_date` is day-truncated and can be up to a day
 *  early, which is why it is the fallback and not the anchor. */
export function trainingWindowStartDate(window: TrainingWindow): string | null {
  if (window.startS === null) return null;
  return new Date(window.startS * 1000).toISOString().slice(0, 10);
}

/**
 * TICKET_1331 F4 -- the log sentence for an effective window.
 *
 * Both surfaces emit this so a journal is readable regardless of launcher, and
 * so full history -- which remains reachable -- is never silent (AC3).
 */
export function describeTrainingWindow(window: TrainingWindow): string {
  if (window.source === 'all') {
    return 'Training window: ALL available history [explicit opt-in]';
  }
  const origin = window.source === 'default' ? 'default' : 'explicit';
  const from = trainingWindowStartDate(window) ?? 'unknown';
  return `Training window: ${window.years}y (from ${from} to newest bar) [${origin}]`;
}
