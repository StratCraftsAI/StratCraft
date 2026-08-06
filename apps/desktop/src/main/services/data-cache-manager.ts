/**
 * Data Cache Manager
 *
 * TICKET_362: Single-File Append data cache.
 * Replaces segment-based download-manager.ts with one Parquet file per
 * (symbol, interval, provider) triple. Appending new data reads existing
 * file, merges with new rows, dedup-sorts, and atomic-writes.
 *
 * Core responsibilities:
 *   - Metadata CRUD on data_cache_files table
 *   - Append orchestration with per-key async mutex
 *   - Aggregated file management (staleness check, re-aggregate)
 *   - Legacy file bootstrap on first init
 *
 * Two-phase singleton: initializeDataCacheManager() / getDataCacheManager()
 */

import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import { existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import {
  listCacheFiles as listCacheFilesCore,
  getCacheStats as getCacheStatsCore,
  listImportedPackages as listImportedPackagesCore,
  listImportedPackageSummaries as listImportedPackageSummariesCore,
  buildImportedPackageCoverageReport as buildCoverageReportCore,
  coverageReportToCsv,
  type ImportedPackageSummary,
  type PackageCoverageReport,
} from '@StratCraft/data-cache-store';
import { setDynamicAssetClassResolver, staticInstrumentRegistry, StaticInstrumentRegistry } from '@StratCraft/types';
import { join, basename } from 'path';
import { getDatabaseManager } from '../database/db-manager';
import { getParquetCacheService, OHLCVRow, inspectParquetCodec } from './parquet-cache-service';
import { getAggregationService } from './data-providers/aggregation/aggregation-service';
import { IDataProvider } from './data-providers/types';
import { isOpaqueError } from '../../shared/utils/opaque-error';
import { resolveFetchPlan } from './data-providers/interval-resolution';
import { parseMaxLookbackMs } from './data-providers/pull-window';
import { expectedBarsForRange } from './data-providers/expected-bars';
import { computePackageCalendarRatios } from './data-providers/imported-package-ratio';
import {
  resolveArchivalCadenceEndMs,
  type ResolvedSymbolTail,
} from './data-providers/archival-cadence-end';
import { getDataProviderManager } from './data-providers/provider-manager'; // TICKET_958_2
import { sendToRenderer } from '../window';
import { appLog } from '../utils/logger';
import { MS_PER_SECOND } from '../../shared/constants/timing';
import {
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m,
  INTERVAL_1h, INTERVAL_4h, intervalToMs,
} from '../../shared/constants/intervals';
import {
  CACHE_INTEGRITY_COVERAGE_THRESHOLD,
  CACHE_INTEGRITY_MIN_EXPECTED_BARS,
  VIRTUAL_EXTENSION_WARN_DAYS,
} from '../../shared/constants/data-cache-integrity';
import {
  enumerateTradingDays,
  formatTradingDay,
} from '../../shared/calendars/trading-calendars';
import { PARQUET_CACHE_DIR } from '../../shared/constants/data-import';
import type { ArchivalCadence, ImportSourceDialect } from '../../shared/constants/data-import';
import {
  checkMissingTradingDays,
  formatMissingDaysWarning,
  type MissingDaysResult,
} from './data-storage/cache-write-invariants';
import { assertCacheFilePathContained } from './data-storage/cache-file-path-containment';
import {
  DIALECT_ARCHIVAL_DEFAULT,
  IMPORTED_ARCHIVAL_CADENCES,
} from '../../shared/constants/data-import';

// =============================================================================
// TICKET_1058_1: stack-safe array append
// V8 implements push(...arr) via Function.apply — each element becomes a stack
// frame. Arrays over ~65K elements overflow. This helper uses a plain loop.
// =============================================================================

function pushAll<T>(target: T[], source: T[]): void {
  for (let i = 0; i < source.length; i++) {
    target.push(source[i]);
  }
}

function dcmT(key: string, params?: Record<string, string | number>): string {
  return mainT(getCurrentMainLocale(), 'ui', key, params);
}

// =============================================================================
// TICKET_986: incomplete-day clamp
// =============================================================================

const MS_PER_DAY = 86_400_000;

/**
 * TICKET_986 Layer 1 clamp. When `endMs` falls on the current UTC day
 * (in-progress), roll it back to yesterday 23:59:59.999 UTC so
 * `assertNoMissingTradingDays` never enumerates a day the provider
 * structurally cannot have completed yet.
 *
 * For archival providers whose `endDate` is in the past, this is a
 * no-op -- `endMs` is already before today.
 */
function clampEndMsToCompletedDay(endMs: number): number {
  const todayMs = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY;
  if (endMs >= todayMs) {
    return todayMs - 1;
  }
  return endMs;
}

// =============================================================================
// Types
// =============================================================================

export interface CacheFileRecord {
  id: number;
  symbol: string;
  interval: string;
  provider: string;
  filePath: string;
  /**
   * TICKET_372 metadata-virtual first/last timestamp. Used ONLY for the
   * Coverage decision (needPrepend / needAppend) so a confirmed-empty
   * historical range is not re-fetched on every run. Will diverge from
   * the on-disk parquet's true extents whenever the virtual extension
   * fires (`Math.min(realFirst, requestedStartTs)`).
   */
  firstTimestamp: number;
  lastTimestamp: number;
  /**
   * TICKET_962 R2 parquet-truth timestamps. The actual min/max of the
   * `timestamp` column inside the parquet on disk, read from row-group
   * statistics (no full materialisation). Populated by the post-write
   * upsert in `doEnsureData` and by the startup back-fill
   * `backfillActualTimestamps`. Decision sites MUST use the virtual
   * `firstTimestamp` / `lastTimestamp`; every other consumer (UI badges,
   * the `Append complete` log line, future bar-materialising code) MUST
   * use these (TICKET_858 -- no silent virtual-coverage lie).
   *
   * `null` only between schema migration v99 and the post-init back-fill
   * completing. Read consumers MUST treat `null` as fail-fast (the
   * back-fill is on the boot path; reads cannot legitimately race it).
   */
  actualFirstTimestamp: number | null;
  actualLastTimestamp: number | null;
  rowCount: number;
  sourceType: 'base' | 'aggregated';
  baseFileId: number | null;
  updatedAt: string;
  /** TICKET_1072_1: 0.0–1.0 ratio of actual/expected trading days. */
  completeness: number;
  /** TICKET_1072_1: epoch-ms of missing trading days (null = fully complete). */
  missingDaysJson: string | null;
  /** TICKET_1099: persisted parquet codec (null for pre-migration rows). */
  codec: string | null;
  /**
   * TICKET_1126 F5: monotonically increasing data-content revision.
   * Bumped by `upsertMetadata` on EVERY parquet-content write (download
   * append, heal, aggregation, import, repair) -- never by decision-only
   * metadata touches (`upsertVirtualCoverageOnly`). The eval-cache
   * fingerprint incorporates it so a data repair can never be silently
   * negated by a stale cache entry. DB-managed: callers never set it;
   * it is populated on read and bumped in SQL on write.
   */
  contentRevision?: number;
}

export interface EnsureDataResult {
  filePath: string;
  rowCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  /** TICKET_351_P2: true when ensureData returned early due to shouldYield() */
  yielded?: boolean;
  /**
   * TICKET_962 P1: present when the requested [startDate, endDate] window was
   * clamped down to the provider's declared `maxLookback[interval]`. Anchored
   * to the requested endDate (NOT wall-clock) so replay / fixed-end-date
   * research runs clamp correctly. Surface this as a typed warning at every
   * IPC boundary (TICKET_858 no silent downgrade).
   */
  clamp?: {
    requestedStartDate: string;
    clampedStartDate: string;
    providerId: string;
    maxLookbackSpec: string;
  };
  /** TICKET_1078: number of chunks skipped due to transient provider errors.
   *  Non-zero means the parquet may have interior date gaps. */
  skippedChunks?: number;
  /** TICKET_1072_1: trading-day completeness diagnostic. */
  missingDaysResult?: MissingDaysResult;
}

/** TICKET_351_P2: Cooperative preemption control for priority queue */
export interface DownloadControl {
  /** Hard cancellation (user cancel, app shutdown) */
  signal?: AbortSignal;
  /** Soft preemption check -- called after each chunk, return true to yield */
  shouldYield?: () => boolean;
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

/**
 * TICKET_308_1 (Phase 4/6): a BYOD imported-package catalog row
 * (`imported_packages`, migration v76). `packageName` is the catalog join key
 * that mirrors `data_cache_files.provider` for every file in the package.
 */
export interface ImportedPackageRecord {
  packageName: string;
  adjustMode: 'none' | 'qfq' | 'hfq';
  sourceDialect: ImportSourceDialect;
  createdAt: number;
  /**
   * TICKET_919_9: self-declared per-interval calendar padding ratio, computed
   * at registerImportedPackage time from the package's own
   * `data_cache_files` rows. Same shape as
   * `IDataProvider.capabilities.calendarPaddingRatio`. An interval missing
   * from this map means "no usable rows for this interval at import time" --
   * `pullBarsToCalendarMs` will throw with a re-import recovery message
   * rather than silently fall back to 1.0 (the 24/7 default the
   * pre-919_9 read path used). The empty map `{}` is the legitimate
   * zero-row case.
   */
  calendarPaddingRatio: Readonly<Record<string, number>>;
  /**
   * TICKET_919_10: declared publisher release schedule. Determines the
   * orchestrator's window-end anchor via `resolveArchivalCadenceEndMs`:
   * `realtime` keeps today's `Date.now()` anchor; `monthly_archive` /
   * `weekly_archive` / `daily_eod` floor the cohort p90 of per-symbol
   * lastTimestamp to the cadence's last published boundary; `snapshot`
   * (the default for general-purpose imports) returns the cohort p90
   * unfloored. Importer flows that know the source's release schedule
   * (HistData CSV, Dukascopy month dumps) pass an explicit cadence to
   * `registerImportedPackage`; otherwise the dialect default applies.
   */
  archivalCadence: ArchivalCadence;
  /** TICKET_1095: persisted asset class. Resolved at import time from manifest
   *  or inferred from symbol shapes. */
  assetClass: string;
}

/**
 * TICKET_919_9 -- parse the `calendar_padding_ratio_json` column
 * defensively. A successful parse + object-shape returns the map; any
 * malformed value returns `{}`, which makes the read path
 * (`pullBarsToCalendarMs`) throw with the re-import recovery message
 * instead of letting a corrupted row silently fall back to ratio=1.0.
 * Per-key sanitisation drops non-finite / non-positive entries so a
 * bad value cannot override a good one.
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

/** Progress callback for external consumers (e.g., download queue) */
type ProgressCallback = (progress: number, message: string) => void;

/** TICKET_1051 P1 AC8: per-symbol bar-level progress emitted after each chunk */
export interface SymbolBarProgress {
  downloadedBars: number;
  estimatedTotalBars: number;
  currentYear: number | null;
}
type BarProgressCallback = (progress: SymbolBarProgress) => void;

/** TICKET_1070 AC3: chunk-level date range emitted after each chunk */
export interface ChunkDateRange {
  chunkStart: string;
  chunkEnd: string;
  completedChunks: number;
  totalChunks: number;
}
type ChunkDateRangeCallback = (range: ChunkDateRange) => void;

/** Chunk size in months per interval category */
const CHUNK_MONTHS: Record<string, number> = {
  [INTERVAL_1m]:  1,
  [INTERVAL_5m]:  1,
  [INTERVAL_15m]: 3,
  [INTERVAL_30m]: 3,
  [INTERVAL_1h]:  6,
  [INTERVAL_4h]:  6,
};

// TICKET_1078: chunk-level retry constants
const CHUNK_RETRY_BACKOFF_BASE_MS = 2000;
const CHUNK_RETRY_BACKOFF_MAX_MS = 15000;

interface DateChunk {
  startDate: string;
  endDate: string;
}

// DB row shape
interface CacheFileRow {
  id: number;
  symbol: string;
  interval: string;
  provider: string;
  file_path: string;
  first_timestamp: number;
  last_timestamp: number;
  // TICKET_962 R2: nullable until the post-init backfill resolves them.
  actual_first_timestamp: number | null;
  actual_last_timestamp: number | null;
  row_count: number;
  source_type: string;
  base_file_id: number | null;
  updated_at: string;
  // TICKET_1072_1: trading-day completeness.
  completeness: number | null;
  missing_days: string | null;
  // TICKET_1099: persisted parquet codec (null for pre-migration rows).
  codec: string | null;
  // TICKET_1126 F5: data-content revision (bumped on every content write).
  content_revision: number | null;
}

// =============================================================================
// DataCacheManager
// =============================================================================

class DataCacheManager {
  /**
   * Per-key async mutex: prevents concurrent appends to the same file.
   * While a promise exists for a key, subsequent callers await it.
   */
  private pendingOps = new Map<string, Promise<EnsureDataResult>>();

  /** Per-key async mutex for aggregation: prevents concurrent writes to the same aggregated file. */
  private pendingAggOps = new Map<string, Promise<EnsureDataResult>>();

  private bootstrapDone = false;

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Ensure data is available for the given range.
   * Returns the stable file path containing all requested data.
   *
   * Per-key mutex prevents concurrent writes to the same file.
   */
  async ensureData(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string,
    provider: IDataProvider,
    opts?: {
      forceDownload?: boolean;
      onProgress?: ProgressCallback;
      onBarProgress?: BarProgressCallback;
      onChunkDateRange?: ChunkDateRangeCallback;
      resumeProgress?: number;
      /** TICKET_1078: per-chunk retry count for transient provider errors.
       *  0 = no retries (1 attempt only). Absent = default (2 retries). */
      chunkRetryCount?: number;
    },
    control?: DownloadControl
  ): Promise<EnsureDataResult> {
    const key = `${symbol}|${interval}|${provider.id}`;

    // Mutex: if another operation is in-flight for this key, wait for it
    while (this.pendingOps.has(key)) {
      await this.pendingOps.get(key)!.catch(() => {});
    }

    const promise = this.doEnsureData(symbol, interval, startDate, endDate, provider, opts, control);
    this.pendingOps.set(key, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.pendingOps.delete(key);
    }
  }

  /**
   * Ensure an aggregated file exists and is up-to-date.
   * If the base file has been updated since the aggregate was last written,
   * re-aggregate from base rows.
   */
  async ensureAggregatedFile(
    symbol: string,
    timeframe: string,
    provider: IDataProvider,
    baseFileId: number,
    baseFilePath: string,
    /**
     * TICKET_196_12 Step 4: the interval the supplied `baseRows` actually carry.
     * Defaults to `provider.capabilities.baseInterval` to preserve the existing
     * multi-timeframe caller (data-storage-service.ts), which always fetches the
     * declared base. The single-timeframe path (Step 4) passes the
     * resolver-chosen base, which may be COARSER than the declared baseInterval
     * (e.g. Alpaca declares baseInterval='1m' but `resolveFetchPlan` rolls 4h up
     * from 1h to minimise fetch volume). Passing the real source interval keeps
     * the aggregation strategy's source-vs-target validation honest.
     */
    sourceInterval?: string,
    requestedWindow?: { startMs: number; endMs: number },
  ): Promise<EnsureDataResult> {
    const key = `${symbol}|${timeframe}|${provider.id}`;

    // Mutex: wait for in-flight aggregation of same key
    while (this.pendingAggOps.has(key)) {
      await this.pendingAggOps.get(key)!.catch(() => {});
    }

    const promise = this.doEnsureAggregatedFile(
      symbol, timeframe, provider, baseFileId, baseFilePath,
      sourceInterval, requestedWindow,
    );
    this.pendingAggOps.set(key, promise);

    try {
      return await promise;
    } finally {
      this.pendingAggOps.delete(key);
    }
  }

  private async doEnsureAggregatedFile(
    symbol: string,
    timeframe: string,
    provider: IDataProvider,
    baseFileId: number,
    baseFilePath: string,
    sourceInterval?: string,
    requestedWindow?: { startMs: number; endMs: number },
  ): Promise<EnsureDataResult> {
    const cacheService = getParquetCacheService();
    const aggRecord = this.getMetadata(symbol, timeframe, provider.id);
    const baseRecord = this.getMetadataById(baseFileId);

    // If aggregate exists and is not stale, return it
    if (aggRecord && baseRecord && !this.isAggregateStale(baseRecord, aggRecord)) {
      appLog.info(`[DataCacheManager] Aggregate cache hit for ${symbol}/${timeframe}`);
      return {
        filePath: aggRecord.filePath,
        rowCount: aggRecord.rowCount,
        firstTimestamp: aggRecord.firstTimestamp,
        lastTimestamp: aggRecord.lastTimestamp,
      };
    }

    // The C++ owner reads only the exact requested window, aggregates with the
    // explicit provider session calendar, and atomically publishes the result.
    const aggregationService = getAggregationService();
    void sourceInterval;
    const actualStart = baseRecord?.actualFirstTimestamp;
    const actualEnd = baseRecord?.actualLastTimestamp;
    if (actualStart === null || actualStart === undefined ||
        actualEnd === null || actualEnd === undefined) {
      throw new Error(`Base cache metadata lacks actual extents for ${symbol}/${timeframe}`);
    }
    const startMs = requestedWindow?.startMs ?? actualStart * MS_PER_SECOND;
    const endMs = requestedWindow?.endMs ?? actualEnd * MS_PER_SECOND;
    const stablePath = cacheService.getStablePath(symbol, timeframe, provider.id);
    const decision = await aggregationService.aggregateToCanonicalFile({
      inputPath: baseFilePath,
      outputPath: stablePath,
      symbol,
      targetInterval: timeframe,
      startMs,
      endMs,
      provider,
    });
    if (decision.rowCount === 0 || !decision.extent) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataCache.aggregationNoData', { timeframe }));
    }

    // Upsert metadata
    const firstTs = Math.floor(decision.extent.startMs / MS_PER_SECOND);
    const lastTs = Math.floor(decision.extent.endMs / MS_PER_SECOND);
    this.upsertMetadata({
      id: aggRecord?.id || 0,
      symbol,
      interval: timeframe,
      provider: provider.id,
      filePath: stablePath,
      firstTimestamp: firstTs,
      lastTimestamp: lastTs,
      // TICKET_962 P2: aggregate writer just wrote `deduped` to disk;
      // first/last ARE the parquet-truth extents.
      actualFirstTimestamp: firstTs,
      actualLastTimestamp: lastTs,
      rowCount: decision.rowCount,
      sourceType: 'aggregated',
      baseFileId,
      updatedAt: new Date().toISOString(),
      completeness: 1.0, missingDaysJson: null,
      codec: decision.codec.toUpperCase(),
    });

    appLog.info(
      `[DataCacheManager] Aggregated ${symbol}/${timeframe}: ${decision.rowCount} rows decision=${decision.decisionId}`,
    );

    return {
      filePath: stablePath,
      rowCount: decision.rowCount,
      firstTimestamp: firstTs,
      lastTimestamp: lastTs,
    };
  }

  /**
   * TICKET_196_12 Step 4: produce a NON-native target timeframe on the
   * single-timeframe path by aggregating a finer native base bar.
   *
   * Reuses the exact machinery already proven on the multi-timeframe path
   * (data-storage-service.ts:235): ensure the base interval once (this re-enters
   * `ensureData`, where the base resolves to a `native` plan and downloads
   * normally), read its rows, then roll up via `ensureAggregatedFile` (which
   * owns the aggregate-staleness + metadata-upsert + per-key mutex). No download
   * or merge logic is duplicated here.
   *
   * `baseInterval` and `target` come from `resolveFetchPlan`; `target` is the
   * caller's requested (non-native) interval, `baseInterval` the coarsest native
   * bar that evenly divides it.
   */
  private async ensureAggregateData(
    symbol: string,
    baseInterval: string,
    target: string,
    startDate: string,
    endDate: string,
    provider: IDataProvider,
    opts?: {
      forceDownload?: boolean;
      onProgress?: ProgressCallback;
      resumeProgress?: number;
    },
    control?: DownloadControl
  ): Promise<EnsureDataResult> {
    appLog.info(
      `[DataCacheManager] Aggregate fetch: ${symbol}/${target} via ${provider.id} ` +
      `<- native ${baseInterval} (${startDate}~${endDate})`
    );

    // Step 1: ensure the finer native base bar (recurses; base is `native`).
    const baseResult = await this.ensureData(
      symbol, baseInterval, startDate, endDate, provider, opts, control,
    );

    // TICKET_351_P2: propagate cooperative yield from the base fetch.
    if (baseResult.yielded) {
      appLog.info(`[DataCacheManager] Aggregate fetch yielded during base ${baseInterval} for ${symbol}/${target}`);
      return baseResult;
    }

    // Step 2: locate the base file id for staleness tracking. C++ reads the
    // requested window directly from this path; Electron never materializes
    // full history for aggregation.
    const baseRecord = this.getMetadata(symbol, baseInterval, provider.id);
    const baseFileId = baseRecord?.id ?? 0;

    // Step 3: roll up to the target (reuses the aggregate-file machinery).
    const aggResult = await this.ensureAggregatedFile(
      symbol, target, provider, baseFileId, baseResult.filePath, baseInterval,
      {
        startMs: new Date(`${startDate}T00:00:00.000Z`).getTime(),
        endMs: new Date(`${endDate}T23:59:59.999Z`).getTime(),
      },
    );

    opts?.onProgress?.(100, dcmT('dataCache.dataReadyAggregated', { rowCount: aggResult.rowCount, target, baseInterval }));
    return aggResult;
  }

  /**
   * Clear all cache files and metadata.
   */
  clearAll(): number {
    const db = getDatabaseManager();
    const result = db.prepare('DELETE FROM data_cache_files').run();
    appLog.info(`[DataCacheManager] Cleared all: ${result.changes} records deleted`);
    return result.changes;
  }

  /**
   * Delete a specific cache file by id.
   */
  deleteFile(id: number): void {
    const db = getDatabaseManager();
    const row = db.prepare('SELECT file_path FROM data_cache_files WHERE id = ?').get(id) as { file_path: string } | undefined;
    if (row) {
      try {
        if (existsSync(row.file_path)) unlinkSync(row.file_path);
      } catch (err) {
        appLog.warn(`[DataCacheManager] Failed to delete file ${row.file_path}:`, err);
      }
      db.prepare('DELETE FROM data_cache_files WHERE id = ?').run(id);
    }
  }

  /**
   * Get aggregate cache statistics.
   *
   * TICKET_1276 P2 Batch C1: delegates to the shared, Electron-free
   * `@StratCraft/data-cache-store` read core so this method and the MCP
   * standalone server (Electron-absent) return byte-identical stats from the
   * same `data_cache_files` table. Single owning-layer codebase (TICKET_854).
   */
  getCacheStats(): CacheStats {
    return getCacheStatsCore(getDatabaseManager().getDb());
  }

  /**
   * List cache files with optional filters.
   *
   * TICKET_1276 P2 Batch C1: delegates to the shared
   * `@StratCraft/data-cache-store` read core (see getCacheStats note).
   */
  listFiles(filters: {
    provider?: string;
    symbol?: string;
    interval?: string;
    limit?: number;
    offset?: number;
  }): { files: CacheFileRecord[]; total: number } {
    return listCacheFilesCore(getDatabaseManager().getDb(), filters);
  }

  /**
   * Get metadata for a specific (symbol, interval, provider).
   */
  getMetadata(symbol: string, interval: string, provider: string): CacheFileRecord | null {
    const db = getDatabaseManager();
    const row = db.prepare(`
      SELECT * FROM data_cache_files
      WHERE symbol = ? AND interval = ? AND provider = ?
    `).get(symbol, interval, provider) as CacheFileRow | undefined;

    return row ? this.rowToRecord(row) : null;
  }

  // =========================================================================
  // TICKET_308_1 (Phase 4): BYOD imported-package registration
  // =========================================================================

  /**
   * Register a single imported Parquet file into `data_cache_files` so it is
   * enumerable by `listFiles` / `getCacheStats` and selectable by the picker.
   *
   * This is the load-bearing step of a BYOD import (TICKET_308 / TICKET_308_1):
   * the DuckDB importer (`DataImportService`) writes the `{symbol}_{interval}
   * .parquet` file under a package-named directory; a file on disk WITHOUT a
   * `data_cache_files` row is invisible to both the inventory and the symbol
   * picker, so registration is not optional.
   *
   * An imported file is always a fully-materialized `base` series (never an
   * on-the-fly `aggregated` derivative -- the package supplies each interval
   * directly), so `sourceType='base'` and `baseFileId=null` are fixed here.
   * `provider` carries the user-supplied package name (the catalog join key,
   * mirrored by `imported_packages.package_name`). Re-import of the same
   * (symbol, interval, package) upserts via the existing UNIQUE triple, making
   * re-runs idempotent.
   */
  registerImportedFile(record: {
    symbol: string;
    interval: string;
    packageName: string;
    filePath: string;
    firstTimestamp: number;
    lastTimestamp: number;
    rowCount: number;
  }): void {
    this.upsertMetadata({
      id: 0,
      symbol: record.symbol,
      interval: record.interval,
      provider: record.packageName,
      filePath: record.filePath,
      firstTimestamp: record.firstTimestamp,
      lastTimestamp: record.lastTimestamp,
      // TICKET_962 P2: an imported package's first/last reflect the
      // actual parquet extents at registration time -- this path has no
      // virtual extension (TICKET_372 is download-side only).
      actualFirstTimestamp: record.firstTimestamp,
      actualLastTimestamp: record.lastTimestamp,
      rowCount: record.rowCount,
      sourceType: 'base',
      baseFileId: null,
      updatedAt: new Date().toISOString(),
      completeness: 1.0, missingDaysJson: null,
      codec: null,
    });
  }

  /**
   * Upsert the `imported_packages` catalog row (migration v76) for a BYOD
   * import. This is the home of the package-level adjustment decision
   * (TICKET_308 Gate 1): adjustment (none/qfq/hfq) is declared once per package
   * at import time, NOT inferred and NOT pushed into the per-row OHLCVRow -- so
   * the TICKET_812 six-field schema stays untouched. `source_dialect` records
   * the DuckDB ATTACH dialect for provenance / re-import.
   *
   * `package_name` is the PK; a re-import of the same package updates its
   * adjust mode / dialect rather than failing, keeping the whole import
   * idempotent.
   */
  registerImportedPackage(pkg: {
    packageName: string;
    adjustMode: 'none' | 'qfq' | 'hfq';
    sourceDialect: ImportSourceDialect;
    /**
     * TICKET_919_10: optional explicit cadence override. Importer flows
     * that know the source's release schedule (HistData CSV, Dukascopy
     * month dumps) pass `'monthly_archive'`. Absent -> falls back to
     * `DIALECT_ARCHIVAL_DEFAULT[sourceDialect]`, which is `'snapshot'`
     * for every general-purpose dialect (a CSV could be anything, so
     * the safe default is "the file IS the truth, no future updates").
     */
    archivalCadence?: ArchivalCadence;
    /** TICKET_1095: asset class. Defaults to 'forex' for backward compat. */
    assetClass?: string;
  }): void {
    const db = getDatabaseManager();

    // TICKET_919_9: compute the package's self-declared per-interval calendar
    // padding ratio from the `data_cache_files` rows that the importer has
    // already written in the SAME db.transaction (every call site of this
    // method runs inside data-import-service's transaction wrapper, after all
    // `registerImportedFile` calls for the package, so the SELECT below is
    // guaranteed to see every file of the package). Persisted into
    // `calendar_padding_ratio_json` on the same UPSERT that writes
    // `adjust_mode` / `source_dialect`, so the catalog row and the ratio
    // land atomically. Per-symbol identity: ratio = (lastSec - firstSec +
    // barSec) / (rowCount * barSec); per-interval aggregate: median.
    // Intervals with no usable rows are OMITTED -- the read path
    // (`pullBarsToCalendarMs`) throws with a re-import recovery message,
    // which is the correct semantics for "we don't know this calendar"
    // (TICKET_857 / 858, no silent 1.0 fallback).
    const fileRows = db.prepare(
      `SELECT interval, first_timestamp, last_timestamp, row_count
         FROM data_cache_files
        WHERE provider = ? AND row_count > 1`,
    ).all(pkg.packageName) as Array<{
      interval: string;
      first_timestamp: number;
      last_timestamp: number;
      row_count: number;
    }>;
    const ratios = computePackageCalendarRatios(
      fileRows.map((row) => ({
        interval: row.interval,
        firstTimestamp: row.first_timestamp,
        lastTimestamp: row.last_timestamp,
        rowCount: row.row_count,
      })),
    );

    // TICKET_919_10: archival cadence. Caller-supplied value wins; otherwise
    // fall back to the dialect default (snapshot for every general-purpose
    // dialect). The CHECK constraint at v86 enforces the enum; the runtime
    // narrowing here gives a clearer error if a future caller passes an
    // invalid string than letting SQLite raise a CHECK violation deep in
    // the transaction.
    const cadence: ArchivalCadence =
      pkg.archivalCadence ?? DIALECT_ARCHIVAL_DEFAULT[pkg.sourceDialect];
    if (!IMPORTED_ARCHIVAL_CADENCES.includes(cadence)) {
      throw new Error(
        `[registerImportedPackage] invalid archivalCadence '${cadence}' for ` +
        `package '${pkg.packageName}'. Valid: ${IMPORTED_ARCHIVAL_CADENCES.join(', ')}. ` +
        `(TICKET_919_10)`,
      );
    }

    const assetClass = pkg.assetClass ?? 'forex';

    db.prepare(`
      INSERT INTO imported_packages
        (package_name, adjust_mode, source_dialect, calendar_padding_ratio_json, archival_cadence, asset_class)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(package_name)
      DO UPDATE SET
        adjust_mode = excluded.adjust_mode,
        source_dialect = excluded.source_dialect,
        calendar_padding_ratio_json = excluded.calendar_padding_ratio_json,
        archival_cadence = excluded.archival_cadence,
        asset_class = excluded.asset_class
    `).run(
      pkg.packageName,
      pkg.adjustMode,
      pkg.sourceDialect,
      JSON.stringify(ratios),
      cadence,
      assetClass,
    );
  }

  /**
   * Look up a BYOD imported-package catalog row by name (migration v76).
   *
   * TICKET_308_1 (Phase 6): this is the discriminator the `data:ensure`
   * run-path fork uses to tell an imported package apart from a live provider.
   * A `provider` string is an imported package IFF it has a row here -- live
   * providers (`yfinance`, `baostock`, ...) are registered in
   * `DataProviderManager` and never appear in `imported_packages`. The read
   * lives on `DataCacheManager` (the owner of this table, alongside
   * `registerImportedPackage`) so the fork never has to reach into the DB
   * directly -- the most-direct-layer fix (TICKET_860).
   *
   * Returns null when the name is not an imported package (i.e. it is a live
   * provider id, or unknown).
   */
  getImportedPackage(packageName: string): ImportedPackageRecord | null {
    const db = getDatabaseManager();
    const row = db.prepare(`
      SELECT package_name, adjust_mode, source_dialect, created_at,
             calendar_padding_ratio_json, archival_cadence, asset_class
      FROM imported_packages
      WHERE package_name = ?
    `).get(packageName) as
      | {
          package_name: string;
          adjust_mode: string;
          source_dialect: string;
          created_at: number;
          calendar_padding_ratio_json: string;
          archival_cadence: string;
          asset_class: string;
        }
      | undefined;

    if (!row) return null;

    return {
      packageName: row.package_name,
      adjustMode: row.adjust_mode as 'none' | 'qfq' | 'hfq',
      sourceDialect: row.source_dialect as ImportSourceDialect,
      createdAt: row.created_at,
      calendarPaddingRatio: parseRatioJson(row.calendar_padding_ratio_json),
      archivalCadence: row.archival_cadence as ArchivalCadence,
      assetClass: row.asset_class,
    };
  }

  /**
   * TICKET_919_10 + TICKET_958_2: cadence-aware window-end resolver.
   *
   * Single owning layer for "what is the freshest bar this package can
   * give us right now, given its publisher release schedule?". Reads the
   * package row + per-symbol metadata that already live in this
   * manager, and delegates the algorithm to
   * `resolveArchivalCadenceEndMs` (a pure helper with unit tests).
   *
   * Resolution order (first matching branch wins):
   *   - undefined provider                                 -> `asOfMs`
   *   - imported_packages row exists (user's explicit
   *     declaration always wins; TICKET_919_10):
   *       cadence === 'realtime'                           -> `asOfMs`
   *       otherwise                                        -> cohort anchor
   *   - built-in provider with `capabilities.archivalCadence`
   *     (TICKET_958_2 new branch):
   *       cadence omitted / 'realtime' (default)           -> `asOfMs`
   *       otherwise                                        -> cohort anchor
   *
   * INVARIANT: imported_packages > built-in capability. A provider that
   * appears in both takes the user's explicit `imported_packages`
   * cadence; the built-in capability is the default for providers that
   * never reach `imported_packages` (Databento and any future snapshot/
   * archive-shaped built-in).
   *
   * Cohort tail source is `actualLastTimestamp` -- the parquet-truth
   * field maintained by TICKET_962 R2. The virtual `lastTimestamp` is
   * extended on download to the requested endDate and would re-introduce
   * the phantom-tail bug whenever a download was requested past the
   * physical tail (TICKET_958_2 root-cause analysis).
   *
   * Behaviour for live providers is bit-exact today's `Date.now()`.
   * Behaviour for `monthly_archive` / `weekly_archive` / `daily_eod` /
   * `snapshot` eliminates the publisher-lag empty tail at the call site.
   *
   * Used by the discovery orchestrator's six end-anchor sites AND by
   * the statistical validator's `ensure OHLCV` step -- both now route
   * through the same helper so the invariant is held centrally
   * (TICKET_854 reuse, TICKET_860 single owning layer). Callers MUST
   * derive `startMs = endMs - windowMs` off the value returned here,
   * not off `Date.now() - windowMs`.
   */
  resolveArchivalCadenceEndMsFor(
    provider: string | undefined,
    interval: string,
    symbols: ReadonlyArray<string>,
    asOfMs: number,
  ): number {
    if (!provider) return asOfMs;

    // INVARIANT: imported_packages row (TICKET_919_10) is the user's explicit,
    // vetted declaration and wins over the built-in capability default.
    const pkg = this.getImportedPackage(provider);
    if (pkg) {
      if (pkg.archivalCadence === 'realtime') return asOfMs;
      return this.applyCohortAnchor(pkg.archivalCadence, provider, interval, symbols, asOfMs);
    }

    // TICKET_958_2: built-in providers self-declare via
    // `IDataProvider.capabilities.archivalCadence`. Live providers
    // (yfinance / Alpaca / CCXT / Dukascopy / Baostock / AKShare / Tushare
    // / ClickHouse) omit the field -> bit-exact today's `Date.now()`
    // behaviour. Snapshot/archive-shaped built-ins (Databento today)
    // declare a non-'realtime' cadence and get a cohort-anchored endMs.
    const capCadence = getDataProviderManager()
      .getProvider(provider)?.capabilities.archivalCadence ?? 'realtime';
    if (capCadence === 'realtime') return asOfMs;
    return this.applyCohortAnchor(capCadence, provider, interval, symbols, asOfMs);
  }

  /**
   * TICKET_958_2: shared cohort-anchor reducer used by both the
   * imported_packages branch and the built-in capability branch of
   * `resolveArchivalCadenceEndMsFor`.
   *
   * Uses `actualLastTimestamp` (parquet-truth, TICKET_962 R2) -- NOT
   * `lastTimestamp` (virtual coverage, extended on download). Mirrors
   * the original `lastTimestamp > 0` guard by excluding rows whose
   * `actualLastTimestamp` is null (pre-v99 rows whose post-init
   * backfill has not yet completed) or non-positive.
   *
   * TICKET_858 surfacing: when the cohort anchor is strictly earlier
   * than `asOfMs` the anchor was load-bearing -- the caller would have
   * over-shot the parquet's physical tail without this resolution. A
   * single warn-level log per (provider, interval) call site is emitted
   * so operators debugging a refused sweep can see the binding
   * constraint at a glance.
   */
  private applyCohortAnchor(
    cadence: ArchivalCadence,
    provider: string,
    interval: string,
    symbols: ReadonlyArray<string>,
    asOfMs: number,
  ): number {
    const cohort: ResolvedSymbolTail[] = [];
    for (const sym of symbols) {
      const record = this.getMetadata(sym, interval, provider);
      const tail = record?.actualLastTimestamp;
      if (tail !== null && tail !== undefined && tail > 0) {
        cohort.push({ symbol: sym, lastTimestamp: tail });
      }
    }
    const anchorMs = resolveArchivalCadenceEndMs(cadence, cohort, asOfMs);
    if (anchorMs < asOfMs) {
      appLog.warn(
        `[DataCacheManager] cohort-anchored endMs for provider=${provider} interval=${interval} ` +
        `cadence=${cadence}: anchor=${anchorMs} < asOfMs=${asOfMs} ` +
        `(deltaMs=${asOfMs - anchorMs}, cohortSize=${cohort.length}). ` +
        `Window-end is bounded by parquet tail, not wall-clock. ` +
        `If a downstream gate refuses with actualBars<requiredBars, this anchor is the binding constraint.`,
      );
    }
    return anchorMs;
  }

  /**
   * List every BYOD imported-package catalog row (migration v76), newest first.
   *
   * TICKET_308_1a (Phase 7): the list counterpart of {@link getImportedPackage}.
   * The picker source feed needs to ENUMERATE all imported packages (so each can
   * appear as its own selectable "Imported" source), which the single-name
   * lookup cannot do. It lives here because `DataCacheManager` owns
   * `imported_packages` -- the most-direct layer (TICKET_860), so the picker /
   * IPC layer never reaches into the DB directly.
   */
  listImportedPackages(): ImportedPackageRecord[] {
    // TICKET_1276 P2 Batch C1: delegates to the shared
    // `@StratCraft/data-cache-store` read core (see getCacheStats note). The
    // core returns the widely-typed catalog rows (`source_dialect` /
    // `archival_cadence` as `string`); narrow them back to the Electron enums
    // here -- the CHECK constraints at migration time already guarantee the
    // values are valid members.
    return listImportedPackagesCore(getDatabaseManager().getDb()).map((pkg) => ({
      packageName: pkg.packageName,
      adjustMode: pkg.adjustMode,
      sourceDialect: pkg.sourceDialect as ImportSourceDialect,
      createdAt: pkg.createdAt,
      calendarPaddingRatio: pkg.calendarPaddingRatio,
      archivalCadence: pkg.archivalCadence as ArchivalCadence,
      assetClass: pkg.assetClass,
    }));
  }

  listImportedPackageSummaries(): ImportedPackageSummary[] {
    return listImportedPackageSummariesCore(getDatabaseManager().getDb());
  }

  buildCoverageReport(packageName: string): PackageCoverageReport {
    return buildCoverageReportCore(getDatabaseManager().getDb(), packageName);
  }

  buildCoverageReportCsv(packageName: string): string {
    const report = this.buildCoverageReport(packageName);
    return coverageReportToCsv(report);
  }

  listImportedPackageFiles(packageName: string): Array<{
    symbol: string;
    interval: string;
    firstTimestamp: number;
    lastTimestamp: number;
    rowCount: number;
  }> {
    const db = getDatabaseManager();
    const rows = db.prepare(`
      SELECT symbol, interval, first_timestamp, last_timestamp, row_count
      FROM data_cache_files
      WHERE provider = ?
      ORDER BY symbol, interval
    `).all(packageName) as Array<{
      symbol: string;
      interval: string;
      first_timestamp: number;
      last_timestamp: number;
      row_count: number;
    }>;
    return rows.map((row) => ({
      symbol: row.symbol,
      interval: row.interval,
      firstTimestamp: row.first_timestamp,
      lastTimestamp: row.last_timestamp,
      rowCount: row.row_count,
    }));
  }

  /**
   * TICKET_919_5: Distinct interval set actually present for an imported
   * package. Used by (a) DataSourcePicker to constrain the timeframe
   * selector to what the package can satisfy, and (b)
   * resolveLocalOrDownloadUniverse to short-circuit with a single
   * structured error when the user (or a stale config) asks for an
   * interval the package never imported -- replacing the 66-line wall
   * of per-symbol "No imported data for X/1w" failures with one
   * IMPORTED_PACKAGE_INTERVAL_UNAVAILABLE root-cause message.
   */
  getImportedPackageIntervals(packageName: string): string[] {
    const db = getDatabaseManager();
    const rows = db.prepare(`
      SELECT DISTINCT interval
      FROM data_cache_files
      WHERE provider = ?
      ORDER BY interval
    `).all(packageName) as Array<{ interval: string }>;
    return rows.map((row) => row.interval);
  }

  removeImportedPackage(packageName: string): { deletedFiles: number } {
    const db = getDatabaseManager();

    const rows = db.prepare(
      'SELECT id, file_path FROM data_cache_files WHERE provider = ?',
    ).all(packageName) as Array<{ id: number; file_path: string }>;

    for (const row of rows) {
      try {
        if (existsSync(row.file_path)) unlinkSync(row.file_path);
      } catch (err) {
        appLog.warn(`[DataCacheManager] Failed to delete file ${row.file_path}:`, err);
      }
    }

    db.prepare('DELETE FROM data_cache_files WHERE provider = ?').run(packageName);
    db.prepare('DELETE FROM imported_packages WHERE package_name = ?').run(packageName);

    appLog.info(
      `[DataCacheManager] Removed package '${packageName}': ${rows.length} cache files deleted`,
    );
    return { deletedFiles: rows.length };
  }

  checkImportedPackageHealth(packageName: string): Array<{
    symbol: string;
    interval: string;
    filePath: string;
    exists: boolean;
  }> {
    const db = getDatabaseManager();
    const rows = db.prepare(
      'SELECT symbol, interval, file_path FROM data_cache_files WHERE provider = ?',
    ).all(packageName) as Array<{ symbol: string; interval: string; file_path: string }>;

    return rows.map((row) => ({
      symbol: row.symbol,
      interval: row.interval,
      filePath: row.file_path,
      exists: existsSync(row.file_path),
    }));
  }

  async checkImportedPackageIntegrity(packageName: string): Promise<Array<{
    symbol: string;
    interval: string;
    filePath: string;
    status: 'ok' | 'missing' | 'corrupt' | 'row_count_mismatch' | 'timestamp_drift';
    detail?: string;
  }>> {
    const db = getDatabaseManager();
    const rows = db.prepare(
      `SELECT symbol, interval, file_path, row_count, first_timestamp, last_timestamp,
              actual_first_timestamp, actual_last_timestamp
       FROM data_cache_files WHERE provider = ?`,
    ).all(packageName) as Array<{
      symbol: string;
      interval: string;
      file_path: string;
      row_count: number;
      first_timestamp: number;
      last_timestamp: number;
      actual_first_timestamp: number | null;
      actual_last_timestamp: number | null;
    }>;

    const parquet = await import('@dsnp/parquetjs');

    const results: Array<{
      symbol: string;
      interval: string;
      filePath: string;
      status: 'ok' | 'missing' | 'corrupt' | 'row_count_mismatch' | 'timestamp_drift';
      detail?: string;
    }> = [];

    for (const row of rows) {
      if (!existsSync(row.file_path)) {
        results.push({ symbol: row.symbol, interval: row.interval, filePath: row.file_path, status: 'missing' });
        continue;
      }

      try {
        const reader = await parquet.ParquetReader.openFile(row.file_path);
        try {
          const md = reader.metadata as unknown as {
            num_rows?: number;
          };
          const physicalRowCount = md.num_rows ?? 0;

          if (physicalRowCount !== row.row_count) {
            results.push({
              symbol: row.symbol, interval: row.interval, filePath: row.file_path,
              status: 'row_count_mismatch',
              detail: `DB=${row.row_count} parquet=${physicalRowCount}`,
            });
            continue;
          }

          // Spot-check first row timestamp against DB metadata.
          // Full scan is too expensive; first-row check catches truncation
          // and re-write drift. actual_first_timestamp (v99) is the
          // authoritative bound when present.
          const refFirst = row.actual_first_timestamp ?? row.first_timestamp;
          const cursor = reader.getCursor();
          const firstRow: unknown = await cursor.next();
          if (
            typeof firstRow === 'object'
            && firstRow !== null
            && 'timestamp' in firstRow
            && firstRow.timestamp != null
          ) {
            const physFirst = Number(firstRow.timestamp);
            if (physFirst !== refFirst) {
              results.push({
                symbol: row.symbol, interval: row.interval, filePath: row.file_path,
                status: 'timestamp_drift',
                detail: `DB first=${refFirst} parquet first=${physFirst}`,
              });
              continue;
            }
          }

          results.push({ symbol: row.symbol, interval: row.interval, filePath: row.file_path, status: 'ok' });
        } finally {
          await reader.close();
        }
      } catch {
        results.push({ symbol: row.symbol, interval: row.interval, filePath: row.file_path, status: 'corrupt' });
      }
    }

    return results;
  }

  auditImportedPackageOrphans(packageName: string): {
    orphanFiles: string[];
    missingFiles: string[];
  } {
    const db = getDatabaseManager();
    const cacheService = getParquetCacheService();
    const packageDir = join(cacheService.getCacheDir(), packageName);

    const dbRows = db.prepare(
      'SELECT file_path FROM data_cache_files WHERE provider = ?',
    ).all(packageName) as Array<{ file_path: string }>;
    const dbPaths = new Set(dbRows.map((r) => r.file_path));

    const orphanFiles: string[] = [];
    const missingFiles: string[] = [];

    if (existsSync(packageDir)) {
      const diskFiles = readdirSync(packageDir)
        .filter((f) => f.endsWith('.parquet'))
        .map((f) => join(packageDir, f));
      for (const diskPath of diskFiles) {
        if (!dbPaths.has(diskPath)) {
          orphanFiles.push(diskPath);
        }
      }
    }

    for (const dbPath of dbPaths) {
      if (!existsSync(dbPath)) {
        missingFiles.push(dbPath);
      }
    }

    return { orphanFiles, missingFiles };
  }

  /**
   * Bootstrap legacy Parquet files into data_cache_files on first init.
   * Scans parquet directory for {symbol}_{interval}_{startDate}_{endDate}.parquet files,
   * picks the largest per (symbol, interval, provider), renames to stable path, inserts metadata.
   */
  async bootstrapLegacyFiles(): Promise<void> {
    if (this.bootstrapDone) return;
    this.bootstrapDone = true;

    const db = getDatabaseManager();
    const existing = db.prepare('SELECT COUNT(*) AS cnt FROM data_cache_files').get() as { cnt: number };
    if (existing.cnt > 0) {
      appLog.info('[DataCacheManager] data_cache_files already has records, skipping bootstrap');
      return;
    }

    const cacheService = getParquetCacheService();
    const cacheDir = cacheService.getCacheDir();

    if (!existsSync(cacheDir)) return;

    // Scan provider subdirectories
    const entries = readdirSync(cacheDir, { withFileTypes: true });
    let bootstrapped = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const providerDir = join(cacheDir, entry.name);
      const provider = entry.name;
      const files = readdirSync(providerDir).filter(f => f.endsWith('.parquet'));

      // Group by (symbol, interval)
      const groups = new Map<string, Array<{ fileName: string; size: number }>>();

      for (const file of files) {
        // Pattern: {symbol}_{interval}_{startDate}_{endDate}.parquet
        const match = file.match(/^(.+?)_([\dA-Za-z]+)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.parquet$/);
        if (!match) continue;

        const [, symbol, interval] = match;
        const key = `${symbol}|${interval}`;
        const filePath = join(providerDir, file);
        const size = statSync(filePath).size;

        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push({ fileName: file, size });
      }

      // For each group, pick the largest file, rename to stable path, insert metadata
      for (const [key, fileEntries] of groups) {
        const [symbol, interval] = key.split('|');
        fileEntries.sort((a, b) => b.size - a.size);
        const best = fileEntries[0];
        const sourcePath = join(providerDir, best.fileName);

        try {
          const { DuckDBInstance } = await import('@duckdb/node-api');
          const instance = await DuckDBInstance.create(':memory:');
          const conn = await instance.connect();
          let legacyStats: {
            min_ts: number | bigint | null;
            max_ts: number | bigint | null;
            row_count: number | bigint;
          };
          try {
            const escapedPath = sourcePath.replace(/'/g, "''");
            const reader = await conn.runAndReadAll(
              `SELECT CAST(MIN(timestamp) AS BIGINT) AS min_ts, ` +
                `CAST(MAX(timestamp) AS BIGINT) AS max_ts, ` +
                `COUNT(*) AS row_count FROM read_parquet('${escapedPath}')`,
            );
            const row = reader.getRowObjectsJS()[0];
            legacyStats = {
              min_ts: row?.min_ts === null || row?.min_ts === undefined
                ? null
                : Number(row.min_ts),
              max_ts: row?.max_ts === null || row?.max_ts === undefined
                ? null
                : Number(row.max_ts),
              row_count: Number(row?.row_count ?? 0),
            };
          } finally {
            conn.closeSync();
            instance.closeSync();
          }
          if (
            legacyStats.min_ts === null ||
            legacyStats.max_ts === null ||
            Number(legacyStats.row_count) === 0
          ) {
            continue;
          }
          const stablePath = cacheService.getStablePath(symbol, interval, provider);
          const canonical = await cacheService.canonicalizeExistingParquet(
            stablePath,
            sourcePath,
            {
              symbol,
              startMs: Number(legacyStats.min_ts) * MS_PER_SECOND,
              endMs: Number(legacyStats.max_ts) * MS_PER_SECOND,
              timestampUnit: 's',
              providerOrAssetClass: provider,
              interval,
              minimumOutputRows: Number(legacyStats.row_count),
            },
          );
          if (!canonical.success || !canonical.decision?.extent) {
            throw new Error(
              canonical.error ||
                `C++ legacy canonicalization returned no extent for ${sourcePath}`,
            );
          }
          if (sourcePath !== stablePath && existsSync(sourcePath)) {
            unlinkSync(sourcePath);
          }

          // Insert metadata
          const firstTs = Math.floor(
            canonical.decision.extent.startMs / MS_PER_SECOND,
          );
          const lastTs = Math.floor(
            canonical.decision.extent.endMs / MS_PER_SECOND,
          );
          this.upsertMetadata({
            id: 0,
            symbol,
            interval,
            provider,
            filePath: stablePath,
            firstTimestamp: firstTs,
            lastTimestamp: lastTs,
            // TICKET_962 P2: legacy bootstrap just read `rows` from disk;
            // first/last ARE the parquet truth.
            actualFirstTimestamp: firstTs,
            actualLastTimestamp: lastTs,
            rowCount: canonical.decision.rowCount,
            sourceType: 'base',
            baseFileId: null,
            updatedAt: new Date().toISOString(),
            completeness: 1.0, missingDaysJson: null,
            codec: canonical.decision.codec,
          });

          bootstrapped++;
          appLog.info(
            `[DataCacheManager] Bootstrapped: ${stablePath} ` +
              `(${canonical.decision.rowCount} rows)`,
          );

          // Delete other files for this group
          for (let i = 1; i < fileEntries.length; i++) {
            const orphanPath = join(providerDir, fileEntries[i].fileName);
            try {
              if (existsSync(orphanPath)) unlinkSync(orphanPath);
              appLog.info(`[DataCacheManager] Deleted orphan: ${orphanPath}`);
            } catch { /* ignore */ }
          }
        } catch (err) {
          appLog.error(`[DataCacheManager] Bootstrap error for ${sourcePath}:`, err);
        }
      }
    }

    if (bootstrapped > 0) {
      appLog.info(`[DataCacheManager] Bootstrap complete: ${bootstrapped} files registered`);
    }
  }

  /**
   * TICKET_962 P2 boot-time back-fill of `actual_first_timestamp` /
   * `actual_last_timestamp` for rows that pre-date migration v99.
   *
   * Reads parquet row-group statistics via DuckDB `SELECT MIN(timestamp),
   * MAX(timestamp) FROM read_parquet(...)`. DuckDB pushes that down to the
   * footer-level statistics -- no row materialisation, no full-history
   * read (CLAUDE.md "no full-history read" rule). Cost is ~ms per file.
   *
   * Orphan rows (DB row references a parquet that no longer exists on
   * disk) are deleted, not carried forward with NULL actual_*. Per the
   * tightened ticket: NULL is the "back-fill not yet run" state, NEVER
   * a long-lived runtime state.
   *
   * Runs once per init; idempotent (re-queries `WHERE actual_first_timestamp
   * IS NULL` so re-running on an already-back-filled DB is a no-op).
   *
   * Logs at INFO with a summary; logs at WARN for each orphan deletion
   * (visible failure, never silent). Never throws out of init -- a
   * back-fill error must not block app start, but the assertion in
   * `upsertMetadata` will catch any post-init write path that tries to
   * persist a row whose actual_* are still NULL.
   */
  async backfillActualTimestamps(): Promise<void> {
    const db = getDatabaseManager();
    const rows = db
      .prepare(
        `SELECT id, symbol, interval, provider, file_path
           FROM data_cache_files
          WHERE actual_first_timestamp IS NULL
             OR actual_last_timestamp IS NULL`,
      )
      .all() as Array<{
        id: number;
        symbol: string;
        interval: string;
        provider: string;
        file_path: string;
      }>;

    if (rows.length === 0) {
      appLog.info('[DataCacheManager] TICKET_962 backfill: no rows need backfill');
      return;
    }

    appLog.info(
      `[DataCacheManager] TICKET_962 backfill: ${rows.length} row(s) need actual_* backfill`
    );

    // Lazy-load DuckDB only when needed (back-fill is the only consumer).
    const { DuckDBInstance } = await import('@duckdb/node-api');
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();

    const updateStmt = db.prepare(
      `UPDATE data_cache_files
          SET actual_first_timestamp = ?, actual_last_timestamp = ?
        WHERE id = ?`,
    );
    const deleteStmt = db.prepare(`DELETE FROM data_cache_files WHERE id = ?`);

    let backfilled = 0;
    let orphaned = 0;
    let failed = 0;

    try {
      for (const row of rows) {
        try {
          if (!existsSync(row.file_path)) {
            appLog.warn(
              `[DataCacheManager] TICKET_962 backfill: orphan row deleted ` +
              `(${row.symbol}/${row.interval}/${row.provider}: ` +
              `parquet '${row.file_path}' missing)`,
            );
            deleteStmt.run(row.id);
            orphaned++;
            continue;
          }
          // DuckDB MIN/MAX over read_parquet uses footer row-group statistics --
          // no row materialisation. Same primitive as `inspectParquetCodec`'s
          // footer-only open, just SQL-level.
          const reader = await conn.runAndReadAll(
            `SELECT CAST(MIN(timestamp) AS BIGINT) AS min_ts, ` +
              `CAST(MAX(timestamp) AS BIGINT) AS max_ts ` +
              `FROM read_parquet('${row.file_path.replace(/'/g, "''")}')`,
          );
          const records = reader.getRowObjectsJS();
          const r = records[0];
          if (!r || r.min_ts === null || r.max_ts === null) {
            // Empty parquet -- treat as orphan rather than store NULL.
            appLog.warn(
              `[DataCacheManager] TICKET_962 backfill: empty parquet deleted ` +
              `(${row.symbol}/${row.interval}/${row.provider})`,
            );
            deleteStmt.run(row.id);
            orphaned++;
            continue;
          }
          updateStmt.run(Number(r.min_ts), Number(r.max_ts), row.id);
          backfilled++;
        } catch (err) {
          failed++;
          appLog.error(
            `[DataCacheManager] TICKET_962 backfill error for ` +
            `${row.symbol}/${row.interval}/${row.provider}:`,
            err,
          );
        }
      }
    } finally {
      conn.closeSync();
      instance.closeSync();
    }

    appLog.info(
      `[DataCacheManager] TICKET_962 backfill complete: ` +
      `backfilled=${backfilled} orphaned=${orphaned} failed=${failed}`,
    );

    if (failed > 0) {
      // Visible failure (TICKET_858) but do NOT throw -- init must still
      // complete. The upsertMetadata assertion will catch any post-init
      // write-path use of a NULL row.
      appLog.warn(
        `[DataCacheManager] TICKET_962 backfill left ${failed} row(s) with NULL ` +
        `actual_*; subsequent writes to those keys will be blocked by the ` +
        `upsertMetadata assertion until manually resolved.`,
      );
    }
  }

  // =========================================================================
  // Internal
  // =========================================================================

  /**
   * Core ensureData logic.
   *
   * Flow:
   * 1. Query data_cache_files for metadata
   * 2. No record -> full download -> atomicWrite -> insert metadata
   * 3. Record exists -> compute needPrepend/needAppend
   * 4. Fetch only needed ranges from provider
   * 5. Read existing parquet -> merge with new rows -> dedup -> atomicWrite -> update metadata
   * 6. Return stable file path
   */
  private async doEnsureData(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string,
    provider: IDataProvider,
    opts?: {
      forceDownload?: boolean;
      onProgress?: ProgressCallback;
      onBarProgress?: BarProgressCallback;
      onChunkDateRange?: ChunkDateRangeCallback;
      resumeProgress?: number;
      chunkRetryCount?: number;
    },
    control?: DownloadControl
  ): Promise<EnsureDataResult> {
    // TICKET_196_12 Step 4: lift the aggregate-mode branch (previously only on
    // the multi-timeframe path, data-storage-service.ts:235) into the common
    // single-timeframe path that ensureUniverse (Tool Sweep) actually uses.
    // resolveFetchPlan is the single source of truth (Step 2): a non-native but
    // aggregation-reachable target (e.g. Alpaca/yfinance 4h <- 1h, 2h <- 1h)
    // fetches the finer native base bar once and rolls it up losslessly via the
    // aggregation service, instead of hitting the provider's INTERVAL_MAP-miss
    // throw. `unsupported` raises the resolver's structured reason (Step 6
    // contract -- the resolver already owns the one canonical message).
    const plan = resolveFetchPlan(provider, interval);
    if (plan.mode === 'unsupported') {
      throw new Error(plan.reason);
    }
    if (plan.mode === 'aggregate') {
      return this.ensureAggregateData(
        symbol, plan.baseInterval, interval, startDate, endDate, provider, opts, control,
      );
    }

    // TICKET_962 Phase 1 + Phase 6.3: clamp the requested window against the
    // provider's physical `maxLookback[interval]` BEFORE any cache decision.
    // The actual clamp math lives in `clampToProviderMaxLookback` (single
    // source of truth) so every fetch entry point routes through the same
    // rule -- `ensureData`, `healInteriorGap`, `fullDownload`, and any
    // future re-fetch path. The clamp is anchored to `endDate` (NOT
    // `Date.now()`): `maxLookback` describes "how far back from the requested
    // end the provider can serve", so anchoring on wall-clock corrupts
    // replay / historical / fixed-end-date research runs.
    //
    // The yfinance 5m -> 60d ceiling is the canonical case: pre-clamp, a
    // 1.5-year `manifestStartMs` from `forward_return.coverage` (a SEMANTIC
    // window, not an OHLCV-fetch window) drove run-universe to issue 9/10
    // guaranteed-empty Python spawns per symbol -- ~12 min of waste, plus
    // R3's "lying log" diagnostic trap.
    const { effectiveStartDate, clamp: clampMetadata } =
      this.clampToProviderMaxLookback(symbol, interval, provider, startDate, endDate);
    // From here on, `effectiveStartDate` replaces `startDate` as the window
    // we ask the cache + provider about. The original `startDate` survives
    // only inside `clampMetadata.requestedStartDate` so the IPC layer can
    // surface the typed warning (TICKET_858 no silent downgrade).
    const reqStartDate = effectiveStartDate;

    const cacheService = getParquetCacheService();
    const stablePath = cacheService.getStablePath(symbol, interval, provider.id);
    const record = opts?.forceDownload ? null : this.getMetadata(symbol, interval, provider.id);

    // TICKET_372: Diagnostic logging for cache hit/miss decision.
    // TICKET_962 P1: the "range" reported here is the EFFECTIVE (post-clamp)
    // window; the original requested window is still surfaced via clampMetadata.
    appLog.info(
      `[DataCacheManager] ensureData: symbol=${symbol} interval=${interval} provider=${provider.id} ` +
      `range=${reqStartDate}~${endDate}` +
      `${clampMetadata ? ` (clamped from ${clampMetadata.requestedStartDate}, maxLookback=${clampMetadata.maxLookbackSpec})` : ''} ` +
      `forceDownload=${!!opts?.forceDownload} ` +
      `cacheRecord=${record ? `id=${record.id} rows=${record.rowCount} range=${this.truncateToDate(record.firstTimestamp)}~${this.truncateToDate(record.lastTimestamp)}` : 'null'}`
    );

    const progressBase = (opts?.resumeProgress && opts.resumeProgress > 5) ? opts.resumeProgress : 5;
    opts?.onProgress?.(progressBase, dcmT('dataCache.checkingCache', { symbol, interval }));

    if (!record) {
      // Full download. Use the EFFECTIVE start (post-clamp) -- requesting the
      // pre-clamp 1.5y from a 60d-capped provider is the original defect.
      appLog.info(`[DataCacheManager] Full download: ${symbol}/${interval}/${provider.id} ${reqStartDate}~${endDate}`);
      const result = await this.fullDownload(symbol, interval, reqStartDate, endDate, provider, stablePath, opts, control);
      return clampMetadata ? { ...result, clamp: clampMetadata } : result;
    }

    // Check if existing data fully covers the requested range
    const existingStartDate = this.truncateToDate(record.firstTimestamp);
    const existingEndDate = this.truncateToDate(record.lastTimestamp);

    const needPrepend = reqStartDate < existingStartDate;
    const needAppend = endDate > existingEndDate;

    // TICKET_372: Log coverage decision
    appLog.info(
      `[DataCacheManager] Coverage check: requested=${reqStartDate}~${endDate} ` +
      `cached=${existingStartDate}~${existingEndDate} needPrepend=${needPrepend} needAppend=${needAppend}`
    );

    if (!needPrepend && !needAppend) {
      // Endpoints fully covered. TICKET_196_12_1 Phase 1: before trusting the
      // cache, run a calendar-aware INTERIOR-integrity probe. The endpoint-only
      // needPrepend/needAppend check cannot see a gap in the MIDDLE of
      // [first, last] (a missing trading day, or a hole left by an interrupted
      // append) -- Phase 0 reproduced exactly that. Compare the stored row_count
      // against the provider-calendar expected bar count; if materially short,
      // treat the entry as a coverage MISS and re-fetch its [first, last] span.
      // This does NOT restore the segment model (TICKET_362) -- the single-file
      // append model stays; we just stop returning a known-holed series as-is.
      const integrity = this.assessInteriorIntegrity(record, interval, provider);
      // TICKET_958_4 AC #5: lazy-heal trading-day gap probe. Binary check
      // (missingDays.length > 0 -> heal) -- NOT a heuristic threshold. The
      // calendar JSON is the ground truth: a real NYSE/XSHG_XSHE/FX/crypto
      // trading day in [actualFirst, actualLast] is either present in the
      // parquet or it is not. After the AC #1 write-boundary invariant lands,
      // no NEW hole can form; the gap probe exists only to converge the
      // pre-existing population (TICKET_958_3 Finding 4 class). Idempotent:
      // once the gap is healed the next call finds zero missing days and
      // the check is a no-op forever after.
      //
      // Composes with `assessInteriorIntegrity` (row-count probe) -- either
      // probe triggering routes through `healInteriorGap`. They catch
      // different failure modes: row-count catches corruption-class collapses
      // (every day represented but most bars missing); day-set catches whole-
      // day deletions (Finding 4 -- 3 full RTH days gone, row-count ratio
      // 0.952 sits above the 0.90 threshold).
      const dayGap = await this.assessTradingDayGap(record, provider);

      // TICKET_1072_1 AC7: suppress redundant heal when the detected gap
      // exactly matches the persisted known-missing set. The provider
      // permanently lacks these days -- re-fetching won't help.
      // Force-download (opts.forceDownload) bypasses this skip.
      let dayGapIsKnown = false;
      if (dayGap.missingDays.length > 0 && record.missingDaysJson && !opts?.forceDownload) {
        try {
          const known = JSON.parse(record.missingDaysJson) as number[];
          if (
            known.length === dayGap.missingDays.length &&
            dayGap.missingDays.every(d => known.includes(d))
          ) {
            dayGapIsKnown = true;
            appLog.info(
              `[DataCacheManager] TICKET_1072_1: skipping heal for ${symbol}/${interval}/${provider.id} -- ` +
              `${dayGap.missingDays.length} missing day(s) match persisted known-missing set.`
            );
          }
        } catch { /* corrupt JSON -- fall through to heal */ }
      }

      const effectiveHealNeeded = integrity.healNeeded || (dayGap.missingDays.length > 0 && !dayGapIsKnown);
      if (effectiveHealNeeded) {
        if (dayGap.missingDays.length > 0) {
          appLog.warn(
            `[DataCacheManager] Trading-day gap on cache hit: ` +
            `${symbol}/${interval}/${provider.id} missing ` +
            `${dayGap.missingDays.length} day${dayGap.missingDays.length === 1 ? '' : 's'} ` +
            `(${provider.capabilities.tradingCalendar}): ` +
            `${dayGap.missingDays.slice(0, 5).map(formatTradingDay).join(', ')}` +
            `${dayGap.missingDays.length > 5 ? `, +${dayGap.missingDays.length - 5} more` : ''}; ` +
            `re-fetching actual parquet span to backfill.`
          );
        }
        // TICKET_962 Phase 6.2: heal the ACTUAL parquet span, not the virtual
        // one. The virtual extension is by construction NOT on disk -- there
        // is no hole inside [virtualFirst, actualFirst) to fill; only the
        // [actualFirst, actualLast] interior can have a real gap. Asking the
        // provider for the virtual span would re-issue the empty chunks
        // TICKET_962 Phase 1 just clamped out. The integrity probe (P6.1)
        // already guarantees actualFirst/Last are non-null at this point.
        const healStartDate = this.truncateToDate(record.actualFirstTimestamp!);
        const healEndDate = this.truncateToDate(record.actualLastTimestamp!);
        if (integrity.healNeeded) {
          appLog.warn(
            `[DataCacheManager] Interior-integrity MISS: ${symbol}/${interval}/${provider.id} ` +
            `rows=${record.rowCount} expected~=${Math.round(integrity.expectedBars)} ` +
            `(threshold ${CACHE_INTEGRITY_COVERAGE_THRESHOLD}); re-fetching ` +
            `${healStartDate}~${healEndDate} (actual parquet span) to backfill the interior gap.`
          );
        }
        return this.healInteriorGap(
          symbol, interval, healStartDate, healEndDate, provider, record, stablePath, opts, control,
        );
      }

      // Fully covered
      appLog.info(`[DataCacheManager] Cache hit: ${stablePath} (${record.rowCount} rows)`);
      opts?.onProgress?.(100, dcmT('dataCache.dataReadyCached'));
      return {
        filePath: record.filePath,
        rowCount: record.rowCount,
        firstTimestamp: record.firstTimestamp,
        lastTimestamp: record.lastTimestamp,
        ...(clampMetadata ? { clamp: clampMetadata } : {}),
      };
    }

    // Partial coverage -- fetch only missing ranges
    appLog.info(
      `[DataCacheManager] Partial cache: ${symbol}/${interval} existing ${existingStartDate}~${existingEndDate}, ` +
      `need prepend=${needPrepend} append=${needAppend}`
    );

    const newRows: OHLCVRow[] = [];

    if (needPrepend) {
      opts?.onProgress?.(10, dcmT('dataCache.fetchingEarlierData', { start: reqStartDate, end: existingStartDate }));
      const prependResult = await this.fetchRange(symbol, interval, reqStartDate, existingStartDate, provider, opts, control);
      pushAll(newRows, prependResult.rows);
    }

    if (needAppend) {
      // TICKET_351_P2: If shouldYield triggered during prepend, skip append
      if (control?.shouldYield?.()) {
        appLog.info(`[DataCacheManager] Yielding before append for ${symbol}/${interval}`);
      } else {
        const fetchProgress = needPrepend ? 40 : 10;
        opts?.onProgress?.(fetchProgress, dcmT('dataCache.fetchingNewerData', { start: existingEndDate, end: endDate }));
        const appendResult = await this.fetchRange(symbol, interval, existingEndDate, endDate, provider, opts, control);
        pushAll(newRows, appendResult.rows);
      }
    }

    // TICKET_372: Expand metadata coverage to include the full requested range.
    // When provider returns 0 rows for a prepend/append range, that range is confirmed
    // empty (e.g., Alpaca 1m data starts 2020-07 but user requested from 2016-01).
    // Without this expansion, metadata stays at actual data boundaries and the next run
    // will re-attempt the same empty range -- causing an infinite download loop.
    // TICKET_962 P1: use the EFFECTIVE (post-clamp) reqStartDate -- expanding
    // metadata to the unclamped pre-clamp left edge would re-introduce the
    // R2 "metadata-virtual coverage extends beyond provider's physical
    // ability" pathology that originally broke this code path.
    const requestedStartTs = Math.floor(new Date(reqStartDate + 'T00:00:00Z').getTime() / MS_PER_SECOND);
    const requestedEndTs = Math.floor(new Date(endDate + 'T00:00:00Z').getTime() / MS_PER_SECOND);

    // TICKET_372: If provider returned no new data, skip the expensive read-merge-write
    // cycle (255K+ rows) and only expand metadata coverage.
    // TICKET_962 P2: this is the decision-only path -- we have NO new
    // merged[] in hand, so we MUST NOT touch actual_first/last_timestamp.
    // Use upsertVirtualCoverageOnly to widen only the virtual coverage
    // columns; the actual_* columns retain the truth from the prior
    // write that registered the file.
    if (newRows.length === 0) {
      const coverageFirstTs = Math.min(record.firstTimestamp, requestedStartTs);
      const coverageLastTs = Math.max(record.lastTimestamp, requestedEndTs);

      this.upsertVirtualCoverageOnly({
        ...record,
        firstTimestamp: coverageFirstTs,
        lastTimestamp: coverageLastTs,
        updatedAt: new Date().toISOString(),
      });

      opts?.onProgress?.(100, dcmT('dataCache.dataReadyCached'));
      appLog.info(
        `[DataCacheManager] No new data from provider, expanded coverage to ` +
        `${this.truncateToDate(coverageFirstTs)}~${this.truncateToDate(coverageLastTs)} (${record.rowCount} rows)`
      );

      return {
        filePath: record.filePath,
        rowCount: record.rowCount,
        firstTimestamp: record.firstTimestamp,
        lastTimestamp: record.lastTimestamp,
        ...(clampMetadata ? { clamp: clampMetadata } : {}),
      };
    }

    opts?.onProgress?.(70, dcmT('dataCache.mergingData'));
    const planeStartMs = Math.min(
      (record.actualFirstTimestamp ?? record.firstTimestamp) * MS_PER_SECOND,
      new Date(`${reqStartDate}T00:00:00.000Z`).getTime(),
    );
    const planeEndMs = Math.max(
      (record.actualLastTimestamp ?? record.lastTimestamp) * MS_PER_SECOND,
      new Date(`${endDate}T23:59:59.999Z`).getTime(),
    );
    opts?.onProgress?.(85, dcmT('dataCache.writingRows', { count: newRows.length }));
    const writeResult = await cacheService.mergeAndWriteParquet(
      stablePath,
      existsSync(record.filePath) ? record.filePath : null,
      newRows,
      {
        symbol,
        startMs: planeStartMs,
        endMs: planeEndMs,
        providerOrAssetClass: provider.id,
        interval,
        minimumOutputRows: record.rowCount,
        abortSignal: control?.signal,
      },
    );
    if (!writeResult.success || !writeResult.decision?.extent) {
      throw new Error(writeResult.error || mainT(getCurrentMainLocale(), 'errors', 'main.dataCache.failedWriteMerged'));
    }
    const merged = await cacheService.readCacheInWindow(
      stablePath, planeStartMs / MS_PER_SECOND, planeEndMs / MS_PER_SECOND,
    );
    if (merged.length === 0) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataCache.noDataFound', { symbol, interval, start: reqStartDate, end: endDate }));
    }
    // TICKET_958_4 AC #1 / TICKET_1072_1: trading-day completeness check
    // on merged result. Warn on gaps but always proceed to write.
    //
    // TICKET_1050: clamp to actual data envelope.
    let mergeCompletenessResult: MissingDaysResult | undefined;
    {
      const actualFirstMs = merged[0].timestamp * MS_PER_SECOND;
      const actualLastMs = merged[merged.length - 1].timestamp * MS_PER_SECOND;
      const mergeStartMs = new Date(reqStartDate + 'T00:00:00Z').getTime();
      const mergeEndMs = new Date(endDate + 'T23:59:59Z').getTime();
      const invariantStartMs = Math.max(mergeStartMs, Math.floor(actualFirstMs / MS_PER_DAY) * MS_PER_DAY);
      const invariantEndMs = Math.min(mergeEndMs, actualLastMs);
      mergeCompletenessResult = checkMissingTradingDays(merged, provider, interval, invariantStartMs, clampEndMsToCompletedDay(invariantEndMs));
      const warning = formatMissingDaysWarning(mergeCompletenessResult, provider.id, merged.length, invariantStartMs, invariantEndMs);
      if (warning) {
        appLog.warn(`[DataCacheManager] TICKET_1072_1 doEnsureData merge: ${warning}`);
      }
    }

    // Update metadata
    const firstTs = merged[0].timestamp;
    const lastTs = merged[merged.length - 1].timestamp;
    const coverageFirstTs = Math.min(firstTs, requestedStartTs);
    const coverageLastTs = Math.max(lastTs, requestedEndTs);

    this.upsertMetadata({
      id: record.id,
      symbol,
      interval,
      provider: provider.id,
      filePath: stablePath,
      firstTimestamp: coverageFirstTs,
      lastTimestamp: coverageLastTs,
      // TICKET_962 P2: parquet truth comes from `merged` -- this is the
      // append-write path, the file we just atomically wrote starts at
      // firstTs and ends at lastTs.
      actualFirstTimestamp: firstTs,
      actualLastTimestamp: lastTs,
      rowCount: merged.length,
      sourceType: record.sourceType,
      baseFileId: record.baseFileId,
      updatedAt: new Date().toISOString(),
      completeness: mergeCompletenessResult?.completeness ?? 1.0,
      missingDaysJson: mergeCompletenessResult && mergeCompletenessResult.missingDays.length > 0
        ? JSON.stringify(mergeCompletenessResult.missingDays) : null,
      codec: writeResult.decision.codec.toUpperCase(),
    });

    // TICKET_351_P2: Detect if yield occurred during fetch
    const didYield = !!control?.shouldYield?.();

    if (!didYield) {
      opts?.onProgress?.(100, dcmT('dataCache.dataReady', { count: merged.length }));
    }

    // TICKET_962 R3: dual-coverage `Append complete` log line. The OLD
    // single-coverage form was a diagnostic trap: it reported only the
    // metadata-virtual range, so a reader saw "coverage 2025-08-04~2026-06-12"
    // and concluded the file held 10 months on disk -- when the parquet
    // actually held 40 days. The new form prints BOTH the parquet-truth
    // extents and the metadata-virtual coverage side by side, and escalates
    // to WARN when the virtual extension is more than
    // VIRTUAL_EXTENSION_WARN_DAYS days wider than parquet truth. This makes
    // the "you asked for 1.5 years but only got 40 days" desync visible
    // without anyone needing to read parquet by hand (TICKET_858).
    const SECONDS_PER_DAY = 86400;
    const virtualLeftDroppedDays = Math.floor(
      Math.max(0, firstTs - coverageFirstTs) / SECONDS_PER_DAY,
    );
    const virtualRightDroppedDays = Math.floor(
      Math.max(0, coverageLastTs - lastTs) / SECONDS_PER_DAY,
    );
    const virtualExtensionDays = virtualLeftDroppedDays + virtualRightDroppedDays;
    const logFn = virtualExtensionDays > VIRTUAL_EXTENSION_WARN_DAYS
      ? appLog.warn
      : appLog.info;
    logFn(
      `[DataCacheManager] Append complete: ${stablePath} ` +
      `rows=${merged.length} ` +
      `actual_parquet=${this.truncateToDate(firstTs)}~${this.truncateToDate(lastTs)} ` +
      `metadata_coverage=${this.truncateToDate(coverageFirstTs)}~${this.truncateToDate(coverageLastTs)} ` +
      `virtual_extension=${virtualExtensionDays}d` +
      `${didYield ? ' [yielded]' : ''}`
    );

    return {
      filePath: stablePath,
      rowCount: merged.length,
      firstTimestamp: firstTs,
      lastTimestamp: lastTs,
      yielded: didYield,
      ...(clampMetadata ? { clamp: clampMetadata } : {}),
      missingDaysResult: mergeCompletenessResult,
    };
  }

  /**
   * TICKET_962 Phase 6.3: single source of truth for the
   * `provider.capabilities.maxLookback` clamp.
   *
   * Every code path that dispatches OHLCV to a provider MUST route its
   * (startDate, endDate) through this helper before calling `fetchRange` /
   * `fullDownload`. Inlining the math at each call site is what allowed the
   * Interior-integrity heal path to drift back to the unclamped behaviour
   * (the original TICKET_962 regression).
   *
   * Anchored to the requested `endDate`, NOT `Date.now()`: `maxLookback` is
   * "how far back from the requested end the provider can serve", so wall-
   * clock anchoring would corrupt replay / historical / fixed-end-date runs.
   *
   * Returns the clamped start (or the original start if no clamp was needed)
   * plus an optional diagnostic payload that callers surface as a typed
   * warning (TICKET_858: no silent downgrade).
   */
  private clampToProviderMaxLookback(
    symbol: string,
    interval: string,
    provider: IDataProvider,
    startDate: string,
    endDate: string,
  ): { effectiveStartDate: string; clamp?: EnsureDataResult['clamp'] } {
    const spec = provider.capabilities.maxLookback?.[interval];
    if (!spec) return { effectiveStartDate: startDate };
    const maxLookbackMs = parseMaxLookbackMs(spec);
    const endMs = new Date(endDate + 'T00:00:00Z').getTime();
    const startMs = new Date(startDate + 'T00:00:00Z').getTime();
    const minAllowedStartMs = endMs - maxLookbackMs;
    if (startMs >= minAllowedStartMs) return { effectiveStartDate: startDate };
    const clampedStartDate = new Date(minAllowedStartMs).toISOString().slice(0, 10);
    appLog.warn(
      `[DataCacheManager] Window clamped by provider maxLookback: ` +
      `${symbol}/${interval}/${provider.id} requested=${startDate}~${endDate} ` +
      `clamped to ${clampedStartDate}~${endDate} (maxLookback='${spec}')`
    );
    return {
      effectiveStartDate: clampedStartDate,
      clamp: {
        requestedStartDate: startDate,
        clampedStartDate,
        providerId: provider.id,
        maxLookbackSpec: spec,
      },
    };
  }

  /**
   * TICKET_958_4 AC #5/#6 -- trading-day gap probe (read-path lazy heal).
   *
   * Returns the calendar-day-set difference between the parquet on disk and
   * the provider's declared `tradingCalendar` over the ACTUAL parquet span
   * (`actualFirstTimestamp` .. `actualLastTimestamp`). Binary by construction:
   * a real trading day from the calendar is either present in the parquet or
   * it is not -- no fraction, no threshold (the heuristic 0.05 cutoff and the
   * SHADOW/AUTHORITATIVE rollout were demoted by AC #6 because the JSON
   * calendar IS the truth, not an estimate).
   *
   * Composes with `assessInteriorIntegrity` at the read-path call site:
   * either probe triggering routes through `healInteriorGap`. They catch
   * different failure modes -- row-count catches corruption-class collapses
   * (every day represented but most bars missing), day-set catches whole-
   * day deletions (TICKET_958_3 Finding 4: 3 full RTH days gone at a 0.952
   * row-count ratio that sits above the 0.90 threshold).
   *
   * Idempotent: after AC #1 (write-boundary invariant) + AC #4
   * (merge-never-shrinks) land, no NEW hole can form -- so once an existing
   * gap is healed, the next call finds zero missing days and the probe is a
   * no-op forever after. This is a one-time-cost convergence mechanism, not
   * a persistent runtime gate.
   *
   * Returns `{ missingDays: [] }` (no heal) when:
   *   - the provider declares `tradingCalendar === 'NONE'` (imported-package
   *     branch -- user file is authoritative; see AC #5),
   *   - the parquet file is missing on disk (defensive: never block a fetch
   *     on a probe I/O error),
   *   - the DuckDB probe throws (logged as a WARN per TICKET_858, but does
   *     not regress the row-count probe's heal decision -- the row-count
   *     branch above still runs).
   *
   * Throws when `actualFirstTimestamp` / `actualLastTimestamp` are null --
   * that is a v99 migration invariant violation owed by `assessInteriorIntegrity`
   * which would have already thrown; we mirror its semantics for symmetry.
   */
  private async assessTradingDayGap(
    record: CacheFileRecord,
    provider: IDataProvider,
  ): Promise<{ missingDays: number[] }> {
    if (provider.capabilities.tradingCalendar === 'NONE') {
      return { missingDays: [] };
    }
    if (
      record.actualFirstTimestamp === null ||
      record.actualLastTimestamp === null
    ) {
      // `assessInteriorIntegrity` runs first and would have thrown on a null
      // actual_* -- if we reach here non-null, we already have a usable span.
      // If somehow null slipped through (test fixture, etc), fail-open: do
      // not invent a calendar window when we have no actual span to compare.
      return { missingDays: [] };
    }
    if (!existsSync(record.filePath)) return { missingDays: [] };

    const expected = enumerateTradingDays(
      provider.capabilities.tradingCalendar,
      record.actualFirstTimestamp * MS_PER_SECOND,
      record.actualLastTimestamp * MS_PER_SECOND,
    );
    if (expected.length === 0) return { missingDays: [] };

    let actualDayMsSet: Set<number>;
    try {
      const { DuckDBInstance } = await import('@duckdb/node-api');
      const inst = await DuckDBInstance.create(':memory:');
      const conn = await inst.connect();
      try {
        const quoted = record.filePath.replace(/'/g, "''");
        // Cast to BIGINT so we get an integer ms epoch back (avoids JS Date
        // serialization variance across DuckDB versions). Floor each row
        // timestamp to the UTC day in seconds, then convert to ms.
        const res = await conn.runAndReadAll(
          `SELECT DISTINCT CAST(FLOOR("timestamp" / 86400) AS BIGINT) AS day_epoch_s ` +
            `FROM read_parquet('${quoted}')`,
        );
        actualDayMsSet = new Set(
          res.getRowObjectsJS().map((r) => {
            const v = (r as { day_epoch_s?: bigint | number }).day_epoch_s ?? 0;
            return Number(v) * 86_400 * MS_PER_SECOND;
          }),
        );
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    } catch (err) {
      appLog.warn(
        `[DataCacheManager] Trading-day gap probe I/O error for ` +
        `${record.symbol}/${record.interval}/${record.provider}: ` +
        `${err instanceof Error ? err.message : String(err)} -- ` +
        `deferring to row-count probe for the heal decision.`,
      );
      return { missingDays: [] };
    }

    const missingDays = expected.filter((d) => !actualDayMsSet.has(d));
    return { missingDays };
  }

  /**
   * TICKET_196_12_1 Phase 1 -- row-count interior-integrity probe.
   *
   * Pure decision (no I/O): compares the entry's stored row_count against the
   * provider-calendar expected bar count for its ACTUAL [first, last] span
   * (TICKET_962 Phase 6.1). Catches corruption-class collapses (every day
   * represented but a large fraction of bars missing) that the day-set probe
   * by definition does not see. Composes with `assessTradingDayGap` at the
   * read-path call site: either probe triggering routes through
   * `healInteriorGap`.
   *
   * Throws (TICKET_858 no silent failure) when `actual_*` are null -- v99
   * migration invariant violation. Returns `healNeeded=false` when the
   * expected-bar derivation cannot be performed (unknown timeframe, span
   * shorter than CACHE_INTEGRITY_MIN_EXPECTED_BARS).
   */
  private assessInteriorIntegrity(
    record: CacheFileRecord,
    interval: string,
    provider: IDataProvider,
  ): { healNeeded: boolean; expectedBars: number } {
    // TICKET_962 Phase 6.1: read the parquet-truth columns (`actual_*`), NOT
    // the virtual `first/lastTimestamp`. The virtual columns are deliberately
    // widened by TICKET_372 to suppress re-fetch of provably-empty ranges; if
    // the integrity probe interprets them as parquet truth it produces a
    // guaranteed false positive whenever virtual > actual (the normal post-372
    // state), which then routes to `healInteriorGap` with the virtual span
    // and re-issues the exact futile chunks TICKET_962 Phase 1 was meant to
    // eliminate. AC-2 guarantees `actualFirstTimestamp` /
    // `actualLastTimestamp` are non-null for every row (migration v99 +
    // boot-time backfill); a NULL here is a contract violation that must
    // surface via the `upsertMetadata` assertion, not be papered over here.
    if (record.actualFirstTimestamp === null || record.actualLastTimestamp === null) {
      throw new Error(
        `[assessInteriorIntegrity] cache row ${record.symbol}/${interval}/${record.provider} ` +
        `has null actual_* timestamps; TICKET_962 P2 backfill (migration v99) must run before ` +
        `the integrity probe is callable. This is an invariant violation, not a fail-open case.`
      );
    }
    let expectedBars: number;
    try {
      expectedBars = expectedBarsForRange(
        provider, interval, record.actualFirstTimestamp, record.actualLastTimestamp,
      );
    } catch (err) {
      // Unknown timeframe / calendar-ratio probe failure must never block a
      // legitimate cache hit. Fail open to the existing endpoint decision
      // (TICKET_859 defensive check, not a silent swallow -- we log it).
      appLog.warn(
        `[DataCacheManager] Interior-integrity probe skipped for ${record.symbol}/${interval}: ` +
        `${err instanceof Error ? err.message : String(err)}`
      );
      return { healNeeded: false, expectedBars: 0 };
    }

    if (expectedBars < CACHE_INTEGRITY_MIN_EXPECTED_BARS) {
      return { healNeeded: false, expectedBars };
    }

    const healNeeded = record.rowCount < expectedBars * CACHE_INTEGRITY_COVERAGE_THRESHOLD;
    return { healNeeded, expectedBars };
  }

  /**
   * TICKET_196_12_1 Phase 1: re-fetch and merge a cache entry's full
   * [first, last] span to backfill a detected interior gap, preserving the
   * single-file append model. Re-uses the same fetch -> read -> dedup-merge ->
   * atomicWrite -> upsert path the append branch uses; the dedup means already
   * present rows are not duplicated and the only net effect is the missing
   * interior bars getting filled in.
   */
  private async healInteriorGap(
    symbol: string,
    interval: string,
    firstDate: string,
    lastDate: string,
    provider: IDataProvider,
    record: CacheFileRecord,
    stablePath: string,
    opts?: { forceDownload?: boolean; onProgress?: ProgressCallback; resumeProgress?: number },
    control?: DownloadControl,
  ): Promise<EnsureDataResult> {
    const cacheService = getParquetCacheService();

    // TICKET_962 Phase 6.3 defence-in-depth: route the heal fetch through the
    // same maxLookback clamp every other fetch entry uses. After P6.2 the
    // (firstDate, lastDate) arguments are the ACTUAL parquet span -- which is
    // by construction within `maxLookback` -- so this clamp is normally a
    // no-op. It exists so a future caller passing a raw / virtual window
    // cannot silently re-introduce the R1 unclamped-fetch defect.
    const { effectiveStartDate: clampedFirstDate } =
      this.clampToProviderMaxLookback(symbol, interval, provider, firstDate, lastDate);

    opts?.onProgress?.(10, dcmT('dataCache.refetchingBackfill', { symbol, interval }));
    const refetchResult = await this.fetchRange(symbol, interval, clampedFirstDate, lastDate, provider, opts, control);

    const healStartMs = new Date(`${clampedFirstDate}T00:00:00.000Z`).getTime();
    const healEndMs = new Date(`${lastDate}T23:59:59.999Z`).getTime();
    opts?.onProgress?.(85, dcmT('dataCache.writingRows', { count: refetchResult.rows.length }));
    const writeResult = await cacheService.mergeAndWriteParquet(
      stablePath,
      existsSync(record.filePath) ? record.filePath : null,
      refetchResult.rows,
      {
        symbol,
        startMs: healStartMs,
        endMs: healEndMs,
        providerOrAssetClass: provider.id,
        interval,
        minimumOutputRows: record.rowCount,
        abortSignal: control?.signal,
      },
    );
    if (!writeResult.success || !writeResult.decision?.extent) {
      throw new Error(writeResult.error || mainT(getCurrentMainLocale(), 'errors', 'main.dataCache.failedWriteHealed'));
    }
    const merged = await cacheService.readCacheInWindow(
      stablePath, healStartMs / MS_PER_SECOND, healEndMs / MS_PER_SECOND,
    );
    if (merged.length === 0) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataCache.noDataFound', { symbol, interval, start: firstDate, end: lastDate }));
    }

    // TICKET_958_4 AC #4: a heal that drops an existing day is a regression,
    // not a heal. Refuse to overwrite the file in that case.
    // TICKET_958_4 AC #1 / TICKET_1072_1: trading-day completeness check on
    // healed result. Warn on residual gaps but always write -- the provider
    // may permanently lack certain days (holidays, delistings).
    let healCompletenessResult: MissingDaysResult | undefined;
    {
      healCompletenessResult = checkMissingTradingDays(merged, provider, interval, healStartMs, clampEndMsToCompletedDay(healEndMs));
      const warning = formatMissingDaysWarning(healCompletenessResult, provider.id, merged.length, healStartMs, healEndMs);
      if (warning) {
        appLog.warn(`[DataCacheManager] TICKET_1072_1 healInteriorGap: ${warning}`);
      }
    }

    const firstTs = merged[0].timestamp;
    const lastTs = merged[merged.length - 1].timestamp;
    // Coverage endpoints can only grow, never shrink: keep the previously
    // recorded (possibly endpoint-expanded) bounds via min/max.
    const coverageFirstTs = Math.min(firstTs, record.firstTimestamp);
    const coverageLastTs = Math.max(lastTs, record.lastTimestamp);

    this.upsertMetadata({
      id: record.id,
      symbol,
      interval,
      provider: provider.id,
      filePath: stablePath,
      firstTimestamp: coverageFirstTs,
      lastTimestamp: coverageLastTs,
      // TICKET_962 P2: interior-heal also writes the merged file to disk;
      // firstTs / lastTs are the new parquet truth.
      actualFirstTimestamp: firstTs,
      actualLastTimestamp: lastTs,
      rowCount: merged.length,
      sourceType: record.sourceType,
      baseFileId: record.baseFileId,
      updatedAt: new Date().toISOString(),
      completeness: healCompletenessResult?.completeness ?? 1.0,
      missingDaysJson: healCompletenessResult && healCompletenessResult.missingDays.length > 0
        ? JSON.stringify(healCompletenessResult.missingDays) : null,
      codec: writeResult.decision.codec.toUpperCase(),
    });

    opts?.onProgress?.(100, dcmT('dataCache.dataReadyBackfilled', { count: merged.length }));
    appLog.info(
      `[DataCacheManager] Interior heal complete: ${stablePath} ` +
      `(${record.rowCount} -> ${merged.length} rows, coverage ` +
      `${this.truncateToDate(coverageFirstTs)}~${this.truncateToDate(coverageLastTs)})`
    );

    return {
      filePath: stablePath,
      rowCount: merged.length,
      firstTimestamp: firstTs,
      lastTimestamp: lastTs,
      missingDaysResult: healCompletenessResult,
    };
  }

  /**
   * Full download: fetch entire range, split into chunks for progress reporting,
   * accumulate all rows, dedup, write once.
   */
  private async fullDownload(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string,
    provider: IDataProvider,
    stablePath: string,
    opts?: {
      onProgress?: ProgressCallback;
      onBarProgress?: BarProgressCallback;
      onChunkDateRange?: ChunkDateRangeCallback;
      resumeProgress?: number;
      chunkRetryCount?: number;
    },
    control?: DownloadControl
  ): Promise<EnsureDataResult> {
    const cacheService = getParquetCacheService();
    const progressBase = (opts?.resumeProgress && opts.resumeProgress > 5) ? opts.resumeProgress : 5;

    sendToRenderer('data:progress', {
      symbol,
      phase: 'downloading',
      progress: 0.1,
      message: dcmT('dataCache.fetchingFromProvider', { provider: provider.name }),
    });

    opts?.onProgress?.(progressBase, dcmT('dataCache.fetchingFromProvider', { provider: provider.name }));

    const fetchResult = await this.fetchRange(symbol, interval, startDate, endDate, provider, opts, control);
    const allRows = fetchResult.rows;
    const { skippedChunks } = fetchResult;

    // TICKET_351_P2: If yielded with partial data, write what we have and return
    const didYield = !!control?.shouldYield?.();
    if (didYield && allRows.length > 0) {
      appLog.info(`[DataCacheManager] Yielding fullDownload for ${symbol}/${interval} with ${allRows.length} partial rows`);
      const writeResult = await cacheService.atomicWriteParquet(
        stablePath,
        allRows,
        {
          symbol,
          providerOrAssetClass: provider.id,
          interval,
          abortSignal: control?.signal,
        },
      );
      if (!writeResult.success || !writeResult.decision?.extent) {
        throw new Error(writeResult.error || mainT(getCurrentMainLocale(), 'errors', 'main.dataCache.failedWritePartial'));
      }
      const firstTs = Math.floor(writeResult.decision.extent.startMs / MS_PER_SECOND);
      const lastTs = Math.floor(writeResult.decision.extent.endMs / MS_PER_SECOND);
      const requestedStartTs = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / MS_PER_SECOND);
      const coverageFirstTs = Math.min(firstTs, requestedStartTs);
      this.upsertMetadata({
        id: 0, symbol, interval, provider: provider.id, filePath: stablePath,
        firstTimestamp: coverageFirstTs, lastTimestamp: lastTs,
        // TICKET_962 P2: yielded-partial wrote `deduped` to disk; firstTs/lastTs are truth.
        actualFirstTimestamp: firstTs, actualLastTimestamp: lastTs,
        rowCount: writeResult.decision.rowCount, sourceType: 'base', baseFileId: null,
        updatedAt: new Date().toISOString(),
        completeness: 1.0, missingDaysJson: null,
        codec: writeResult.decision.codec.toUpperCase(),
      });
      return { filePath: stablePath, rowCount: writeResult.decision.rowCount, firstTimestamp: firstTs, lastTimestamp: lastTs, yielded: true, skippedChunks };
    }

    if (allRows.length === 0) {
      if (didYield) {
        return { filePath: stablePath, rowCount: 0, firstTimestamp: 0, lastTimestamp: 0, yielded: true };
      }
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataCache.noDataFound', { symbol, interval, start: startDate, end: endDate }));
    }

    // Dedup and write
    opts?.onProgress?.(85, dcmT('dataCache.writingRows', { count: allRows.length }));
    sendToRenderer('data:progress', {
      symbol,
      phase: 'caching',
      progress: 0.8,
      message: dcmT('dataCache.writingRows', { count: allRows.length }),
    });

    const writeResult = await cacheService.atomicWriteParquet(
      stablePath,
      allRows,
      {
        symbol,
        providerOrAssetClass: provider.id,
        interval,
        abortSignal: control?.signal,
      },
    );

    if (!writeResult.success || !writeResult.decision?.extent) {
      throw new Error(writeResult.error || mainT(getCurrentMainLocale(), 'errors', 'main.dataCache.failedWriteCache'));
    }

    // Insert metadata
    const firstTs = Math.floor(writeResult.decision.extent.startMs / MS_PER_SECOND);
    const lastTs = Math.floor(writeResult.decision.extent.endMs / MS_PER_SECOND);

    // TICKET_372: Expand metadata coverage to include the full requested range.
    // On first download, provider may have less data than requested (e.g., Alpaca 1m
    // starts 2020-07 but user requested from 2016-01). Expanding coverage prevents
    // the next run from re-fetching the confirmed-empty range.
    const requestedStartTs = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / MS_PER_SECOND);
    const requestedEndTs = Math.floor(new Date(endDate + 'T00:00:00Z').getTime() / MS_PER_SECOND);
    const coverageFirstTs = Math.min(firstTs, requestedStartTs);
    const coverageLastTs = Math.max(lastTs, requestedEndTs);

    const { missingDaysResult: fullDownloadMdr } = fetchResult;
    this.upsertMetadata({
      id: 0,
      symbol,
      interval,
      provider: provider.id,
      filePath: stablePath,
      firstTimestamp: coverageFirstTs,
      lastTimestamp: coverageLastTs,
      // TICKET_962 P2: full-download wrote `deduped` to disk; firstTs / lastTs are truth.
      actualFirstTimestamp: firstTs,
      actualLastTimestamp: lastTs,
      rowCount: writeResult.decision.rowCount,
      sourceType: 'base',
      baseFileId: null,
      updatedAt: new Date().toISOString(),
      completeness: fullDownloadMdr?.completeness ?? 1.0,
      missingDaysJson: fullDownloadMdr && fullDownloadMdr.missingDays.length > 0
        ? JSON.stringify(fullDownloadMdr.missingDays) : null,
      codec: writeResult.decision.codec.toUpperCase(),
    });

    opts?.onProgress?.(100, dcmT('dataCache.dataReady', { count: writeResult.decision.rowCount }));

    // Range warning
    const actualStart = this.truncateToDate(firstTs);
    const actualEnd = this.truncateToDate(lastTs);
    if (actualStart !== startDate || actualEnd !== endDate) {
      appLog.warn(
        `[DataCacheManager] Data range mismatch: requested ${startDate}~${endDate}, actual ${actualStart}~${actualEnd}`
      );
      sendToRenderer('data:range-warning', {
        symbol,
        interval,
        requestedStart: startDate,
        requestedEnd: endDate,
        actualStart,
        actualEnd,
        message: dcmT('dataCache.providerStartsAt', { provider: provider.name, actualStart, requestedStart: startDate }),
      });
    }

    return {
      filePath: stablePath,
      rowCount: writeResult.decision.rowCount,
      firstTimestamp: firstTs,
      lastTimestamp: lastTs,
      skippedChunks,
      missingDaysResult: fullDownloadMdr,
    };
  }

  /**
   * Fetch a date range from provider, split into chunks for progress.
   * Returns accumulated rows (NOT deduped -- caller dedup-merges).
   */
  private async fetchRange(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string,
    provider: IDataProvider,
    opts?: {
      onProgress?: ProgressCallback;
      onBarProgress?: BarProgressCallback;
      onChunkDateRange?: ChunkDateRangeCallback;
      chunkRetryCount?: number;
    },
    control?: DownloadControl
  ): Promise<{ rows: OHLCVRow[]; skippedChunks: number; missingDaysResult?: MissingDaysResult }> {
    const chunks = this.splitGapIntoChunks(startDate, endDate, interval);
    const allRows: OHLCVRow[] = [];
    let completedChunks = 0;
    let skippedChunks = 0;
    const maxRetries = opts?.chunkRetryCount ?? 2;

    const startSec = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000);
    const endSec = Math.floor(new Date(endDate + 'T23:59:59Z').getTime() / 1000);
    const estimatedTotalBars = Math.round(expectedBarsForRange(provider, interval, startSec, endSec));

    for (const chunk of chunks) {
      // TICKET_351_P2: Hard cancel check before each chunk
      if (control?.signal?.aborted) {
        throw new DOMException('Download cancelled', 'AbortError');
      }

      let rows: OHLCVRow[] | null = null;
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          rows = await provider.queryOHLCV(symbol, interval, chunk.startDate, chunk.endDate);
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          if (!isOpaqueError(lastErr.message)) {
            throw lastErr;
          }
          if (attempt < maxRetries) {
            const backoffMs = Math.min(
              CHUNK_RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt),
              CHUNK_RETRY_BACKOFF_MAX_MS,
            );
            appLog.warn(
              `[DataCacheManager] TICKET_1078: chunk ${chunk.startDate}~${chunk.endDate} ` +
              `for ${symbol}/${interval} failed (attempt ${attempt + 1}/${maxRetries + 1}): ` +
              `${lastErr.message}. Retrying in ${backoffMs}ms...`,
            );
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
        }
      }

      if (rows === null) {
        skippedChunks++;
        appLog.warn(
          `[DataCacheManager] TICKET_1078: skipping chunk ${chunk.startDate}~${chunk.endDate} ` +
          `for ${symbol}/${interval} after ${maxRetries + 1} attempts: ${lastErr?.message}`,
        );
        completedChunks++;
        const chunkProgress = 5 + Math.round((completedChunks / chunks.length) * 75);
        opts?.onProgress?.(
          chunkProgress,
          `Downloaded ${allRows.length} bars (chunk ${completedChunks}/${chunks.length}, ${skippedChunks} skipped)`,
        );
        continue;
      }

      if (rows.length > 0) {
        pushAll(allRows, rows);
      }
      completedChunks++;

      // Progress reporting
      const chunkProgress = 5 + Math.round((completedChunks / chunks.length) * 75);
      opts?.onProgress?.(
        chunkProgress,
        `Downloaded ${allRows.length} bars (chunk ${completedChunks}/${chunks.length}${skippedChunks > 0 ? `, ${skippedChunks} skipped` : ''})`,
      );

      if (opts?.onBarProgress) {
        const lastRow = allRows[allRows.length - 1];
        const currentYear = lastRow ? new Date(lastRow.timestamp * 1000).getUTCFullYear() : null;
        opts.onBarProgress({
          downloadedBars: allRows.length,
          estimatedTotalBars,
          currentYear,
        });
      }

      opts?.onChunkDateRange?.({
        chunkStart: chunk.startDate,
        chunkEnd: chunk.endDate,
        completedChunks,
        totalChunks: chunks.length,
      });

      // TICKET_351_P2: Cooperative yield check after each chunk
      if (control?.shouldYield?.()) {
        appLog.info(
          `[DataCacheManager] Yielding at chunk ${completedChunks}/${chunks.length} for ${symbol}/${interval}`
        );
        // TICKET_958_4 AC #1: cooperative yield returns an intentionally
        // incomplete result; the caller knows to resume. Do NOT enforce
        // the trading-day invariant here -- that would convert a normal
        // yield into a false-positive CacheWriteIntegrityError.
        // TICKET_1126 F2: the yielded partial result IS written to cache,
        // so it passes the OHLC gate like the complete path below.
        return {
          rows: allRows,
          skippedChunks,
        };
      }
    }

    if (skippedChunks > 0) {
      appLog.info(
        `[DataCacheManager] TICKET_1078: fetchRange complete: ${symbol}/${interval} ` +
        `${chunks.length} chunks, ${skippedChunks} skipped, ${allRows.length} rows`,
      );
    }

    // TICKET_958_4 AC #1 / TICKET_1072_1: trading-day completeness check.
    // The full chunk loop completed without yielding, so `allRows` is the
    // provider's complete answer for [startDate, endDate]. Instead of
    // throwing on missing days (which discards all data), we return a
    // diagnostic so the caller can log + persist the gap.
    //
    // TICKET_1050: clamp to actual data envelope (pre-listing / stale-edge
    // days are expected absence).
    // TICKET_1078: skip when chunks were skipped -- gaps are known.
    let missingDaysResult: MissingDaysResult | undefined;
    if (allRows.length > 0 && skippedChunks === 0) {
      const actualFirstMs = allRows[0].timestamp * MS_PER_SECOND;
      const actualLastMs = allRows[allRows.length - 1].timestamp * MS_PER_SECOND;
      const fetchStartMs = new Date(startDate + 'T00:00:00Z').getTime();
      const fetchEndMs = new Date(endDate + 'T23:59:59Z').getTime();
      const invariantStartMs = Math.max(fetchStartMs, Math.floor(actualFirstMs / MS_PER_DAY) * MS_PER_DAY);
      const invariantEndMs = Math.min(fetchEndMs, actualLastMs);
      missingDaysResult = checkMissingTradingDays(allRows, provider, interval, invariantStartMs, clampEndMsToCompletedDay(invariantEndMs));
      const warning = formatMissingDaysWarning(missingDaysResult, provider.id, allRows.length, invariantStartMs, invariantEndMs);
      if (warning) {
        appLog.warn(`[DataCacheManager] TICKET_1072_1 fetchRange: ${warning}`);
      }
    }

    return { rows: allRows, skippedChunks, missingDaysResult };
  }

  // =========================================================================
  // Metadata helpers
  // =========================================================================

  private getMetadataById(id: number): CacheFileRecord | null {
    const db = getDatabaseManager();
    const row = db.prepare('SELECT * FROM data_cache_files WHERE id = ?').get(id) as CacheFileRow | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  backfillCodec(id: number, codec: string): void {
    const db = getDatabaseManager();
    db.prepare('UPDATE data_cache_files SET codec = ? WHERE id = ?').run(codec, id);
  }

  /**
   * TICKET_962 P2 application-layer invariant:
   *   - Post-write callers (any site that ran the merge-write-upsert
   *     sequence so `merged[]` is in hand) MUST pass non-null
   *     `actualFirstTimestamp` / `actualLastTimestamp`. They are the
   *     parquet-truth values and represent the row we just wrote.
   *   - Decision-only callers (the empty-merge branch in TICKET_372
   *     virtual-extension expansion) MUST NOT call this method; they
   *     keep the existing actual_* values intact by issuing a narrower
   *     UPDATE that touches virtual coverage only. See
   *     `upsertVirtualCoverageOnly` below.
   *
   * The assertion is fail-fast (TICKET_858): a write-path call with
   * NULL actual_* would re-introduce the metadata/parquet desync the
   * R2 split exists to prevent.
   */
  private upsertMetadata(record: CacheFileRecord): void {
    if (record.actualFirstTimestamp === null || record.actualLastTimestamp === null) {
      throw new Error(
        `[DataCacheManager] upsertMetadata called with NULL actual_* for ` +
        `${record.symbol}/${record.interval}/${record.provider}. ` +
        `Write-path sites must pass parquet-truth values; ` +
        `decision-only sites must use upsertVirtualCoverageOnly. ` +
        `(TICKET_962 P2 application-layer invariant.)`
      );
    }
    // TICKET_958_5 AC #4: every data_cache_files row must point at a parquet
    // under the canonical cache root (userData/{PARQUET_CACHE_DIR}/...). A
    // row that escapes the cache root would let a future caller bypass the
    // canonical OHLCV_V1_CANONICAL writer and read a non-canonical schema
    // through the gate's single SQL surface -- the exact footgun the rest
    // of TICKET_958_5 exists to remove. Fail-fast at the write boundary
    // (TICKET_858); STRATCRAFT_RESEARCH_MODE=1 bypasses for external-store
    // research workflows (documented in the throw message).
    assertCacheFilePathContained(record.filePath);
    const db = getDatabaseManager();

    if (record.id > 0) {
      // Update existing
      db.prepare(`
        UPDATE data_cache_files
        SET file_path = ?, first_timestamp = ?, last_timestamp = ?,
            actual_first_timestamp = ?, actual_last_timestamp = ?,
            row_count = ?, source_type = ?, base_file_id = ?,
            completeness = ?, missing_days = ?, codec = ?,
            content_revision = content_revision + 1,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        record.filePath, record.firstTimestamp, record.lastTimestamp,
        record.actualFirstTimestamp, record.actualLastTimestamp,
        record.rowCount, record.sourceType, record.baseFileId,
        record.completeness, record.missingDaysJson, record.codec,
        record.id
      );
    } else {
      // Insert or replace (UNIQUE constraint on symbol+interval+provider)
      db.prepare(`
        INSERT INTO data_cache_files
          (symbol, interval, provider, file_path, first_timestamp, last_timestamp,
           actual_first_timestamp, actual_last_timestamp,
           row_count, source_type, base_file_id,
           completeness, missing_days, codec, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(symbol, interval, provider)
        DO UPDATE SET
          file_path = excluded.file_path,
          first_timestamp = excluded.first_timestamp,
          last_timestamp = excluded.last_timestamp,
          actual_first_timestamp = excluded.actual_first_timestamp,
          actual_last_timestamp = excluded.actual_last_timestamp,
          row_count = excluded.row_count,
          source_type = excluded.source_type,
          base_file_id = excluded.base_file_id,
          completeness = excluded.completeness,
          missing_days = excluded.missing_days,
          codec = excluded.codec,
          content_revision = data_cache_files.content_revision + 1,
          updated_at = datetime('now')
      `).run(
        record.symbol, record.interval, record.provider,
        record.filePath, record.firstTimestamp, record.lastTimestamp,
        record.actualFirstTimestamp, record.actualLastTimestamp,
        record.rowCount, record.sourceType, record.baseFileId,
        record.completeness, record.missingDaysJson, record.codec,
      );
    }
  }

  /**
   * TICKET_962 P2: dedicated path for the TICKET_372 virtual-extension
   * branch (empty-merge case where the provider returned 0 rows and we
   * only widen `first_timestamp` / `last_timestamp` to suppress future
   * re-fetch of the confirmed-empty range). This site has NO merged[]
   * in hand -- it has no new parquet-truth to write -- so it MUST NOT
   * touch `actual_*` (which already hold the truth from the prior write
   * that registered the file). Writing NULL or virtual values into
   * actual_* would re-introduce the lie. UPDATE-by-id ONLY -- this is
   * never the bootstrap insert (a row must exist for the empty-merge
   * branch to fire).
   */
  private upsertVirtualCoverageOnly(record: CacheFileRecord): void {
    if (record.id <= 0) {
      throw new Error(
        `[DataCacheManager] upsertVirtualCoverageOnly requires an existing ` +
        `row id; got ${record.id} for ${record.symbol}/${record.interval}/${record.provider}. ` +
        `Use upsertMetadata for inserts.`
      );
    }
    const db = getDatabaseManager();
    db.prepare(`
      UPDATE data_cache_files
      SET first_timestamp = ?, last_timestamp = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(record.firstTimestamp, record.lastTimestamp, record.id);
  }

  private isAggregateStale(baseRecord: CacheFileRecord, aggRecord: CacheFileRecord): boolean {
    // Aggregate is stale if base was updated after the aggregate
    return baseRecord.updatedAt > aggRecord.updatedAt;
  }

  /**
   * Truncate Unix timestamp (seconds) to UTC date string YYYY-MM-DD.
   */
  private truncateToDate(unixSeconds: number): string {
    const date = new Date(unixSeconds * MS_PER_SECOND);
    return date.toISOString().split('T')[0];
  }

  /**
   * Split a date range into chunks for progress reporting.
   * Same logic as the old DownloadManager.splitGapIntoChunks().
   */
  splitGapIntoChunks(startDate: string, endDate: string, interval: string): DateChunk[] {
    const months = CHUNK_MONTHS[interval];
    if (!months) {
      return [{ startDate, endDate }];
    }

    const chunks: DateChunk[] = [];
    let cursor = startDate;

    while (cursor <= endDate) {
      const d = new Date(cursor + 'T00:00:00Z');
      d.setUTCMonth(d.getUTCMonth() + months);
      const chunkEnd = d.toISOString().split('T')[0];

      // prevDay of chunkEnd
      const pd = new Date(chunkEnd + 'T00:00:00Z');
      pd.setUTCDate(pd.getUTCDate() - 1);
      const prevDayStr = pd.toISOString().split('T')[0];

      const boundedEnd = prevDayStr < endDate ? prevDayStr : endDate;

      if (boundedEnd < cursor) {
        chunks.push({ startDate: cursor, endDate });
        break;
      }

      chunks.push({ startDate: cursor, endDate: boundedEnd });
      cursor = chunkEnd;
    }

    return chunks;
  }

  private rowToRecord(row: CacheFileRow): CacheFileRecord {
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
}

// =============================================================================
// TICKET_918: purge metadata rows written by an older cache format version.
// Old entries point to ZSTD-compressed Parquet files that @dsnp/parquetjs
// cannot read. Deleting the rows (not the files) causes the next data
// request to re-download into the current v{N}/ directory with a
// compatible codec.
// =============================================================================

const PARQUET_CACHE_PATH_MARKER = `/${PARQUET_CACHE_DIR}/`;

/**
 * TICKET_918 Phase 4: purge cache records that point at a Parquet file the
 * Electron-side reader cannot decompress (notably ZSTD).
 *
 * The original guard keyed off a PATH PREFIX -- it purged records not under
 * `/v{N}/`, assuming everything inside `v{N}/` was SNAPPY. That assumption is
 * false: the BYOD bulk-register path (registerParquetDirectory) lands
 * user-supplied files in `v{N}/{package}/` carrying whatever codec the source
 * tool wrote (DuckDB defaults to ZSTD). Those files passed the prefix filter
 * and were never purged, so the sweep's Python-fit arm kept crashing with
 * `invalid compression method: ZSTD`.
 *
 * The fix inspects the REAL on-disk codec of each file (footer only, cheap)
 * and purges any record whose file is not reader-readable. Deleting the
 * record -- not the file -- causes the next data request to regenerate it via
 * the SNAPPY writer. A missing file is also purged (dangling record).
 */
async function purgeStaleFormatRecords(): Promise<void> {
  const db = getDatabaseManager();
  const candidates = db.prepare(
    `SELECT id, file_path, codec FROM data_cache_files WHERE file_path LIKE ?`,
  ).all(
    `%${PARQUET_CACHE_PATH_MARKER}%`,
  ) as Array<{ id: number; file_path: string; codec: string | null }>;

  if (candidates.length === 0) return;

  const stale: number[] = [];
  for (const row of candidates) {
    if (!existsSync(row.file_path)) {
      stale.push(row.id);
      continue;
    }
    if (row.codec) continue;
    const { readable, codecs } = await inspectParquetCodec(row.file_path);
    if (!readable) {
      stale.push(row.id);
    } else {
      db.prepare('UPDATE data_cache_files SET codec = ? WHERE id = ?')
        .run(codecs[0] ?? 'SNAPPY', row.id);
    }
  }

  if (stale.length === 0) return;

  const del = db.prepare('DELETE FROM data_cache_files WHERE id = ?');
  const apply = db.transaction(() => {
    for (const id of stale) del.run(id);
  });
  apply();

  appLog.info(
    `[DataCacheManager] TICKET_918: purged ${stale.length}/${candidates.length} ` +
    `cache records with an unreadable Parquet codec (e.g. ZSTD) or missing file; ` +
    `they will be regenerated via the SNAPPY writer on next request`,
  );
}

// =============================================================================
// Two-phase Singleton
// =============================================================================

let instance: DataCacheManager | null = null;

export async function initializeDataCacheManager(): Promise<void> {
  if (instance) {
    appLog.warn('[DataCacheManager] Already initialized, skipping');
    return;
  }
  instance = new DataCacheManager();

  // TICKET_918 Phase 4: must complete BEFORE any sweep reads cache files, so
  // an unreadable-codec record can never be handed to the parquetjs reader.
  // Inspecting a few hundred footers costs ~hundreds of ms at startup --
  // correctness over launch speed (TICKET_855: do not hide the work behind a
  // race). Never throw out of init for this; a purge failure must not block
  // app start.
  try {
    await purgeStaleFormatRecords();
  } catch (err) {
    appLog.error('[DataCacheManager] TICKET_918 purge error:', err);
  }

  // Bootstrap legacy files asynchronously (non-blocking)
  instance.bootstrapLegacyFiles().catch(err => {
    appLog.error('[DataCacheManager] Bootstrap error:', err);
  });

  // TICKET_962 P2: back-fill `actual_first/last_timestamp` for any row that
  // pre-dates migration v99 (the schema change adds the columns NULL; this
  // resolves them to parquet-truth values via DuckDB row-group statistics).
  // Awaited so that any subsequent write-path call sees a fully-resolved
  // table -- the `upsertMetadata` application-layer assertion would
  // otherwise reject any UPDATE on a NULL row whose actual_* are merged
  // from the existing record (TICKET_858 fail-fast).
  try {
    await instance.backfillActualTimestamps();
  } catch (err) {
    appLog.error('[DataCacheManager] TICKET_962 backfill error:', err);
  }

  // TICKET_1098: register imported-package names + dynamic asset-class
  // resolver on the tier-0 instrument registry so that market_scope
  // derivation (deriveMarketScope in discovery-persistence) produces
  // correct DynamicMarketId values (e.g. `byod_forex`) for imported
  // packages.  Previously this lived only in ipc/index.ts, so sweep
  // scripts that bypassed IPC init wrote stale `duckdb_import_forex`
  // values instead.  Moving it here guarantees that every caller --
  // IPC init, sweep scripts, any future headless entry point -- gets
  // correct instrument registry state as soon as data-cache-manager
  // is ready (which is the earliest moment package metadata is
  // available).
  const mgr = instance!;
  setDynamicAssetClassResolver((market: string) => {
    if (!market.startsWith('byod_')) return null;
    const pkgName = market.slice(5);
    const pkg = mgr.getImportedPackage(pkgName);
    return (pkg?.assetClass as 'us_equity' | 'forex' | 'crypto' | 'cn_a_share') ?? null;
  });
  const pkgNames = new Set(mgr.listImportedPackages().map(p => p.packageName));
  (staticInstrumentRegistry as StaticInstrumentRegistry).setImportedPackageNames(pkgNames);
  appLog.info(`[DataCacheManager] TICKET_1098: instrument registry seeded with ${pkgNames.size} imported package(s)`);

  appLog.info('[DataCacheManager] Initialized');
}

export function getDataCacheManager(): DataCacheManager {
  if (!instance) {
    throw new Error('DataCacheManager not initialized. Call initializeDataCacheManager() first.');
  }
  return instance;
}
