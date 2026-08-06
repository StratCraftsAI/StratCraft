/**
 * TICKET_634_3: View Registry Tests
 *
 * Tests for centralized view registry configuration and helper functions.
 * Validates data integrity, navigation helpers, and auth configuration.
 */
import { describe, it, expect } from 'vitest';
import {
  VIEW_REGISTRY,
  getViewConfig,
  getViewByPluginId,
  getViewIdByPluginId,
  getViewIdsByPluginId,
  isKnownViewId,
  getSidebarItems,
  getPluginHubViews,
  isPluginHub,
  getProviderName,
  getPluginHubAuthConfig,
  getAllViewIds,
  getPluginIconPath,
  type ViewId,
} from '../view-registry';

describe('VIEW_REGISTRY', () => {
  // =========================================================================
  // Registry Integrity
  // =========================================================================

  describe('data integrity', () => {
    it('should contain all expected ViewIds', () => {
      const expected: ViewId[] = [
        'nexus', 'strategy', 'backtest', 'backtestResult',
        'quantLab', 'signalGenerator', 'marketplace', 'dataManagement',
        'settings', 'researchEnvironment', 'chart', 'ai',
      ];
      for (const id of expected) {
        expect(VIEW_REGISTRY[id]).toBeDefined();
      }
      // Pinned so a view added to the registry without updating this list is a
      // failure rather than a silent omission -- the loop above only proves the
      // named ids EXIST, not that the list is complete.
      expect(Object.keys(VIEW_REGISTRY).sort()).toEqual([...expected].sort());
    });

    it('should have matching viewId in each entry', () => {
      for (const [key, config] of Object.entries(VIEW_REGISTRY)) {
        expect(config.viewId).toBe(key);
      }
    });

    it('should have a label for every view', () => {
      for (const config of Object.values(VIEW_REGISTRY)) {
        expect(config.label).toBeTruthy();
      }
    });

    it('should have a component for every view', () => {
      for (const config of Object.values(VIEW_REGISTRY)) {
        expect(config.component).toBeDefined();
      }
    });

    it('should have an icon for every view', () => {
      for (const config of Object.values(VIEW_REGISTRY)) {
        expect(config.icon).toBeDefined();
      }
    });

    it('should have a valid level for every view', () => {
      for (const config of Object.values(VIEW_REGISTRY)) {
        expect(['L1', 'L2', 'L3']).toContain(config.level);
      }
    });
  });

  // =========================================================================
  // Sidebar Items
  // =========================================================================

  describe('sidebar configuration', () => {
    it('should have sidebar items with sidebarOrder', () => {
      const items = getSidebarItems();
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.showInSidebar).toBe(true);
        expect(item.sidebarOrder).toBeDefined();
      }
    });

    it('should return sidebar items sorted by order', () => {
      const items = getSidebarItems();
      for (let i = 1; i < items.length; i++) {
        expect(items[i].sidebarOrder!).toBeGreaterThanOrEqual(items[i - 1].sidebarOrder!);
      }
    });

    it('should include nexus in sidebar', () => {
      const items = getSidebarItems();
      expect(items.some((i) => i.viewId === 'nexus')).toBe(true);
    });

    it('should not include settings in sidebar', () => {
      const items = getSidebarItems();
      expect(items.some((i) => i.viewId === 'settings')).toBe(false);
    });

    // TICKET_1335_1 AC1/D1: the bottom system-tool zone is rendered explicitly
    // by SidePanel after `flex-1`, not by sidebar ordering. A `sidebarOrder`
    // here would drop Research Environment among the product views.
    it('should not include researchEnvironment in the ordinary sidebar order', () => {
      const items = getSidebarItems();
      expect(items.some((i) => i.viewId === 'researchEnvironment')).toBe(false);
      expect(VIEW_REGISTRY['researchEnvironment'].showInSidebar).toBe(false);
      expect(VIEW_REGISTRY['researchEnvironment'].sidebarOrder).toBeUndefined();
    });

    it('registers researchEnvironment as a system-tool peer of settings', () => {
      const researchEnvironment = VIEW_REGISTRY['researchEnvironment'];
      const settings = VIEW_REGISTRY['settings'];
      // Peer, not a Settings subsection: same level and hub-ness, no parent.
      expect(researchEnvironment.level).toBe(settings.level);
      expect(researchEnvironment.isPluginHub).toBe(false);
      expect(researchEnvironment.parentViewId).toBeUndefined();
      // TICKET_638: no login gate on a local environment manager.
      expect(researchEnvironment.authRequired).toBeUndefined();
      // AC12: localized rather than hard-coded in the rail.
      expect(researchEnvironment.labelKey)
        .toBe('viewRegistry.researchEnvironment.label');
      expect(researchEnvironment.shortLabelKey)
        .toBe('viewRegistry.researchEnvironment.shortLabel');
    });
  });

  // =========================================================================
  // Plugin Hub Configuration
  // =========================================================================

  describe('plugin hub views', () => {
    it('should identify plugin hubs correctly', () => {
      expect(isPluginHub('strategy')).toBe(true);
      expect(isPluginHub('backtest')).toBe(true);
      expect(isPluginHub('quantLab')).toBe(true);
      expect(isPluginHub('signalGenerator')).toBe(true);
    });

    it('should identify non-plugin hubs', () => {
      expect(isPluginHub('nexus')).toBe(false);
      expect(isPluginHub('settings')).toBe(false);
      expect(isPluginHub('backtestResult')).toBe(false);
    });

    it('should return provider names for plugin hubs', () => {
      expect(getProviderName('strategy')).toBe('StratForge');
      expect(getProviderName('backtest')).toBe('Backtester');
      expect(getProviderName('quantLab')).toBe('Sigma');
    });

    it('should return undefined provider for non-plugin hubs', () => {
      expect(getProviderName('nexus')).toBeUndefined();
      expect(getProviderName('settings')).toBeUndefined();
    });

    it('should return all plugin hub views', () => {
      const hubs = getPluginHubViews();
      expect(hubs.length).toBeGreaterThanOrEqual(3);
      for (const hub of hubs) {
        expect(hub.isPluginHub).toBe(true);
      }
    });
  });

  // =========================================================================
  // Helper Functions
  // =========================================================================

  describe('getViewConfig', () => {
    it('should return config for valid viewId', () => {
      const config = getViewConfig('nexus');
      expect(config.viewId).toBe('nexus');
      expect(config.label).toBe('Nexus Hub');
    });
  });

  describe('getViewByPluginId', () => {
    it('should find view by plugin id', () => {
      // strategy has a pluginId
      const strategyConfig = VIEW_REGISTRY['strategy'];
      if (strategyConfig.pluginId) {
        const found = getViewByPluginId(strategyConfig.pluginId);
        expect(found?.viewId).toBe('strategy');
      }
    });

    it('should return undefined for unknown plugin id', () => {
      expect(getViewByPluginId('com.unknown.plugin')).toBeUndefined();
    });
  });

  describe('getViewIdByPluginId', () => {
    it('should return viewId for known plugin', () => {
      const strategyConfig = VIEW_REGISTRY['strategy'];
      if (strategyConfig.pluginId) {
        expect(getViewIdByPluginId(strategyConfig.pluginId)).toBe('strategy');
      }
    });

    it('should return undefined for unknown plugin', () => {
      expect(getViewIdByPluginId('nonexistent')).toBeUndefined();
    });
  });

  // TICKET_1231_1: derived onView single source of truth
  describe('getViewIdsByPluginId', () => {
    it('returns ALL views a plugin owns (backtest owns backtest + backtestResult)', () => {
      const backtestPluginId = VIEW_REGISTRY['backtest'].pluginId;
      expect(backtestPluginId).toBeDefined();
      expect(getViewIdsByPluginId(backtestPluginId as string).sort()).toEqual(
        ['backtest', 'backtestResult'].sort()
      );
    });

    it('returns the single view for a single-view plugin', () => {
      const sgPluginId = VIEW_REGISTRY['signalGenerator'].pluginId;
      expect(getViewIdsByPluginId(sgPluginId as string)).toEqual(['signalGenerator']);
    });

    it('returns an empty array for a plugin with no registered view', () => {
      expect(getViewIdsByPluginId('nonexistent')).toEqual([]);
    });
  });

  // TICKET_1231_1: explicit onView:<id> load-time validation predicate
  describe('isKnownViewId', () => {
    it('accepts registered view ids', () => {
      expect(isKnownViewId('signalGenerator')).toBe(true);
      expect(isKnownViewId('backtest')).toBe(true);
    });

    it('rejects unregistered strings (including plugin-internal ids)', () => {
      expect(isKnownViewId('signalGenerator.main')).toBe(false);
      expect(isKnownViewId('')).toBe(false);
    });
  });

  describe('getAllViewIds', () => {
    it('should return all view ids', () => {
      const ids = getAllViewIds();
      expect(ids).toContain('nexus');
      expect(ids).toContain('strategy');
      expect(ids).toContain('settings');
      expect(ids.length).toBe(Object.keys(VIEW_REGISTRY).length);
    });
  });

  describe('getPluginHubAuthConfig', () => {
    it('should return auth config for plugin hub', () => {
      const config = getPluginHubAuthConfig('strategy');
      expect(config).toBeDefined();
      expect(config!.isPluginHub).toBe(true);
      expect(config!.providerName).toBe('StratForge');
      // TICKET_638: authRequired removed from all pages
      expect(config!.authRequired).toBeUndefined();
    });

    it('should return config for non-plugin hub views', () => {
      const config = getPluginHubAuthConfig('nexus');
      expect(config).toBeDefined();
      expect(config!.isPluginHub).toBe(false);
    });

    it('should return undefined for invalid viewId', () => {
      expect(getPluginHubAuthConfig('nonexistent')).toBeUndefined();
    });
  });

  describe('getPluginIconPath', () => {
    it('should return icon path for views with custom icons', () => {
      const strategyConfig = VIEW_REGISTRY['strategy'];
      if (strategyConfig.pluginId) {
        const path = getPluginIconPath(strategyConfig.pluginId);
        expect(path).toBe('/images/plugin_line_icon.png');
      }
    });

    it('should return undefined for unknown plugin', () => {
      expect(getPluginIconPath('unknown-plugin')).toBeUndefined();
    });
  });

  // =========================================================================
  // Parent View (Breadcrumb Hierarchy)
  // =========================================================================

  describe('parent view hierarchy', () => {
    it('backtestResult should have backtest as parent', () => {
      expect(VIEW_REGISTRY['backtestResult'].parentViewId).toBe('backtest');
    });

    it('top-level views should not have parents', () => {
      expect(VIEW_REGISTRY['nexus'].parentViewId).toBeUndefined();
      expect(VIEW_REGISTRY['strategy'].parentViewId).toBeUndefined();
      expect(VIEW_REGISTRY['settings'].parentViewId).toBeUndefined();
    });
  });
});
