/**
 * Data Provider Constants
 *
 * TICKET_476: Magic Number Elimination
 * TICKET_179: Unified Constants Management
 *
 * Constants for data provider batch sizes, timeouts, and limits.
 */

// =============================================================================
// Dukascopy Provider
// =============================================================================

/** Dukascopy CDN batch size (concurrent downloads) */
export const DUKASCOPY_BATCH_SIZE = 5;

/** Pause between Dukascopy batches (ms) */
export const DUKASCOPY_BATCH_PAUSE_MS = 1500;

/** Dukascopy retry count for transient CDN failures */
export const DUKASCOPY_RETRY_COUNT = 3;

/** Pause between Dukascopy retries (ms) */
export const DUKASCOPY_RETRY_PAUSE_MS = 1000;

/**
 * TICKET_1097: Per-queryOHLCV timeout (ms).
 * dukascopy-node calls bare fetch() with no timeout — if the CDN drops the
 * TCP connection silently, the call hangs forever. This timeout wraps the
 * entire getHistoricalRates() call. 120s is generous: a 23-year 5m chunk
 * generates ~8,000 URLs fetched in batches of 5 with 1.5s pauses = ~40min
 * theoretical max, but each chunk (after DataCacheManager chunking) covers
 * at most a few months, so 120s is ample.
 */
export const DUKASCOPY_QUERY_TIMEOUT_MS = 120_000;

// =============================================================================
// Python Script Providers (BaoStock, YFinance)
// =============================================================================

/** Python script execution timeout (ms) */
export const PYTHON_SCRIPT_EXEC_TIMEOUT_MS = 60000;

/** Python script stdout max buffer (50MB) */
export const PYTHON_SCRIPT_MAX_BUFFER = 50 * 1024 * 1024;

// =============================================================================
// Download Queue
// =============================================================================

/** Maximum concurrent data downloads */
export const DATA_DOWNLOAD_MAX_CONCURRENT = 2;

// =============================================================================
// CCXT Provider
// =============================================================================

/** CCXT max candles per fetchOHLCV request (Binance limit) */
export const CCXT_MAX_CANDLES_PER_REQUEST = 1000;

// =============================================================================
// Alpaca Provider
// =============================================================================

/** Alpaca max bars per page (API pagination limit) */
export const ALPACA_MAX_BARS_PER_PAGE = 10000;

/** Alpaca asset list cache TTL - 1 hour (ms) */
export const ALPACA_ASSET_CACHE_TTL_MS = 3600000;

/**
 * TICKET_833: Alpaca free-tier published cap (req/min).
 * Paid-tier users override via settings to 10000.
 */
export const ALPACA_FREE_TIER_REQUESTS_PER_MINUTE = 200;

/**
 * TICKET_833: Safety margin (%) below the upstream cap.
 * 10% absorbs rolling-window discrepancy + retry traffic (TICKET_834) + clock drift.
 */
export const ALPACA_RATE_LIMIT_SAFETY_MARGIN_PERCENT = 10;

/**
 * TICKET_833: Max in-flight requests against Alpaca.
 * ensureUniverse (data-storage-service.ts) uses a 4-worker concurrent pool;
 * each worker may have 2 in-flight probes (earliest + latest in
 * getSymbolDateRange). 4 * 2 = 8 matches the upstream concurrency budget.
 */
export const ALPACA_RATE_LIMIT_MAX_CONCURRENT = 8;

/** TICKET_833: Reservoir refresh interval (ms). Alpaca cap is a per-minute bucket. */
export const ALPACA_RATE_LIMIT_REFRESH_INTERVAL_MS = 60_000;

/**
 * TICKET_834: Max retry attempts for transient Alpaca failures (429 / 5xx).
 * AWS SDK default is 3, Stripe is 2, Octokit is 3. 5 gives extra margin for
 * the rate-limited scenario where the first 2-3 retries may also hit the cap.
 */
export const ALPACA_RETRY_MAX_ATTEMPTS = 5;

/** TICKET_834: Exponential backoff factor. Classic 2x doubling. */
export const ALPACA_RETRY_BACKOFF_FACTOR = 2;

/** TICKET_834: Base delay before first retry (ms). */
export const ALPACA_RETRY_MIN_TIMEOUT_MS = 500;

/**
 * TICKET_834: Cap on retry delay (ms). With factor=2 and base=500ms, the
 * sequence is 500, 1000, 2000, 4000, 8000, 16000, capped at 30000.
 * Total worst-case delay = ~62s + 5 RTTs.
 */
export const ALPACA_RETRY_MAX_TIMEOUT_MS = 30_000;
