/**
 * Kronos Indicator Entry Page Form State Store
 *
 * TICKET_1208 P6 Layer B: Preserves form inputs across view switches.
 * In-memory only (no persist) — survives unmount/remount, not app restart.
 */

import { create } from 'zustand';
import type { IndicatorBlock } from '../ui';

interface Strategy {
  id: string;
  expression: string;
}

interface KronosIndicatorEntryFormState {
  strategies: Strategy[];
  indicatorBlocks: IndicatorBlock[];

  setStrategies: (strategies: Strategy[] | ((prev: Strategy[]) => Strategy[])) => void;
  setIndicatorBlocks: (blocks: IndicatorBlock[] | ((prev: IndicatorBlock[]) => IndicatorBlock[])) => void;
  reset: () => void;
}

export const useKronosIndicatorEntryStore = create<KronosIndicatorEntryFormState>((set) => ({
  strategies: [],
  indicatorBlocks: [],

  setStrategies: (strategies) =>
    set((s) => ({
      strategies: typeof strategies === 'function' ? strategies(s.strategies) : strategies,
    })),
  setIndicatorBlocks: (blocks) =>
    set((s) => ({
      indicatorBlocks: typeof blocks === 'function' ? blocks(s.indicatorBlocks) : blocks,
    })),
  reset: () =>
    set({
      strategies: [],
      indicatorBlocks: [],
    }),
}));

export type { Strategy };
