/**
 * Alpaca Data Provider
 *
 * DATA_001: Free US equities data (stocks, ETFs) via Alpaca Market Data API v2.
 * Aggregate-mode provider: fetches 1m base data, higher timeframes aggregated locally.
 *
 * Authentication: APCA-API-KEY-ID + APCA-API-SECRET-KEY stored via SecureCredentialService.
 * API: https://data.alpaca.markets/v2/stocks/{symbol}/bars
 * Pagination: next_page_token, max 10,000 bars/page.
 *
 * @see https://docs.alpaca.markets/reference/stockbars
 */

import Bottleneck from 'bottleneck';
import { IDataProvider, ProviderCapabilities, ProviderConnectionStatus, ProviderSymbolInfo, SymbolSearchResponse, OHLCVRow } from './types';
import type { MarketId } from '@StratCraft/types';
import {
  DATA_CREDENTIAL_KEYS,
  PROVIDER_ALPACA,
  DATA_API_BASE_ALPACA,
  DATA_API_BASE_ALPACA_LIVE,
  DATA_API_BASE_ALPACA_PAPER,
} from '@StratCraft/types';
import { deriveSupportedIntervals } from './interval-resolution';
import {
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m,
  INTERVAL_1h, INTERVAL_4h, INTERVAL_1d, INTERVAL_1w,
} from '../../../shared/constants/intervals';
import { getSecureCredentialService } from '../secure-credential-service';
import { appLog } from '../../utils/logger';
import { mainT } from '../../i18n/main-strings';
import { getCurrentMainLocale } from '../locale-service';
import {
  ALPACA_MAX_BARS_PER_PAGE,
  ALPACA_ASSET_CACHE_TTL_MS,
  ALPACA_FREE_TIER_REQUESTS_PER_MINUTE,
  ALPACA_RATE_LIMIT_SAFETY_MARGIN_PERCENT,
  ALPACA_RATE_LIMIT_MAX_CONCURRENT,
  ALPACA_RATE_LIMIT_REFRESH_INTERVAL_MS,
  ALPACA_RETRY_MAX_ATTEMPTS,
  ALPACA_RETRY_BACKOFF_FACTOR,
  ALPACA_RETRY_MIN_TIMEOUT_MS,
  ALPACA_RETRY_MAX_TIMEOUT_MS,
} from '../../../shared/constants/data-providers';
import { asEpochSeconds } from '../../../shared/types/epoch';

// =============================================================================
// Constants
// =============================================================================

const ALPACA_DATA_BASE_URL = DATA_API_BASE_ALPACA;
const ALPACA_TRADING_LIVE_URL = DATA_API_BASE_ALPACA_LIVE;
const ALPACA_TRADING_PAPER_URL = DATA_API_BASE_ALPACA_PAPER;
const PLUGIN_ID = 'com.stratcraft.back-test-nexus';
const KEY_ID_SECRET = DATA_CREDENTIAL_KEYS.ALPACA_API_KEY_ID;
const SECRET_KEY_SECRET = DATA_CREDENTIAL_KEYS.ALPACA_API_SECRET_KEY;
const MAX_BARS_PER_PAGE = ALPACA_MAX_BARS_PER_PAGE;

/** Map UI interval notation to Alpaca timeframe notation */
const INTERVAL_MAP: Record<string, string> = {
  [INTERVAL_1m]:  '1Min',
  [INTERVAL_5m]:  '5Min',
  [INTERVAL_15m]: '15Min',
  [INTERVAL_30m]: '30Min',
  [INTERVAL_1h]:  '1Hour',
  [INTERVAL_1d]:  '1Day',
};

// =============================================================================
// TICKET_834: Retry helpers
// =============================================================================
//
// NOTE on dependency choice (root cause for "Data provider 'alpaca' not found"
// regression, 2026-05-27): An earlier draft of TICKET_834 imported `p-retry`
// for the retry-with-backoff loop. `p-retry` >= 7 is published as pure ESM, and
// the Electron main process is bundled as CommonJS by webpack. At runtime the
// bundled chunk would `require('p-retry')` and Node would refuse with
// "require() of ES Module ... not supported", causing `registerProProviders()`
// to throw and Alpaca to silently fail registration. To remove the
// module-format mismatch at the root we inline the retry loop here -- no
// behavior change relative to the original p-retry options (retries / factor /
// minTimeout / maxTimeout / randomize jitter / onFailedAttempt hook / abort
// marker for permanent 4xx).

/**
 * Parse RFC 7231 section 7.1.3 `Retry-After` header into milliseconds.
 * Accepts either delta-seconds (e.g. "30") or an HTTP-date.
 * Returns `null` if the header is missing or unparseable.
 */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed === '') return null;

  // delta-seconds form: a non-negative integer
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  // HTTP-date form
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Marker class that signals "this error is permanent -- do not retry". The
 * wrapped `originalError` is unwrapped before being thrown to the caller, so
 * any custom fields on the underlying error (e.g. `status`) survive
 * propagation. Drop-in replacement for `p-retry`'s `AbortError`.
 */
class AbortError extends Error {
  readonly originalError: Error;
  constructor(originalError: Error) {
    super(originalError.message);
    this.name = 'AbortError';
    this.originalError = originalError;
  }
}

interface RetryOptions {
  retries: number;
  factor: number;
  minTimeout: number;
  maxTimeout: number;
  /** When true, multiply each backoff delay by a random factor in [0, 1). */
  randomize: boolean;
  /**
   * Called after every failed attempt that will NOT be the final one. Receives
   * an attempt context identical in shape to the subset of `p-retry`'s
   * onFailedAttempt context that the wrapper actually used (`error`,
   * `attemptNumber`, `retriesLeft`, `retryDelay`).
   *
   * If this hook awaits, the next attempt is delayed by exactly that wait
   * plus nothing else -- the backoff `retryDelay` is informational only.
   * (Matches the original wrapper's behavior: Retry-After is honored by
   * sleeping inside onFailedAttempt.)
   */
  onFailedAttempt?: (ctx: {
    error: Error;
    attemptNumber: number;
    retriesLeft: number;
    retryDelay: number;
  }) => Promise<void> | void;
}

/**
 * Inline retry-with-backoff loop. Identical semantics to the previous
 * `p-retry` call site:
 *   - Up to `retries + 1` total attempts.
 *   - Exponential backoff: minTimeout * factor^(attempt-1), clamped to maxTimeout.
 *   - Optional jitter: multiply by random in [0, 1) when `randomize` is true.
 *   - Permanent failures throw `AbortError(originalError)`; the wrapper
 *     unwraps and rethrows `originalError` immediately (no further attempts).
 *   - `onFailedAttempt` is invoked between attempts; if it awaits (e.g. to
 *     honor Retry-After) that delay replaces the backoff.
 */
async function retryWithBackoff<T>(
  fn: (attemptNumber: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { retries, factor, minTimeout, maxTimeout, randomize, onFailedAttempt } = options;
  const maxAttempts = retries + 1;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    try {
      return await fn(attemptNumber);
    } catch (rawErr) {
      // Permanent failure -> unwrap and rethrow originalError, no further attempts.
      if (rawErr instanceof AbortError) {
        throw rawErr.originalError;
      }

      const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr));
      const isFinalAttempt = attemptNumber >= maxAttempts;
      if (isFinalAttempt) {
        throw err;
      }

      // Exponential backoff with optional jitter. Computed up-front so the
      // value can be passed to onFailedAttempt for logging.
      let delay = Math.min(minTimeout * Math.pow(factor, attemptNumber - 1), maxTimeout);
      if (randomize) {
        delay = delay * Math.random();
      }
      delay = Math.max(0, Math.round(delay));

      const hookStart = Date.now();
      if (onFailedAttempt) {
        await onFailedAttempt({
          error: err,
          attemptNumber,
          retriesLeft: maxAttempts - attemptNumber,
          retryDelay: delay,
        });
      }
      const hookElapsed = Date.now() - hookStart;

      // If the hook already slept (Retry-After path), skip the backoff sleep
      // entirely -- the hook owns the inter-attempt delay in that case.
      // Otherwise sleep the computed backoff.
      if (hookElapsed < delay) {
        await sleep(delay - hookElapsed);
      }
    }
  }

  // Unreachable -- the loop either returns from `fn(...)` or throws above.
  throw new Error('retryWithBackoff: loop exited without resolution');
}

// Exported for tests (jitter / options regression guard).
export const __test = { AbortError, retryWithBackoff, parseRetryAfter };

// =============================================================================
// Asset Cache (symbol search)
// =============================================================================

interface AssetCacheEntry {
  assets: AlpacaAsset[];
  fetchedAt: number;
}

interface AlpacaAsset {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  asset_class: string;
  status: string;
  tradable: boolean;
}

const ASSET_CACHE_TTL_MS = ALPACA_ASSET_CACHE_TTL_MS;
let assetCache: AssetCacheEntry | null = null;

/** TICKET_311: In-memory cache for detected Alpaca key type (paper/live) */
let cachedKeyType: 'paper' | 'live' | null = null;

// =============================================================================
// AlpacaProvider
// =============================================================================

export class AlpacaProvider implements IDataProvider {
  readonly id = PROVIDER_ALPACA;
  readonly name = 'Alpaca Markets';
  // TICKET_927_2_2: Alpaca routes only US equity.
  readonly supportedMarkets: ReadonlyArray<MarketId> = ['alpaca_us_equity'];
  readonly capabilities: ProviderCapabilities = {
    assetTypes: ['stock', 'etf'],
    // TICKET_196_12 Step 1: the timeframes Alpaca's Market Data API serves
    // NATIVELY (mirrors INTERVAL_MAP keys). 2h/4h are NOT native -- they are
    // produced by aggregating 1m (baseInterval) via the aggregation service;
    // `resolveFetchPlan` derives that from this set. A drift test pins
    // nativeIntervals === Object.keys(INTERVAL_MAP).
    nativeIntervals: [INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_1d],
    // TICKET_196_12 Step 3: derived (native union aggregatable) -- not hand-written
    intervals: deriveSupportedIntervals([INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_1d]),
    // TICKET_638: Alpaca uses BYOK credentials (user provides own API key), not platform auth
    requiresAuth: false,
    supportsSearch: true,
    baseInterval: INTERVAL_1m,
    aggregationStrategy: 'standard',
    // TICKET_833: Token-bucket rate-limit declaration. Free-tier cap is
    // 200 req/min; paid tier is 10000 req/min and may be overridden at runtime.
    rateLimit: {
      requestsPerMinute: ALPACA_FREE_TIER_REQUESTS_PER_MINUTE,
      safetyMarginPercent: ALPACA_RATE_LIMIT_SAFETY_MARGIN_PERCENT,
      maxConcurrent: ALPACA_RATE_LIMIT_MAX_CONCURRENT,
    },
    // TICKET_958_4: Alpaca Market Data API serves US equities only
    // (`alpaca_us_equity` is the only supportedMarket); NYSE + Nasdaq
    // sessions are calendar-identical. Drives the write-boundary day-set
    // invariant and lazy-heal probe.
    tradingCalendar: 'NYSE',
    // TICKET_849 Phase D3: Alpaca serves US equity / ETF.
    // Intraday ratio = intraday_factor * daily_factor:
    //   intraday_factor = 24h / 6.5h RTH = 3.692...
    //   daily_factor    = 365 calendar days / 252 trading days = 1.448...
    //   combined        = (24 * 365) / (6.5 * 252) = 8760 / 1638 = 5.348...
    // Using 5.35 (rounds up to always over-fetch rather than under-fetch).
    // Daily bars only need the daily_factor (365/252 ~= 1.45); weekly bars span
    // full calendar weeks (1.0 -- no compression).
    calendarPaddingRatio: {
      [INTERVAL_1m]: 5.35, [INTERVAL_5m]: 5.35, [INTERVAL_15m]: 5.35, [INTERVAL_30m]: 5.35, [INTERVAL_1h]: 5.35, [INTERVAL_4h]: 5.35,
      [INTERVAL_1d]: 1.45, [INTERVAL_1w]: 1.0,
    },
    // TICKET_958_5 AC #1: AlpacaProvider parses the Alpaca Market Data API
    // JSON response and emits canonical rows (`timestamp` Unix seconds +
    // OHLCV) directly from TypeScript.
    cacheSchema: 'OHLCV_V1_CANONICAL',
  };

  /**
   * TICKET_833: Client-side token-bucket limiter that paces all outbound
   * Alpaca HTTP traffic below the upstream cap. Constructed from
   * `capabilities.rateLimit` so paid-tier upgrades are config-only.
   *
   * Reservoir = floor(requestsPerMinute * (1 - safetyMarginPercent/100)).
   * Refilled every 60s. `maxConcurrent` matches the ensureUniverse worker
   * pool * earliest/latest probe fan-out.
   */
  private readonly limiter: Bottleneck = (() => {
    const cfg = this.capabilities.rateLimit;
    if (!cfg) {
      throw new Error('AlpacaProvider: capabilities.rateLimit is required for TICKET_833 limiter');
    }
    const reservoir = Math.floor(cfg.requestsPerMinute * (1 - cfg.safetyMarginPercent / 100));
    return new Bottleneck({
      reservoir,
      reservoirRefreshAmount: reservoir,
      reservoirRefreshInterval: ALPACA_RATE_LIMIT_REFRESH_INTERVAL_MS,
      maxConcurrent: cfg.maxConcurrent,
      minTime: 0,
    });
  })();

  /**
   * TICKET_833: All outbound Alpaca HTTP traffic MUST flow through this
   * wrapper. Adding a `fetch(` call outside `limitedFetch` regresses the
   * 429-prevention guarantee.
   *
   * TICKET_834: Wraps the limiter-scheduled fetch with retry-with-backoff:
   * - 4xx (except 429) -> AbortError (no retry, permanent failure)
   * - 429 / 5xx       -> retry with exponential backoff + jitter
   * - Retry-After     -> server-suggested delay honored before next attempt
   *
   * Each retry attempt is itself scheduled through the limiter, so a retry
   * storm cannot bypass the rate cap (queues behind the reservoir refill
   * instead of firing past it).
   */
  private limitedFetch(input: string, init?: RequestInit): Promise<Response> {
    return retryWithBackoff(
      async () => {
        const response = await this.limiter.schedule(() => fetch(input, init));

        // Success -> done.
        if (response.ok) return response;

        // 4xx other than 429 are permanent client errors (bad key, no
        // entitlement, delisted symbol). Retrying will not fix them.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          const body = await response.text().catch(() => '');
          const message =
            response.status === 401 || response.status === 403
              ? mainT(getCurrentMainLocale(), 'errors', 'providers.authFailed', { provider: 'Alpaca' })
              : mainT(getCurrentMainLocale(), 'errors', 'providers.httpStatus', { provider: 'Alpaca', status: response.status, body });
          // retryWithBackoff's AbortError unwraps `originalError` to the
          // caller, so we attach the status to an Error instance passed into
          // AbortError -- that instance becomes originalError and the status
          // field survives propagation.
          const underlying = new Error(message) as Error & { status?: number };
          underlying.status = response.status;
          throw new AbortError(underlying);
        }

        // 429 / 5xx are transient. Throw a tagged error so onFailedAttempt
        // can honor Retry-After before the backoff timer kicks in.
        const body = await response.text().catch(() => '');
        const err = new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.httpStatus', { provider: 'Alpaca', status: response.status, body })) as Error & {
          status?: number;
          retryAfterMs?: number;
        };
        err.status = response.status;
        if (response.status === 429) {
          const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
          if (retryAfterMs !== null) {
            err.retryAfterMs = retryAfterMs;
          }
        }
        throw err;
      },
      {
        retries: ALPACA_RETRY_MAX_ATTEMPTS,
        factor: ALPACA_RETRY_BACKOFF_FACTOR,
        minTimeout: ALPACA_RETRY_MIN_TIMEOUT_MS,
        maxTimeout: ALPACA_RETRY_MAX_TIMEOUT_MS,
        // Jitter is MANDATORY (AWS Builders' Library). Without it, parallel
        // in-flight requests retry in lock-step and re-trip the limiter on
        // every cycle (thundering herd). Do not set to false.
        randomize: true,
        onFailedAttempt: async (ctx) => {
          const err = ctx.error as Error & { retryAfterMs?: number; status?: number };
          if (err.retryAfterMs !== undefined && err.retryAfterMs > 0) {
            // RFC 7231: respect server-suggested delay. Cap to maxTimeout so
            // a hostile server cannot stall us indefinitely.
            const sleepMs = Math.min(err.retryAfterMs, ALPACA_RETRY_MAX_TIMEOUT_MS);
            appLog.warn(
              `[AlpacaProvider] 429 Retry-After=${err.retryAfterMs}ms, sleeping ${sleepMs}ms ` +
              `before attempt ${ctx.attemptNumber + 1}`
            );
            await sleep(sleepMs);
          } else {
            appLog.warn(
              `[AlpacaProvider] Transient failure (status=${err.status ?? 'n/a'}): ` +
              `${err.message}. Attempt ${ctx.attemptNumber} of ${ALPACA_RETRY_MAX_ATTEMPTS + 1}, ` +
              `${ctx.retriesLeft} retries left, next backoff ~${ctx.retryDelay}ms`
            );
          }
        },
      }
    );
  }

  /**
   * Get Alpaca API credentials from SecureCredentialService.
   * @throws Error with actionable message if not configured
   */
  private async getCredentials(): Promise<{ keyId: string; secretKey: string }> {
    const credService = getSecureCredentialService();

    const keyIdResult = await credService.getSecret(PLUGIN_ID, KEY_ID_SECRET);
    const secretKeyResult = await credService.getSecret(PLUGIN_ID, SECRET_KEY_SECRET);

    if (!keyIdResult.value || !secretKeyResult.value) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.credentialsNotConfigured', { provider: 'Alpaca', keys: `${KEY_ID_SECRET} and ${SECRET_KEY_SECRET}` }));
    }

    return {
      keyId: keyIdResult.value,
      secretKey: secretKeyResult.value,
    };
  }

  /**
   * Build auth headers for Alpaca API requests.
   */
  private async buildHeaders(): Promise<Record<string, string>> {
    const { keyId, secretKey } = await this.getCredentials();
    return {
      'APCA-API-KEY-ID': keyId,
      'APCA-API-SECRET-KEY': secretKey,
      'Accept': 'application/json',
    };
  }

  /**
   * TICKET_311: Get the correct trading API base URL.
   * Auto-detects key type (paper/live) on first call and caches in memory.
   */
  private async getTradingBaseUrl(): Promise<string> {
    if (cachedKeyType) {
      return cachedKeyType === 'paper' ? ALPACA_TRADING_PAPER_URL : ALPACA_TRADING_LIVE_URL;
    }

    // Detect by probing both trading endpoints
    const headers = await this.buildHeaders();
    const probe = async (url: string): Promise<boolean> => {
      try {
        const resp = await this.limitedFetch(`${url}/account`, { method: 'GET', headers });
        return resp.ok;
      } catch {
        return false;
      }
    };

    if (await probe(ALPACA_TRADING_LIVE_URL)) {
      cachedKeyType = 'live';
      appLog.info('[AlpacaProvider] Key type detected: live');
      return ALPACA_TRADING_LIVE_URL;
    }

    if (await probe(ALPACA_TRADING_PAPER_URL)) {
      cachedKeyType = 'paper';
      appLog.info('[AlpacaProvider] Key type detected: paper');
      return ALPACA_TRADING_PAPER_URL;
    }

    throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.tradingApiUnreachable', { provider: 'Alpaca' }));
  }

  async queryOHLCV(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCVRow[]> {
    const alpacaTimeframe = INTERVAL_MAP[interval];
    if (!alpacaTimeframe) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unsupportedInterval', { provider: 'Alpaca', interval, supported: Object.keys(INTERVAL_MAP).join(', ') }));
    }

    appLog.info(`[AlpacaProvider] Querying ${symbol} ${alpacaTimeframe} ${startDate} - ${endDate}`);

    const headers = await this.buildHeaders();
    const allRows: OHLCVRow[] = [];
    let pageToken: string | undefined;

    // Paginated fetch loop
    do {
      const params = new URLSearchParams({
        start: startDate,
        end: endDate,
        timeframe: alpacaTimeframe,
        limit: String(MAX_BARS_PER_PAGE),
        adjustment: 'split',
        feed: 'iex',
        sort: 'asc',
      });
      if (pageToken) {
        params.set('page_token', pageToken);
      }

      const url = `${ALPACA_DATA_BASE_URL}/stocks/${encodeURIComponent(symbol)}/bars?${params.toString()}`;

      const response = await this.limitedFetch(url, { headers });

      if (!response.ok) {
        const errorBody = await response.text();
        if (response.status === 401 || response.status === 403) {
          throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.authFailed', { provider: 'Alpaca' }));
        }
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.apiError', { provider: 'Alpaca', status: response.status, body: errorBody }));
      }

      const data = await response.json() as {
        bars: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }> | null;
        next_page_token: string | null;
      };

      if (data.bars && data.bars.length > 0) {
        for (const bar of data.bars) {
          allRows.push({
            // TICKET_813: asEpochSeconds tags the unit at the
            // provider boundary. Math.floor(.../1000) yields a
            // raw number; the brand is what makes it
            // assignable to OHLCVRow.timestamp.
            timestamp: asEpochSeconds(Math.floor(new Date(bar.t).getTime() / 1000)),
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v,
          });
        }
      }

      pageToken = data.next_page_token || undefined;

      appLog.debug(`[AlpacaProvider] Page fetched: ${data.bars?.length || 0} bars, nextToken: ${pageToken ? 'yes' : 'no'}`);
    } while (pageToken);

    appLog.info(`[AlpacaProvider] Total bars received: ${allRows.length} for ${symbol} ${alpacaTimeframe}`);
    return allRows;
  }

  async searchSymbols(query: string, limit = 20): Promise<SymbolSearchResponse> {
    appLog.info(`[AlpacaProvider] Searching symbols: "${query}"`);

    const assets = await this.getAssets();
    const upperQuery = query.toUpperCase();

    // TICKET_313: Relevance-sorted search (exact > prefix > symbol-contains > name-only)
    const rank = (a: AlpacaAsset): number => {
      const sym = a.symbol.toUpperCase();
      if (sym === upperQuery) return 0;
      if (sym.startsWith(upperQuery)) return 1;
      if (sym.includes(upperQuery)) return 2;
      return 3; // name-only match
    };

    // TICKET_641_10: Compute all matches before slicing for totalCount
    const allMatches = assets
      .filter(a =>
        a.symbol.toUpperCase().includes(upperQuery) ||
        a.name.toUpperCase().includes(upperQuery)
      )
      .sort((a, b) => {
        const diff = rank(a) - rank(b);
        return diff !== 0 ? diff : a.symbol.localeCompare(b.symbol);
      });

    const results = allMatches
      .slice(0, limit)
      .map(a => ({
        symbol: a.symbol,
        name: a.name,
        type: 'stock' as const,
        exchange: a.exchange,
      }));

    appLog.info(`[AlpacaProvider] Search returned ${results.length} of ${allMatches.length} results`);
    return {
      results,
      totalCount: allMatches.length,
      truncated: allMatches.length > limit,
    };
  }

  async getSymbolDateRange(symbol: string): Promise<{ startTime: string | null; endTime: string | null }> {
    appLog.info(`[AlpacaProvider] Getting date range for: ${symbol}`);

    const headers = await this.buildHeaders();

    // Boundary probe: earliest bar
    const earliestParams = new URLSearchParams({
      start: '2015-01-01T00:00:00Z',
      timeframe: '1Day',
      limit: '1',
      sort: 'asc',
    });
    const earliestUrl = `${ALPACA_DATA_BASE_URL}/stocks/${encodeURIComponent(symbol)}/bars?${earliestParams.toString()}`;

    // Boundary probe: latest bar (TICKET_312: must include start to avoid empty current-day default)
    const latestParams = new URLSearchParams({
      start: '2015-01-01T00:00:00Z',
      timeframe: '1Day',
      limit: '1',
      sort: 'desc',
    });
    const latestUrl = `${ALPACA_DATA_BASE_URL}/stocks/${encodeURIComponent(symbol)}/bars?${latestParams.toString()}`;

    const [earliestResp, latestResp] = await Promise.all([
      this.limitedFetch(earliestUrl, { headers }),
      this.limitedFetch(latestUrl, { headers }),
    ]);

    if (!earliestResp.ok || !latestResp.ok) {
      const failedStatus = !earliestResp.ok ? earliestResp.status : latestResp.status;
      if (failedStatus === 401 || failedStatus === 403) {
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.authFailed', { provider: 'Alpaca' }));
      }
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.dateRangeProbeFailed', { provider: 'Alpaca', status: failedStatus, symbol }));
    }

    const earliestData = await earliestResp.json() as { bars: Array<{ t: string }> | null };
    const latestData = await latestResp.json() as { bars: Array<{ t: string }> | null };

    const startTime = earliestData.bars?.[0]?.t?.split('T')[0] || null;
    const endTime = latestData.bars?.[0]?.t?.split('T')[0] || null;

    appLog.info(`[AlpacaProvider] Date range for ${symbol}: ${startTime} - ${endTime}`);
    return { startTime, endTime };
  }

  async checkConnection(): Promise<ProviderConnectionStatus> {
    appLog.info('[AlpacaProvider] Checking connection...');
    try {
      const headers = await this.buildHeaders();
      const params = new URLSearchParams({
        timeframe: '1Day',
        limit: '1',
        sort: 'desc',
      });
      const url = `${ALPACA_DATA_BASE_URL}/stocks/SPY/bars?${params.toString()}`;

      const probeStart = Date.now();
      // TICKET_834: limitedFetch now throws (AbortError for 4xx non-429,
      // regular Error after retries exhausted for 429/5xx). Only success
      // paths return here.
      const response = await this.limitedFetch(url, { headers });
      const latencyMs = Date.now() - probeStart;

      appLog.info(`[AlpacaProvider] Connection OK, latency: ${latencyMs}ms`);
      // TICKET_311: Return in-memory cached key type if available
      return { connected: true, latencyMs, keyType: cachedKeyType || undefined };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection check failed';
      const status = (error as { status?: number } | undefined)?.status;
      // TICKET_588 + TICKET_834: Distinguish credential-missing, auth-failed,
      // and network errors. The HTTP status (when present) is the
      // authoritative signal; fall back to message inspection for the
      // pre-HTTP "credentials not configured" path raised by getCredentials.
      let reason: 'not-configured' | 'auth-failed' | 'network';
      if (msg.includes('not configured') || msg.includes('credentialsNotConfigured')) {
        reason = 'not-configured';
      } else if (status === 401 || status === 403) {
        reason = 'auth-failed';
      } else {
        reason = 'network';
      }
      appLog.error(`[AlpacaProvider] Connection check error (reason=${reason}, status=${status ?? 'n/a'}): ${msg}`);
      return {
        connected: false,
        error: msg,
        reason,
      };
    }
  }

  /**
   * TICKET_880_4_1: List all available symbols from Alpaca.
   * Returns US equity symbols in Alpaca's default order (typically large-caps first).
   */
  async listSymbols(limit?: number): Promise<{ symbols: string[]; total: number }> {
    const assets = await this.getAssets();
    const allSymbols = assets.map(a => a.symbol);
    const total = allSymbols.length;
    const symbols = limit && limit > 0 ? allSymbols.slice(0, limit) : allSymbols;
    appLog.info(`[AlpacaProvider] listSymbols: returning ${symbols.length} of ${total} symbols`);
    return { symbols, total };
  }

  /**
   * Fetch all active US equity assets with in-memory cache (1h TTL).
   */
  private async getAssets(): Promise<AlpacaAsset[]> {
    if (assetCache && (Date.now() - assetCache.fetchedAt) < ASSET_CACHE_TTL_MS) {
      return assetCache.assets;
    }

    appLog.info('[AlpacaProvider] Fetching asset list from Alpaca...');
    const headers = await this.buildHeaders();
    const tradingBaseUrl = await this.getTradingBaseUrl();

    const params = new URLSearchParams({
      status: 'active',
      asset_class: 'us_equity',
    });
    const url = `${tradingBaseUrl}/assets?${params.toString()}`;

    const response = await this.limitedFetch(url, { headers });

    if (!response.ok) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.assetListFetchFailed', { provider: 'Alpaca', status: response.status }));
    }

    const assets = await response.json() as AlpacaAsset[];

    // Filter to tradable assets only
    const filtered = assets.filter(a => a.tradable && a.status === 'active');

    assetCache = {
      assets: filtered,
      fetchedAt: Date.now(),
    };

    appLog.info(`[AlpacaProvider] Cached ${filtered.length} active US equity assets`);
    return filtered;
  }
}
