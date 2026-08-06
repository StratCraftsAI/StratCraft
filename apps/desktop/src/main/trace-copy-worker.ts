/**
 * TICKET_1123_2 / TICKET_1125 P0-2: Standalone child-process worker for
 * DuckDB parquet COPY jobs.
 *
 * Forked by the `duckdb-copy-child` service. Runs a batch of DuckDB COPY
 * SQL statements against one in-memory instance, fsyncs each output part
 * file, then exits. Memory isolation: the OS reclaims the entire address
 * space (including glibc malloc arenas) when this process exits.
 *
 * Protocol:
 *   Main -> Worker: { jobs: Array<{ sql: string; partPath: string }> }
 *   Worker -> Main: { ok: true, rowCounts: number[] }
 *                 | { ok: false, error: string, failedIndex?: number }
 *
 * `rowCounts[i]` is the row count of `jobs[i].partPath` after the COPY
 * (read from parquet metadata — no data scan).
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { openSync, fsyncSync, closeSync } from 'node:fs';

interface CopyJob {
  sql: string;
  partPath: string;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

process.on('message', async (msg: { jobs: CopyJob[] }) => {
  let failedIndex: number | undefined;
  try {
    if (!Array.isArray(msg.jobs) || msg.jobs.length === 0) {
      throw new Error('duckdb-copy-worker: message must carry a non-empty jobs array');
    }

    const inst = await DuckDBInstance.create(':memory:');
    const conn = await inst.connect();
    const rowCounts: number[] = [];
    try {
      for (let i = 0; i < msg.jobs.length; i++) {
        failedIndex = i;
        const job = msg.jobs[i];
        await conn.run(job.sql);

        const fd = openSync(job.partPath, 'r');
        try { fsyncSync(fd); } finally { closeSync(fd); }

        const countReader = await conn.runAndReadAll(
          `SELECT COUNT(*) AS cnt FROM read_parquet(${quoteLiteral(job.partPath)})`,
        );
        const cols = countReader.getColumnsObjectJS() as { cnt?: Array<number | bigint> };
        rowCounts.push(Number(cols.cnt?.[0] ?? 0));
      }
    } finally {
      try { conn.closeSync(); } catch { /* native cleanup */ }
      try { inst.closeSync(); } catch { /* native cleanup */ }
    }

    process.send!({ ok: true, rowCounts });
  } catch (err) {
    process.send!({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...(failedIndex !== undefined ? { failedIndex } : {}),
    });
  }
  process.exit(0);
});
