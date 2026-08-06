/**
 * Dukascopy Data Provider
 *
 * DATA_002 / TICKET_325: Free multi-asset data (forex, crypto, stocks, ETFs, indices)
 * via dukascopy-node npm package. No authentication required.
 *
 * Native-mode provider: fetches each timeframe directly from Dukascopy CDN.
 * TICKET_328: Switched from aggregate (1m base) to native mode -- CDN serves
 * pre-aggregated bars at each timeframe level natively.
 *
 * Data source: Dukascopy Bank SA datafeed CDN (compressed binary artifacts).
 * Package handles URL generation, binary decompression, and tick-to-OHLCV conversion.
 *
 * @see https://github.com/Leo4815162342/dukascopy-node
 */

import { IDataProvider, ProviderCapabilities, ProviderConnectionStatus, ProviderSymbolInfo, SymbolSearchResponse, OHLCVRow } from './types';
import type { MarketId } from '@StratCraft/types';
import { PROVIDER_DUKASCOPY, DATA_API_BASE_DUKASCOPY } from '@StratCraft/types';
import { deriveSupportedIntervals } from './interval-resolution';
import {
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m,
  INTERVAL_1h, INTERVAL_4h, INTERVAL_1d,
} from '../../../shared/constants/intervals';
import { appLog } from '../../utils/logger';
import { asEpochSeconds } from '../../../shared/types/epoch';
import { mainT } from '../../i18n/main-strings';
import { getCurrentMainLocale } from '../locale-service';
import {
  DUKASCOPY_BATCH_SIZE,
  DUKASCOPY_BATCH_PAUSE_MS,
  DUKASCOPY_RETRY_COUNT,
  DUKASCOPY_RETRY_PAUSE_MS,
  DUKASCOPY_QUERY_TIMEOUT_MS,
} from '../../../shared/constants/data-providers';
import { CRYPTO_BASES } from '../../../shared/utils/crypto-symbols';

// TICKET_476: Constants centralized in shared/constants/data-providers.ts
const BATCH_SIZE = DUKASCOPY_BATCH_SIZE;
const PAUSE_BETWEEN_BATCHES_MS = DUKASCOPY_BATCH_PAUSE_MS;
const RETRY_COUNT = DUKASCOPY_RETRY_COUNT;
const PAUSE_BETWEEN_RETRIES_MS = DUKASCOPY_RETRY_PAUSE_MS;

// TICKET_1074 / TICKET_1078: opaque error detection moved to shared utility.
import { isOpaqueError } from '../../../shared/utils/opaque-error';
export { isOpaqueError };

/** Map UI interval notation to dukascopy-node timeframe notation */
const INTERVAL_MAP: Record<string, string> = {
  [INTERVAL_1m]:  'm1',
  [INTERVAL_5m]:  'm5',
  [INTERVAL_15m]: 'm15',
  [INTERVAL_30m]: 'm30',
  [INTERVAL_1h]:  'h1',
  [INTERVAL_4h]:  'h4',
  [INTERVAL_1d]:  'd1',
};

// CRYPTO_BASES promoted to shared/utils/crypto-symbols.ts so the renderer
// (Signal Discovery Layer 3 on-chain gate) and main process (this provider's
// asset-type classifier) share a single source of truth. See TICKET_568_5_1_c.

// =============================================================================
// Instrument Cache (built lazily from dukascopy-node metadata)
// =============================================================================

interface InstrumentEntry {
  id: string;
  name: string;
  description: string;
  type: 'forex' | 'stock' | 'crypto' | 'etf' | 'index';
  startDate: string;
}

let instrumentCache: InstrumentEntry[] | null = null;

/**
 * Classify instrument into asset type based on ID and metadata.
 *
 * Classification rules:
 * - ID contains 'idx' -> index
 * - Description contains 'ETF' -> etf
 * - Name has no dot (pure pair like EUR/USD, BTC/USD):
 *   - Base currency in CRYPTO_BASES -> crypto
 *   - Otherwise -> forex
 * - Name has dot (exchange-listed, e.g. A.US/USD) -> stock
 */
function classifyInstrument(
  id: string,
  name: string,
  description: string
): 'forex' | 'stock' | 'crypto' | 'etf' | 'index' {
  if (id.includes('idx')) return 'index';
  if (description.toLowerCase().includes('etf')) return 'etf';
  if (name.indexOf('.') < 0) {
    const base = name.split('/')[0];
    if (CRYPTO_BASES.has(base)) return 'crypto';
    return 'forex';
  }
  return 'stock';
}

/**
 * Build instrument cache from dukascopy-node metadata.
 * Lazy initialization -- built on first search/dateRange call.
 */
async function getInstrumentCache(): Promise<InstrumentEntry[]> {
  if (instrumentCache) return instrumentCache;

  appLog.info('[DukascopyProvider] Building instrument cache from dukascopy-node metadata...');

  const { instrumentMetaData } = await import('dukascopy-node');

  instrumentCache = Object.entries(instrumentMetaData).map(([id, meta]) => {
    const m = meta as {
      name: string;
      description: string;
      startDayForMinuteCandles: string;
    };
    return {
      id,
      name: m.name,
      description: m.description,
      type: classifyInstrument(id, m.name, m.description),
      startDate: m.startDayForMinuteCandles.split('T')[0],
    };
  });

  appLog.info(`[DukascopyProvider] Instrument cache built: ${instrumentCache.length} instruments`);
  return instrumentCache;
}

// =============================================================================
// DukascopyProvider
// =============================================================================

export class DukascopyProvider implements IDataProvider {
  readonly id = PROVIDER_DUKASCOPY;
  readonly name = 'Dukascopy';
  // TICKET_927_2_2: only `dukascopy_forex`. The upstream feed exposes other
  // asset classes (see capabilities.assetTypes) but the routing-authoritative
  // MarketId axis records only the markets we actually route here.
  readonly supportedMarkets: ReadonlyArray<MarketId> = ['dukascopy_forex'];
  readonly capabilities: ProviderCapabilities = {
    assetTypes: ['forex', 'crypto', 'stock', 'etf', 'index'],
    // TICKET_196_12 Step 1: Dukascopy CDN serves each timeframe pre-aggregated
    // natively (TICKET_328 switched it from 1m-base to native mode); mirrors
    // INTERVAL_MAP keys. A drift test pins nativeIntervals === Object.keys(INTERVAL_MAP).
    nativeIntervals: [INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_4h, INTERVAL_1d],
    // TICKET_196_12 Step 3: derived (native union aggregatable) -- not hand-written
    intervals: deriveSupportedIntervals([INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_4h, INTERVAL_1d]),
    requiresAuth: false,
    supportsSearch: true,
    // TICKET_849 Phase D3: FX trades ~23.5h x 5d/week. Pre-Phase-D3 the
    // orchestrator's `inferAssetClass('dukascopy')` returned 'fx', which
    // resolved to ratio=1.0 (the 1.4x weekend gap on intraday bars is
    // small enough to absorb without explicit padding). Preserve that.
    // calendarPaddingRatio omitted -> default 1.0.
    // TICKET_958_4: Dukascopy serves FX (Sun 22:00 UTC -> Fri 22:00 UTC).
    // FX_5_24 = "Mon-Fri are trading days" matches the day-set check;
    // intra-day session boundaries are not the invariant's concern.
    tradingCalendar: 'FX_5_24',
    // TICKET_958_5 AC #1: dukascopy-provider parses Dukascopy CDN binary
    // ticks and emits canonical rows (`timestamp` Unix seconds + OHLCV)
    // directly from TypeScript -- no Python script in the path.
    cacheSchema: 'OHLCV_V1_CANONICAL',
  };

  async queryOHLCV(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCVRow[]> {
    const dukasTimeframe = INTERVAL_MAP[interval];
    if (!dukasTimeframe) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unsupportedInterval', { provider: 'Dukascopy', interval, supported: Object.keys(INTERVAL_MAP).join(', ') }));
    }

    // TICKET_343: dukascopy-node requires lowercase instrument keys (e.g. 'eurusd')
    // but upstream layers may pass uppercase symbols for display consistency.
    const instrument = symbol.toLowerCase();

    appLog.info(`[DukascopyProvider] Querying ${instrument} ${dukasTimeframe} ${startDate} - ${endDate}`);

    const { getHistoricalRates } = await import('dukascopy-node');

    // dukascopy-node filters with `timestamp < endDateMs` (exclusive upper
    // bound). Our chunking passes [startDate, endDate] inclusive, so bump
    // the `to` date by one day to include endDate's bars in the result.
    const toDate = new Date(endDate + 'T00:00:00Z');
    toDate.setUTCDate(toDate.getUTCDate() + 1);

    // TICKET_342: dukascopy-node throws plain objects { validationErrors: [...] }
    // on validation failure instead of Error instances. Catch and convert at the
    // provider boundary so downstream code receives proper Error objects.
    //
    // TICKET_1097: dukascopy-node calls bare fetch() with no timeout. Wrap the
    // entire getHistoricalRates() in a race against AbortSignal.timeout() so a
    // hung CDN connection cannot deadlock the download queue.
    let data: Awaited<ReturnType<typeof getHistoricalRates>>;
    try {
      const ratesPromise = getHistoricalRates({
        instrument: instrument as Parameters<typeof getHistoricalRates>[0]['instrument'],
        dates: {
          from: new Date(startDate),
          to: toDate,
        },
        timeframe: dukasTimeframe as 'm1',
        format: 'json' as const,
        volumes: true,
        batchSize: BATCH_SIZE,
        pauseBetweenBatchesMs: PAUSE_BETWEEN_BATCHES_MS,
        retryCount: RETRY_COUNT,
        pauseBetweenRetriesMs: PAUSE_BETWEEN_RETRIES_MS,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.queryTimeout', { provider: 'Dukascopy', seconds: DUKASCOPY_QUERY_TIMEOUT_MS / 1000, symbol, interval, startDate, endDate }))),
          DUKASCOPY_QUERY_TIMEOUT_MS,
        );
      });

      data = await Promise.race([ratesPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof Error) {
        // TICKET_1074: dukascopy-node's BufferFetcher.fetchBuffer wraps
        // both network errors and missing CDN artifacts as
        // `new Error('Unknown error')`, discarding the original cause.
        // Node's native fetch throws `TypeError: fetch failed` on
        // ECONNRESET / ETIMEDOUT / DNS failures.  Enrich with symbol +
        // date context so the user can judge whether to retry or
        // whether the data simply doesn't exist for that range.
        if (isOpaqueError(err.message)) {
          throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.dataFetchFailed', { provider: 'Dukascopy', symbol, startDate, endDate, error: err.message }));
        }
        throw err;
      }
      if (typeof err === 'object' && err !== null && 'validationErrors' in err) {
        // dukascopy-node validationErrors are { message, expected, actual } objects
        const errors = (err as { validationErrors: Array<{ message?: string }> }).validationErrors;
        const messages = errors.map(e => e.message || 'Unknown validation error');
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.validationFailed', { provider: 'Dukascopy', errors: messages.join('; ') }));
      }
      throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
    }

    // dukascopy-node returns JSON format: { timestamp (ms), open, high, low, close, volume }
    // OHLCVRow requires timestamp in Unix seconds
    const rows: OHLCVRow[] = (data as Array<{
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>).map(bar => ({
      // TICKET_813: asEpochSeconds tags the unit at the provider
      // boundary. dukascopy-node emits ms; we floor-divide to
      // seconds to honour the IDataProvider contract, then brand.
      timestamp: asEpochSeconds(Math.floor(bar.timestamp / 1000)),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));

    appLog.info(`[DukascopyProvider] Total bars received: ${rows.length} for ${symbol} ${dukasTimeframe}`);
    return rows;
  }

  async searchSymbols(query: string, limit = 20): Promise<SymbolSearchResponse> {
    appLog.info(`[DukascopyProvider] Searching symbols: "${query}"`);

    const instruments = await getInstrumentCache();
    const upperQuery = query.toUpperCase();

    // TICKET_313 pattern: Relevance-sorted search (exact > prefix > contains > description-only)
    const rank = (entry: InstrumentEntry): number => {
      const nameUpper = entry.name.toUpperCase();
      const idUpper = entry.id.toUpperCase();
      if (idUpper === upperQuery || nameUpper === upperQuery) return 0;
      if (idUpper.startsWith(upperQuery) || nameUpper.startsWith(upperQuery)) return 1;
      if (idUpper.includes(upperQuery) || nameUpper.includes(upperQuery)) return 2;
      return 3; // description-only match
    };

    // TICKET_641_10: Compute all matches before slicing for totalCount
    const allMatches = instruments
      .filter(entry =>
        entry.id.toUpperCase().includes(upperQuery) ||
        entry.name.toUpperCase().includes(upperQuery) ||
        entry.description.toUpperCase().includes(upperQuery)
      )
      .sort((a, b) => {
        const diff = rank(a) - rank(b);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });

    const results = allMatches
      .slice(0, limit)
      .map(entry => ({
        symbol: entry.id.toUpperCase(),
        name: `${entry.name} - ${entry.description}`,
        type: entry.type,
      }));

    appLog.info(`[DukascopyProvider] Search returned ${results.length} of ${allMatches.length} results`);
    return {
      results,
      totalCount: allMatches.length,
      truncated: allMatches.length > limit,
    };
  }

  async getSymbolDateRange(symbol: string): Promise<{ startTime: string | null; endTime: string | null }> {
    appLog.info(`[DukascopyProvider] Getting date range for: ${symbol}`);

    const instruments = await getInstrumentCache();
    const lower = symbol.toLowerCase();
    const entry = instruments.find(e => e.id === lower);

    if (!entry) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.instrumentNotFound', { provider: 'Dukascopy', symbol }));
    }

    // endTime: yesterday (Dukascopy data has ~1 day lag)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const endTime = yesterday.toISOString().split('T')[0];

    appLog.info(`[DukascopyProvider] Date range for ${symbol}: ${entry.startDate} - ${endTime}`);
    return {
      startTime: entry.startDate,
      endTime,
    };
  }

  async checkConnection(): Promise<ProviderConnectionStatus> {
    try {
      appLog.info('[DukascopyProvider] Checking connection...');

      // TICKET_333: Lightweight HTTP probe to Dukascopy CDN instead of full data fetch.
      // Previous approach used getHistoricalRates() which took 15-38 seconds due to
      // binary artifact download + decompression. A simple HTTP GET to the CDN root
      // verifies reachability in <2 seconds.
      const probeStart = Date.now();

      const response = await fetch(DATA_API_BASE_DUKASCOPY, {
        method: 'GET',
      });

      const latencyMs = Date.now() - probeStart;

      if (response.ok || response.status === 403) {
        // 403 is expected (directory listing denied) -- CDN is reachable
        appLog.info(`[DukascopyProvider] Connection OK, latency: ${latencyMs}ms`);
        return { connected: true, latencyMs };
      }

      appLog.warn(`[DukascopyProvider] Connection FAILED: HTTP ${response.status}, latency: ${latencyMs}ms`);
      return {
        connected: false,
        error: `Dukascopy CDN returned HTTP ${response.status}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection check failed';
      appLog.warn(`[DukascopyProvider] Connection FAILED: ${msg}`);
      return {
        connected: false,
        error: msg,
      };
    }
  }

  /**
   * TICKET_880_4_1: List all available forex/crypto/stock symbols from Dukascopy.
   *
   * TICKET_880_4_5: Returns symbols sorted by trading relevance, not alphabetically.
   * Sort order: G10 forex majors -> other forex -> crypto -> indices -> stocks.
   * This ensures "top 50" gives users the most liquid forex pairs, not HK/JP stocks
   * that happen to start with numbers (alphabetically before letters).
   */
  async listSymbols(limit?: number): Promise<{ symbols: string[]; total: number }> {
    const instruments = await getInstrumentCache();

    // G10 major forex pairs in liquidity order (most traded first)
    const G10_MAJORS = [
      'eurusd', 'usdjpy', 'gbpusd', 'audusd', 'usdcad', 'usdchf', 'nzdusd',
      'eurjpy', 'eurgbp', 'eurchf', 'euraud', 'eurnzd', 'eurcad',
      'gbpjpy', 'gbpchf', 'gbpaud', 'gbpnzd', 'gbpcad',
      'audjpy', 'nzdjpy', 'cadjpy', 'chfjpy',
      'audnzd', 'audcad', 'audchf',
      'nzdcad', 'nzdchf',
      'cadchf',
    ];

    // Sort priority: G10 majors (fixed order) -> forex -> crypto -> index -> stock
    const sortKey = (entry: InstrumentEntry): [number, number | string] => {
      const majorIdx = G10_MAJORS.indexOf(entry.id);
      if (majorIdx >= 0) return [0, majorIdx];
      if (entry.type === 'forex') return [1, entry.id];
      if (entry.type === 'crypto') return [2, entry.id];
      if (entry.type === 'index') return [3, entry.id];
      return [4, entry.id]; // stock, etf
    };

    const sorted = [...instruments].sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (typeof ka[1] === 'number' && typeof kb[1] === 'number') return ka[1] - kb[1];
      return String(ka[1]).localeCompare(String(kb[1]));
    });

    const allSymbols = sorted.map(i => i.id.toUpperCase());
    const total = allSymbols.length;
    const symbols = limit && limit > 0 ? allSymbols.slice(0, limit) : allSymbols;
    appLog.info(`[DukascopyProvider] listSymbols: returning ${symbols.length} of ${total} symbols (sorted by relevance)`);
    return { symbols, total };
  }
}
