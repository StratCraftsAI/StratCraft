import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../bootstrap', () => ({
  HeadlessBootstrap: {
    init: vi.fn().mockResolvedValue(undefined),
  },
}));

const prepareMock = vi.fn();
const mockDb = { prepare: prepareMock };

vi.mock('../../../main/database/db-manager', () => ({
  getDatabaseManager: () => ({ getDb: () => mockDb }),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({ size: 1024 }),
  };
});

import * as fs from 'fs';
import mod from '../cache-catalog';

function setupDb(rows: Record<string, unknown>[], totalCount: number) {
  prepareMock.mockImplementation((sql: string) => {
    if (sql.includes('COUNT(*)')) {
      return { get: (..._args: unknown[]) => ({ cnt: totalCount }) };
    }
    return { all: (..._args: unknown[]) => rows };
  });
}

describe('cache-catalog diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ size: 1024 } as fs.Stats);
  });

  it('reads data_cache_files rows and enriches with dates', async () => {
    const rows = [
      {
        id: 1, symbol: 'EURUSD', interval: '1h', provider: 'dukascopy',
        file_path: '/data/cache/EURUSD_1h.parquet',
        first_timestamp: 1050000000, last_timestamp: 1700000000,
        actual_first_timestamp: 1050000000, actual_last_timestamp: 1700000000,
        row_count: 100000, source_type: 'base', updated_at: '2026-06-28',
        completeness: 1.0, missing_days: null,
      },
    ];
    setupDb(rows, 1);

    const result = await mod.run({});
    expect(result.name).toBe('cache-catalog');
    expect(result.pass).toBe(true);
    expect(result.details.rowCount).toBe(1);

    const enriched = (result.details.rows as Record<string, unknown>[])[0];
    expect(enriched.symbol).toBe('EURUSD');
    expect(enriched.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(enriched.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(enriched.fileExists).toBe(true);
    expect(enriched.completeness).toBe(1.0);
  });

  it('flags incomplete segments', async () => {
    const rows = [
      {
        id: 1, symbol: 'GBPUSD', interval: '1h', provider: 'dukascopy',
        file_path: '/data/cache/GBPUSD_1h.parquet',
        first_timestamp: 1050000000, last_timestamp: 1700000000,
        actual_first_timestamp: null, actual_last_timestamp: null,
        row_count: 144534, source_type: 'base', updated_at: '2026-06-28',
        completeness: 0.9997, missing_days: JSON.stringify([1451606400000, 1609459200000]),
      },
    ];
    setupDb(rows, 1);

    const result = await mod.run({});
    expect(result.pass).toBe(false);
    expect(result.summary).toContain('1 partial');

    const enriched = (result.details.rows as Record<string, unknown>[])[0];
    expect(enriched.completeness).toBe(0.9997);
    expect(enriched.missingDayCount).toBe(2);
  });

  it('flags missing parquet files', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const rows = [
      {
        id: 1, symbol: 'AUDUSD', interval: '1h', provider: 'dukascopy',
        file_path: '/data/cache/gone.parquet',
        first_timestamp: 1050000000, last_timestamp: 1700000000,
        actual_first_timestamp: null, actual_last_timestamp: null,
        row_count: 50000, source_type: 'base', updated_at: '2026-06-28',
        completeness: 1.0, missing_days: null,
      },
    ];
    setupDb(rows, 1);

    const result = await mod.run({});
    expect(result.pass).toBe(false);
    expect(result.summary).toContain('1 missing parquet');
  });

  it('returns valid DiagResult shape', async () => {
    setupDb([], 0);

    const result = await mod.run({});
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('pass');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('details');
    expect(result).toHaveProperty('durationMs');
    expect(typeof result.durationMs).toBe('number');
  });

  it('applies symbol filter', async () => {
    setupDb([], 0);

    await mod.run({ symbol: 'EURUSD' });

    const selectCall = prepareMock.mock.calls.find(
      (c: string[]) => typeof c[0] === 'string' && c[0].includes('FROM data_cache_files'),
    );
    expect(selectCall).toBeDefined();
    expect(selectCall![0]).toContain('symbol = ?');
  });

  it('passes when all segments complete and files exist', async () => {
    const rows = [
      {
        id: 1, symbol: 'EURUSD', interval: '1h', provider: 'dukascopy',
        file_path: '/data/cache/EURUSD.parquet',
        first_timestamp: 1050000000, last_timestamp: 1700000000,
        actual_first_timestamp: 1050000000, actual_last_timestamp: 1700000000,
        row_count: 200000, source_type: 'base', updated_at: '2026-06-28',
        completeness: 1.0, missing_days: null,
      },
      {
        id: 2, symbol: 'GBPUSD', interval: '1h', provider: 'dukascopy',
        file_path: '/data/cache/GBPUSD.parquet',
        first_timestamp: 1050000000, last_timestamp: 1700000000,
        actual_first_timestamp: 1050000000, actual_last_timestamp: 1700000000,
        row_count: 180000, source_type: 'base', updated_at: '2026-06-28',
        completeness: 1.0, missing_days: null,
      },
    ];
    setupDb(rows, 2);

    const result = await mod.run({});
    expect(result.pass).toBe(true);
    expect(result.summary).toContain('all complete');
  });
});
