/**
 * Data Download Queue
 *
 * TICKET_340: Background download queue for Data Management Center.
 * TICKET_345: Task persistence for resume on app restart.
 * TICKET_362: Routes through DataCacheManager (single-file append model).
 * TICKET_351_P2: Unified single entry point with priority, request coalescing,
 *   cooperative preemption (shouldYield), aging starvation prevention,
 *   multi-timeframe atomic tasks, and subscriber-based progress fan-out.
 *
 * All data downloads (Backtest, Alpha Factory, Data Manager) enter through
 * this queue. No component calls DataStorageService directly.
 *
 * Two-phase singleton pattern.
 */

import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import { sendToRenderer } from '../window';
import { getDatabaseManager } from '../database/db-manager';
import { getDataProviderManager } from './data-providers/provider-manager';
import { getDataCacheManager, DownloadControl, type EnsureDataResult } from './data-cache-manager';
import { formatTradingDay } from '../../shared/calendars/trading-calendars';
import {
  getDataStorageService,
  ImportedPackageIntervalUnavailableError,
  recordIntersectsWindow,
  recordCoversWindow,
} from './data-storage-service';
import type {
  DataEnsureResponse,
  UniverseDownloadStats,
  EnrichedProgressCallback,
} from './data-storage-service';
import { appLog } from '../utils/logger';
import { DATA_DOWNLOAD_MAX_CONCURRENT } from '../../shared/constants/data-providers';
import { MS_PER_SECOND } from '../../shared/constants/timing';
import { existsSync } from 'fs';
import {
  inspectParquetCodec,
  reencodeParquetToReadableCodec,
} from './parquet-cache-service';

// =============================================================================
// Types
// =============================================================================

export type DownloadPriority = 'critical' | 'normal' | 'background';

const PRIORITY_RANK: Record<DownloadPriority, number> = {
  critical: 3,
  normal: 2,
  background: 1,
};

/** Aging: boost one priority level per threshold interval */
const AGING_THRESHOLD_MS = 60_000;

export interface Subscriber {
  callerId: string;
  priority: DownloadPriority;
  resolve?: (result: unknown) => void;
  reject?: (error: Error) => void;
}

export interface DownloadTask {
  taskId: string;
  symbol: string;
  interval: string;
  startDate: string;
  endDate: string;
  provider: string;
  timeframes: string[] | null;
  status: 'queued' | 'downloading' | 'yielded' | 'complete' | 'partial' | 'error';
  progress: number;
  message: string;
  error?: string;
  totalChunks: number;
  completedChunks: number;
  /** TICKET_1070 AC3: current chunk date range for tooltip display */
  currentChunkStart?: string;
  currentChunkEnd?: string;
  subscribers: Map<string, Subscriber>;
  effectivePriority: DownloadPriority;
  waitingSince: number;
  abortController: AbortController | null;
  /** TICKET_1078: per-chunk retry count. undefined = default (2). */
  chunkRetryCount?: number;
  /** TICKET_1187 F3: consecutive task-level error count. */
  retryCount: number;
}

export interface QueueStatus {
  tasks: QueueStatusTask[];
  activeCount: number;
  queuedCount: number;
}

/** Serializable task shape for IPC (no Map/AbortController) */
export interface QueueStatusTask {
  taskId: string;
  symbol: string;
  interval: string;
  startDate: string;
  endDate: string;
  provider: string;
  status: string;
  progress: number;
  message: string;
  error?: string;
  totalChunks: number;
  completedChunks: number;
  effectivePriority: DownloadPriority;
  callerId: string;
}

export interface EnqueueConfig {
  symbol: string;
  interval: string;
  startDate: string;
  endDate: string;
  provider: string;
  callerId?: string;
  priority?: DownloadPriority;
  timeframes?: string[];
  forceDownload?: boolean;
  /** TICKET_1078: per-chunk retry count. 0 = no retries. Absent = default (2). */
  chunkRetryCount?: number;
}

export interface EnqueueUniverseConfig {
  symbols: string[];
  interval: string;
  startDate: string;
  endDate: string;
  provider: string;
  callerId?: string;
  priority?: DownloadPriority;
  universeId?: string;
  /** TICKET_1078: per-chunk retry count. 0 = no retries. Absent = default (2). */
  chunkRetryCount?: number;
  onSymbolComplete?: (symbol: string, result: DataEnsureResponse) => void;
  onSymbolError?: (symbol: string, error: string) => void;
  onProgress?: (completed: number, total: number, symbol: string) => void;
  onEnrichedProgress?: EnrichedProgressCallback;
}

export interface UniverseEnqueueResult {
  resolved: Array<{ symbol: string; dataPath: string }>;
  failures: Array<{ symbol: string; error: string }>;
  stats: {
    cacheHits: number;
    networkDownloads: number;
    failures: number;
    failedSymbols: string[];
    elapsedMs: number;
  };
}

// =============================================================================
// DB row shape
// =============================================================================

interface QueueRow {
  task_id: string;
  symbol: string;
  interval: string;
  start_date: string;
  end_date: string;
  provider: string;
  status: string;
  progress: number;
  message: string;
  error: string | null;
  total_chunks: number;
  completed_chunks: number;
  priority: string;
  caller_id: string;
  waiting_since: number;
  timeframes: string | null;
  retry_count: number;
}

// =============================================================================
// DataDownloadQueue
// =============================================================================

const MAX_CONCURRENT = DATA_DOWNLOAD_MAX_CONCURRENT;

/** TICKET_1187 F3: tasks that error this many times are marked 'error' permanently and not retried. */
const MAX_TASK_RETRIES = 3;

/** TICKET_1187 F2: tasks stuck in 'downloading' longer than this are orphaned, not resumed. */
const ORPHAN_TTL_HOURS = 6;

/** F4: queued tasks older than this are stale and get purged on startup. */
const STALE_QUEUED_TTL_DAYS = 3;

class DataDownloadQueue {
  private tasks: Map<string, DownloadTask> = new Map();
  private activeCount = 0;
  private taskCounter = 0;
  private shuttingDown = false;

  private mt(key: string, params?: Record<string, string | number>): string {
    return mainT(getCurrentMainLocale(), 'ui', key, params);
  }

  // =========================================================================
  // Restore on startup
  // =========================================================================

  /**
   * TICKET_345: Restore incomplete tasks from DB and resume processing.
   * TICKET_1187: F1 purge terminal tasks, F2 orphan TTL, F3 retry cap.
   * Called once during initialization, after DB migrations have run.
   */
  restoreAndResume(): void {
    const db = getDatabaseManager();

    // ── F1: Purge terminal tasks (complete/error/partial) ──
    // The queue is operational, not archival. Terminal rows serve no purpose.
    const purged = db.prepare(
      `DELETE FROM download_queue WHERE status IN ('complete', 'error', 'partial')`
    ).run();
    if (purged.changes > 0) {
      appLog.info(`[DownloadQueue] TICKET_1187 F1: purged ${purged.changes} terminal task(s)`);
    }

    // ── F2: Orphan stale 'downloading'/'yielded' tasks ──
    // Tasks stuck in 'downloading' longer than ORPHAN_TTL_HOURS are from
    // a killed process. Delete them rather than blindly re-queuing.
    const orphanCutoff = new Date(Date.now() - ORPHAN_TTL_HOURS * 3_600_000)
      .toISOString().replace('T', ' ').slice(0, 19);
    const orphaned = db.prepare(
      `DELETE FROM download_queue WHERE status IN ('downloading', 'yielded') AND updated_at < ?`
    ).run(orphanCutoff);
    if (orphaned.changes > 0) {
      appLog.info(
        `[DownloadQueue] TICKET_1187 F2: removed ${orphaned.changes} orphaned task(s) (updated_at < ${orphanCutoff})`
      );
    }

    // Reset remaining 'downloading'/'yielded' (recent, within TTL) back to 'queued'
    const resumedMsg = this.mt('downloadQueue.queuedResumed');
    db.prepare(`
      UPDATE download_queue SET status = 'queued', message = ?,
             retry_count = retry_count + 1, updated_at = datetime('now')
      WHERE status IN ('downloading', 'yielded')
    `).run(resumedMsg);

    // ── F4: Purge stale queued tasks ──
    // Tasks sitting in 'queued' for more than STALE_QUEUED_TTL_DAYS are abandoned
    // by the user. Re-processing them on every startup floods the terminal with
    // slow network I/O and makes the app appear hung.
    const staleCutoff = new Date(Date.now() - STALE_QUEUED_TTL_DAYS * 86_400_000)
      .toISOString().replace('T', ' ').slice(0, 19);
    const staleQueued = db.prepare(
      `DELETE FROM download_queue WHERE status = 'queued' AND created_at < ?`
    ).run(staleCutoff);
    if (staleQueued.changes > 0) {
      appLog.info(
        `[DownloadQueue] F4: purged ${staleQueued.changes} stale queued task(s) (created_at < ${staleCutoff})`
      );
    }

    // ── F3: Cap retries ──
    const overRetried = db.prepare(
      `DELETE FROM download_queue WHERE retry_count >= ?`
    ).run(MAX_TASK_RETRIES);
    if (overRetried.changes > 0) {
      appLog.info(
        `[DownloadQueue] TICKET_1187 F3: removed ${overRetried.changes} task(s) exceeding ${MAX_TASK_RETRIES} retries`
      );
    }

    // ── Load surviving queued tasks ──
    const rows = db.prepare(`
      SELECT task_id, symbol, interval, start_date, end_date, provider,
             status, progress, message, error, total_chunks, completed_chunks,
             priority, caller_id, waiting_since, timeframes, retry_count
      FROM download_queue
      ORDER BY created_at ASC
    `).all() as QueueRow[];

    if (rows.length === 0) return;

    appLog.info(`[DownloadQueue] Restoring ${rows.length} queued task(s)`);

    for (const row of rows) {
      const priority = (row.priority || 'background') as DownloadPriority;
      const callerId = row.caller_id || 'data-manager';

      const task: DownloadTask = {
        taskId: row.task_id,
        symbol: row.symbol,
        interval: row.interval,
        startDate: row.start_date,
        endDate: row.end_date,
        provider: row.provider,
        timeframes: row.timeframes ? JSON.parse(row.timeframes) : null,
        status: row.status as DownloadTask['status'],
        progress: row.progress,
        message: this.mt('downloadQueue.queuedResumed'),
        error: row.error || undefined,
        totalChunks: row.total_chunks,
        completedChunks: row.completed_chunks,
        subscribers: new Map([
          [callerId, { callerId, priority }],
        ]),
        effectivePriority: priority,
        waitingSince: row.waiting_since || Date.now(),
        abortController: null,
        retryCount: row.retry_count || 0,
      };
      this.tasks.set(task.taskId, task);
    }

    this.processNext();
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * TICKET_351_P2: Unified enqueue with priority, coalescing, and cache-hit short-circuit.
   *
   * @param resolve Called when download completes (for await-style callers like data:ensure)
   * @param reject Called on error (for await-style callers)
   * @returns taskId
   */
  enqueue(
    config: EnqueueConfig,
    resolve?: (result: unknown) => void,
    reject?: (error: Error) => void,
  ): string {
    const priority = config.priority || 'background';
    const callerId = config.callerId || 'data-manager';
    const provider = config.provider || getDataProviderManager().getDefaultProvider().id;

    const subscriber: Subscriber = { callerId, priority, resolve, reject };

    // --- Cache-hit short-circuit (single TF only, no forceDownload) ---
    if (!config.forceDownload && !config.timeframes) {
      const metadata = getDataCacheManager().getMetadata(
        config.symbol, config.interval, provider
      );
      if (metadata) {
        const reqStart = Math.floor(new Date(config.startDate + 'T00:00:00Z').getTime() / MS_PER_SECOND);
        const reqEnd = Math.floor(new Date(config.endDate + 'T00:00:00Z').getTime() / MS_PER_SECOND);
        if (metadata.firstTimestamp <= reqStart && metadata.lastTimestamp >= reqEnd) {
          appLog.info(
            `[DownloadQueue] Cache hit for ${config.symbol}/${config.interval}, skipping queue`
          );
          if (resolve) {
            resolve({
              success: true,
              symbol: config.symbol,
              dataPath: metadata.filePath,
              source: provider,
              coverage: {
                symbol: config.symbol,
                interval: config.interval,
                startDate: config.startDate,
                endDate: config.endDate,
                totalBars: metadata.rowCount,
                completeness: 1.0,
              },
              downloadStats: { barsDownloaded: 0, barsImported: 0, chunksProcessed: 0 },
            });
          }
          return `cache-hit-${Date.now()}`;
        }
      }
    }

    // --- Request coalescing: find matching in-flight/queued task ---
    const coalescingKey = this.getCoalescingKey({ ...config, provider });
    const existingTask = this.findTaskByKey(coalescingKey);

    if (existingTask && !config.forceDownload) {
      existingTask.subscribers.set(callerId, subscriber);
      this.recalculateEffectivePriority(existingTask);
      appLog.info(
        `[DownloadQueue] Coalesced ${callerId} into task ${existingTask.taskId} ` +
        `(priority: ${existingTask.effectivePriority})`
      );
      return existingTask.taskId;
    }

    // --- New task ---
    const taskId = `dq-${Date.now()}-${++this.taskCounter}`;
    const task: DownloadTask = {
      taskId,
      symbol: config.symbol,
      interval: config.interval,
      startDate: config.startDate,
      endDate: config.endDate,
      provider,
      timeframes: config.timeframes || null,
      status: 'queued',
      progress: 0,
      message: this.mt('downloadQueue.queued'),
      totalChunks: 1,
      completedChunks: 0,
      subscribers: new Map([[callerId, subscriber]]),
      effectivePriority: priority,
      waitingSince: Date.now(),
      abortController: null,
      chunkRetryCount: config.chunkRetryCount,
      retryCount: 0,
    };

    this.dbInsert(task);
    this.tasks.set(taskId, task);
    this.emitProgress(task);
    this.processNext();

    appLog.info(
      `[DownloadQueue] Enqueued task ${taskId}: ${config.symbol} ` +
      `${config.timeframes ? `[${config.timeframes.join(',')}]` : config.interval} ` +
      `${provider} priority=${priority} caller=${callerId}`
    );
    return taskId;
  }

  /**
   * Cancel a task or remove a subscriber.
   * TICKET_351_P2: Subscriber-aware -- only truly cancels when last subscriber leaves.
   */
  cancel(taskId: string, subscriberId?: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Remove specific subscriber if there are multiple
    if (subscriberId && task.subscribers.size > 1) {
      const sub = task.subscribers.get(subscriberId);
      if (sub?.reject) {
        sub.reject(new Error('Cancelled by subscriber'));
      }
      task.subscribers.delete(subscriberId);
      this.recalculateEffectivePriority(task);
      appLog.info(`[DownloadQueue] Removed subscriber ${subscriberId} from task ${taskId}`);
      return true;
    }

    // Last subscriber or no subscriberId -- full cancel
    this.notifySubscribers(task, 'error', new Error('Cancelled'));

    if (task.status === 'downloading' && task.abortController) {
      task.abortController.abort();
      return true;
    }

    if (task.status === 'queued' || task.status === 'yielded') {
      this.tasks.delete(taskId);
      this.dbDelete(taskId);
      this.emitFullStatus();
      return true;
    }

    // complete/error -- just remove
    this.tasks.delete(taskId);
    this.dbDelete(taskId);
    this.emitFullStatus();
    return true;
  }

  /**
   * TICKET_1051_1 D1: Batch enqueue for multi-symbol callers.
   *
   * Enqueues all symbols via enqueue() (gets coalescing + cache-hit
   * short-circuit for free). Collects per-symbol resolve/reject.
   * Returns a Promise that resolves when all symbols complete or fail.
   *
   * Pre-enqueue guard: imported-package interval availability (AC9).
   */
  async enqueueUniverse(config: EnqueueUniverseConfig): Promise<UniverseEnqueueResult> {
    const symbols = config.symbols;
    if (symbols.length === 0) {
      return {
        resolved: [],
        failures: [],
        stats: { cacheHits: 0, networkDownloads: 0, failures: 0, failedSymbols: [], elapsedMs: 0 },
      };
    }

    const startTime = Date.now();
    const callerId = config.callerId || 'data-manager';
    const priority = config.priority || 'background';

    // --- AC9: Imported-package pre-flight guard ---
    const dataCacheManager = getDataCacheManager();
    if (dataCacheManager.getImportedPackage(config.provider)) {
      return this.resolveImportedPackageUniverse(config, startTime);
    }

    // --- Split into local hits vs needs-download ---
    const providerMgr = getDataProviderManager();
    const provider = providerMgr.getProvider(config.provider || providerMgr.getDefaultProvider().id);
    const resolvedProvider = provider.id;

    const localHits: Array<{ symbol: string; dataPath: string }> = [];
    const needsDownload: string[] = [];

    for (const sym of symbols) {
      const record = dataCacheManager.getMetadata(sym, config.interval, resolvedProvider);
      if (record && existsSync(record.filePath)) {
        if (!recordIntersectsWindow(record, config.startDate, config.endDate)) {
          needsDownload.push(sym);
          continue;
        }
        if (!recordCoversWindow(record, config.startDate, config.endDate)) {
          needsDownload.push(sym);
          continue;
        }
        if (record.codec) {
          localHits.push({ symbol: sym, dataPath: record.filePath });
        } else {
          const { readable, codecs } = await inspectParquetCodec(record.filePath);
          if (readable) {
            dataCacheManager.backfillCodec(record.id, codecs[0] ?? 'SNAPPY');
            localHits.push({ symbol: sym, dataPath: record.filePath });
          } else {
            appLog.warn(
              `[DownloadQueue] Cached file for ${sym}/${config.interval} has unreadable codec; re-downloading`,
            );
            dataCacheManager.deleteFile(record.id);
            needsDownload.push(sym);
          }
        }
      } else {
        needsDownload.push(sym);
      }
    }

    if (localHits.length > 0) {
      appLog.info(
        `[DownloadQueue] enqueueUniverse: ${localHits.length}/${symbols.length} ` +
        `resolved locally, ${needsDownload.length} need download`,
      );
    }

    // Emit enriched progress for local hits upfront
    let completedCount = localHits.length;
    let cacheHits = localHits.length;
    let networkDownloads = 0;
    let failureCount = 0;
    const failedSymbols: string[] = [];

    for (const hit of localHits) {
      config.onSymbolComplete?.(hit.symbol, {
        success: true,
        symbol: hit.symbol,
        dataPath: hit.dataPath,
        source: resolvedProvider,
      });
      config.onProgress?.(completedCount, symbols.length, hit.symbol);
      config.onEnrichedProgress?.(completedCount, symbols.length, hit.symbol, {
        cacheHits,
        networkDownloads: 0,
        failures: 0,
        failedSymbols: [],
        elapsedMs: Date.now() - startTime,
      });
    }

    if (needsDownload.length === 0) {
      return {
        resolved: localHits,
        failures: [],
        stats: { cacheHits, networkDownloads: 0, failures: 0, failedSymbols: [], elapsedMs: Date.now() - startTime },
      };
    }

    // Enqueue downloads via per-symbol enqueue() and collect results
    const resolved = [...localHits];
    const failures: Array<{ symbol: string; error: string }> = [];
    const taskIds: string[] = [];

    const downloadPromises = needsDownload.map(sym =>
      new Promise<void>((resolve, reject) => {
        const taskId = this.enqueue(
          {
            symbol: sym,
            interval: config.interval,
            startDate: config.startDate,
            endDate: config.endDate,
            provider: config.provider,
            callerId,
            priority,
            chunkRetryCount: config.chunkRetryCount,
          },
          (result: unknown) => {
            const r = result as DataEnsureResponse;
            if (r.success && r.dataPath) {
              resolved.push({ symbol: sym, dataPath: r.dataPath });
              networkDownloads++;
              config.onSymbolComplete?.(sym, r);
            } else {
              const err = r.error || 'No dataPath returned';
              failures.push({ symbol: sym, error: err });
              failureCount++;
              failedSymbols.push(sym);
              config.onSymbolError?.(sym, err);
            }
            completedCount++;
            config.onProgress?.(completedCount, symbols.length, sym);
            config.onEnrichedProgress?.(completedCount, symbols.length, sym, {
              cacheHits,
              networkDownloads,
              failures: failureCount,
              failedSymbols,
              elapsedMs: Date.now() - startTime,
            });
            resolve();
          },
          (error: Error) => {
            failures.push({ symbol: sym, error: error.message });
            failureCount++;
            failedSymbols.push(sym);
            config.onSymbolError?.(sym, error.message);
            completedCount++;
            config.onProgress?.(completedCount, symbols.length, sym);
            config.onEnrichedProgress?.(completedCount, symbols.length, sym, {
              cacheHits,
              networkDownloads,
              failures: failureCount,
              failedSymbols,
              elapsedMs: Date.now() - startTime,
            });
            resolve();
          },
        );
        taskIds.push(taskId);
      }),
    );

    await Promise.all(downloadPromises);

    return {
      resolved,
      failures,
      stats: {
        cacheHits,
        networkDownloads,
        failures: failureCount,
        failedSymbols,
        elapsedMs: Date.now() - startTime,
      },
    };
  }

  /**
   * TICKET_1051_1 D1 + AC9: Imported-package branch of enqueueUniverse.
   * No download fallback -- data is already on disk or absent.
   */
  private async resolveImportedPackageUniverse(
    config: EnqueueUniverseConfig,
    startTime: number,
  ): Promise<UniverseEnqueueResult> {
    const dcm = getDataCacheManager();

    const pkgIntervals = dcm.getImportedPackageIntervals(config.provider);
    if (!pkgIntervals.includes(config.interval)) {
      throw new ImportedPackageIntervalUnavailableError({
        package: config.provider,
        requestedInterval: config.interval,
        availableIntervals: pkgIntervals,
        symbolCount: config.symbols.length,
        universeId: config.universeId,
      });
    }

    const resolved: Array<{ symbol: string; dataPath: string }> = [];
    const failures: Array<{ symbol: string; error: string }> = [];
    const outsideWindow: string[] = [];

    for (let i = 0; i < config.symbols.length; i++) {
      const sym = config.symbols[i];
      const record = dcm.getMetadata(sym, config.interval, config.provider);
      if (record && existsSync(record.filePath)) {
        if (!recordIntersectsWindow(record, config.startDate, config.endDate)) {
          outsideWindow.push(sym);
          config.onProgress?.(i + 1, config.symbols.length, sym);
          config.onEnrichedProgress?.(i + 1, config.symbols.length, sym, {
            cacheHits: resolved.length,
            networkDownloads: 0,
            failures: failures.length,
            failedSymbols: failures.map(f => f.symbol),
            elapsedMs: Date.now() - startTime,
          });
          continue;
        }
        if (record.codec) {
          resolved.push({ symbol: sym, dataPath: record.filePath });
          config.onSymbolComplete?.(sym, {
            success: true,
            symbol: sym,
            dataPath: record.filePath,
            source: config.provider,
          });
        } else {
          try {
            const reencoded = await reencodeParquetToReadableCodec(record.filePath);
            if (reencoded) {
              appLog.warn(
                `[DownloadQueue] Imported file for ${sym}/${config.interval} ` +
                `had unreadable codec; re-encoded to SNAPPY`,
              );
            }
            dcm.backfillCodec(record.id, 'SNAPPY');
            resolved.push({ symbol: sym, dataPath: record.filePath });
            config.onSymbolComplete?.(sym, {
              success: true,
              symbol: sym,
              dataPath: record.filePath,
              source: config.provider,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            appLog.error(
              `[DownloadQueue] Failed to re-encode imported file for ${sym}/${config.interval}: ${msg}`,
            );
            failures.push({ symbol: sym, error: `Unreadable parquet codec (re-encode failed): ${msg}` });
            config.onSymbolError?.(sym, msg);
          }
        }
      } else {
        failures.push({ symbol: sym, error: `No imported data for ${sym}/${config.interval}` });
        config.onSymbolError?.(sym, `No imported data for ${sym}/${config.interval}`);
      }
      config.onProgress?.(i + 1, config.symbols.length, sym);
      config.onEnrichedProgress?.(i + 1, config.symbols.length, sym, {
        cacheHits: resolved.length,
        networkDownloads: 0,
        failures: failures.length,
        failedSymbols: failures.map(f => f.symbol),
        elapsedMs: Date.now() - startTime,
      });
    }

    if (outsideWindow.length > 0) {
      const sample = outsideWindow.slice(0, 3).join(', ');
      const suffix = outsideWindow.length > 3 ? `, +${outsideWindow.length - 3} more` : '';
      appLog.info(
        `[DownloadQueue] Imported universe: resolved ${resolved.length}/${config.symbols.length} ` +
        `(${outsideWindow.length} outside window: ${sample}${suffix})`,
      );
    }

    return {
      resolved,
      failures,
      stats: {
        cacheHits: resolved.length,
        networkDownloads: 0,
        failures: failures.length,
        failedSymbols: failures.map(f => f.symbol),
        elapsedMs: Date.now() - startTime,
      },
    };
  }

  /**
   * TICKET_1091: Abort all active downloads and mark them queued for next startup.
   * Called from before-quit to prevent dangling callbacks after DB close.
   */
  shutdown(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'downloading' && task.abortController) {
        task.abortController.abort();
      }
    }
    this.shuttingDown = true;
  }

  /**
   * Cancel all active tasks, clear in-memory map, and purge download_queue table.
   */
  clearAll(): number {
    // Abort all active downloads
    for (const task of this.tasks.values()) {
      if (task.abortController) {
        task.abortController.abort();
      }
    }

    const db = getDatabaseManager();
    const countResult = db.prepare('SELECT COUNT(*) AS cnt FROM download_queue').get() as { cnt: number };
    const deletedCount = countResult.cnt;

    db.prepare('DELETE FROM download_queue').run();

    this.tasks.clear();
    this.activeCount = 0;

    appLog.info(`[DownloadQueue] Cleared all: ${deletedCount} tasks purged`);
    this.emitFullStatus();
    return deletedCount;
  }

  /**
   * Get current queue status (serializable for IPC).
   */
  getStatus(): QueueStatus {
    const tasks: QueueStatusTask[] = Array.from(this.tasks.values()).map(t => ({
      taskId: t.taskId,
      symbol: t.symbol,
      interval: t.interval,
      startDate: t.startDate,
      endDate: t.endDate,
      provider: t.provider,
      status: t.status,
      progress: t.progress,
      message: t.message,
      error: t.error,
      totalChunks: t.totalChunks,
      completedChunks: t.completedChunks,
      effectivePriority: t.effectivePriority,
      callerId: (t.subscribers.values().next().value as Subscriber | undefined)?.callerId || 'data-manager',
    }));
    return {
      tasks,
      activeCount: this.activeCount,
      queuedCount: tasks.filter(t => t.status === 'queued' || t.status === 'yielded').length,
    };
  }

  // =========================================================================
  // Scheduling
  // =========================================================================

  /**
   * Pick the highest-priority queued/yielded task and execute it.
   */
  private processNext(): void {
    if (this.activeCount >= MAX_CONCURRENT) return;

    const candidates = Array.from(this.tasks.values())
      .filter(t => t.status === 'queued' || t.status === 'yielded');

    if (candidates.length === 0) return;

    // Sort by effective priority (with aging), then FIFO within same priority
    candidates.sort((a, b) => {
      const aPri = this.getEffectivePriorityRank(a);
      const bPri = this.getEffectivePriorityRank(b);
      if (aPri !== bPri) return bPri - aPri;
      return a.waitingSince - b.waitingSince;
    });

    const next = candidates[0];
    this.activeCount++;
    next.status = 'downloading';
    next.message = this.mt('downloadQueue.downloading');
    this.dbUpdateStatus(next);
    this.emitProgress(next);

    this.executeTask(next).finally(() => {
      this.activeCount--;
      this.processNext();
    });
  }

  /**
   * Effective priority with aging-based starvation prevention.
   * Background tasks waiting > 2 * AGING_THRESHOLD are promoted to critical.
   */
  private getEffectivePriorityRank(task: DownloadTask): number {
    const base = PRIORITY_RANK[task.effectivePriority];
    const ageBoost = Math.floor((Date.now() - task.waitingSince) / AGING_THRESHOLD_MS);
    return Math.min(base + ageBoost, PRIORITY_RANK.critical);
  }

  /**
   * Check if any queued task has higher effective priority than current task.
   */
  private hasHigherPriorityPending(currentTask: DownloadTask): boolean {
    const currentPri = this.getEffectivePriorityRank(currentTask);
    for (const t of this.tasks.values()) {
      if (t.taskId === currentTask.taskId) continue;
      if (t.status !== 'queued') continue;
      if (this.getEffectivePriorityRank(t) > currentPri) return true;
    }
    return false;
  }

  // =========================================================================
  // Task execution
  // =========================================================================

  private async executeTask(task: DownloadTask): Promise<void> {
    let notification: { outcome: 'complete' | 'partial' | 'error'; data?: unknown } | undefined;

    try {
      const controller = new AbortController();
      task.abortController = controller;

      const shouldYield = () => this.hasHigherPriorityPending(task);
      const control: DownloadControl = { signal: controller.signal, shouldYield };

      if (task.timeframes && task.timeframes.length > 0) {
        notification = await this.executeMultiTimeframeTask(task, control);
      } else {
        notification = await this.executeSingleTask(task, control);
      }
    } catch (error) {
      task.retryCount++;
      if (error instanceof DOMException && error.name === 'AbortError') {
        task.status = 'error';
        task.error = 'Cancelled';
        task.message = this.mt('downloadQueue.cancelled');
      } else {
        task.status = 'error';
        task.error = error instanceof Error
          ? error.message
          : (typeof error === 'string' ? error : JSON.stringify(error));
        task.message = task.error;
      }
      notification = { outcome: 'error', data: new Error(task.error) };
      appLog.error(`[DownloadQueue] Task ${task.taskId} error (retry ${task.retryCount}/${MAX_TASK_RETRIES}):`, error);
    } finally {
      task.abortController = null;
      this.dbUpdateStatus(task);
      this.emitProgress(task);

      if (notification) {
        this.notifySubscribers(task, notification.outcome, notification.data);
      }
    }
  }

  /**
   * Execute a single-timeframe download task.
   */
  private async executeSingleTask(task: DownloadTask, control: DownloadControl): Promise<{ outcome: 'complete' | 'partial'; data: unknown } | undefined> {
    const providerMgr = getDataProviderManager();
    const provider = providerMgr.getProvider(task.provider);
    const dataCacheManager = getDataCacheManager();

    appLog.info(`[DownloadQueue] Starting single-TF download: ${task.taskId}`);

    const result = await dataCacheManager.ensureData(
      task.symbol,
      task.interval,
      task.startDate,
      task.endDate,
      provider,
      {
        onProgress: (progress: number, message: string) => {
          task.progress = progress;
          task.message = message;
          this.dbUpdateStatus(task);
          this.emitProgress(task);
        },
        onChunkDateRange: (range) => {
          task.totalChunks = range.totalChunks;
          task.completedChunks = range.completedChunks;
          task.currentChunkStart = range.chunkStart;
          task.currentChunkEnd = range.chunkEnd;
          this.emitProgress(task);
        },
        chunkRetryCount: task.chunkRetryCount,
      },
      control
    );

    if (result.yielded) {
      task.status = 'yielded';
      task.message = this.mt('downloadQueue.yieldedPriority');
      appLog.info(`[DownloadQueue] Task ${task.taskId} yielded`);
      return;
    }

    // TICKET_1072_1: set partial vs complete based on completeness
    const mdr = result.missingDaysResult;
    const isPartial = mdr && mdr.missingDays.length > 0;

    task.status = isPartial ? 'partial' : 'complete';
    task.progress = 100;
    task.completedChunks = 1;
    if (isPartial) {
      const dayList = mdr.missingDays.slice(0, 5).map(formatTradingDay).join(', ');
      const overflow = mdr.missingDays.length > 5 ? `, +${mdr.missingDays.length - 5} more` : '';
      task.message = this.mt('downloadQueue.partial', { rowCount: result.rowCount, dayCount: mdr.missingDays.length, dayList: dayList + overflow });
    } else {
      task.message = this.mt('downloadQueue.complete', { rowCount: result.rowCount });
    }
    appLog.info(`[DownloadQueue] Task ${task.taskId} ${task.status}: ${task.message}`);

    // Notify await-style subscribers with DataEnsureResponse
    const completeness = mdr?.completeness ?? 1.0;
    const response = {
      success: true,
      symbol: task.symbol,
      dataPath: result.filePath,
      source: task.provider,
      coverage: {
        symbol: task.symbol,
        interval: task.interval,
        startDate: task.startDate,
        endDate: task.endDate,
        totalBars: result.rowCount,
        completeness,
      },
      downloadStats: {
        barsDownloaded: result.rowCount,
        barsImported: result.rowCount,
        chunksProcessed: 1,
      },
    };

    return { outcome: isPartial ? 'partial' : 'complete', data: response };
  }

  /**
   * Execute a multi-timeframe download task.
   * Delegates to DataStorageService which handles aggregate vs native mode.
   */
  private async executeMultiTimeframeTask(task: DownloadTask, control: DownloadControl): Promise<{ outcome: 'complete'; data: unknown } | undefined> {
    appLog.info(
      `[DownloadQueue] Starting multi-TF download: ${task.taskId} [${task.timeframes!.join(',')}]`
    );

    const result = await getDataStorageService().ensureMultiTimeframe({
      symbol: task.symbol,
      startDate: task.startDate,
      endDate: task.endDate,
      timeframes: task.timeframes!,
      provider: task.provider,
      control,
    });

    if (!result.success) {
      throw new Error(result.error || 'Multi-timeframe download failed');
    }

    // TICKET_351_P2_1: Check yield propagation from DataStorageService
    if (result.yielded) {
      task.status = 'yielded';
      task.message = this.mt('downloadQueue.yieldedPriorityMultiTf');
      appLog.info(`[DownloadQueue] Task ${task.taskId} yielded during multi-TF download`);
      return;
    }

    task.status = 'complete';
    task.progress = 100;
    task.completedChunks = 1;
    task.message = this.mt('downloadQueue.completeMultiTf', { count: task.timeframes!.length });
    appLog.info(`[DownloadQueue] Task ${task.taskId} completed: ${Object.keys(result.dataFeeds).length} timeframes`);

    return { outcome: 'complete', data: result };
  }

  // =========================================================================
  // Coalescing helpers
  // =========================================================================

  private getCoalescingKey(config: EnqueueConfig): string {
    if (config.timeframes && config.timeframes.length > 0) {
      return `${config.symbol}|${[...config.timeframes].sort().join(',')}|${config.provider}`;
    }
    return `${config.symbol}|${config.interval}|${config.provider}`;
  }

  private findTaskByKey(key: string): DownloadTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.status !== 'queued' && task.status !== 'downloading' && task.status !== 'yielded') {
        continue;
      }
      const taskKey = task.timeframes
        ? `${task.symbol}|${[...task.timeframes].sort().join(',')}|${task.provider}`
        : `${task.symbol}|${task.interval}|${task.provider}`;
      if (taskKey === key) return task;
    }
    return undefined;
  }

  private recalculateEffectivePriority(task: DownloadTask): void {
    let maxPri: DownloadPriority = 'background';
    for (const sub of task.subscribers.values()) {
      if (PRIORITY_RANK[sub.priority] > PRIORITY_RANK[maxPri]) {
        maxPri = sub.priority;
      }
    }
    if (maxPri !== task.effectivePriority) {
      appLog.info(
        `[DownloadQueue] Task ${task.taskId} priority escalated: ${task.effectivePriority} -> ${maxPri}`
      );
      task.effectivePriority = maxPri;
    }
  }

  // =========================================================================
  // Subscriber notification
  // =========================================================================

  private notifySubscribers(task: DownloadTask, outcome: 'complete' | 'partial' | 'error', data?: unknown): void {
    for (const sub of task.subscribers.values()) {
      if ((outcome === 'complete' || outcome === 'partial') && sub.resolve) {
        sub.resolve(data);
      } else if (outcome === 'error' && sub.reject) {
        sub.reject(data instanceof Error ? data : new Error(String(data)));
      }
    }
  }

  // =========================================================================
  // IPC emit helpers
  // =========================================================================

  /**
   * TICKET_1051_1 D3: All tasks emit to data:download-queue-progress unconditionally.
   */
  private emitProgress(task: DownloadTask): void {
    const primarySub = task.subscribers.values().next().value as Subscriber | undefined;
    const payload = {
      taskId: task.taskId,
      symbol: task.symbol,
      interval: task.interval,
      provider: task.provider,
      status: task.status,
      progress: task.progress,
      message: task.message,
      error: task.error,
      callerId: primarySub?.callerId || 'data-manager',
      totalChunks: task.totalChunks,
      completedChunks: task.completedChunks,
      currentChunkStart: task.currentChunkStart,
      currentChunkEnd: task.currentChunkEnd,
    };

    sendToRenderer('data:download-queue-progress', payload);
  }

  private emitFullStatus(): void {
    sendToRenderer('data:download-queue-progress', {
      type: 'full-status',
      tasks: Array.from(this.tasks.values()).map(t => ({
        taskId: t.taskId,
        symbol: t.symbol,
        interval: t.interval,
        provider: t.provider,
        status: t.status,
        progress: t.progress,
        message: t.message,
        error: t.error,
        callerId: (t.subscribers.values().next().value as Subscriber | undefined)?.callerId || 'data-manager',
        totalChunks: t.totalChunks,
        completedChunks: t.completedChunks,
        currentChunkStart: t.currentChunkStart,
        currentChunkEnd: t.currentChunkEnd,
      })),
    });
  }

  // =========================================================================
  // DB persistence helpers
  // =========================================================================

  private dbInsert(task: DownloadTask): void {
    // Get primary subscriber callerId for persistence
    const primarySub = task.subscribers.values().next().value as Subscriber | undefined;

    getDatabaseManager().prepare(`
      INSERT INTO download_queue
        (task_id, symbol, interval, start_date, end_date, provider,
         status, progress, message, total_chunks, completed_chunks,
         priority, caller_id, waiting_since, timeframes, retry_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.taskId, task.symbol, task.interval, task.startDate, task.endDate,
      task.provider, task.status, task.progress, task.message,
      task.totalChunks, task.completedChunks,
      task.effectivePriority,
      primarySub?.callerId || 'data-manager',
      task.waitingSince,
      task.timeframes ? JSON.stringify(task.timeframes) : null,
      task.retryCount,
    );
  }

  private dbUpdateStatus(task: DownloadTask): void {
    if (this.shuttingDown) return;
    try {
      getDatabaseManager().prepare(`
        UPDATE download_queue
        SET status = ?, progress = ?, message = ?, error = ?,
            completed_chunks = ?, priority = ?, retry_count = ?,
            updated_at = datetime('now')
        WHERE task_id = ?
      `).run(
        task.status, task.progress, task.message, task.error || null,
        task.completedChunks, task.effectivePriority, task.retryCount,
        task.taskId
      );
    } catch {
      // DB closed during shutdown — task will be restored as 'queued' on next startup
    }
  }

  private dbDelete(taskId: string): void {
    getDatabaseManager().prepare(`DELETE FROM download_queue WHERE task_id = ?`).run(taskId);
  }
}

// =============================================================================
// Two-phase Singleton
// =============================================================================

let instance: DataDownloadQueue | null = null;

export function initializeDataDownloadQueue(opts?: { skipRestore?: boolean }): void {
  if (instance) {
    appLog.warn('[DownloadQueue] Already initialized, skipping');
    return;
  }
  instance = new DataDownloadQueue();
  if (opts?.skipRestore) {
    appLog.info('[DownloadQueue] Initialized (skipRestore=true -- no persisted tasks resumed)');
  } else {
    instance.restoreAndResume();
    appLog.info('[DownloadQueue] Initialized');
  }
}

export function getDataDownloadQueue(): DataDownloadQueue {
  if (!instance) {
    throw new Error('DataDownloadQueue not initialized. Call initializeDataDownloadQueue() first.');
  }
  return instance;
}

/**
 * TICKET_1051_1: Convenience wrapper -- enqueue a single-symbol download
 * through the queue and return a Promise<DataEnsureResponse>.
 *
 * Used by all migrated bypass call sites that previously called
 * DataStorageService.ensureSingle() or resolveLocalOrDownload() directly.
 */
export function enqueueAndAwait(config: EnqueueConfig): Promise<DataEnsureResponse> {
  return new Promise<DataEnsureResponse>((resolve, reject) => {
    getDataDownloadQueue().enqueue(
      config,
      (result: unknown) => resolve(result as DataEnsureResponse),
      reject,
    );
  });
}
