/**
 * TICKET_927_1_1: closed, additive-only set of markets the StratCraft
 * research / trading pipeline operates on. Coarser than ISO 10383 MIC
 * (XNAS+XNYS+XASE collapse into `alpaca_us_equity` because alpaca's
 * data feed unifies them) and finer than asset class
 * (`yfinance_us_equity` != `alpaca_us_equity` because the provider
 * domains differ for symbol coverage, splits, and dividends).
 *
 * The evidence base for this enum is the existing `PROVIDER_ASSET_CLASS`
 * map in `plugins/quant-lab-nexus/.../tool-sweep/universes.ts:193` and the
 * `UniverseSleeve.assetClass` field at `universes.ts:61`. Both today
 * carry the (provider, asset-class) tuple as `string`; this enum is the
 * typed promotion of that evidence to a Tier-0 type that every consumer
 * (apps/desktop, packages/executor, plugins/*) imports from a single
 * source of truth.
 *
 * Additive only: a new market is a typed migration, never a free-form
 * string. Removing a value is a breaking change that touches every
 * persisted `nona_signal.market_scope` row (handled at migration time,
 * see TICKET_927_1_2).
 *
 * Provider-prefixing is intentional: the same G10 FX symbol list comes
 * from yfinance, dukascopy, or a user's DuckDB import, and these are
 * NOT interchangeable substrates (TICKET_802: "the same universe means
 * different markets in different providers"). Asset-class-only would
 * silently merge non-interchangeable substrates.
 */
export const MARKET_IDS = [
  // US equities -- the provider domain matters (different symbol
  // universes, different corporate-action handling).
  'alpaca_us_equity',
  'yfinance_us_equity',
  'clickhouse_us_equity',
  // TICKET_958: Databento local-parquet US equity feed. Research-only
  // (gated at provider-manager registration); kept distinct from the
  // alpaca/yfinance/clickhouse US-equity markets because the symbol
  // coverage, corporate-action handling, and bar-construction (Databento
  // MBO -> 1-minute bars vs. consolidated tape) all differ.
  'databento_us_equity',

  // FX
  'dukascopy_forex',
  'yfinance_forex',           // synthetic =X tickers, lower fidelity

  // Crypto -- one MarketId per (CCXT, settlement-shape); per-exchange
  // granularity is a follow-up if liquidity / fee divergence demands it.
  'ccxt_spot',
  'ccxt_perp',
  'yfinance_synthetic_crypto',

  // CN A-share
  'baostock_cn_a_share',
  'tushare_cn_a_share',
  'akshare_cn_a_share',
] as const;

export type MarketId = typeof MARKET_IDS[number];

// TICKET_1095: dynamic MarketId for imported packages (BYOD).
export type DynamicMarketId = `byod_${string}`;
export type AnyMarketId = MarketId | DynamicMarketId;

export function isDynamicMarketId(value: unknown): value is DynamicMarketId {
  return typeof value === 'string' && value.startsWith('byod_');
}

/**
 * Type guard for runtime validation at IPC / DB / JSON boundaries.
 * Returns true iff `value` is one of the strings in `MARKET_IDS`.
 */
export function isMarketId(value: unknown): value is MarketId {
  return typeof value === 'string'
    && (MARKET_IDS as readonly string[]).includes(value);
}

export function isAnyMarketId(value: unknown): value is AnyMarketId {
  return isMarketId(value) || isDynamicMarketId(value);
}

// -- TICKET_970_9: asset-class equivalence for cross-provider portability --

export const ASSET_CLASSES = [
  'us_equity',
  'forex',
  'crypto',
  'cn_a_share',
] as const;

export type AssetClass = typeof ASSET_CLASSES[number];

export const MARKET_ASSET_CLASS: Readonly<Record<MarketId, AssetClass>> = {
  alpaca_us_equity:          'us_equity',
  yfinance_us_equity:        'us_equity',
  clickhouse_us_equity:      'us_equity',
  databento_us_equity:       'us_equity',
  dukascopy_forex:           'forex',
  yfinance_forex:            'forex',
  ccxt_spot:                 'crypto',
  ccxt_perp:                 'crypto',
  yfinance_synthetic_crypto: 'crypto',
  baostock_cn_a_share:       'cn_a_share',
  tushare_cn_a_share:        'cn_a_share',
  akshare_cn_a_share:        'cn_a_share',
};

// TICKET_1095: dynamic asset-class resolver for BYOD markets.
// Injected by the app layer at boot (after DataCacheManager init).
let _dynamicAssetClassResolver: ((market: string) => AssetClass | null) | null = null;

export function setDynamicAssetClassResolver(
  resolver: (market: string) => AssetClass | null,
): void {
  _dynamicAssetClassResolver = resolver;
}

export function assetClassOf(market: AnyMarketId): AssetClass {
  const static_ = MARKET_ASSET_CLASS[market as MarketId];
  if (static_) return static_;
  if (isDynamicMarketId(market)) {
    if (_dynamicAssetClassResolver) {
      const ac = _dynamicAssetClassResolver(market);
      if (ac) return ac;
    }
    // TICKET_1098: fallback for renderer-side callers where the dynamic
    // resolver is not available (it lives in the main process).  The
    // imported_packages.asset_class column stores one of the ASSET_CLASSES
    // values, and the package name IS the byod_ suffix.  When the package
    // name itself is a known asset class (e.g. `byod_forex` -> `forex`),
    // return it directly so that isMarketScopeCompatibleWithProvider can
    // resolve compatibility without the resolver.
    const pkgName = market.slice(5);
    if ((ASSET_CLASSES as readonly string[]).includes(pkgName)) {
      return pkgName as AssetClass;
    }
  }
  throw new Error(
    `TICKET_1095: no asset class for market '${market}'. ` +
    `If this is a BYOD market, ensure setDynamicAssetClassResolver() was called at boot.`,
  );
}

export function sameAssetClass(a: AnyMarketId, b: AnyMarketId): boolean {
  return assetClassOf(a) === assetClassOf(b);
}
