/**
 * Application Global State
 *
 * Uses zustand with persist middleware to save state to localStorage.
 * Storage key: "StratCraft:app-state" (STORAGE_KEYS.APP_STATE)
 *
 * Persisted fields (TICKET_883 -- keep in sync with partialize below):
 * - activeView: Current view ID
 * - previousView: For "back" navigation after backtest results
 * - sidebarCollapsed: Sidebar state
 * - dataManagementTab: Sub-tab context in Data Management
 *
 * NOT persisted (volatile / contains closures / safety):
 * - subPagePath (closures in onNavigate), pageTitle, immersiveMode,
 *   generationBusy, pendingNavigation, isLoading, error, serverStatus
 *
 * NOTE: enabledPlugins is managed separately by PersistenceManager
 * using "StratCraft:framework" key to avoid circular dependencies.
 *
 * @see TICKET_007 - PersistenceManager design
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ServerStatus } from '@shared/types';
import { STORAGE_KEYS } from '@/services/persistence';
import type { ViewId } from '@/config/view-registry';

// TICKET_300: Sub-page entry for breadcrumb navigation
export interface SubPageEntry {
  label: string;
  onNavigate?: () => void;  // Callback when clicking this breadcrumb segment to navigate back
}

interface AppState {
  // Server status
  serverStatus: ServerStatus;
  setServerStatus: (status: ServerStatus) => void;

  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Current view
  // TICKET_239: Added 'backtestResult' for independent result page
  // TICKET_340: Added 'dataManagement' for Data Management Center
  // TICKET_196_6 Phase 4: Added 'scoreboard' for Signal Performance Scoreboard
  //
  // TICKET_1335_1: this was a hand-maintained duplicate of `ViewId` and had
  // already drifted -- it still listed 'data', which TICKET_135 removed from
  // VIEW_REGISTRY, so the store accepted a view that cannot render. Pointing at
  // the canonical union is the fix TICKET_069 intends: the registry is the one
  // place a view is declared, and adding one there no longer requires a second
  // edit here that can be forgotten.
  activeView: ViewId;
  setActiveView: (view: AppState['activeView']) => void;

  // Previous view (for "Run in Background" navigation)
  // TICKET_237: Track previous view for returning from result page
  previousView: AppState['activeView'] | null;

  // Breadcrumb navigation (TICKET_300: Centralized breadcrumb management)
  // Sub-page path within current view (e.g., [{ label: 'Alpha Factory' }] for quantLab)
  // Full breadcrumb derived by useBreadcrumbs hook: VIEW_REGISTRY[activeView].shortLabel + subPagePath
  subPagePath: SubPageEntry[];
  pushSubPage: (entry: SubPageEntry) => void;
  popToSubPage: (index: number) => void;
  resetSubPages: () => void;

  // TICKET_591: Page title for BreadcrumbBar center zone (MiniNameplate)
  pageTitle: string | null;
  setPageTitle: (title: string | null) => void;

  // TICKET_348: Data Management tab navigation from StatusBar
  // TICKET_308_1a (Phase 7): 'import' is the BYOD package-import surface.
  dataManagementTab: 'catalog' | 'downloadQueue' | 'import';
  setDataManagementTab: (tab: AppState['dataManagementTab']) => void;

  // TICKET_614: Immersive mode -- hide shell chrome for full-screen dashboard
  immersiveMode: boolean;
  setImmersiveMode: (mode: boolean) => void;

  // TICKET_701 → TICKET_1208_1: Generation is now background-safe.
  // generationBusy / pendingNavigation kept for backward compat but no longer
  // block navigation. The guard dialog is removed.
  generationBusy: boolean;
  setGenerationBusy: (busy: boolean) => void;
  pendingNavigation: AppState['activeView'] | null;
  confirmNavigation: () => void;
  cancelNavigation: () => void;

  // TICKET_1208 P5: Settings active section preserved across view switches.
  // NOT persisted (not in partialize) — survives unmount/remount, not app restart.
  settingsActiveSection: string;
  setSettingsActiveSection: (section: string) => void;

  // Loading state
  isLoading: boolean;
  setLoading: (loading: boolean) => void;

  // Error message
  error: string | null;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Server status
      serverStatus: {
        api: false,
        engine: false,
        mcp: false,
      },
      setServerStatus: (status) => set({ serverStatus: status }),

      // Sidebar
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      // Current view
      activeView: 'nexus',
      setActiveView: (view) => {
        // TICKET_1208_1: Generation is background-safe, no navigation blocking
        set((state) => ({
          previousView: state.activeView,
          activeView: view,
          subPagePath: [],  // TICKET_300: Reset sub-pages on view change
          pageTitle: null,  // TICKET_591: Reset page title on view change
        }));
      },

      // Previous view (TICKET_237)
      previousView: null,

      // Breadcrumb navigation (TICKET_300: Centralized)
      subPagePath: [],
      pushSubPage: (entry) => set((state) => ({ subPagePath: [...state.subPagePath, entry] })),
      popToSubPage: (index) => set((state) => ({
        subPagePath: index < 0 ? [] : state.subPagePath.slice(0, index + 1),
      })),
      resetSubPages: () => set({ subPagePath: [] }),

      // TICKET_591: Page title for BreadcrumbBar center zone
      pageTitle: null,
      setPageTitle: (title) => set({ pageTitle: title }),

      // TICKET_348: Data Management tab navigation from StatusBar
      dataManagementTab: 'catalog',
      setDataManagementTab: (tab) => set({ dataManagementTab: tab }),

      // TICKET_614: Immersive mode
      immersiveMode: false,
      setImmersiveMode: (mode) => set({ immersiveMode: mode }),

      // TICKET_701: Navigation guard during strategy generation
      generationBusy: false,
      setGenerationBusy: (busy) => set({ generationBusy: busy }),
      pendingNavigation: null,
      confirmNavigation: () => {
        const pending = get().pendingNavigation;
        if (!pending) return;
        set((state) => ({
          previousView: state.activeView,
          activeView: pending,
          subPagePath: [],
          pageTitle: null,
          pendingNavigation: null,
          generationBusy: false,
        }));
      },
      cancelNavigation: () => set({ pendingNavigation: null }),

      // TICKET_1208 P5: Settings active section.
      settingsActiveSection: 'profile',
      setSettingsActiveSection: (section) => set({ settingsActiveSection: section }),

      // Loading state
      isLoading: false,
      setLoading: (loading) => set({ isLoading: loading }),

      // Error message
      error: null,
      setError: (error) => set({ error }),
      clearError: () => set({ error: null }),
    }),
    {
      name: STORAGE_KEYS.APP_STATE,
      partialize: (state) => ({
        activeView: state.activeView,
        previousView: state.previousView,
        sidebarCollapsed: state.sidebarCollapsed,
        dataManagementTab: state.dataManagementTab,
      }),
    }
  )
);
