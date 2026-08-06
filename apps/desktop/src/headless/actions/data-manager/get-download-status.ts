import type { ActionModule, ActionResult } from '../../types';
import { HeadlessBootstrap } from '../../bootstrap';

const mod: ActionModule = {
  name: 'data-manager/get-download-status',
  description: 'Read download_queue rows -- same as the Download Queue tab in Data Management',

  async run(args): Promise<ActionResult> {
    const t0 = performance.now();
    await HeadlessBootstrap.init();

    const { getDatabaseManager } = await import('../../../main/database/db-manager');
    const db = getDatabaseManager().getDb();

    const limit = typeof args.limit === 'number' ? args.limit : 50;
    const symbol = typeof args.symbol === 'string' ? args.symbol : undefined;
    const interval = typeof args.interval === 'string' ? args.interval : undefined;
    const status = typeof args.status === 'string' ? args.status : undefined;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (symbol)   { conditions.push('symbol = ?');   params.push(symbol); }
    if (interval) { conditions.push('interval = ?'); params.push(interval); }
    if (status)   { conditions.push('status = ?');   params.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(
      `SELECT task_id, symbol, interval, provider, status, progress, message, error,
              total_chunks, completed_chunks, created_at, updated_at
       FROM download_queue ${where}
       ORDER BY updated_at DESC LIMIT ?`
    ).all(...params, limit) as Record<string, unknown>[];

    const statusCounts = db
      .prepare('SELECT status, COUNT(*) AS cnt FROM download_queue GROUP BY status')
      .all() as { status: string; cnt: number }[];

    const errorRows = rows.filter(r => r.error);

    return {
      name: mod.name,
      ok: true,
      summary: `${rows.length} rows returned (${statusCounts.map(r => `${r.status}=${r.cnt}`).join(', ')})`,
      details: {
        rows,
        rowCount: rows.length,
        errorCount: errorRows.length,
        statusCounts: Object.fromEntries(statusCounts.map(r => [r.status, r.cnt])),
        filters: { symbol, interval, status, limit },
      },
      durationMs: Math.round(performance.now() - t0),
    };
  },
};

export default mod;
