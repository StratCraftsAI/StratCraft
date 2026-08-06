/**
 * TICKET_927_3_1 -- Per-bucket bar-level orchestrator contract.
 *
 * Tier-0 typed contract for "what runs, in what order, at every bar inside a
 * single bucket". One owner -- `PerBucketBarOrchestrator` -- declares the
 * fixed sequence of stages as a `const`-tuple in its type. Every per-bar knob
 * landed by Wave 5 (927_1_4_B regime gate, 927_1_4_C costs, 927_1_4_D risk /
 * vol target / turnover) is a stage implementation on this orchestrator,
 * **not** an ad-hoc call inside `replayPortfolio`. `BucketReplayLoop` drives
 * the orchestrator across the bucket's bars and returns the
 * `PortfolioBookResult` type from TICKET_927_4_1.
 *
 * Adding a stage REQUIRES editing `BAR_STAGES` here -- which fails
 * type-checks across every implementation file, forcing explicit
 * cross-Wave review. The sequence is the only enforcement of "what runs
 * when" at the bar layer. No knob may insert a step out of order or skip a
 * step by reaching into another stage's slot.
 *
 * TICKET_927 section 0.1 invariant ENFORCED at the bar layer HERE:
 * `step(barTs, barInputs, prevState)` -- `prevState` is the prior BUCKET's
 * state and nothing else; an alpaca bar's step physically cannot read
 * forex state, because the forex bucket's orchestrator instance is a
 * different object with a different `BarState` history.
 */

import type { MarketId } from './market-id';

/**
 * TICKET_927_3_1: the enumerated per-bar sequence. Adding a stage
 * REQUIRES editing this tuple -- which fails type-checks across every
 * implementation file, forcing explicit cross-Wave review.
 */
export type BarStageId =
  | 'regime_gate'             // 927_1_4_B
  | 'fuse_signals'            // 927_1_3 (per-market partition)
  | 'apply_risk_constraints'  // 927_1_4_D
  | 'apply_vol_target'        // 927_1_4_D
  | 'apply_force_field_sizing' // 1148_2: multi-scale force decomposition position scale
  | 'apply_turnover_control'  // 927_1_4_D
  | 'build_target_portfolio'  // 927_3 (build only -- no I/O)
  | 'generate_orders'         // 927_3 (target -> orders, no I/O)
  | 'simulate_fills'          // existing replay forward-fill / fill model
  | 'filter_unprofitable'     // 1129_2: suppress orders whose cost > alpha
  | 'charge_costs'            // 927_1_4_C
  | 'mark_to_market'          // 927_1_B-aware via Instrument
  | 'update_equity';          // append the bucket's equity curve point

/**
 * TICKET_927_3_1: the const-tuple declaration of the per-bar sequence.
 * `BAR_STAGES` is the only declaration; the `BarStagesTuple` type is
 * derived from this const tuple, not declared in parallel
 * (TICKET_854 -- single source of truth).
 */
export const BAR_STAGES = [
  'regime_gate',
  'fuse_signals',
  'apply_risk_constraints',
  'apply_vol_target',
  'apply_force_field_sizing',
  'apply_turnover_control',
  'build_target_portfolio',
  'generate_orders',
  'simulate_fills',
  'filter_unprofitable',
  'charge_costs',
  'mark_to_market',
  'update_equity',
] as const satisfies readonly BarStageId[];

/** Compile-time identity: derived from `BAR_STAGES`. TICKET_854 -- one source. */
export type BarStagesTuple = typeof BAR_STAGES;

/**
 * TICKET_927_3_1: minimal per-symbol OHLC view consumed by the orchestrator's
 * `simulate_fills` and `mark_to_market` stages. Mirrors the per-bar slice of
 * the bucket's already-prefetched window; no I/O happens inside `step()`.
 */
export interface BarOHLC {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * TICKET_927_3_1: per-symbol target weight + realised forward return -- the
 * minimal per-bar cross-section the fused-signal stage feeds into the
 * downstream weight pipeline. Promoted into the tier-0 types so the
 * orchestrator interface does not deep-import a service-layer shape.
 */
export interface FusedBarEntry {
  readonly symbol: string;
  readonly score: number;
  readonly rNext: number;
}

/**
 * TICKET_927_3_1: cross-section produced by the per-market fusion trunk
 * (TICKET_927_1_3) for the bar at `barTs`. Per-market partitioning has
 * already happened upstream; the orchestrator only sees the entries that
 * belong to this market's bucket.
 */
export interface FusedBarCrossSection {
  readonly barTs: number;
  readonly entries: ReadonlyArray<FusedBarEntry>;
}

/**
 * TICKET_1062_4: iterable + counted container for fused cross-sections.
 * Accepts both a plain ReadonlyArray (TS fallback / tests) and a lazy
 * cursor that yields one cross-section at a time from typed arrays
 * (C++ columnar path). The replay loop iterates via `for...of` and
 * reads `.barCount` for progress tracking.
 */
export interface FusedBarIterable extends Iterable<FusedBarCrossSection> {
  readonly barCount: number;
  readonly pairCount: number;
}

export function wrapArrayAsFusedBarIterable(
  bars: FusedBarCrossSection[],
): FusedBarIterable {
  let cachedPairCount: number | undefined;
  return {
    barCount: bars.length,
    get pairCount(): number {
      if (cachedPairCount === undefined) {
        cachedPairCount = bars.reduce((n, b) => n + b.entries.length, 0);
      }
      return cachedPairCount;
    },
    [Symbol.iterator]() { return bars[Symbol.iterator](); },
  };
}

export interface BarInputs {
  /** ns since epoch -- bar timestamp this `step()` invocation operates on. */
  readonly barTs: number;
  /** Per-market, already-partitioned fused cross-section from TICKET_927_1_3. */
  readonly fused: FusedBarCrossSection;
  /** Per-symbol OHLC slice within this market for `barTs`. May be empty for
   *  symbols that do not trade this bar (handled by `simulate_fills`). */
  readonly ohlcAtT: ReadonlyMap<string, BarOHLC>;
  /** TICKET_927_1_4_B input: raw regime observation for this bar, if any.
   *  Optional -- a missing observation means "regime unknown" (safe
   *  fallback, full exposure) per TICKET_880_3_9. */
  readonly regimeObs?: {
    readonly state: number;
    readonly posterior: number;
  };
}

/** TICKET_1261: rolling vol-target state — O(1) per bar. */
export interface VolTargetState {
  readonly buf: Float64Array;
  readonly head: number;
  readonly count: number;
  readonly barsSeen: number;
  readonly sum: number;
  readonly sumSq: number;
}

export function emptyVolTargetState(capacity: number): VolTargetState {
  return {
    buf: new Float64Array(capacity),
    head: 0,
    count: 0,
    barsSeen: 0,
    sum: 0,
    sumSq: 0,
  };
}

/**
 * TICKET_927_3_1: per-bar state carried from `step(t-1)` to `step(t)` inside
 * one bucket. Pure value object -- the orchestrator instance NEVER mutates
 * any of these in place. section 0.1 invariant: this state is the prior
 * BUCKET's state and nothing else; a different market's bucket has its own
 * orchestrator instance with its own `BarState` history, so cross-bucket
 * leak is structurally impossible.
 */
export interface BarState {
  /** Per-symbol weight at t-1 (the actual book held after `step(t-1)`). */
  readonly wPrev: ReadonlyMap<string, number>;
  /** Bucket equity at t-1 (after this bucket's cost charge). */
  readonly equityPrev: number;
  /** Running peak NET equity inside this bucket -- input to the C1 drawdown
   *  exposure scalar (TICKET_880_3_6). */
  readonly peakNetEquity: number;
  /** Per-bucket cash (in bucket's quote ccy). */
  readonly cashPrev: number;
  /** TICKET_927_1_4_D turnover-penalty EWMA state. */
  readonly turnoverEwmaPrev: number;
  /** Number of bars elapsed since the drawdown last exceeded the cap.
   *  `Number.POSITIVE_INFINITY` means "fully recovered, no live drawdown". */
  readonly barsSinceRecovery: number;
  /** TICKET_1261: rolling vol-target state — O(1) per-bar ring buffer with
   *  incremental sum/sumSq. Replaces the O(lookback) array that cost 26.6s
   *  per 1.9M-bar replay at lb=6048. Null when vol-target is disabled. */
  readonly volTargetState: VolTargetState | null;
  /** Bar index inside the bucket (0-based). `simulate_fills` /
   *  `apply_turnover_control` consult this to detect the first bar
   *  (cost-free / no prior book to smooth against). */
  readonly barIndex: number;
  /** TICKET_1131: per-symbol trailing rNext ring buffers for
   *  `signal_vol_adjusted` construction rule. Each entry is a fixed-size
   *  Float64Array with head pointer. Null when the rule is not
   *  `signal_vol_adjusted` (no allocation on unneeded paths). */
  readonly perSymbolVol: ReadonlyMap<string, {
    readonly buf: Float64Array;
    readonly head: number;
    readonly count: number;
  }> | null;
  /** TICKET_1129_5: EWMA score-calibration state. Observations through
   *  bar t-1 ONLY -- the gate at bar t must never see bar t's rNext
   *  (lookahead; see TICKET_1129_3 rejection). */
  readonly scoreCalib: {
    readonly sxy: number;
    readonly sxx: number;
    readonly obs: number;
    /** TICKET_1129_6: EWMA of per-bar mean(score_t * score_{t-1}) --
     *  numerator of the lag-1 score autocorrelation phi. */
    readonly sAuto: number;
    /** TICKET_1129_6: EWMA of per-bar mean(score_{t-1}^2) -- denominator
     *  of phi. */
    readonly sLagVar: number;
    /** TICKET_1129_6: sane lag-pair observations folded in (phi warmup
     *  counter, same threshold constant as `obs`). */
    readonly lagObs: number;
    /** TICKET_1129_6: previous bar's sane scores, for lag-1 pairing at
     *  the next bar. Symbols absent here contribute no pair. */
    readonly prevScores: ReadonlyMap<string, number>;
  };
}

/** TICKET_1129_6: the one place that constructs the initial (bar-0)
 *  `scoreCalib` state -- the replay loop and every test fixture use this
 *  factory instead of hand-writing the literal (TICKET_854). */
export function emptyScoreCalibState(): BarState['scoreCalib'] {
  return {
    sxy: 0,
    sxx: 0,
    obs: 0,
    sAuto: 0,
    sLagVar: 0,
    lagObs: 0,
    prevScores: new Map<string, number>(),
  };
}

/**
 * TICKET_927_3_1: minimal `OrderIntent` produced by `generate_orders` and
 * consumed by `simulate_fills`. Promoted into tier-0 so the orchestrator
 * interface does not deep-import the order-generator service shape; the
 * real (Wave 5 / 927_3) implementation enriches this object via structural
 * extension.
 */
export interface OrderIntent {
  readonly symbol: string;
  /** Signed target weight delta (`+` = increase long, `-` = increase short). */
  readonly deltaWeight: number;
}

/**
 * TICKET_927_3_1: the per-bar step output. `BucketReplayLoop` accumulates
 * the `BarStep` stream into the bucket's `PortfolioBookResult`.
 */
export interface BarStep {
  /** New state to feed into `step(t+1)`. Never mutated from `prevState`;
   *  always returned fresh. */
  readonly newState: BarState;
  /** Orders emitted by `generate_orders`. */
  readonly ordersEmitted: ReadonlyArray<OrderIntent>;
  /** Cost charged by `charge_costs` for this bar (>= 0). */
  readonly costCharged: number;
  /** Equity point appended by `update_equity` (GROSS curve). Field name
   *  is `timestamp` (not `ts`) to match `PortfolioEquityPoint` so the
   *  loop can splice this directly into `PortfolioBookResult.equityCurve`
   *  without a per-field rename hop. */
  readonly equityPoint: { readonly timestamp: number; readonly equity: number };
  /** NET equity point appended by `update_equity`. Same field-name
   *  convention as `equityPoint` above. */
  readonly netEquityPoint: { readonly timestamp: number; readonly equity: number };
  /** GROSS per-bar return (used by metrics + vol-target history). */
  readonly grossReturn: number;
  /** NET per-bar return (= grossReturn - costCharged). */
  readonly netReturn: number;
  /** One-sided turnover this bar (>= 0). */
  readonly turnover: number;
  /** Per-symbol contribution increments produced by `mark_to_market`. */
  readonly contributionBySymbol: ReadonlyMap<string, number>;
  /** Symbols seen in this bar's cross-section (for `nSymbols`). */
  readonly symbolsSeen: ReadonlySet<string>;
  /** Vol-target leverage applied to the target book this bar. */
  readonly barLeverage: number;
  /** TICKET_880_3_6: 1 if drawdown exposure scalar < 1 (deleveraged). */
  readonly drawdownTriggered: boolean;
  /** TICKET_880_3_9: 1 if regime gate flattened this bar's book. */
  readonly regimeGated: boolean;
  /** True iff this bar was a rebalance bar (vs a hold bar). */
  readonly wasRebalance: boolean;
  /** TICKET_1126 F3: true when equity crossed the bankruptcy floor
   *  (<= 0) at this bar. Equity is clamped at 0 (never compounded past
   *  zero) and the replay loop terminates the book as 'bankrupt'. */
  readonly bankrupt: boolean;
  /** TICKET_1126 F3: cross-section entries skipped this bar by the input
   *  sanity gate (non-finite or insane |r_next|). Per-symbol skip
   *  semantics (TICKET_1048) -- the rest of the bar trades normally. */
  readonly insaneEntriesSkipped: ReadonlyArray<{ symbol: string; rNext: number }>;
  /** TICKET_1129_2: count of per-symbol orders suppressed by the
   *  net-alpha profitability gate this bar. */
  readonly ordersSuppressedByGate: number;
  /** TICKET_1129_5: calibration beta used by the gate this bar
   *  (null = warmup raw-score fallback). */
  readonly calibBetaUsed: number | null;
  /** TICKET_1129_6: effective holding-period horizon (in bars) the gate
   *  multiplied the calibrated alpha by this bar. 1 during phi warmup;
   *  null when the gate ran the raw-score fallback (beta warmup) or on
   *  hold/first bars. */
  readonly calibHorizonUsed: number | null;
  /** TICKET_1148_2: force-field position scale applied this bar.
   *  1.0 = no adjustment (disabled or date not in lookup); null = feature
   *  disabled entirely. */
  readonly forceFieldScale: number | null;
}

/**
 * TICKET_927_3_1: the per-bucket bar-level orchestrator. One instance per
 * bucket per backtest run. Holds per-market-resolved knobs (regime, cost,
 * risk) injected at construction; stages read from the instance, never
 * from globals.
 */
export interface PerBucketBarOrchestrator {
  readonly market: MarketId;

  /** Declares -- at the type level -- that the sequence is exactly
   *  `BAR_STAGES`. An implementation that reorders or omits is a type error. */
  readonly stages: BarStagesTuple;

  /** Pure function of (barInputs, prevState). NO side effects on the
   *  orchestrator instance -- `newState` is returned, never written back. */
  step(barTs: number, barInputs: BarInputs, prevState: BarState): BarStep;
}

/**
 * TICKET_927_3_1: the per-bucket replay loop input. Owns the bucket's
 * already-validated fused cross-section stream + per-symbol OHLC and the
 * per-market execution metadata (interval, currency). The orchestrator
 * never reads from this object; the loop does the per-bar dispatch.
 */
export interface BucketContext {
  readonly market: MarketId;
  /** Per-bar cross-sections in temporal order, already partitioned to
   *  this market by the upstream fusion trunk (TICKET_927_1_3).
   *  TICKET_1062_4: accepts FusedBarIterable (lazy cursor or array wrapper). */
  readonly fusedBars: FusedBarIterable;
  /** Per-bar per-symbol OHLC slice, keyed by `barTs`. The loop hands the
   *  matching slice to `step()` via `BarInputs.ohlcAtT`. */
  readonly ohlcByTs: ReadonlyMap<number, ReadonlyMap<string, BarOHLC>>;
  /** Per-bar raw regime observation, keyed by `barTs`. */
  readonly regimeByTs: ReadonlyMap<number, { state: number; posterior: number }>;
  /** TICKET_927_1 section 5 Q6: per-market execution interval. */
  readonly executionInterval: string;
  /** Per-bucket quote currency (ISO 4217). FX conversion is a firm-level
   *  concern; the orchestrator never reads it. */
  readonly quoteCcy: string;
}

/**
 * TICKET_927_3_1: the per-bucket replay loop. Drives the orchestrator from
 * the bucket's first bar to its last, in temporal order. Returns the
 * per-bucket `PortfolioBookResult` that TICKET_927_4_1's aggregator
 * consumes. Wave 5 tickets edit stage implementations on the orchestrator,
 * NEVER this loop.
 */
export interface BucketReplayLoop {
  /** Driver entry point. Builds the initial `BarState`, walks the bucket's
   *  bars in temporal order, calls `orchestrator.step` per bar, and folds
   *  the `BarStep` stream into the per-bucket `PortfolioBookResult`. */
  run(
    bucket: BucketContext,
    orchestrator: PerBucketBarOrchestrator,
  ): import('./portfolio-book').PortfolioBookResult;
}
