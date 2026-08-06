import type { ActionModule, ActionResult } from '../../types';
import { HeadlessBootstrap } from '../../bootstrap';

const mod: ActionModule = {
  name: 'data-manager/delete-segment',
  description: 'Delete a cached data segment from the catalog',

  async run(args): Promise<ActionResult> {
    const t0 = performance.now();

    const symbol = args.symbol as string | undefined;
    const interval = args.interval as string | undefined;
    const provider = args.provider as string | undefined;

    if (!symbol || !interval) {
      return {
        name: mod.name,
        ok: false,
        summary: 'Missing required args: symbol, interval',
        details: { provided: { symbol, interval, provider } },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    await HeadlessBootstrap.init();

    const { getDataCacheManager } = await import('../../../main/services/data-cache-manager');
    const cache = getDataCacheManager();

    const candidates = cache.listFiles({ symbol, interval, provider }).files;
    if (!provider && candidates.length > 1) {
      return {
        name: mod.name,
        ok: false,
        summary: `Multiple cached segments found for ${symbol}/${interval}; provider is required`,
        details: { symbol, interval, providers: candidates.map((entry) => entry.provider) },
        durationMs: Math.round(performance.now() - t0),
      };
    }
    const metadata = candidates[0] ?? null;
    if (!metadata) {
      return {
        name: mod.name,
        ok: false,
        summary: `No cached segment found for ${symbol}/${interval}/${provider || 'any'}`,
        details: { symbol, interval, provider },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    cache.deleteFile(metadata.id);

    return {
      name: mod.name,
      ok: true,
      summary: `Deleted segment ${symbol}/${interval}/${metadata.provider} (${metadata.rowCount} rows)`,
      details: {
        symbol,
        interval,
        provider: metadata.provider,
        filePath: metadata.filePath,
        rowCount: metadata.rowCount,
      },
      durationMs: Math.round(performance.now() - t0),
    };
  },
};

export default mod;
