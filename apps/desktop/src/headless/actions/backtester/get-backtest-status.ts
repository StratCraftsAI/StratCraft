import type { ActionModule, ActionResult } from '../../types';
import { HeadlessBootstrap } from '../../bootstrap';

/**
 * Headless action: backtester/get-backtest-status
 *
 * TICKET_1235_1 F3 (dual-rail convergence): envelope over the single shared
 * implementations from the MCP handler module. For live task status (running
 * backtest), delegates to `handleGetBacktestStatus` (bridge-only). For
 * historical results, delegates to `handleGetBacktestResult` or
 * `handleListBacktestResults` (bridge + direct SQL fallback).
 */
function formatResultRow(row: Record<string, unknown>) {
  return {
    row,
    metrics: {
      totalPnl: row.total_pnl,
      totalReturn: row.total_return,
      sharpeRatio: row.sharpe_ratio,
      maxDrawdown: row.max_drawdown,
      winRate: row.win_rate,
      profitFactor: row.profit_factor,
      totalTrades: row.total_trades,
      winningTrades: row.winning_trades,
      losingTrades: row.losing_trades,
    },
    metadata: {
      taskId: row.task_id,
      strategyName: row.strategy_name,
      symbol: row.symbol,
      timeframe: row.timeframe,
      startDate: row.start_date,
      endDate: row.end_date,
      initialCapital: row.initial_capital,
      finalCapital: row.final_capital,
      executionTimeMs: row.execution_time_ms,
      createdAt: row.created_at,
    },
  };
}

function summarizeRow(row: Record<string, unknown>): string {
  return `task_id=${row.task_id} | ${row.strategy_name} | PnL=${row.total_pnl} | Sharpe=${row.sharpe_ratio} | Drawdown=${row.max_drawdown} | WinRate=${row.win_rate}`;
}

const mod: ActionModule = {
  name: 'backtester/get-backtest-status',
  description: 'Query backtest status and results for a given task_id, or return the most recent backtest result',

  async run(args): Promise<ActionResult> {
    const t0 = performance.now();
    await HeadlessBootstrap.init();

    const { getDatabaseManager } = await import('../../../main/database/db-manager');
    const db = getDatabaseManager().getDb();

    const taskId = typeof args.task_id === 'string' ? args.task_id : undefined;

    if (taskId) {
      const { handleGetBacktestResult } = await import(
        '../../../mcp/standalone/src/handlers/backtests'
      );
      const result = await handleGetBacktestResult(db as any, { task_id: taskId });
      const text = result.content?.[0]?.text ?? '';

      if (result.isError) {
        return {
          name: mod.name,
          ok: false,
          summary: `No backtest result found for task_id=${taskId}`,
          details: { taskId },
          durationMs: Math.round(performance.now() - t0),
        };
      }

      let row: Record<string, unknown> = {};
      try { row = JSON.parse(text) as Record<string, unknown>; } catch { /* raw text */ }

      return {
        name: mod.name,
        ok: true,
        summary: summarizeRow(row),
        details: formatResultRow(row),
        durationMs: Math.round(performance.now() - t0),
      };
    }

    // No taskId -- return most recent result
    const { handleListBacktestResults } = await import(
      '../../../mcp/standalone/src/handlers/backtests'
    );
    const result = await handleListBacktestResults(db as any, { limit: 1 });
    const text = result.content?.[0]?.text ?? '[]';

    let rows: Record<string, unknown>[] = [];
    try { rows = JSON.parse(text) as Record<string, unknown>[]; } catch { /* raw text */ }

    const row = rows[0];
    if (!row) {
      return {
        name: mod.name,
        ok: false,
        summary: 'No backtest results in database',
        details: { taskId },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    return {
      name: mod.name,
      ok: true,
      summary: summarizeRow(row),
      details: formatResultRow(row),
      durationMs: Math.round(performance.now() - t0),
    };
  },
};

export default mod;
