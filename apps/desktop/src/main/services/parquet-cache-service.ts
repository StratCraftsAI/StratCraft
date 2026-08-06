/**
 * Parquet Cache Service
 *
 * TICKET_146: Local Parquet cache for backtest data
 *
 * Data Flow:
 * - First run: ClickHouse -> Download -> Save Parquet -> Return dataPath
 * - Subsequent runs: Check local Parquet -> Return dataPath (no network)
 */

import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, unlinkSync, renameSync } from 'fs';
import * as parquet from '@dsnp/parquetjs';
import { DuckDBInstance } from '@duckdb/node-api';
import { appLog } from '../utils/logger';
import { PARQUET_CACHE_DIR, DUCKDB_PARQUET_COMPRESSION } from '../../shared/constants/data-import';
import { getDataRoot } from '../utils/data-root';
import { MS_PER_SECOND } from '../../shared/constants/timing';
import { OHLCV_SCHEMA } from './ohlcv-parquet-schema';
import type { EpochSeconds } from '../../shared/types/epoch';
import { asEpochMs, epochMsToSeconds, epochSecondsToMs } from '../../shared/types/epoch';
import {
  runOhlcvDataPlane,
  type OhlcvDecisionMetadata,
} from './ohlcv-data-plane-client';
import { resolveDataQualityAssetClass } from '../../shared/constants/data-quality';
import { intervalToMs } from '../../shared/constants/intervals';
import {
  recordDataQualityEvents,
  type DataQualityEventInput,
} from '../database/services/data-quality-event-service';

// Re-export so callers that previously imported OHLCV_SCHEMA from
// this module (TICKET_813 R1 transitional surface) continue to work.
export { OHLCV_SCHEMA };

/**
 * TICKET_918: Parquet cache format version.
 *
 * Bump this whenever the on-disk format changes (codec, schema, etc.)
 * so that stale files written by an earlier version are never read.
 * The version is embedded in the cache directory path by getStablePath().
 *
 * v1 (implicit) -- ZSTD compression (incompatible with @dsnp/parquetjs).
 * v2            -- SNAPPY compression (compatible with @dsnp/parquetjs).
 */
export const PARQUET_CACHE_FORMAT_VERSION = 3;

/**
 * TICKET_918 Phase 4: Parquet compression codecs the Electron-side reader
 * (`@dsnp/parquetjs`) can actually decompress.
 *
 * These are the keys of `PARQUET_COMPRESSION_METHODS` in
 * `@dsnp/parquetjs/dist/lib/compression.js`: UNCOMPRESSED, GZIP, SNAPPY,
 * BROTLI. (LZO is declared in the Parquet spec but DISABLED in parquetjs --
 * see LibertyDSNP/parquetjs#18 -- so it is intentionally excluded here.)
 *
 * Any file whose column chunks use a codec OUTSIDE this set (notably ZSTD,
 * codec enum 6) cannot be read via parquetjs and crashes the signal-discovery
 * Python-fit path with `invalid compression method: <CODEC>`. We detect such
 * files by their real on-disk codec -- never by a path-prefix proxy -- and
 * purge their cache records so the SNAPPY writer regenerates them.
 */
const PARQUET_READER_SUPPORTED_CODECS: ReadonlySet<string> = new Set([
  'UNCOMPRESSED',
  'GZIP',
  'SNAPPY',
  'BROTLI',
]);

/**
 * TICKET_918 Phase 4: Detect whether a Parquet file can be read by the
 * Electron-side `@dsnp/parquetjs` reader, based on its REAL column-chunk
 * compression codec (read from the file footer, no data-page decompression).
 *
 * `ParquetReader.openFile()` parses only the footer, so it succeeds even for
 * ZSTD files -- the `invalid compression method` error is thrown lazily at
 * data-page inflate time, not at open time. That makes the footer codec the
 * cheap, authoritative signal for "can the JS reader consume this file?".
 *
 * Returns the set of codec names found, and whether ALL are reader-supported.
 * On any footer-read failure the file is treated as unreadable (fail-safe:
 * better to regenerate than to register a file we cannot prove is readable).
 */
export async function inspectParquetCodec(
  filePath: string,
): Promise<{ readable: boolean; codecs: string[] }> {
  try {
    const reader = await parquet.ParquetReader.openFile(filePath);
    try {
      const found = new Set<string>();
      const md = reader.metadata as unknown as {
        row_groups?: Array<{ columns?: Array<{ meta_data?: { codec?: number } }> }>;
      };
      for (const rg of md.row_groups ?? []) {
        for (const col of rg.columns ?? []) {
          const codecEnum = col.meta_data?.codec;
          if (codecEnum == null) continue;
          found.add(parquetCodecName(codecEnum));
        }
      }
      const codecs = [...found];
      const readable =
        codecs.length > 0 && codecs.every(c => PARQUET_READER_SUPPORTED_CODECS.has(c));
      return { readable, codecs };
    } finally {
      await reader.close();
    }
  } catch {
    return { readable: false, codecs: [] };
  }
}

/**
 * Escape a string for safe inlining as a DuckDB SQL literal (single-quote
 * doubling). File paths are not user-bound parameters in DuckDB COPY, so they
 * must be escaped here. Mirrors the helper in data-import-service.ts.
 */
export function quoteDuckdbLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * TICKET_919: Re-encode an unreadable-codec Parquet file (notably ZSTD) to
 * SNAPPY IN PLACE so the Electron-side `@dsnp/parquetjs` reader can consume it.
 *
 * Root-cause fix at the codec-owning boundary (TICKET_860): the same DuckDB
 * COPY re-encode that data-import-service.ts applies on the BYOD bulk-register
 * path, exposed here so the universe-resolve path (which has no download
 * semantics for imported packages) can self-heal a ZSTD file rather than
 * degrade to a hard "No imported data" failure.
 *
 * Returns true if the file was re-encoded, false if it was already readable.
 * Throws if the re-encode itself fails (fail-fast -- TICKET_857).
 */
export async function reencodeParquetToReadableCodec(
  filePath: string,
): Promise<boolean> {
  const { readable, codecs } = await inspectParquetCodec(filePath);
  if (readable) return false;

  const tmpPath = `${filePath}.snappy.tmp`;
  if (existsSync(tmpPath)) unlinkSync(tmpPath);

  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    await conn.run(
      `COPY (SELECT * FROM read_parquet(${quoteDuckdbLiteral(filePath)})) ` +
        `TO ${quoteDuckdbLiteral(tmpPath)} ` +
        `(FORMAT parquet, COMPRESSION ${DUCKDB_PARQUET_COMPRESSION})`,
    );
    renameSync(tmpPath, filePath);
    cacheLog.info(
      `TICKET_919: re-encoded ${filePath} from ` +
        `${codecs.join('/') || 'unreadable'} to ${DUCKDB_PARQUET_COMPRESSION} ` +
        `(parquetjs-readable)`,
    );
    return true;
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      /* ignore cleanup error */
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `TICKET_919: failed to re-encode ${filePath} to ` +
        `${DUCKDB_PARQUET_COMPRESSION} (source codec ` +
        `${codecs.join('/') || 'unknown'}): ${msg}`,
    );
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

/**
 * Parquet `CompressionCodec` thrift enum -> name. Mirrors the spec ordering
 * used by every Parquet implementation (parquet-format CompressionCodec).
 * TICKET_179: named mapping, no inline magic numbers at call sites.
 */
function parquetCodecName(codecEnum: number): string {
  const PARQUET_CODEC_NAMES = [
    'UNCOMPRESSED', // 0
    'SNAPPY', // 1
    'GZIP', // 2
    'LZO', // 3
    'BROTLI', // 4
    'LZ4', // 5
    'ZSTD', // 6
    'LZ4_RAW', // 7
  ] as const;
  return PARQUET_CODEC_NAMES[codecEnum] ?? `CODEC_${codecEnum}`;
}

// =============================================================================
// Types
// =============================================================================

export interface OHLCVRow {
  // TICKET_813: branded EpochSeconds. The unit is locked at the
  // type system layer; a function that takes EpochMs will reject
  // an OHLCVRow.timestamp at compile time. See
  // apps/desktop/src/shared/types/epoch.ts for the brand
  // definitions and the legal conversion helpers.
  timestamp: EpochSeconds;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CacheWriteResult {
  success: boolean;
  dataPath?: string;
  rowCount?: number;
  error?: string;
  /** TICKET_318: Actual data start date (from first row timestamp) */
  actualStartDate?: string;
  /** TICKET_318: Actual data end date (from last row timestamp) */
  actualEndDate?: string;
  decision?: OhlcvDecisionMetadata;
}

// =============================================================================
// Logger
// =============================================================================

const cacheLog = {
  info: (msg: string, data?: unknown) => appLog.info(`[ParquetCache] ${msg}`, data),
  debug: (msg: string, data?: unknown) => appLog.debug(`[ParquetCache] ${msg}`, data),
  error: (msg: string, data?: unknown) => appLog.error(`[ParquetCache] ${msg}`, data),
};

function recordCxxQualityEvents(
  decision: OhlcvDecisionMetadata,
  provider: string,
  interval: string,
): void {
  const events: DataQualityEventInput[] = decision.qualityEvents.map((event) => ({
    provider,
    symbol: event.symbol,
    interval,
    barTs: Math.floor(event.timestampMs / MS_PER_SECOND),
    rule: event.rule,
    severity: event.severity,
    original: event.original,
    source: 'parquet-cache-service',
    message: `C++ OHLCV data plane ${event.rule}`,
  }));
  const omittedEventCount =
    decision.decisions.rejectedRows +
    decision.decisions.suspectRows -
    decision.qualityEvents.length;
  if (omittedEventCount > 0) {
    events.push({
      provider,
      symbol: decision.qualityEvents[0]?.symbol ?? '__multiple__',
      interval,
      barTs: null,
      rule: 'validation_summary',
      severity: 'suspect',
      source: 'parquet-cache-service',
      message: `${omittedEventCount} additional C++ OHLCV quality events exceeded the detail cap`,
    });
  }
  recordDataQualityEvents(events);
}

// =============================================================================
// Parquet Schema  (TICKET_812 contract)
// =============================================================================
//
// Contract with Python readers:
//
//   timestamp : INT64 Unix epoch SECONDS (UTC) -- NOT milliseconds.
//               Source of truth: the IDataProvider contract in
//               apps/desktop/src/main/services/data-providers/
//               types.ts (queryOHLCV docblock: "timestamp MUST be
//               Unix seconds (not milliseconds)"). AlpacaProvider
//               + DukascopyProvider both ship seconds; this cache
//               passes the value through unchanged. The
//               `timestampToDateStr` helper below multiplies by
//               MS_PER_SECOND before constructing a JS Date, which
//               is the in-code confirmation that the column is
//               seconds.
//               Stored as a plain column, NOT promoted to the
//               parquet's logical index -- parquetjs-lite does not
//               round-trip a pandas DatetimeIndex with a stable wire
//               format across writer/reader version pairs.
//
//               Python readers MUST promote this column to a
//               pd.DatetimeIndex on load. The canonical loader is
//               `research_contracts.io.load_ohlcv`; downstream code MUST
//               NOT call `pd.read_parquet` on a Tool Sweep parquet
//               directly.
//
//   open / high / low / close / volume : DOUBLE.
//
// If this schema ever changes (e.g. adding a 'vwap' column, or
// migrating timestamp to TIMESTAMP_MILLIS), update the loader and
// the contract test in the same PR:
//
//   - Loader: packages/research-contracts/research_contracts/io/ohlcv_parquet.py
//   - Test:   packages/research-contracts/tests/io/test_ohlcv_parquet_contract.py
//   - E2E:    packages/nona-algorithm/tests/signal_sweep/
//             test_fit_universe_fold_window_e2e.py
//
// The contract test pins the writer schema and the loader together,
// so a drift in either side will trip CI before reaching a user.

// OHLCV_SCHEMA moved to ./ohlcv-parquet-schema.ts (TICKET_813) so
// it can be imported by the standalone regenerator script without
// dragging Electron / logger deps. Imported + re-exported above.

// =============================================================================
// ParquetCacheService
// =============================================================================

class ParquetCacheService {
  private cacheDir: string;

  constructor() {
    this.cacheDir = join(getDataRoot(), PARQUET_CACHE_DIR);

    // Ensure directory exists
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
      cacheLog.info('Cache directory created:', this.cacheDir);
    }
  }

  /**
   * Convert Unix timestamp to YYYY-MM-DD string
   */
  private timestampToDateStr(timestamp: number): string {
    const date = new Date(timestamp * MS_PER_SECOND);
    return date.toISOString().split('T')[0];
  }

  /**
   * TICKET_959 Fix-1: Read OHLCV rows from a parquet file with WINDOW
   * PUSHDOWN. The window `[startSec, endSec]` (inclusive, Unix seconds)
   * is pushed into the storage layer via a DuckDB `WHERE timestamp
   * BETWEEN ... AND ...` predicate against `read_parquet()`. Only the
   * rows in-range are materialized in JS memory -- a full-history read
   * followed by in-memory slicing is forbidden (TICKET_919 / project
   * "no full-history read" rule).
   *
   * Used by the Alpha Factory cross-timeframe alignment path to load
   * real close prices for the common-interval grid, so the C++ plugin
   * never has to fabricate `close = 0.0` placeholders.
   */
  async readCacheInWindow(
    dataPath: string,
    startSec: number,
    endSec: number,
  ): Promise<OHLCVRow[]> {
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec < startSec) {
      throw new Error(
        `readCacheInWindow: invalid window [${startSec}, ${endSec}] for ${dataPath}`,
      );
    }
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    try {
      const reader = await conn.runAndReadAll(
        `SELECT timestamp, open, high, low, close, volume ` +
          `FROM read_parquet(${quoteDuckdbLiteral(dataPath)}) ` +
          `WHERE timestamp BETWEEN ${Math.floor(startSec * MS_PER_SECOND)} ` +
          `AND ${Math.floor(endSec * MS_PER_SECOND)} ` +
          `ORDER BY timestamp ASC`,
      );
      const records = reader.getRowObjectsJS();
      const rows: OHLCVRow[] = new Array(records.length);
      for (let i = 0; i < records.length; ++i) {
        const r = records[i];
        rows[i] = {
          timestamp: epochMsToSeconds(asEpochMs(Number(r.timestamp))),
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
          volume: Number(r.volume),
        };
      }
      return rows;
    } catch (error) {
      cacheLog.error('readCacheInWindow error:', error);
      throw error;
    } finally {
      conn.closeSync();
      instance.closeSync();
    }
  }

  /**
   * Clear all cached files
   */
  clearCache(): number {
    let deleted = 0;
    try {
      const entries = readdirSync(this.cacheDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.parquet')) {
          unlinkSync(join(this.cacheDir, entry.name));
          deleted++;
        } else if (entry.isDirectory()) {
          const subDir = join(this.cacheDir, entry.name);
          const subFiles = readdirSync(subDir);
          for (const subFile of subFiles) {
            if (subFile.endsWith('.parquet')) {
              unlinkSync(join(subDir, subFile));
              deleted++;
            }
          }
        }
      }
      cacheLog.info(`Cache cleared: ${deleted} files deleted`);
    } catch (error) {
      cacheLog.error('Clear cache error:', error);
    }
    return deleted;
  }

  /**
   * TICKET_362: Stable file path for a (symbol, interval, provider) triple.
   * One file per series, never changes across appends.
   *
   * TICKET_918: Version segment added so a codec/schema change
   * invalidates stale files automatically (no migration script).
   * Format: {cacheDir}/v{VERSION}/{provider}/{sanitizedSymbol}_{interval}.parquet
   */
  getStablePath(symbol: string, interval: string, provider: string): string {
    const sanitizedSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '_');
    const providerDir = join(this.cacheDir, `v${PARQUET_CACHE_FORMAT_VERSION}`, provider);
    if (!existsSync(providerDir)) {
      mkdirSync(providerDir, { recursive: true });
    }
    return join(providerDir, `${sanitizedSymbol}_${interval}.parquet`);
  }

  /**
   * TICKET_362: Atomic write -- write to .tmp file then rename.
   * Prevents partial-write corruption on crash.
   */
  async atomicWriteParquet(
    targetPath: string,
    rows: OHLCVRow[],
    options?: {
      symbol?: string;
      providerOrAssetClass?: string;
      interval?: string;
      abortSignal?: AbortSignal;
    },
  ): Promise<CacheWriteResult> {
    try {
      cacheLog.info(`Atomic write: ${targetPath}, rows: ${rows.length}`);
      const timestamps = rows.map((row) => Number(epochSecondsToMs(row.timestamp)));
      const decision = await runOhlcvDataPlane({
        operation: 'canonicalize',
        inputs: [],
        inlineRows: rows.map((row) => ({
          symbol: options?.symbol ?? '__single__',
          timestamp: row.timestamp,
          timestampUnit: 's',
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
        })),
        window: {
          startMs: timestamps.length > 0 ? Math.min(...timestamps) : 0,
          endMs: timestamps.length > 0 ? Math.max(...timestamps) : 0,
        },
        outputPath: targetPath,
        qualityAction: 'drop_rows',
        ...(options?.interval
          ? {
            qualityPolicy: {
              assetClass: resolveDataQualityAssetClass(options.providerOrAssetClass),
              intervalMs: requireQualityIntervalMs(options.interval),
            },
          }
          : {}),
      }, options?.abortSignal);
      if (options?.providerOrAssetClass && options.interval) {
        recordCxxQualityEvents(
          decision, options.providerOrAssetClass, options.interval,
        );
      }

      cacheLog.info(`Atomic write complete: ${targetPath}`);

      return {
        success: true,
        dataPath: targetPath,
        rowCount: decision.rowCount,
        actualStartDate: decision.extent
          ? this.timestampToDateStr(epochMsToSeconds(asEpochMs(decision.extent.startMs)))
          : undefined,
        actualEndDate: decision.extent
          ? this.timestampToDateStr(epochMsToSeconds(asEpochMs(decision.extent.endMs)))
          : undefined,
        decision,
      };
    } catch (error) {
      cacheLog.error('Atomic write error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Atomic write failed',
      };
    }
  }

  async mergeAndWriteParquet(
    targetPath: string,
    existingPath: string | null,
    rows: OHLCVRow[],
    options: {
      symbol: string;
      startMs: number;
      endMs: number;
      providerOrAssetClass?: string;
      interval: string;
      minimumOutputRows?: number;
      abortSignal?: AbortSignal;
    },
  ): Promise<CacheWriteResult> {
    try {
      const decision = await runOhlcvDataPlane({
        operation: 'merge',
        inputs: existingPath && existsSync(existingPath)
          ? [{
            path: existingPath,
            precedence: 0,
            projection: { fixedSymbol: options.symbol, timestampUnit: 'ms' },
          }]
          : [],
        inlineRows: rows.map((row) => ({
          symbol: options.symbol,
          timestamp: row.timestamp,
          timestampUnit: 's',
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
          precedence: 1,
        })),
        window: { startMs: options.startMs, endMs: options.endMs },
        outputPath: targetPath,
        qualityAction: 'drop_rows',
        qualityPolicy: {
          assetClass: resolveDataQualityAssetClass(options.providerOrAssetClass),
          intervalMs: requireQualityIntervalMs(options.interval),
        },
        minimumOutputRows: options.minimumOutputRows,
      }, options.abortSignal);
      if (options.providerOrAssetClass) {
        recordCxxQualityEvents(
          decision, options.providerOrAssetClass, options.interval,
        );
      }
      return {
        success: true,
        dataPath: targetPath,
        rowCount: decision.rowCount,
        decision,
        actualStartDate: decision.extent
          ? this.timestampToDateStr(epochMsToSeconds(asEpochMs(decision.extent.startMs)))
          : undefined,
        actualEndDate: decision.extent
          ? this.timestampToDateStr(epochMsToSeconds(asEpochMs(decision.extent.endMs)))
          : undefined,
      };
    } catch (error) {
      cacheLog.error('C++ merge/publish error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'C++ merge/publish failed',
      };
    }
  }

  async canonicalizeExistingParquet(
    targetPath: string,
    sourcePath: string,
    options: {
      symbol: string;
      startMs: number;
      endMs: number;
      timestampUnit: 's' | 'ms' | 'us' | 'ns';
      providerOrAssetClass: string;
      interval: string;
      minimumOutputRows: number;
      abortSignal?: AbortSignal;
    },
  ): Promise<CacheWriteResult> {
    try {
      const decision = await runOhlcvDataPlane({
        operation: 'canonicalize',
        inputs: [{
          path: sourcePath,
          precedence: 0,
          projection: {
            fixedSymbol: options.symbol,
            timestampUnit: options.timestampUnit,
          },
        }],
        window: { startMs: options.startMs, endMs: options.endMs },
        outputPath: targetPath,
        qualityAction: 'drop_rows',
        qualityPolicy: {
          assetClass: resolveDataQualityAssetClass(options.providerOrAssetClass),
          intervalMs: requireQualityIntervalMs(options.interval),
        },
        minimumOutputRows: options.minimumOutputRows,
      }, options.abortSignal);
      recordCxxQualityEvents(
        decision, options.providerOrAssetClass, options.interval,
      );
      return {
        success: true,
        dataPath: targetPath,
        rowCount: decision.rowCount,
        decision,
        actualStartDate: decision.extent
          ? this.timestampToDateStr(epochMsToSeconds(asEpochMs(decision.extent.startMs)))
          : undefined,
        actualEndDate: decision.extent
          ? this.timestampToDateStr(epochMsToSeconds(asEpochMs(decision.extent.endMs)))
          : undefined,
      };
    } catch (error) {
      cacheLog.error('C++ legacy canonicalization error:', error);
      return {
        success: false,
        error: error instanceof Error
          ? error.message
          : 'C++ legacy canonicalization failed',
      };
    }
  }

  /**
   * Get cache directory path
   */
  getCacheDir(): string {
    return this.cacheDir;
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let cacheService: ParquetCacheService | null = null;

export function getParquetCacheService(): ParquetCacheService {
  if (!cacheService) {
    cacheService = new ParquetCacheService();
  }
  return cacheService;
}
function requireQualityIntervalMs(interval: string): number {
  const value = intervalToMs(interval);
  if (value === null) {
    throw new Error(`Unsupported OHLCV quality interval: ${interval}`);
  }
  return value;
}
