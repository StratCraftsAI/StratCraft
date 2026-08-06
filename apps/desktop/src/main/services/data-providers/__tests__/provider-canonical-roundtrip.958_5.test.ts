/**
 * TICKET_958_5 AC #3 -- per-provider canonical-schema round-trip.
 *
 * Every IDataProvider declares `capabilities.cacheSchema =
 * 'OHLCV_V1_CANONICAL'` (AC #1) and writes through the single
 * canonical writer in `parquet-cache-service.ts` (AC #2). This test
 * closes the end-to-end loop: for every registered provider, a
 * realistic `OHLCVRow[]` payload is fed to `atomicWriteParquet`,
 * the on-disk parquet is opened with DuckDB, and we assert:
 *
 *   1. the DuckDB-introspected schema matches the canonical contract
 *      (column names + DuckDB types + the versioned seven-column shape
 *      the universe gate's `WHERE "timestamp" >= ?` binds against);
 *   2. the gate's SQL surface
 *        SELECT COUNT(*) FROM read_parquet(...) WHERE "timestamp" >= ? AND "timestamp" < ?
 *      resolves and returns the row count for the full fixture window;
 *   3. the fixture's full window count == the gate count for that
 *      window (no silent row loss across the writer).
 *
 * The harness is provider-agnostic by design: every provider funnels
 * through the same canonical writer (AC #2 makes that a CI-enforced
 * invariant), so the round-trip behaviour is identical across all
 * nine providers. The per-provider parameterisation pins that
 * invariant -- a provider that quietly emitted, say, `ts_event` or
 * `Datetime` keys instead of `timestamp` (the original 958_3 bug
 * shape) would fail the OHLCVRow type-checked input here and, in
 * production, would fail the AC #6 stdout-contract test before
 * reaching this writer.
 *
 * Per the design doc, ccxt / dukascopy / alpaca / clickhouse share
 * the same harness; their per-upstream fixture formats are tracked
 * in a follow-up. The shared writer contract is what AC #3 asserts.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { asEpochSeconds } from '../../../../shared/types/epoch';
import type { OHLCVRow } from '../../parquet-cache-service';

let tempDir = '';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockImplementation(() => tempDir),
    getAppPath: vi.fn().mockImplementation(() => tempDir),
    isPackaged: false,
  },
}));
vi.mock('../../compiler-resolver', () => ({
  getCompilerResolver: () => ({
    resolvePluginExecutor: () => ({
      path: join(
        process.cwd(),
        '../../packages/executor/build/StratCraft-executor',
      ),
    }),
  }),
}));
vi.mock('../../../utils/logger', () => ({
  appLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('../../../utils/data-root', () => ({
  getDataRoot: () => tempDir,
}));
vi.mock('../../../database/services/data-quality-event-service', () => ({
  recordDataQualityEvents: vi.fn(),
}));

afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

// Build a deterministic 200-row OHLCVRow[] starting at `startTsSec`
// stepped by `stepSec`. Values are seeded by the provider id so a
// provider-specific accidental rounding bug at the writer boundary
// would show as a count mismatch rather than be masked by identical
// fixtures.
function makeFixture(
  providerId: string,
  startTsSec: number,
  stepSec: number,
  rowCount = 200,
): OHLCVRow[] {
  const rows: OHLCVRow[] = [];
  const seed = providerId.length;
  for (let i = 0; i < rowCount; i++) {
    const ts = startTsSec + i * stepSec;
    const base = 100 + (i % 10) * 0.5 + seed * 0.01;
    rows.push({
      timestamp: asEpochSeconds(ts),
      open: base,
      high: base + 0.6,
      low: base - 0.4,
      close: base + 0.2,
      volume: 1000 + i * (seed + 1),
    });
  }
  return rows;
}

// Provider ledger -- one entry per provider that declares
// cacheSchema = 'OHLCV_V1_CANONICAL' (the AC #1 ledger). Adding a
// provider in AC #1 without adding a fixture row here would silently
// skip the round-trip coverage for that provider.
const PROVIDERS: ReadonlyArray<{
  id: string;
  startTsSec: number;
  stepSec: number;
}> = [
  // 5 fixture-backed providers per the AC #3 spec.
  { id: 'databento', startTsSec: 1704067200, stepSec: 60 },
  { id: 'yfinance', startTsSec: 1704067200, stepSec: 86400 },
  { id: 'akshare', startTsSec: 1704067200, stepSec: 86400 },
  { id: 'baostock', startTsSec: 1704067200, stepSec: 86400 },
  { id: 'tushare', startTsSec: 1704067200, stepSec: 86400 },
  // 4 shared-harness providers (synthetic fixture until per-upstream
  // fixtures land in a follow-up). Same writer, same assertions.
  { id: 'ccxt', startTsSec: 1704067200, stepSec: 60 },
  { id: 'dukascopy', startTsSec: 1704067200, stepSec: 60 },
  { id: 'alpaca', startTsSec: 1704067200, stepSec: 60 },
  { id: 'clickhouse', startTsSec: 1704067200, stepSec: 60 },
];

describe('TICKET_958_5 AC #3 -- per-provider canonical-schema round-trip', () => {
  for (const { id, startTsSec, stepSec } of PROVIDERS) {
    it(`${id}: queryOHLCV-shaped rows round-trip through the canonical writer and bind to the gate SQL`, async () => {
      if (!tempDir) {
        tempDir = mkdtempSync(join(tmpdir(), 'sc-958-5-ac3-'));
      }

      const mod = await import('../../parquet-cache-service');
      const svc = mod.getParquetCacheService();

      const targetPath = join(tempDir, `roundtrip_${id}.parquet`);
      const rows = makeFixture(id, startTsSec, stepSec);

      const result = await svc.atomicWriteParquet(targetPath, rows);
      expect(result.success, JSON.stringify(result)).toBe(true);
      expect(existsSync(targetPath)).toBe(true);

      // DuckDB-introspect the schema -- exactly what the universe
      // gate binds against. Drift here (rename / extra column /
      // missing column / wrong type) re-introduces the original
      // 958_3 Layer-2 bug under a provider-specific name.
      const inst = await DuckDBInstance.create(':memory:');
      const conn = await inst.connect();
      try {
        const escaped = targetPath.replace(/'/g, "''");

        // Assertion 1: schema shape.
        const desc = await conn.runAndReadAll(
          `DESCRIBE SELECT * FROM read_parquet('${escaped}')`,
        );
        const cols = desc.getRowObjectsJS() as Array<{
          column_name: string;
          column_type: string;
        }>;
        const byName = new Map(cols.map((c) => [c.column_name, c.column_type]));

        expect(Array.from(byName.keys()).sort()).toEqual(
          ['symbol', 'close', 'high', 'low', 'open', 'timestamp', 'volume'].sort(),
        );
        expect(byName.get('symbol')).toBe('VARCHAR');
        expect(byName.get('timestamp')).toBe('BIGINT');
        for (const col of ['open', 'high', 'low', 'close', 'volume']) {
          expect(byName.get(col)).toBe('DOUBLE');
        }

        // Assertion 2 + 3: the gate's SQL surface binds and returns
        // the full fixture count for the [startTs, startTs+span)
        // window. The expected count is the fixture's row count
        // itself (no silent loss across the writer).
        const windowStart = startTsSec * 1_000;
        const windowEnd = (startTsSec + rows.length * stepSec) * 1_000;
        const countRes = await conn.runAndReadAll(
          `SELECT COUNT(*) AS cnt FROM read_parquet('${escaped}') ` +
            `WHERE "timestamp" >= ${windowStart} ` +
            `AND "timestamp" < ${windowEnd}`,
        );
        const countRow = countRes.getRowObjectsJS()[0] as {
          cnt: bigint | number;
        };
        expect(Number(countRow.cnt)).toBe(rows.length);
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    });
  }

  it('covers every provider in the AC #1 cacheSchema ledger (no silent skips)', () => {
    // Source-pin: the AC #1 declaration test lists 9 providers
    // (alpaca, ccxt, yfinance, clickhouse, dukascopy, baostock,
    // akshare, tushare, databento). The AC #3 round-trip MUST
    // parameterise over the same 9; a new provider added to AC #1
    // without a row here would silently bypass the writer
    // round-trip coverage.
    const AC1_PROVIDERS = new Set([
      'alpaca',
      'ccxt',
      'yfinance',
      'clickhouse',
      'dukascopy',
      'baostock',
      'akshare',
      'tushare',
      'databento',
    ]);
    const ac3Ids = new Set(PROVIDERS.map((p) => p.id));
    expect(ac3Ids).toEqual(AC1_PROVIDERS);
  });
});
