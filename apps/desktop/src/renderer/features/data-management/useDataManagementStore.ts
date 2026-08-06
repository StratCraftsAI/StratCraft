/**
 * Data Management Page State Store
 *
 * TICKET_1208 P2: Preserves catalog selection, download form draft,
 * and import form draft across view switches.
 * In-memory only (no persist) — survives component unmount/remount,
 * not app restart.
 */

import { create } from 'zustand';
import type { ImportAdjustMode } from '@shared/constants/data-import';
import type { ArchivalCadence } from '@shared/constants/data-import';

// ─── Catalog ────────────────────────────────────────────────────────────────

interface CatalogDraft {
  selected: Set<number>;
  collapsed: Record<string, boolean>;
}

// ─── Download Form ──────────────────────────────────────────────────────────

interface DownloadDraft {
  symbol: string;
  interval: string;
  startDate: string;
  endDate: string;
  provider: string;
}

// ─── Import Form ────────────────────────────────────────────────────────────

interface ImportDraft {
  pkgSourcePath: string | null;
  pkgName: string;
  pkgAdjustMode: ImportAdjustMode;
  pkgArchivalCadence: ArchivalCadence;
}

// ─── Store ──────────────────────────────────────────────────────────────────

interface DataManagementStore {
  catalog: CatalogDraft;
  download: DownloadDraft;
  importForm: ImportDraft;

  setCatalogSelected: (selected: Set<number>) => void;
  setCatalogCollapsed: (collapsed: Record<string, boolean>) => void;

  setDownloadDraft: (patch: Partial<DownloadDraft>) => void;
  resetDownloadDraft: () => void;

  setImportDraft: (patch: Partial<ImportDraft>) => void;
  resetImportDraft: () => void;
}

const DOWNLOAD_DEFAULTS: DownloadDraft = {
  symbol: '',
  interval: '',
  startDate: '',
  endDate: '',
  provider: '',
};

const IMPORT_DEFAULTS: ImportDraft = {
  pkgSourcePath: null,
  pkgName: '',
  pkgAdjustMode: 'hfq',
  pkgArchivalCadence: 'snapshot',
};

export const useDataManagementStore = create<DataManagementStore>((set) => ({
  catalog: { selected: new Set(), collapsed: {} },
  download: { ...DOWNLOAD_DEFAULTS },
  importForm: { ...IMPORT_DEFAULTS },

  setCatalogSelected: (selected) =>
    set((s) => ({ catalog: { ...s.catalog, selected } })),
  setCatalogCollapsed: (collapsed) =>
    set((s) => ({ catalog: { ...s.catalog, collapsed } })),

  setDownloadDraft: (patch) =>
    set((s) => ({ download: { ...s.download, ...patch } })),
  resetDownloadDraft: () =>
    set({ download: { ...DOWNLOAD_DEFAULTS } }),

  setImportDraft: (patch) =>
    set((s) => ({ importForm: { ...s.importForm, ...patch } })),
  resetImportDraft: () =>
    set({ importForm: { ...IMPORT_DEFAULTS } }),
}));

export type { CatalogDraft, DownloadDraft, ImportDraft };
