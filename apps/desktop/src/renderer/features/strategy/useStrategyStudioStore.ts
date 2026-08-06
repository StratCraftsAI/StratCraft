/**
 * Strategy Studio Page State Store
 *
 * TICKET_1208 P1: Preserves navigation depth across view switches.
 * In-memory only (no persist) — survives component unmount/remount,
 * not app restart.
 */

import { create } from 'zustand';

type ContentLevel = 'hub' | 'provider' | 'group' | 'generator' | 'audit';

interface SelectedNode {
  id: string;
  label: string;
  type: ContentLevel;
}

interface StrategyStudioStore {
  currentLevel: ContentLevel;
  selectedNode: SelectedNode | null;
  featureName: string | null;

  setCurrentLevel: (level: ContentLevel) => void;
  setSelectedNode: (node: SelectedNode | null) => void;
  setFeatureName: (name: string | null) => void;
  resetToHub: () => void;
}

export const useStrategyStudioStore = create<StrategyStudioStore>((set) => ({
  currentLevel: 'hub',
  selectedNode: null,
  featureName: null,

  setCurrentLevel: (level) => set({ currentLevel: level }),
  setSelectedNode: (node) => set({ selectedNode: node }),
  setFeatureName: (name) => set({ featureName: name }),
  resetToHub: () => set({ currentLevel: 'hub', selectedNode: null, featureName: null }),
}));

export type { ContentLevel, SelectedNode };
