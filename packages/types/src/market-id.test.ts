import { describe, it, expect } from 'vitest';
import {
  MARKET_IDS, isMarketId,
  ASSET_CLASSES, MARKET_ASSET_CLASS, assetClassOf, sameAssetClass,
  isDynamicMarketId, isAnyMarketId, setDynamicAssetClassResolver,
  type MarketId, type DynamicMarketId, type AnyMarketId,
} from './market-id';

describe('TICKET_927_1_1 MarketId', () => {
  describe('MARKET_IDS', () => {
    it('contains all v1 markets without duplicates', () => {
      const set = new Set(MARKET_IDS);
      expect(set.size).toBe(MARKET_IDS.length);
    });

    it('contains the three US equity markets', () => {
      expect(MARKET_IDS).toContain('alpaca_us_equity');
      expect(MARKET_IDS).toContain('yfinance_us_equity');
      expect(MARKET_IDS).toContain('clickhouse_us_equity');
    });

    it('contains the two FX markets (duckdb_import_forex removed by TICKET_1095)', () => {
      expect(MARKET_IDS).toContain('dukascopy_forex');
      expect(MARKET_IDS).toContain('yfinance_forex');
      expect(MARKET_IDS).not.toContain('duckdb_import_forex');
    });

    it('contains the three crypto markets', () => {
      expect(MARKET_IDS).toContain('ccxt_spot');
      expect(MARKET_IDS).toContain('ccxt_perp');
      expect(MARKET_IDS).toContain('yfinance_synthetic_crypto');
    });

    it('contains the three CN A-share markets', () => {
      expect(MARKET_IDS).toContain('baostock_cn_a_share');
      expect(MARKET_IDS).toContain('tushare_cn_a_share');
      expect(MARKET_IDS).toContain('akshare_cn_a_share');
    });
  });

  describe('isMarketId', () => {
    it('accepts every value in MARKET_IDS', () => {
      for (const id of MARKET_IDS) {
        expect(isMarketId(id)).toBe(true);
      }
    });

    it('rejects the empty string', () => {
      expect(isMarketId('')).toBe(false);
    });

    it('rejects undefined and null', () => {
      expect(isMarketId(undefined)).toBe(false);
      expect(isMarketId(null)).toBe(false);
    });

    it('rejects non-string types', () => {
      expect(isMarketId(0)).toBe(false);
      expect(isMarketId(1)).toBe(false);
      expect(isMarketId({})).toBe(false);
      expect(isMarketId([])).toBe(false);
      expect(isMarketId(true)).toBe(false);
    });

    it('rejects typos (case-sensitive)', () => {
      expect(isMarketId('Alpaca_US_Equity')).toBe(false);
      expect(isMarketId('ALPACA_US_EQUITY')).toBe(false);
      expect(isMarketId('alpaca_us_equities')).toBe(false);
    });

    it('rejects near-misses (asset class alone, not provider-prefixed)', () => {
      // The whole point of root cause #1: 'forex' is not a MarketId.
      expect(isMarketId('forex')).toBe(false);
      expect(isMarketId('fx')).toBe(false);
      expect(isMarketId('us_equity')).toBe(false);
      expect(isMarketId('stock')).toBe(false);
      expect(isMarketId('crypto')).toBe(false);
      expect(isMarketId('cn_a_share')).toBe(false);
    });

    it('rejects provider ids on their own', () => {
      expect(isMarketId('yfinance')).toBe(false);
      expect(isMarketId('alpaca')).toBe(false);
      expect(isMarketId('ccxt')).toBe(false);
    });
  });
});

describe('TICKET_970_9: asset-class equivalence', () => {
  describe('MARKET_ASSET_CLASS completeness', () => {
    it('every MarketId has an asset class', () => {
      for (const id of MARKET_IDS) {
        expect(MARKET_ASSET_CLASS[id]).toBeDefined();
        expect(ASSET_CLASSES).toContain(MARKET_ASSET_CLASS[id]);
      }
    });

    it('no orphan keys (every key in the map is a valid MarketId)', () => {
      for (const key of Object.keys(MARKET_ASSET_CLASS)) {
        expect(isMarketId(key)).toBe(true);
      }
    });
  });

  describe('assetClassOf', () => {
    it('US equity providers all resolve to us_equity', () => {
      expect(assetClassOf('alpaca_us_equity')).toBe('us_equity');
      expect(assetClassOf('yfinance_us_equity')).toBe('us_equity');
      expect(assetClassOf('clickhouse_us_equity')).toBe('us_equity');
      expect(assetClassOf('databento_us_equity')).toBe('us_equity');
    });

    it('forex providers resolve to forex', () => {
      expect(assetClassOf('dukascopy_forex')).toBe('forex');
      expect(assetClassOf('yfinance_forex')).toBe('forex');
    });

    it('crypto providers resolve to crypto', () => {
      expect(assetClassOf('ccxt_spot')).toBe('crypto');
      expect(assetClassOf('ccxt_perp')).toBe('crypto');
      expect(assetClassOf('yfinance_synthetic_crypto')).toBe('crypto');
    });

    it('CN A-share providers resolve to cn_a_share', () => {
      expect(assetClassOf('baostock_cn_a_share')).toBe('cn_a_share');
      expect(assetClassOf('tushare_cn_a_share')).toBe('cn_a_share');
      expect(assetClassOf('akshare_cn_a_share')).toBe('cn_a_share');
    });
  });

  describe('sameAssetClass', () => {
    it('databento and yfinance US equity are the same asset class', () => {
      expect(sameAssetClass('databento_us_equity', 'yfinance_us_equity')).toBe(true);
    });

    it('all four US equity markets are equivalent', () => {
      const usEquity: MarketId[] = [
        'alpaca_us_equity', 'yfinance_us_equity',
        'clickhouse_us_equity', 'databento_us_equity',
      ];
      for (const a of usEquity) {
        for (const b of usEquity) {
          expect(sameAssetClass(a, b)).toBe(true);
        }
      }
    });

    it('US equity and forex are NOT the same asset class', () => {
      expect(sameAssetClass('alpaca_us_equity', 'dukascopy_forex')).toBe(false);
    });

    it('crypto and CN A-share are NOT the same asset class', () => {
      expect(sameAssetClass('ccxt_spot', 'baostock_cn_a_share')).toBe(false);
    });

    it('reflexive: every market is same-asset-class with itself', () => {
      for (const id of MARKET_IDS) {
        expect(sameAssetClass(id, id)).toBe(true);
      }
    });
  });
});

describe('TICKET_1095: DynamicMarketId (BYOD)', () => {
  describe('isDynamicMarketId', () => {
    it('accepts byod_ prefixed strings', () => {
      expect(isDynamicMarketId('byod_forex')).toBe(true);
      expect(isDynamicMarketId('byod_my_package')).toBe(true);
    });

    it('rejects static MarketIds', () => {
      expect(isDynamicMarketId('alpaca_us_equity')).toBe(false);
      expect(isDynamicMarketId('dukascopy_forex')).toBe(false);
    });

    it('rejects non-byod_ strings', () => {
      expect(isDynamicMarketId('forex')).toBe(false);
      expect(isDynamicMarketId('')).toBe(false);
    });

    it('rejects non-strings', () => {
      expect(isDynamicMarketId(null)).toBe(false);
      expect(isDynamicMarketId(undefined)).toBe(false);
      expect(isDynamicMarketId(42)).toBe(false);
    });
  });

  describe('isAnyMarketId', () => {
    it('accepts static MarketIds', () => {
      expect(isAnyMarketId('alpaca_us_equity')).toBe(true);
    });

    it('accepts dynamic MarketIds', () => {
      expect(isAnyMarketId('byod_forex')).toBe(true);
    });

    it('rejects unknown strings', () => {
      expect(isAnyMarketId('forex')).toBe(false);
      expect(isAnyMarketId('')).toBe(false);
    });
  });

  describe('assetClassOf with dynamic resolver', () => {
    it('resolves a dynamic market via the callback', () => {
      setDynamicAssetClassResolver((m) => {
        if (m === 'byod_forex') return 'forex';
        return null;
      });
      expect(assetClassOf('byod_forex' as AnyMarketId)).toBe('forex');
    });

    it('throws for an unknown dynamic market with no resolver match', () => {
      setDynamicAssetClassResolver(() => null);
      expect(() => assetClassOf('byod_unknown' as AnyMarketId)).toThrow();
    });

    it('sameAssetClass works across static and dynamic', () => {
      setDynamicAssetClassResolver((m) => {
        if (m === 'byod_forex') return 'forex';
        return null;
      });
      expect(sameAssetClass('byod_forex' as AnyMarketId, 'dukascopy_forex')).toBe(true);
      expect(sameAssetClass('byod_forex' as AnyMarketId, 'alpaca_us_equity')).toBe(false);
    });
  });
});
