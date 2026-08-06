/**
 * Backtest Page State Store
 *
 * TICKET_1208 P3: Preserves cockpit selection across view switches.
 * In-memory only (no persist) — survives component unmount/remount,
 * not app restart.
 */

import { create } from 'zustand';

type ViewState = 'hub' | 'indicators' | 'kronos' | 'trader' | 'aiLibero' | 'aiStudio' | 'catalog';

interface BacktestPageStore {
  viewState: ViewState;
  selectedCockpit: string | null;

  setViewState: (view: ViewState) => void;
  setSelectedCockpit: (cockpit: string | null) => void;
  resetToHub: () => void;
}

export const useBacktestPageStore = create<BacktestPageStore>((set) => ({
  viewState: 'hub',
  selectedCockpit: null,

  setViewState: (view) => set({ viewState: view }),
  setSelectedCockpit: (cockpit) => set({ selectedCockpit: cockpit }),
  resetToHub: () => set({ viewState: 'hub', selectedCockpit: null }),
}));

export type { ViewState };
