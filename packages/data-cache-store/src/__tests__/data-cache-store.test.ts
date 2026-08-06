/**
 * TICKET_1276 P2 Batch C1 -- data-cache read core unit tests.
 *
 * Uses a hand-rolled structural fake of the better-sqlite3 slice so the package
 * carries no better-sqlite3 dependency. Each `prepare(sql)` returns a statement
 * whose `get`/`all` are dispatched by matching a stable SQL fragment, so the
 * tests assert the exact SQL the core emits AND the row -> record mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  listCacheFiles,
  getCacheStats,
  listImportedPackages,
  type SqliteDatabase,
} from '../data-cache-store';

interface Handler {
  match: (sql: string) => boolean;
  get?: (params: unknown[]) => unknown;
  all?: (params: unknown[]) => unknown[];
}

function fakeDb(handlers: Handler[]): SqliteDatabase & { calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    prepare(sql: string) {
      const h = handlers.find((x) => x.match(sql));
      return {
        get(...params: unknown[]) {
          calls.push({ sql, params });
          if (!h?.get) throw new Error(`no get handler for: ${sql}`);
          return h.get(params);
        },
        all(...params: unknown[]) {
          calls.push({ sql, params });
          if (!h?.all) throw new Error(`no all handler for: ${sql}`);
          return h.all(params);
        },
      };
    },
  };
}

const sampleRow = {
  id: 7,
  symbol: 'EURUSD',
  interval: '1h',
  provider: 'histdata',
  file_path: '/data/parquet/histdata/EURUSD_1h.parquet',
  first_timestamp: 1000,
  last_timestamp: 2000,
  actual_first_timestamp: 1000,
  actual_last_timestamp: 1900,
  row_count: 500,
  source_type: 'base',
  base_file_id: null,
  updated_at: '2026-07-20T00:00:00Z',
  completeness: 0.9,
  missing_days: null,
  codec: 'SNAPPY',
  content_revision: 3,
};

describe('listCacheFiles', () => {
  it('maps rows to records and returns the total', () => {
    const db = fakeDb([
      { match: (s) => s.includes('COUNT(*) AS count'), get: () => ({ count: 42 }) },
      { match: (s) => s.includes('SELECT * FROM data_cache_files'), all: () => [sampleRow] },
    ]);
    const { files, total } = listCacheFiles(db, {});
    expect(total).toBe(42);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      id: 7,
      symbol: 'EURUSD',
      interval: '1h',
      provider: 'histdata',
      filePath: '/data/parquet/histdata/EURUSD_1h.parquet',
      actualLastTimestamp: 1900,
      rowCount: 500,
      sourceType: 'base',
      completeness: 0.9,
      codec: 'SNAPPY',
      contentRevision: 3,
    });
  });

  it('applies default limit/offset and no WHERE when unfiltered', () => {
    const db = fakeDb([
      { match: (s) => s.includes('COUNT(*) AS count'), get: () => ({ count: 0 }) },
      { match: (s) => s.includes('SELECT * FROM data_cache_files'), all: () => [] },
    ]);
    listCacheFiles(db, {});
    const listCall = db.calls.find((c) => c.sql.includes('SELECT * FROM'))!;
    expect(listCall.sql).not.toContain('WHERE');
    // default limit 100, offset 0 appended after the (empty) filter params
    expect(listCall.params).toEqual([100, 0]);
  });

  it('builds WHERE from provider/symbol/interval filters with LIKE on symbol', () => {
    const db = fakeDb([
      { match: (s) => s.includes('COUNT(*) AS count'), get: () => ({ count: 1 }) },
      { match: (s) => s.includes('SELECT * FROM data_cache_files'), all: () => [] },
    ]);
    listCacheFiles(db, { provider: 'histdata', symbol: 'EUR', interval: '1h', limit: 10, offset: 5 });
    const listCall = db.calls.find((c) => c.sql.includes('SELECT * FROM'))!;
    expect(listCall.sql).toContain('provider = ?');
    expect(listCall.sql).toContain('symbol LIKE ?');
    expect(listCall.sql).toContain('interval = ?');
    expect(listCall.params).toEqual(['histdata', '%EUR%', '1h', 10, 5]);
  });

  it('defaults nullable columns (completeness/codec/contentRevision)', () => {
    const nullRow = { ...sampleRow, completeness: null, missing_days: null, codec: null, content_revision: null };
    const db = fakeDb([
      { match: (s) => s.includes('COUNT(*) AS count'), get: () => ({ count: 1 }) },
      { match: (s) => s.includes('SELECT * FROM data_cache_files'), all: () => [nullRow] },
    ]);
    const { files } = listCacheFiles(db, {});
    expect(files[0].completeness).toBe(1.0);
    expect(files[0].codec).toBeNull();
    expect(files[0].contentRevision).toBe(1);
  });
});

describe('getCacheStats', () => {
  it('aggregates counts, byProvider, intervals and sums file sizes via statSize', () => {
    const db = fakeDb([
      {
        match: (s) => s.includes('COUNT(*) AS totalFiles'),
        get: () => ({ totalFiles: 3, totalRows: 1500, symbolCount: 2, providerCount: 1 }),
      },
      {
        match: (s) => s.includes('GROUP BY provider'),
        all: () => [{ provider: 'histdata', files: 3, rows: 1500, symbols: 2 }],
      },
      {
        match: (s) => s.includes('SELECT DISTINCT interval'),
        all: () => [{ interval: '1h' }, { interval: '4h' }],
      },
      {
        match: (s) => s.includes('SELECT file_path FROM data_cache_files'),
        all: () => [{ file_path: '/a.parquet' }, { file_path: '/b.parquet' }],
      },
    ]);
    const sizes: Record<string, number> = { '/a.parquet': 100, '/b.parquet': 250 };
    const stats = getCacheStats(db, (p) => sizes[p] ?? 0);
    expect(stats).toEqual({
      totalFiles: 3,
      totalRows: 1500,
      totalSizeBytes: 350,
      symbolCount: 2,
      providerCount: 1,
      byProvider: [{ provider: 'histdata', files: 3, rows: 1500, symbols: 2 }],
      allIntervals: ['1h', '4h'],
    });
  });

  it('treats a failed stat (0 size) as a skipped file, not an error', () => {
    const db = fakeDb([
      {
        match: (s) => s.includes('COUNT(*) AS totalFiles'),
        get: () => ({ totalFiles: 1, totalRows: 1, symbolCount: 1, providerCount: 1 }),
      },
      { match: (s) => s.includes('GROUP BY provider'), all: () => [] },
      { match: (s) => s.includes('SELECT DISTINCT interval'), all: () => [] },
      { match: (s) => s.includes('SELECT file_path'), all: () => [{ file_path: '/missing.parquet' }] },
    ]);
    const stats = getCacheStats(db, () => 0);
    expect(stats.totalSizeBytes).toBe(0);
  });
});

describe('listImportedPackages', () => {
  it('maps catalog rows and parses the calendar ratio JSON defensively', () => {
    const db = fakeDb([
      {
        match: (s) => s.includes('FROM imported_packages'),
        all: () => [
          {
            package_name: 'my-pkg',
            adjust_mode: 'qfq',
            source_dialect: 'histdata_csv',
            created_at: 12345,
            calendar_padding_ratio_json: JSON.stringify({ '1h': 1.5, bad: -1, alsoBad: 'x' }),
            archival_cadence: 'monthly_archive',
            asset_class: 'forex',
          },
        ],
      },
    ]);
    const pkgs = listImportedPackages(db);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]).toMatchObject({
      packageName: 'my-pkg',
      adjustMode: 'qfq',
      sourceDialect: 'histdata_csv',
      createdAt: 12345,
      archivalCadence: 'monthly_archive',
      assetClass: 'forex',
    });
    // -1 and non-numeric dropped; only the valid positive ratio survives
    expect(pkgs[0].calendarPaddingRatio).toEqual({ '1h': 1.5 });
  });

  it('returns {} ratio for malformed JSON', () => {
    const db = fakeDb([
      {
        match: (s) => s.includes('FROM imported_packages'),
        all: () => [
          {
            package_name: 'p',
            adjust_mode: 'none',
            source_dialect: 'x',
            created_at: 1,
            calendar_padding_ratio_json: 'not json',
            archival_cadence: 'snapshot',
            asset_class: 'forex',
          },
        ],
      },
    ]);
    expect(listImportedPackages(db)[0].calendarPaddingRatio).toEqual({});
  });
});
