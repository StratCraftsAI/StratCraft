/**
 * TICKET_927_4_1 -- tier-0 promotion of `PortfolioBacktestResult` as the
 * canonical per-market `PortfolioBookResult`.
 *
 * Per the ticket, "the per-market book" is a tier-0 type by usage:
 * `replayPortfolio` produces it, the cross-market `FirmPortfolioAggregator`
 * consumes a `Map<MarketId, PortfolioBookResult>` of them, the universe
 * handler ships it in its response, and (Wave 5) the backtest-run
 * persistence reads it. Module-local placement in
 * `factor-portfolio-backtest.ts` was the wrong layer; promoting it here
 * eliminates the drift hazard where each cross-package consumer either
 * deep-imports a service file or re-declares the shape.
 *
 * No behavioural change in `replayPortfolio` -- only the import path moves.
 * The original module re-exports both `PortfolioBookResult` and its
 * back-compat alias `PortfolioBacktestResult` so existing call sites keep
 * compiling unchanged (TICKET_853, TICKET_854).
 */

import type { Currency } from './currency';

/** Position-construction rule: how a per-bar cross-section of scores becomes
 *  per-symbol target weights. */
export type ConstructionRule =
  | 'rank_long_short'
  | 'score_weighted'
  | 'long_only_top'
  | 'signal_vol_adjusted';

/** One point on the portfolio equity curve. */
export interface PortfolioEquityPoint {
  timestamp: number;
  equity: number;
}

/**
 * TICKET_1263_1 D1: columnar representation of an equity curve using
 * preallocated Float64Arrays. Eliminates per-point object allocation in
 * the replay loop hot path (~5 allocs/bar x 1.9M bars).
 *
 * `length` may be less than the backing array capacity (bankruptcy
 * truncation); consumers MUST use `length`, not `.timestamps.length`.
 */
export interface ColumnarEquityCurve {
  readonly timestamps: Float64Array;
  readonly equities: Float64Array;
  readonly length: number;
}

/** Materialize a columnar curve into the PortfolioEquityPoint[] shape
 *  required by downstream consumers (IPC DTO, persistence, aggregator).
 *  Call this ONCE at the replay-loop boundary — never inside the hot loop. */
export function columnarToEquityPoints(
  col: ColumnarEquityCurve,
): PortfolioEquityPoint[] {
  const result = new Array<PortfolioEquityPoint>(col.length);
  for (let i = 0; i < col.length; i++) {
    result[i] = { timestamp: col.timestamps[i], equity: col.equities[i] };
  }
  return result;
}

/**
 * TICKET_1126 F3: how a book terminated.
 *  - 'completed': the replay walked every bar of the bucket.
 *  - 'bankrupt': equity hit the bankruptcy floor (<= 0); the book was
 *    terminated at that bar and NEVER compounded past zero. Metrics
 *    describe the truncated curve; `bankruptAtTs` pins the terminal bar.
 */
export type BookStatus = 'completed' | 'bankrupt';

/**
 * TICKET_1126 F3: one cross-section entry skipped by the replay input
 * sanity gate (non-finite or insane |r_next|). Carried on the book (capped
 * sample; the full count is `insaneInputSkipCount`) so corrupt input is
 * surfaced, never silently absorbed (TICKET_858).
 */
export interface InsaneInputExample {
  symbol: string;
  barTs: number;
  rNext: number;
}

/** Per-symbol attribution of total portfolio return. */
export interface PerSymbolContribution {
  symbol: string;
  /** Sum over bars of `w_symbol[t] * r_symbol[t]` -- this symbol's additive
   *  contribution to cumulative arithmetic portfolio return. */
  contribution: number;
}

export interface PortfolioMetrics {
  /** Cumulative return of the equity curve: equity[last] / 1 - 1. */
  totalReturn: number;
  /** Mean per-bar portfolio return / stddev of per-bar portfolio return. */
  sharpeRatioPerBar: number;
  /** sharpeRatioPerBar * sqrt(barsPerYear). TICKET_1142: frequency-aware. */
  sharpeRatioAnnualised: number;
  /** Max peak-to-trough drawdown of the equity curve, as a negative fraction. */
  maxDrawdown: number;
  /** Mean per-bar one-sided turnover. */
  averageTurnover: number;
  /** Number of bars (distinct timestamps) that contributed to the curve. */
  nBars: number;
  /** Highest one-sided turnover on any single bar. */
  maxSingleBarTurnover: number;
  /** Number of bars where weights were recomputed (vs held). */
  rebalanceCount: number;
  /** Number of bars where the previous book was held (S3 skip). */
  holdBarCount: number;
  /**
   * TICKET_1140: fraction of UTC calendar days whose compounded per-bar
   * return is positive (positive days / total observed days; 0 when the
   * curve is empty). The portfolio-replay analog of trade-level win rate,
   * which is UNDEFINED for a continuous-weights book (no round-trip trade
   * ledger exists in this engine).
   */
  hitRateDaily: number;
}

/** TICKET_880_3_2 G3: a gross/net pair of curves + metrics. */
export interface PortfolioCostedResult {
  equityCurve: PortfolioEquityPoint[];
  metrics: PortfolioMetrics;
}

/**
 * TICKET_927_4_1: the per-market book produced by `replayPortfolio` for one
 * bucket of a (potentially multi-market) backtest run. `FirmPortfolioAggregator`
 * consumes a `Map<MarketId, PortfolioBookResult>` of these and produces the
 * firm-level view; persistence (TICKET_927_1_4_E) inserts one row per book.
 *
 * Back-compat: `PortfolioBacktestResult` is a re-exported alias so the existing
 * single-market call sites are unchanged.
 */
export interface PortfolioBookResult {
  /** GROSS (cost-free) equity curve. Back-compat: this is the same curve the
   *  pre-TICKET_880_3_2 result exposed at the top level. */
  equityCurve: PortfolioEquityPoint[];
  /** GROSS metrics (cost-free). Back-compat top-level field. */
  metrics: PortfolioMetrics;
  /** TICKET_880_3_2 G3: gross and net (after-cost) curves + metrics. */
  gross: PortfolioCostedResult;
  net: PortfolioCostedResult;
  /** The cost rates actually applied (TICKET_927_1_4_C: per-market). */
  costModelApplied: { feeRate: number; impactRate: number; fundingRate?: number };
  /** TICKET_880_3_5 Phase 2: true when per-stock cost model was active. */
  perStockCostApplied: boolean;
  /** Total cost charged across the run, in cumulative-return fraction units. */
  totalCostCharged: number;
  perSymbolContribution: PerSymbolContribution[];
  /** Echoes the rule actually applied. */
  constructionUsed: ConstructionRule;
  /** Distinct symbols seen across all bars. */
  nSymbols: number;
  /** TICKET_880_3_5: the resolved turnover-control params actually applied. */
  turnoverControlApplied: {
    tradingRate: number;
    maxTurnoverPerBar: number;
    rebalanceEveryN: number;
  };
  /** TICKET_880_3_6: the resolved risk-constraint params actually applied. */
  riskConstraintsApplied: {
    maxWeightPerStock: number;
    maxDrawdown: number;
    drawdownRecoveryBars: number;
  };
  /** TICKET_880_3_6: number of bars where drawdown deleveraging was active. */
  drawdownTriggerCount: number;
  /** TICKET_880_3_7: the resolved vol-target params actually applied, or null. */
  volatilityTargetApplied: {
    targetVol: number;
    lookbackWindow: number;
    maxLeverage: number;
    annFactor: number;
  } | null;
  /** TICKET_880_3_7: per-bar leverage multiplier applied. */
  leverageSeries: number[];
  /** TICKET_880_3_9: the resolved regime-adjustment params actually applied,
   *  or null when no regime adjustment was configured. */
  regimeAdjustmentApplied: {
    allowedRegimes: number[];
    minPosterior: number;
    totalRegimeBars: number;
  } | null;
  /** TICKET_880_3_9: number of bars where regime gating flattened the book. */
  regimeGateCount: number;
  /** TICKET_980: total order intents emitted across the replay (order-level:
   *  each symbol fill = 1 order, matching C++ runner convention). */
  totalOrdersEmitted: number;
  /** TICKET_927_1_4_F: the currency the equity curve is quoted in.
   *  Sourced from the bucket's MarketId -> quoteCcy lookup
   *  (InstrumentRegistry.quoteCurrencyForMarket). */
  readonly quoteCcy: Currency;
  /** TICKET_1126 F3: termination status. 'bankrupt' books stopped at the
   *  bankruptcy floor -- final equity is 0 by construction and metrics
   *  describe the truncated curve. */
  bookStatus: BookStatus;
  /** TICKET_1126 F3: bar timestamp at which the bankruptcy floor fired
   *  (null for 'completed' books). */
  bankruptAtTs: number | null;
  /** TICKET_1126 F3: total cross-section entries skipped by the replay
   *  input sanity gate (per-symbol skip semantics, TICKET_1048). */
  insaneInputSkipCount: number;
  /** TICKET_1126 F3: capped sample of the skipped entries (diagnosis). */
  insaneInputExamples: InsaneInputExample[];
  /** TICKET_1129_2: total per-symbol orders suppressed by the net-alpha
   *  profitability gate across the replay. */
  alphaGateSuppressionCount: number;
  /** TICKET_1129_5: final calibration beta at replay end (null if the
   *  book never left warmup). */
  scoreCalibBeta: number | null;
  /** TICKET_1129_5: bars gated with the raw-score warmup fallback. */
  scoreCalibWarmupBars: number;
  /** TICKET_1129_6: final lag-1 score autocorrelation estimate at replay
   *  end (raw, unclamped; null if no lag pairs were ever folded). */
  scoreCalibPhi: number | null;
  /** TICKET_1129_6: final effective holding-period horizon (bars) the
   *  gate would use -- `(1 - phi^H_turn)/(1 - phi)` with phi clamped to
   *  [0, CALIBRATION_PHI_MAX]. Null when `scoreCalibPhi` is null. */
  scoreCalibHorizonBars: number | null;
  /** TICKET_1132: the initial capital used to scale the equity curve.
   *  When present, equity values are dollar-denominated (start at
   *  initialCapital); when absent, equity is a normalised multiple
   *  (start at 1.0). */
  initialCapital: number | null;
  /** TICKET_1132: dollar P&L = initialCapital * totalReturn. Null when
   *  initialCapital is null (normalised mode). */
  totalPnl: number | null;
}
