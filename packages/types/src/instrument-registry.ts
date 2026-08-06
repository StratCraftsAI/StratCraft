import { MarketId, AnyMarketId } from './market-id';
import type { Currency } from './currency';

/**
 * TICKET_927_1_1: the single source of truth that resolves
 * `symbol -> MarketId`. Used by:
 *   - fusion trunk: "is this `(symbol, ts)` cell inside the signal's scope?"
 *   - readiness gate (TICKET_927_2): "which provider serves this symbol?"
 *   - replay router: "which book does this fill belong to?"
 *
 * The resolver is provider-aware because the same string can mean
 * different markets in different providers (yfinance `EURUSD=X` in
 * `yfinance_forex`; dukascopy `EUR/USD` in `dukascopy_forex`).
 * Callers MUST pass the provider context they obtained the symbol from
 * whenever it is known. The "context-free" overload
 * (`marketOfUnqualified`) exists only for cases where the symbol shape
 * is globally unambiguous (e.g. CCXT `BTC/USDT:USDT` is unambiguously
 * `ccxt_perp`).
 *
 * TICKET_1095: return type widened to `AnyMarketId` to support dynamic
 * BYOD markets (`byod_*`).
 */
export interface InstrumentRegistry {
  marketOf(symbol: string, providerId: string): AnyMarketId | null;

  marketOfUnqualified(symbol: string): MarketId | null;

  marketsOfSymbolList(symbols: ReadonlyArray<string>, providerId: string): Set<AnyMarketId>;

  providersFor(market: AnyMarketId): ReadonlyArray<string>;

  quoteCurrencyForMarket(market: AnyMarketId): Currency;
}
