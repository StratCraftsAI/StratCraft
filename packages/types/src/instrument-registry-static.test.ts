import { describe, it, expect } from 'vitest';
import { StaticInstrumentRegistry, staticInstrumentRegistry } from './instrument-registry-static';
import { MARKET_IDS, type MarketId, type AnyMarketId } from './market-id';

// Symbol fixtures mirrored from
// `plugins/quant-lab-nexus/.../tool-sweep/universes.ts` so the registry
// stays grounded in the existing curated universes (TICKET_854).
const SP500_SAMPLE = ['AAPL', 'MSFT', 'NVDA', 'BRK.B', 'GOOGL', 'BF.B'];
const G10_FX_YFINANCE = ['EURUSD=X', 'USDJPY=X', 'GBPUSD=X'];
const G10_FX_DUKASCOPY = ['EURUSD', 'USDJPY', 'GBPUSD'];
const CRYPTO_CCXT_SPOT = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
const CRYPTO_CCXT_PERP = ['BTC/USDT:USDT', 'ETH/USDT:USDT'];
const YFINANCE_SYNTHETIC_CRYPTO = ['BTC-USD', 'ETH-USD'];
const US_SECTOR_ETFS = ['XLC', 'XLY', 'XLF', 'XLK'];

describe('TICKET_927_1_1 StaticInstrumentRegistry', () => {
  const reg = new StaticInstrumentRegistry();

  describe('singleton', () => {
    it('exports a default instance', () => {
      expect(staticInstrumentRegistry).toBeDefined();
      // The singleton must behave identically to a fresh construction.
      expect(staticInstrumentRegistry.marketOf('AAPL', 'alpaca'))
        .toBe('alpaca_us_equity');
    });
  });

  describe('marketOf -- yfinance', () => {
    it('routes US equity tickers to yfinance_us_equity', () => {
      for (const s of SP500_SAMPLE) {
        expect(reg.marketOf(s, 'yfinance')).toBe('yfinance_us_equity');
      }
    });

    it('routes US sector ETFs to yfinance_us_equity', () => {
      for (const s of US_SECTOR_ETFS) {
        expect(reg.marketOf(s, 'yfinance')).toBe('yfinance_us_equity');
      }
    });

    it('routes =X synthetic FX to yfinance_forex', () => {
      for (const s of G10_FX_YFINANCE) {
        expect(reg.marketOf(s, 'yfinance')).toBe('yfinance_forex');
      }
    });

    it('routes -USD / -USDT synthetic crypto to yfinance_synthetic_crypto', () => {
      for (const s of YFINANCE_SYNTHETIC_CRYPTO) {
        expect(reg.marketOf(s, 'yfinance')).toBe('yfinance_synthetic_crypto');
      }
      expect(reg.marketOf('BTC-USDT', 'yfinance')).toBe('yfinance_synthetic_crypto');
    });
  });

  describe('marketOf -- alpaca / clickhouse', () => {
    it('routes any symbol to alpaca_us_equity for alpaca', () => {
      for (const s of SP500_SAMPLE) {
        expect(reg.marketOf(s, 'alpaca')).toBe('alpaca_us_equity');
      }
    });

    it('routes any symbol to clickhouse_us_equity for clickhouse', () => {
      expect(reg.marketOf('AAPL', 'clickhouse')).toBe('clickhouse_us_equity');
    });
  });

  describe('marketOf -- dukascopy', () => {
    it('routes G10 FX pairs to dukascopy_forex', () => {
      for (const s of G10_FX_DUKASCOPY) {
        expect(reg.marketOf(s, 'dukascopy')).toBe('dukascopy_forex');
      }
    });
  });

  describe('marketOf -- ccxt', () => {
    it('routes BASE/QUOTE pairs to ccxt_spot', () => {
      for (const s of CRYPTO_CCXT_SPOT) {
        expect(reg.marketOf(s, 'ccxt')).toBe('ccxt_spot');
      }
    });

    it('routes BASE/QUOTE:SETTLE pairs to ccxt_perp', () => {
      for (const s of CRYPTO_CCXT_PERP) {
        expect(reg.marketOf(s, 'ccxt')).toBe('ccxt_perp');
      }
    });

    it('returns null for a non-CCXT symbol shape under ccxt', () => {
      expect(reg.marketOf('AAPL', 'ccxt')).toBeNull();
    });
  });

  describe('marketOf -- CN A-share providers', () => {
    it('routes any symbol to baostock_cn_a_share for baostock', () => {
      expect(reg.marketOf('sh.600000', 'baostock')).toBe('baostock_cn_a_share');
    });

    it('routes any symbol to akshare_cn_a_share for akshare', () => {
      expect(reg.marketOf('600000', 'akshare')).toBe('akshare_cn_a_share');
    });

    it('routes any symbol to tushare_cn_a_share for tushare', () => {
      expect(reg.marketOf('600000.SH', 'tushare')).toBe('tushare_cn_a_share');
    });
  });

  describe('marketOf -- BYOD imported packages (TICKET_1095)', () => {
    it('routes to byod_{name} when package name is registered', () => {
      const byodReg = new StaticInstrumentRegistry();
      byodReg.setImportedPackageNames(new Set(['forex', 'my_data']));
      expect(byodReg.marketOf('EURUSD', 'forex')).toBe('byod_forex');
      expect(byodReg.marketOf('AAPL', 'my_data')).toBe('byod_my_data');
    });

    it('returns null for unregistered package names', () => {
      const byodReg = new StaticInstrumentRegistry();
      expect(byodReg.marketOf('EURUSD', 'unknown_pkg')).toBeNull();
    });

    it('is case-insensitive on providerId', () => {
      const byodReg = new StaticInstrumentRegistry();
      byodReg.setImportedPackageNames(new Set(['my_data']));
      expect(byodReg.marketOf('AAPL', 'My_Data')).toBe('byod_my_data');
    });
  });

  describe('marketOf -- defensive paths', () => {
    it('returns null for an unknown provider', () => {
      expect(reg.marketOf('AAPL', 'no_such_provider')).toBeNull();
    });

    it('returns null for empty/non-string symbol', () => {
      expect(reg.marketOf('', 'yfinance')).toBeNull();
      expect(reg.marketOf(undefined as unknown as string, 'yfinance')).toBeNull();
    });

    it('returns null for empty/non-string providerId', () => {
      expect(reg.marketOf('AAPL', '')).toBeNull();
      expect(reg.marketOf('AAPL', undefined as unknown as string)).toBeNull();
    });

    it('is case-insensitive on providerId', () => {
      expect(reg.marketOf('AAPL', 'Alpaca')).toBe('alpaca_us_equity');
      expect(reg.marketOf('AAPL', 'YFINANCE')).toBe('yfinance_us_equity');
    });
  });

  describe('marketOfUnqualified', () => {
    it('resolves CCXT pair shapes (globally unambiguous in v1)', () => {
      expect(reg.marketOfUnqualified('BTC/USDT')).toBe('ccxt_spot');
      expect(reg.marketOfUnqualified('BTC/USDT:USDT')).toBe('ccxt_perp');
    });

    it('returns null for ambiguous bare equity tickers', () => {
      // AAPL could be alpaca, yfinance, or clickhouse -- caller must
      // pass provider context (TICKET_858).
      expect(reg.marketOfUnqualified('AAPL')).toBeNull();
    });

    it('returns null for ambiguous bare FX pairs', () => {
      // EURUSD could be dukascopy or user-imported via duckdb.
      expect(reg.marketOfUnqualified('EURUSD')).toBeNull();
    });

    it('returns null for the yfinance =X shape (provider-bound)', () => {
      // Even though `=X` is yfinance-specific in our enum, the
      // resolver refuses to assume context-free; callers MUST pass
      // provider id.
      expect(reg.marketOfUnqualified('EURUSD=X')).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(reg.marketOfUnqualified('')).toBeNull();
    });
  });

  describe('marketsOfSymbolList', () => {
    it('returns {yfinance_us_equity} for a single-asset US-equity list', () => {
      const m = reg.marketsOfSymbolList(SP500_SAMPLE, 'yfinance');
      expect(m).toEqual(new Set(['yfinance_us_equity']));
    });

    it('returns {dukascopy_forex} for a dukascopy FX list', () => {
      const m = reg.marketsOfSymbolList(G10_FX_DUKASCOPY, 'dukascopy');
      expect(m).toEqual(new Set(['dukascopy_forex']));
    });

    it('returns {ccxt_spot, ccxt_perp} for a mixed CCXT list', () => {
      const m = reg.marketsOfSymbolList(
        [...CRYPTO_CCXT_SPOT, ...CRYPTO_CCXT_PERP],
        'ccxt',
      );
      expect(m).toEqual(new Set(['ccxt_spot', 'ccxt_perp']));
    });

    it('spans equity + FX + crypto when a yfinance list mixes shapes', () => {
      const mixed = [...SP500_SAMPLE, ...G10_FX_YFINANCE, ...YFINANCE_SYNTHETIC_CRYPTO];
      const m = reg.marketsOfSymbolList(mixed, 'yfinance');
      expect(m).toEqual(new Set([
        'yfinance_us_equity',
        'yfinance_forex',
        'yfinance_synthetic_crypto',
      ]));
    });

    it('drops symbols that do not resolve under the given provider', () => {
      // 'AAPL' under 'ccxt' is unresolvable; the FX list should drop.
      const m = reg.marketsOfSymbolList(['AAPL', 'BTC/USDT'], 'ccxt');
      expect(m).toEqual(new Set(['ccxt_spot']));
    });

    it('returns an empty set for an empty input list', () => {
      expect(reg.marketsOfSymbolList([], 'yfinance')).toEqual(new Set());
    });
  });

  describe('providersFor', () => {
    it('lists alpaca first for alpaca_us_equity', () => {
      expect(reg.providersFor('alpaca_us_equity')).toEqual(['alpaca']);
    });

    it('lists yfinance for yfinance_us_equity', () => {
      expect(reg.providersFor('yfinance_us_equity')).toEqual(['yfinance']);
    });

    it('lists dukascopy for dukascopy_forex', () => {
      expect(reg.providersFor('dukascopy_forex')).toEqual(['dukascopy']);
    });

    it('lists package name for a dynamic BYOD market', () => {
      const byodReg = new StaticInstrumentRegistry();
      byodReg.setImportedPackageNames(new Set(['forex']));
      expect(byodReg.providersFor('byod_forex' as AnyMarketId)).toEqual(['forex']);
    });

    it('returns empty for unknown dynamic market', () => {
      expect(reg.providersFor('byod_unknown' as AnyMarketId)).toEqual([]);
    });

    it('lists ccxt for both ccxt_spot and ccxt_perp', () => {
      expect(reg.providersFor('ccxt_spot')).toEqual(['ccxt']);
      expect(reg.providersFor('ccxt_perp')).toEqual(['ccxt']);
    });

    it('covers every MarketId in MARKET_IDS', () => {
      for (const id of MARKET_IDS) {
        const providers = reg.providersFor(id);
        expect(providers.length).toBeGreaterThan(0);
      }
    });

    it('returns an empty list for an unknown MarketId', () => {
      // Cast to bypass the type guard -- exercises the default branch.
      expect(reg.providersFor('no_such_market' as MarketId)).toEqual([]);
    });
  });
});
