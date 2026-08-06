/**
 * AI Libero Page Form State Store
 *
 * TICKET_1208 P6 Layer B: Preserves form inputs across view switches.
 * In-memory only (no persist) — survives unmount/remount, not app restart.
 */

import { create } from 'zustand';
import type { TraderPresetMode, BespokeConfig, PredictionConfig, RawIndicatorBlock } from '../ui';

const INITIAL_BESPOKE_CONFIG: BespokeConfig = {
  lookbackBars: 100,
  positionLimits: 100,
  leverage: 1,
  tradingFrequency: 10,
  typicalYield: 50,
  maxDrawdown: 20,
};

const INITIAL_PREDICTION_CONFIG: PredictionConfig = {
  batchSize: 100,
  warmupPeriod: 100,
  lookbackBars: 100,
  analysisInterval: 10,
};

interface AILiberoFormState {
  presetMode: TraderPresetMode;
  bespokeConfig: BespokeConfig;
  predictionConfig: PredictionConfig;
  prompt: string;
  indicatorBlocks: RawIndicatorBlock[];

  setPresetMode: (mode: TraderPresetMode) => void;
  setBespokeConfig: (config: BespokeConfig) => void;
  setPredictionConfig: (config: PredictionConfig) => void;
  setPrompt: (prompt: string) => void;
  setIndicatorBlocks: (blocks: RawIndicatorBlock[] | ((prev: RawIndicatorBlock[]) => RawIndicatorBlock[])) => void;
  reset: () => void;
}

export const useAILiberoStore = create<AILiberoFormState>((set) => ({
  presetMode: 'monk',
  bespokeConfig: INITIAL_BESPOKE_CONFIG,
  predictionConfig: INITIAL_PREDICTION_CONFIG,
  prompt: '',
  indicatorBlocks: [],

  setPresetMode: (mode) => set({ presetMode: mode }),
  setBespokeConfig: (config) => set({ bespokeConfig: config }),
  setPredictionConfig: (config) => set({ predictionConfig: config }),
  setPrompt: (prompt) => set({ prompt }),
  setIndicatorBlocks: (blocks) =>
    set((s) => ({
      indicatorBlocks: typeof blocks === 'function' ? blocks(s.indicatorBlocks) : blocks,
    })),
  reset: () =>
    set({
      presetMode: 'monk',
      bespokeConfig: INITIAL_BESPOKE_CONFIG,
      predictionConfig: INITIAL_PREDICTION_CONFIG,
      prompt: '',
      indicatorBlocks: [],
    }),
}));
