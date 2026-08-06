import type { ActionModule, ActionResult } from '../../types';
import { HeadlessBootstrap } from '../../bootstrap';

/**
 * Headless action: backtester/run-backtest
 *
 * TICKET_1235_1 F3 (dual-rail convergence): envelope over the single shared
 * implementation -- `handleRunBacktest` from the MCP handler module, which
 * owns the bridge discovery + `apiClient.runBacktest` call. This action
 * MUST NOT re-implement bridge discovery or manual fetch.
 *
 * The Electron app owns the full executor pipeline: data download, C++
 * compilation, stratforge-runner spawn, result persistence. The headless
 * layer cannot replicate that without the entire Electron process, so the
 * bridge approach is the correct minimal path.
 *
 * Returns a taskId for status polling via backtester/get-backtest-status.
 */
const mod: ActionModule = {
  name: 'backtester/run-backtest',
  description: 'Run a backtest on a stored algorithm via the Electron executor pipeline',

  async run(args): Promise<ActionResult> {
    const t0 = performance.now();

    const algorithmId = typeof args.algorithm_id === 'number'
      ? args.algorithm_id
      : typeof args.algorithm_id === 'string'
        ? parseInt(args.algorithm_id as string, 10)
        : undefined;

    if (algorithmId == null || Number.isNaN(algorithmId)) {
      return {
        name: mod.name,
        ok: false,
        summary: 'Missing required arg: algorithm_id (number)',
        details: { provided: args },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    const symbol = typeof args.symbol === 'string' ? args.symbol : 'AAPL';
    const interval = typeof args.interval === 'string' ? args.interval : '1d';
    const startDate = typeof args.start_date === 'string' ? args.start_date : undefined;
    const endDate = typeof args.end_date === 'string' ? args.end_date : undefined;
    const initialCapital = typeof args.initial_capital === 'number'
      ? args.initial_capital
      : 100_000;
    const dataSource = typeof args.data_source === 'string'
      ? args.data_source
      : 'yfinance';

    await HeadlessBootstrap.init();

    const { getDatabaseManager } = await import('../../../main/database/db-manager');
    const db = getDatabaseManager().getDb();

    const algorithm = db.prepare(
      `SELECT id, strategy_name FROM v_algorithms_all WHERE id = ?`,
    ).get(algorithmId) as { id: number; strategy_name: string | null } | undefined;

    if (!algorithm) {
      return {
        name: mod.name,
        ok: false,
        summary: `Algorithm with id=${algorithmId} not found in database`,
        details: { algorithmId },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    const params = {
      algorithm_id: algorithmId,
      symbol,
      interval,
      start_date: startDate,
      end_date: endDate,
      initial_capital: initialCapital,
      data_source: dataSource,
    };

    const { handleRunBacktest } = await import(
      '../../../mcp/standalone/src/handlers/backtests'
    );
    const result = await handleRunBacktest(db as any, params);

    const text = result.content?.[0]?.text ?? '';

    if (result.isError) {
      return {
        name: mod.name,
        ok: false,
        summary: text,
        details: {
          algorithmId,
          algorithmName: algorithm.strategy_name,
          assembledParams: params,
        },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text) as Record<string, unknown>; } catch { /* raw text */ }

    const taskId = data.taskId as string | undefined;

    return {
      name: mod.name,
      ok: true,
      summary: `Backtest started: taskId=${taskId} | algorithm=${algorithm.strategy_name} | ${symbol} ${interval} ${dataSource}`,
      details: {
        taskId,
        algorithmId,
        algorithmName: algorithm.strategy_name,
        symbol,
        interval,
        dataSource,
        initialCapital,
        startDate: startDate || '(default: 2 years ago)',
        endDate: endDate || '(default: today)',
      },
      durationMs: Math.round(performance.now() - t0),
    };
  },
};

export default mod;
