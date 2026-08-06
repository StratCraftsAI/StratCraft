/**
 * Strategy Catalog Page Form State Store
 *
 * TICKET_1208 P6 Layer B: Preserves form inputs across view switches.
 * In-memory only (no persist) — survives unmount/remount, not app restart.
 */

import { create } from 'zustand';

interface StrategyCatalogFormState {
  selectedCategory: string;
  selectedStrategyId: string | null;
  searchQuery: string;
  customPreference: string;

  setSelectedCategory: (category: string) => void;
  setSelectedStrategyId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setCustomPreference: (pref: string) => void;
  reset: () => void;
}

export const useStrategyCatalogStore = create<StrategyCatalogFormState>((set) => ({
  selectedCategory: 'trend-following',
  selectedStrategyId: null,
  searchQuery: '',
  customPreference: '',

  setSelectedCategory: (category) => set({ selectedCategory: category }),
  setSelectedStrategyId: (id) => set({ selectedStrategyId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setCustomPreference: (pref) => set({ customPreference: pref }),
  reset: () =>
    set({
      selectedCategory: 'trend-following',
      selectedStrategyId: null,
      searchQuery: '',
      customPreference: '',
    }),
}));
