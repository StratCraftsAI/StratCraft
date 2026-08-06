/**
 * BacktestRunService
 *
 * TICKET_927_1_4_E: Per-market backtest run persistence.
 *
 * Transactional write of `nona_backtest_run` (run-level) +
 * `nona_backtest_book` (one row per MarketId bucket). Atomic: either
 * every book row commits or the run row rolls back.
 *
 * Equity curve blob format: packed Float64Array of [ts, gross, net]
 * triples (24 bytes per bar). Read back via `decodeEquityCurveBlob`.
 */

import { DatabaseManager } from '../db-manager';
import type {
  ChainEntrySummary,
  PortfolioBookResult,
  PortfolioEquityPoint,
} from '@StratCraft/types';
import {
  deleteBacktestRun,
  getBacktestRun,
  type SqliteDatabase,
} from '@StratCraft/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BacktestRunInsert {
  userId: string;
  runLabel?: string;
  signalIds: number[];
  fusionMethod: string;
  startMs: number;
  endMs: number;
  dataSnapshotId: string;
  firmSharpe: number;
  firmMaxDrawdown: number;
  firmFinalEquity: number;
  firmBaseCcy: string;
  requestJson: string;
  notes?: string;
  /**
   * TICKET_1287 P2: chain identity for per-signal chained backtest mode.
   * Both fields are absent for fused runs (persisted NULL); a chain entry
   * carries the launch-wide `chainId` (uuid) and its 0-based `chainPosition`.
   */
  chainId?: string;
  chainPosition?: number;
}

export interface BacktestBookInsert {
  marketId: string;
  executionInterval: string;
  book: PortfolioBookResult;
  signalCount: number;
  fusionWeightsJson?: string;
  excludedSignalsJson?: string;
  warningsJson?: string;
}

export interface BacktestRunRow {
  id: number;
  created_at: number;
  user_id: string;
  run_label: string | null;
  signal_ids: string;
  fusion_method: string;
  start_ms: number;
  end_ms: number;
  data_snapshot_id: string;
  firm_sharpe: number | null;
  firm_max_drawdown: number | null;
  firm_final_equity: number | null;
  firm_base_ccy: string;
  request_json: string;
  notes: string | null;
  /** TICKET_1287 P2: NULL for fused runs; set for per-signal chain entries. */
  chain_id: string | null;
  chain_position: number | null;
}

export interface BacktestBookRow {
  id: number;
  run_id: number;
  market_id: string;
  execution_interval: string;
  symbol_count: number;
  signal_count: number;
  gross_sharpe: number | null;
  net_sharpe: number | null;
  gross_max_drawdown: number | null;
  net_max_drawdown: number | null;
  final_equity: number | null;
  turnover_avg: number | null;
  total_cost_charged: number | null;
  bars_count: number | null;
  regime_signal_id: number | null;
  regime_gate_count: number | null;
  cost_json: string | null;
  risk_json: string | null;
  vol_target_json: string | null;
  turnover_control_json: string | null;
  equity_curve_blob: Buffer | null;
  fusion_weights_json: string | null;
  excluded_signals_json: string | null;
  warnings_json: string | null;
  /**
   * TICKET_1287 P4b: columns needed to reconstruct the live-result render shape
   * from persistence (`buildRunResult`). Written by `saveRun` (migration v113 /
   * v87) but omitted from the interface until a read-side consumer required
   * them. `SELECT *` already returns them at runtime.
   */
  gross_hit_rate_daily: number | null;
  net_hit_rate_daily: number | null;
  total_orders_emitted: number | null;
  per_symbol_contrib_json: string | null;
  quote_ccy: string | null;
  construction_rule: string | null;
}

export interface BacktestRunSignalInsert {
  signalId: number;
  signalName?: string;
  signalSource?: string;
  templateId?: string;
  barInterval: string;
  nature: string;
  ic?: number | null;
  trainingIc?: number | null;
  decaySlope?: number | null;
  rosterState: 'active' | 'bench';
  stateWeight: number;
  fusionWeight?: number | null;
  excluded: boolean;
  exclusionReason?: string | null;
  pairCount?: number | null;
  symbolCount?: number | null;
  evalTimeMs?: number | null;
  lastObservationAt?: number | null;
  nativeIntervalMs?: number | null;
  timeframeMismatch?: boolean;
  /** TICKET_1165_1: window-level hypothesis (scalar broadcast, zero variance). */
  windowLevelHypothesis?: boolean;
}

export interface BacktestRunCombinatorInsert {
  method: string;
  diagnosticsJson?: string | null;
  totalSignalsInput: number;
  totalSignalsFused: number;
  decaySensitivity?: number | null;
  kellyFraction?: number | null;
  constructionRule: string;
  warningsJson?: string | null;
}

export interface BacktestRunSignalRow {
  id: number;
  run_id: number;
  signal_id: number;
  signal_name: string | null;
  signal_source: string | null;
  template_id: string | null;
  bar_interval: string;
  nature: string;
  ic: number | null;
  training_ic: number | null;
  decay_slope: number | null;
  roster_state: string;
  state_weight: number;
  fusion_weight: number | null;
  excluded: number;
  exclusion_reason: string | null;
  pair_count: number | null;
  symbol_count: number | null;
  eval_time_ms: number | null;
  last_observation_at: number | null;
  native_interval_ms: number | null;
}

export interface BacktestRunCombinatorRow {
  id: number;
  run_id: number;
  method: string;
  diagnostics_json: string | null;
  total_signals_input: number;
  total_signals_fused: number;
  decay_sensitivity: number | null;
  kelly_fraction: number | null;
  construction_rule: string;
  warnings_json: string | null;
}

export interface BacktestRunWithBooks extends BacktestRunRow {
  books: BacktestBookRow[];
  signals: BacktestRunSignalRow[];
  combinator: BacktestRunCombinatorRow | null;
}

export interface EquityCurveTriple {
  timestamp: number;
  gross: number;
  net: number;
}

/**
 * TICKET_1287 P4b: renderer-ready reconstruction of a persisted backtest run.
 *
 * D7/AC7 requires a chain comparison-table row click to render that entry's
 * full existing result view (equity curve etc.). The renderer's ResultSection
 * consumes the same fields the LIVE `runUniverse` response produces
 * (`useAlphaFactoryBacktest` finalResult assembly). A chain entry is a
 * single-signal, single-book run, so this reconstruction is LOSSLESS for every
 * field ResultSection reads: gross/net curves decode from the equity blob,
 * gross/net totalReturn derive from the curves (`equity[last] - 1`, the
 * `PortfolioMetrics.totalReturn` contract), Sharpe/mdd/hitRate/cost/perSymbol
 * are all persisted per book. Units are FRACTIONS here (matching the replay
 * engine); the renderer applies the same FRACTION_TO_PERCENT scaling the live
 * path applies at its adapter boundary. Decode stays on the owning layer (main)
 * -- the plugin tier cannot import the main-process blob codec.
 */
export interface PersistedRunResult {
  runId: number;
  createdAt: number;
  signalIds: number[];
  signalNames: string[];
  fusionMethod: string;
  startMs: number;
  endMs: number;
  initialCapital: number | null;
  chainId: string | null;
  chainPosition: number | null;
  grossCurve: Array<{ timestamp: number; equity: number }>;
  netCurve: Array<{ timestamp: number; equity: number }>;
  metrics: {
    /** GROSS cumulative return as a FRACTION (2.0 = +200%). */
    grossTotalReturn: number;
    /** NET cumulative return as a FRACTION. */
    netTotalReturn: number;
    grossSharpeAnnualised: number;
    grossMaxDrawdown: number;
    netHitRateDaily: number;
    totalOrdersEmitted: number;
  };
  cost: {
    totalCostCharged: number;
    feeRate: number;
    impactRate: number;
    perStockCostApplied: boolean;
  };
  perSymbolContribution: Array<{ symbol: string; contribution: number }>;
  nSymbols: number;
}

/**
 * TICKET_1287 F1a/F1b: one durable row of `nona_backtest_chain_entry` -- the
 * outcome of a single attempted per-signal chain entry. This is the SUPERSET of
 * the transient `ChainEntrySummary` the executor returns in-memory: it also
 * carries the chain identity (`chainId` + `chainPosition`) and the `createdAt`
 * launch timestamp, so a completed/failed/skipped outcome survives an app
 * restart (the §9 F1 gap this ticket closes). `runId` is set only for
 * `completed` entries (FK to the real `nona_backtest_run` row); `error` carries
 * the verbatim failure message for `failed`/`skipped` entries (TICKET_858). The
 * six metric snapshot columns are denormalised from the completed run so the
 * history list / comparison table renders from one cheap query without
 * re-opening the run blob.
 */
export interface ChainEntryInsert {
  chainId: string;
  chainPosition: number;
  signalId: number;
  signalName: string;
  status: 'completed' | 'failed' | 'skipped';
  runId?: number | null;
  error?: string | null;
  netSharpe?: number | null;
  grossSharpe?: number | null;
  maxDrawdown?: number | null;
  finalEquity?: number | null;
  tradeCount?: number | null;
  /** Injected clock (handler-supplied via ctx) -- never a bare Date.now() in
   *  the service, per the no-`Date.now()` discipline. */
  createdAt: number;
}

/**
 * TICKET_1287 F1b: raw `nona_backtest_chain_entry` row shape (snake_case columns
 * as SQLite returns them). Mapped to `ChainEntrySummary` by
 * `getChainEntryOutcomes`.
 */
export interface ChainEntryRow {
  chain_id: string;
  chain_position: number;
  signal_id: number;
  signal_name: string;
  status: string;
  run_id: number | null;
  error: string | null;
  net_sharpe: number | null;
  gross_sharpe: number | null;
  max_drawdown: number | null;
  final_equity: number | null;
  trade_count: number | null;
  created_at: number;
}

/**
 * TICKET_1287 F1b: one aggregated row per `chain_id` for the chain-history list
 * (F2). Derived by GROUP BY over `nona_backtest_chain_entry`; feeds the "Past
 * chains" entry point. `launchedAt` is MIN(created_at) across the chain's
 * entries (the chain launch time); counts partition the entries by status.
 */
export interface ChainSummaryRow {
  chainId: string;
  launchedAt: number;
  totalEntries: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
}

// ---------------------------------------------------------------------------
// Blob codec
// ---------------------------------------------------------------------------

const BYTES_PER_TRIPLE = 3 * 8; // 3 Float64 = 24 bytes

export function encodeEquityCurveBlob(
  grossCurve: ReadonlyArray<PortfolioEquityPoint>,
  netCurve: ReadonlyArray<PortfolioEquityPoint>,
): Buffer {
  const len = grossCurve.length;
  const buf = Buffer.alloc(len * BYTES_PER_TRIPLE);
  for (let i = 0; i < len; i++) {
    const offset = i * BYTES_PER_TRIPLE;
    buf.writeDoubleBE(grossCurve[i].timestamp, offset);
    buf.writeDoubleBE(grossCurve[i].equity, offset + 8);
    buf.writeDoubleBE(i < netCurve.length ? netCurve[i].equity : grossCurve[i].equity, offset + 16);
  }
  return buf;
}

export function decodeEquityCurveBlob(blob: Buffer): EquityCurveTriple[] {
  const count = blob.length / BYTES_PER_TRIPLE;
  const result: EquityCurveTriple[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const offset = i * BYTES_PER_TRIPLE;
    result[i] = {
      timestamp: blob.readDoubleBE(offset),
      gross: blob.readDoubleBE(offset + 8),
      net: blob.readDoubleBE(offset + 16),
    };
  }
  return result;
}

const BYTES_PER_DOUBLE = 8;

export function encodeLeverageSeriesBlob(series: readonly number[]): Buffer {
  const buf = Buffer.alloc(series.length * BYTES_PER_DOUBLE);
  for (let i = 0; i < series.length; i++) {
    buf.writeDoubleBE(series[i], i * BYTES_PER_DOUBLE);
  }
  return buf;
}

export function decodeLeverageSeriesBlob(blob: Buffer): number[] {
  const count = blob.length / BYTES_PER_DOUBLE;
  const result: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    result[i] = blob.readDoubleBE(i * BYTES_PER_DOUBLE);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class BacktestRunService {
  constructor(private db: DatabaseManager) {}

  saveRun(
    run: BacktestRunInsert,
    books: BacktestBookInsert[],
    signals?: BacktestRunSignalInsert[],
    combinator?: BacktestRunCombinatorInsert,
  ): number {
    if (books.length === 0) {
      throw new Error(
        'TICKET_927_1_4_E: saveRun refuses an empty books array. ' +
        'A run with zero market buckets is a handler bug.',
      );
    }

    const runId = this.db.transaction(() => {
      const createdAt = Date.now();

      const runStmt = this.db.prepare(`
        INSERT INTO nona_backtest_run (
          created_at, user_id, run_label, signal_ids, fusion_method,
          start_ms, end_ms, data_snapshot_id,
          firm_sharpe, firm_max_drawdown, firm_final_equity,
          firm_base_ccy, request_json, notes, sharpe_ann_basis,
          chain_id, chain_position
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = runStmt.run(
        createdAt,
        run.userId,
        run.runLabel ?? null,
        JSON.stringify(run.signalIds),
        run.fusionMethod,
        run.startMs,
        run.endMs,
        run.dataSnapshotId,
        run.firmSharpe,
        run.firmMaxDrawdown,
        run.firmFinalEquity,
        run.firmBaseCcy,
        run.requestJson,
        run.notes ?? null,
        'bars_per_year',
        // TICKET_1287 P2: NULL for fused runs (AC4 byte-compatibility).
        run.chainId ?? null,
        run.chainPosition ?? null,
      );

      const insertedRunId = Number(result.lastInsertRowid);

      const bookStmt = this.db.prepare(`
        INSERT INTO nona_backtest_book (
          run_id, market_id, execution_interval,
          symbol_count, signal_count,
          gross_sharpe, net_sharpe,
          gross_hit_rate_daily, net_hit_rate_daily,
          gross_max_drawdown, net_max_drawdown,
          final_equity, turnover_avg, total_cost_charged, bars_count,
          regime_signal_id, regime_gate_count,
          cost_json, risk_json, vol_target_json, turnover_control_json,
          equity_curve_blob,
          fusion_weights_json, excluded_signals_json, warnings_json,
          construction_rule, total_orders_emitted, drawdown_trigger_count,
          hold_bar_count, rebalance_count, max_single_bar_turnover,
          per_symbol_contrib_json, leverage_series_blob, quote_ccy,
          book_status, bankrupt_at_ts, insane_input_skip_count,
          sharpe_ann_basis
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const b of books) {
        const bk = b.book;
        const equityBlob = encodeEquityCurveBlob(
          bk.gross.equityCurve,
          bk.net.equityCurve,
        );
        const leverageBlob = encodeLeverageSeriesBlob(bk.leverageSeries);

        bookStmt.run(
          insertedRunId,
          b.marketId,
          b.executionInterval,
          bk.nSymbols,
          b.signalCount,
          bk.gross.metrics.sharpeRatioAnnualised,
          bk.net.metrics.sharpeRatioAnnualised,
          // TICKET_1140: daily hit rate per book; pre-113 rows stay NULL.
          bk.gross.metrics.hitRateDaily,
          bk.net.metrics.hitRateDaily,
          bk.gross.metrics.maxDrawdown,
          bk.net.metrics.maxDrawdown,
          bk.net.metrics.totalReturn,
          bk.net.metrics.averageTurnover,
          bk.totalCostCharged,
          bk.gross.metrics.nBars,
          bk.regimeAdjustmentApplied
            ? (bk.regimeAdjustmentApplied as unknown as { regimeSignalId?: number }).regimeSignalId ?? null
            : null,
          bk.regimeGateCount > 0 ? bk.regimeGateCount : null,
          JSON.stringify(bk.costModelApplied),
          JSON.stringify(bk.riskConstraintsApplied),
          bk.volatilityTargetApplied ? JSON.stringify(bk.volatilityTargetApplied) : null,
          JSON.stringify(bk.turnoverControlApplied),
          equityBlob,
          b.fusionWeightsJson ?? null,
          b.excludedSignalsJson ?? null,
          b.warningsJson ?? null,
          bk.constructionUsed,
          bk.totalOrdersEmitted,
          bk.drawdownTriggerCount,
          bk.gross.metrics.holdBarCount,
          bk.gross.metrics.rebalanceCount,
          bk.gross.metrics.maxSingleBarTurnover,
          bk.perSymbolContribution.length > 0
            ? JSON.stringify(bk.perSymbolContribution)
            : null,
          leverageBlob.length > 0 ? leverageBlob : null,
          bk.quoteCcy,
          // TICKET_1126 F3: explicit termination + input-sanity transparency.
          bk.bookStatus,
          bk.bankruptAtTs,
          bk.insaneInputSkipCount,
          'bars_per_year',
        );
      }

      // TICKET_1014: persist per-signal evaluation metadata.
      if (signals && signals.length > 0) {
        const signalStmt = this.db.prepare(`
          INSERT INTO nona_backtest_run_signal (
            run_id, signal_id, signal_name, signal_source, template_id,
            bar_interval, nature, ic, training_ic, decay_slope,
            roster_state, state_weight, fusion_weight,
            excluded, exclusion_reason,
            pair_count, symbol_count, eval_time_ms,
            last_observation_at, native_interval_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const s of signals) {
          signalStmt.run(
            insertedRunId,
            s.signalId,
            s.signalName ?? null,
            s.signalSource ?? null,
            s.templateId ?? null,
            s.barInterval,
            s.nature,
            s.ic ?? null,
            s.trainingIc ?? null,
            s.decaySlope ?? null,
            s.rosterState,
            s.stateWeight,
            s.fusionWeight ?? null,
            s.excluded ? 1 : 0,
            s.exclusionReason ?? null,
            s.pairCount ?? null,
            s.symbolCount ?? null,
            s.evalTimeMs ?? null,
            s.lastObservationAt ?? null,
            s.nativeIntervalMs ?? null,
          );
        }
      }

      // TICKET_1014: persist combinator diagnostics.
      if (combinator) {
        const combStmt = this.db.prepare(`
          INSERT INTO nona_backtest_run_combinator (
            run_id, method, diagnostics_json,
            total_signals_input, total_signals_fused,
            decay_sensitivity, kelly_fraction,
            construction_rule, warnings_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        combStmt.run(
          insertedRunId,
          combinator.method,
          combinator.diagnosticsJson ?? null,
          combinator.totalSignalsInput,
          combinator.totalSignalsFused,
          combinator.decaySensitivity ?? null,
          combinator.kellyFraction ?? null,
          combinator.constructionRule,
          combinator.warningsJson ?? null,
        );
      }

      return insertedRunId;
    })();

    return runId;
  }

  /**
   * TICKET_1126 F4: mark a persisted run invalid (or restore it). Used by
   * the data-repair tooling when a run's window is found to overlap
   * corrupt L1 bars -- the run row stays (audit trail) but is flagged so
   * its metrics are never mistaken for real results.
   */
  updateRunStatus(
    runId: number,
    status: 'valid' | 'invalid',
    invalidReason?: string,
  ): void {
    const result = this.db.prepare(`
      UPDATE nona_backtest_run
      SET status = ?, invalid_reason = ?
      WHERE id = ?
    `).run(status, status === 'invalid' ? invalidReason ?? null : null, runId);
    if (result.changes === 0) {
      throw new Error(
        `TICKET_1126: updateRunStatus found no nona_backtest_run row with id ${runId}`,
      );
    }
  }

  getRunsByUser(userId: string, limit: number = 50): BacktestRunWithBooks[] {
    const runs = this.db.prepare(`
      SELECT * FROM nona_backtest_run
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit) as BacktestRunRow[];

    if (runs.length === 0) return [];

    const bookStmt = this.db.prepare(
      'SELECT * FROM nona_backtest_book WHERE run_id = ?',
    );
    const signalStmt = this.db.prepare(
      'SELECT * FROM nona_backtest_run_signal WHERE run_id = ?',
    );
    const combStmt = this.db.prepare(
      'SELECT * FROM nona_backtest_run_combinator WHERE run_id = ?',
    );

    return runs.map(run => ({
      ...run,
      books: bookStmt.all(run.id) as BacktestBookRow[],
      signals: signalStmt.all(run.id) as BacktestRunSignalRow[],
      combinator: (combStmt.get(run.id) as BacktestRunCombinatorRow | undefined) ?? null,
    }));
  }

  getRunById(runId: number): BacktestRunWithBooks | null {
    try {
      return getBacktestRun(
        this.db as unknown as SqliteDatabase,
        runId,
      ) as BacktestRunWithBooks;
    } catch (error) {
      if (error instanceof Error && error.message === `Backtest run ${runId} not found`) {
        return null;
      }
      throw error;
    }
  }

  /**
   * TICKET_1287 P4b: reconstruct the renderer-ready result DTO for a persisted
   * run (D7/AC7 -- chain comparison-table row click renders the run's full
   * existing result view). Decodes the equity blob and maps the persisted book
   * into the exact shape the live `runUniverse` response feeds ResultSection,
   * so no new result renderer is introduced. Returns null when the run does not
   * exist; throws (fail-fast, TICKET_857) when the run row exists but carries no
   * book / equity curve -- a corrupt run must surface a real error to the UI
   * (TICKET_858), never a blank view.
   */
  buildRunResult(runId: number): PersistedRunResult | null {
    const run = this.db.prepare(
      'SELECT * FROM nona_backtest_run WHERE id = ?',
    ).get(runId) as BacktestRunRow | undefined;
    if (!run) return null;

    const books = this.db.prepare(
      'SELECT * FROM nona_backtest_book WHERE run_id = ? ORDER BY id ASC',
    ).all(runId) as BacktestBookRow[];
    if (books.length === 0) {
      throw new Error(
        `TICKET_1287: backtest run ${runId} has no persisted market book -- ` +
        'the result cannot be reconstructed. The run row is corrupt or was ' +
        'saved before the book write completed.',
      );
    }

    const signals = this.db.prepare(
      'SELECT * FROM nona_backtest_run_signal WHERE run_id = ?',
    ).all(runId) as BacktestRunSignalRow[];

    // A chain entry is a single-signal, single-book run. Multi-book (multi-
    // market) runs also reach this path; the equity blobs are per book and are
    // NOT firm-aggregated here, so reconstruct only the first book's curves --
    // matching the current single-book contract (chain entries always have
    // exactly one book). Fail-fast if a multi-book run is requested so a
    // partial view is never shown silently.
    if (books.length > 1) {
      throw new Error(
        `TICKET_1287: backtest run ${runId} has ${books.length} market books; ` +
        'per-run result reconstruction currently supports single-book runs ' +
        '(per-signal chain entries). Multi-book firm aggregation is out of scope.',
      );
    }
    const book = books[0];

    if (!book.equity_curve_blob || book.equity_curve_blob.length === 0) {
      throw new Error(
        `TICKET_1287: backtest run ${runId} book has an empty equity curve blob.`,
      );
    }
    const triples = decodeEquityCurveBlob(book.equity_curve_blob);
    const grossCurve = triples.map(t => ({ timestamp: t.timestamp, equity: t.gross }));
    const netCurve = triples.map(t => ({ timestamp: t.timestamp, equity: t.net }));

    // PortfolioMetrics.totalReturn contract: equity[last] - 1 (curve starts at
    // 1.0). Derived from the decoded curves -- lossless, no separate column.
    const lastGross = grossCurve.length > 0 ? grossCurve[grossCurve.length - 1].equity : 1;
    const lastNet = netCurve.length > 0 ? netCurve[netCurve.length - 1].equity : 1;
    const grossTotalReturn = lastGross - 1;
    const netTotalReturn = lastNet - 1;

    let feeRate = 0;
    let impactRate = 0;
    let perStockCostApplied = false;
    if (book.cost_json) {
      try {
        const cost = JSON.parse(book.cost_json) as {
          feeRate?: number; impactRate?: number; perStockCostApplied?: boolean;
        };
        feeRate = cost.feeRate ?? 0;
        impactRate = cost.impactRate ?? 0;
        perStockCostApplied = cost.perStockCostApplied ?? false;
      } catch {
        // Malformed cost_json -> rates default to 0. Non-fatal: the curves and
        // the totalCostCharged column still render the drag.
      }
    }

    let perSymbolContribution: Array<{ symbol: string; contribution: number }> = [];
    if (book.per_symbol_contrib_json) {
      try {
        perSymbolContribution = JSON.parse(book.per_symbol_contrib_json) as Array<{
          symbol: string; contribution: number;
        }>;
      } catch {
        perSymbolContribution = [];
      }
    }

    let initialCapital: number | null = null;
    if (run.request_json) {
      try {
        const req = JSON.parse(run.request_json) as { initialCapital?: number };
        initialCapital = typeof req.initialCapital === 'number' ? req.initialCapital : null;
      } catch {
        initialCapital = null;
      }
    }

    let signalIds: number[] = [];
    try {
      signalIds = JSON.parse(run.signal_ids) as number[];
    } catch {
      signalIds = [];
    }
    const signalNames = signals
      .map(s => s.signal_name)
      .filter((n): n is string => n !== null && n.length > 0);

    return {
      runId: run.id,
      createdAt: run.created_at,
      signalIds,
      signalNames,
      fusionMethod: run.fusion_method,
      startMs: run.start_ms,
      endMs: run.end_ms,
      initialCapital,
      chainId: run.chain_id,
      chainPosition: run.chain_position,
      grossCurve,
      netCurve,
      metrics: {
        grossTotalReturn,
        netTotalReturn,
        grossSharpeAnnualised: book.gross_sharpe ?? 0,
        grossMaxDrawdown: book.gross_max_drawdown ?? 0,
        netHitRateDaily: book.net_hit_rate_daily ?? 0,
        totalOrdersEmitted: book.total_orders_emitted ?? 0,
      },
      cost: {
        totalCostCharged: book.total_cost_charged ?? 0,
        feeRate,
        impactRate,
        perStockCostApplied,
      },
      perSymbolContribution,
      nSymbols: book.symbol_count,
    };
  }

  /**
   * TICKET_1287 P2: fetch every run row belonging to one per-signal chain,
   * ordered by `chain_position` (0-based entry index). Each entry IS a
   * first-class `nona_backtest_run` row (design D5), so the rows are returned
   * hydrated with books/signals/combinator -- identical shape to
   * `getRunsByUser` -- feeding the derived chain summary (per-signal
   * Sharpe/mdd/final-equity comparison) without a parallel result store. Fused
   * runs (chain_id NULL) are never returned.
   *
   * TICKET_1287 F1b: this returns ONLY the completed entries (the ones that
   * produced a real run row). F2 renders the comparison / history table from
   * `getChainEntryOutcomes()` (which also includes failed/skipped entries with
   * their verbatim error text); `getChainEntries()` is retained for FULL run
   * hydration (books/signals/combinator) where a completed entry's whole run is
   * needed, not just the metric snapshot.
   */
  getChainEntries(chainId: string): BacktestRunWithBooks[] {
    const runs = this.db.prepare(`
      SELECT * FROM nona_backtest_run
      WHERE chain_id = ?
      ORDER BY chain_position ASC
    `).all(chainId) as BacktestRunRow[];

    if (runs.length === 0) return [];

    const bookStmt = this.db.prepare(
      'SELECT * FROM nona_backtest_book WHERE run_id = ?',
    );
    const signalStmt = this.db.prepare(
      'SELECT * FROM nona_backtest_run_signal WHERE run_id = ?',
    );
    const combStmt = this.db.prepare(
      'SELECT * FROM nona_backtest_run_combinator WHERE run_id = ?',
    );

    return runs.map(run => ({
      ...run,
      books: bookStmt.all(run.id) as BacktestBookRow[],
      signals: signalStmt.all(run.id) as BacktestRunSignalRow[],
      combinator: (combStmt.get(run.id) as BacktestRunCombinatorRow | undefined) ?? null,
    }));
  }

  /**
   * TICKET_1287 F1b: durably persist one per-signal chain-entry outcome.
   *
   * A single-row INSERT into `nona_backtest_chain_entry`. The write is wrapped
   * in a transaction so that when the caller invokes it for a `completed` entry
   * immediately after `saveRun()` returns the run id -- in the same synchronous
   * path, with no intervening await -- the completed run row and its chain-entry
   * row commit as an atomic pair: there is never a window where a completed run
   * exists on disk but its chain-entry row is missing (§9 F1). Failed/skipped
   * entries have no run row (run_id NULL) and carry the verbatim error text
   * (TICKET_858). Called INCREMENTALLY by the chain executor -- one write per
   * attempted entry, as the chain runs -- so a crash mid-chain leaves every
   * prior outcome on disk.
   *
   * The (chain_id, chain_position) primary key makes the write idempotent-safe:
   * a duplicate insert for the same position is a hard error (fail-fast,
   * TICKET_857) rather than a silent overwrite -- a re-persisted position would
   * indicate a chain-executor bug.
   */
  saveChainEntry(entry: ChainEntryInsert): void {
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO nona_backtest_chain_entry (
          chain_id, chain_position, signal_id, signal_name, status,
          run_id, error,
          net_sharpe, gross_sharpe, max_drawdown, final_equity, trade_count,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.chainId,
        entry.chainPosition,
        entry.signalId,
        entry.signalName,
        entry.status,
        entry.runId ?? null,
        entry.error ?? null,
        entry.netSharpe ?? null,
        entry.grossSharpe ?? null,
        entry.maxDrawdown ?? null,
        entry.finalEquity ?? null,
        entry.tradeCount ?? null,
        entry.createdAt,
      );
    })();
  }

  /**
   * TICKET_1287 F1b: read every entry of one chain, ordered by `chain_position`
   * ascending, mapped to the transient `ChainEntrySummary` shape the executor
   * returns in-memory. This is the DURABLE equivalent of that transient array --
   * it survives an app restart and includes non-completed entries (failed /
   * skipped) with their verbatim error, which `getChainEntries()` (run rows
   * only) cannot. Returns [] for an unknown chain id (not an error) so the UI
   * renders an empty table, not a failure banner.
   */
  getChainEntryOutcomes(chainId: string): ChainEntrySummary[] {
    const rows = this.db.prepare(`
      SELECT * FROM nona_backtest_chain_entry
      WHERE chain_id = ?
      ORDER BY chain_position ASC
    `).all(chainId) as ChainEntryRow[];

    return rows.map((r) => {
      const summary: ChainEntrySummary = {
        signalId: r.signal_id,
        signalName: r.signal_name,
        status: r.status as ChainEntrySummary['status'],
      };
      if (r.run_id !== null) summary.runId = r.run_id;
      if (r.error !== null) summary.error = r.error;
      if (r.net_sharpe !== null) summary.netSharpe = r.net_sharpe;
      if (r.gross_sharpe !== null) summary.grossSharpe = r.gross_sharpe;
      if (r.max_drawdown !== null) summary.maxDrawdown = r.max_drawdown;
      if (r.final_equity !== null) summary.finalEquity = r.final_equity;
      if (r.trade_count !== null) summary.tradeCount = r.trade_count;
      return summary;
    });
  }

  /**
   * TICKET_1287 F1b: one aggregated row per `chain_id` for the history entry
   * point (F2). Groups `nona_backtest_chain_entry` by chain, deriving the launch
   * time (MIN(created_at)) and the per-status counts, ordered newest-launch
   * first, limited. Feeds the "Past chains" list so historical chains are
   * reachable across sessions.
   */
  listChains(limit: number): ChainSummaryRow[] {
    const rows = this.db.prepare(`
      SELECT
        chain_id                                          AS chainId,
        MIN(created_at)                                   AS launchedAt,
        COUNT(*)                                          AS totalEntries,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedCount,
        SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failedCount,
        SUM(CASE WHEN status = 'skipped'   THEN 1 ELSE 0 END) AS skippedCount
      FROM nona_backtest_chain_entry
      GROUP BY chain_id
      ORDER BY launchedAt DESC
      LIMIT ?
    `).all(limit) as Array<{
      chainId: string;
      launchedAt: number;
      totalEntries: number;
      completedCount: number;
      failedCount: number;
      skippedCount: number;
    }>;

    return rows.map((r) => ({
      chainId: r.chainId,
      launchedAt: r.launchedAt,
      totalEntries: r.totalEntries,
      completedCount: r.completedCount,
      failedCount: r.failedCount,
      skippedCount: r.skippedCount,
    }));
  }

  getRunSignals(runId: number): BacktestRunSignalRow[] {
    return this.db.prepare(
      'SELECT * FROM nona_backtest_run_signal WHERE run_id = ?',
    ).all(runId) as BacktestRunSignalRow[];
  }

  getRunCombinator(runId: number): BacktestRunCombinatorRow | null {
    return (this.db.prepare(
      'SELECT * FROM nona_backtest_run_combinator WHERE run_id = ?',
    ).get(runId) as BacktestRunCombinatorRow | undefined) ?? null;
  }

  deleteRun(runId: number): void {
    deleteBacktestRun(this.db as unknown as SqliteDatabase, runId);
  }
}
