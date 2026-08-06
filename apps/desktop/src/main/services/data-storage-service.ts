/**
 * Data Storage Service
 *
 * TICKET_329: Unified data storage pipeline.
 * TICKET_362: Rewritten to use DataCacheManager (single-file append model).
 *
 * Public API:
 *   ensureSingle(config) -> DataEnsureResponse
 *   ensureMultiTimeframe(config) -> DataEnsureMultiResponse
 */

import { existsSync } from 'fs';
import { sendToRenderer } from '../window';
import {
  getParquetCacheService,
  OHLCVRow,
  inspectParquetCodec,
  reencodeParquetToReadableCodec,
} from './parquet-cache-service';
import { getDataProviderManager } from './data-providers/provider-manager';
import { getAggregationService } from './data-providers/aggregation/aggregation-service';
import { getDataCacheManager, DownloadControl } from './data-cache-manager';
import { getDataDownloadQueue } from './data-download-queue';
import { appLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import { ALL_INTERVALS } from '@StratCraft/types';

// =============================================================================
// Response Types
// =============================================================================

export interface DataEnsureResponse {
  success: boolean;
  symbol: string;
  dataPath?: string;
  source?: string;
  error?: string;
  coverage?: {
    symbol: string;
    interval: string;
    startDate: string;
    endDate: string;
    totalBars: number;
    completeness: number;
  };
  downloadStats?: {
    barsDownloaded: number;
    barsImported: number;
    chunksProcessed: number;
  };
  /**
   * TICKET_962 P1: present when the requested [startDate, endDate] window was
   * narrowed to the provider's declared maxLookback[interval]. Forwarded
   * unchanged from `DataCacheManager.EnsureDataResult.clamp` so the IPC
   * boundary (v3-handlers.ts) can surface a typed warning instead of
   * silently downgrading (TICKET_858).
   */
  clamp?: {
    requestedStartDate: string;
    clampedStartDate: string;
    providerId: string;
    maxLookbackSpec: string;
  };
}


/**
 * TICKET_919_5: Structured error raised by the imported-package branch
 * of `resolveLocalOrDownloadUniverse` when the requested interval is
 * absent from the package catalog.
 *
 * Replaces the 66-line wall of identical per-symbol "No imported data
 * for X/1w" failures with one root-cause error carrying the package's
 * actual interval set, so the UI can render a typed card (title +
 * Available/Requested/Universe facts + one-click "Use {fallback}"
 * recovery) instead of a generic "Something went wrong" banner.
 *
 * The `code` field is serialised across IPC so the renderer can branch
 * on it; the message remains human-readable for callers / logs that do
 * not inspect the structured payload.
 */
export class ImportedPackageIntervalUnavailableError extends Error {
  readonly code = 'IMPORTED_PACKAGE_INTERVAL_UNAVAILABLE' as const;
  readonly package: string;
  readonly requestedInterval: string;
  readonly availableIntervals: string[];
  readonly symbolCount: number;
  readonly universeId: string | undefined;

  constructor(params: {
    package: string;
    requestedInterval: string;
    availableIntervals: string[];
    symbolCount: number;
    universeId?: string;
  }) {
    const available = params.availableIntervals.length > 0
      ? params.availableIntervals.join(', ')
      : '(none)';
    super(
      `Imported package '${params.package}' has no '${params.requestedInterval}' data. ` +
      `Available intervals: ${available}.`,
    );
    this.name = 'ImportedPackageIntervalUnavailableError';
    this.package = params.package;
    this.requestedInterval = params.requestedInterval;
    this.availableIntervals = params.availableIntervals;
    this.symbolCount = params.symbolCount;
    this.universeId = params.universeId;
  }

  /** Plain-object payload safe to serialise over IPC. */
  toJSON(): {
    code: 'IMPORTED_PACKAGE_INTERVAL_UNAVAILABLE';
    message: string;
    package: string;
    requestedInterval: string;
    availableIntervals: string[];
    symbolCount: number;
    universeId: string | undefined;
  } {
    return {
      code: this.code,
      message: this.message,
      package: this.package,
      requestedInterval: this.requestedInterval,
      availableIntervals: this.availableIntervals,
      symbolCount: this.symbolCount,
      universeId: this.universeId,
    };
  }
}

export interface DataEnsureMultiResponse {
  success: boolean;
  symbol: string;
  dataFeeds: Record<string, { dataPath: string; totalBars: number }>;
  error?: string;
  /** TICKET_351_P2_1: true when ensureData yielded to higher-priority task */
  yielded?: boolean;
}

// =============================================================================
// Internal Types
// =============================================================================

/** TICKET_344: Progress callback for external consumers (e.g., download queue) */
type ProgressCallback = (progress: number, message: string) => void;

/**
 * TICKET_1051 P0: Enriched download-phase statistics accumulated by
 * resolveLocalOrDownloadUniverse and forwarded to the orchestrator so
 * the UI can show cache/network/failure breakdown, elapsed time, and ETA.
 */
export interface UniverseDownloadStats {
  cacheHits: number;
  networkDownloads: number;
  failures: number;
  failedSymbols: string[];
  elapsedMs: number;
}

/** TICKET_1051 P1 AC8: per-symbol bar-level progress */
export interface SymbolBarProgress {
  downloadedBars: number;
  estimatedTotalBars: number;
  currentYear: number | null;
}

export type EnrichedProgressCallback = (
  completed: number,
  total: number,
  symbol: string,
  stats: UniverseDownloadStats,
  symbolBarProgress?: SymbolBarProgress,
) => void;

// =============================================================================
// TICKET_919_8: Window-intersection freshness gate
// =============================================================================

/**
 * TICKET_919_8: A symbol whose cached file exists on disk is not necessarily
 * usable for the requested training window. ETXEUR_1h.parquet's last bar is
 * 2019-02-01; for a 2026-04-12 query window, pyarrow window pushdown returns
 * 0 rows and the universe min-bars preflight refuses the whole template even
 * though the other 65 symbols in `dynamic_forex` are healthy.
 *
 * This gate consumes `record.firstTimestamp` / `record.lastTimestamp`
 * (Unix seconds, already persisted by `registerImportedFile` / append-write
 * paths in `data-cache-manager.ts`) and the optional
 * `[fallbackStartDate, fallbackEndDate]` window from the resolve call. A
 * cached record is "usable" iff `[firstTs, lastTs]` intersects the requested
 * window. When the window is undefined (programmatic callers, tests, legacy
 * paths), the gate is a no-op -- behavior is identical to today.
 *
 * No parquet header read, no SQL, no schema change. Pure additive.
 */
export function recordIntersectsWindow(
  record: { firstTimestamp?: number; lastTimestamp?: number },
  fallbackStartDate: string | undefined,
  fallbackEndDate: string | undefined,
): boolean {
  if (!fallbackStartDate && !fallbackEndDate) return true;
  // Records written before this ticket may lack timestamps in tests / legacy
  // metadata; treat unknown coverage as a no-op (do not penalise a record we
  // cannot prove is stale -- the existing readers will still catch zero-row
  // outputs at the universe min-bars preflight).
  if (
    typeof record.firstTimestamp !== 'number' ||
    typeof record.lastTimestamp !== 'number'
  ) {
    return true;
  }
  // record timestamps are Unix seconds (see DataCacheManager.truncateToDate);
  // Date.parse returns ms.
  const windowStartSec = fallbackStartDate
    ? Math.floor(Date.parse(fallbackStartDate) / 1000)
    : Number.NEGATIVE_INFINITY;
  const windowEndSec = fallbackEndDate
    ? Math.floor(Date.parse(fallbackEndDate) / 1000)
    : Number.POSITIVE_INFINITY;
  // [recordFirst, recordLast] intersects [windowStart, windowEnd] iff
  // recordLast >= windowStart AND recordFirst <= windowEnd.
  return record.lastTimestamp >= windowStartSec && record.firstTimestamp <= windowEndSec;
}

/**
 * TICKET_958_3 AC #3 -- cover-not-intersect freshness gate using
 * parquet-truth timestamps.
 *
 * `recordIntersectsWindow` answers "is the cache useful AT ALL for this
 * window?" using the TICKET_372 VIRTUAL coverage fields (which are
 * deliberately widened to suppress empty-range re-fetches). That semantic
 * is right for the imported-package branch (no download fallback) but is
 * the WRONG question on the download branch: a cache row whose virtual
 * coverage trivially intersects the window but whose ACTUAL parquet only
 * holds a narrow slice will silently pass through `localHits`, get handed
 * to the universe min-bars gate, and refuse the sweep -- exactly the
 * failure mode that bit TICKET_958_3 on 2026-06-14 when the source
 * parquet was re-aggregated wider than the cache.
 *
 * This sibling answers the right question: "does the cache's ACTUAL on-
 * disk span fully cover the requested window?" If not, the row routes
 * into the existing download path, which will widen the cache. Uses the
 * `actual_*_timestamp` columns (migration v99 + boot-time backfill --
 * non-null by construction; see TICKET_962 P2 / P6.1).
 *
 * NOT a replacement for `recordIntersectsWindow` -- the two answer
 * different questions. The imported-package branch keeps the intersect
 * semantics (no download fallback exists for imports). The download
 * branch upgrades to cover.
 *
 * Records written before migration v99 (`actual_*` null) are treated as
 * NOT covered -- safer to re-fetch than to silently serve narrow data;
 * the v99 backfill makes this branch unreachable in steady state.
 */
export function recordCoversWindow(
  record: {
    actualFirstTimestamp?: number | null;
    actualLastTimestamp?: number | null;
  },
  fallbackStartDate: string | undefined,
  fallbackEndDate: string | undefined,
): boolean {
  if (!fallbackStartDate && !fallbackEndDate) return true;
  if (
    typeof record.actualFirstTimestamp !== 'number' ||
    typeof record.actualLastTimestamp !== 'number'
  ) {
    // No parquet-truth bounds available -- treat as NOT covered so the
    // download path runs. The v99 backfill closes this gap in steady state.
    return false;
  }
  const windowStartSec = fallbackStartDate
    ? Math.floor(Date.parse(fallbackStartDate) / 1000)
    : Number.NEGATIVE_INFINITY;
  const windowEndSec = fallbackEndDate
    ? Math.floor(Date.parse(fallbackEndDate) / 1000)
    : Number.POSITIVE_INFINITY;
  // Cover semantics: actualFirst <= windowStart AND actualLast >= windowEnd.
  return record.actualFirstTimestamp <= windowStartSec && record.actualLastTimestamp >= windowEndSec;
}

// =============================================================================
// DataStorageService
// =============================================================================

class DataStorageService {
  // TICKET_913 P1: resolve a symbol from an imported package's local cache.
  // Imported data is already on disk as Parquet; no IDataProvider needed.
  private resolveImportedFile(
    symbol: string,
    interval: string,
    providerId: string,
  ): DataEnsureResponse | null {
    const dcm = getDataCacheManager();
    if (!dcm.getImportedPackage(providerId)) return null;
    const record = dcm.getMetadata(symbol, interval, providerId);
    if (!record || !existsSync(record.filePath)) {
      return {
        success: false,
        symbol,
        error: `Imported package '${providerId}' has no data for ${symbol}/${interval}`,
      };
    }
    return {
      success: true,
      symbol,
      dataPath: record.filePath,
      source: providerId,
      coverage: {
        symbol,
        interval,
        startDate: new Date(record.firstTimestamp * 1000).toISOString().split('T')[0],
        endDate: new Date(record.lastTimestamp * 1000).toISOString().split('T')[0],
        totalBars: record.rowCount,
        completeness: 1.0,
      },
    };
  }

  /**
   * Ensure single timeframe data is available.
   * TICKET_362: Delegates to DataCacheManager.ensureData().
   */
  async ensureSingle(config: {
    symbol: string;
    startDate: string;
    endDate: string;
    interval: string;
    provider?: string;
    forceDownload?: boolean;
    onProgress?: ProgressCallback;
    onBarProgress?: (progress: SymbolBarProgress) => void;
    resumeProgress?: number;
    control?: DownloadControl;
  }): Promise<DataEnsureResponse> {
    if (config.provider) {
      const imported = this.resolveImportedFile(config.symbol, config.interval, config.provider);
      if (imported) return imported;
    }
    const providerMgr = getDataProviderManager();
    const provider = providerMgr.getProvider(config.provider || providerMgr.getDefaultProvider().id);
    const dataCacheManager = getDataCacheManager();

    try {
      const result = await dataCacheManager.ensureData(
        config.symbol,
        config.interval,
        config.startDate,
        config.endDate,
        provider,
        {
          forceDownload: config.forceDownload,
          onProgress: config.onProgress,
          onBarProgress: config.onBarProgress,
          resumeProgress: config.resumeProgress,
        },
        config.control
      );

      sendToRenderer('data:progress', {
        symbol: config.symbol,
        phase: 'complete',
        progress: 1.0,
        message: 'Data ready',
      });

      return {
        success: true,
        symbol: config.symbol,
        dataPath: result.filePath,
        source: provider.id,
        coverage: {
          symbol: config.symbol,
          interval: config.interval,
          // TICKET_962 P1: the coverage we report is the EFFECTIVE
          // (post-clamp) window -- not the unfetchable requested one.
          // The pre-clamp ask is preserved on `clamp.requestedStartDate`
          // for the IPC layer's typed warning.
          startDate: result.clamp?.clampedStartDate ?? config.startDate,
          endDate: config.endDate,
          totalBars: result.rowCount,
          completeness: 1.0,
        },
        downloadStats: {
          barsDownloaded: result.rowCount,
          barsImported: result.rowCount,
          chunksProcessed: 1,
        },
        ...(result.clamp ? { clamp: result.clamp } : {}),
      };
    } catch (error) {
      return {
        success: false,
        symbol: config.symbol,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Ensure data for multiple timeframes.
   * TICKET_362: Uses DataCacheManager for both base and aggregated files.
   */
  async ensureMultiTimeframe(config: {
    symbol: string;
    startDate: string;
    endDate: string;
    timeframes: string[];
    provider?: string;
    forceDownload?: boolean;
    control?: DownloadControl;
  }): Promise<DataEnsureMultiResponse> {
    appLog.info(`[DataStorage] Ensuring multi-timeframe: ${config.symbol}, [${config.timeframes.join(', ')}]`);

    // TICKET_1225 P4: Validate intervals against the canonical vocabulary.
    // Each token must be an exact (case-sensitive) match against ALL_INTERVALS.
    // This is the G2 contract assertion: `1m` (minute) and `1M` (monthly)
    // are distinct tokens; any case-folding upstream would be caught here.
    const canonicalSet = new Set<string>(ALL_INTERVALS);
    for (const tf of config.timeframes) {
      if (!canonicalSet.has(tf)) {
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataStorage.invalidIntervalToken', { token: tf }));
      }
    }

    if (config.provider) {
      const dcm = getDataCacheManager();
      if (dcm.getImportedPackage(config.provider)) {
        const dataFeeds: Record<string, { dataPath: string; totalBars: number }> = {};
        for (const tf of config.timeframes) {
          const record = dcm.getMetadata(config.symbol, tf, config.provider);
          if (!record || !existsSync(record.filePath)) {
            return {
              success: false,
              symbol: config.symbol,
              dataFeeds,
              error: `Imported package '${config.provider}' has no data for ${config.symbol}/${tf}`,
            };
          }
          dataFeeds[tf] = { dataPath: record.filePath, totalBars: record.rowCount };
        }
        return { success: true, symbol: config.symbol, dataFeeds };
      }
    }

    const providerMgr = getDataProviderManager();
    const provider = providerMgr.getProvider(config.provider || providerMgr.getDefaultProvider().id);
    const aggregationService = getAggregationService();
    const dataCacheManager = getDataCacheManager();
    const dataFeeds: Record<string, { dataPath: string; totalBars: number }> = {};

    if (aggregationService.isAggregateMode(provider)) {
      // AGGREGATE MODE: fetch base interval once, aggregate locally
      const baseInterval = provider.capabilities.baseInterval!;

      // Step 1: Ensure base interval data
      const baseResult = await dataCacheManager.ensureData(
        config.symbol,
        baseInterval,
        config.startDate,
        config.endDate,
        provider,
        {
          forceDownload: config.forceDownload,
          onProgress: (_pct: number, msg: string) => {
            sendToRenderer('data:progress', {
              symbol: config.symbol,
              phase: 'multi_timeframe_loading',
              progress: 0,
              currentChunk: 1,
              totalChunks: config.timeframes.length,
              message: msg,
            });
          },
        },
        config.control
      );

      dataFeeds[baseInterval] = { dataPath: baseResult.filePath, totalBars: baseResult.rowCount };

      // TICKET_351_P2_1: Propagate yield from base interval ensureData
      if (baseResult.yielded) {
        appLog.info(`[DataStorage] Multi-TF yielded during base interval fetch for ${config.symbol}`);
        return { success: true, symbol: config.symbol, dataFeeds, yielded: true };
      }

      // Step 2: Aggregate each requested timeframe from base
      const baseRecord = dataCacheManager.getMetadata(config.symbol, baseInterval, provider.id);
      const baseFileId = baseRecord?.id || 0;

      for (let i = 0; i < config.timeframes.length; i++) {
        const timeframe = config.timeframes[i];
        if (timeframe === baseInterval) continue;

        sendToRenderer('data:progress', {
          symbol: config.symbol,
          phase: 'multi_timeframe_loading',
          progress: (i + 1) / config.timeframes.length,
          currentChunk: i + 1,
          totalChunks: config.timeframes.length,
          message: `Aggregating ${timeframe} data...`,
        });

        const aggResult = await dataCacheManager.ensureAggregatedFile(
          config.symbol,
          timeframe,
          provider,
          baseFileId,
          baseResult.filePath,
          baseInterval,
          {
            startMs: new Date(`${config.startDate}T00:00:00.000Z`).getTime(),
            endMs: new Date(`${config.endDate}T23:59:59.999Z`).getTime(),
          },
        );

        dataFeeds[timeframe] = { dataPath: aggResult.filePath, totalBars: aggResult.rowCount };
      }
    } else {
      // NATIVE MODE: per-timeframe direct fetch (ClickHouse, YFinance, Dukascopy)
      for (let i = 0; i < config.timeframes.length; i++) {
        const timeframe = config.timeframes[i];
        const tfIndex = i;

        const result = await dataCacheManager.ensureData(
          config.symbol,
          timeframe,
          config.startDate,
          config.endDate,
          provider,
          {
            forceDownload: config.forceDownload,
            onProgress: (_pct: number, msg: string) => {
              sendToRenderer('data:progress', {
                symbol: config.symbol,
                phase: 'multi_timeframe_loading',
                progress: (tfIndex + 1) / config.timeframes.length,
                currentChunk: tfIndex + 1,
                totalChunks: config.timeframes.length,
                message: msg,
              });
            },
          },
          config.control
        );

        dataFeeds[timeframe] = { dataPath: result.filePath, totalBars: result.rowCount };

        // TICKET_351_P2_1: Propagate yield from per-TF ensureData
        if (result.yielded) {
          appLog.info(`[DataStorage] Multi-TF yielded during ${timeframe} fetch for ${config.symbol}`);
          return { success: true, symbol: config.symbol, dataFeeds, yielded: true };
        }
      }
    }

    sendToRenderer('data:progress', {
      symbol: config.symbol,
      phase: 'complete',
      progress: 1.0,
      message: `Loaded ${config.timeframes.length} timeframe(s)`,
    });

    appLog.info(`[DataStorage] Multi-timeframe ready: ${Object.keys(dataFeeds).join(', ')}`);

    return {
      success: true,
      symbol: config.symbol,
      dataFeeds,
    };
  }

  /**
   * Clear all data cache: parquet files, metadata DB records, and download queue.
   *
   * Order:
   *   1. Cancel in-flight downloads and purge download_queue table
   *   2. Delete all rows from data_cache_files table
   *   3. Delete all parquet files from disk
   */
  async clearAllDataCache(): Promise<{ deletedFiles: number; deletedCacheRecords: number; deletedQueueTasks: number }> {
    appLog.info('[DataStorage] clearAllDataCache: starting full cache clear');

    // 1. Stop queue and purge download_queue table
    const deletedQueueTasks = getDataDownloadQueue().clearAll();

    // 2. Purge data_cache_files table
    const deletedCacheRecords = getDataCacheManager().clearAll();

    // 3. Delete parquet files from disk
    const deletedFiles = getParquetCacheService().clearCache();

    appLog.info(
      `[DataStorage] clearAllDataCache complete: ${deletedFiles} files, ${deletedCacheRecords} records, ${deletedQueueTasks} queue tasks`
    );

    return { deletedFiles, deletedCacheRecords, deletedQueueTasks };
  }
}

// =============================================================================
// Two-phase Singleton
// =============================================================================

let instance: DataStorageService | null = null;

export function initializeDataStorageService(): void {
  if (instance) {
    appLog.warn('[DataStorage] Already initialized, skipping');
    return;
  }
  instance = new DataStorageService();
  appLog.info('[DataStorage] Initialized');
}

export function getDataStorageService(): DataStorageService {
  if (!instance) {
    throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.dataStorage.notInitialized'));
  }
  return instance;
}
