/**
 * Binance Funding-Rate / Open-Interest On-Chain Provider
 *
 * TICKET_568_5_1_c: First concrete `on_chain` IAlternativeDataProvider.
 * Sources two crypto-perp microstructure factors from the Binance USD-M
 * Futures public API via CCXT:
 *
 *   - `alt_on_chain_funding_rate`            -- 8-hour funding settlements
 *   - `alt_on_chain_open_interest_zscore`    -- rolling 30-day z-score of OI
 *
 * Why CCXT + Binance for the first on-chain provider:
 *   - **Free, no BYOK.** Both endpoints (`fundingRateHistory`,
 *     `openInterestHistory`) are anonymous-readable. Reuses the CCXT
 *     dependency already pinned in apps/desktop/package.json (^4.5.38).
 *   - **Honest PIT story.** Funding rates and OI samples are settled +
 *     timestamped by the exchange; the row IS the public record at that
 *     timestamp. `event_time = knowledge_time = settlement timestamp`.
 *     Binance never silently rewrites past funding-rate history; the
 *     `vintage_supported` declaration can be a truthful `true`.
 *   - **Aligned with TICKET_618 exchange-resolution pattern.** Binance
 *     class is `ccxt.binanceusdm` for USD-M perp (where funding lives).
 *
 * Per ticket Hard Contract:
 *   - source: 'on_chain'
 *   - vintage_supported: true (exchange settlements are immutable; the
 *     Risk-Matrix "vendor silently recomputes" hazard does not apply to
 *     raw exchange microstructure -- only to vendor-derived metrics like
 *     Glassnode's whale heuristics)
 *   - live_streaming_supported: true (polling at the 60s floor;
 *     funding settlements are 8h-cadence anyway, OI samples are 5m/15m)
 *
 * Symbol semantics: `params.symbol` MAY be a CCXT pair (`'BTC/USDT'`) or
 * a bare base (`'BTC'`). Bare-base inputs are normalized to `'<base>/USDT'`
 * because the dominant USD-quoted perp on Binance is `<base>/USDT`. The
 * `AlternativeFactorRow.symbol` we emit echoes the input -- callers that
 * passed a bare base get a bare base back, callers that passed a pair get
 * the pair back. This keeps downstream factor-library keying stable.
 *
 * @see docs/design/TICKET_568_5_1_c_SIGNAL_DISCOVERY_LAYER3_ON_CHAIN_PROVIDER.md
 */

import type {
  AlternativeDataRequest,
  AlternativeFactorRow,
} from '../../../../shared/types/signal-discovery';
import type { IAlternativeDataProvider } from './types';
import { appLog } from '../../../utils/logger';
import { INTERVAL_1h } from '../../../../shared/constants/intervals';

// =============================================================================
// Constants
// =============================================================================

/**
 * Provider id. Distinct from the data-provider id `'ccxt'` (which is the
 * spot/OHLCV crypto provider) so the two cannot collide in the registry.
 */
const PROVIDER_ID = 'binance-funding';

/**
 * Public factor names the provider knows how to fetch. The
 * `alt_on_chain_` prefix matches the `isAltDataSignalSource()` discriminator
 * in `apps/desktop/src/shared/constants/strategy-types.ts`.
 */
const FACTOR_FUNDING_RATE = 'alt_on_chain_funding_rate';
const FACTOR_OI_ZSCORE = 'alt_on_chain_open_interest_zscore';

/**
 * Open-Interest sampling timeframe. Binance offers 5m/15m/30m/1h/2h/4h/6h/
 * 12h/1d for `fapi/v1/openInterestHist`. 1h is the right resolution for a
 * rolling 30-day z-score (30*24 = 720 samples, well above the
 * "z-score is meaningful" threshold) without flooding the response.
 */
const OI_TIMEFRAME = INTERVAL_1h;

/**
 * Rolling window for the OI z-score, in samples. At `OI_TIMEFRAME = '1h'`
 * that is 30 days. Z-score = (x - mean(window)) / stddev(window).
 *
 * Window samples that don't yet have 30 days of preceding history are
 * dropped (we do not emit a z-score against a stub window -- the resulting
 * z would be statistically meaningless and would silently pollute Layer 3
 * factor evaluation).
 */
const OI_ZSCORE_WINDOW_SAMPLES = 24 * 30;

/**
 * Default HTTP request timeout. CCXT's binanceusdm endpoints respond well
 * under 5 s in practice; 30 s headroom matches the FRED + Marketaux posture.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Default live-polling cadence. Funding settles every 8 h; OI samples
 * every hour. 5-minute polling is the conservative shape that both factors
 * can share without exhausting the public rate limit (Binance fapi: 2400
 * weight/min; one OI page is weight 1, one funding-rate page weight 1).
 */
const DEFAULT_LIVE_POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Hard floor on live-poll cadence. Mirrors the FRED provider's 60 s floor
 * for protocol uniformity (the live engine treats all alt-data providers as
 * "poll at >= 60 s"). Binance would happily accept tighter polling but the
 * factors themselves are 1h/8h cadence -- anything tighter is wasted RPS.
 */
const MIN_LIVE_POLL_INTERVAL_MS = 60_000;

/**
 * Max rows per CCXT `fetchFundingRateHistory` / `fetchOpenInterestHistory`
 * page. Binance caps both at 1000; CCXT default is 100, so we pass `limit`
 * explicitly to cut request count by 10x on long backfills.
 */
const PAGE_LIMIT = 1000;

// =============================================================================
// CCXT response shapes (narrow projections of `unknown`)
// =============================================================================

/**
 * Single funding-rate record as returned by CCXT's unified
 * `fetchFundingRateHistory()`. Documented shape:
 *   https://docs.ccxt.com/#/?id=funding-rate-history
 *
 * `fundingRate` is a decimal fraction (e.g. 0.0001 = 0.01% per 8h).
 * `timestamp` is the funding-settlement epoch ms.
 */
interface CcxtFundingRateRecord {
  timestamp: number;
  fundingRate: number;
  symbol: string;
}

/**
 * Single open-interest record as returned by CCXT's unified
 * `fetchOpenInterestHistory()`. Documented shape:
 *   https://docs.ccxt.com/#/?id=open-interest-history
 *
 * `openInterestAmount` is the number of base-currency contracts
 * outstanding. We z-score that series, not the USD-notional one
 * (`openInterestValue`), because notional folds in the spot price and is
 * dominated by price-trend noise rather than the structural OI signal.
 */
interface CcxtOpenInterestRecord {
  timestamp: number;
  openInterestAmount: number;
  symbol: string;
}

/**
 * Minimal CCXT exchange surface we need. Typed by hand (not via
 * `import('ccxt').Exchange`) so the test seam doesn't depend on the ccxt
 * type package being installed in the test environment.
 */
export interface CcxtFundingExchange {
  fetchFundingRateHistory(
    symbol: string,
    since?: number,
    limit?: number,
    params?: Record<string, unknown>,
  ): Promise<CcxtFundingRateRecord[]>;
  fetchOpenInterestHistory(
    symbol: string,
    timeframe?: string,
    since?: number,
    limit?: number,
    params?: Record<string, unknown>,
  ): Promise<CcxtOpenInterestRecord[]>;
}

// =============================================================================
// Injection seam for tests
// =============================================================================

export type CcxtExchangeFactory = () => Promise<CcxtFundingExchange>;

export interface BinanceFundingProviderOptions {
  /** Override exchange factory for tests; defaults to lazy ccxt.binanceusdm. */
  exchangeFactory?: CcxtExchangeFactory;
  /** Override request timeout (ms). */
  requestTimeoutMs?: number;
}

// =============================================================================
// BinanceFundingRateProvider
// =============================================================================

export class BinanceFundingRateProvider implements IAlternativeDataProvider {
  readonly id = PROVIDER_ID;
  readonly name = 'Binance Perp Funding & Open Interest';
  readonly source = 'on_chain' as const;
  // Exchange settlements are immutable. Binance never rewrites past
  // funding-rate or OI history (the API is settlement-keyed; a re-org
  // would invalidate balances, not these series). Honest `true`.
  readonly vintage_supported = true;
  readonly live_streaming_supported = true;

  private readonly exchangeFactory: CcxtExchangeFactory;
  private readonly requestTimeoutMs: number;
  private exchange: CcxtFundingExchange | null = null;

  constructor(opts: BinanceFundingProviderOptions = {}) {
    this.exchangeFactory = opts.exchangeFactory ?? defaultExchangeFactory;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /**
   * Historical fetch. Dispatches on `factor_name`:
   *
   *   - `alt_on_chain_funding_rate`         -> raw 8h settlements
   *   - `alt_on_chain_open_interest_zscore` -> rolling 30-day z over 1h OI
   *
   * Symbol is required (on-chain factors are per-asset, never market-wide).
   * Bare-base inputs (`'BTC'`) are normalized to `'BTC/USDT'` for the CCXT
   * call; the emitted `AlternativeFactorRow.symbol` echoes the caller's
   * original input to keep factor-library keys stable.
   *
   * `vintage_as_of` is honored cheaply: the series is immutable, so the
   * vintage view IS just `event_time <= vintage_as_of` filtered down.
   */
  async fetchFactorData(params: AlternativeDataRequest): Promise<AlternativeFactorRow[]> {
    if (params.category !== 'on_chain') {
      throw new Error(
        `[BinanceFundingRateProvider] fetchFactorData: category must be 'on_chain' ` +
          `(got '${params.category}')`,
      );
    }
    if (!params.symbol) {
      throw new Error(
        `[BinanceFundingRateProvider] fetchFactorData: symbol is required ` +
          `(on-chain factors are per-asset; market-wide alt-data lives in other categories)`,
      );
    }
    if (params.factor_name !== FACTOR_FUNDING_RATE && params.factor_name !== FACTOR_OI_ZSCORE) {
      throw new Error(
        `[BinanceFundingRateProvider] unknown factor_name '${params.factor_name}'. ` +
          `Supported: '${FACTOR_FUNDING_RATE}', '${FACTOR_OI_ZSCORE}'.`,
      );
    }

    const exchange = await this.getExchange();
    const ccxtSymbol = normalizeToCcxtSymbol(params.symbol);
    const startMs = Date.parse(params.start_time);
    const endMs = Date.parse(params.end_time);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new Error(
        `[BinanceFundingRateProvider] invalid start_time/end_time: ` +
          `'${params.start_time}' / '${params.end_time}'`,
      );
    }
    if (endMs < startMs) {
      throw new Error(
        `[BinanceFundingRateProvider] end_time precedes start_time ` +
          `('${params.end_time}' < '${params.start_time}')`,
      );
    }

    let rows: AlternativeFactorRow[];
    if (params.factor_name === FACTOR_FUNDING_RATE) {
      rows = await this.fetchFundingRate({ exchange, ccxtSymbol, startMs, endMs, params });
    } else {
      rows = await this.fetchOpenInterestZscore({ exchange, ccxtSymbol, startMs, endMs, params });
    }

    if (params.vintage_as_of) {
      const vintageMs = Date.parse(params.vintage_as_of);
      if (Number.isFinite(vintageMs)) {
        rows = rows.filter((r) => Date.parse(r.knowledge_time) <= vintageMs);
      }
    }
    return rows;
  }

  /**
   * Start a live polling loop for one (symbol, factor_name) pair. On each
   * tick, refetches the window `[lastSeenEventTime, now]` and forwards
   * unseen rows to `onRow`. Returns a stop() function that cancels the
   * timer.
   *
   * Watermark dedup by `event_time` is sufficient here -- funding
   * settlements and OI samples have unique exchange-side timestamps;
   * unlike Marketaux, there is no "article uuid" reissue risk.
   */
  startLiveStream(
    params: AlternativeDataRequest,
    onRow: (row: AlternativeFactorRow) => void,
    onError: (err: Error) => void,
    pollIntervalMs: number = DEFAULT_LIVE_POLL_INTERVAL_MS,
  ): () => void {
    if (pollIntervalMs < MIN_LIVE_POLL_INTERVAL_MS) {
      throw new Error(
        `[BinanceFundingRateProvider] startLiveStream: pollIntervalMs must be >= ` +
          `${MIN_LIVE_POLL_INTERVAL_MS} (funding/OI cadence is 1h-8h; tighter polling wastes RPS)`,
      );
    }

    let lastSeenEventTime: string | null = null;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const startTime = lastSeenEventTime ?? params.start_time;
        const endTime = new Date().toISOString();
        const rows = await this.fetchFactorData({
          ...params,
          start_time: startTime,
          end_time: endTime,
          // Live mode -- no vintage pinning.
          vintage_as_of: undefined,
        });
        for (const row of rows) {
          if (lastSeenEventTime !== null && row.event_time <= lastSeenEventTime) {
            continue;
          }
          onRow(row);
        }
        if (rows.length > 0) {
          lastSeenEventTime = rows[rows.length - 1].event_time;
        }
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async getExchange(): Promise<CcxtFundingExchange> {
    if (this.exchange) return this.exchange;
    this.exchange = await this.exchangeFactory();
    return this.exchange;
  }

  /**
   * Funding-rate factor. One row per 8h settlement in [startMs, endMs].
   * CCXT pages by `since`; we advance the cursor with the last seen
   * timestamp + 1 ms until either the response is empty or we cross
   * `endMs`. `event_time = knowledge_time = funding settlement` --
   * funding rates are public the instant they settle, no further lag.
   */
  private async fetchFundingRate(args: {
    exchange: CcxtFundingExchange;
    ccxtSymbol: string;
    startMs: number;
    endMs: number;
    params: AlternativeDataRequest;
  }): Promise<AlternativeFactorRow[]> {
    const { exchange, ccxtSymbol, startMs, endMs, params } = args;
    const rows: AlternativeFactorRow[] = [];
    let cursor = startMs;
    // Guard against pathological pagination (vendor returns the same page
    // forever). PAGE_LIMIT=1000 samples per page; 30 pages = 30k samples;
    // funding is 1095/year per symbol, so 30 pages = ~27 years of history.
    const MAX_PAGES = 30;

    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.withTimeout(
        exchange.fetchFundingRateHistory(ccxtSymbol, cursor, PAGE_LIMIT),
      );
      if (!Array.isArray(batch) || batch.length === 0) break;

      for (const record of batch) {
        if (!Number.isFinite(record.timestamp) || !Number.isFinite(record.fundingRate)) continue;
        if (record.timestamp > endMs) {
          // Past the requested window -- early exit, but consume the rest
          // of the current batch so we don't re-fetch it.
          continue;
        }
        if (record.timestamp < startMs) continue;
        const iso = new Date(record.timestamp).toISOString();
        rows.push({
          category: 'on_chain',
          factor_name: params.factor_name,
          symbol: params.symbol,
          event_time: iso,
          knowledge_time: iso,
          value: record.fundingRate,
          source_provider: this.id,
        });
      }

      const lastTs = batch[batch.length - 1].timestamp;
      if (!Number.isFinite(lastTs) || lastTs >= endMs) break;
      // Advance cursor past the last seen timestamp to avoid an infinite
      // loop on a vendor that returns inclusive `since`.
      const nextCursor = lastTs + 1;
      if (nextCursor <= cursor) break;
      cursor = nextCursor;
    }

    rows.sort((a, b) => (a.event_time < b.event_time ? -1 : a.event_time > b.event_time ? 1 : 0));
    return rows;
  }

  /**
   * Open-interest z-score factor. We need OI_ZSCORE_WINDOW_SAMPLES of
   * lead-in BEFORE startMs to z-score the first emitted sample, so the
   * CCXT cursor starts `WINDOW * OI_TIMEFRAME_MS` earlier and we drop
   * pre-window rows after the rolling-stats pass.
   *
   * Rolling stats use the running-sum / running-sum-of-squares trick so
   * the loop is O(n) regardless of window size. Stddev floors at a tiny
   * epsilon to avoid divide-by-zero on flat windows (yields z=0, the
   * honest "no signal" answer; we never emit Infinity).
   */
  private async fetchOpenInterestZscore(args: {
    exchange: CcxtFundingExchange;
    ccxtSymbol: string;
    startMs: number;
    endMs: number;
    params: AlternativeDataRequest;
  }): Promise<AlternativeFactorRow[]> {
    const { exchange, ccxtSymbol, startMs, endMs, params } = args;

    // Lead-in window for the z-score. We need ~30 days of OI samples
    // BEFORE startMs to z-score the first in-window sample.
    const oneHourMs = 60 * 60 * 1000;
    const leadInMs = OI_ZSCORE_WINDOW_SAMPLES * oneHourMs;
    const fetchStartMs = Math.max(0, startMs - leadInMs);

    const raw: CcxtOpenInterestRecord[] = [];
    let cursor = fetchStartMs;
    const MAX_PAGES = 30; // 30 * 1000 = 30k samples = ~3.4 years at 1h
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.withTimeout(
        exchange.fetchOpenInterestHistory(ccxtSymbol, OI_TIMEFRAME, cursor, PAGE_LIMIT),
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const r of batch) {
        if (
          Number.isFinite(r.timestamp) &&
          Number.isFinite(r.openInterestAmount) &&
          r.timestamp <= endMs
        ) {
          raw.push(r);
        }
      }
      const lastTs = batch[batch.length - 1].timestamp;
      if (!Number.isFinite(lastTs) || lastTs >= endMs) break;
      const nextCursor = lastTs + 1;
      if (nextCursor <= cursor) break;
      cursor = nextCursor;
    }

    if (raw.length === 0) return [];

    // Deterministic ordering -- CCXT typically returns ASC but we don't rely on it.
    raw.sort((a, b) => a.timestamp - b.timestamp);

    // Running window stats. Drop the first WINDOW samples (no full lead-in
    // yet) and any sample that falls outside [startMs, endMs].
    const rows: AlternativeFactorRow[] = [];
    let sum = 0;
    let sumSq = 0;
    const buf: number[] = [];
    const EPSILON = 1e-12;
    for (const r of raw) {
      const x = r.openInterestAmount;
      buf.push(x);
      sum += x;
      sumSq += x * x;
      if (buf.length > OI_ZSCORE_WINDOW_SAMPLES) {
        const dropped = buf.shift()!;
        sum -= dropped;
        sumSq -= dropped * dropped;
      }
      if (buf.length < OI_ZSCORE_WINDOW_SAMPLES) continue; // warmup
      if (r.timestamp < startMs || r.timestamp > endMs) continue;
      const n = buf.length;
      const mean = sum / n;
      // Population variance (the window IS the entire population for the
      // z-score we're emitting -- no inferential statistics here).
      const variance = Math.max(0, sumSq / n - mean * mean);
      const stddev = Math.sqrt(variance);
      const z = stddev < EPSILON ? 0 : (x - mean) / stddev;
      const iso = new Date(r.timestamp).toISOString();
      rows.push({
        category: 'on_chain',
        factor_name: params.factor_name,
        symbol: params.symbol,
        event_time: iso,
        knowledge_time: iso,
        value: z,
        source_provider: this.id,
      });
    }
    return rows;
  }

  private async withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `[BinanceFundingRateProvider] CCXT call timed out after ${this.requestTimeoutMs} ms`,
            ),
          ),
        this.requestTimeoutMs,
      );
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Normalize the caller's symbol input to a CCXT pair string.
 *
 * Acceptable inputs:
 *   - bare base: `'BTC'`         -> `'BTC/USDT'`
 *   - CCXT pair: `'BTC/USDT'`    -> `'BTC/USDT'`
 *   - dashed pair: `'BTC-USDT'`  -> `'BTC/USDT'`
 *
 * On Binance USD-M, USDT-margined perps are the dominant series; defaulting
 * the quote to USDT lets the user pass a bare ticker and Just Get The Right
 * Series. Callers who want USDC-margined (`'BTC/USDC'`) pass the full pair.
 */
function normalizeToCcxtSymbol(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (trimmed.length === 0) {
    throw new Error('[BinanceFundingRateProvider] empty symbol');
  }
  if (trimmed.includes('/')) return trimmed;
  if (trimmed.includes('-')) return trimmed.replace('-', '/');
  return `${trimmed}/USDT`;
}

/**
 * Default CCXT factory. Lazy-imports `ccxt` so the module load cost stays
 * out of cold-startup. `binanceusdm` is the USD-M perp class (where
 * funding-rate + OI history endpoints live); the spot `binance` class
 * does NOT expose `fetchFundingRateHistory`.
 */
async function defaultExchangeFactory(): Promise<CcxtFundingExchange> {
  try {
    const ccxt = await import('ccxt');
    // `binanceusdm` is the USD-M futures CCXT class (separate from the spot
    // `binance` class). It exposes the unified funding-rate and
    // open-interest endpoints we depend on.
    const exchange = new ccxt.binanceusdm({ enableRateLimit: true });
    return exchange as unknown as CcxtFundingExchange;
  } catch (err) {
    appLog.error('[BinanceFundingRateProvider] failed to construct ccxt.binanceusdm:', err);
    throw new Error(
      `[BinanceFundingRateProvider] could not load CCXT binanceusdm client: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
