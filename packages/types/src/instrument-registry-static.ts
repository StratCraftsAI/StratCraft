import { MARKET_IDS, MarketId, AnyMarketId, DynamicMarketId, isDynamicMarketId, assetClassOf, AssetClass } from './market-id';
import { InstrumentRegistry } from './instrument-registry';
import type { Currency } from './currency';
import {
  PROVIDER_YFINANCE, PROVIDER_ALPACA, PROVIDER_CLICKHOUSE, PROVIDER_DATABENTO,
  PROVIDER_DUKASCOPY, PROVIDER_CCXT, PROVIDER_BAOSTOCK, PROVIDER_AKSHARE,
  PROVIDER_TUSHARE,
} from './data-provider-id';

/**
 * TICKET_927_1_1: v1 in-memory `InstrumentRegistry` impl.
 *
 * Resolution strategy per provider:
 *
 *   - yfinance     -- US equity / synthetic FX (`=X`) / synthetic crypto (`-USD`).
 *   - alpaca       -- all -> `alpaca_us_equity`.
 *   - clickhouse   -- all -> `clickhouse_us_equity`.
 *   - dukascopy    -- all -> `dukascopy_forex`.
 *   - ccxt         -- `BASE/QUOTE:SETTLE` -> `ccxt_perp`; `BASE/QUOTE` -> `ccxt_spot`.
 *   - baostock/akshare/tushare -- respective `*_cn_a_share`.
 *   - imported packages (BYOD) -- dynamic `byod_{packageName}` (TICKET_1095).
 */
export class StaticInstrumentRegistry implements InstrumentRegistry {
  private readonly providersByMarket: Map<MarketId, string[]>;
  private importedPackageNames: Set<string> = new Set();

  constructor() {
    this.providersByMarket = buildProvidersByMarket();
  }

  setImportedPackageNames(names: Set<string>): void {
    this.importedPackageNames = names;
  }

  marketOf(symbol: string, providerId: string): AnyMarketId | null {
    if (typeof symbol !== 'string' || symbol.length === 0) return null;
    if (typeof providerId !== 'string' || providerId.length === 0) return null;

    const id = providerId.toLowerCase();
    switch (id) {
      case PROVIDER_YFINANCE:
        return resolveYfinance(symbol);
      case PROVIDER_ALPACA:
        return 'alpaca_us_equity';
      case PROVIDER_CLICKHOUSE:
        return 'clickhouse_us_equity';
      case PROVIDER_DATABENTO:
        return 'databento_us_equity';
      case PROVIDER_DUKASCOPY:
        return 'dukascopy_forex';
      case PROVIDER_CCXT:
        return resolveCcxt(symbol);
      case PROVIDER_BAOSTOCK:
        return 'baostock_cn_a_share';
      case PROVIDER_AKSHARE:
        return 'akshare_cn_a_share';
      case PROVIDER_TUSHARE:
        return 'tushare_cn_a_share';
      default:
        // TICKET_1095: imported packages use free-text package names.
        if (this.importedPackageNames.has(id) || this.importedPackageNames.has(providerId)) {
          return `byod_${id}` as DynamicMarketId;
        }
        return null;
    }
  }

  marketOfUnqualified(symbol: string): MarketId | null {
    if (typeof symbol !== 'string' || symbol.length === 0) return null;

    // CCXT pair shape is globally unambiguous in the enum: nothing else
    // uses `/`. This is the one cleanly-disambiguable family.
    if (symbol.includes('/')) {
      return resolveCcxt(symbol);
    }

    // Every other shape is ambiguous (e.g. `EURUSD` could be dukascopy
    // or a user's import; `EURUSD=X` is yfinance-specific; bare `AAPL`
    // could be alpaca, yfinance, or clickhouse). Return null -- callers
    // must obtain provider context (TICKET_858).
    return null;
  }

  marketsOfSymbolList(symbols: ReadonlyArray<string>, providerId: string): Set<AnyMarketId> {
    const out = new Set<AnyMarketId>();
    for (const sym of symbols) {
      const m = this.marketOf(sym, providerId);
      if (m !== null) out.add(m);
    }
    return out;
  }

  providersFor(market: AnyMarketId): ReadonlyArray<string> {
    if (isDynamicMarketId(market)) {
      const pkgName = market.slice(5);
      if (this.importedPackageNames.has(pkgName)) return [pkgName];
      return [];
    }
    return this.providersByMarket.get(market as MarketId) ?? [];
  }

  quoteCurrencyForMarket(market: AnyMarketId): Currency {
    const ccy = MARKET_QUOTE_CURRENCY[market as MarketId];
    if (ccy !== undefined) return ccy;
    if (isDynamicMarketId(market)) {
      const ac = assetClassOf(market);
      return BYOD_QUOTE_CURRENCY_BY_ASSET_CLASS[ac] ?? 'USD';
    }
    throw new Error(
      `TICKET_927_1_4_F: no quote currency mapped for MarketId '${market}'.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Per-provider resolution helpers.
// ---------------------------------------------------------------------------

function resolveYfinance(symbol: string): MarketId | null {
  if (symbol.endsWith('=X')) return 'yfinance_forex';
  if (/-USD[T]?$/.test(symbol)) return 'yfinance_synthetic_crypto';
  return 'yfinance_us_equity';
}

function resolveCcxt(symbol: string): MarketId | null {
  if (!symbol.includes('/')) return null;
  return symbol.includes(':') ? 'ccxt_perp' : 'ccxt_spot';
}

/**
 * Reverse map: MarketId -> ordered list of providers that can serve it.
 */
function buildProvidersByMarket(): Map<MarketId, string[]> {
  const m = new Map<MarketId, string[]>();
  for (const id of MARKET_IDS) m.set(id, []);

  m.get('alpaca_us_equity')!.push(PROVIDER_ALPACA);
  m.get('yfinance_us_equity')!.push(PROVIDER_YFINANCE);
  m.get('clickhouse_us_equity')!.push(PROVIDER_CLICKHOUSE);
  m.get('databento_us_equity')!.push(PROVIDER_DATABENTO);

  m.get('dukascopy_forex')!.push(PROVIDER_DUKASCOPY);
  m.get('yfinance_forex')!.push(PROVIDER_YFINANCE);

  m.get('ccxt_spot')!.push(PROVIDER_CCXT);
  m.get('ccxt_perp')!.push(PROVIDER_CCXT);
  m.get('yfinance_synthetic_crypto')!.push(PROVIDER_YFINANCE);

  m.get('baostock_cn_a_share')!.push(PROVIDER_BAOSTOCK);
  m.get('tushare_cn_a_share')!.push(PROVIDER_TUSHARE);
  m.get('akshare_cn_a_share')!.push(PROVIDER_AKSHARE);

  return m;
}

const MARKET_QUOTE_CURRENCY: Record<MarketId, Currency> = {
  alpaca_us_equity: 'USD',
  yfinance_us_equity: 'USD',
  clickhouse_us_equity: 'USD',
  databento_us_equity: 'USD',
  dukascopy_forex: 'USD',
  yfinance_forex: 'USD',
  ccxt_spot: 'USD',
  ccxt_perp: 'USD',
  yfinance_synthetic_crypto: 'USD',
  baostock_cn_a_share: 'CNY',
  tushare_cn_a_share: 'CNY',
  akshare_cn_a_share: 'CNY',
};

const BYOD_QUOTE_CURRENCY_BY_ASSET_CLASS: Readonly<Record<AssetClass, Currency>> = {
  us_equity: 'USD',
  forex: 'USD',
  crypto: 'USD',
  cn_a_share: 'CNY',
};

export const staticInstrumentRegistry = new StaticInstrumentRegistry();
