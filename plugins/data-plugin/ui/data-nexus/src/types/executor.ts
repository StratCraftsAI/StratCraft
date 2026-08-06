/**
 * TICKET_383: Shared executor result types (Tier 0)
 *
 * Canonical definitions consumed by both back-test-nexus and quant-lab-nexus.
 */

export interface ExecutorMetrics {
  totalPnl: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
  /**
   * TICKET_1140: the four trade-ledger statistics below are defined ONLY
   * when the producing engine has a round-trip trade ledger (C++
   * stratforge-runner). The Alpha Factory portfolio replay rebalances
   * continuous weights per bar -- no ledger exists, so these fields are
   * OMITTED there (never stubbed to 0; a fake `0.00%` is a TICKET_858
   * silent failure). Renderers branch on presence, not on zero.
   */
  winningTrades?: number;
  losingTrades?: number;
  winRate?: number;
  profitFactor?: number;
  /**
   * TICKET_1140: portfolio-replay analog of win rate -- fraction of UTC
   * days whose compounded NET return is positive. Present only for the
   * Alpha Factory portfolio path (percent, 0-100 like winRate).
   */
  hitRateDaily?: number;
}

export interface ExecutorTrade {
  entryTime: number;
  exitTime: number;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  commission: number;
  reason: string;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
  drawdown: number;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * TICKET_783_6 Scope 3: Per-chip Bayesian shrinkage summary surfaced by the
 * Alpha Factory combinator (TICKET_783_3 / 783_5). The runner emits one entry
 * per workflow-entry component plus an overall warmup residual. The field is
 * optional: older backtests, non-workflow backtests, and runner builds without
 * the producer wired up will simply omit it -- consumers must render
 * defensively.
 *
 * Semantics:
 *  - `lambda_stat_final` is the per-signal Bayesian shrinkage weight at the
 *    last bar of the run (0..1). lambda close to 1 means rolling samples are
 *    still too few to outweigh the prior (low statistical confidence); close
 *    to 0 means rolling Sharpe drove the post-shrinkage weight (high
 *    statistical confidence). The renderer surfaces (1 - lambda) as a 0-100%
 *    confidence bar.
 *  - `n_rolling_final` is the count of non-zero rolling samples observed for
 *    that signal by the end of the run -- a separate "how much data did we
 *    actually accumulate" diagnostic next to the shrinkage weight.
 *  - `lambda_warmup_final` is the minimum lambda across all signals at the
 *    last bar, i.e. the residual cold-start the combinator is still paying.
 *    0 means warmup complete; >0 means the run ended before any signal
 *    reached saturation, suggesting an extended backtest window.
 */
export interface ConfidenceSummaryEntry {
  chip_name: string;
  lambda_stat_final: number;
  n_rolling_final: number;
}

export interface ConfidenceSummary {
  lambda_warmup_final: number;
  per_signal: ConfidenceSummaryEntry[];
}

/**
 * TICKET_1225 P5: per-feed bar count entry echoed by the C++ runner.
 * One entry per data feed in the FeedPlan (index 0 = execution feed).
 */
export interface FeedBarCountEntry {
  index: number;
  interval?: string;
  bars: number;
}

export interface ExecutorResult {
  success: boolean;
  errorMessage?: string;
  startTime: number;
  endTime: number;
  executionTimeMs: number;
  metrics: ExecutorMetrics;
  equityCurve: EquityPoint[];
  trades: ExecutorTrade[];
  candles: Candle[];
  /**
   * TICKET_783_6 Scope 3: optional Bayesian shrinkage summary; see
   * {@link ConfidenceSummary}. Older runner builds / non-workflow runs
   * omit this field, which renders as a hidden confidence panel.
   */
  confidence_summary?: ConfidenceSummary;
  /**
   * TICKET_1225 P5: epoch-ms timestamp of the first next() bar (when all
   * feeds satisfied their warmup). Zero / absent for older runner builds.
   */
  warmupEndTimestamp?: number;
  /**
   * TICKET_1225 P5: per-feed bar counts from the engine run. Absent for
   * older runner builds. Index 0 is always the execution (master) feed.
   */
  feedBarCounts?: FeedBarCountEntry[];
}
