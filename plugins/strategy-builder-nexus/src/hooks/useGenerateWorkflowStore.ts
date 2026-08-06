/**
 * Generate Workflow State Store
 *
 * TICKET_1208 P6 Layer A: Preserves generation results across view switches.
 * Keyed by pageId so each generator page has independent state.
 * In-memory only (no persist) — survives component unmount/remount,
 * not app restart.
 */

import { create } from 'zustand';
import type { GenerateResultState } from './useGenerateWorkflow';

interface PageWorkflowState {
  strategyName: string;
  generateResult: GenerateResultState | null;
  isSaved: boolean;
  savedAlgorithmId: number | null;
}

interface GenerateWorkflowStoreState {
  pages: Record<string, PageWorkflowState>;

  getPage: (pageId: string, defaultName: string) => PageWorkflowState;
  setStrategyName: (pageId: string, name: string) => void;
  setGenerateResult: (pageId: string, result: GenerateResultState | null) => void;
  setIsSaved: (pageId: string, saved: boolean) => void;
  setSavedAlgorithmId: (pageId: string, id: number | null) => void;
  resetPage: (pageId: string) => void;
}

function defaultPageState(strategyName: string): PageWorkflowState {
  return {
    strategyName,
    generateResult: null,
    isSaved: false,
    savedAlgorithmId: null,
  };
}

export const useGenerateWorkflowStore = create<GenerateWorkflowStoreState>((set, get) => ({
  pages: {},

  getPage: (pageId, defaultName) => {
    const existing = get().pages[pageId];
    if (existing) return existing;
    const fresh = defaultPageState(defaultName);
    set((s) => ({ pages: { ...s.pages, [pageId]: fresh } }));
    return fresh;
  },

  setStrategyName: (pageId, name) =>
    set((s) => ({
      pages: {
        ...s.pages,
        [pageId]: { ...(s.pages[pageId] || defaultPageState(name)), strategyName: name },
      },
    })),

  setGenerateResult: (pageId, result) =>
    set((s) => {
      const page = s.pages[pageId];
      if (!page) return s;
      return { pages: { ...s.pages, [pageId]: { ...page, generateResult: result } } };
    }),

  setIsSaved: (pageId, saved) =>
    set((s) => {
      const page = s.pages[pageId];
      if (!page) return s;
      return { pages: { ...s.pages, [pageId]: { ...page, isSaved: saved } } };
    }),

  setSavedAlgorithmId: (pageId, id) =>
    set((s) => {
      const page = s.pages[pageId];
      if (!page) return s;
      return { pages: { ...s.pages, [pageId]: { ...page, savedAlgorithmId: id } } };
    }),

  resetPage: (pageId) =>
    set((s) => {
      const rest = { ...s.pages };
      delete rest[pageId];
      return { pages: rest };
    }),
}));
