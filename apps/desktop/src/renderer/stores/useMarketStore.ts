/**
 * Market data state management
 */

import { create } from 'zustand';
import type { MarketData, KlineInterval } from '@shared/types';
import { INTERVAL_1h } from '@shared/constants/intervals';

interface MarketState {
  // Current selected trading pair
  currentSymbol: string;
  setCurrentSymbol: (symbol: string) => void;

  // K-line interval
  klineInterval: KlineInterval;
  setKlineInterval: (interval: KlineInterval) => void;

  // Market data
  klineData: MarketData[];
  setKlineData: (data: MarketData[]) => void;
  appendKline: (data: MarketData) => void;

  // Real-time price
  currentPrice: number | null;
  setCurrentPrice: (price: number | null) => void;

  // Watchlist
  watchlist: string[];
  addToWatchlist: (symbol: string) => void;
  removeFromWatchlist: (symbol: string) => void;

  // Loading state
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  // Current trading pair
  currentSymbol: 'BTC/USDT',
  setCurrentSymbol: (symbol) => set({ currentSymbol: symbol }),

  // K-line interval
  klineInterval: INTERVAL_1h,
  setKlineInterval: (interval) => set({ klineInterval: interval }),

  // K-line data
  klineData: [],
  setKlineData: (data) => set({ klineData: data }),
  appendKline: (data) =>
    set((state) => ({
      klineData: [...state.klineData.slice(-999), data],
    })),

  // Real-time price
  currentPrice: null,
  setCurrentPrice: (price) => set({ currentPrice: price }),

  // Watchlist
  watchlist: ['BTC/USDT', 'ETH/USDT'],
  addToWatchlist: (symbol) =>
    set((state) => ({
      watchlist: state.watchlist.includes(symbol)
        ? state.watchlist
        : [...state.watchlist, symbol],
    })),
  removeFromWatchlist: (symbol) =>
    set((state) => ({
      watchlist: state.watchlist.filter((s) => s !== symbol),
    })),

  // Loading state
  isLoading: false,
  setLoading: (loading) => set({ isLoading: loading }),
}));
