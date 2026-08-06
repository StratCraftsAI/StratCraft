import { describe, it, expect } from 'vitest';
import { MarketScope } from './market-scope';
import { MarketId, MARKET_IDS } from './market-id';

describe('TICKET_927_1_1 MarketScope', () => {
  describe('from', () => {
    it('constructs a scope from a single market', () => {
      const s = MarketScope.from(['alpaca_us_equity']);
      expect(s.markets).toEqual(['alpaca_us_equity']);
    });

    it('throws on empty input (fail-fast, TICKET_857)', () => {
      expect(() => MarketScope.from([])).toThrow(/non-empty/);
    });

    it('throws on an unknown MarketId (fail-fast)', () => {
      expect(() => MarketScope.from(['not_a_market' as MarketId]))
        .toThrow(/not a known MarketId/);
    });

    it('dedups duplicate inputs', () => {
      const s = MarketScope.from(['alpaca_us_equity', 'alpaca_us_equity']);
      expect(s.markets).toEqual(['alpaca_us_equity']);
    });

    it('sorts lexicographically so canonical form is order-independent', () => {
      const a = MarketScope.from(['yfinance_us_equity', 'alpaca_us_equity', 'ccxt_spot']);
      const b = MarketScope.from(['ccxt_spot', 'alpaca_us_equity', 'yfinance_us_equity']);
      expect(a.markets).toEqual(b.markets);
      expect(a.markets).toEqual(['alpaca_us_equity', 'ccxt_spot', 'yfinance_us_equity']);
    });

    it('freezes the underlying markets array (immutability)', () => {
      const s = MarketScope.from(['alpaca_us_equity']);
      expect(Object.isFrozen(s.markets)).toBe(true);
    });
  });

  describe('toJson / fromJson', () => {
    it('round-trips through JSON', () => {
      const s = MarketScope.from(['alpaca_us_equity', 'dukascopy_forex']);
      const j = s.toJson();
      const back = MarketScope.fromJson(j);
      expect(back).not.toBeNull();
      expect(back!.equals(s)).toBe(true);
    });

    it('serialises in canonical (sorted) form', () => {
      const s = MarketScope.from(['yfinance_us_equity', 'alpaca_us_equity']);
      expect(s.toJson()).toBe('["alpaca_us_equity","yfinance_us_equity"]');
    });

    it('returns null for null / undefined / empty string', () => {
      expect(MarketScope.fromJson(null)).toBeNull();
      expect(MarketScope.fromJson(undefined)).toBeNull();
      expect(MarketScope.fromJson('')).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(MarketScope.fromJson('{not json')).toBeNull();
    });

    it('returns null when JSON is not an array', () => {
      expect(MarketScope.fromJson('{"market":"alpaca_us_equity"}')).toBeNull();
      expect(MarketScope.fromJson('"alpaca_us_equity"')).toBeNull();
    });

    it('returns null when an entry is not a MarketId', () => {
      expect(MarketScope.fromJson('["alpaca_us_equity","not_a_market"]')).toBeNull();
    });

    it('returns null when JSON encodes an empty array', () => {
      // Empty arrays fail MarketScope.from's non-empty rule -- the catch
      // converts the throw to null so callers get a uniform shape.
      expect(MarketScope.fromJson('[]')).toBeNull();
    });
  });

  describe('equals', () => {
    it('is true for value-equal scopes built in different input orders', () => {
      const a = MarketScope.from(['yfinance_us_equity', 'alpaca_us_equity']);
      const b = MarketScope.from(['alpaca_us_equity', 'yfinance_us_equity']);
      expect(a.equals(b)).toBe(true);
    });

    it('is false for differing scope sizes', () => {
      const a = MarketScope.from(['alpaca_us_equity']);
      const b = MarketScope.from(['alpaca_us_equity', 'yfinance_us_equity']);
      expect(a.equals(b)).toBe(false);
    });

    it('is false when the same-size scopes have different markets', () => {
      const a = MarketScope.from(['alpaca_us_equity']);
      const b = MarketScope.from(['yfinance_us_equity']);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('covers', () => {
    it('returns true for an included market', () => {
      const s = MarketScope.from(['alpaca_us_equity', 'ccxt_spot']);
      expect(s.covers('alpaca_us_equity')).toBe(true);
      expect(s.covers('ccxt_spot')).toBe(true);
    });

    it('returns false for an excluded market', () => {
      const s = MarketScope.from(['alpaca_us_equity']);
      expect(s.covers('yfinance_us_equity')).toBe(false);
    });
  });

  describe('intersect', () => {
    it('returns the markets present in both the scope and the run set', () => {
      const s = MarketScope.from(['alpaca_us_equity', 'ccxt_spot', 'dukascopy_forex']);
      const run = new Set<MarketId>(['ccxt_spot', 'dukascopy_forex', 'yfinance_us_equity']);
      const i = s.intersect(run);
      expect(i.sort()).toEqual(['ccxt_spot', 'dukascopy_forex']);
    });

    it('returns an empty array when there is no overlap', () => {
      const s = MarketScope.from(['alpaca_us_equity']);
      const run = new Set<MarketId>(['ccxt_spot']);
      expect(s.intersect(run)).toEqual([]);
    });
  });

  describe('toKey', () => {
    it('produces a stable pipe-joined string in canonical order', () => {
      const s = MarketScope.from(['yfinance_us_equity', 'alpaca_us_equity']);
      expect(s.toKey()).toBe('alpaca_us_equity|yfinance_us_equity');
    });

    it('returns the same key for value-equal scopes', () => {
      const a = MarketScope.from(['yfinance_us_equity', 'alpaca_us_equity']);
      const b = MarketScope.from(['alpaca_us_equity', 'yfinance_us_equity']);
      expect(a.toKey()).toBe(b.toKey());
    });
  });

  describe('TICKET_1174: all() and isAll()', () => {
    it('all() returns a scope containing every known MarketId', () => {
      const scope = MarketScope.all();
      expect(scope.markets.length).toBe(MARKET_IDS.length);
      for (const m of MARKET_IDS) {
        expect(scope.covers(m)).toBe(true);
      }
    });

    it('isAll() returns true for MarketScope.all()', () => {
      expect(MarketScope.isAll(MarketScope.all())).toBe(true);
    });

    it('isAll() returns false for a partial scope', () => {
      const partial = MarketScope.from(['alpaca_us_equity']);
      expect(MarketScope.isAll(partial)).toBe(false);
    });
  });
});
