import type { ActionModule, ActionResult } from '../../types';
import { HeadlessBootstrap } from '../../bootstrap';

const mod: ActionModule = {
  name: 'data-manager/retry-failed',
  description: 'Re-enqueue ERROR-state downloads from the download queue',

  async run(args): Promise<ActionResult> {
    const t0 = performance.now();
    const symbol = typeof args.symbol === 'string' ? args.symbol : undefined;

    await HeadlessBootstrap.init();

    const { getDatabaseManager } = await import('../../../main/database/db-manager');
    const db = getDatabaseManager().getDb();

    const where = symbol
      ? `WHERE status = 'error' AND symbol = ?`
      : `WHERE status = 'error'`;
    const params = symbol ? [symbol] : [];

    const errorRows = db.prepare(
      `SELECT task_id, symbol, interval, provider, start_date, end_date, error
       FROM download_queue ${where}`
    ).all(...params) as {
      task_id: string; symbol: string; interval: string; provider: string;
      start_date: string; end_date: string; error: string | null;
    }[];

    if (errorRows.length === 0) {
      return {
        name: mod.name,
        ok: true,
        summary: symbol
          ? `No ERROR downloads found for ${symbol}`
          : 'No ERROR downloads found',
        details: { retried: 0 },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    const { initializeDataDownloadQueue, getDataDownloadQueue } =
      await import('../../../main/services/data-download-queue');
    initializeDataDownloadQueue();

    const queue = getDataDownloadQueue();
    const retried: { taskId: string; symbol: string; interval: string }[] = [];

    for (const row of errorRows) {
      db.prepare(`DELETE FROM download_queue WHERE task_id = ?`).run(row.task_id);

      const newTaskId = queue.enqueue({
        symbol: row.symbol,
        interval: row.interval,
        provider: row.provider,
        startDate: row.start_date,
        endDate: row.end_date,
        callerId: 'headless-retry',
        priority: 'background',
        forceDownload: true,
      });
      retried.push({ taskId: newTaskId, symbol: row.symbol, interval: row.interval });
    }

    return {
      name: mod.name,
      ok: true,
      summary: `Retried ${retried.length} failed download(s)`,
      details: { retried: retried.length, tasks: retried },
      durationMs: Math.round(performance.now() - t0),
    };
  },
};

export default mod;
