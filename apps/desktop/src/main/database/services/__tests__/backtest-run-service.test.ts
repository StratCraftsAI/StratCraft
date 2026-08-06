/**
 * BacktestRunService Unit Tests
 *
 * TICKET_927_1_4_E: Per-market backtest run persistence.
 * TICKET_1014: Quant Factory Run Result Persistence (signals, combinator, extended book).
 *
 * Tests transactional write, blob codec round-trip, read paths,
 * cascade delete, signal/combinator persistence, and fail-fast on empty books.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  dbLog: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  BacktestRunService,
  encodeEquityCurveBlob,
  decodeEquityCurveBlob,
  encodeLeverageSeriesBlob,
  decodeLeverageSeriesBlob,
  type BacktestRunInsert,
  type BacktestBookInsert,
  type BacktestRunSignalInsert,
  type BacktestRunCombinatorInsert,
} from '../backtest-run-service';
import type { DatabaseManager } from '../../db-manager';
import type { PortfolioBookResult, PortfolioEquityPoint } from '@StratCraft/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDb() {
  const stmtMock = {
    run: vi.fn().mockReturnValue({ lastInsertRowid: 42 }),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  };
  const db = {
    prepare: vi.fn().mockReturnValue(stmtMock),
    transaction: vi.fn((fn: () => unknown) => fn),
  } as unknown as DatabaseManager;
  return { db, stmtMock };
}

function makeEquityCurve(n: number): PortfolioEquityPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: 1700000000 + i * 60000,
    equity: 1 + i * 0.001,
  }));
}

function makeBook(overrides?: Partial<PortfolioBookResult>): PortfolioBookResult {
  const curve = makeEquityCurve(5);
  const metrics = {
    totalReturn: 0.05,
    sharpeRatioPerBar: 0.1,
    sharpeRatioAnnualised: 1.59,
    maxDrawdown: -0.02,
    averageTurnover: 0.1,
    nBars: 5,
    maxSingleBarTurnover: 0.2,
    rebalanceCount: 5,
    holdBarCount: 0,
    hitRateDaily: 0.6,
  };
  return {
    equityCurve: curve,
    metrics,
    gross: { equityCurve: curve, metrics },
    net: { equityCurve: curve, metrics },
    costModelApplied: { feeRate: 0.001, impactRate: 0.0005 },
    totalCostCharged: 0.003,
    perSymbolContribution: [{ symbol: 'AAPL', contribution: 0.05 }],
    constructionUsed: 'rank_long_short',
    nSymbols: 10,
    turnoverControlApplied: {
      tradingRate: 1,
      maxTurnoverPerBar: 1,
      rebalanceEveryN: 1,
    },
    riskConstraintsApplied: {
      maxWeightPerStock: 0.1,
      maxDrawdown: -0.2,
      drawdownRecoveryBars: 5,
    },
    drawdownTriggerCount: 0,
    volatilityTargetApplied: null,
    leverageSeries: [1, 1, 1, 1, 1],
    regimeAdjustmentApplied: null,
    regimeGateCount: 0,
    bookStatus: 'completed',
    bankruptAtTs: null,
    insaneInputSkipCount: 0,
    insaneInputExamples: [],
    alphaGateSuppressionCount: 0,
    ...overrides,
  } as PortfolioBookResult;
}

function makeRunInsert(overrides?: Partial<BacktestRunInsert>): BacktestRunInsert {
  return {
    userId: 'user-1',
    signalIds: [1, 2],
    fusionMethod: 'equal_weight',
    startMs: 1700000000000,
    endMs: 1700100000000,
    dataSnapshotId: 'snap-abc',
    firmSharpe: 1.5,
    firmMaxDrawdown: -0.03,
    firmFinalEquity: 1.05,
    firmBaseCcy: 'USD',
    requestJson: '{"universeId":"sp500"}',
    ...overrides,
  };
}

function makeBookInsert(overrides?: Partial<BacktestBookInsert>): BacktestBookInsert {
  return {
    marketId: 'alpaca_us_equity',
    executionInterval: '1d',
    book: makeBook(),
    signalCount: 2,
    ...overrides,
  };
}

function makeSignalInsert(overrides?: Partial<BacktestRunSignalInsert>): BacktestRunSignalInsert {
  return {
    signalId: 101,
    signalName: 'lgbm_momentum_v1@sp500',
    signalSource: 'python_ml',
    templateId: 'lightgbm_v1',
    barInterval: '1d',
    nature: 'cross_sectional',
    ic: 0.035,
    trainingIc: 0.048,
    decaySlope: -0.002,
    rosterState: 'active',
    stateWeight: 1.0,
    fusionWeight: 0.55,
    excluded: false,
    pairCount: 2500,
    symbolCount: 50,
    evalTimeMs: 1200,
    lastObservationAt: 1700090000000,
    nativeIntervalMs: 86400000,
    ...overrides,
  };
}

function makeCombinatorInsert(overrides?: Partial<BacktestRunCombinatorInsert>): BacktestRunCombinatorInsert {
  return {
    method: 'ic_weighted',
    diagnosticsJson: JSON.stringify({ cellDropCounts: { totalCells: 100, finiteCells: 98, droppedAvailableWZero: 1, droppedAllZeroWeights: 1 }, anchorMissCount: 0 }),
    totalSignalsInput: 3,
    totalSignalsFused: 2,
    decaySensitivity: 0.5,
    kellyFraction: null,
    constructionRule: 'rank_long_short',
    warningsJson: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Blob codec tests
// ---------------------------------------------------------------------------

describe('encodeEquityCurveBlob / decodeEquityCurveBlob', () => {
  it('round-trips a multi-bar curve', () => {
    const gross = makeEquityCurve(10);
    const net = makeEquityCurve(10).map((p, i) => ({
      timestamp: p.timestamp,
      equity: p.equity - i * 0.0001,
    }));

    const blob = encodeEquityCurveBlob(gross, net);
    expect(blob.length).toBe(10 * 24);

    const decoded = decodeEquityCurveBlob(blob);
    expect(decoded).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(decoded[i].timestamp).toBe(gross[i].timestamp);
      expect(decoded[i].gross).toBe(gross[i].equity);
      expect(decoded[i].net).toBe(net[i].equity);
    }
  });

  it('returns empty array for empty blob', () => {
    const decoded = decodeEquityCurveBlob(Buffer.alloc(0));
    expect(decoded).toHaveLength(0);
  });

  it('falls back to gross when net curve is shorter', () => {
    const gross = makeEquityCurve(5);
    const net = makeEquityCurve(3);

    const blob = encodeEquityCurveBlob(gross, net);
    const decoded = decodeEquityCurveBlob(blob);

    expect(decoded[3].net).toBe(gross[3].equity);
    expect(decoded[4].net).toBe(gross[4].equity);
  });

  it('produces byte-identical blobs for the same input', () => {
    const gross = makeEquityCurve(20);
    const net = makeEquityCurve(20);
    const blob1 = encodeEquityCurveBlob(gross, net);
    const blob2 = encodeEquityCurveBlob(gross, net);
    expect(blob1.equals(blob2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Leverage series blob codec tests (TICKET_1014)
// ---------------------------------------------------------------------------

describe('encodeLeverageSeriesBlob / decodeLeverageSeriesBlob', () => {
  it('round-trips a leverage series', () => {
    const series = [1.0, 1.2, 0.8, 1.5, 1.0];
    const blob = encodeLeverageSeriesBlob(series);
    expect(blob.length).toBe(5 * 8);
    const decoded = decodeLeverageSeriesBlob(blob);
    expect(decoded).toEqual(series);
  });

  it('returns empty array for empty blob', () => {
    const decoded = decodeLeverageSeriesBlob(Buffer.alloc(0));
    expect(decoded).toHaveLength(0);
  });

  it('handles single-element series', () => {
    const blob = encodeLeverageSeriesBlob([2.5]);
    const decoded = decodeLeverageSeriesBlob(blob);
    expect(decoded).toEqual([2.5]);
  });

  it('produces byte-identical blobs for the same input', () => {
    const series = [1.0, 1.1, 0.9];
    const blob1 = encodeLeverageSeriesBlob(series);
    const blob2 = encodeLeverageSeriesBlob(series);
    expect(blob1.equals(blob2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Service tests
// ---------------------------------------------------------------------------

describe('BacktestRunService', () => {
  let db: DatabaseManager;
  let stmtMock: ReturnType<typeof createMockDb>['stmtMock'];
  let service: BacktestRunService;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db, stmtMock } = createMockDb());
    service = new BacktestRunService(db);
  });

  // =========================================================================
  // saveRun
  // =========================================================================

  describe('saveRun', () => {
    it('throws on empty books array (TICKET_857 fail-fast)', () => {
      expect(() => service.saveRun(makeRunInsert(), [])).toThrow(
        'TICKET_927_1_4_E: saveRun refuses an empty books array',
      );
    });

    it('executes inside a transaction', () => {
      service.saveRun(makeRunInsert(), [makeBookInsert()]);
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('inserts one run row and one book row for a single-market run', () => {
      const runId = service.saveRun(makeRunInsert(), [makeBookInsert()]);

      expect(runId).toBe(42);
      const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
      expect(prepareCalls.length).toBe(2);

      const runSql = prepareCalls[0][0] as string;
      expect(runSql).toContain('INSERT INTO nona_backtest_run');
      expect(runSql).toContain('data_snapshot_id');

      const bookSql = prepareCalls[1][0] as string;
      expect(bookSql).toContain('INSERT INTO nona_backtest_book');
      expect(bookSql).toContain('equity_curve_blob');
    });

    it('inserts N book rows for an N-market run', () => {
      const books = [
        makeBookInsert({ marketId: 'alpaca_us_equity' }),
        makeBookInsert({ marketId: 'dukascopy_forex' }),
      ];

      service.saveRun(makeRunInsert(), books);

      // book stmt.run called twice
      expect(stmtMock.run).toHaveBeenCalledTimes(3); // 1 run + 2 books
    });

    it('passes data_snapshot_id as NOT NULL', () => {
      service.saveRun(makeRunInsert(), [makeBookInsert()]);

      const runArgs = stmtMock.run.mock.calls[0];
      expect(runArgs[7]).toBe('snap-abc');
      expect(runArgs[7]).not.toBeNull();
    });

    it('passes signal_ids as JSON array', () => {
      service.saveRun(makeRunInsert({ signalIds: [3, 7, 11] }), [makeBookInsert()]);

      const runArgs = stmtMock.run.mock.calls[0];
      expect(runArgs[3]).toBe('[3,7,11]');
    });

    // -----------------------------------------------------------------------
    // TICKET_1287 P2: per-signal chain identity columns.
    // Run INSERT arg order (0-based): createdAt(0) userId(1) runLabel(2)
    // signalIds(3) fusionMethod(4) startMs(5) endMs(6) dataSnapshotId(7)
    // firmSharpe(8) firmMaxDrawdown(9) firmFinalEquity(10) firmBaseCcy(11)
    // requestJson(12) notes(13) sharpe_ann_basis(14) chain_id(15)
    // chain_position(16).
    // -----------------------------------------------------------------------

    it('TICKET_1287: run INSERT names chain_id + chain_position columns', () => {
      service.saveRun(makeRunInsert(), [makeBookInsert()]);

      const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
      const runSql = prepareCalls[0][0] as string;
      expect(runSql).toContain('chain_id');
      expect(runSql).toContain('chain_position');
    });

    it('TICKET_1287: fused run (no chain fields) persists both columns NULL (AC4)', () => {
      service.saveRun(makeRunInsert(), [makeBookInsert()]);

      const runArgs = stmtMock.run.mock.calls[0];
      expect(runArgs[15]).toBeNull(); // chain_id
      expect(runArgs[16]).toBeNull(); // chain_position
    });

    it('TICKET_1287: chain entry persists chainId + chainPosition (incl. position 0)', () => {
      service.saveRun(
        makeRunInsert({ chainId: 'chain-uuid-abc', chainPosition: 0 }),
        [makeBookInsert()],
      );

      const runArgs = stmtMock.run.mock.calls[0];
      expect(runArgs[15]).toBe('chain-uuid-abc'); // chain_id
      expect(runArgs[16]).toBe(0); // chain_position (0-based; 0 must not coerce to NULL)
    });

    it('encodes equity_curve_blob as a Buffer', () => {
      service.saveRun(makeRunInsert(), [makeBookInsert()]);

      const bookArgs = stmtMock.run.mock.calls[1];
      // equity_curve_blob is param index 21 in the book INSERT
      // (TICKET_1140 inserted gross/net_hit_rate_daily at 7/8)
      const blob = bookArgs[21];
      expect(Buffer.isBuffer(blob)).toBe(true);
      expect(blob.length).toBe(5 * 24); // 5 bars * 24 bytes
    });

    it('maps book metrics correctly', () => {
      const book = makeBook();
      service.saveRun(makeRunInsert(), [makeBookInsert({ book })]);

      const bookArgs = stmtMock.run.mock.calls[1];
      expect(bookArgs[0]).toBe(42); // run_id
      expect(bookArgs[1]).toBe('alpaca_us_equity'); // market_id
      expect(bookArgs[2]).toBe('1d'); // execution_interval
      expect(bookArgs[3]).toBe(10); // symbol_count (nSymbols)
      expect(bookArgs[4]).toBe(2); // signal_count
      expect(bookArgs[5]).toBe(book.gross.metrics.sharpeRatioAnnualised); // gross_sharpe
      expect(bookArgs[6]).toBe(book.net.metrics.sharpeRatioAnnualised); // net_sharpe
      // TICKET_1140: daily hit rate persisted per book, next to the sharpes.
      expect(bookArgs[7]).toBe(book.gross.metrics.hitRateDaily); // gross_hit_rate_daily
      expect(bookArgs[8]).toBe(book.net.metrics.hitRateDaily); // net_hit_rate_daily
    });

    it('TICKET_1140: book INSERT names the hit-rate columns', () => {
      service.saveRun(makeRunInsert(), [makeBookInsert()]);

      const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
      const bookSql = prepareCalls[1][0] as string;
      expect(bookSql).toContain('gross_hit_rate_daily');
      expect(bookSql).toContain('net_hit_rate_daily');
    });

    it('maps TICKET_1014 extended book columns', () => {
      const book = makeBook({
        constructionUsed: 'score_weighted',
        totalOrdersEmitted: 300,
        drawdownTriggerCount: 2,
        leverageSeries: [1.0, 1.2, 0.9],
        perSymbolContribution: [
          { symbol: 'AAPL', contribution: 0.03 },
          { symbol: 'MSFT', contribution: 0.02 },
        ],
      });
      service.saveRun(makeRunInsert(), [makeBookInsert({ book })]);

      const bookArgs = stmtMock.run.mock.calls[1];
      // New columns start after warnings_json (index 24; TICKET_1140 shifted
      // everything after net_sharpe by +2)
      expect(bookArgs[25]).toBe('score_weighted'); // construction_rule
      expect(bookArgs[26]).toBe(300); // total_orders_emitted
      expect(bookArgs[27]).toBe(2); // drawdown_trigger_count
      expect(bookArgs[28]).toBe(0); // hold_bar_count (from metrics)
      expect(bookArgs[29]).toBe(5); // rebalance_count (from metrics)
      expect(bookArgs[30]).toBe(0.2); // max_single_bar_turnover (from metrics)
      expect(bookArgs[31]).toContain('AAPL'); // per_symbol_contrib_json
      expect(Buffer.isBuffer(bookArgs[32])).toBe(true); // leverage_series_blob
      // quote_ccy is the last param
    });

    // -----------------------------------------------------------------------
    // TICKET_1014: signal + combinator persistence
    // -----------------------------------------------------------------------

    it('inserts signal rows when provided', () => {
      const signals = [
        makeSignalInsert({ signalId: 1 }),
        makeSignalInsert({ signalId: 2, rosterState: 'bench', excluded: true }),
      ];
      service.saveRun(makeRunInsert(), [makeBookInsert()], signals);

      const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
      // run + book + signal stmt = 3 prepare calls
      expect(prepareCalls.length).toBe(3);
      const signalSql = prepareCalls[2][0] as string;
      expect(signalSql).toContain('INSERT INTO nona_backtest_run_signal');

      // 1 run + 1 book + 2 signals = 4 run calls
      expect(stmtMock.run).toHaveBeenCalledTimes(4);
    });

    it('inserts combinator row when provided', () => {
      const comb = makeCombinatorInsert();
      service.saveRun(makeRunInsert(), [makeBookInsert()], undefined, comb);

      const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
      // run + book + combinator stmt = 3 prepare calls
      expect(prepareCalls.length).toBe(3);
      const combSql = prepareCalls[2][0] as string;
      expect(combSql).toContain('INSERT INTO nona_backtest_run_combinator');

      // 1 run + 1 book + 1 combinator = 3 run calls
      expect(stmtMock.run).toHaveBeenCalledTimes(3);
    });

    it('inserts signals + combinator together in same transaction', () => {
      const signals = [makeSignalInsert()];
      const comb = makeCombinatorInsert();
      service.saveRun(makeRunInsert(), [makeBookInsert()], signals, comb);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
      // run + book + signal + combinator = 4 prepare calls
      expect(prepareCalls.length).toBe(4);
      // 1 run + 1 book + 1 signal + 1 combinator = 4 run calls
      expect(stmtMock.run).toHaveBeenCalledTimes(4);
    });

    it('maps signal insert fields correctly', () => {
      const sig = makeSignalInsert({
        signalId: 77,
        signalName: 'test_signal',
        signalSource: 'hmm_regime',
        templateId: 'hmm_v1',
        barInterval: '1h',
        nature: 'single_symbol_valid',
        ic: 0.042,
        decaySlope: -0.001,
        rosterState: 'active',
        stateWeight: 0.5,
        fusionWeight: 0.33,
        excluded: false,
        pairCount: 1000,
        symbolCount: 25,
        evalTimeMs: 800,
        lastObservationAt: 1700050000000,
        nativeIntervalMs: 3600000,
      });
      service.saveRun(makeRunInsert(), [makeBookInsert()], [sig]);

      // Signal stmt.run is call index 2 (after run + book)
      const sigArgs = stmtMock.run.mock.calls[2];
      expect(sigArgs[0]).toBe(42); // run_id
      expect(sigArgs[1]).toBe(77); // signal_id
      expect(sigArgs[2]).toBe('test_signal'); // signal_name
      expect(sigArgs[3]).toBe('hmm_regime'); // signal_source
      expect(sigArgs[4]).toBe('hmm_v1'); // template_id
      expect(sigArgs[5]).toBe('1h'); // bar_interval
      expect(sigArgs[6]).toBe('single_symbol_valid'); // nature
      expect(sigArgs[7]).toBe(0.042); // ic (backtest-time)
      expect(sigArgs[8]).toBe(0.048); // training_ic
      expect(sigArgs[9]).toBe(-0.001); // decay_slope
      expect(sigArgs[10]).toBe('active'); // roster_state
      expect(sigArgs[11]).toBe(0.5); // state_weight
      expect(sigArgs[12]).toBe(0.33); // fusion_weight
      expect(sigArgs[13]).toBe(0); // excluded (0 = false)
      expect(sigArgs[14]).toBeNull(); // exclusion_reason
      expect(sigArgs[15]).toBe(1000); // pair_count
      expect(sigArgs[16]).toBe(25); // symbol_count
      expect(sigArgs[17]).toBe(800); // eval_time_ms
      expect(sigArgs[18]).toBe(1700050000000); // last_observation_at
      expect(sigArgs[19]).toBe(3600000); // native_interval_ms
    });

    it('maps excluded signal with reason', () => {
      const sig = makeSignalInsert({
        excluded: true,
        exclusionReason: 'single_symbol_nature_gate',
        fusionWeight: null,
      });
      service.saveRun(makeRunInsert(), [makeBookInsert()], [sig]);

      const sigArgs = stmtMock.run.mock.calls[2];
      expect(sigArgs[13]).toBe(1); // excluded = 1
      expect(sigArgs[14]).toBe('single_symbol_nature_gate'); // exclusion_reason
      expect(sigArgs[12]).toBeNull(); // fusion_weight = null (excluded)
    });

    it('maps bench signal with stateWeight 0.0', () => {
      const sig = makeSignalInsert({
        rosterState: 'bench',
        stateWeight: 0.0,
        excluded: true,
        exclusionReason: 'bench_roster',
        fusionWeight: null,
        ic: null,
        trainingIc: null,
        decaySlope: null,
        evalTimeMs: null,
      });
      service.saveRun(makeRunInsert(), [makeBookInsert()], [sig]);

      const sigArgs = stmtMock.run.mock.calls[2];
      expect(sigArgs[10]).toBe('bench');
      expect(sigArgs[11]).toBe(0.0);
      expect(sigArgs[13]).toBe(1);
      expect(sigArgs[14]).toBe('bench_roster');
    });

    it('maps combinator insert fields correctly', () => {
      const comb = makeCombinatorInsert({
        method: 'kelly',
        totalSignalsInput: 5,
        totalSignalsFused: 4,
        decaySensitivity: 0.3,
        kellyFraction: 0.25,
        constructionRule: 'long_only_top',
        warningsJson: JSON.stringify(['low_ic_fallback']),
      });
      service.saveRun(makeRunInsert(), [makeBookInsert()], undefined, comb);

      // Combinator stmt.run is call index 2 (after run + book)
      const combArgs = stmtMock.run.mock.calls[2];
      expect(combArgs[0]).toBe(42); // run_id
      expect(combArgs[1]).toBe('kelly'); // method
      expect(combArgs[2]).toContain('cellDropCounts'); // diagnostics_json
      expect(combArgs[3]).toBe(5); // total_signals_input
      expect(combArgs[4]).toBe(4); // total_signals_fused
      expect(combArgs[5]).toBe(0.3); // decay_sensitivity
      expect(combArgs[6]).toBe(0.25); // kelly_fraction
      expect(combArgs[7]).toBe('long_only_top'); // construction_rule
      expect(combArgs[8]).toContain('low_ic_fallback'); // warnings_json
    });

    it('skips signal insert when signals array is empty', () => {
      service.saveRun(makeRunInsert(), [makeBookInsert()], []);

      const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
      // run + book only = 2 prepare calls (no signal stmt)
      expect(prepareCalls.length).toBe(2);
    });

    it('skips combinator insert when not provided', () => {
      service.saveRun(makeRunInsert(), [makeBookInsert()]);

      const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
      expect(prepareCalls.length).toBe(2);
    });

    it('handles null optional signal fields', () => {
      const sig = makeSignalInsert({
        signalName: undefined,
        signalSource: undefined,
        templateId: undefined,
        ic: null,
        trainingIc: null,
        decaySlope: null,
        fusionWeight: null,
        exclusionReason: null,
        pairCount: null,
        symbolCount: null,
        evalTimeMs: null,
        lastObservationAt: null,
        nativeIntervalMs: null,
      });
      service.saveRun(makeRunInsert(), [makeBookInsert()], [sig]);

      const sigArgs = stmtMock.run.mock.calls[2];
      expect(sigArgs[2]).toBeNull(); // signal_name
      expect(sigArgs[3]).toBeNull(); // signal_source
      expect(sigArgs[4]).toBeNull(); // template_id
      expect(sigArgs[7]).toBeNull(); // ic
      expect(sigArgs[8]).toBeNull(); // training_ic
      expect(sigArgs[9]).toBeNull(); // decay_slope
      expect(sigArgs[12]).toBeNull(); // fusion_weight
      expect(sigArgs[14]).toBeNull(); // exclusion_reason
      expect(sigArgs[15]).toBeNull(); // pair_count
      expect(sigArgs[16]).toBeNull(); // symbol_count
      expect(sigArgs[17]).toBeNull(); // eval_time_ms
      expect(sigArgs[18]).toBeNull(); // last_observation_at
      expect(sigArgs[19]).toBeNull(); // native_interval_ms
    });
  });

  // =========================================================================
  // getRunsByUser
  // =========================================================================

  describe('getRunsByUser', () => {
    it('returns runs with nested books, signals, and combinator', () => {
      const runRow = { id: 1, user_id: 'user-1', created_at: 123 };
      const bookRow = { id: 10, run_id: 1, market_id: 'alpaca_us_equity' };
      const signalRow = { id: 20, run_id: 1, signal_id: 101 };
      const combRow = { id: 30, run_id: 1, method: 'ic_weighted' };

      const allFn = vi.fn()
        .mockReturnValueOnce([runRow])   // runs query
        .mockReturnValueOnce([bookRow])  // books query
        .mockReturnValueOnce([signalRow]); // signals query
      const getFn = vi.fn()
        .mockReturnValueOnce(combRow);   // combinator query
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
        ...stmtMock,
        all: allFn,
        get: getFn,
      });

      const runs = service.getRunsByUser('user-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].books).toHaveLength(1);
      expect(runs[0].signals).toHaveLength(1);
      expect(runs[0].signals[0].signal_id).toBe(101);
      expect(runs[0].combinator).not.toBeNull();
      expect(runs[0].combinator!.method).toBe('ic_weighted');
    });

    it('returns empty array when no runs', () => {
      const runs = service.getRunsByUser('nobody');
      expect(runs).toHaveLength(0);
    });

    it('respects custom limit', () => {
      service.getRunsByUser('user-1', 10);
      expect(stmtMock.all).toHaveBeenCalledWith('user-1', 10);
    });

    it('returns null combinator when none exists', () => {
      const runRow = { id: 1, user_id: 'user-1', created_at: 123 };
      const allFn = vi.fn()
        .mockReturnValueOnce([runRow])
        .mockReturnValueOnce([])   // no books
        .mockReturnValueOnce([]);  // no signals
      const getFn = vi.fn()
        .mockReturnValueOnce(undefined); // no combinator
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
        ...stmtMock,
        all: allFn,
        get: getFn,
      });

      const runs = service.getRunsByUser('user-1');
      expect(runs[0].combinator).toBeNull();
    });
  });

  // =========================================================================
  // getRunById
  // =========================================================================

  describe('getRunById', () => {
    it('returns run with books, signals, and combinator when found', () => {
      const runRow = { id: 5 };
      const bookRow = { id: 20, run_id: 5 };
      const signalRow = { id: 30, run_id: 5, signal_id: 99 };
      const combRow = { id: 40, run_id: 5, method: 'kelly' };

      const getFn = vi.fn()
        .mockReturnValueOnce(runRow)
        .mockReturnValueOnce(combRow);
      const allFn = vi.fn()
        .mockReturnValueOnce([bookRow])
        .mockReturnValueOnce([signalRow]);
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
        ...stmtMock,
        get: getFn,
        all: allFn,
      });

      const result = service.getRunById(5);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(5);
      expect(result!.books).toHaveLength(1);
      expect(result!.signals).toHaveLength(1);
      expect(result!.signals[0].signal_id).toBe(99);
      expect(result!.combinator).not.toBeNull();
      expect(result!.combinator!.method).toBe('kelly');
    });

    it('returns null when not found', () => {
      stmtMock.get.mockReturnValue(undefined);
      expect(service.getRunById(999)).toBeNull();
    });
  });

  // =========================================================================
  // TICKET_1287 P4b: buildRunResult (renderer-ready reconstruction, D7/AC7)
  // =========================================================================

  describe('buildRunResult', () => {
    function wireRows(
      runRow: unknown,
      bookRows: unknown[],
      signalRows: unknown[] = [],
    ): void {
      const getFn = vi.fn().mockReturnValueOnce(runRow);
      const allFn = vi.fn()
        .mockReturnValueOnce(bookRows)   // books SELECT ... ORDER BY id ASC
        .mockReturnValueOnce(signalRows); // signals SELECT
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
        ...stmtMock,
        get: getFn,
        all: allFn,
      });
    }

    it('returns null when the run row is absent', () => {
      wireRows(undefined, []);
      expect(service.buildRunResult(999)).toBeNull();
    });

    it('reconstructs curves, derived returns, and mapped metrics/cost', () => {
      const grossPts = [
        { timestamp: 1, equity: 1.0 },
        { timestamp: 2, equity: 1.5 },
      ];
      const netPts = [
        { timestamp: 1, equity: 1.0 },
        { timestamp: 2, equity: 1.3 },
      ];
      const blob = encodeEquityCurveBlob(grossPts, netPts);
      const runRow = {
        id: 5, created_at: 1000, signal_ids: JSON.stringify([42]),
        fusion_method: 'equal_weight', start_ms: 111, end_ms: 222,
        request_json: JSON.stringify({ initialCapital: 100000 }),
        chain_id: 'chain-X', chain_position: 0,
      };
      const bookRow = {
        run_id: 5, symbol_count: 3, gross_sharpe: 1.8, gross_max_drawdown: -0.12,
        net_hit_rate_daily: 0.55, total_orders_emitted: 7, total_cost_charged: 0.02,
        cost_json: JSON.stringify({ feeRate: 0.0005, impactRate: 0.0002, perStockCostApplied: true }),
        equity_curve_blob: blob,
        per_symbol_contrib_json: JSON.stringify([{ symbol: 'AAPL', contribution: 0.4 }]),
      };
      wireRows(runRow, [bookRow], [{ signal_name: 'momentum_v3' }]);

      const res = service.buildRunResult(5)!;
      expect(res.grossCurve).toEqual(grossPts);
      expect(res.netCurve).toEqual(netPts);
      expect(res.metrics.grossTotalReturn).toBeCloseTo(0.5, 10);
      expect(res.metrics.netTotalReturn).toBeCloseTo(0.3, 10);
      expect(res.metrics.grossSharpeAnnualised).toBe(1.8);
      expect(res.metrics.grossMaxDrawdown).toBe(-0.12);
      expect(res.metrics.netHitRateDaily).toBe(0.55);
      expect(res.metrics.totalOrdersEmitted).toBe(7);
      expect(res.cost).toEqual({
        totalCostCharged: 0.02, feeRate: 0.0005, impactRate: 0.0002, perStockCostApplied: true,
      });
      expect(res.perSymbolContribution).toEqual([{ symbol: 'AAPL', contribution: 0.4 }]);
      expect(res.signalIds).toEqual([42]);
      expect(res.signalNames).toEqual(['momentum_v3']);
      expect(res.initialCapital).toBe(100000);
      expect(res.chainId).toBe('chain-X');
      expect(res.chainPosition).toBe(0);
      expect(res.nSymbols).toBe(3);
    });

    it('tolerates absent request_json / cost_json / per_symbol_contrib_json', () => {
      const blob = encodeEquityCurveBlob(
        [{ timestamp: 1, equity: 1.0 }, { timestamp: 2, equity: 1.2 }],
        [{ timestamp: 1, equity: 1.0 }, { timestamp: 2, equity: 1.1 }],
      );
      const runRow = {
        id: 6, created_at: 1, signal_ids: JSON.stringify([1]), fusion_method: 'equal_weight',
        start_ms: 1, end_ms: 2, request_json: null, chain_id: null, chain_position: null,
      };
      const bookRow = {
        run_id: 6, symbol_count: 1, gross_sharpe: null, gross_max_drawdown: null,
        net_hit_rate_daily: null, total_orders_emitted: null, total_cost_charged: null,
        cost_json: null, equity_curve_blob: blob, per_symbol_contrib_json: null,
      };
      wireRows(runRow, [bookRow], []);

      const res = service.buildRunResult(6)!;
      expect(res.initialCapital).toBeNull();
      expect(res.cost).toEqual({
        totalCostCharged: 0, feeRate: 0, impactRate: 0, perStockCostApplied: false,
      });
      expect(res.perSymbolContribution).toEqual([]);
      expect(res.signalNames).toEqual([]);
      expect(res.metrics.grossSharpeAnnualised).toBe(0);
    });

    it('throws (TICKET_857) when the run row has no book', () => {
      wireRows({ id: 7, signal_ids: '[]', request_json: null }, []);
      expect(() => service.buildRunResult(7)).toThrow(/no persisted market book/);
    });

    it('throws when the equity blob is empty', () => {
      const runRow = { id: 8, signal_ids: '[]', request_json: null, fusion_method: 'x', start_ms: 0, end_ms: 0, chain_id: null, chain_position: null, created_at: 0 };
      wireRows(runRow, [{ run_id: 8, symbol_count: 1, equity_curve_blob: Buffer.alloc(0) }]);
      expect(() => service.buildRunResult(8)).toThrow(/empty equity curve blob/);
    });

    it('throws on a multi-book run (single-book scope only)', () => {
      const runRow = { id: 9, signal_ids: '[]', request_json: null, fusion_method: 'x', start_ms: 0, end_ms: 0, chain_id: null, chain_position: null, created_at: 0 };
      wireRows(runRow, [{ run_id: 9 }, { run_id: 9 }]);
      expect(() => service.buildRunResult(9)).toThrow(/market books/);
    });
  });

  // =========================================================================
  // getRunSignals / getRunCombinator
  // =========================================================================

  describe('getRunSignals', () => {
    it('returns signal rows for a run', () => {
      const rows = [
        { id: 1, run_id: 5, signal_id: 101 },
        { id: 2, run_id: 5, signal_id: 102 },
      ];
      stmtMock.all.mockReturnValueOnce(rows);
      const result = service.getRunSignals(5);
      expect(result).toHaveLength(2);
    });
  });

  describe('getRunCombinator', () => {
    it('returns combinator row when exists', () => {
      const row = { id: 1, run_id: 5, method: 'pca' };
      stmtMock.get.mockReturnValueOnce(row);
      const result = service.getRunCombinator(5);
      expect(result).not.toBeNull();
      expect(result!.method).toBe('pca');
    });

    it('returns null when no combinator', () => {
      stmtMock.get.mockReturnValueOnce(undefined);
      expect(service.getRunCombinator(5)).toBeNull();
    });
  });

  // =========================================================================
  // deleteRun
  // =========================================================================

  describe('deleteRun', () => {
    it('executes DELETE by id', () => {
      service.deleteRun(7);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('DELETE FROM nona_backtest_run WHERE id = ?');
      expect(stmtMock.run).toHaveBeenCalledWith(7);
    });
  });
});
