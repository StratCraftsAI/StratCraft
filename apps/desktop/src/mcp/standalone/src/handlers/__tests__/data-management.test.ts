/**
 * Unit tests for data-management handler functions.
 * TICKET_1235_11: T2 confirm enforcement at the handler layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDiscoverServiceApi, mockApiClient } = vi.hoisted(() => ({
  mockDiscoverServiceApi: vi.fn(),
  mockApiClient: {
    dataDeleteSegments: vi.fn(),
    dataRemovePackage: vi.fn(),
    dataClearCache: vi.fn(),
  },
}));

vi.mock('../../bridge/discovery', () => ({
  discoverServiceApi: mockDiscoverServiceApi,
}));

vi.mock('../../bridge/api-client', () => mockApiClient);

import {
  handleDeleteDataSegments,
  handleRemoveImportedPackage,
  handleClearDataCache,
  handleListDataSegments,
  handleGetCacheStats,
  handleListImportedPackages,
} from '../data-management';
import type Database from 'better-sqlite3';

const mockConfig = { baseUrl: 'http://localhost:19876', token: 'test-token' };

// TICKET_1276 P2 Batch C1: a structural fake of the better-sqlite3 slice so the
// three de-bridged Class-S reads can be exercised without a real DB. Each
// prepared statement dispatches by a stable SQL fragment.
function fakeDb(
  handlers: Array<{ match: (sql: string) => boolean; get?: () => unknown; all?: () => unknown[] }>,
): Database.Database {
  return {
    prepare(sql: string) {
      const h = handlers.find((x) => x.match(sql));
      return {
        get: () => (h?.get ? h.get() : undefined),
        all: () => (h?.all ? h.all() : []),
      };
    },
  } as unknown as Database.Database;
}

describe('handleDeleteDataSegments', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns isError when confirm is false -- no bridge call (AC1)', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);

    const result = await handleDeleteDataSegments({ segment_ids: [1, 2], confirm: false });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('confirm=true');
    expect(mockApiClient.dataDeleteSegments).not.toHaveBeenCalled();
  });

  it('proceeds to bridge when confirm is true (AC3)', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.dataDeleteSegments.mockResolvedValue({ success: true, data: { deleted: 2 } });

    const result = await handleDeleteDataSegments({ segment_ids: [1, 2], confirm: true });

    expect(result.isError).toBeUndefined();
    expect(mockApiClient.dataDeleteSegments).toHaveBeenCalledWith(mockConfig, { segment_ids: [1, 2], confirm: true });
  });

  it('returns isError when Electron not running', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);

    const result = await handleDeleteDataSegments({ segment_ids: [1], confirm: true });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not running');
  });
});

describe('handleRemoveImportedPackage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns isError when confirm is false -- no bridge call (AC1)', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);

    const result = await handleRemoveImportedPackage({ package_name: 'test-pkg', confirm: false });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('confirm=true');
    expect(mockApiClient.dataRemovePackage).not.toHaveBeenCalled();
  });

  it('proceeds to bridge when confirm is true (AC3)', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.dataRemovePackage.mockResolvedValue({ success: true, data: { removed: 'test-pkg' } });

    const result = await handleRemoveImportedPackage({ package_name: 'test-pkg', confirm: true });

    expect(result.isError).toBeUndefined();
    expect(mockApiClient.dataRemovePackage).toHaveBeenCalledWith(mockConfig, { package_name: 'test-pkg', confirm: true });
  });

  it('returns isError when Electron not running', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);

    const result = await handleRemoveImportedPackage({ package_name: 'test-pkg', confirm: true });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not running');
  });
});

describe('handleClearDataCache', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns isError when confirm is false -- no bridge call (AC1)', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);

    const result = await handleClearDataCache({ confirm: false });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('confirm=true');
    expect(mockApiClient.dataClearCache).not.toHaveBeenCalled();
  });

  it('proceeds to bridge when confirm is true (AC3)', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.dataClearCache.mockResolvedValue({ success: true, data: { cleared: true } });

    const result = await handleClearDataCache({ confirm: true });

    expect(result.isError).toBeUndefined();
    expect(mockApiClient.dataClearCache).toHaveBeenCalledWith(mockConfig, { confirm: true });
  });

  it('returns isError when Electron not running', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);

    const result = await handleClearDataCache({ confirm: true });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not running');
  });
});

// =============================================================================
// TICKET_1276 P2 Batch C1: the three Class-S reads are now DIRECT (single path,
// no bridge). They take a DB handle and never call discoverServiceApi.
// =============================================================================

describe('Class-S direct reads (de-bridged, TICKET_1276 P2 C1)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('handleListDataSegments reads data_cache_files directly, never the bridge', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig); // even with a bridge available
    const db = fakeDb([
      { match: (s) => s.includes('COUNT(*) AS count'), get: () => ({ count: 1 }) },
      {
        match: (s) => s.includes('SELECT * FROM data_cache_files'),
        all: () => [
          {
            id: 1, symbol: 'EURUSD', interval: '1h', provider: 'histdata',
            file_path: '/x.parquet', first_timestamp: 1, last_timestamp: 2,
            actual_first_timestamp: 1, actual_last_timestamp: 2, row_count: 10,
            source_type: 'base', base_file_id: null, updated_at: 't',
            completeness: 1, missing_days: null, codec: 'SNAPPY', content_revision: 1,
          },
        ],
      },
    ]);

    const result = await handleListDataSegments(db, {});
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.total).toBe(1);
    expect(payload.files[0].symbol).toBe('EURUSD');
    expect(mockDiscoverServiceApi).not.toHaveBeenCalled();
  });

  it('handleGetCacheStats aggregates directly, never the bridge', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    const db = fakeDb([
      { match: (s) => s.includes('totalFiles'), get: () => ({ totalFiles: 2, totalRows: 20, symbolCount: 1, providerCount: 1 }) },
      { match: (s) => s.includes('GROUP BY provider'), all: () => [] },
      { match: (s) => s.includes('SELECT DISTINCT interval'), all: () => [] },
      { match: (s) => s.includes('SELECT file_path'), all: () => [] },
    ]);

    const result = await handleGetCacheStats(db);
    expect(result.isError).toBeUndefined();
    const stats = JSON.parse(result.content[0].text);
    expect(stats.totalFiles).toBe(2);
    expect(mockDiscoverServiceApi).not.toHaveBeenCalled();
  });

  it('handleListImportedPackages reads imported_packages directly, never the bridge', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    const db = fakeDb([
      {
        match: (s) => s.includes('FROM imported_packages'),
        all: () => [
          {
            package_name: 'pkg', adjust_mode: 'none', source_dialect: 'csv',
            created_at: 1, calendar_padding_ratio_json: '{}', archival_cadence: 'snapshot', asset_class: 'forex',
          },
        ],
      },
    ]);

    const result = await handleListImportedPackages(db);
    expect(result.isError).toBeUndefined();
    const pkgs = JSON.parse(result.content[0].text);
    expect(pkgs[0].packageName).toBe('pkg');
    expect(mockDiscoverServiceApi).not.toHaveBeenCalled();
  });
});
