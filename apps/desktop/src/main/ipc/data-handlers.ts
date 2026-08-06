/**
 * Data-Nexus IPC Router
 *
 * TICKET_142: Refactored to router-only pattern.
 * Business logic moved to plugins/data-nexus/backend/data-service.ts
 *
 * This module only handles:
 * - IPC channel registration
 * - Request routing to plugin backend
 * - Metrics collection
 *
 * @see TICKET_142: Data Handlers Plugin Migration
 * @see TICKET_045: IPC Integration for Strategy-Nexus and Data-Nexus
 */

import { ipcMain, app, BrowserWindow } from 'electron';
import { sendToRenderer } from '../window';
import { getBackendWithCapability } from '../services/plugin-backend-loader';
import { getDataProviderManager } from '../services/data-providers/provider-manager';
import { getDataStorageService } from '../services/data-storage-service';
import { getDataCacheManager } from '../services/data-cache-manager';
import { getDataDownloadQueue, DownloadPriority } from '../services/data-download-queue';
import {
  getDataImportService,
  type DataPackageImportRequest,
  type DataPackageScanRequest,
} from '../services/data-import-service';
import { appLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from '../services/locale-service';
import * as fs from 'fs';

// Plugin ID for data nexus
const DATA_NEXUS_PLUGIN_ID = 'com.stratcraft.data-nexus';

/**
 * TICKET_308_1 (Phase 5): in-flight BYOD import tasks, keyed by the
 * renderer-supplied task id, so `data:cancelImport` can abort a specific import
 * mid-run. The renderer owns the id (its import intent) -- this mirrors the
 * `kronos:cancel(taskId)` contract and keeps the main process free of any
 * non-deterministic id generation.
 */
const activeImportTasks = new Map<string, AbortController>();

/**
 * TICKET_308_1 (Phase 6): resolve a `data:ensure` request that targets a BYOD
 * imported package, WITHOUT entering the download queue or resolving a live
 * provider.
 *
 * Root-cause rationale (TICKET_860 -- fork at the boundary that owns the
 * distinction): an imported package is already-landed local data that is never
 * downloaded. The live-pull chain hard-assumes every source id is a registered
 * `IDataProvider` -- `DataProviderManager.getProvider(packageName)` THROWS
 * (provider-manager.ts:40), and `DataDownloadQueue` exists only to download from
 * a remote provider. So an imported source must be diverted HERE, at the
 * `data:ensure` IPC boundary where a source id first becomes a download intent,
 * to a direct `data_cache_files` read -- never the queue, never `getProvider`,
 * never `fullDownload`/`fetchRange`.
 *
 * The discriminator is the `imported_packages` catalog (migration v76): a
 * `provider` string is an imported package IFF it has a row there. Returns:
 *   - null  -> not an imported package; the caller falls through to the queue.
 *   - the cache-hit shape `{ success, filePath, rowCount, first/lastTimestamp }`
 *     when the imported `(symbol, interval, package)` file is registered.
 *
 * Fail-fast (TICKET_857/858): if the source IS an imported package but the
 * requested interval was not imported for that symbol (no registered
 * `(symbol, interval, package)` row), throw -- the interval-validity check the
 * provider path would do is replaced by the presence of the registered row.
 * The interval only exists in the cache if it was imported.
 */
function resolveImportedEnsure(config: {
  symbol: string;
  interval: string;
  provider?: string;
}): { success: true; dataPath: string; rowCount: number; firstTimestamp: number; lastTimestamp: number } | null {
  if (!config.provider) return null;

  const cacheManager = getDataCacheManager();
  const pkg = cacheManager.getImportedPackage(config.provider);
  if (!pkg) return null; // live provider id (or unknown) -> not our fork

  // It IS an imported package. The registered file row is authoritative; a
  // present `(symbol, interval, package)` row means that interval was imported.
  const record = cacheManager.getMetadata(config.symbol, config.interval, config.provider);
  if (!record) {
    throw new Error(
      mainT(getCurrentMainLocale(), 'errors', 'data.intervalNotImported', {
        interval: config.interval, symbol: config.symbol, provider: config.provider,
      })
    );
  }

  appLog.info(
    `[DataRouter] data:ensure imported-package cache read: ` +
    `${config.symbol}/${config.interval}/${config.provider} ` +
    `(${record.rowCount} rows, no provider/queue)`
  );

  return {
    success: true,
    dataPath: record.filePath,
    rowCount: record.rowCount,
    firstTimestamp: record.firstTimestamp,
    lastTimestamp: record.lastTimestamp,
  };
}

/**
 * TICKET_308_1a (Phase 7): the multi-timeframe sibling of `resolveImportedEnsure`.
 *
 * Phase 6 forked only `data:ensure`, but Phase 7 makes imported packages
 * selectable in the Alpha Factory picker that ALSO drives the multi-timeframe
 * run path (a workflow chip whose analysis/entry/exit slots span >1 timeframe
 * routes through `data:ensureMultiTimeframe`). That path enqueues to the
 * download queue, whose worker calls `getProvider(packageName)` and THROWS for
 * a non-provider id -- the exact failure Phase 6 prevents on the single-tf path.
 * So the same catalog-discriminated fork must exist here.
 *
 * Returns:
 *   - `null` when the source is a live provider (or no provider) -> the handler
 *     falls through to the queue (zero change for live providers).
 *   - the multi-timeframe success shape `{ success, dataPath, dataFeeds }` (the
 *     same shape the queue resolves on a multi-tf cache hit, consumed by
 *     `useAlphaFactoryBacktest`) when every requested timeframe is registered
 *     for the imported `(symbol, timeframe, package)`.
 *
 * Fail-fast (TICKET_857/858): an imported package with ANY requested timeframe
 * not imported throws -- imported data is read-from-disk only; a timeframe must
 * be imported before it can be used. Never enters the queue or resolves a
 * provider.
 */
function resolveImportedEnsureMultiTimeframe(config: {
  symbol: string;
  timeframes: string[];
  provider?: string;
}): { success: true; dataPath: string; dataFeeds: Record<string, { dataPath: string }> } | null {
  if (!config.provider) return null;

  const cacheManager = getDataCacheManager();
  const pkg = cacheManager.getImportedPackage(config.provider);
  if (!pkg) return null; // live provider id (or unknown) -> not our fork

  const dataFeeds: Record<string, { dataPath: string }> = {};
  for (const interval of config.timeframes) {
    const record = cacheManager.getMetadata(config.symbol, interval, config.provider);
    if (!record) {
      throw new Error(
        mainT(getCurrentMainLocale(), 'errors', 'data.intervalNotImported', {
          interval, symbol: config.symbol, provider: config.provider,
        })
      );
    }
    dataFeeds[interval] = { dataPath: record.filePath };
  }

  appLog.info(
    `[DataRouter] data:ensureMultiTimeframe imported-package cache read: ` +
    `${config.symbol}/[${config.timeframes.join(',')}]/${config.provider} ` +
    `(no provider/queue)`
  );

  // The primary feed (first timeframe) matches the single-tf `dataPath` field.
  const primary = config.timeframes[0];
  return {
    success: true,
    dataPath: dataFeeds[primary].dataPath,
    dataFeeds,
  };
}

// TICKET_351_P2: Priority mapping by callerId
const CALLER_PRIORITY: Record<string, DownloadPriority> = {
  'alpha-factory': 'critical',
  'backtest': 'normal',
  'data-manager': 'background',
};

// TICKET_127: Performance Metrics
const metrics = {
  pluginBackendCalls: 0,
  httpApiFallbackCalls: 0,
  pluginBackendErrors: 0,
  searchSymbolsCalls: { plugin: 0, http: 0, errors: 0 },
  checkCoverageCalls: { plugin: 0, http: 0, errors: 0 },
  checkConnectionCalls: { plugin: 0, http: 0, errors: 0 },
};

/**
 * Get data-nexus plugin backend module
 */
function getDataNexusBackend() {
  const result = getBackendWithCapability('searchSymbols');
  if (result?.pluginId === DATA_NEXUS_PLUGIN_ID && result.backend.initialized) {
    return result.backend.module;
  }
  return null;
}

/**
 * Register data IPC handlers (router only)
 *
 * TICKET_142: Routes requests to plugin backend
 */
export function registerDataHandlers(): void {
  // -------------------------------------------------------------------------
  // data:ensure - Ensure data is available (download if needed)
  // TICKET_146: Implements local Parquet cache
  // -------------------------------------------------------------------------
  // TICKET_351_P2: Routes through DataDownloadQueue (unified single entry point)
  ipcMain.handle('data:ensure', async (_, config: {
    symbol: string;
    startDate: string;
    endDate: string;
    interval: string;
    provider?: string;
    forceDownload?: boolean;
    callerId?: string;
  }) => {
    try {
      // TICKET_308_1 (Phase 6): fork BYOD imported packages to a direct
      // cache read BEFORE the queue / provider resolution. An imported source
      // is read-from-disk and would throw in `getProvider`, so it must never
      // enter the download machinery.
      const imported = resolveImportedEnsure(config);
      if (imported) {
        return imported;
      }

      const queue = getDataDownloadQueue();
      // TICKET_351_P2_1: Default to generic 'ensure' identity, not 'backtest'
      const callerId = config.callerId || 'ensure';
      const priority = CALLER_PRIORITY[callerId] || 'normal';
      const providerId = config.provider || getDataProviderManager().getDefaultProvider().id;

      const result = await new Promise<unknown>((resolve, reject) => {
        queue.enqueue({
          symbol: config.symbol,
          interval: config.interval,
          startDate: config.startDate,
          endDate: config.endDate,
          provider: providerId,
          callerId,
          priority,
          forceDownload: config.forceDownload,
        }, resolve, reject);
      });

      return result;
    } catch (error) {
      appLog.error('[DataRouter] data:ensure error:', error);
      metrics.pluginBackendErrors++;

      sendToRenderer('data:progress', {
        symbol: config.symbol,
        phase: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : 'MSG_DATA_DOWNLOAD_FAILED',
      });

      return {
        success: false,
        symbol: config.symbol,
        error: error instanceof Error ? error.message : 'MSG_DATA_DOWNLOAD_FAILED',
      };
    }
  });

  // -------------------------------------------------------------------------
  // data:ensureMultiTimeframe - Ensure data for multiple timeframes
  // TICKET_248 Phase 2: Load data for multiple timeframes
  // -------------------------------------------------------------------------
  // TICKET_351_P2: Routes through DataDownloadQueue (unified single entry point)
  ipcMain.handle('data:ensureMultiTimeframe', async (_, config: {
    symbol: string;
    startDate: string;
    endDate: string;
    timeframes: string[];
    provider?: string;
    forceDownload?: boolean;
    callerId?: string;
  }) => {
    try {
      // TICKET_308_1a (Phase 7): fork BYOD imported packages to a direct
      // per-timeframe cache read BEFORE the queue / provider resolution --
      // symmetric to the data:ensure fork (Phase 6). An imported source would
      // throw in `getProvider`, so it must never enter the download machinery.
      const imported = resolveImportedEnsureMultiTimeframe(config);
      if (imported) {
        return imported;
      }

      const queue = getDataDownloadQueue();
      // TICKET_351_P2_1: Default to generic 'ensure' identity, not 'backtest'
      const callerId = config.callerId || 'ensure';
      const priority = CALLER_PRIORITY[callerId] || 'normal';
      const providerId = config.provider || getDataProviderManager().getDefaultProvider().id;

      const result = await new Promise<unknown>((resolve, reject) => {
        queue.enqueue({
          symbol: config.symbol,
          interval: config.timeframes[0],
          startDate: config.startDate,
          endDate: config.endDate,
          provider: providerId,
          callerId,
          priority,
          timeframes: config.timeframes,
          forceDownload: config.forceDownload,
        }, resolve, reject);
      });

      return result;
    } catch (error) {
      appLog.error('[DataRouter] data:ensureMultiTimeframe error:', error);

      sendToRenderer('data:progress', {
        symbol: config.symbol,
        phase: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : 'MSG_DATA_MULTI_TF_FAILED',
      });

      return {
        success: false,
        symbol: config.symbol,
        dataFeeds: {},
        error: error instanceof Error ? error.message : 'MSG_DATA_MULTI_TF_FAILED',
      };
    }
  });

  // -------------------------------------------------------------------------
  // data:getProviderList - Sync provider metadata (no connection checks)
  // TICKET_077_COMPONENT8: Instant provider list for dropdown rendering
  // -------------------------------------------------------------------------
  ipcMain.handle('data:getProviderList', async () => {
    try {
      const manager = getDataProviderManager();
      const providers = manager.listProviders();

      const results = providers.map((p) => ({
        id: p.id,
        name: p.name,
        capabilities: p.capabilities,
      }));

      appLog.info(`[DataRouter] Provider list returned ${results.length} providers (sync)`);
      return results;
    } catch (error) {
      appLog.error('[DataRouter] data:getProviderList error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // TICKET_883: Wire provider status change listener -> renderer event
  // -------------------------------------------------------------------------
  const manager883 = getDataProviderManager();
  manager883.onStatusChange((entries) => {
    sendToRenderer('data:providerStatusChanged', entries);
  });

  // -------------------------------------------------------------------------
  // TICKET_883 Phase 3: Window focus -> stale cache background refresh
  // Covers laptop resume / network change scenarios.
  // Uses app-level event since IPC handlers register before window creation.
  // -------------------------------------------------------------------------
  app.on('browser-window-focus', () => {
    if (manager883.isCacheStale()) {
      manager883.refreshAllProviders().catch(err => {
        appLog.debug(`[DataRouter] Focus-triggered refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  });

  // -------------------------------------------------------------------------
  // data:listProviders - TICKET_883: returns cached snapshot (zero network)
  // -------------------------------------------------------------------------
  ipcMain.handle('data:listProviders', async () => {
    try {
      const manager = getDataProviderManager();
      const results = manager.getCachedProviders();
      appLog.info(`[DataRouter] Listed ${results.length} providers (cached)`);
      return results;
    } catch (error) {
      appLog.error('[DataRouter] data:listProviders error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:refreshProviderStatus - TICKET_883: explicit refresh, returns fresh snapshot
  // -------------------------------------------------------------------------
  ipcMain.handle('data:refreshProviderStatus', async () => {
    try {
      const manager = getDataProviderManager();
      const results = await manager.refreshAllProviders();
      appLog.info(`[DataRouter] Refreshed ${results.length} providers`);
      return results;
    } catch (error) {
      appLog.error('[DataRouter] data:refreshProviderStatus error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:checkProvidersProgressive - TICKET_883 DEPRECATED: delegates to cache
  // refresh, then emits per-provider data:providerStatus events from cache.
  // Preserves event shape for unmigrated callers.
  // -------------------------------------------------------------------------
  ipcMain.handle('data:checkProvidersProgressive', async () => {
    try {
      const manager = getDataProviderManager();
      const fresh = await manager.refreshAllProviders();

      for (const entry of fresh) {
        sendToRenderer('data:providerStatus', {
          id: entry.id,
          status: entry.status,
          latencyMs: entry.latencyMs,
          error: entry.error,
        });
      }

      return { started: true, count: fresh.length };
    } catch (error) {
      appLog.error('[DataRouter] data:checkProvidersProgressive error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:checkCoverage - Check data coverage
  // -------------------------------------------------------------------------
  ipcMain.handle('data:checkCoverage', async (_, config: {
    symbol: string;
    startDate: string;
    endDate: string;
    interval: string;
  }) => {
    try {
      const backend = getDataNexusBackend();
      if (backend?.checkCoverage) {
        appLog.info('[DataRouter] Routing data:checkCoverage to plugin backend');
        metrics.pluginBackendCalls++;
        metrics.checkCoverageCalls.plugin++;
        return await backend.checkCoverage(config);
      }

      // Fallback: No plugin backend
      appLog.warn('[DataRouter] data:checkCoverage - No plugin backend');
      metrics.checkCoverageCalls.errors++;
      return {
        symbol: config.symbol,
        interval: config.interval,
        startDate: config.startDate,
        endDate: config.endDate,
        totalBars: 0,
        completeness: 0,
        error: 'MSG_DATA_PLUGIN_UNAVAILABLE',
      };
    } catch (error) {
      appLog.error('[DataRouter] data:checkCoverage error:', error);
      metrics.pluginBackendErrors++;
      metrics.checkCoverageCalls.errors++;
      return {
        symbol: config.symbol,
        interval: config.interval,
        startDate: config.startDate,
        endDate: config.endDate,
        totalBars: 0,
        completeness: 0,
        error: error instanceof Error ? error.message : 'MSG_DATA_COVERAGE_FAILED',
      };
    }
  });

  // -------------------------------------------------------------------------
  // data:searchSymbols - Search symbols
  // -------------------------------------------------------------------------
  ipcMain.handle('data:searchSymbols', async (_, query: string, provider?: string) => {
    appLog.info(`[DataRouter] Symbol search: query="${query}", provider="${provider || 'default'}"`);

    // TICKET_641_10: Return SymbolSearchResponse with truncation metadata
    const emptyResponse = { results: [], totalCount: 0, truncated: false };

    if (!query || query.length < 2) {
      appLog.debug('[DataRouter] Symbol search skipped: query too short');
      return emptyResponse;
    }

    try {
      // TICKET_909: imported packages are not IDataProvider instances;
      // query the local cache catalog instead.
      if (provider) {
        const cacheManager = getDataCacheManager();
        const pkg = cacheManager.getImportedPackage(provider);
        if (pkg) {
          const files = cacheManager.listImportedPackageFiles(provider);
          const seen = new Set<string>();
          const lowerQuery = query.toLowerCase();
          const matches: Array<{ symbol: string; name: string }> = [];
          for (const f of files) {
            if (seen.has(f.symbol)) continue;
            seen.add(f.symbol);
            if (f.symbol.toLowerCase().includes(lowerQuery)) {
              matches.push({ symbol: f.symbol, name: f.symbol });
            }
          }
          matches.sort((a, b) => a.symbol.localeCompare(b.symbol));
          const truncated = matches.length > 20;
          const results = matches.slice(0, 20);
          appLog.info(`[DataRouter] Imported-package symbol search: ${results.length}/${matches.length} matches`);
          return { results, totalCount: matches.length, truncated };
        }
      }

      const mgr = getDataProviderManager();
      const dp = mgr.getProvider(provider || mgr.getDefaultProvider().id);

      if (!dp.capabilities.supportsSearch) {
        appLog.warn(`[DataRouter] Provider ${dp.id} does not support search`);
        return emptyResponse;
      }

      appLog.info(`[DataRouter] Routing data:searchSymbols to provider: ${dp.id}`);
      metrics.pluginBackendCalls++;
      metrics.searchSymbolsCalls.plugin++;
      const response = await dp.searchSymbols(query, 20);
      return response;
    } catch (error) {
      appLog.error('[DataRouter] data:searchSymbols error:', error);
      metrics.pluginBackendErrors++;
      metrics.searchSymbolsCalls.errors++;
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:getSymbolDateRange - Get data availability date range for a symbol
  // TICKET_305 Phase 2: Called after symbol selection (not during search)
  // -------------------------------------------------------------------------
  ipcMain.handle('data:getSymbolDateRange', async (_, symbol: string, provider?: string) => {
    appLog.info(`[DataRouter] getSymbolDateRange: symbol="${symbol}", provider="${provider || 'default'}"`);

    try {
      // TICKET_909: imported packages store date range in the cache catalog.
      if (provider) {
        const cacheManager = getDataCacheManager();
        const pkg = cacheManager.getImportedPackage(provider);
        if (pkg) {
          const files = cacheManager.listImportedPackageFiles(provider);
          let earliest = Infinity;
          let latest = -Infinity;
          for (const f of files) {
            if (f.symbol !== symbol) continue;
            if (f.firstTimestamp < earliest) earliest = f.firstTimestamp;
            if (f.lastTimestamp > latest) latest = f.lastTimestamp;
          }
          if (earliest === Infinity) {
            return { startTime: null, endTime: null };
          }
          const startTime = new Date(earliest * 1000).toISOString().slice(0, 10);
          const endTime = new Date(latest * 1000).toISOString().slice(0, 10);
          appLog.info(`[DataRouter] Imported-package date range for ${symbol}: ${startTime} - ${endTime}`);
          return { startTime, endTime };
        }
      }

      const mgr = getDataProviderManager();
      const dp = mgr.getProvider(provider || mgr.getDefaultProvider().id);

      if (!dp.getSymbolDateRange) {
        appLog.warn(`[DataRouter] Provider ${dp.id} does not support getSymbolDateRange`);
        return { startTime: null, endTime: null };
      }

      const result = await dp.getSymbolDateRange(symbol);
      appLog.info(`[DataRouter] Date range for ${symbol}: ${result.startTime} - ${result.endTime}`);
      return result;
    } catch (error) {
      appLog.error('[DataRouter] data:getSymbolDateRange error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:checkConnection - Check provider connection
  // -------------------------------------------------------------------------
  ipcMain.handle('data:checkConnection', async (_, provider: string) => {
    appLog.info(`[DataRouter] Check connection: provider="${provider}"`);

    try {
      const backend = getDataNexusBackend();
      if (backend?.checkConnection) {
        appLog.info('[DataRouter] Routing data:checkConnection to plugin backend');
        metrics.pluginBackendCalls++;
        metrics.checkConnectionCalls.plugin++;
        return await backend.checkConnection(provider);
      }

      // Fallback: No plugin backend
      appLog.warn('[DataRouter] data:checkConnection - No plugin backend');
      metrics.checkConnectionCalls.errors++;
      return {
        provider,
        connected: false,
        error: 'MSG_DATA_PLUGIN_UNAVAILABLE',
        lastCheck: new Date().toISOString(),
      };
    } catch (error) {
      appLog.error('[DataRouter] data:checkConnection error:', error);
      metrics.pluginBackendErrors++;
      metrics.checkConnectionCalls.errors++;
      return {
        provider,
        connected: false,
        error: error instanceof Error ? error.message : 'MSG_DATA_CONNECTION_FAILED',
        lastCheck: new Date().toISOString(),
      };
    }
  });

  // -------------------------------------------------------------------------
  // data:cancelDownload - Cancel active downloads
  // TICKET_351_P2: Now delegates to DataDownloadQueue.clearAll()
  // -------------------------------------------------------------------------
  ipcMain.on('data:cancelDownload', () => {
    appLog.info('[DataRouter] Cancelling all downloads via queue');
    getDataDownloadQueue().clearAll();
  });

  // -------------------------------------------------------------------------
  // data:getMetrics - Get performance metrics
  // -------------------------------------------------------------------------
  ipcMain.handle('data:getMetrics', async () => {
    const backend = getDataNexusBackend();

    return {
      ...metrics,
      pluginBackendAvailable: backend !== null,
      pluginBackendHealthy: backend !== null,
      timestamp: new Date().toISOString(),
    };
  });

  // =========================================================================
  // TICKET_340: Data Management Center handlers
  // =========================================================================

  // -------------------------------------------------------------------------
  // data:getCacheStats - Aggregate cache statistics
  // -------------------------------------------------------------------------
  // TICKET_362: Query data_cache_files table (replaces data_cache_segments)
  ipcMain.handle('data:getCacheStats', async () => {
    try {
      const stats = getDataCacheManager().getCacheStats();
      return {
        totalSegments: stats.totalFiles,
        totalRows: stats.totalRows,
        totalSizeBytes: stats.totalSizeBytes,
        symbolCount: stats.symbolCount,
        providerCount: stats.providerCount,
        byProvider: stats.byProvider.map(p => ({
          provider: p.provider,
          segments: p.files,
          rows: p.rows,
          symbols: p.symbols,
        })),
        allIntervals: stats.allIntervals,
      };
    } catch (error) {
      appLog.error('[DataRouter] data:getCacheStats error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:listSegments - Paginated segment list with filters
  // -------------------------------------------------------------------------
  // TICKET_362: Query data_cache_files table (replaces data_cache_segments)
  ipcMain.handle('data:listSegments', async (_, filters: {
    provider?: string;
    symbol?: string;
    interval?: string;
    limit?: number;
    offset?: number;
  }) => {
    try {
      const dataCacheManager = getDataCacheManager();
      const result = dataCacheManager.listFiles(filters);

      const segments = result.files.map(file => {
        let fileSize = 0;
        try {
          fileSize = fs.statSync(file.filePath).size;
        } catch {
          // File may not exist
        }

        // Convert timestamps to date strings for backward-compatible response
        const startDate = new Date(file.firstTimestamp * 1000).toISOString().split('T')[0];
        const endDate = new Date(file.lastTimestamp * 1000).toISOString().split('T')[0];

        return {
          id: file.id,
          symbol: file.symbol,
          interval: file.interval,
          provider: file.provider,
          startDate,
          endDate,
          rowCount: file.rowCount,
          filePath: file.filePath,
          fileSize,
          createdAt: file.updatedAt,
          updatedAt: file.updatedAt,
        };
      });

      return { segments, total: result.total };
    } catch (error) {
      appLog.error('[DataRouter] data:listSegments error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:deleteSegments - Delete segments by IDs (DB records + Parquet files)
  // -------------------------------------------------------------------------
  // TICKET_362: Delete from data_cache_files + unlink file
  ipcMain.handle('data:deleteSegments', async (_, segmentIds: number[]) => {
    try {
      const dataCacheManager = getDataCacheManager();
      let deletedCount = 0;

      for (const id of segmentIds) {
        dataCacheManager.deleteFile(id);
        deletedCount++;
      }

      appLog.info(`[DataRouter] Deleted ${deletedCount} cache files`);
      return { deletedCount };
    } catch (error) {
      appLog.error('[DataRouter] data:deleteSegments error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:enqueueDownload - Add download task to queue
  // -------------------------------------------------------------------------
  ipcMain.handle('data:enqueueDownload', async (_, config: {
    symbol: string;
    interval: string;
    startDate: string;
    endDate: string;
    provider: string;
  }) => {
    try {
      const queue = getDataDownloadQueue();
      const taskId = queue.enqueue({
        ...config,
        callerId: 'data-manager',
        priority: 'background',
      });
      return { taskId };
    } catch (error) {
      appLog.error('[DataRouter] data:enqueueDownload error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:cancelQueueTask - Cancel a specific queued task
  // -------------------------------------------------------------------------
  ipcMain.handle('data:cancelQueueTask', async (_, taskId: string) => {
    try {
      const queue = getDataDownloadQueue();
      const cancelled = queue.cancel(taskId);
      return { cancelled };
    } catch (error) {
      appLog.error('[DataRouter] data:cancelQueueTask error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:clearAll - Clear all data cache (parquet files + DB tables + queue)
  // -------------------------------------------------------------------------
  ipcMain.handle('data:clearAll', async () => {
    try {
      return await getDataStorageService().clearAllDataCache();
    } catch (error) {
      appLog.error('[DataRouter] data:clearAll error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:getQueueStatus - Get current download queue state
  // -------------------------------------------------------------------------
  ipcMain.handle('data:getQueueStatus', async () => {
    try {
      const queue = getDataDownloadQueue();
      return queue.getStatus();
    } catch (error) {
      appLog.error('[DataRouter] data:getQueueStatus error:', error);
      throw error;
    }
  });

  // =========================================================================
  // TICKET_308_1 (Phase 5): BYOD package import
  // =========================================================================

  // -------------------------------------------------------------------------
  // data:cancelImport - Abort an in-flight package import by taskId
  // -------------------------------------------------------------------------
  ipcMain.handle('data:cancelImport', async (_, taskId: string) => {
    const controller = activeImportTasks.get(taskId);
    if (!controller) {
      appLog.warn(`[DataRouter] data:cancelImport: no active import for taskId=${taskId}`);
      return { cancelled: false };
    }
    appLog.info(`[DataRouter] data:cancelImport: aborting import taskId=${taskId}`);
    controller.abort();
    return { cancelled: true };
  });

  // -------------------------------------------------------------------------
  // data:registerParquetDirectory - Bulk-register pre-existing Parquet files
  // -------------------------------------------------------------------------
  // TICKET_308_2: Scans a provider directory for {SYMBOL}_{interval}.parquet
  // files, reads metadata via DuckDB, and registers into data_cache_files +
  // imported_packages. Idempotent via upserts.
  ipcMain.handle('data:registerParquetDirectory', async (_, payload: {
    packageName: string;
    adjustMode: 'none' | 'qfq' | 'hfq';
    sourceDialect: string;
    // TICKET_919_10: optional cadence -- HistData / Dukascopy renderer
    // flows pass 'monthly_archive' here; generic CSV / parquet imports
    // omit it and inherit DIALECT_ARCHIVAL_DEFAULT in the service layer.
    archivalCadence?: import('../../shared/constants/data-import').ArchivalCadence;
    assetClass?: string;
  }) => {
    const service = getDataImportService();
    const result = await service.registerParquetDirectory({
      packageName: payload.packageName,
      adjustMode: payload.adjustMode,
      sourceDialect: payload.sourceDialect as import('../../shared/constants/data-import').ImportSourceDialect,
      archivalCadence: payload.archivalCadence,
      assetClass: payload.assetClass,
    });
    appLog.info(
      `[DataRouter] data:registerParquetDirectory: package="${payload.packageName}" ` +
        `registered=${result.registered} skipped=${result.skipped} ` +
        `cadence=${payload.archivalCadence ?? '(dialect default)'}`
    );
    return result;
  });

  ipcMain.handle('data:appendToPackage', async (_, payload: {
    packageName: string;
    sourcePath: string;
    symbolFilter?: string[];
    force?: boolean;
  }) => {
    const service = getDataImportService();
    const result = await service.appendToPackage(payload);
    appLog.info(
      `[DataRouter] data:appendToPackage: package="${payload.packageName}" ` +
        `appended=${result.appended} skipped=${result.skipped}`
    );
    return result;
  });

  // -------------------------------------------------------------------------
  // data:getSymbols - List available symbols from a provider
  // TICKET_880_4_1: For sweep data source selector + top-N slider.
  // Providers with listSymbols() return their asset list; others return empty.
  // -------------------------------------------------------------------------
  ipcMain.handle('data:getSymbols', async (_, providerId: string, limit?: number) => {
    appLog.info(`[DataRouter] data:getSymbols: provider="${providerId}", limit=${limit ?? 'all'}`);

    try {
      const mgr = getDataProviderManager();
      const provider = mgr.getProvider(providerId);

      if (!provider.listSymbols) {
        appLog.info(`[DataRouter] Provider ${providerId} does not support listSymbols`);
        return { symbols: [], total: 0, supported: false };
      }

      const result = await provider.listSymbols(limit);
      appLog.info(`[DataRouter] data:getSymbols: ${result.symbols.length} of ${result.total} symbols from ${providerId}`);
      return { ...result, supported: true };
    } catch (error) {
      appLog.error('[DataRouter] data:getSymbols error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:scanDataPackage - TICKET_308_3_3: Preview a data package (resolve
  // manifest, count files, gather symbols/intervals) without importing.
  // -------------------------------------------------------------------------
  ipcMain.handle('data:scanDataPackage', async (_, payload: {
    request: DataPackageScanRequest;
  }) => {
    try {
      const service = getDataImportService();
      const result = service.scanDataPackage(payload.request);
      appLog.info(
        `[DataRouter] data:scanDataPackage: package="${result.packageName}" ` +
          `dialect=${result.sourceDialect} symbols=${result.symbols.length} ` +
          `files=${result.fileCount} size=${result.totalSizeBytes}`
      );
      return result;
    } catch (error) {
      appLog.error('[DataRouter] data:scanDataPackage error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:importDataPackage - TICKET_308_3_2: Manifest-aware directory/DuckDB/CSV
  // import into the Parquet cache + catalog.
  // -------------------------------------------------------------------------
  ipcMain.handle('data:importDataPackage', async (_, payload: {
    taskId: string;
    request: DataPackageImportRequest;
  }) => {
    const { taskId, request } = payload;
    if (!taskId || !taskId.trim()) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'data.importRequiresTaskId'));
    }

    const controller = new AbortController();
    activeImportTasks.set(taskId, controller);

    try {
      const service = getDataImportService();
      const result = await service.importDataPackage(request, {
        signal: controller.signal,
        onProgress: (progress) => {
          sendToRenderer('data:importProgress', {
            taskId,
            packageName: request.packageName,
            ...progress,
          });
        },
      });

      sendToRenderer('data:importProgress', {
        taskId,
        packageName: request.packageName,
        phase: 'complete',
        seriesImported: result.series.length,
        skippedFiles: result.skippedFiles.length,
      });

      appLog.info(
        `[DataRouter] data:importDataPackage complete: package="${request.packageName}" ` +
          `series=${result.series.length}`
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appLog.error('[DataRouter] data:importDataPackage error:', error);
      sendToRenderer('data:importProgress', {
        taskId,
        packageName: request?.packageName,
        phase: 'error',
        message,
      });
      throw error;
    } finally {
      activeImportTasks.delete(taskId);
    }
  });

  // -------------------------------------------------------------------------
  // data:listImportedPackages - List every BYOD imported-package catalog row
  // TICKET_308_1a (Phase 7): the picker source feed for imported packages.
  // Distinct from data:getProviderList (live providers): an imported package is
  // NOT a registered IDataProvider (that is the Phase 6 fork discriminator), so
  // it can never come from the provider list. Each row becomes its own
  // selectable "Imported" source in the data-source picker.
  // -------------------------------------------------------------------------
  ipcMain.handle('data:listImportedPackages', async () => {
    try {
      const packages = getDataCacheManager().listImportedPackages();
      appLog.info(`[DataRouter] Imported package list returned ${packages.length} packages`);
      return packages;
    } catch (error) {
      appLog.error('[DataRouter] data:listImportedPackages error:', error);
      throw error;
    }
  });

  ipcMain.handle('data:listImportedPackageSummaries', async () => {
    try {
      return getDataCacheManager().listImportedPackageSummaries();
    } catch (error) {
      appLog.error('[DataRouter] data:listImportedPackageSummaries error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:listImportedPackageFiles - TICKET_308_3_3: List files (symbol/interval
  // /date range) for a specific imported package. Used by the expanded package
  // detail view in ImportPanel.
  // -------------------------------------------------------------------------
  ipcMain.handle('data:listImportedPackageFiles', async (_, packageName: string) => {
    try {
      return getDataCacheManager().listImportedPackageFiles(packageName);
    } catch (error) {
      appLog.error('[DataRouter] data:listImportedPackageFiles error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:removeImportedPackage - TICKET_308_3_4: Delete all cache files + DB
  // rows for an imported package.
  // -------------------------------------------------------------------------
  ipcMain.handle('data:removeImportedPackage', async (_, packageName: string) => {
    try {
      const result = getDataCacheManager().removeImportedPackage(packageName);
      appLog.info(`[DataRouter] Removed package '${packageName}': ${result.deletedFiles} files`);
      return result;
    } catch (error) {
      appLog.error('[DataRouter] data:removeImportedPackage error:', error);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // data:checkImportedPackageHealth - TICKET_308_3_4: Verify registered cache
  // files still exist on disk.
  // -------------------------------------------------------------------------
  ipcMain.handle('data:checkImportedPackageHealth', async (_, packageName: string) => {
    try {
      return getDataCacheManager().checkImportedPackageHealth(packageName);
    } catch (error) {
      appLog.error('[DataRouter] data:checkImportedPackageHealth error:', error);
      throw error;
    }
  });

  ipcMain.handle('data:checkImportedPackageIntegrity', async (_, packageName: string) => {
    try {
      return getDataCacheManager().checkImportedPackageIntegrity(packageName);
    } catch (error) {
      appLog.error('[DataRouter] data:checkImportedPackageIntegrity error:', error);
      throw error;
    }
  });

  ipcMain.handle('data:auditImportedPackageOrphans', async (_, packageName: string) => {
    try {
      return getDataCacheManager().auditImportedPackageOrphans(packageName);
    } catch (error) {
      appLog.error('[DataRouter] data:auditImportedPackageOrphans error:', error);
      throw error;
    }
  });

  ipcMain.handle('data:buildCoverageReport', async (_, packageName: string) => {
    try {
      return getDataCacheManager().buildCoverageReport(packageName);
    } catch (error) {
      appLog.error('[DataRouter] data:buildCoverageReport error:', error);
      throw error;
    }
  });

  ipcMain.handle('data:buildCoverageReportCsv', async (_, packageName: string) => {
    try {
      return getDataCacheManager().buildCoverageReportCsv(packageName);
    } catch (error) {
      appLog.error('[DataRouter] data:buildCoverageReportCsv error:', error);
      throw error;
    }
  });
}

/**
 * Cleanup function
 * TICKET_351_P2: Cancellation now handled by DataDownloadQueue
 */
export function cleanupDataHandlers(): void {
  getDataDownloadQueue().clearAll();
}
