/**
 * CCXT Crypto Data Provider
 *
 * TICKET_336 / DATA_003: Free cryptocurrency market data via CCXT unified API.
 * Uses Binance as default exchange. No authentication required for public OHLCV.
 *
 * Native-mode provider: CCXT exchanges natively support all common timeframes,
 * so no local aggregation is needed.
 *
 * @see https://docs.ccxt.com/
 */

import { IDataProvider, ProviderCapabilities, ProviderConnectionStatus, ProviderSymbolInfo, SymbolSearchResponse, OHLCVRow } from './types';
import type { MarketId } from '@StratCraft/types';
import { PROVIDER_CCXT } from '@StratCraft/types';
import { deriveSupportedIntervals } from './interval-resolution';
import {
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m,
  INTERVAL_1h, INTERVAL_4h, INTERVAL_1d,
} from '../../../shared/constants/intervals';
import { appLog } from '../../utils/logger';
import { CCXT_MAX_CANDLES_PER_REQUEST } from '../../../shared/constants/data-providers';
import { mainT } from '../../i18n/main-strings';
import { getCurrentMainLocale } from '../locale-service';
import { MS_PER_SECOND, MS_PER_DAY } from '../../../shared/constants/timing';
import { asEpochSeconds } from '../../../shared/types/epoch';

// =============================================================================
// Constants
// =============================================================================

/** CCXT uses the same interval notation as StratCraft -- identity mapping */
const INTERVAL_MAP: Record<string, string> = {
  [INTERVAL_1m]:  INTERVAL_1m,
  [INTERVAL_5m]:  INTERVAL_5m,
  [INTERVAL_15m]: INTERVAL_15m,
  [INTERVAL_30m]: INTERVAL_30m,
  [INTERVAL_1h]:  INTERVAL_1h,
  [INTERVAL_4h]:  INTERVAL_4h,
  [INTERVAL_1d]:  INTERVAL_1d,
};

const MAX_CANDLES_PER_REQUEST = CCXT_MAX_CANDLES_PER_REQUEST;

/** Interval durations in milliseconds for pagination cursor advancement */
const INTERVAL_MS: Record<string, number> = {
  [INTERVAL_1m]:  60_000,
  [INTERVAL_5m]:  300_000,
  [INTERVAL_15m]: 900_000,
  [INTERVAL_30m]: 1_800_000,
  [INTERVAL_1h]:  3_600_000,
  [INTERVAL_4h]:  14_400_000,
  [INTERVAL_1d]:  86_400_000,
};

// =============================================================================
// Exchange Cache (lazy-initialized)
// =============================================================================

interface CachedExchange {
  exchange: import('ccxt').Exchange;
  symbols: string[];
}

let exchangeCache: CachedExchange | null = null;

/**
 * Get or create the CCXT exchange instance with loaded markets.
 * Lazy initialization -- built on first provider call.
 */
async function getExchange(): Promise<CachedExchange> {
  if (exchangeCache) return exchangeCache;

  appLog.info('[CCXTProvider] Initializing Binance exchange and loading markets...');

  const ccxt = await import('ccxt');
  const exchange = new ccxt.binance({ enableRateLimit: true });
  await exchange.loadMarkets();

  const symbols = exchange.symbols || [];
  exchangeCache = { exchange, symbols };

  appLog.info(`[CCXTProvider] Markets loaded: ${symbols.length} symbols`);
  return exchangeCache;
}

// =============================================================================
// CCXTProvider
// =============================================================================

export class CCXTProvider implements IDataProvider {
  readonly id = PROVIDER_CCXT;
  readonly name = 'CCXT Crypto (Free)';
  // TICKET_927_2_2: CCXT serves spot and perpetual markets.
  readonly supportedMarkets: ReadonlyArray<MarketId> = ['ccxt_spot', 'ccxt_perp'];
  readonly capabilities: ProviderCapabilities = {
    assetTypes: ['crypto'],
    // TICKET_196_12 Step 1: CCXT exchanges serve all these timeframes natively
    // (identity INTERVAL_MAP). No aggregation needed -- native mode (no
    // baseInterval). A drift test pins nativeIntervals === Object.keys(INTERVAL_MAP).
    nativeIntervals: [INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_4h, INTERVAL_1d],
    // TICKET_196_12 Step 3: derived (native union aggregatable) -- not hand-written
    intervals: deriveSupportedIntervals([INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_4h, INTERVAL_1d]),
    requiresAuth: false,
    supportsSearch: true,
    // TICKET_849 Phase D3: crypto trades 24/7 -- no calendar inflation
    // needed. `calendarPaddingRatio` omitted -> defaults to 1.0 in
    // `pullBarsToCalendarMs`. Matches pre-Phase-D3 `inferAssetClass('ccxt')
    // === 'crypto'` ratio=1.0 behaviour.
    // TICKET_958_4: All days are trading days for crypto markets. Drives the
    // write-boundary day-set invariant.
    tradingCalendar: 'CRYPTO_24_7',
    // TICKET_958_5 AC #1: CCXT's OHLCV tuples are converted in-line to
    // canonical rows (`timestamp` Unix seconds + OHLCV) inside queryOHLCV.
    cacheSchema: 'OHLCV_V1_CANONICAL',
  };

  async queryOHLCV(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCVRow[]> {
    const ccxtTimeframe = INTERVAL_MAP[interval];
    if (!ccxtTimeframe) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unsupportedInterval', { provider: 'CCXT', interval, supported: Object.keys(INTERVAL_MAP).join(', ') }));
    }

    const intervalMs = INTERVAL_MS[interval];
    if (!intervalMs) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.missingIntervalDuration', { interval }));
    }

    appLog.info(`[CCXTProvider] Querying ${symbol} ${ccxtTimeframe} ${startDate} - ${endDate}`);

    const { exchange } = await getExchange();
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime() + MS_PER_DAY;

    const rows: OHLCVRow[] = [];
    let cursor = startMs;

    while (cursor < endMs) {
      const candles = await exchange.fetchOHLCV(
        symbol,
        ccxtTimeframe,
        cursor,
        MAX_CANDLES_PER_REQUEST
      );

      if (!candles || candles.length === 0) break;

      for (const c of candles) {
        // CCXT returns [timestamp_ms, open, high, low, close, volume]
        const ts = c[0] as number;
        if (ts >= endMs) break;

        rows.push({
          // TICKET_813: asEpochSeconds tags the unit at the
          // provider boundary. CCXT emits ms; we floor-divide to
          // seconds, then brand.
          timestamp: asEpochSeconds(Math.floor(ts / MS_PER_SECOND)),
          open: c[1] as number,
          high: c[2] as number,
          low: c[3] as number,
          close: c[4] as number,
          volume: c[5] as number,
        });
      }

      // Advance cursor past the last received candle
      const lastTs = candles[candles.length - 1][0] as number;
      if (lastTs >= endMs) break;
      cursor = lastTs + intervalMs;

      // If fewer candles than limit, no more data available
      if (candles.length < MAX_CANDLES_PER_REQUEST) break;
    }

    appLog.info(`[CCXTProvider] Total bars received: ${rows.length} for ${symbol} ${ccxtTimeframe}`);
    return rows;
  }

  async searchSymbols(query: string, limit = 20): Promise<SymbolSearchResponse> {
    appLog.info(`[CCXTProvider] Searching symbols: "${query}"`);

    const { symbols } = await getExchange();
    const upperQuery = query.toUpperCase();

    // TICKET_313 pattern: Relevance-sorted search (exact > prefix > contains)
    const rank = (sym: string): number => {
      const upper = sym.toUpperCase();
      if (upper === upperQuery) return 0;
      if (upper.startsWith(upperQuery)) return 1;
      if (upper.includes(upperQuery)) return 2;
      return 3;
    };

    // TICKET_641_10: Compute all matches before slicing for totalCount
    const allMatches = symbols
      .filter(sym => sym.toUpperCase().includes(upperQuery))
      .sort((a, b) => {
        const diff = rank(a) - rank(b);
        return diff !== 0 ? diff : a.localeCompare(b);
      });

    const results = allMatches
      .slice(0, limit)
      .map(sym => ({
        symbol: sym,
        name: sym,
        type: 'crypto' as const,
      }));

    appLog.info(`[CCXTProvider] Search returned ${results.length} of ${allMatches.length} results`);
    return {
      results,
      totalCount: allMatches.length,
      truncated: allMatches.length > limit,
    };
  }

  async getSymbolDateRange(symbol: string): Promise<{ startTime: string | null; endTime: string | null }> {
    appLog.info(`[CCXTProvider] Getting date range for: ${symbol}`);

    const { exchange } = await getExchange();

    // Boundary probe: earliest bar (use a far-past start date)
    const earliestCandles = await exchange.fetchOHLCV(symbol, INTERVAL_1d, 0, 1);

    // Boundary probe: latest bar
    const latestCandles = await exchange.fetchOHLCV(symbol, INTERVAL_1d, undefined, 1);

    const startTime = earliestCandles?.[0]
      ? new Date(earliestCandles[0][0] as number).toISOString().split('T')[0]
      : null;

    const endTime = latestCandles?.[0]
      ? new Date(latestCandles[0][0] as number).toISOString().split('T')[0]
      : null;

    appLog.info(`[CCXTProvider] Date range for ${symbol}: ${startTime} - ${endTime}`);
    return { startTime, endTime };
  }

  async checkConnection(): Promise<ProviderConnectionStatus> {
    try {
      appLog.info('[CCXTProvider] Checking connection...');

      const probeStart = Date.now();
      const { exchange } = await getExchange();

      // Lightweight probe: fetch 1 candle of BTC/USDT
      await exchange.fetchOHLCV('BTC/USDT', INTERVAL_1d, undefined, 1);

      const latencyMs = Date.now() - probeStart;
      appLog.info(`[CCXTProvider] Connection OK, latency: ${latencyMs}ms`);
      return { connected: true, latencyMs };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection check failed';
      appLog.warn(`[CCXTProvider] Connection FAILED: ${msg}`);
      return {
        connected: false,
        error: msg,
      };
    }
  }

  /**
   * TICKET_880_4_1: List all available crypto symbols from Binance via CCXT.
   * Returns symbols in exchange's default order.
   */
  async listSymbols(limit?: number): Promise<{ symbols: string[]; total: number }> {
    const { symbols } = await getExchange();
    const total = symbols.length;
    const result = limit && limit > 0 ? symbols.slice(0, limit) : symbols;
    appLog.info(`[CCXTProvider] listSymbols: returning ${result.length} of ${total} symbols`);
    return { symbols: result, total };
  }
}
