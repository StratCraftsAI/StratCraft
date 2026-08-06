/**
 * Kronos Predictor Page Form State Store
 *
 * TICKET_1208 P6 Layer B: Preserves form inputs across view switches.
 * In-memory only (no persist) — survives unmount/remount, not app restart.
 */

import { create } from 'zustand';
import type { SignalFilterConfig, TimeRangeMode } from '../ui';

const DEFAULT_SIGNAL_FILTER: SignalFilterConfig = {
  confidence: { enabled: true, value: 60 },
  expectedReturn: { enabled: true, value: 2 },
  direction: { enabled: false, mode: 'both' },
  magnitude: { enabled: false, value: 1 },
  consistency: { enabled: true, value: 70 },
  combinationLogic: 'AND',
};

interface KronosPredictorFormState {
  selectedModel: string;
  lookback: number;
  predLen: number;
  temperature: number;
  topP: number;
  topK: number;
  sampleCount: number;
  signalFilter: SignalFilterConfig;
  timeRangeMode: TimeRangeMode;
  customTime: string;
  activePreset: string;

  setSelectedModel: (model: string) => void;
  setLookback: (lookback: number) => void;
  setPredLen: (predLen: number) => void;
  setTemperature: (temperature: number) => void;
  setTopP: (topP: number) => void;
  setTopK: (topK: number) => void;
  setSampleCount: (sampleCount: number) => void;
  setSignalFilter: (filter: SignalFilterConfig) => void;
  setTimeRangeMode: (mode: TimeRangeMode) => void;
  setCustomTime: (time: string) => void;
  setActivePreset: (preset: string) => void;
  reset: () => void;
}

export const useKronosPredictorStore = create<KronosPredictorFormState>((set) => ({
  selectedModel: 'kronos-small',
  lookback: 400,
  predLen: 120,
  temperature: 1.0,
  topP: 0.9,
  topK: 0,
  sampleCount: 1,
  signalFilter: DEFAULT_SIGNAL_FILTER,
  timeRangeMode: 'latest',
  customTime: '',
  activePreset: 'standard',

  setSelectedModel: (model) => set({ selectedModel: model }),
  setLookback: (lookback) => set({ lookback }),
  setPredLen: (predLen) => set({ predLen }),
  setTemperature: (temperature) => set({ temperature }),
  setTopP: (topP) => set({ topP }),
  setTopK: (topK) => set({ topK }),
  setSampleCount: (sampleCount) => set({ sampleCount }),
  setSignalFilter: (filter) => set({ signalFilter: filter }),
  setTimeRangeMode: (mode) => set({ timeRangeMode: mode }),
  setCustomTime: (time) => set({ customTime: time }),
  setActivePreset: (preset) => set({ activePreset: preset }),
  reset: () =>
    set({
      selectedModel: 'kronos-small',
      lookback: 400,
      predLen: 120,
      temperature: 1.0,
      topP: 0.9,
      topK: 0,
      sampleCount: 1,
      signalFilter: DEFAULT_SIGNAL_FILTER,
      timeRangeMode: 'latest',
      customTime: '',
      activePreset: 'standard',
    }),
}));
