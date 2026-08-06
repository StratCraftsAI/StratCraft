/**
 * Market Observer Page Form State Store
 *
 * TICKET_1208 P6 Layer B: Preserves form inputs across view switches.
 * In-memory only (no persist) — survives unmount/remount, not app restart.
 */

import { create } from 'zustand';
import type { IndicatorBlock } from '../ui';

interface MarketObserverFormState {
  indicatorBlocks: IndicatorBlock[];

  setIndicatorBlocks: (blocks: IndicatorBlock[] | ((prev: IndicatorBlock[]) => IndicatorBlock[])) => void;
  reset: () => void;
}

export const useMarketObserverStore = create<MarketObserverFormState>((set) => ({
  indicatorBlocks: [],

  setIndicatorBlocks: (blocks) =>
    set((s) => ({
      indicatorBlocks: typeof blocks === 'function' ? blocks(s.indicatorBlocks) : blocks,
    })),
  reset: () =>
    set({
      indicatorBlocks: [],
    }),
}));
