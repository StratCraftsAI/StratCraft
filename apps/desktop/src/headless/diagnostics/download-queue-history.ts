import type { DiagModule, DiagResult } from '../types';
import { HeadlessBootstrap } from '../bootstrap';

interface QueueRow {
  task_id: string;
  symbol: string;
  interval: string;
  provider: string;
  status: string;
  progress: number;
  message: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const mod: DiagModule = {
  name: 'download-queue-history',
  description: 'Recent download_queue rows with status and error details',

  async run(args): Promise<DiagResult> {
    const t0 = performance.now();
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    const statusFilter = typeof args.status === 'string' ? args.status : undefined;

    try {
      await HeadlessBootstrap.init();

      const { getDatabaseManager } = await import('../../main/database/db-manager');
      const db = getDatabaseManager().getDb();

      let sql = 'SELECT * FROM download_queue';
      const params: unknown[] = [];
      if (statusFilter) {
        sql += ' WHERE status = ?';
        params.push(statusFilter);
      }
      sql += ' ORDER BY updated_at DESC LIMIT ?';
      params.push(limit);

      const rows = db.prepare(sql).all(...params) as QueueRow[];
      const statusCounts = db
        .prepare('SELECT status, COUNT(*) AS cnt FROM download_queue GROUP BY status')
        .all() as { status: string; cnt: number }[];

      const details: Record<string, unknown> = {};
      details.rows = rows;
      details.rowCount = rows.length;
      details.statusCounts = Object.fromEntries(statusCounts.map(r => [r.status, r.cnt]));

      const errorRows = rows.filter(r => r.error);
      details.errorCount = errorRows.length;

      const totalCount = statusCounts.reduce((s, r) => s + r.cnt, 0);

      return {
        name: 'download-queue-history',
        pass: errorRows.length === 0,
        summary: `${totalCount} total tasks (${statusCounts.map(r => `${r.status}=${r.cnt}`).join(', ')}), showing ${rows.length}`,
        details,
        durationMs: Math.round(performance.now() - t0),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        name: 'download-queue-history',
        pass: false,
        summary: `Failed to read download_queue: ${msg}`,
        details: { error: msg },
        durationMs: Math.round(performance.now() - t0),
      };
    }
  },
};

export default mod;
