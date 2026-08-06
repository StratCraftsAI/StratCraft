/**
 * Backtest Config Snapshot Store
 *
 * TICKET_365: Preserves backtest configuration across view switches
 * (e.g., Cancel -> Go Back returns to cockpit with config intact).
 *
 * In-memory only (no persist middleware) -- config only needs to survive
 * component unmount/remount, not app restart.
 */

import { create } from 'zustand';

// Re-use plugin-layer types via structural typing (no direct import across plugin boundary)
export interface BacktestConfigSnapshot {
  /** Which cockpit was active: indicators / kronos / trader */
  cockpit: string;
  /** Data configuration (symbol, dates, capital, etc.) */
  dataConfig: {
    symbol: string;
    dataSource: string;
    startDate: string;
    endDate: string;
    initialCapital: number;
    orderSize: number;
    orderSizeUnit: string;
  };
  /** Workflow rows with algorithm selections (deep-cloned on save) */
  workflowRows: unknown[];
}

interface BacktestConfigStore {
  snapshot: BacktestConfigSnapshot | null;
  saveSnapshot: (config: BacktestConfigSnapshot) => void;
  clearSnapshot: () => void;
}

export const useBacktestConfigStore = create<BacktestConfigStore>((set) => ({
  snapshot: null,

  saveSnapshot: (config) => set({ snapshot: config }),

  clearSnapshot: () => set({ snapshot: null }),
}));
