/**
 * TICKET_634_3: useMarketStore Tests
 *
 * Tests for market data state management store.
 * Validates symbol selection, kline data, watchlist, and loading state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMarketStore } from '../useMarketStore';

describe('useMarketStore', () => {
  beforeEach(() => {
    useMarketStore.setState({
      currentSymbol: 'BTC/USDT',
      klineInterval: '1h',
      klineData: [],
      currentPrice: null,
      watchlist: ['BTC/USDT', 'ETH/USDT'],
      isLoading: false,
    });
  });

  // =========================================================================
  // Symbol Management
  // =========================================================================

  describe('symbol management', () => {
    it('should start with BTC/USDT', () => {
      expect(useMarketStore.getState().currentSymbol).toBe('BTC/USDT');
    });

    it('should set current symbol', () => {
      useMarketStore.getState().setCurrentSymbol('ETH/USDT');
      expect(useMarketStore.getState().currentSymbol).toBe('ETH/USDT');
    });
  });

  // =========================================================================
  // Kline Interval
  // =========================================================================

  describe('kline interval', () => {
    it('should start with 1h interval', () => {
      expect(useMarketStore.getState().klineInterval).toBe('1h');
    });

    it('should set kline interval', () => {
      useMarketStore.getState().setKlineInterval('1d');
      expect(useMarketStore.getState().klineInterval).toBe('1d');
    });
  });

  // =========================================================================
  // Kline Data
  // =========================================================================

  describe('kline data', () => {
    it('should start with empty kline data', () => {
      expect(useMarketStore.getState().klineData).toEqual([]);
    });

    it('should set kline data', () => {
      const data = [
        { timestamp: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1000 },
      ] as any[];
      useMarketStore.getState().setKlineData(data);
      expect(useMarketStore.getState().klineData).toHaveLength(1);
    });

    it('should append kline and cap at 1000 items', () => {
      // Fill with 1000 items
      const initial = Array.from({ length: 1000 }, (_, i) => ({
        timestamp: i,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000,
      })) as any[];
      useMarketStore.getState().setKlineData(initial);

      // Append one more
      const newBar = { timestamp: 1000, open: 200, high: 210, low: 190, close: 205, volume: 500 } as any;
      useMarketStore.getState().appendKline(newBar);

      const data = useMarketStore.getState().klineData;
      expect(data).toHaveLength(1000);
      // Last item should be the newly appended bar
      expect(data[data.length - 1].timestamp).toBe(1000);
      // First item should be index 1 (index 0 was dropped)
      expect(data[0].timestamp).toBe(1);
    });
  });

  // =========================================================================
  // Price
  // =========================================================================

  describe('current price', () => {
    it('should start with null price', () => {
      expect(useMarketStore.getState().currentPrice).toBeNull();
    });

    it('should set current price', () => {
      useMarketStore.getState().setCurrentPrice(42000.5);
      expect(useMarketStore.getState().currentPrice).toBe(42000.5);
    });

    it('should clear price to null', () => {
      useMarketStore.getState().setCurrentPrice(42000.5);
      useMarketStore.getState().setCurrentPrice(null);
      expect(useMarketStore.getState().currentPrice).toBeNull();
    });
  });

  // =========================================================================
  // Watchlist
  // =========================================================================

  describe('watchlist', () => {
    it('should start with default watchlist', () => {
      const wl = useMarketStore.getState().watchlist;
      expect(wl).toContain('BTC/USDT');
      expect(wl).toContain('ETH/USDT');
    });

    it('should add symbol to watchlist', () => {
      useMarketStore.getState().addToWatchlist('SOL/USDT');
      expect(useMarketStore.getState().watchlist).toContain('SOL/USDT');
    });

    it('should not duplicate symbol in watchlist', () => {
      useMarketStore.getState().addToWatchlist('BTC/USDT');
      const wl = useMarketStore.getState().watchlist;
      expect(wl.filter((s) => s === 'BTC/USDT')).toHaveLength(1);
    });

    it('should remove symbol from watchlist', () => {
      useMarketStore.getState().removeFromWatchlist('ETH/USDT');
      expect(useMarketStore.getState().watchlist).not.toContain('ETH/USDT');
    });

    it('should handle remove of non-existent symbol gracefully', () => {
      const before = useMarketStore.getState().watchlist.length;
      useMarketStore.getState().removeFromWatchlist('NONEXISTENT');
      expect(useMarketStore.getState().watchlist).toHaveLength(before);
    });
  });

  // =========================================================================
  // Loading
  // =========================================================================

  describe('loading state', () => {
    it('should start not loading', () => {
      expect(useMarketStore.getState().isLoading).toBe(false);
    });

    it('should set loading state', () => {
      useMarketStore.getState().setLoading(true);
      expect(useMarketStore.getState().isLoading).toBe(true);

      useMarketStore.getState().setLoading(false);
      expect(useMarketStore.getState().isLoading).toBe(false);
    });
  });
});
