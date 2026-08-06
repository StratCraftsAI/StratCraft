/**
 * PersistenceManager - Centralized State Persistence
 *
 * Manages framework and plugin state persistence to localStorage.
 *
 * @see TICKET_007 - PersistenceManager design
 */

import {
  type FrameworkPersistentState,
  type PluginPersistentState,
  type ViewId,
  FRAMEWORK_STATE_DEFAULTS,
  STORAGE_KEYS,
} from './types';
import { safeForEach } from '../../../shared/utils/safe-emit';

// =============================================================================
// Constants
// =============================================================================

// TICKET_135: V3 deprecated plugins - filter on load
const DEPRECATED_PLUGIN_IDS = [
  'com.stratcraft.data-source-nexus', // V3: Data merged into Backtest module
] as const;

// TICKET_616: Migrate old com.quantnexus.* plugin IDs to com.stratcraft.* (TICKET_561 rename)
const OLD_PLUGIN_PREFIX = 'com.quantnexus.';
const NEW_PLUGIN_PREFIX = 'com.stratcraft.';

// =============================================================================
// Types
// =============================================================================

type FrameworkStateListener = (state: FrameworkPersistentState) => void;

// =============================================================================
// PersistenceManager Class
// =============================================================================

/**
 * PersistenceManager - Centralized state persistence
 *
 * Responsibilities:
 * 1. Load persisted state on app startup
 * 2. Save state changes to localStorage
 * 3. Provide type-safe access to persistent state
 * 4. Handle migration between versions
 */
class PersistenceManager {
  private frameworkState: FrameworkPersistentState;
  private listeners: Set<FrameworkStateListener> = new Set();
  private initialized = false;

  constructor() {
    this.frameworkState = { ...FRAMEWORK_STATE_DEFAULTS };
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize persistence manager
   * Loads persisted state from storage
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.loadFrameworkState();
    this.initialized = true;

    console.info('[PersistenceManager] Initialized with state:', {
      activeView: this.frameworkState.activeView,
      sidebarCollapsed: this.frameworkState.sidebarCollapsed,
      enabledPlugins: this.frameworkState.enabledPlugins,
    });
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ===========================================================================
  // Framework State
  // ===========================================================================

  /**
   * Get current framework state
   */
  getFrameworkState(): FrameworkPersistentState {
    return { ...this.frameworkState };
  }

  /**
   * Update framework state (partial update)
   */
  updateFrameworkState(partial: Partial<FrameworkPersistentState>): void {
    const previousState = { ...this.frameworkState };

    this.frameworkState = {
      ...this.frameworkState,
      ...partial,
    };

    this.saveFrameworkState();
    this.notifyListeners();

    // Log changes
    const changes: string[] = [];
    for (const key of Object.keys(partial) as (keyof FrameworkPersistentState)[]) {
      if (key !== '_version') {
        changes.push(`${key}: ${JSON.stringify(previousState[key])} -> ${JSON.stringify(this.frameworkState[key])}`);
      }
    }
    if (changes.length > 0) {
      console.info('[PersistenceManager] State updated:', changes.join(', '));
    }
  }

  /**
   * Subscribe to framework state changes
   */
  subscribeFrameworkState(listener: FrameworkStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ===========================================================================
  // Convenience Methods for Framework State
  // ===========================================================================

  /**
   * Get current active view
   */
  getActiveView(): ViewId {
    return this.frameworkState.activeView;
  }

  /**
   * Set active view
   */
  setActiveView(viewId: ViewId): void {
    this.updateFrameworkState({ activeView: viewId });
  }

  /**
   * Get enabled plugins list
   */
  getEnabledPlugins(): string[] {
    return [...this.frameworkState.enabledPlugins];
  }

  /**
   * Add plugin to enabled list
   */
  addEnabledPlugin(pluginId: string): void {
    if (this.frameworkState.enabledPlugins.includes(pluginId)) {
      return;
    }
    this.updateFrameworkState({
      enabledPlugins: [...this.frameworkState.enabledPlugins, pluginId],
    });
  }

  /**
   * Remove plugin from enabled list
   */
  removeEnabledPlugin(pluginId: string): void {
    if (!this.frameworkState.enabledPlugins.includes(pluginId)) {
      return;
    }
    this.updateFrameworkState({
      enabledPlugins: this.frameworkState.enabledPlugins.filter(
        (id) => id !== pluginId
      ),
    });
  }

  /**
   * Check if plugin is enabled
   */
  isPluginEnabled(pluginId: string): boolean {
    return this.frameworkState.enabledPlugins.includes(pluginId);
  }

  // ===========================================================================
  // Plugin State (Reserved for Phase 2)
  // ===========================================================================

  /**
   * Get plugin-specific state
   * @param pluginId Plugin identifier
   */
  getPluginState<T>(pluginId: string): T | null {
    const key = STORAGE_KEYS.PLUGIN_PREFIX + pluginId;
    try {
      const stored = localStorage.getItem(key);
      if (!stored) {
        return null;
      }
      const parsed: PluginPersistentState<T> = JSON.parse(stored);
      return parsed.data;
    } catch (error) {
      console.warn(`[W:PERSISTENCE:LOAD_PLUGIN_FAILED] [PersistenceManager] Failed to load plugin state for ${pluginId}:`, error);
      return null;
    }
  }

  /**
   * Update plugin-specific state
   * @param pluginId Plugin identifier
   * @param state Plugin state to persist
   */
  setPluginState<T>(pluginId: string, state: T): void {
    const key = STORAGE_KEYS.PLUGIN_PREFIX + pluginId;
    const wrapper: PluginPersistentState<T> = {
      pluginId,
      _version: 1,
      data: state,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(key, JSON.stringify(wrapper));
    } catch (error) {
      console.error(`[E:PERSISTENCE:SAVE_PLUGIN_FAILED] [PersistenceManager] Failed to save plugin state for ${pluginId}:`, error);
    }
  }

  /**
   * Clear plugin state
   * @param pluginId Plugin identifier
   */
  clearPluginState(pluginId: string): void {
    const key = STORAGE_KEYS.PLUGIN_PREFIX + pluginId;
    localStorage.removeItem(key);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Force save all pending state
   */
  flush(): void {
    this.saveFrameworkState();
  }

  /**
   * Clear all persisted state (reset to defaults)
   */
  reset(): void {
    this.frameworkState = { ...FRAMEWORK_STATE_DEFAULTS };
    this.saveFrameworkState();
    this.notifyListeners();
    console.info('[PersistenceManager] State reset to defaults');
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private loadFrameworkState(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.FRAMEWORK);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.frameworkState = this.migrateFrameworkState(parsed);
      }
    } catch (error) {
      console.warn('[W:PERSISTENCE:LOAD_FRAMEWORK_FAILED] [PersistenceManager] Failed to load framework state, using defaults:', error);
      this.frameworkState = { ...FRAMEWORK_STATE_DEFAULTS };
    }
  }

  private saveFrameworkState(): void {
    try {
      localStorage.setItem(
        STORAGE_KEYS.FRAMEWORK,
        JSON.stringify(this.frameworkState)
      );
    } catch (error) {
      console.error('[E:PERSISTENCE:SAVE_FRAMEWORK_FAILED] [PersistenceManager] Failed to save framework state:', error);
    }
  }

  private migrateFrameworkState(stored: unknown): FrameworkPersistentState {
    // Type guard
    if (!stored || typeof stored !== 'object') {
      return { ...FRAMEWORK_STATE_DEFAULTS };
    }

    const state = stored as Partial<FrameworkPersistentState>;
    const version = state._version || 0;

    // Migration logic (for future versions)
    if (version < 1) {
      // Version 0 -> 1: Initial schema
      console.info('[PersistenceManager] Migrating state from version 0 to 1');
    }

    // Merge with defaults to ensure all fields exist
    // TICKET_616: Migrate old com.quantnexus.* IDs to com.stratcraft.* before filtering
    const rawPlugins = Array.isArray(state.enabledPlugins)
      ? state.enabledPlugins
      : FRAMEWORK_STATE_DEFAULTS.enabledPlugins;
    const migratedPlugins = rawPlugins.map((id) =>
      id.startsWith(OLD_PLUGIN_PREFIX)
        ? `${NEW_PLUGIN_PREFIX}${id.slice(OLD_PLUGIN_PREFIX.length)}`
        : id
    );
    // TICKET_135: Filter deprecated plugins on load
    const filteredPlugins = migratedPlugins.filter(
      (id) => !DEPRECATED_PLUGIN_IDS.includes(id as typeof DEPRECATED_PLUGIN_IDS[number])
    );
    // Deduplicate (in case both old and new IDs were present)
    const uniquePlugins = [...new Set(filteredPlugins)];

    return {
      ...FRAMEWORK_STATE_DEFAULTS,
      ...state,
      _version: FRAMEWORK_STATE_DEFAULTS._version,
      enabledPlugins: uniquePlugins,
    };
  }

  private notifyListeners(): void {
    safeForEach(this.listeners, '[E:PERSISTENCE:LISTENER_ERROR] [PersistenceManager] Listener error:', this.getFrameworkState());
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

export const persistenceManager = new PersistenceManager();

// =============================================================================
// React Hook
// =============================================================================

import { useEffect, useState, useCallback } from 'react';

/**
 * React hook for accessing persistence manager
 */
export function usePersistence() {
  const [state, setState] = useState<FrameworkPersistentState>(
    persistenceManager.getFrameworkState()
  );

  useEffect(() => {
    // Initialize if not already done
    if (!persistenceManager.isInitialized()) {
      persistenceManager.initialize();
      setState(persistenceManager.getFrameworkState());
    }

    // Subscribe to changes
    const unsubscribe = persistenceManager.subscribeFrameworkState(setState);
    return unsubscribe;
  }, []);

  const updateState = useCallback(
    (partial: Partial<FrameworkPersistentState>) => {
      persistenceManager.updateFrameworkState(partial);
    },
    []
  );

  return {
    state,
    updateState,
    addEnabledPlugin: persistenceManager.addEnabledPlugin.bind(persistenceManager),
    removeEnabledPlugin: persistenceManager.removeEnabledPlugin.bind(persistenceManager),
    isPluginEnabled: persistenceManager.isPluginEnabled.bind(persistenceManager),
  };
}
