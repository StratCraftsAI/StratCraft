import type { ActionModule, ActionResult } from '../../types';
import { HeadlessBootstrap } from '../../bootstrap';

const mod: ActionModule = {
  name: 'data-manager/queue-download',
  description: 'Enqueue a data download -- same as "Add to Queue" in Data Management',

  async run(args): Promise<ActionResult> {
    const t0 = performance.now();

    const symbol = args.symbol as string | undefined;
    const interval = args.interval as string | undefined;
    const provider = args.provider as string | undefined;
    const startDate = args.startDate as string ?? args.start as string | undefined;
    const endDate = args.endDate as string ?? args.end as string | undefined;

    if (!symbol || !interval) {
      return {
        name: mod.name,
        ok: false,
        summary: 'Missing required args: symbol, interval',
        details: { provided: { symbol, interval, provider, startDate, endDate } },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    await HeadlessBootstrap.init();

    const { initializeDataDownloadQueue, getDataDownloadQueue } =
      await import('../../../main/services/data-download-queue');
    initializeDataDownloadQueue();

    const queue = getDataDownloadQueue();
    const resolvedProvider = provider ?? (await import('../../../main/services/data-providers/provider-manager'))
      .getDataProviderManager()
      .getDefaultProvider().id;

    const taskId = queue.enqueue({
      symbol,
      interval,
      provider: resolvedProvider,
      startDate: startDate || '2000-01-01',
      endDate: endDate || new Date().toISOString().slice(0, 10),
      callerId: 'headless',
      priority: 'background',
    });

    return {
      name: mod.name,
      ok: true,
      summary: `Enqueued ${symbol}/${interval} via ${resolvedProvider} -> taskId=${taskId}`,
      details: { taskId, symbol, interval, provider: resolvedProvider, startDate, endDate },
      durationMs: Math.round(performance.now() - t0),
    };
  },
};

export default mod;
