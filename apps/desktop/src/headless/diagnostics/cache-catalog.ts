import * as fs from 'fs';
import type { DiagModule, DiagResult } from '../types';
import { HeadlessBootstrap } from '../bootstrap';

interface CacheRow {
  id: number;
  symbol: string;
  interval: string;
  provider: string;
  file_path: string;
  first_timestamp: number;
  last_timestamp: number;
  actual_first_timestamp: number | null;
  actual_last_timestamp: number | null;
  row_count: number;
  source_type: string;
  updated_at: string;
  completeness: number | null;
  missing_days: string | null;
}

function epochSecondsToIso(ts: number): string {
  return new Date(ts * 1000).toISOString().split('T')[0];
}

const mod: DiagModule = {
  name: 'cache-catalog',
  description: 'data_cache_files rows -- same data the Data Management table shows (min_date, max_date, row_count, completeness)',

  async run(args): Promise<DiagResult> {
    const t0 = performance.now();
    const limit = typeof args.limit === 'number' ? args.limit : 200;
    const symbolFilter = typeof args.symbol === 'string' ? args.symbol : undefined;
    const intervalFilter = typeof args.interval === 'string' ? args.interval : undefined;
    const providerFilter = typeof args.provider === 'string' ? args.provider : undefined;

    try {
      await HeadlessBootstrap.init();

      const { getDatabaseManager } = await import('../../main/database/db-manager');
      const db = getDatabaseManager().getDb();

      const conditions: string[] = [];
      const params: unknown[] = [];
      if (symbolFilter)   { conditions.push('symbol = ?');   params.push(symbolFilter); }
      if (intervalFilter) { conditions.push('interval = ?'); params.push(intervalFilter); }
      if (providerFilter) { conditions.push('provider = ?'); params.push(providerFilter); }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `SELECT id, symbol, interval, provider, file_path,
                          first_timestamp, last_timestamp,
                          actual_first_timestamp, actual_last_timestamp,
                          row_count, source_type, updated_at,
                          completeness, missing_days
                   FROM data_cache_files ${where}
                   ORDER BY symbol, interval, provider
                   LIMIT ?`;
      params.push(limit);

      const rows = db.prepare(sql).all(...params) as CacheRow[];

      const enriched = rows.map(r => {
        const fileExists = fs.existsSync(r.file_path);
        let fileSize = 0;
        if (fileExists) {
          try { fileSize = fs.statSync(r.file_path).size; } catch { /* ok */ }
        }

        const startDate = epochSecondsToIso(r.first_timestamp);
        const endDate = epochSecondsToIso(r.last_timestamp);
        const actualStartDate = r.actual_first_timestamp != null ? epochSecondsToIso(r.actual_first_timestamp) : null;
        const actualEndDate = r.actual_last_timestamp != null ? epochSecondsToIso(r.actual_last_timestamp) : null;

        const missingDays = r.missing_days ? JSON.parse(r.missing_days) as number[] : [];

        return {
          id: r.id,
          symbol: r.symbol,
          interval: r.interval,
          provider: r.provider,
          startDate,
          endDate,
          actualStartDate,
          actualEndDate,
          rowCount: r.row_count,
          fileExists,
          fileSize,
          completeness: r.completeness ?? 1.0,
          missingDayCount: missingDays.length,
          missingDays: missingDays.map(d => new Date(d).toISOString().split('T')[0]),
          sourceType: r.source_type,
          updatedAt: r.updated_at,
        };
      });

      const totalCount = db.prepare(
        `SELECT COUNT(*) AS cnt FROM data_cache_files ${where}`
      ).get(...(conditions.length ? params.slice(0, -1) : [])) as { cnt: number };

      const incompleteCount = enriched.filter(r => r.completeness < 1.0).length;
      const missingFileCount = enriched.filter(r => !r.fileExists).length;

      const details: Record<string, unknown> = {};
      details.rows = enriched;
      details.rowCount = enriched.length;
      details.totalInDb = totalCount.cnt;
      details.incompleteCount = incompleteCount;
      details.missingFileCount = missingFileCount;
      details.filters = { symbol: symbolFilter, interval: intervalFilter, provider: providerFilter, limit };

      const problems: string[] = [];
      if (incompleteCount > 0) problems.push(`${incompleteCount} partial (completeness < 1.0)`);
      if (missingFileCount > 0) problems.push(`${missingFileCount} missing parquet files`);

      return {
        name: 'cache-catalog',
        pass: problems.length === 0,
        summary: problems.length
          ? `${totalCount.cnt} segments, ISSUES: ${problems.join('; ')}`
          : `${totalCount.cnt} segments, all complete, all files present`,
        details,
        durationMs: Math.round(performance.now() - t0),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        name: 'cache-catalog',
        pass: false,
        summary: `Failed to read data_cache_files: ${msg}`,
        details: { error: msg },
        durationMs: Math.round(performance.now() - t0),
      };
    }
  },
};

export default mod;
