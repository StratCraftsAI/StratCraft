/**
 * Regime Detector Page Form State Store
 *
 * TICKET_1208 P6 Layer B: Preserves form inputs across view switches.
 * In-memory only (no persist) — survives unmount/remount, not app restart.
 */

import { create } from 'zustand';
import { DEFAULT_REGIME_ID } from '@StratCraft/types';
import type { BespokeData, IndicatorBlock, SignalMode } from '../ui';

interface Strategy {
  id: string;
  expression: string;
}

interface RegimeDetectorFormState {
  strategies: Strategy[];
  selectedRegime: string;
  bespokeData: BespokeData;
  indicatorBlocks: IndicatorBlock[];
  signalMode: SignalMode;

  setStrategies: (strategies: Strategy[] | ((prev: Strategy[]) => Strategy[])) => void;
  setSelectedRegime: (regime: string) => void;
  setBespokeData: (data: BespokeData) => void;
  setIndicatorBlocks: (blocks: IndicatorBlock[] | ((prev: IndicatorBlock[]) => IndicatorBlock[])) => void;
  setSignalMode: (mode: SignalMode) => void;
  reset: () => void;
}

export const useRegimeDetectorStore = create<RegimeDetectorFormState>((set) => ({
  strategies: [],
  selectedRegime: DEFAULT_REGIME_ID,
  bespokeData: { name: '', notes: '' },
  indicatorBlocks: [],
  signalMode: 'auto-reverse',

  setStrategies: (strategies) =>
    set((s) => ({
      strategies: typeof strategies === 'function' ? strategies(s.strategies) : strategies,
    })),
  setSelectedRegime: (regime) => set({ selectedRegime: regime }),
  setBespokeData: (data) => set({ bespokeData: data }),
  setIndicatorBlocks: (blocks) =>
    set((s) => ({
      indicatorBlocks: typeof blocks === 'function' ? blocks(s.indicatorBlocks) : blocks,
    })),
  setSignalMode: (mode) => set({ signalMode: mode }),
  reset: () =>
    set({
      strategies: [],
      selectedRegime: DEFAULT_REGIME_ID,
      bespokeData: { name: '', notes: '' },
      indicatorBlocks: [],
      signalMode: 'auto-reverse',
    }),
}));

export type { Strategy };
