/**
 * Policy-free market-data read operations shared by plugin IPC and Service API.
 */

import { appLog } from '../../utils/logger';
import { getDataProviderManager } from '../data-providers/provider-manager';
import { getDataCacheManager } from '../data-cache-manager';
import { MARKET_DATA_MAX_BARS } from '../../../shared/constants/validation';
import type { OHLCVRow } from '../data-providers/types';

export type ApiResult<T = unknown> = { success: boolean; data?: T; error?: string };

export interface MarketDataResult {
  symbol: string;
  interval: string;
  provider: string;
  bar_count: number;
  start_date: string;
  end_date: string;
  bars: OHLCVRow[];
}

export interface PluginMarketDataParams {
  symbol: string;
  interval: string;
  start: string;
  end: string;
}

export interface MarketSymbolsResult {
  results: Array<{ symbol: string; name: string }>;
  totalCount: number;
  truncated: boolean;
}

export async function getMarketData(
  body: Record<string, unknown>,
): Promise<ApiResult<MarketDataResult>> {
  const symbol = body.symbol;
  const interval = body.interval;
  const startDate = body.start_date;
  const endDate = body.end_date;
  const provider = body.provider;

  if (!symbol || typeof symbol !== 'string') {
    return { success: false, error: 'symbol is required' };
  }
  if (!interval || typeof interval !== 'string') {
    return { success: false, error: 'interval is required' };
  }
  if (!startDate || typeof startDate !== 'string') {
    return { success: false, error: 'start_date is required (TICKET_919: window pushdown mandatory)' };
  }
  if (!endDate || typeof endDate !== 'string') {
    return { success: false, error: 'end_date is required (TICKET_919: window pushdown mandatory)' };
  }

  try {
    const manager = getDataProviderManager();
    const dataProvider = provider && typeof provider === 'string'
      ? manager.getProvider(provider)
      : manager.getDefaultProvider();
    if (!dataProvider) {
      return { success: false, error: `Provider '${provider ?? 'default'}' not found` };
    }

    const rows = await dataProvider.queryOHLCV(symbol, interval, startDate, endDate);
    if (rows.length > MARKET_DATA_MAX_BARS) {
      return {
        success: false,
        error: `Response would contain ${rows.length} bars, exceeding the maximum of ${MARKET_DATA_MAX_BARS}. Narrow the time window (start_date/end_date) or use a larger interval.`,
      };
    }
    return {
      success: true,
      data: {
        symbol,
        interval,
        provider: dataProvider.id,
        bar_count: rows.length,
        start_date: startDate,
        end_date: endDate,
        bars: rows,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appLog.error(`[TICKET_1235_9] getMarketData error: ${message}`);
    return { success: false, error: message };
  }
}

export async function getMarketSymbols(
  body: Record<string, unknown>,
): Promise<ApiResult<MarketSymbolsResult>> {
  const query = body.query;
  const provider = body.provider;
  const limit = typeof body.limit === 'number' ? body.limit : 50;

  try {
    if (provider && typeof provider === 'string') {
      const cacheManager = getDataCacheManager();
      if (cacheManager.getImportedPackage(provider)) {
        const seen = new Set<string>();
        const lowerQuery = query && typeof query === 'string' ? query.toLowerCase() : '';
        const matches: Array<{ symbol: string; name: string }> = [];
        for (const file of cacheManager.listImportedPackageFiles(provider)) {
          if (seen.has(file.symbol)) continue;
          seen.add(file.symbol);
          if (!lowerQuery || file.symbol.toLowerCase().includes(lowerQuery)) {
            matches.push({ symbol: file.symbol, name: file.symbol });
          }
        }
        matches.sort((a, b) => a.symbol.localeCompare(b.symbol));
        return {
          success: true,
          data: {
            results: matches.slice(0, limit),
            totalCount: matches.length,
            truncated: matches.length > limit,
          },
        };
      }
    }

    const manager = getDataProviderManager();
    const dataProvider = provider && typeof provider === 'string'
      ? manager.getProvider(provider)
      : manager.getDefaultProvider();
    if (!dataProvider) {
      return { success: false, error: `Provider '${provider ?? 'default'}' not found` };
    }
    if (query && typeof query === 'string' && dataProvider.capabilities.supportsSearch) {
      return { success: true, data: await dataProvider.searchSymbols(query, limit) };
    }
    if (!query && dataProvider.listSymbols) {
      const result = await dataProvider.listSymbols(limit);
      return {
        success: true,
        data: {
          results: result.symbols.map(symbol => ({ symbol, name: symbol })),
          totalCount: result.total,
          truncated: result.total > result.symbols.length,
        },
      };
    }
    return { success: true, data: { results: [], totalCount: 0, truncated: false } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appLog.error(`[TICKET_1235_9] getMarketSymbols error: ${message}`);
    return { success: false, error: message };
  }
}

export async function getPluginMarketData(
  params: PluginMarketDataParams,
): Promise<OHLCVRow[]> {
  const result = await getMarketData({
    symbol: params.symbol,
    interval: params.interval,
    start_date: params.start,
    end_date: params.end,
  });
  if (!result.success || !result.data) {
    throw new Error(result.error);
  }
  return result.data.bars;
}

export async function getPluginMarketSymbols(): Promise<string[]> {
  const result = await getMarketSymbols({});
  if (!result.success || !result.data) {
    throw new Error(result.error);
  }
  return result.data.results.map(({ symbol }) => symbol);
}
