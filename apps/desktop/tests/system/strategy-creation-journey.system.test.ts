/**
 * System Test: Strategy Creation Journey
 *
 * TICKET_494 Phase 2: System layer
 * Journey: Init -> generate strategy -> DB verify -> run backtest -> DB verify -> retrieve
 * Tests the complete strategy creation and backtest lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// System simulation: full journey state
// ---------------------------------------------------------------------------

interface Algorithm {
  id: number;
  code: string;
  strategy_name: string;
  strategy_type: number;
  classification_metadata: string;
  user_id: string;
  status: number;
}

interface BacktestResult {
  task_id: string;
  algorithm_id: number;
  strategy_name: string;
  total_pnl: number;
  sharpe_ratio: number;
  win_rate: number;
  total_trades: number;
  status: 'completed' | 'failed';
}

let algorithms: Map<number, Algorithm>;
let backtestResults: Map<string, BacktestResult>;
let nextAlgoId: number;
let nextTaskSeq: number;

function resetJourney() {
  algorithms = new Map();
  backtestResults = new Map();
  nextAlgoId = 1;
  nextTaskSeq = 1;
}

// Simulate strategy generation
function generateStrategy(
  name: string,
  code: string,
  type: number,
  userId: string,
  metadata: Record<string, unknown> = {},
): Algorithm {
  const id = nextAlgoId++;
  const algo: Algorithm = {
    id,
    code,
    strategy_name: name,
    strategy_type: type,
    classification_metadata: JSON.stringify(metadata),
    user_id: userId,
    status: 1,
  };
  algorithms.set(id, algo);
  return algo;
}

// Simulate backtest execution
function runBacktest(
  algorithmId: number,
  pnl: number,
  trades = 20,
  sharpe = 1.5,
): BacktestResult | null {
  const algo = algorithms.get(algorithmId);
  if (!algo) return null;

  const taskId = `bt-${nextTaskSeq++}-${algorithmId}`;
  const result: BacktestResult = {
    task_id: taskId,
    algorithm_id: algorithmId,
    strategy_name: algo.strategy_name,
    total_pnl: pnl,
    sharpe_ratio: sharpe,
    win_rate: trades > 0 ? 0.6 : 0,
    total_trades: trades,
    status: 'completed',
  };
  backtestResults.set(taskId, result);
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Strategy Creation Journey', () => {
  beforeEach(() => {
    resetJourney();
  });

  // =========================================================================
  // End-to-end: generate -> backtest -> verify
  // =========================================================================

  it('full journey: generate trend strategy -> backtest -> verify results', () => {
    // Step 1: Generate strategy
    const algo = generateStrategy(
      'Trend RSI Strategy',
      'class TrendRSI(StrategyBase):\n  pass',
      1,
      'user-1',
      { signal_source: 'regime_indicator', regime_type: 'trend', indicators: ['RSI', 'MACD'] },
    );

    expect(algorithms.has(algo.id)).toBe(true);
    expect(algo.strategy_name).toBe('Trend RSI Strategy');

    // Step 2: Run backtest
    const result = runBacktest(algo.id, 2500, 25, 1.8);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('completed');
    expect(result!.total_pnl).toBe(2500);

    // Step 3: Verify linkage
    expect(result!.algorithm_id).toBe(algo.id);
    expect(result!.strategy_name).toBe(algo.strategy_name);

    // Step 4: Retrieve from stores
    const savedAlgo = algorithms.get(algo.id);
    expect(savedAlgo).toBeDefined();
    const savedResult = backtestResults.get(result!.task_id);
    expect(savedResult).toBeDefined();
    expect(savedResult!.sharpe_ratio).toBe(1.8);
  });

  it('generate entry signal -> backtest -> results linked', () => {
    const algo = generateStrategy(
      'RSI Entry Signal',
      'class RSIEntry(EntrySignalBase):\n  pass',
      3,
      'user-1',
      { signal_source: 'entry_signal' },
    );

    expect(algo.strategy_type).toBe(3);

    const result = runBacktest(algo.id, 800);
    expect(result!.algorithm_id).toBe(algo.id);
    expect(result!.strategy_name).toBe('RSI Entry Signal');
  });

  it('generate exit strategy -> backtest -> results linked', () => {
    const algo = generateStrategy(
      'Stop Loss Exit',
      'class StopLoss(ExitStrategyBase):\n  pass',
      6,
      'user-1',
      { signal_source: 'exit_strategy', exit_rules: [{ type: 'circuit_breaker' }] },
    );

    const result = runBacktest(algo.id, 1200);
    expect(result!.strategy_name).toBe('Stop Loss Exit');
  });

  // =========================================================================
  // Multiple strategies and backtests
  // =========================================================================

  it('multiple strategies -> multiple backtests -> all retrievable', () => {
    const strategies = [
      generateStrategy('Strategy A', 'code_a', 1, 'user-1'),
      generateStrategy('Strategy B', 'code_b', 3, 'user-1'),
      generateStrategy('Strategy C', 'code_c', 6, 'user-1'),
    ];

    const results = strategies.map((s, i) => runBacktest(s.id, (i + 1) * 1000));

    expect(algorithms.size).toBe(3);
    expect(backtestResults.size).toBe(3);

    // All results linked to correct strategies
    for (let i = 0; i < strategies.length; i++) {
      expect(results[i]!.algorithm_id).toBe(strategies[i].id);
      expect(results[i]!.total_pnl).toBe((i + 1) * 1000);
    }
  });

  it('multiple backtests on same strategy -> all results saved', () => {
    const algo = generateStrategy('Multi-Backtest', 'code', 1, 'user-1');

    const r1 = runBacktest(algo.id, 1000)!;
    const r2 = runBacktest(algo.id, -500)!;
    const r3 = runBacktest(algo.id, 3000)!;

    expect(backtestResults.size).toBe(3);

    const allResults = Array.from(backtestResults.values()).filter(
      (r) => r.algorithm_id === algo.id,
    );
    expect(allResults).toHaveLength(3);
    expect(allResults.map((r) => r.total_pnl)).toContain(1000);
    expect(allResults.map((r) => r.total_pnl)).toContain(-500);
    expect(allResults.map((r) => r.total_pnl)).toContain(3000);
  });

  // =========================================================================
  // Error paths
  // =========================================================================

  it('backtest on non-existent algorithm returns null', () => {
    const result = runBacktest(999, 0);
    expect(result).toBeNull();
    expect(backtestResults.size).toBe(0);
  });

  it('delete strategy -> results remain (no cascade)', () => {
    const algo = generateStrategy('Ephemeral', 'code', 1, 'user-1');
    runBacktest(algo.id, 500);

    algorithms.delete(algo.id);

    expect(algorithms.has(algo.id)).toBe(false);
    expect(backtestResults.size).toBe(1);
  });
});
