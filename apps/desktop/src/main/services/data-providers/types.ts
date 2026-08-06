/**
 * Multi-Source Data Provider Interface
 *
 * TICKET_292: Unified interface for data providers (ClickHouse, yfinance, OpenBB, CCXT).
 * All providers output OHLCVRow[] -- downstream Parquet cache and Executor are source-agnostic.
 *
 * @see TICKET_292_MULTI_SOURCE_DATA_PROVIDER_INTERFACE.md
 */

import { OHLCVRow } from '../parquet-cache-service';
import type { MarketId } from '@StratCraft/types'; // TICKET_927_2_2 / TICKET_927_1_1
import type { ArchivalCadence } from '../../../shared/constants/data-import'; // TICKET_958_2
import type { TradingCalendarId } from '../../../shared/calendars/trading-calendars'; // TICKET_958_4

// Re-export for convenience
export type { OHLCVRow } from '../parquet-cache-service';

/**
 * TICKET_958_5 -- canonical on-disk OHLCV cache schema identifier.
 *
 * The single closed enum every provider declares via
 * `capabilities.cacheSchema`. A provider that declares
 * `OHLCV_V1_CANONICAL` is contractually bound to produce parquet rows
 * that round-trip through `OHLCV_SCHEMA`
 * (`apps/desktop/src/main/services/ohlcv-parquet-schema.ts`) without
 * any column rename at the cache write boundary:
 *
 *   columns:   timestamp, open, high, low, close, volume   (in this order)
 *   types:     INT64,     DOUBLE x5
 *   timestamp: Unix seconds (NOT milliseconds, NOT nanoseconds)
 *
 * The gate's SQL (`countOhlcvParquetRowsInWindow` ->
 * `WHERE "timestamp" >= ? AND "timestamp" < ?`) depends on the
 * timestamp column name and unit. A provider whose
 * upstream parquet uses a different column name (Databento's
 * `__index_level_0__`, yfinance's `Datetime`, etc.) MUST rename and
 * unit-convert inside its `queryOHLCV` (or its Python script) so the
 * canonical writer never sees a non-canonical row.
 *
 * Forward-compatible: future schema extensions (e.g. adding `vwap` /
 * `bar_count`) land as additional enum values (`OHLCV_V2_CANONICAL`),
 * NOT as per-provider schema forks. Any new canonical writer
 * paired with a new enum value.
 */
export type CacheSchemaId = 'OHLCV_V1_CANONICAL';

/**
 * Symbol information returned by provider search
 */
export interface ProviderSymbolInfo {
  symbol: string;
  name: string;
  type: 'forex' | 'stock' | 'crypto' | 'etf' | 'index';
  exchange?: string;
  /** TICKET_305 Phase 2: Data availability start time (ISO date string) */
  startTime?: string;
  /** TICKET_305 Phase 2: Data availability end time (ISO date string) */
  endTime?: string;
}

/**
 * TICKET_641_10: Symbol search response with truncation metadata.
 * In-memory providers compute totalCount from full match set.
 * Remote/delegated providers (ClickHouse, yfinance, baostock) cannot know
 * total server-side matches, so they report truncated: false.
 */
export interface SymbolSearchResponse {
  results: ProviderSymbolInfo[];
  totalCount: number;
  truncated: boolean;
}

/**
 * Provider connection status
 */
export interface ProviderConnectionStatus {
  connected: boolean;
  latencyMs?: number;
  error?: string;
  /** TICKET_588: Failure reason for status differentiation */
  reason?: 'not-configured' | 'auth-failed' | 'network';
  /** TICKET_311: Alpaca key type detected during connection check */
  keyType?: 'paper' | 'live';
}

/**
 * TICKET_833: Upstream rate-limit declaration used by client-side token-bucket
 * limiters (e.g. Bottleneck). Providers that omit this field are not paced.
 *
 * Effective per-minute budget = floor(requestsPerMinute * (1 - safetyMarginPercent/100)).
 * Safety margin absorbs (a) rolling vs fixed-window discrepancies on the upstream
 * bucket, (b) retry traffic, (c) clock drift.
 */
export interface ProviderRateLimitConfig {
  /** Upstream advertised cap, in requests per minute */
  requestsPerMinute: number;
  /** Headroom % to reserve below the upstream cap (e.g. 10 = use 90% of cap) */
  safetyMarginPercent: number;
  /** Optional cap on simultaneously-in-flight requests */
  maxConcurrent?: number;
}

/**
 * Provider capability flags
 */
export interface ProviderCapabilities {
  /** Supported asset types */
  assetTypes: ReadonlyArray<'forex' | 'stock' | 'crypto' | 'etf' | 'index'>;
  /**
   * TICKET_196_12 Step 1: the set of intervals the provider's upstream API
   * serves NATIVELY -- i.e. without any local aggregation. This is the ONLY
   * hand-authored interval datum per provider; everything else (the derived
   * `intervals` capability list, the native-vs-aggregate-vs-unsupported fetch
   * decision) is computed from this by `resolveFetchPlan`
   * (`interval-resolution.ts`).
   *
   * MUST be a subset of the provider's `INTERVAL_MAP` keys (the actual upstream
   * mapping); a drift test pins this per provider. Values are central-map
   * interval strings exactly as accepted by `queryOHLCV(interval)`.
   */
  nativeIntervals: readonly string[];
  /** Supported intervals (e.g. ['1m','5m','1h','1d']) */
  intervals: string[];
  /** Maximum historical lookback per interval (e.g. { '1m': '7d' }) */
  maxLookback?: Record<string, string>;
  /** Whether provider requires authentication */
  requiresAuth: boolean;
  /** Whether provider supports symbol search */
  supportsSearch: boolean;
  /** Base interval for aggregate-mode providers (e.g. '1m'). undefined = native mode */
  baseInterval?: string;
  /** Aggregation strategy name. Default: 'standard' */
  aggregationStrategy?: string;
  /** TICKET_833: Upstream rate-limit declaration (drives client-side limiter) */
  rateLimit?: ProviderRateLimitConfig;
  /**
   * TICKET_849 Phase D3: per-timeframe calendar-padding ratio used to convert
   * "N market bars" into a calendar-time pull window. Equity providers (yfinance,
   * alpaca, baostock, equity-tier clickhouse) report ~3.4x on intraday (RTH ~ 6.5h
   * of 24h) and ~1.4x on daily (~252 trading days of 365). Crypto / FX providers
   * trade 24/7 and report 1.0 (or omit the field; the default is 1.0).
   *
   * Providers self-declare so the discovery orchestrator no longer needs to
   * reverse-map "provider id string -> asset class" via the deleted
   * `inferAssetClass` heuristic. A future provider with a non-standard calendar
   * (e.g. a Japan-equity feed with ~5h RTH and golden-week holidays) declares
   * its own ratio and inherits the same `pullBarsToCalendarMs` plumbing.
   *
   * Keys: timeframe strings exactly as accepted by `queryOHLCV(interval)`.
   * Missing keys fall back to ratio 1.0 (no inflation). Always 1.0 means the
   * provider may safely omit the field entirely.
   */
  calendarPaddingRatio?: Readonly<Record<string, number>>;
  /**
   * TICKET_958_2: declared publisher release schedule for built-in providers
   * that ship a snapshot / archive parquet dump rather than a live API.
   *
   * Mirrors `ImportedPackageRecord.archivalCadence` (TICKET_919_10) and
   * routes through the SAME `resolveArchivalCadenceEndMs` helper so the
   * window-end-resolution invariant is held in a single layer
   * (TICKET_860 single owning layer, TICKET_854 code reuse).
   *
   * Semantics:
   *   - field OMITTED                 -> treated as `'realtime'` (live
   *                                      provider, bit-exact today's
   *                                      `Date.now()` anchor)
   *   - `'realtime'`                  -> same as omitted
   *   - `'snapshot'`                  -> cohort-tail IS the truth
   *                                      (Databento today; future quarter-
   *                                      end vendor dumps)
   *   - `'monthly_archive'` /
   *     `'weekly_archive'` /
   *     `'daily_eod'`                 -> floor cohort upper-quantile to
   *                                      the cadence's last completed
   *                                      publication boundary
   *
   * Composition with `imported_packages` rows: the user's explicit
   * `imported_packages` declaration ALWAYS wins over this default
   * (see `DataCacheManager.resolveArchivalCadenceEndMsFor`); this field
   * supplies the default for providers that never appear in
   * `imported_packages` (the built-in singletons created by
   * `DataProviderManager.registerBuiltins`).
   *
   * Live providers (yfinance / Alpaca / CCXT / Dukascopy / Baostock /
   * AKShare / Tushare / ClickHouse) MUST omit the field; the default
   * preserves their existing behaviour bit-exact.
   */
  archivalCadence?: ArchivalCadence;
  /**
   * TICKET_958_4 -- trading calendar this provider's OHLCV stream follows.
   *
   * Drives the write-boundary day-set invariant
   * (`assertNoMissingTradingDays`) and the read-path lazy-heal probe
   * (`assessTradingDayGap`). Two binary jobs:
   *
   *   1. Write boundary -- after `fetchRange` completes its chunk loop,
   *      we enumerate the expected trading days under this calendar for
   *      the requested window and refuse to commit a parquet that is
   *      missing any of them. A provider that drops a boundary day at
   *      a chunk seam (TICKET_958_3 Finding 10) fails here, not on the
   *      next read.
   *   2. Cache hit -- when a cache row's endpoints cover the requested
   *      window, we enumerate the expected trading days between
   *      `actualFirstTimestamp` and `actualLastTimestamp` and route the
   *      row through `healInteriorGap` if any are missing. This
   *      back-fills pre-958_4 caches on the first request that touches
   *      them, then becomes a no-op.
   *
   * Closed enum: `NYSE`, `XSHG_XSHE`, `CRYPTO_24_7`, `FX_5_24`, `NONE`.
   * Unknown values throw at `register()` time
   * (`assertKnownTradingCalendar` -- TICKET_857 fail-fast). Adding a new
   * calendar requires extending `TradingCalendarId` AND (for JSON-backed
   * calendars) shipping the data file under
   * `apps/desktop/src/shared/calendars/data/`.
   *
   * `NONE` short-circuits both invariants -- use it ONLY for
   * imported-package providers (the user-imported file is authoritative)
   * or for providers with non-standard calendars not yet enumerated.
   * Choosing `NONE` to silence a failure is a TICKET_851 workaround;
   * extend the enum instead.
   *
   * MUST be declared (no default). Omitting the field is a build error
   * (the type system enforces this via the non-optional declaration).
   */
  tradingCalendar: TradingCalendarId;
  /**
   * TICKET_958_5 -- on-disk OHLCV cache schema this provider commits.
   *
   * Single closed enum (`CacheSchemaId`); the only value today is
   * `OHLCV_V1_CANONICAL`. Declaration is a contract: the rows this
   * provider returns from `queryOHLCV` MUST round-trip through the
   * canonical writer (`OHLCV_SCHEMA`) without any column rename or
   * unit conversion at the cache write boundary.
   *
   * Why it lives on the provider, not the writer: the writer already
   * enforces the schema mechanically (parquetjs rejects rows that do
   * not match the declared columns). The capability declaration is
   * the *promise* by the provider that its `queryOHLCV` output is
   * already canonical -- so a future investigator chasing "which
   * column is `timestamp` here?" has one answer for every provider
   * instead of one answer per script. The cross-provider
   * canonical-roundtrip test (TICKET_958_5 AC #3) iterates this field
   * to drive its fixtures.
   *
   * MUST be declared (no default). Omitting the field is a build
   * error (the type system enforces this via the non-optional
   * declaration).
   */
  cacheSchema: CacheSchemaId;
}

/**
 * Universal data provider interface.
 *
 * Every data source (ClickHouse, yfinance, OpenBB, CCXT) must implement
 * this interface. The ONLY output contract is OHLCVRow[] -- downstream
 * Parquet cache and Executor are completely source-agnostic.
 */
export interface IDataProvider {
  /** Unique provider identifier: 'clickhouse' | 'yfinance' | 'openbb' | 'ccxt' */
  readonly id: string;

  /** Human-readable display name */
  readonly name: string;

  /** Provider capability declaration */
  readonly capabilities: ProviderCapabilities;

  /**
   * TICKET_927_2_2: closed set of MarketIds this provider can serve.
   *
   * MUST be non-empty (runtime-checked at `register()` time -- empty array
   * is a build bug and fails fast at boot per TICKET_857). Every element
   * MUST be a value in `MARKET_IDS` (TICKET_927_1_1); invalid values are
   * also rejected at `register()` time.
   *
   * MAY overlap with another provider's `supportedMarkets` -- the manager
   * resolves overlap via the per-market user preference set under
   * `data.providerPreference.<MarketId>`; absent preference falls back to
   * registration order. See `DataProviderManager.resolveProvidersForMarket`.
   *
   * Narrower than `capabilities.assetTypes`: `assetTypes` is the
   * coarse-grained asset-class axis kept for legacy UI grouping;
   * `supportedMarkets` is the closed, routing-authoritative `MarketId`
   * axis used by every downstream consumer (Signal Picker, readiness
   * gate, readiness service).
   */
  readonly supportedMarkets: ReadonlyArray<MarketId>;

  /**
   * Query OHLCV data.
   *
   * MUST return data sorted by timestamp ASC.
   * MUST normalize column names to { timestamp, open, high, low, close, volume }.
   * timestamp MUST be Unix seconds (not milliseconds).
   *
   * @throws Error with actionable message on failure
   */
  queryOHLCV(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCVRow[]>;

  /**
   * Search symbols by query string.
   * Returns empty array if provider does not support search.
   */
  searchSymbols(query: string, limit?: number): Promise<SymbolSearchResponse>;

  /**
   * Check provider connectivity and readiness.
   */
  checkConnection(): Promise<ProviderConnectionStatus>;

  /**
   * TICKET_305 Phase 2: Get data availability date range for a symbol.
   * Returns earliest and latest available dates.
   * Optional -- providers that do not support this return undefined.
   */
  getSymbolDateRange?(symbol: string): Promise<{ startTime: string | null; endTime: string | null }>;

  /**
   * TICKET_880_4_1: List all available symbols from this provider.
   * Returns symbols in provider's default order (typically by market cap / liquidity).
   * Optional -- providers that do not support this return undefined.
   *
   * @param limit Maximum number of symbols to return (for slider UI)
   * @returns Array of symbol strings, total count available
   */
  listSymbols?(limit?: number): Promise<{ symbols: string[]; total: number }>;
}
