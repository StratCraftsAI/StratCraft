/**
 * PersistenceManager Unit Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 * Tests state persistence, migration, plugin management, and lifecycle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const mockStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  clear: vi.fn(() => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }),
});

import { persistenceManager } from '../persistence-manager';
import { FRAMEWORK_STATE_DEFAULTS, STORAGE_KEYS } from '../types';

// =============================================================================
// Tests
// =============================================================================

describe('PersistenceManager', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    vi.clearAllMocks();
    // Reset to defaults before each test
    persistenceManager.reset();
  });

  // =========================================================================
  // Initialization
  // =========================================================================

  describe('initialization', () => {
    it('should be a singleton', () => {
      expect(persistenceManager).toBeDefined();
      expect(typeof persistenceManager.initialize).toBe('function');
    });

    it('should initialize and load defaults when no stored state', () => {
      persistenceManager.initialize();

      expect(persistenceManager.isInitialized()).toBe(true);
      const state = persistenceManager.getFrameworkState();
      expect(state.activeView).toBe('nexus');
      expect(state.sidebarCollapsed).toBe(false);
      expect(state.enabledPlugins).toEqual([]);
      expect(state._version).toBe(1);
    });
  });

  // =========================================================================
  // Framework State
  // =========================================================================

  describe('framework state', () => {
    it('should return a copy, not a reference', () => {
      persistenceManager.initialize();

      const state1 = persistenceManager.getFrameworkState();
      const state2 = persistenceManager.getFrameworkState();
      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });

    it('should update partial state', () => {
      persistenceManager.initialize();

      persistenceManager.updateFrameworkState({ activeView: 'settings' });
      expect(persistenceManager.getFrameworkState().activeView).toBe('settings');
      expect(persistenceManager.getFrameworkState().sidebarCollapsed).toBe(false); // unchanged
    });

    it('should persist updates to localStorage', () => {
      persistenceManager.initialize();
      vi.clearAllMocks();

      persistenceManager.updateFrameworkState({ sidebarCollapsed: true });
      expect(localStorage.setItem).toHaveBeenCalled();

      const stored = JSON.parse(mockStorage[STORAGE_KEYS.FRAMEWORK]);
      expect(stored.sidebarCollapsed).toBe(true);
    });
  });

  // =========================================================================
  // Convenience Methods
  // =========================================================================

  describe('convenience methods', () => {
    beforeEach(() => {
      persistenceManager.initialize();
    });

    it('getActiveView / setActiveView', () => {
      expect(persistenceManager.getActiveView()).toBe('nexus');
      persistenceManager.setActiveView('chart');
      expect(persistenceManager.getActiveView()).toBe('chart');
    });

    it('getEnabledPlugins returns a copy', () => {
      const plugins = persistenceManager.getEnabledPlugins();
      plugins.push('injected');
      expect(persistenceManager.getEnabledPlugins()).toEqual([]); // original unaffected
    });

    it('addEnabledPlugin / removeEnabledPlugin / isPluginEnabled', () => {
      persistenceManager.addEnabledPlugin('com.stratcraft.test');
      expect(persistenceManager.isPluginEnabled('com.stratcraft.test')).toBe(true);
      expect(persistenceManager.getEnabledPlugins()).toEqual(['com.stratcraft.test']);

      // Duplicate add is idempotent
      persistenceManager.addEnabledPlugin('com.stratcraft.test');
      expect(persistenceManager.getEnabledPlugins()).toEqual(['com.stratcraft.test']);

      persistenceManager.removeEnabledPlugin('com.stratcraft.test');
      expect(persistenceManager.isPluginEnabled('com.stratcraft.test')).toBe(false);

      // Removing non-existent is no-op
      persistenceManager.removeEnabledPlugin('nonexistent');
      expect(persistenceManager.getEnabledPlugins()).toEqual([]);
    });
  });

  // =========================================================================
  // Plugin State
  // =========================================================================

  describe('plugin state', () => {
    beforeEach(() => {
      persistenceManager.initialize();
    });

    it('should get/set/clear plugin state', () => {
      expect(persistenceManager.getPluginState('com.test')).toBeNull();

      persistenceManager.setPluginState('com.test', { color: 'blue' });
      expect(persistenceManager.getPluginState('com.test')).toEqual({ color: 'blue' });

      persistenceManager.clearPluginState('com.test');
      expect(persistenceManager.getPluginState('com.test')).toBeNull();
    });

    it('should persist plugin state with wrapper', () => {
      persistenceManager.setPluginState('com.test', { x: 1 });

      const stored = JSON.parse(mockStorage[STORAGE_KEYS.PLUGIN_PREFIX + 'com.test']);
      expect(stored.pluginId).toBe('com.test');
      expect(stored._version).toBe(1);
      expect(stored.data).toEqual({ x: 1 });
      expect(stored.updatedAt).toBeGreaterThan(0);
    });

    it('should handle corrupted plugin state gracefully', () => {
      mockStorage[STORAGE_KEYS.PLUGIN_PREFIX + 'com.bad'] = 'not-json{';
      expect(persistenceManager.getPluginState('com.bad')).toBeNull();
    });
  });

  // =========================================================================
  // Subscription
  // =========================================================================

  describe('subscription', () => {
    beforeEach(() => {
      persistenceManager.initialize();
    });

    it('should notify listeners on state change', () => {
      const listener = vi.fn();
      persistenceManager.subscribeFrameworkState(listener);

      persistenceManager.updateFrameworkState({ activeView: 'data' });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ activeView: 'data' }));
    });

    it('should unsubscribe correctly', () => {
      const listener = vi.fn();
      const unsub = persistenceManager.subscribeFrameworkState(listener);
      unsub();

      persistenceManager.updateFrameworkState({ activeView: 'data' });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Lifecycle
  // =========================================================================

  describe('lifecycle', () => {
    beforeEach(() => {
      persistenceManager.initialize();
    });

    it('flush should save current state', () => {
      vi.clearAllMocks();
      persistenceManager.flush();
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('reset should restore defaults', () => {
      persistenceManager.updateFrameworkState({ activeView: 'settings', sidebarCollapsed: true });

      persistenceManager.reset();

      const state = persistenceManager.getFrameworkState();
      expect(state.activeView).toBe('nexus');
      expect(state.sidebarCollapsed).toBe(false);
      expect(state.enabledPlugins).toEqual([]);
    });

    it('reset should notify listeners', () => {
      const listener = vi.fn();
      persistenceManager.subscribeFrameworkState(listener);

      persistenceManager.reset();
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ activeView: 'nexus' }));
    });
  });

  // =========================================================================
  // STORAGE_KEYS and FRAMEWORK_STATE_DEFAULTS
  // =========================================================================

  describe('types', () => {
    it('STORAGE_KEYS should have expected keys', () => {
      expect(STORAGE_KEYS.FRAMEWORK).toBe('StratCraft:framework');
      expect(STORAGE_KEYS.APP_STATE).toBe('StratCraft:app-state');
      expect(STORAGE_KEYS.THEME).toBe('StratCraft-theme');
      expect(STORAGE_KEYS.PLUGIN_PREFIX).toBe('StratCraft:plugin:');
    });

    it('FRAMEWORK_STATE_DEFAULTS should have expected values', () => {
      expect(FRAMEWORK_STATE_DEFAULTS._version).toBe(1);
      expect(FRAMEWORK_STATE_DEFAULTS.activeView).toBe('nexus');
      expect(FRAMEWORK_STATE_DEFAULTS.sidebarCollapsed).toBe(false);
      expect(FRAMEWORK_STATE_DEFAULTS.enabledPlugins).toEqual([]);
    });
  });
});
