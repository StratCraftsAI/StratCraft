/**
 * @StratCraft/data-cache-store -- Electron-free data-cache read core.
 *
 * TICKET_1276 P2 Batch C1. The three storage-owned (Class-S) data-management
 * reads -- list data segments, cache stats, list imported packages -- read the
 * `data_cache_files` / `imported_packages` SQLite tables and stat parquet files
 * on disk. None of that logic is Electron-specific; the only Electron coupling
 * in the historical `DataCacheManager` methods was the singleton DB accessor.
 *
 * This module is the single owning-layer codebase for those reads:
 *   - Electron main (`DataCacheManager.listFiles/getCacheStats/
 *     listImportedPackages`) delegates here with `getDatabaseManager().getDb()`.
 *   - The MCP standalone server calls here directly with its own better-sqlite3
 *     handle (`db.ts:openDatabase`), so the answer is identical whether or not
 *     the Electron process is alive (TICKET_1276 AC4).
 *
 * The DB handle is INJECTED (minimal structural slice of better-sqlite3), so the
 * package carries no `electron` or `better-sqlite3` dependency of its own. File
 * sizes are read through an injected `statSize` fn so callers can supply their
 * own fs (and tests can stub it); it defaults to `fs.statSync().size`.
 *
 * NOTE (window pushdown, TICKET_919): these are METADATA reads -- row counts,
 * distinct providers/intervals, catalog rows. They are already bounded by
 * LIMIT / OFFSET at the SQL layer and never materialise parquet bar data, so
 * there is no time-window to push down. `getCacheStats` stats each cached file
 * by its absolute `file_path` (stored in the row); it does not read parquet
 * contents.
 */

import { statSync } from 'node:fs';

// =============================================================================
// Injected dependencies
// =============================================================================

/** Minimal structural slice of a better-sqlite3 Database (readonly reads). */
export interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
}

/**
 * File-size resolver. Returns the byte size of an absolute file path, or 0 when
 * the file cannot be stat'd (deleted out from under the cache row). Defaults to
 * `fs.statSync(path).size` with the same "0 on error" semantics the historical
 * `getCacheStats` used.
 */
export type StatSizeFn = (filePath: string) => number;

const defaultStatSize: StatSizeFn = (filePath: string): number => {
  try {
    return statSync(filePath).size;
  } catch {
    // File may have been deleted externally -- historical behaviour is to skip.
    return 0;
  }
};

// =============================================================================
// Public result shapes (mirror the historical DataCacheManager output)
// =============================================================================

export interface CacheFileRecord {
  id: number;
  symbol: string;
  interval: string;
  provider: string;
  filePath: string;
  firstTimestamp: number;
  lastTimestamp: number;
  actualFirstTimestamp: number | null;
  actualLastTimestamp: number | null;
  rowCount: number;
  sourceType: 'base' | 'aggregated';
  baseFileId: number | null;
  updatedAt: string;
  completeness: number;
  missingDaysJson: string | null;
  codec: string | null;
  contentRevision: number;
}

export interface CacheStats {
  totalFiles: number;
  totalRows: number;
  totalSizeBytes: number;
  symbolCount: number;
  providerCount: number;
  byProvider: Array<{ provider: string; files: number; rows: number; symbols: number }>;
  allIntervals: string[];
}

export interface ImportedPackageRecord {
  packageName: string;
  adjustMode: 'none' | 'qfq' | 'hfq';
  sourceDialect: string;
  createdAt: number;
  calendarPaddingRatio: Readonly<Record<string, number>>;
  archivalCadence: string;
  assetClass: string;
}

export interface PackageCoverageEntry {
  symbol: string;
  interval: string;
  rowCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  completeness: number;
  missingDays: string[];
}

export interface PackageCoverageReport {
  packageName: string;
  entries: PackageCoverageEntry[];
  totalSymbols: number;
  totalIntervals: number;
  avgCompleteness: number;
}

export interface ImportedPackageSummary extends ImportedPackageRecord {
  fileCount: number;
  symbolCount: number;
  intervalCount: number;
  totalRows: number;
  totalSizeBytes: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  lastUpdatedAt: string | null;
}

export interface ListCacheFilesFilters {
  provider?: string;
  symbol?: string;
  interval?: string;
  limit?: number;
  offset?: number;
}

// =============================================================================
// DB row shapes
// =============================================================================

interface CacheFileRow {
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
  base_file_id: number | null;
  updated_at: string;
  completeness: number | null;
  missing_days: string | null;
  codec: string | null;
  content_revision: number | null;
}

const DEFAULT_LIST_LIMIT = 100;

// =============================================================================
// Row mapping (mirrors DataCacheManager.rowToRecord)
// =============================================================================

function rowToRecord(row: CacheFileRow): CacheFileRecord {
  return {
    id: row.id,
    symbol: row.symbol,
    interval: row.interval,
    provider: row.provider,
    filePath: row.file_path,
    firstTimestamp: row.first_timestamp,
    lastTimestamp: row.last_timestamp,
    actualFirstTimestamp: row.actual_first_timestamp,
    actualLastTimestamp: row.actual_last_timestamp,
    rowCount: row.row_count,
    sourceType: row.source_type as 'base' | 'aggregated',
    baseFileId: row.base_file_id,
    updatedAt: row.updated_at,
    completeness: row.completeness ?? 1.0,
    missingDaysJson: row.missing_days ?? null,
    codec: row.codec ?? null,
    contentRevision: row.content_revision ?? 1,
  };
}

/**
 * TICKET_919_9 parity: parse the `calendar_padding_ratio_json` column
 * defensively. Any malformed value yields `{}` (which makes downstream
 * calendar-ratio reads fail loud rather than silently fall back to 1.0).
 * Per-key sanitisation drops non-finite / non-positive entries.
 */
function parseRatioJson(json: string | null | undefined): Readonly<Record<string, number>> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [interval, raw] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        out[interval] = raw;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// =============================================================================
// Public read functions
// =============================================================================

/**
 * List cache files (`data_cache_files`) with optional filters, newest first.
 * Returns the paginated slice plus the unpaginated total (for UI pagination).
 * Mirrors `DataCacheManager.listFiles`.
 */
export function listCacheFiles(
  db: SqliteDatabase,
  filters: ListCacheFilesFilters,
): { files: CacheFileRecord[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.provider) {
    conditions.push('provider = ?');
    params.push(filters.provider);
  }
  if (filters.symbol) {
    conditions.push('symbol LIKE ?');
    params.push(`%${filters.symbol}%`);
  }
  if (filters.interval) {
    conditions.push('interval = ?');
    params.push(filters.interval);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? DEFAULT_LIST_LIMIT;
  const offset = filters.offset ?? 0;

  const total = (db
    .prepare(`SELECT COUNT(*) AS count FROM data_cache_files ${where}`)
    .get(...params) as { count: number }).count;

  const rows = db
    .prepare(
      `SELECT * FROM data_cache_files ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as CacheFileRow[];

  return { files: rows.map(rowToRecord), total };
}

/**
 * Aggregate cache statistics across `data_cache_files`. Mirrors
 * `DataCacheManager.getCacheStats`. Total on-disk size is the sum of each
 * cached file's byte size, resolved via the injected `statSize` fn.
 */
export function getCacheStats(db: SqliteDatabase, statSize: StatSizeFn = defaultStatSize): CacheStats {
  const stats = db
    .prepare(
      `SELECT
         COUNT(*) AS totalFiles,
         COALESCE(SUM(row_count), 0) AS totalRows,
         COUNT(DISTINCT symbol) AS symbolCount,
         COUNT(DISTINCT provider) AS providerCount
       FROM data_cache_files`,
    )
    .get() as { totalFiles: number; totalRows: number; symbolCount: number; providerCount: number };

  const byProvider = db
    .prepare(
      `SELECT
         provider,
         COUNT(*) AS files,
         COALESCE(SUM(row_count), 0) AS rows,
         COUNT(DISTINCT symbol) AS symbols
       FROM data_cache_files
       GROUP BY provider`,
    )
    .all() as Array<{ provider: string; files: number; rows: number; symbols: number }>;

  const allIntervals = (db
    .prepare('SELECT DISTINCT interval FROM data_cache_files ORDER BY interval')
    .all() as Array<{ interval: string }>).map((r) => r.interval);

  const filePaths = db
    .prepare('SELECT file_path FROM data_cache_files')
    .all() as Array<{ file_path: string }>;
  let totalSizeBytes = 0;
  for (const { file_path } of filePaths) {
    totalSizeBytes += statSize(file_path);
  }

  return {
    totalFiles: stats.totalFiles,
    totalRows: stats.totalRows,
    totalSizeBytes,
    symbolCount: stats.symbolCount,
    providerCount: stats.providerCount,
    byProvider,
    allIntervals,
  };
}

/**
 * List every BYOD imported-package catalog row (`imported_packages`), newest
 * first. Mirrors `DataCacheManager.listImportedPackages`.
 */
export function listImportedPackages(db: SqliteDatabase): ImportedPackageRecord[] {
  const rows = db
    .prepare(
      `SELECT package_name, adjust_mode, source_dialect, created_at,
              calendar_padding_ratio_json, archival_cadence, asset_class
       FROM imported_packages
       ORDER BY created_at DESC`,
    )
    .all() as Array<{
    package_name: string;
    adjust_mode: string;
    source_dialect: string;
    created_at: number;
    calendar_padding_ratio_json: string;
    archival_cadence: string;
    asset_class: string;
  }>;

  return rows.map((row) => ({
    packageName: row.package_name,
    adjustMode: row.adjust_mode as 'none' | 'qfq' | 'hfq',
    sourceDialect: row.source_dialect,
    createdAt: row.created_at,
    calendarPaddingRatio: parseRatioJson(row.calendar_padding_ratio_json),
    archivalCadence: row.archival_cadence,
    assetClass: row.asset_class,
  }));
}

/**
 * TICKET_1095: Derive package summaries from `imported_packages` + aggregated
 * `data_cache_files` inventory. Size is computed from the referenced files via
 * `statSize`. No duplicated summary columns in `imported_packages`.
 */
export function listImportedPackageSummaries(
  db: SqliteDatabase,
  statSize: StatSizeFn = defaultStatSize,
): ImportedPackageSummary[] {
  const packages = listImportedPackages(db);
  if (packages.length === 0) return [];

  const aggRows = db
    .prepare(
      `SELECT provider,
              COUNT(*)                     AS file_count,
              COUNT(DISTINCT symbol)       AS symbol_count,
              COUNT(DISTINCT interval)     AS interval_count,
              SUM(row_count)               AS total_rows,
              MIN(first_timestamp)         AS min_ts,
              MAX(last_timestamp)          AS max_ts,
              MAX(updated_at)              AS last_updated_at
       FROM data_cache_files
       GROUP BY provider`,
    )
    .all() as Array<{
    provider: string;
    file_count: number;
    symbol_count: number;
    interval_count: number;
    total_rows: number;
    min_ts: number | null;
    max_ts: number | null;
    last_updated_at: string | null;
  }>;
  const aggByProvider = new Map(aggRows.map((r) => [r.provider, r]));

  const filePathRows = db
    .prepare(`SELECT provider, file_path FROM data_cache_files`)
    .all() as Array<{ provider: string; file_path: string }>;
  const sizeByProvider = new Map<string, number>();
  for (const row of filePathRows) {
    const prev = sizeByProvider.get(row.provider) ?? 0;
    sizeByProvider.set(row.provider, prev + statSize(row.file_path));
  }

  return packages.map((pkg) => {
    const agg = aggByProvider.get(pkg.packageName);
    return {
      ...pkg,
      fileCount: agg?.file_count ?? 0,
      symbolCount: agg?.symbol_count ?? 0,
      intervalCount: agg?.interval_count ?? 0,
      totalRows: agg?.total_rows ?? 0,
      totalSizeBytes: sizeByProvider.get(pkg.packageName) ?? 0,
      firstTimestamp: agg?.min_ts ?? null,
      lastTimestamp: agg?.max_ts ?? null,
      lastUpdatedAt: agg?.last_updated_at ?? null,
    };
  });
}

/**
 * TICKET_1095 AC15: Per-package coverage report using persisted completeness
 * and missing_days from data_cache_files (v107).
 */
export function buildImportedPackageCoverageReport(
  db: SqliteDatabase,
  packageName: string,
): PackageCoverageReport {
  const rows = db
    .prepare(
      `SELECT symbol, interval, row_count, first_timestamp, last_timestamp,
              completeness, missing_days
       FROM data_cache_files
       WHERE provider = ?
       ORDER BY symbol, interval`,
    )
    .all(packageName) as Array<{
    symbol: string;
    interval: string;
    row_count: number;
    first_timestamp: number;
    last_timestamp: number;
    completeness: number;
    missing_days: string | null;
  }>;

  const entries: PackageCoverageEntry[] = rows.map((r) => ({
    symbol: r.symbol,
    interval: r.interval,
    rowCount: r.row_count,
    firstTimestamp: r.first_timestamp,
    lastTimestamp: r.last_timestamp,
    completeness: r.completeness,
    missingDays: r.missing_days ? parseMissingDays(r.missing_days) : [],
  }));

  const symbols = new Set(entries.map((e) => e.symbol));
  const intervals = new Set(entries.map((e) => e.interval));
  const avgCompleteness =
    entries.length > 0
      ? entries.reduce((sum, e) => sum + e.completeness, 0) / entries.length
      : 0;

  return {
    packageName,
    entries,
    totalSymbols: symbols.size,
    totalIntervals: intervals.size,
    avgCompleteness,
  };
}

export function coverageReportToCsv(report: PackageCoverageReport): string {
  const header = 'package,symbol,interval,row_count,first_timestamp,last_timestamp,completeness,missing_days';
  const lines = report.entries.map((e) =>
    [
      report.packageName,
      e.symbol,
      e.interval,
      e.rowCount,
      e.firstTimestamp,
      e.lastTimestamp,
      e.completeness.toFixed(4),
      e.missingDays.length > 0 ? `"${e.missingDays.join(';')}"` : '',
    ].join(','),
  );
  return [header, ...lines].join('\n');
}

function parseMissingDays(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
}
