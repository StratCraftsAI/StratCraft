import type { ActionModule, ActionResult } from '../../types';
import { HeadlessBootstrap } from '../../bootstrap';

interface SymbolResult {
  symbol: string;
  status: 'complete' | 'partial' | 'error' | 'skipped';
  bars: number;
  elapsedSec: number;
  error?: string;
}

const PROGRESS_INTERVAL_MS = 30_000;

const mod: ActionModule = {
  name: 'data-manager/download-all-dukascopy',
  description: 'Download all Dukascopy symbols in parallel via the download queue',

  async run(args): Promise<ActionResult> {
    const t0 = performance.now();

    const interval = (args.interval as string) || '1h';
    const assetType = args.assetType as string | undefined;
    const limit = typeof args.limit === 'number' ? args.limit : 0;
    const startFrom = (args.startFrom as string | undefined)?.toUpperCase();

    await HeadlessBootstrap.init();

    const { DukascopyProvider } = await import('../../../main/services/data-providers/dukascopy-provider');
    const provider = new DukascopyProvider();

    const { symbols: allSymbols, total } = await provider.listSymbols();
    console.log(`[download-all-dukascopy] Total symbols in Dukascopy: ${total}`);

    let symbols = allSymbols;

    if (assetType) {
      const validTypes = new Set(assetType.split(','));
      const { results } = await provider.searchSymbols('', total);
      const typeMap = new Map(results.map(r => [r.symbol, r.type]));
      symbols = symbols.filter(s => validTypes.has(typeMap.get(s) ?? ''));
      console.log(`[download-all-dukascopy] Filtered to ${symbols.length} symbols (assetType=${assetType})`);
    }

    if (startFrom) {
      const idx = symbols.findIndex(s => s === startFrom);
      if (idx > 0) {
        symbols = symbols.slice(idx);
        console.log(`[download-all-dukascopy] Resuming from ${startFrom}, ${symbols.length} symbols remaining`);
      } else if (idx < 0) {
        console.log(`[download-all-dukascopy] WARNING: startFrom=${startFrom} not found, starting from beginning`);
      }
    }

    if (limit > 0) {
      symbols = symbols.slice(0, limit);
      console.log(`[download-all-dukascopy] Limited to ${symbols.length} symbols`);
    }

    const { initializeDataDownloadQueue, getDataDownloadQueue } =
      await import('../../../main/services/data-download-queue');
    initializeDataDownloadQueue();
    const queue = getDataDownloadQueue();

    const results: SymbolResult[] = [];
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    let settled = 0;

    console.log(`[download-all-dukascopy] Resolving date ranges for ${symbols.length} symbols...`);

    interface EnqueueItem {
      symbol: string;
      index: number;
      startDate: string;
      endDate: string;
    }

    const toEnqueue: EnqueueItem[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      const progress = `[${i + 1}/${symbols.length}]`;

      let dateRange: { startTime: string | null; endTime: string | null };
      try {
        dateRange = await provider.getSymbolDateRange(symbol);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`${progress} ${symbol}: SKIP (no date range: ${msg})`);
        results.push({ symbol, status: 'skipped', bars: 0, elapsedSec: 0, error: msg });
        skipped++;
        settled++;
        continue;
      }

      if (!dateRange.startTime || !dateRange.endTime) {
        console.log(`${progress} ${symbol}: SKIP (null date range)`);
        results.push({ symbol, status: 'skipped', bars: 0, elapsedSec: 0, error: 'null date range' });
        skipped++;
        settled++;
        continue;
      }

      toEnqueue.push({ symbol, index: i, startDate: dateRange.startTime, endDate: dateRange.endTime });
    }

    console.log(
      `[download-all-dukascopy] Date ranges resolved: ${toEnqueue.length} to download, ${skipped} skipped`
    );

    const progressTimer = setInterval(() => {
      const elapsedMin = Math.round((performance.now() - t0) / 60_000);
      console.log(
        `[download-all-dukascopy] Progress: ${settled}/${symbols.length} settled ` +
        `(${completed} done, ${failed} failed, ${skipped} skipped) ${elapsedMin}min elapsed`
      );
    }, PROGRESS_INTERVAL_MS);

    const promises = toEnqueue.map(({ symbol, index, startDate, endDate }) => {
      const progress = `[${index + 1}/${symbols.length}]`;
      const symStart = Date.now();

      console.log(`${progress} ${symbol}: enqueued ${interval} ${startDate} -> ${endDate}`);

      return new Promise<void>((resolve) => {
        queue.enqueue(
          {
            symbol,
            interval,
            startDate,
            endDate,
            provider: 'dukascopy',
            callerId: 'download-all-dukascopy',
            priority: 'background',
          },
          (r) => {
            const elapsedSec = Math.round((Date.now() - symStart) / 1000);
            const dr = r as { coverage?: { totalBars?: number }; downloadStats?: { barsDownloaded?: number } } | undefined;
            const bars = dr?.coverage?.totalBars ?? dr?.downloadStats?.barsDownloaded ?? 0;
            console.log(`${progress} ${symbol}: DONE (${bars} bars, ${elapsedSec}s)`);
            results.push({ symbol, status: 'complete', bars, elapsedSec });
            completed++;
            settled++;
            resolve();
          },
          (e) => {
            const elapsedSec = Math.round((Date.now() - symStart) / 1000);
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`${progress} ${symbol}: ERROR (${msg}, ${elapsedSec}s)`);
            results.push({ symbol, status: 'error', bars: 0, elapsedSec, error: msg });
            failed++;
            settled++;
            resolve();
          },
        );
      });
    });

    await Promise.all(promises);
    clearInterval(progressTimer);

    const totalSec = Math.round((performance.now() - t0) / 1000);

    console.log('\n=== SUMMARY ===');
    console.log(`Total: ${symbols.length} | Completed: ${completed} | Failed: ${failed} | Skipped: ${skipped}`);
    console.log(`Elapsed: ${totalSec}s`);

    if (failed > 0) {
      console.log('\nFailed symbols:');
      for (const r of results.filter(r => r.status === 'error')) {
        console.log(`  ${r.symbol}: ${r.error}`);
      }
    }

    const ok = failed === 0;
    return {
      name: mod.name,
      ok,
      summary: `${completed}/${symbols.length} downloaded, ${failed} failed, ${skipped} skipped (${totalSec}s)`,
      details: {
        interval,
        assetType: assetType ?? 'all',
        totalSymbols: symbols.length,
        completed,
        failed,
        skipped,
        totalElapsedSec: totalSec,
        results,
      },
      durationMs: Math.round(performance.now() - t0),
    };
  },
};

export default mod;
