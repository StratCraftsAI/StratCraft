/**
 * Data Import Constants (TICKET_308 / TICKET_308_1 / TICKET_308_3, BYOD user-provided data)
 *
 * Centralizes the constants for the data import pipeline: supported source
 * dialects, DuckDB ATTACH extension names, ingest/cache paths, data package
 * manifest schema, the source timezone, and the verified TICKET_307 CN A-share
 * package shape.
 *
 * Per TICKET_179 (no magic numbers/strings): the import service references
 * these named constants rather than inlining table/column names.
 */

import {
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m,
  INTERVAL_1h, INTERVAL_1d,
} from './intervals';

// =============================================================================
// Ingest & Cache Paths (TICKET_308_3_1 D1)
// Relative to `app.getPath('userData')`.
// =============================================================================

/** Staging area where users drop package directories / .duckdb files for import. */
export const IMPORT_INBOX_DIR = 'data/import-inbox';

/** System-managed Parquet cache (output of imports and provider fetches). */
export const PARQUET_CACHE_DIR = 'data/parquet';

/**
 * DuckDB COPY codec -- must be in the intersection of all readers' supported
 * codecs. `@dsnp/parquetjs` supports SNAPPY/GZIP/LZO/BROTLI only (no ZSTD).
 * SNAPPY is the Parquet ecosystem default and fastest to decompress.
 * (TICKET_918)
 */
export const DUCKDB_PARQUET_COMPRESSION = 'snappy';

// =============================================================================
// Source Dialects
// =============================================================================

/**
 * Source database dialects the import supports. These map 1:1 onto DuckDB's
 * `sqlite` / `mysql` / `postgres` scanner extensions (all statically bundled
 * in the `@duckdb/node-api` prebuilt binary -- no INSTALL, no network).
 * `duckdb` is a native DuckDB file opened directly; `csv`/`parquet` use
 * read_csv()/read_parquet() scanners.
 *
 * Mirrors the `imported_packages.source_dialect` CHECK constraint
 * (migration v76 + v80 + future _308_3_2):
 * CHECK(source_dialect IN ('mysql','sqlite','postgres','csv','parquet','duckdb')).
 */
export const IMPORT_SOURCE_DIALECTS = ['mysql', 'sqlite', 'postgres', 'csv', 'parquet', 'duckdb'] as const;
export type ImportSourceDialect = (typeof IMPORT_SOURCE_DIALECTS)[number];

/**
 * Package-level adjustment (fuquan) modes a BYOD import may be declared under
 * (TICKET_308 Gate 1):
 *   - none (bu fuquan): raw traded prices.
 *   - qfq  (qian fuquan): forward-adjusted, anchored to the latest price.
 *   - hfq  (hou fuquan): backward-adjusted, anchored to the earliest price
 *     (append-stable; the standard choice for cumulative-return backtests).
 *
 * Adjustment is a PACKAGE-LEVEL property -- declared once at import time and
 * stored on the `imported_packages` catalog row, never inferred and never
 * pushed into the per-row OHLCVRow. Mirrors the `imported_packages.adjust_mode`
 * CHECK constraint (migration v76): CHECK(adjust_mode IN ('none','qfq','hfq')).
 */
export const IMPORT_ADJUST_MODES = ['none', 'qfq', 'hfq'] as const;
export type ImportAdjustMode = (typeof IMPORT_ADJUST_MODES)[number];

/**
 * TICKET_919_10: Publisher release schedule of an imported package.
 *
 * Distinguishes data sources whose latest bar is "a few minutes ago"
 * (`realtime`) from sources whose latest bar is "the last second of the
 * previous month, at best" (`monthly_archive`). The orchestrator's
 * window-end anchor depends on this fact -- `Date.now()` is wrong for any
 * cadence other than `realtime`, by exactly the publisher-lag amount
 * (up to ~45 days for a monthly archive queried on the 14th).
 *
 * Mirrors the `imported_packages.archival_cadence` CHECK constraint
 * (migration v86): CHECK(archival_cadence IN
 * ('monthly_archive','weekly_archive','daily_eod','snapshot','realtime')).
 *
 * Semantics:
 *   - monthly_archive: previous month released mid-next-month; current
 *     month never present (HistData CSV, Dukascopy month dumps, EOD
 *     Historical month bundles).
 *   - weekly_archive : previous week released early next week (rare).
 *   - daily_eod      : previous trading day released after market close
 *     (EOD Historical daily bundles).
 *   - snapshot       : one-shot user CSV -- whatever is in the file is
 *     the universe of fact; no future updates expected (default for
 *     hand-curated parquet, research dumps).
 *   - realtime       : streaming / sub-minute-fresh source; imported
 *     for offline use but anchored to wall-clock like a live provider.
 */
export const IMPORTED_ARCHIVAL_CADENCES = [
  'monthly_archive',
  'weekly_archive',
  'daily_eod',
  'snapshot',
  'realtime',
] as const;
export type ArchivalCadence = (typeof IMPORTED_ARCHIVAL_CADENCES)[number];

/**
 * Dialect-level default cadence. The dialect alone does not know whether
 * a CSV is a HistData monthly archive or a one-shot research dump, so the
 * conservative default is `snapshot` -- a user importing a one-off file
 * must not silently inherit "wait for next month's archive" behaviour.
 *
 * Importer flows that *do* know the source's release cadence (HistData /
 * Dukascopy parquet) pass `archivalCadence: 'monthly_archive'` explicitly
 * to `registerImportedPackage`. The dialect default is the fallback,
 * not the truth.
 */
export const DIALECT_ARCHIVAL_DEFAULT: Record<ImportSourceDialect, ArchivalCadence> = {
  mysql: 'snapshot',
  sqlite: 'snapshot',
  postgres: 'snapshot',
  csv: 'snapshot',
  parquet: 'snapshot',
  duckdb: 'snapshot',
};

/**
 * Database dialects that use `ATTACH ... (TYPE ...)` in DuckDB.
 * csv/parquet use read_csv()/read_parquet() scanners instead.
 */
export type ImportDatabaseDialect = 'mysql' | 'sqlite' | 'postgres';
export const IMPORT_DUCKDB_ATTACH_TYPE: Record<ImportDatabaseDialect, string> = {
  mysql: 'mysql',
  sqlite: 'sqlite',
  postgres: 'postgres',
};

/**
 * IANA timezone the TICKET_307 CN A-share `trade_time` wall-clock is expressed
 * in. The source stores naive Beijing wall-clock datetimes; converting through
 * `timezone('Asia/Shanghai', ...)` yields the true UTC instant (e.g. a 09:30
 * CST bar -> 01:30 UTC), matching the canonical "epoch SECONDS UTC" contract
 * deterministically regardless of host timezone.
 */
export const IMPORT_SOURCE_TIMEZONE = 'Asia/Shanghai';

/**
 * The verified physical/logical shape of the TICKET_307 800 GB CN A-share
 * MySQL package. Confirmed against the package's `lishi-shuju-yuan-biao-jiegou.sql (historical-data source table schema)` and the
 * reference `mysql_provider.py` canonical read:
 *
 *   SELECT code, trade_time AS dt, open, high, low, close, vol, amount
 *   FROM `<dat_*>` WHERE code = %s AND trade_time >= %s AND trade_time <= %s
 *   ORDER BY trade_time ASC
 *
 * Notes:
 *   - The volume column is `vol`, NOT `volume`.
 *   - `amount` exists in the source but has no canonical home and is dropped.
 *   - `dat_10mins` is intentionally NOT mapped: StratCraft has no canonical
 *     `10m` interval (see `INTERVAL_MINUTES` in ./intervals.ts), so a `10m`
 *     cache file could never be selected. The other six tables map onto the
 *     canonical intervals `1m/5m/15m/30m/1h/1d`.
 */
export const TICKET_307_PACKAGE_SHAPE = {
  codeColumn: 'code',
  timeColumn: 'trade_time',
  openColumn: 'open',
  highColumn: 'high',
  lowColumn: 'low',
  closeColumn: 'close',
  volumeColumn: 'vol',
  tables: [
    { sourceTable: 'dat_1mins', interval: INTERVAL_1m },
    { sourceTable: 'dat_5mins', interval: INTERVAL_5m },
    { sourceTable: 'dat_15mins', interval: INTERVAL_15m },
    { sourceTable: 'dat_30mins', interval: INTERVAL_30m },
    { sourceTable: 'dat_60mins', interval: INTERVAL_1h },
    { sourceTable: 'dat_day', interval: INTERVAL_1d },
  ],
} as const;

// =============================================================================
// Data Package Manifest (TICKET_308_3_1 D2 / D3 / D5)
// =============================================================================

export type DataPackageAssetClass = 'forex' | 'equity' | 'crypto' | 'commodity' | 'index';

export interface DataPackageSchema {
  timestampColumn: string;
  timestampUnit: 'epoch_seconds' | 'epoch_ms' | 'epoch_ns' | 'iso8601';
  columns: string[];
}

export interface DataPackageDuckDbTable {
  tableName: string;
  symbol: string;
  interval: string;
  query?: string;
}

export interface DataPackageManifest {
  name: string;
  version?: string;
  description?: string;
  source?: string;
  sourceDialect: ImportSourceDialect;
  adjustMode: ImportAdjustMode;
  assetClass?: DataPackageAssetClass;
  timezone?: string;
  schema?: DataPackageSchema;
  filePattern?: string;
  intervals?: string[];
  symbols?: string[];
  tables?: DataPackageDuckDbTable[];
  /**
   * TICKET_919_10: publisher release cadence. Optional in the manifest
   * (back-compat with existing one-shot CSV manifests); when present
   * the importer propagates it to `imported_packages.archival_cadence`.
   * HistData / Dukascopy export tools that produce a parquet directory
   * SHOULD write `"archivalCadence": "monthly_archive"` here so the
   * orchestrator's window-end helper floors discovery windows to the
   * cadence boundary instead of wall-clock. Absent => the import
   * service falls back to the IPC payload's `archivalCadence`, then to
   * `DIALECT_ARCHIVAL_DEFAULT[sourceDialect]`.
   */
  archivalCadence?: ArchivalCadence;
}

export const DATA_PACKAGE_DEFAULTS = {
  version: '1.0.0',
  filePattern: '{SYMBOL}_{INTERVAL}.parquet',
  schema: {
    timestampColumn: 'timestamp',
    timestampUnit: 'epoch_seconds' as const,
    columns: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
  },
} as const;

export const DATA_PACKAGE_MANIFEST_FILENAME = 'manifest.json';

/** Parses the default `{SYMBOL}_{INTERVAL}.parquet` filename convention. */
export const PARQUET_FILENAME_PATTERN = /^(.+)_(1m|5m|15m|30m|1h|4h|1d)\.parquet$/;
