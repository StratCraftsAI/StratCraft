/**
 * Data Import Service (BYOD / user-provided data)
 *
 * TICKET_308_3: directory-based import of user-supplied data packages
 * (parquet / DuckDB / CSV) into the Parquet cache. Each (symbol, interval)
 * series is written as a `{symbol}_{interval}.parquet` file under a
 * package-named cache directory, then registered into `data_cache_files` +
 * `imported_packages` so the inventory/picker can enumerate it.
 *
 * TICKET_918_1: the legacy SQL database import path (MySQL/SQLite/PostgreSQL
 * via DuckDB ATTACH) was removed -- it was UI-hidden dead code since
 * TICKET_308_3_5. All imports now go through `importDataPackage` (directory)
 * or `registerParquetDirectory` (bulk-register in-place).
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { getParquetCacheService } from './parquet-cache-service';
import {
  runOhlcvDataPlane,
  type OhlcvDecisionMetadata,
} from './ohlcv-data-plane-client';
import { appLog } from '../utils/logger';
import { getDataCacheManager } from './data-cache-manager';
import { getDatabaseManager } from '../database/db-manager';
import {
  recordDataQualityEvents,
  type DataQualityEventInput,
} from '../database/services/data-quality-event-service';
import { DUCKDB_PARQUET_COMPRESSION } from '../../shared/constants/data-import';
import { INTERVAL_1d, intervalToMs } from '../../shared/constants/intervals';
import { resolveDataQualityAssetClass } from '../../shared/constants/data-quality';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import { MS_PER_SECOND } from '../../shared/constants/timing';
import {
  IMPORT_ADJUST_MODES,
  IMPORTED_ARCHIVAL_CADENCES,
  PARQUET_FILENAME_PATTERN,
  DATA_PACKAGE_MANIFEST_FILENAME,
  DATA_PACKAGE_DEFAULTS,
  type ImportSourceDialect,
  type ImportAdjustMode,
  type DataPackageManifest,
  type DataPackageDuckDbTable,
  type ArchivalCadence,
} from '../../shared/constants/data-import';
import {
  PROVIDER_YFINANCE, PROVIDER_CCXT, PROVIDER_DUKASCOPY, PROVIDER_ALPACA,
  PROVIDER_AKSHARE, PROVIDER_TUSHARE, PROVIDER_BAOSTOCK, PROVIDER_CLICKHOUSE,
} from '@StratCraft/types';

const importLog = {
  info: (msg: string, data?: unknown) => appLog.info(`[DataImport] ${msg}`, data),
  warn: (msg: string, data?: unknown) => appLog.warn(`[DataImport] ${msg}`, data),
  error: (msg: string, data?: unknown) => appLog.error(`[DataImport] ${msg}`, data),
};

const RESERVED_PACKAGE_NAMES = new Set([
  'parquet', 'base', 'imported-package',
  PROVIDER_YFINANCE, PROVIDER_CCXT, PROVIDER_DUKASCOPY, PROVIDER_ALPACA,
  PROVIDER_AKSHARE, PROVIDER_TUSHARE, PROVIDER_BAOSTOCK, PROVIDER_CLICKHOUSE,
]);

// =============================================================================
// Types
// =============================================================================

/** Per-(symbol, interval) result of a single COPY. */
export interface ImportedSeries {
  symbol: string;
  interval: string;
  filePath: string;
  rowCount: number;
  /** Unix epoch SECONDS (UTC) of the first/last bar; null when no rows. */
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  decisionId?: string;
  /** TICKET_1126 F2: bars excluded by the OHLC hard-invariant gate
   *  (each one has a `reject` data_quality_event row). */
  rejectedBarCount: number;
  /** TICKET_1126 F2: bars kept but flagged by the inter-bar jump gate
   *  (each one has a `suspect` data_quality_event row). */
  suspectBarCount: number;
}

// =============================================================================
// TICKET_308_3_2: Data Package Import (directory / DuckDB / CSV)
// =============================================================================

export interface DataPackageImportRequest {
  sourcePath: string;
  packageName: string;
  adjustMode: ImportAdjustMode;
  manifest?: DataPackageManifest;
  /**
   * TICKET_919_10: optional publisher-release-cadence override. Importer
   * flows that *know* the source's release schedule (HistData CSV /
   * Dukascopy parquet -- both monthly archives) MUST pass
   * 'monthly_archive' here so the orchestrator floors discovery windows
   * to the cadence boundary instead of `Date.now()`. Generic CSV /
   * parquet imports omit this and the service falls back to
   * `DIALECT_ARCHIVAL_DEFAULT[sourceDialect]` (= 'snapshot' for all
   * general-purpose dialects), preserving today's behaviour for
   * one-shot user CSVs.
   */
  archivalCadence?: ArchivalCadence;
}

export interface DataPackageImportProgress {
  phase: 'validating' | 'importing' | 'registering' | 'complete' | 'error';
  symbol?: string;
  interval?: string;
  seriesIndex?: number;
  seriesTotal?: number;
  seriesImported?: number;
  skippedFiles?: number;
  message?: string;
}

export type DataPackageProgressCallback = (progress: DataPackageImportProgress) => void;

export interface DataPackageImportControl {
  signal?: AbortSignal;
  onProgress?: DataPackageProgressCallback;
}

export interface DataPackageValidationError {
  file?: string;
  field?: string;
  message: string;
}

export interface DataPackageImportResult {
  packageName: string;
  sourceDialect: ImportSourceDialect;
  series: ImportedSeries[];
  skippedFiles: string[];
  validationErrors: DataPackageValidationError[];
}

// =============================================================================
// TICKET_308_3_3: Data Package Scan (preview without importing)
// =============================================================================

export interface DataPackageScanRequest {
  sourcePath: string;
  packageName?: string;
}

export interface DataPackageScanResult {
  packageName: string;
  sourceDialect: ImportSourceDialect;
  symbols: string[];
  intervals: string[];
  fileCount: number;
  totalSizeBytes: number;
  validationErrors: DataPackageValidationError[];
}

// =============================================================================
// DataImportService
// =============================================================================

class DataImportService {
  private async publishByodCandidate(args: {
    candidatePath: string;
    targetPath: string;
    symbol: string;
    firstTimestamp: number;
    lastTimestamp: number;
    interval: string;
    provider: string;
    providerOrAssetClass?: string;
    timestampUnit?: 's' | 'ms' | 'us' | 'ns';
    signal?: AbortSignal;
  }): Promise<OhlcvDecisionMetadata> {
    const qualityIntervalMs = intervalToMs(args.interval);
    if (qualityIntervalMs === null) {
      throw new Error(`Unsupported OHLCV quality interval: ${args.interval}`);
    }
    const decision = await runOhlcvDataPlane({
      operation: 'byod',
      inputs: [{
        path: args.candidatePath,
        projection: {
          fixedSymbol: args.symbol,
          timestampUnit: args.timestampUnit ?? 's',
        },
      }],
      window: {
        startMs: args.timestampUnit === 'ms'
          ? args.firstTimestamp
          : args.firstTimestamp * MS_PER_SECOND,
        endMs: args.timestampUnit === 'ms'
          ? args.lastTimestamp
          : args.lastTimestamp * MS_PER_SECOND,
      },
      outputPath: args.targetPath,
      qualityAction: 'drop_rows',
      qualityPolicy: {
        assetClass: resolveDataQualityAssetClass(args.providerOrAssetClass),
        intervalMs: qualityIntervalMs,
      },
    }, args.signal);
    const qualityEvents: DataQualityEventInput[] = decision.qualityEvents.map((event) => ({
      provider: args.provider,
      symbol: event.symbol,
      interval: args.interval,
      barTs: Math.floor(event.timestampMs / MS_PER_SECOND),
      rule: event.rule,
      severity: event.severity,
      original: event.original,
      source: 'data-import-service',
      message: `C++ OHLCV data plane ${event.rule}`,
    }));
    const omittedEventCount =
      decision.decisions.rejectedRows +
      decision.decisions.suspectRows -
      decision.qualityEvents.length;
    if (omittedEventCount > 0) {
      qualityEvents.push({
        provider: args.provider,
        symbol: args.symbol,
        interval: args.interval,
        barTs: null,
        rule: 'validation_summary',
        severity: 'suspect',
        source: 'data-import-service',
        message: `${omittedEventCount} additional C++ OHLCV quality events exceeded the detail cap`,
      });
    }
    recordDataQualityEvents(qualityEvents);
    return decision;
  }
  /**
   * Collect parquet files from a directory, including one level of subdirectories.
   * Supports both flat layout (`DIR/SYMBOL_1d.parquet`) and nested layout
   * (`DIR/SYMBOL/SYMBOL_1d.parquet`).
   * Returns paths relative to `dirPath`.
   */
  private collectParquetFiles(dirPath: string): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(dirPath)) {
      const full = join(dirPath, entry);
      const s = statSync(full);
      if (s.isFile() && entry.endsWith('.parquet')) {
        result.push(entry);
      } else if (s.isDirectory()) {
        for (const child of readdirSync(full)) {
          if (child.endsWith('.parquet') && statSync(join(full, child)).isFile()) {
            result.push(join(entry, child));
          }
        }
      }
    }
    return result;
  }

  async appendToPackage(opts: {
    packageName: string;
    sourcePath: string;
    symbolFilter?: string[];
    force?: boolean;
  }): Promise<{ appended: number; skipped: number; skippedSymbols: string[] }> {
    const cacheManager = getDataCacheManager();
    const pkg = cacheManager.getImportedPackage(opts.packageName);
    if (!pkg) {
      throw new Error(`Package '${opts.packageName}' does not exist. Use importDataPackage to create it first.`);
    }

    if (!existsSync(opts.sourcePath)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.sourcePathNotExist', { path: opts.sourcePath }));
    }

    const cacheService = getParquetCacheService();
    const packageDir = join(cacheService.getCacheDir(), opts.packageName);
    if (!existsSync(packageDir)) {
      mkdirSync(packageDir, { recursive: true });
    }

    const db = getDatabaseManager();
    const existingKeys = new Set(
      (db.prepare(
        `SELECT symbol || '|' || interval AS key FROM data_cache_files WHERE provider = ?`,
      ).all(opts.packageName) as Array<{ key: string }>).map((r) => r.key),
    );

    const stat = statSync(opts.sourcePath);
    let sourceFiles: string[];
    if (stat.isDirectory()) {
      sourceFiles = readdirSync(opts.sourcePath)
        .filter((f) => f.endsWith('.parquet'))
        .map((f) => join(opts.sourcePath, f));
    } else {
      sourceFiles = [opts.sourcePath];
    }

    let appended = 0;
    let skipped = 0;
    const skippedSymbols: string[] = [];

    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();

    try {
      for (const filePath of sourceFiles) {
        const match = basename(filePath).match(PARQUET_FILENAME_PATTERN);
        if (!match) {
          skipped++;
          continue;
        }
        const [, symbol, interval] = match;

        if (opts.symbolFilter && !opts.symbolFilter.includes(symbol)) {
          skipped++;
          skippedSymbols.push(symbol);
          continue;
        }

        const key = `${symbol}|${interval}`;
        if (existingKeys.has(key) && !opts.force) {
          skipped++;
          skippedSymbols.push(symbol);
          continue;
        }

        const targetPath = join(packageDir, basename(filePath));
        if (filePath !== targetPath) {
          copyFileSync(filePath, targetPath);
        }

        const reader = await conn.runAndReadAll(
          `SELECT COUNT(*) AS cnt,
                  MIN(timestamp) AS min_ts,
                  MAX(timestamp) AS max_ts
           FROM read_parquet('${filePath.replace(/'/g, "''")}')`,
        );
        const row = reader.getRowObjectsJS()[0] as {
          cnt: bigint | number;
          min_ts: bigint | number;
          max_ts: bigint | number;
        };
        const rowCount = Number(row.cnt);
        const firstTimestamp = Number(row.min_ts);
        const lastTimestamp = Number(row.max_ts);

        cacheManager.registerImportedFile({
          symbol,
          interval,
          packageName: opts.packageName,
          filePath: targetPath,
          firstTimestamp,
          lastTimestamp,
          rowCount,
        });

        existingKeys.add(key);
        appended++;
      }

      if (appended > 0) {
        cacheManager.registerImportedPackage({
          packageName: opts.packageName,
          adjustMode: pkg.adjustMode as ImportAdjustMode,
          sourceDialect: pkg.sourceDialect as ImportSourceDialect,
          archivalCadence: pkg.archivalCadence as ArchivalCadence,
          assetClass: pkg.assetClass,
        });
      }
    } finally {
      conn.closeSync();
      instance.closeSync();
    }

    importLog.info(
      `appendToPackage: package="${opts.packageName}" appended=${appended} skipped=${skipped}`,
    );

    return { appended, skipped, skippedSymbols };
  }

  scanDataPackage(req: DataPackageScanRequest): DataPackageScanResult {
    const sourcePath = req.sourcePath;
    if (!existsSync(sourcePath)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.sourcePathNotExist', { path: sourcePath }));
    }

    const defaultName = req.packageName?.trim() || basename(sourcePath).replace(/\.duckdb$/i, '') || 'imported-package';
    const manifest = this.resolveManifest(sourcePath, defaultName, 'none');
    const validationErrors = this.validateDataPackage(sourcePath, manifest);

    const stat = statSync(sourcePath);
    let fileCount = 0;
    let totalSizeBytes = 0;
    const symbols = new Set<string>();
    const intervals = new Set<string>();

    if (stat.isDirectory()) {
      const parquetFiles = this.collectParquetFiles(sourcePath);
      for (const relPath of parquetFiles) {
        const fStat = statSync(join(sourcePath, relPath));
        fileCount++;
        totalSizeBytes += fStat.size;
        const match = basename(relPath).match(PARQUET_FILENAME_PATTERN);
        if (match) {
          symbols.add(match[1]);
          intervals.add(match[2]);
        }
      }
      const csvFiles = readdirSync(sourcePath).filter(f => f.toLowerCase().endsWith('.csv'));
      for (const f of csvFiles) {
        fileCount++;
        totalSizeBytes += statSync(join(sourcePath, f)).size;
      }
      const duckdbFiles = readdirSync(sourcePath).filter(f => f.toLowerCase().endsWith('.duckdb'));
      for (const f of duckdbFiles) {
        fileCount++;
        totalSizeBytes += statSync(join(sourcePath, f)).size;
      }
    } else {
      fileCount = 1;
      totalSizeBytes = stat.size;
    }

    if (manifest.symbols) manifest.symbols.forEach((s) => symbols.add(s));
    if (manifest.intervals) manifest.intervals.forEach((i) => intervals.add(i));
    if (manifest.tables) {
      for (const t of manifest.tables) {
        symbols.add(t.symbol);
        intervals.add(t.interval);
      }
    }

    return {
      packageName: manifest.name || defaultName,
      sourceDialect: manifest.sourceDialect,
      symbols: Array.from(symbols).sort(),
      intervals: Array.from(intervals).sort(),
      fileCount,
      totalSizeBytes,
      validationErrors,
    };
  }

  /**
   * TICKET_308_2: Bulk-register pre-existing Parquet files in the cache dir
   * as an imported package. Scans `{cacheDir}/{packageName}/` for files
   * matching `{SYMBOL}_{interval}.parquet`, reads row count + timestamp range
   * via DuckDB, and upserts `data_cache_files` + `imported_packages` rows.
   *
   * Idempotent: re-running updates existing rows via ON CONFLICT upserts.
   */
  async registerParquetDirectory(opts: {
    packageName: string;
    adjustMode: ImportAdjustMode;
    sourceDialect: ImportSourceDialect;
    // TICKET_919_10: HistData / Dukascopy renderer flows declare
    // 'monthly_archive' here; absent => DIALECT_ARCHIVAL_DEFAULT.
    archivalCadence?: ArchivalCadence;
    assetClass?: string;
  }): Promise<{ registered: number; skipped: number }> {
    const cacheService = getParquetCacheService();
    const providerDir = join(cacheService.getCacheDir(), opts.packageName);

    if (!existsSync(providerDir)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.providerDirNotFound', { dir: providerDir }));
    }

    const files = readdirSync(providerDir).filter(f => f.endsWith('.parquet'));
    if (files.length === 0) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.noParquetInDir', { dir: providerDir }));
    }

    const INTERVAL_PATTERN = PARQUET_FILENAME_PATTERN;

    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    const cacheManager = getDataCacheManager();
    const db = getDatabaseManager();
    let registered = 0;
    let skipped = 0;

    try {
      const records: Array<{
        symbol: string;
        interval: string;
        filePath: string;
        rowCount: number;
        firstTimestamp: number;
        lastTimestamp: number;
      }> = [];

      for (const file of files) {
        const match = file.match(INTERVAL_PATTERN);
        if (!match) {
          importLog.warn(`Skipping unrecognized file: ${file}`);
          skipped++;
          continue;
        }

        const [, symbol, interval] = match;
        const filePath = join(providerDir, file);

        const reader = await conn.runAndReadAll(
          `SELECT count(*) AS n, min(timestamp) AS first_ts, max(timestamp) AS last_ts ` +
            `FROM read_parquet(${quoteLiteral(filePath)})`
        );
        const stat = reader.getRowObjectsJS()[0] ?? {};
        const rowCount = Number(stat.n ?? 0);

        if (rowCount === 0) {
          importLog.warn(`Skipping empty file: ${file}`);
          skipped++;
          continue;
        }

        const decision = await this.publishByodCandidate({
          candidatePath: filePath,
          targetPath: filePath,
          symbol,
          firstTimestamp: Number(stat.first_ts),
          lastTimestamp: Number(stat.last_ts),
          interval,
          provider: opts.packageName,
          providerOrAssetClass: 'forex',
        });
        const landed = {
          rowCount: decision.rowCount,
          firstTimestamp: decision.extent
            ? Math.floor(decision.extent.startMs / MS_PER_SECOND)
            : null,
          lastTimestamp: decision.extent
            ? Math.floor(decision.extent.endMs / MS_PER_SECOND)
            : null,
        };
        if (landed.rowCount === 0 || landed.firstTimestamp === null || landed.lastTimestamp === null) {
          importLog.warn(`Skipping file with no valid bars after OHLC gate: ${file}`);
          skipped++;
          continue;
        }

        records.push({
          symbol,
          interval,
          filePath,
          rowCount: landed.rowCount,
          firstTimestamp: landed.firstTimestamp,
          lastTimestamp: landed.lastTimestamp,
        });
      }

      const apply = db.transaction(() => {
        for (const rec of records) {
          cacheManager.registerImportedFile({
            symbol: rec.symbol,
            interval: rec.interval,
            packageName: opts.packageName,
            filePath: rec.filePath,
            firstTimestamp: rec.firstTimestamp,
            lastTimestamp: rec.lastTimestamp,
            rowCount: rec.rowCount,
          });
          registered++;
        }
        cacheManager.registerImportedPackage({
          packageName: opts.packageName,
          adjustMode: opts.adjustMode,
          sourceDialect: opts.sourceDialect,
          // TICKET_919_10: explicit cadence propagates to
          // imported_packages.archival_cadence; omitted => the cache
          // manager falls back to DIALECT_ARCHIVAL_DEFAULT.
          archivalCadence: opts.archivalCadence,
          assetClass: opts.assetClass,
        });
      });
      apply();

      importLog.info(
        `registerParquetDirectory: package="${opts.packageName}" ` +
          `registered=${registered} skipped=${skipped}`
      );
    } finally {
      conn.closeSync();
      instance.closeSync();
    }

    return { registered, skipped };
  }

  // ===========================================================================
  // TICKET_308_3_2: Manifest-aware data package import (directory / DuckDB / CSV)
  // ===========================================================================

  async importDataPackage(
    req: DataPackageImportRequest,
    control?: DataPackageImportControl,
  ): Promise<DataPackageImportResult> {
    if (!req.packageName || !req.packageName.trim()) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.packageNameEmpty'));
    }
    if (RESERVED_PACKAGE_NAMES.has(req.packageName.trim().toLowerCase())) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.packageNameReserved', { name: req.packageName.trim() }));
    }
    if (!IMPORT_ADJUST_MODES.includes(req.adjustMode)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.adjustModeRequired', { modes: IMPORT_ADJUST_MODES.join('/'), got: JSON.stringify(req.adjustMode) }));
    }
    if (!existsSync(req.sourcePath)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.sourcePathNotExist', { path: req.sourcePath }));
    }

    const manifest = req.manifest ?? this.resolveManifest(req.sourcePath, req.packageName, req.adjustMode);

    importLog.info(
      `importDataPackage start: package="${req.packageName}" dialect=${manifest.sourceDialect} ` +
        `source="${req.sourcePath}"`
    );

    control?.onProgress?.({ phase: 'validating' });

    const validationErrors = this.validateDataPackage(req.sourcePath, manifest);
    if (validationErrors.length > 0) {
      const msg = validationErrors.map((e) => `${e.file ?? 'package'}: ${e.message}`).join('; ');
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.validationFailed', { msg }));
    }

    this.throwIfCancelled(control);
    control?.onProgress?.({ phase: 'importing' });

    let result: DataPackageImportResult;

    switch (manifest.sourceDialect) {
      case 'parquet':
        result = await this.importParquetPackage(req, manifest, control);
        break;
      case 'duckdb':
        result = await this.importDuckDbPackage(req, manifest, control);
        break;
      case 'csv':
        result = await this.importCsvPackage(req, manifest, control);
        break;
      default:
        throw new Error(
          `sourceDialect "${manifest.sourceDialect}" is not supported. ` +
            `Supported dialects: parquet, duckdb, csv.`
        );
    }

    this.throwIfCancelled(control);
    control?.onProgress?.({ phase: 'registering' });

    this.registerDataPackageImport(result, req, manifest);

    control?.onProgress?.({
      phase: 'complete',
      seriesImported: result.series.length,
      skippedFiles: result.skippedFiles.length,
    });

    importLog.info(
      `importDataPackage complete: package="${req.packageName}" ` +
        `series=${result.series.length} skippedFiles=${result.skippedFiles.length}`
    );
    return result;
  }

  private resolveManifest(
    sourcePath: string,
    packageName: string,
    adjustMode: ImportAdjustMode,
  ): DataPackageManifest {
    const stat = statSync(sourcePath);

    if (stat.isFile()) {
      const ext = sourcePath.toLowerCase();
      if (ext.endsWith('.duckdb')) {
        return { name: packageName, sourceDialect: 'duckdb', adjustMode };
      }
      if (ext.endsWith('.csv')) {
        return { name: packageName, sourceDialect: 'csv', adjustMode };
      }
      throw new Error(
        `Cannot infer source dialect from file: ${basename(sourcePath)}. ` +
          `Supported single-file formats: .duckdb, .csv`
      );
    }

    const manifestPath = join(sourcePath, DATA_PACKAGE_MANIFEST_FILENAME);
    if (existsSync(manifestPath)) {
      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as DataPackageManifest;
        // TICKET_919_10: validate manifest.archivalCadence against the
        // closed enum so an unknown / typo value fails fast at the
        // manifest boundary rather than silently being treated as a
        // missing field downstream (TICKET_857). Absence is allowed --
        // the service falls through to the IPC payload override and
        // then to DIALECT_ARCHIVAL_DEFAULT.
        if (
          raw.archivalCadence !== undefined &&
          !(IMPORTED_ARCHIVAL_CADENCES as ReadonlyArray<string>).includes(raw.archivalCadence)
        ) {
          throw new Error(
            `Invalid archivalCadence '${raw.archivalCadence}' in ${DATA_PACKAGE_MANIFEST_FILENAME}. ` +
              `Allowed: ${IMPORTED_ARCHIVAL_CADENCES.join(', ')}.`,
          );
        }
        return {
          ...raw,
          name: raw.name || packageName,
          adjustMode: raw.adjustMode || adjustMode,
        };
      } catch (err) {
        throw new Error(
          `Failed to parse ${DATA_PACKAGE_MANIFEST_FILENAME}: ` +
            `${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return this.inferManifestFromDirectory(sourcePath, packageName, adjustMode);
  }

  private inferManifestFromDirectory(
    dirPath: string,
    packageName: string,
    adjustMode: ImportAdjustMode,
  ): DataPackageManifest {
    const files = readdirSync(dirPath);

    const duckdbFiles = files.filter((f) => f.toLowerCase().endsWith('.duckdb'));
    if (duckdbFiles.length > 0) {
      return { name: packageName, sourceDialect: 'duckdb', adjustMode };
    }

    const parquetFiles = this.collectParquetFiles(dirPath);
    if (parquetFiles.length > 0) {
      const symbols = new Set<string>();
      const intervals = new Set<string>();
      for (const f of parquetFiles) {
        const match = basename(f).match(PARQUET_FILENAME_PATTERN);
        if (match) {
          symbols.add(match[1]);
          intervals.add(match[2]);
        }
      }
      return {
        name: packageName,
        sourceDialect: 'parquet',
        adjustMode,
        symbols: Array.from(symbols).sort(),
        intervals: Array.from(intervals).sort(),
      };
    }

    const csvFiles = files.filter((f) => f.toLowerCase().endsWith('.csv'));
    if (csvFiles.length > 0) {
      return { name: packageName, sourceDialect: 'csv', adjustMode };
    }

    throw new Error(
      `Cannot infer source dialect from directory "${dirPath}": no .parquet, .duckdb, or .csv files found.`
    );
  }

  private validateDataPackage(
    sourcePath: string,
    manifest: DataPackageManifest,
  ): DataPackageValidationError[] {
    const errors: DataPackageValidationError[] = [];

    if (!manifest.name || !manifest.name.trim()) {
      errors.push({ field: 'name', message: mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.packageNameRequired') });
    }
    if (!IMPORT_ADJUST_MODES.includes(manifest.adjustMode)) {
      errors.push({ field: 'adjustMode', message: mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.invalidAdjustMode', { mode: manifest.adjustMode }) });
    }

    const stat = statSync(sourcePath);

    if (manifest.sourceDialect === 'parquet' && stat.isDirectory()) {
      const files = this.collectParquetFiles(sourcePath);
      if (files.length === 0) {
        errors.push({ message: mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.noParquetFiles') });
      }
      for (const relPath of files) {
        const filePath = join(sourcePath, relPath);
        const fileStat = statSync(filePath);
        if (fileStat.size === 0) {
          errors.push({ file: relPath, message: mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.fileEmpty') });
        }
      }
    }

    if (manifest.sourceDialect === 'duckdb') {
      const duckdbPath = stat.isFile()
        ? sourcePath
        : this.findDuckDbFile(sourcePath);
      if (!duckdbPath) {
        errors.push({ message: mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.noDuckdbFile') });
      }
    }

    if (manifest.sourceDialect === 'csv') {
      if (stat.isDirectory()) {
        const csvFiles = readdirSync(sourcePath).filter((f) => f.toLowerCase().endsWith('.csv'));
        if (csvFiles.length === 0) {
          errors.push({ message: mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.noCsvFiles') });
        }
      }
    }

    return errors;
  }

  private async importParquetPackage(
    req: DataPackageImportRequest,
    manifest: DataPackageManifest,
    control?: DataPackageImportControl,
  ): Promise<DataPackageImportResult> {
    const cacheService = getParquetCacheService();
    const stat = statSync(req.sourcePath);
    const dirPath = stat.isDirectory() ? req.sourcePath : dirname(req.sourcePath);
    const files = this.collectParquetFiles(dirPath);

    const series: ImportedSeries[] = [];
    const skippedFiles: string[] = [];
    const validationErrors: DataPackageValidationError[] = [];

    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();

    try {
      for (let i = 0; i < files.length; i++) {
        this.throwIfCancelled(control);

        const relPath = files[i];
        const fileName = basename(relPath);
        const match = fileName.match(manifest.filePattern
          ? this.buildFilePattern(manifest.filePattern)
          : PARQUET_FILENAME_PATTERN);

        if (!match) {
          skippedFiles.push(relPath);
          continue;
        }

        const [, symbol, interval] = match;
        const sourceFilePath = join(dirPath, relPath);
        const targetPath = cacheService.getStablePath(symbol, interval, req.packageName);

        control?.onProgress?.({
          phase: 'importing',
          symbol,
          interval,
          seriesIndex: i + 1,
          seriesTotal: files.length,
        });

        const fileStat = statSync(sourceFilePath);
        if (fileStat.size === 0) {
          skippedFiles.push(relPath);
          continue;
        }

        const statReader = await conn.runAndReadAll(
          `SELECT count(*) AS n, min(timestamp) AS first_ts, max(timestamp) AS last_ts ` +
            `FROM read_parquet(${quoteLiteral(sourceFilePath)})`
        );
        const rowStat = statReader.getRowObjectsJS()[0] ?? {};
        const rowCount = Number(rowStat.n ?? 0);

        if (rowCount === 0) {
          skippedFiles.push(relPath);
          continue;
        }

        const targetDir = dirname(targetPath);
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true });
        }

        // TICKET_1126 F2: OHLC sanity gate at the import choke point -- this
        // exact path wrote the corrupt byod_forex store (import event
        // 2026-06-09) with zero validation. Scan BEFORE landing the file;
        // hard-invariant violations are excluded via a filtered rewrite and
        // every flagged bar gets a data_quality_event row (quarantine, never
        // silently drop -- TICKET_858).
        const firstTimestamp = Number(rowStat.first_ts);
        const lastTimestamp = Number(rowStat.last_ts);
        const decision = await this.publishByodCandidate({
          candidatePath: sourceFilePath,
          targetPath,
          symbol,
          firstTimestamp,
          lastTimestamp,
          interval,
          provider: req.packageName,
          providerOrAssetClass: manifest.assetClass ?? 'forex',
          signal: control?.signal,
        });
        const landed = {
          rowCount: decision.rowCount,
          firstTimestamp: decision.extent
            ? Math.floor(decision.extent.startMs / MS_PER_SECOND)
            : null,
          lastTimestamp: decision.extent
            ? Math.floor(decision.extent.endMs / MS_PER_SECOND)
            : null,
        };

        series.push({
          symbol,
          interval,
          filePath: targetPath,
          rowCount: landed.rowCount,
          firstTimestamp: landed.firstTimestamp,
          lastTimestamp: landed.lastTimestamp,
          decisionId: decision.decisionId,
          rejectedBarCount: decision.decisions.rejectedRows,
          suspectBarCount: decision.decisions.suspectRows,
        });
      }
    } finally {
      conn.closeSync();
      instance.closeSync();
    }

    return {
      packageName: req.packageName,
      sourceDialect: 'parquet',
      series,
      skippedFiles,
      validationErrors,
    };
  }

  private async importDuckDbPackage(
    req: DataPackageImportRequest,
    manifest: DataPackageManifest,
    control?: DataPackageImportControl,
  ): Promise<DataPackageImportResult> {
    const stat = statSync(req.sourcePath);
    const duckdbPath = stat.isFile()
      ? req.sourcePath
      : this.findDuckDbFile(req.sourcePath);

    if (!duckdbPath) {
      throw new Error(`No .duckdb file found in ${req.sourcePath}`);
    }

    const cacheService = getParquetCacheService();
    const series: ImportedSeries[] = [];
    const skippedFiles: string[] = [];
    const validationErrors: DataPackageValidationError[] = [];

    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();

    try {
      await conn.run(`ATTACH ${quoteLiteral(duckdbPath)} AS src (READ_ONLY)`);

      const tables = manifest.tables && manifest.tables.length > 0
        ? manifest.tables
        : await this.discoverDuckDbTables(conn, manifest);

      for (let i = 0; i < tables.length; i++) {
        this.throwIfCancelled(control);

        const tableEntry = tables[i];

        control?.onProgress?.({
          phase: 'importing',
          symbol: tableEntry.symbol,
          interval: tableEntry.interval,
          seriesIndex: i + 1,
          seriesTotal: tables.length,
        });

        const targetPath = cacheService.getStablePath(
          tableEntry.symbol,
          tableEntry.interval,
          req.packageName,
        );
        const tmpPath = `${targetPath}.tmp`;
        const targetDir = dirname(targetPath);
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true });
        }
        if (existsSync(tmpPath)) {
          unlinkSync(tmpPath);
        }

        const selectSql = tableEntry.query || `SELECT * FROM src.${tableEntry.tableName}`;
        const copySql = `COPY (${selectSql}) TO ${quoteLiteral(tmpPath)} (FORMAT parquet, COMPRESSION ${DUCKDB_PARQUET_COMPRESSION})`;

        try {
          await conn.run(copySql);
        } catch (err) {
          try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `DuckDB COPY failed for table=${tableEntry.tableName} ` +
              `symbol=${tableEntry.symbol}: ${msg}`
          );
        }

        const statReader = await conn.runAndReadAll(
          `SELECT count(*) AS n, min(timestamp) AS first_ts, max(timestamp) AS last_ts ` +
            `FROM read_parquet(${quoteLiteral(tmpPath)})`
        );
        const rowStat = statReader.getRowObjectsJS()[0] ?? {};
        const rowCount = Number(rowStat.n ?? 0);

        if (rowCount === 0) {
          try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
          skippedFiles.push(tableEntry.tableName);
          continue;
        }

        // TICKET_1126 F2: OHLC sanity gate before landing the file.
        const decision = await this.publishByodCandidate({
          candidatePath: tmpPath,
          targetPath,
          symbol: tableEntry.symbol,
          firstTimestamp: Number(rowStat.first_ts),
          lastTimestamp: Number(rowStat.last_ts),
          interval: tableEntry.interval,
          provider: req.packageName,
          providerOrAssetClass: manifest.assetClass ?? 'forex',
          signal: control?.signal,
        });
        try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
        const landed = {
          rowCount: decision.rowCount,
          firstTimestamp: decision.extent
            ? Math.floor(decision.extent.startMs / MS_PER_SECOND)
            : null,
          lastTimestamp: decision.extent
            ? Math.floor(decision.extent.endMs / MS_PER_SECOND)
            : null,
        };

        series.push({
          symbol: tableEntry.symbol,
          interval: tableEntry.interval,
          filePath: targetPath,
          rowCount: landed.rowCount,
          firstTimestamp: landed.firstTimestamp,
          lastTimestamp: landed.lastTimestamp,
          decisionId: decision.decisionId,
          rejectedBarCount: decision.decisions.rejectedRows,
          suspectBarCount: decision.decisions.suspectRows,
        });
      }
    } finally {
      conn.closeSync();
      instance.closeSync();
    }

    return {
      packageName: req.packageName,
      sourceDialect: 'duckdb',
      series,
      skippedFiles,
      validationErrors,
    };
  }

  private async importCsvPackage(
    req: DataPackageImportRequest,
    manifest: DataPackageManifest,
    control?: DataPackageImportControl,
  ): Promise<DataPackageImportResult> {
    const cacheService = getParquetCacheService();
    const stat = statSync(req.sourcePath);
    const csvFiles: Array<{ filePath: string; symbol: string; interval: string }> = [];

    if (stat.isFile()) {
      const name = basename(req.sourcePath, '.csv');
      csvFiles.push({ filePath: req.sourcePath, symbol: name, interval: INTERVAL_1d });
    } else {
      const dirFiles = readdirSync(req.sourcePath).filter((f) => f.toLowerCase().endsWith('.csv'));
      for (const f of dirFiles) {
        const name = basename(f, '.csv');
        const match = name.match(/^(.+)_(1m|5m|15m|30m|1h|4h|1d)$/);
        if (match) {
          csvFiles.push({ filePath: join(req.sourcePath, f), symbol: match[1], interval: match[2] });
        } else {
          csvFiles.push({ filePath: join(req.sourcePath, f), symbol: name, interval: INTERVAL_1d });
        }
      }
    }

    const series: ImportedSeries[] = [];
    const skippedFiles: string[] = [];
    const validationErrors: DataPackageValidationError[] = [];

    const schema = manifest.schema ?? DATA_PACKAGE_DEFAULTS.schema;
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();

    try {
      for (let i = 0; i < csvFiles.length; i++) {
        this.throwIfCancelled(control);

        const entry = csvFiles[i];

        control?.onProgress?.({
          phase: 'importing',
          symbol: entry.symbol,
          interval: entry.interval,
          seriesIndex: i + 1,
          seriesTotal: csvFiles.length,
        });

        const targetPath = cacheService.getStablePath(entry.symbol, entry.interval, req.packageName);
        const tmpPath = `${targetPath}.tmp`;
        const targetDir = dirname(targetPath);
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true });
        }
        if (existsSync(tmpPath)) {
          unlinkSync(tmpPath);
        }

        const tsCol = schema.timestampColumn;
        const cols = schema.columns;
        const selectCols = cols.map((c) => {
          if (c === 'timestamp' && tsCol !== 'timestamp') {
            return `CAST("${tsCol}" AS BIGINT) AS timestamp`;
          }
          if (c === 'timestamp') return `CAST("timestamp" AS BIGINT) AS timestamp`;
          return `CAST("${c}" AS DOUBLE) AS "${c}"`;
        }).join(', ');

        const copySql =
          `COPY (SELECT ${selectCols} FROM read_csv(${quoteLiteral(entry.filePath)}, ` +
          `header=true, auto_detect=true) ORDER BY timestamp) ` +
          `TO ${quoteLiteral(tmpPath)} (FORMAT parquet, COMPRESSION ${DUCKDB_PARQUET_COMPRESSION})`;

        try {
          await conn.run(copySql);
        } catch (err) {
          try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`CSV import COPY failed for ${entry.filePath}: ${msg}`);
        }

        const statReader = await conn.runAndReadAll(
          `SELECT count(*) AS n, min(timestamp) AS first_ts, max(timestamp) AS last_ts ` +
            `FROM read_parquet(${quoteLiteral(tmpPath)})`
        );
        const rowStat = statReader.getRowObjectsJS()[0] ?? {};
        const rowCount = Number(rowStat.n ?? 0);

        if (rowCount === 0) {
          try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
          skippedFiles.push(basename(entry.filePath));
          continue;
        }

        // TICKET_1126 F2: OHLC sanity gate before landing the file.
        const decision = await this.publishByodCandidate({
          candidatePath: tmpPath,
          targetPath,
          symbol: entry.symbol,
          firstTimestamp: Number(rowStat.first_ts),
          lastTimestamp: Number(rowStat.last_ts),
          interval: entry.interval,
          provider: req.packageName,
          providerOrAssetClass: manifest.assetClass ?? 'forex',
          signal: control?.signal,
        });
        try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
        const landed = {
          rowCount: decision.rowCount,
          firstTimestamp: decision.extent
            ? Math.floor(decision.extent.startMs / MS_PER_SECOND)
            : null,
          lastTimestamp: decision.extent
            ? Math.floor(decision.extent.endMs / MS_PER_SECOND)
            : null,
        };

        series.push({
          symbol: entry.symbol,
          interval: entry.interval,
          filePath: targetPath,
          rowCount: landed.rowCount,
          firstTimestamp: landed.firstTimestamp,
          lastTimestamp: landed.lastTimestamp,
          decisionId: decision.decisionId,
          rejectedBarCount: decision.decisions.rejectedRows,
          suspectBarCount: decision.decisions.suspectRows,
        });
      }
    } finally {
      conn.closeSync();
      instance.closeSync();
    }

    return {
      packageName: req.packageName,
      sourceDialect: 'csv',
      series,
      skippedFiles,
      validationErrors,
    };
  }

  private registerDataPackageImport(
    result: DataPackageImportResult,
    req: DataPackageImportRequest,
    manifest: DataPackageManifest,
  ): void {
    const cacheManager = getDataCacheManager();
    const db = getDatabaseManager().getDb();

    const apply = db.transaction(() => {
      for (const s of result.series) {
        if (s.firstTimestamp === null || s.lastTimestamp === null) {
          throw new Error(
            `Cannot register series with null timestamps: ` +
              `${s.symbol}|${s.interval} (package="${result.packageName}").`
          );
        }
        cacheManager.registerImportedFile({
          symbol: s.symbol,
          interval: s.interval,
          packageName: result.packageName,
          filePath: s.filePath,
          firstTimestamp: s.firstTimestamp,
          lastTimestamp: s.lastTimestamp,
          rowCount: s.rowCount,
        });
      }
      // TICKET_919_10: cadence resolution order, most-specific to
      // least-specific:
      //   1. request-level override (renderer UI control / IPC payload)
      //   2. manifest.archivalCadence (declared by the export tool /
      //      data publisher that produced the package)
      //   3. DIALECT_ARCHIVAL_DEFAULT[sourceDialect] (applied inside
      //      registerImportedPackage when archivalCadence is undefined)
      // The HistData / Dukascopy renderer flow takes path (1) by
      // setting `request.archivalCadence = 'monthly_archive'`; a
      // self-describing data package takes path (2); a generic CSV
      // import inherits 'snapshot' via path (3).
      const resolvedCadence = req.archivalCadence ?? manifest.archivalCadence;
      cacheManager.registerImportedPackage({
        packageName: result.packageName,
        adjustMode: req.adjustMode,
        sourceDialect: manifest.sourceDialect,
        archivalCadence: resolvedCadence,
        assetClass: manifest.assetClass,
      });
    });
    apply();

    const resolvedCadenceForLog = req.archivalCadence ?? manifest.archivalCadence;
    importLog.info(
      `Registered data package import: package="${result.packageName}" ` +
        `files=${result.series.length} adjustMode=${req.adjustMode} dialect=${manifest.sourceDialect} ` +
        `cadence=${resolvedCadenceForLog ?? '(dialect default)'}`
    );
  }

  private async discoverDuckDbTables(
    conn: DuckDBConnection,
    manifest: DataPackageManifest,
  ): Promise<DataPackageDuckDbTable[]> {
    const reader = await conn.runAndReadAll(
      `SELECT table_name FROM information_schema.tables WHERE table_catalog = 'src'`
    );
    const tableNames = reader.getRowObjectsJS().map((r) => String(r.table_name));
    return tableNames.map((tableName) => ({
      tableName,
      symbol: tableName,
      interval: INTERVAL_1d,
    }));
  }

  private findDuckDbFile(dirPath: string): string | null {
    const files = readdirSync(dirPath).filter((f) => f.toLowerCase().endsWith('.duckdb'));
    if (files.length === 0) return null;
    return join(dirPath, files[0]);
  }

  private buildFilePattern(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\{SYMBOL\\}/, '(.+)')
      .replace(/\\{INTERVAL\\}/, '(1m|5m|15m|30m|1h|4h|1d)');
    return new RegExp(`^${escaped}$`);
  }

  private throwIfCancelled(control?: DataPackageImportControl): void {
    if (control?.signal?.aborted) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataImport.importCancelled'));
    }
  }
}

// =============================================================================
// SQL literal quoting (for the few values COPY cannot bind)
// =============================================================================

/**
 * Single-quote and escape a SQL string literal for the connection string, the
 * file path, and the timezone -- the three values that DuckDB's ATTACH / COPY
 * TO / `timezone(...)` cannot accept as bind parameters. Symbol VALUES are
 * always bound (`$symbol`), never routed through here.
 */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// =============================================================================
// Singleton
// =============================================================================

let importService: DataImportService | null = null;

export function getDataImportService(): DataImportService {
  if (!importService) {
    importService = new DataImportService();
  }
  return importService;
}

export { DataImportService };
