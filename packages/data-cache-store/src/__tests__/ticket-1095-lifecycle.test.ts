/**
 * TICKET_1095: Imported package lifecycle management tests.
 *
 * Tests for listImportedPackageSummaries, buildImportedPackageCoverageReport,
 * and coverageReportToCsv using the same structural fake approach as the
 * existing data-cache-store tests.
 */

import { describe, it, expect } from 'vitest';
import {
  listImportedPackageSummaries,
  buildImportedPackageCoverageReport,
  coverageReportToCsv,
  type SqliteDatabase,
} from '../data-cache-store';

interface Handler {
  match: (sql: string) => boolean;
  get?: (params: unknown[]) => unknown;
  all?: (params: unknown[]) => unknown[];
}

function fakeDb(handlers: Handler[]): SqliteDatabase {
  return {
    prepare(sql: string) {
      const h = handlers.find((x) => x.match(sql));
      return {
        get(...params: unknown[]) {
          if (!h?.get) throw new Error(`no get handler for: ${sql}`);
          return h.get(params);
        },
        all(...params: unknown[]) {
          if (!h?.all) throw new Error(`no all handler for: ${sql}`);
          return h.all(params);
        },
      };
    },
  };
}

const forexPkg = {
  package_name: 'forex',
  adjust_mode: 'none',
  source_dialect: 'parquet',
  created_at: 1000,
  calendar_padding_ratio_json: '{}',
  archival_cadence: 'monthly_archive',
  asset_class: 'forex',
};

const cryptoPkg = {
  package_name: 'crypto_data',
  adjust_mode: 'none',
  source_dialect: 'csv',
  created_at: 2000,
  calendar_padding_ratio_json: '{}',
  archival_cadence: 'snapshot',
  asset_class: 'crypto',
};

describe('listImportedPackageSummaries', () => {
  it('returns empty array when no packages exist', () => {
    const db = fakeDb([
      { match: (s) => s.includes('FROM imported_packages'), all: () => [] },
    ]);
    expect(listImportedPackageSummaries(db)).toEqual([]);
  });

  it('derives summary from data_cache_files aggregation for single package', () => {
    const db = fakeDb([
      { match: (s) => s.includes('FROM imported_packages'), all: () => [forexPkg] },
      {
        match: (s) => s.includes('GROUP BY provider'),
        all: () => [{
          provider: 'forex',
          file_count: 420,
          symbol_count: 60,
          interval_count: 7,
          total_rows: 100000,
          min_ts: 959558400000,
          max_ts: 1748476800000,
          last_updated_at: '2026-06-10T00:00:00Z',
        }],
      },
      {
        match: (s) => s.includes('SELECT provider, file_path FROM'),
        all: () => [
          { provider: 'forex', file_path: '/data/parquet/forex/EURUSD_1h.parquet' },
          { provider: 'forex', file_path: '/data/parquet/forex/GBPUSD_1h.parquet' },
        ],
      },
    ]);

    const sizes: Record<string, number> = {
      '/data/parquet/forex/EURUSD_1h.parquet': 1000000,
      '/data/parquet/forex/GBPUSD_1h.parquet': 500000,
    };
    const summaries = listImportedPackageSummaries(db, (p: string) => sizes[p] ?? 0);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      packageName: 'forex',
      assetClass: 'forex',
      fileCount: 420,
      symbolCount: 60,
      intervalCount: 7,
      totalRows: 100000,
      totalSizeBytes: 1500000,
      firstTimestamp: 959558400000,
      lastTimestamp: 1748476800000,
      lastUpdatedAt: '2026-06-10T00:00:00Z',
    });
  });

  it('handles two same-asset-class packages with distinct summaries', () => {
    const forexA = { ...forexPkg, package_name: 'forex_a' };
    const forexB = { ...forexPkg, package_name: 'forex_b' };

    const db = fakeDb([
      { match: (s) => s.includes('FROM imported_packages'), all: () => [forexA, forexB] },
      {
        match: (s) => s.includes('GROUP BY provider'),
        all: () => [
          { provider: 'forex_a', file_count: 10, symbol_count: 5, interval_count: 2, total_rows: 5000, min_ts: 1000, max_ts: 2000, last_updated_at: null },
          { provider: 'forex_b', file_count: 20, symbol_count: 10, interval_count: 3, total_rows: 10000, min_ts: 3000, max_ts: 4000, last_updated_at: null },
        ],
      },
      {
        match: (s) => s.includes('SELECT provider, file_path FROM'),
        all: () => [],
      },
    ]);

    const summaries = listImportedPackageSummaries(db, () => 0);
    expect(summaries).toHaveLength(2);
    expect(summaries[0].packageName).toBe('forex_a');
    expect(summaries[0].fileCount).toBe(10);
    expect(summaries[1].packageName).toBe('forex_b');
    expect(summaries[1].fileCount).toBe(20);
  });

  it('handles non-forex asset class packages', () => {
    const db = fakeDb([
      { match: (s) => s.includes('FROM imported_packages'), all: () => [cryptoPkg] },
      {
        match: (s) => s.includes('GROUP BY provider'),
        all: () => [{
          provider: 'crypto_data',
          file_count: 5,
          symbol_count: 3,
          interval_count: 1,
          total_rows: 1000,
          min_ts: 5000,
          max_ts: 6000,
          last_updated_at: null,
        }],
      },
      { match: (s) => s.includes('SELECT provider, file_path FROM'), all: () => [] },
    ]);

    const summaries = listImportedPackageSummaries(db, () => 0);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].assetClass).toBe('crypto');
    expect(summaries[0].symbolCount).toBe(3);
  });

  it('returns zero counts for package with no data_cache_files', () => {
    const db = fakeDb([
      { match: (s) => s.includes('FROM imported_packages'), all: () => [forexPkg] },
      { match: (s) => s.includes('GROUP BY provider'), all: () => [] },
      { match: (s) => s.includes('SELECT provider, file_path FROM'), all: () => [] },
    ]);

    const summaries = listImportedPackageSummaries(db, () => 0);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      fileCount: 0,
      symbolCount: 0,
      intervalCount: 0,
      totalRows: 0,
      totalSizeBytes: 0,
      firstTimestamp: null,
      lastTimestamp: null,
      lastUpdatedAt: null,
    });
  });
});

describe('buildImportedPackageCoverageReport', () => {
  it('builds report from data_cache_files completeness and missing_days', () => {
    const db = fakeDb([
      {
        match: (s) => s.includes('FROM data_cache_files') && s.includes('completeness'),
        all: () => [
          { symbol: 'EURUSD', interval: '1h', row_count: 500, first_timestamp: 1000, last_timestamp: 2000, completeness: 0.95, missing_days: '["2026-01-15","2026-02-20"]' },
          { symbol: 'EURUSD', interval: '1d', row_count: 100, first_timestamp: 1000, last_timestamp: 2000, completeness: 1.0, missing_days: null },
          { symbol: 'GBPUSD', interval: '1h', row_count: 480, first_timestamp: 1000, last_timestamp: 2000, completeness: 0.90, missing_days: '["2026-03-01"]' },
        ],
      },
    ]);

    const report = buildImportedPackageCoverageReport(db, 'forex');
    expect(report.packageName).toBe('forex');
    expect(report.totalSymbols).toBe(2);
    expect(report.totalIntervals).toBe(2);
    expect(report.entries).toHaveLength(3);
    expect(report.avgCompleteness).toBeCloseTo((0.95 + 1.0 + 0.90) / 3, 4);
    expect(report.entries[0].missingDays).toEqual(['2026-01-15', '2026-02-20']);
    expect(report.entries[1].missingDays).toEqual([]);
    expect(report.entries[2].missingDays).toEqual(['2026-03-01']);
  });

  it('returns empty report for package with no files', () => {
    const db = fakeDb([
      {
        match: (s) => s.includes('FROM data_cache_files') && s.includes('completeness'),
        all: () => [],
      },
    ]);

    const report = buildImportedPackageCoverageReport(db, 'empty_pkg');
    expect(report.packageName).toBe('empty_pkg');
    expect(report.entries).toEqual([]);
    expect(report.totalSymbols).toBe(0);
    expect(report.totalIntervals).toBe(0);
    expect(report.avgCompleteness).toBe(0);
  });

  it('handles malformed missing_days gracefully', () => {
    const db = fakeDb([
      {
        match: (s) => s.includes('FROM data_cache_files') && s.includes('completeness'),
        all: () => [
          { symbol: 'X', interval: '1h', row_count: 1, first_timestamp: 1, last_timestamp: 2, completeness: 1.0, missing_days: 'not-json-at-all' },
        ],
      },
    ]);

    const report = buildImportedPackageCoverageReport(db, 'test');
    expect(report.entries[0].missingDays).toEqual(['not-json-at-all']);
  });
});

describe('coverageReportToCsv', () => {
  it('produces valid CSV with header and data rows', () => {
    const report = {
      packageName: 'forex',
      entries: [
        { symbol: 'EURUSD', interval: '1h', rowCount: 500, firstTimestamp: 1000, lastTimestamp: 2000, completeness: 0.95, missingDays: ['2026-01-15'] },
        { symbol: 'GBPUSD', interval: '1d', rowCount: 100, firstTimestamp: 3000, lastTimestamp: 4000, completeness: 1.0, missingDays: [] },
      ],
      totalSymbols: 2,
      totalIntervals: 2,
      avgCompleteness: 0.975,
    };

    const csv = coverageReportToCsv(report);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('package,symbol,interval,row_count,first_timestamp,last_timestamp,completeness,missing_days');
    expect(lines[1]).toBe('forex,EURUSD,1h,500,1000,2000,0.9500,"2026-01-15"');
    expect(lines[2]).toBe('forex,GBPUSD,1d,100,3000,4000,1.0000,');
    expect(lines).toHaveLength(3);
  });

  it('handles empty report', () => {
    const csv = coverageReportToCsv({
      packageName: 'empty',
      entries: [],
      totalSymbols: 0,
      totalIntervals: 0,
      avgCompleteness: 0,
    });
    expect(csv).toBe('package,symbol,interval,row_count,first_timestamp,last_timestamp,completeness,missing_days');
  });

  it('joins multiple missing days with semicolons', () => {
    const report = {
      packageName: 'test',
      entries: [
        { symbol: 'A', interval: '1h', rowCount: 1, firstTimestamp: 1, lastTimestamp: 2, completeness: 0.5, missingDays: ['2026-01-01', '2026-01-02', '2026-01-03'] },
      ],
      totalSymbols: 1,
      totalIntervals: 1,
      avgCompleteness: 0.5,
    };
    const csv = coverageReportToCsv(report);
    expect(csv).toContain('"2026-01-01;2026-01-02;2026-01-03"');
  });
});
