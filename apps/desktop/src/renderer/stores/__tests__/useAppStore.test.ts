/**
 * TICKET_634_3: useAppStore Tests
 *
 * Tests for the global application state store.
 * Validates view navigation, breadcrumb management, sidebar, and error state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';

describe('useAppStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useAppStore.setState({
      activeView: 'nexus',
      previousView: null,
      sidebarCollapsed: false,
      subPagePath: [],
      pageTitle: null,
      dataManagementTab: 'catalog',
      immersiveMode: false,
      // TICKET_701: Navigation guard state
      generationBusy: false,
      pendingNavigation: null,
      isLoading: false,
      error: null,
      serverStatus: { api: false, engine: false, mcp: false },
    });
  });

  // =========================================================================
  // View Navigation
  // =========================================================================

  describe('view navigation', () => {
    it('should start with nexus as active view', () => {
      const state = useAppStore.getState();
      expect(state.activeView).toBe('nexus');
    });

    it('should set active view', () => {
      useAppStore.getState().setActiveView('backtest');
      expect(useAppStore.getState().activeView).toBe('backtest');
    });

    it('should track previous view on navigation', () => {
      useAppStore.getState().setActiveView('backtest');
      useAppStore.getState().setActiveView('strategy');

      const state = useAppStore.getState();
      expect(state.activeView).toBe('strategy');
      expect(state.previousView).toBe('backtest');
    });

    it('should reset subPagePath on view change (TICKET_300)', () => {
      useAppStore.getState().pushSubPage({ label: 'Sub Page 1' });
      expect(useAppStore.getState().subPagePath.length).toBe(1);

      useAppStore.getState().setActiveView('backtest');
      expect(useAppStore.getState().subPagePath).toEqual([]);
    });

    it('should reset pageTitle on view change (TICKET_591)', () => {
      useAppStore.getState().setPageTitle('Test Title');
      expect(useAppStore.getState().pageTitle).toBe('Test Title');

      useAppStore.getState().setActiveView('backtest');
      expect(useAppStore.getState().pageTitle).toBeNull();
    });
  });

  // =========================================================================
  // Breadcrumb Sub-Pages (TICKET_300)
  // =========================================================================

  describe('breadcrumb sub-pages', () => {
    it('should push sub-page to path', () => {
      useAppStore.getState().pushSubPage({ label: 'Alpha Factory' });
      const state = useAppStore.getState();
      expect(state.subPagePath).toHaveLength(1);
      expect(state.subPagePath[0].label).toBe('Alpha Factory');
    });

    it('should push multiple sub-pages', () => {
      useAppStore.getState().pushSubPage({ label: 'Page 1' });
      useAppStore.getState().pushSubPage({ label: 'Page 2' });
      useAppStore.getState().pushSubPage({ label: 'Page 3' });

      const path = useAppStore.getState().subPagePath;
      expect(path).toHaveLength(3);
      expect(path.map((p) => p.label)).toEqual(['Page 1', 'Page 2', 'Page 3']);
    });

    it('should pop to specific sub-page index', () => {
      useAppStore.getState().pushSubPage({ label: 'Page 1' });
      useAppStore.getState().pushSubPage({ label: 'Page 2' });
      useAppStore.getState().pushSubPage({ label: 'Page 3' });

      useAppStore.getState().popToSubPage(0);
      const path = useAppStore.getState().subPagePath;
      expect(path).toHaveLength(1);
      expect(path[0].label).toBe('Page 1');
    });

    it('should clear all sub-pages when popToSubPage(-1)', () => {
      useAppStore.getState().pushSubPage({ label: 'Page 1' });
      useAppStore.getState().pushSubPage({ label: 'Page 2' });

      useAppStore.getState().popToSubPage(-1);
      expect(useAppStore.getState().subPagePath).toEqual([]);
    });

    it('should reset all sub-pages', () => {
      useAppStore.getState().pushSubPage({ label: 'Page 1' });
      useAppStore.getState().pushSubPage({ label: 'Page 2' });

      useAppStore.getState().resetSubPages();
      expect(useAppStore.getState().subPagePath).toEqual([]);
    });
  });

  // =========================================================================
  // Sidebar
  // =========================================================================

  describe('sidebar', () => {
    it('should start expanded', () => {
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });

    it('should toggle sidebar', () => {
      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);

      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });

    it('should set sidebar collapsed state directly', () => {
      useAppStore.getState().setSidebarCollapsed(true);
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);

      useAppStore.getState().setSidebarCollapsed(false);
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  // =========================================================================
  // Error State
  // =========================================================================

  describe('error state', () => {
    it('should have no error initially', () => {
      expect(useAppStore.getState().error).toBeNull();
    });

    it('should set error', () => {
      useAppStore.getState().setError('Something went wrong');
      expect(useAppStore.getState().error).toBe('Something went wrong');
    });

    it('should clear error', () => {
      useAppStore.getState().setError('Error');
      useAppStore.getState().clearError();
      expect(useAppStore.getState().error).toBeNull();
    });
  });

  // =========================================================================
  // Navigation Guard (TICKET_701)
  // =========================================================================

  describe('navigation guard (TICKET_701)', () => {
    it('should start with generationBusy false and no pending navigation', () => {
      const state = useAppStore.getState();
      expect(state.generationBusy).toBe(false);
      expect(state.pendingNavigation).toBeNull();
    });

    it('should set generationBusy state', () => {
      useAppStore.getState().setGenerationBusy(true);
      expect(useAppStore.getState().generationBusy).toBe(true);

      useAppStore.getState().setGenerationBusy(false);
      expect(useAppStore.getState().generationBusy).toBe(false);
    });

    // TICKET_1208_1: Navigation is no longer intercepted when generation is
    // busy. Generation runs in the main process and survives navigation.
    it('should allow navigation even when generationBusy is true', () => {
      useAppStore.getState().setGenerationBusy(true);
      useAppStore.getState().setActiveView('backtest');

      const state = useAppStore.getState();
      expect(state.activeView).toBe('backtest');
      expect(state.pendingNavigation).toBeNull();
    });

    it('should allow normal navigation when generationBusy is false', () => {
      useAppStore.getState().setGenerationBusy(false);
      useAppStore.getState().setActiveView('backtest');

      const state = useAppStore.getState();
      expect(state.activeView).toBe('backtest');
      expect(state.pendingNavigation).toBeNull();
    });

    it('confirmNavigation still works when pendingNavigation is set directly', () => {
      // pendingNavigation can still be set manually for backward compat
      useAppStore.setState({ pendingNavigation: 'strategy' });
      useAppStore.getState().confirmNavigation();

      const state = useAppStore.getState();
      expect(state.activeView).toBe('strategy');
      expect(state.pendingNavigation).toBeNull();
      expect(state.generationBusy).toBe(false);
    });

    it('cancelNavigation clears pending navigation', () => {
      // TICKET_1335_1: was 'data', a view TICKET_135 removed from the registry.
      // The value is incidental here -- the assertion is that cancel clears it --
      // so it now uses a real ViewId rather than one that cannot render.
      useAppStore.setState({ pendingNavigation: 'dataManagement' });
      useAppStore.getState().cancelNavigation();

      expect(useAppStore.getState().pendingNavigation).toBeNull();
    });

    it('should do nothing when confirmNavigation called with no pending navigation', () => {
      useAppStore.getState().setActiveView('backtest');
      const viewBefore = useAppStore.getState().activeView;

      useAppStore.getState().confirmNavigation();

      expect(useAppStore.getState().activeView).toBe(viewBefore);
    });
  });

  // =========================================================================
  // Other State
  // =========================================================================

  describe('other state', () => {
    it('should set loading state', () => {
      useAppStore.getState().setLoading(true);
      expect(useAppStore.getState().isLoading).toBe(true);

      useAppStore.getState().setLoading(false);
      expect(useAppStore.getState().isLoading).toBe(false);
    });

    it('should set page title (TICKET_591)', () => {
      useAppStore.getState().setPageTitle('My Strategy');
      expect(useAppStore.getState().pageTitle).toBe('My Strategy');

      useAppStore.getState().setPageTitle(null);
      expect(useAppStore.getState().pageTitle).toBeNull();
    });

    it('should set data management tab (TICKET_348)', () => {
      useAppStore.getState().setDataManagementTab('downloadQueue');
      expect(useAppStore.getState().dataManagementTab).toBe('downloadQueue');

      useAppStore.getState().setDataManagementTab('catalog');
      expect(useAppStore.getState().dataManagementTab).toBe('catalog');
    });

    it('should set immersive mode (TICKET_614)', () => {
      useAppStore.getState().setImmersiveMode(true);
      expect(useAppStore.getState().immersiveMode).toBe(true);

      useAppStore.getState().setImmersiveMode(false);
      expect(useAppStore.getState().immersiveMode).toBe(false);
    });

    it('should set server status', () => {
      useAppStore.getState().setServerStatus({ api: true, engine: true, mcp: false });
      const status = useAppStore.getState().serverStatus;
      expect(status.api).toBe(true);
      expect(status.engine).toBe(true);
      expect(status.mcp).toBe(false);
    });
  });

  // =========================================================================
  // TICKET_883: activeView persistence (partialize)
  // =========================================================================

  describe('partialize persistence (TICKET_883)', () => {
    // Access the partialize function from the persist middleware.
    // Zustand persist exposes it via useStore.persist.getOptions() but
    // in test environments without localStorage the persist API object
    // may be absent. Fall back to a manual snapshot comparison: set
    // state, then call persist.rehydrate() won't work either, so we
    // test via the exported store's own persist partialize contract by
    // comparing what JSON.parse(localStorage) would contain.
    //
    // Approach: the partialize fn is the ONLY filter between Zustand
    // state and localStorage. We test its contract by verifying that
    // specific keys ARE or ARE NOT present on the object it returns.
    // We extract it via the internal _persist property.
    function getPartialize() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = useAppStore as any;
      const persistApi = api.persist;
      if (persistApi?.getOptions) return persistApi.getOptions().partialize;
      if (persistApi?.options) return persistApi.options.partialize;
      return undefined;
    }

    // If the persist API is not reachable in this test env, skip
    // gracefully but test the observable consequence instead.
    const partialize = getPartialize();

    if (partialize) {
      it('should include activeView in partialize output', () => {
        useAppStore.getState().setActiveView('backtest');
        const persisted = partialize(useAppStore.getState());
        expect(persisted).toHaveProperty('activeView', 'backtest');
      });

      it('should include previousView in partialize output', () => {
        useAppStore.getState().setActiveView('backtest');
        useAppStore.getState().setActiveView('strategy');
        const persisted = partialize(useAppStore.getState());
        expect(persisted).toHaveProperty('previousView', 'backtest');
      });

      it('should include dataManagementTab in partialize output', () => {
        useAppStore.getState().setDataManagementTab('downloadQueue');
        const persisted = partialize(useAppStore.getState());
        expect(persisted).toHaveProperty('dataManagementTab', 'downloadQueue');
      });

      it('should NOT include volatile state in partialize output', () => {
        useAppStore.getState().setGenerationBusy(true);
        useAppStore.getState().setLoading(true);
        useAppStore.getState().setError('test');
        useAppStore.getState().setImmersiveMode(true);
        useAppStore.getState().pushSubPage({ label: 'test' });

        const persisted = partialize(useAppStore.getState());
        expect(persisted).not.toHaveProperty('generationBusy');
        expect(persisted).not.toHaveProperty('isLoading');
        expect(persisted).not.toHaveProperty('error');
        expect(persisted).not.toHaveProperty('immersiveMode');
        expect(persisted).not.toHaveProperty('subPagePath');
        expect(persisted).not.toHaveProperty('pageTitle');
        expect(persisted).not.toHaveProperty('pendingNavigation');
        expect(persisted).not.toHaveProperty('serverStatus');
      });

      it('partialize output should have exactly 4 keys', () => {
        const persisted = partialize(useAppStore.getState());
        expect(Object.keys(persisted)).toHaveLength(4);
      });
    } else {
      // Fallback: source-pin test that the store module contains the
      // expected partialize keys. Read the source and check the string.
      const { readFileSync } = require('fs');
      const { resolve } = require('path');
      const storePath = resolve(__dirname, '..', 'useAppStore.ts');
      const src = readFileSync(storePath, 'utf-8');

      it('source-pin: partialize includes activeView', () => {
        expect(src).toContain('activeView: state.activeView');
        expect(src).toContain('previousView: state.previousView');
        expect(src).toContain('dataManagementTab: state.dataManagementTab');
        expect(src).toContain('sidebarCollapsed: state.sidebarCollapsed');
      });

      it('source-pin: partialize does NOT include volatile state', () => {
        const partializeBlock = src.slice(
          src.indexOf('partialize:'),
          src.indexOf('})', src.indexOf('partialize:')) + 2,
        );
        expect(partializeBlock).not.toContain('generationBusy');
        expect(partializeBlock).not.toContain('isLoading');
        expect(partializeBlock).not.toContain('immersiveMode');
        expect(partializeBlock).not.toContain('subPagePath');
        expect(partializeBlock).not.toContain('pageTitle');
        expect(partializeBlock).not.toContain('pendingNavigation');
        expect(partializeBlock).not.toContain('serverStatus');
      });
    }
  });

});
