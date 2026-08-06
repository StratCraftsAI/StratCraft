/**
 * Plugin State Management
 *
 * Integrates with PluginManager and provides reactive state.
 * Persists enabled plugins via PersistenceManager (TICKET_007).
 */

import { create } from 'zustand';
import i18n from 'i18next';
import { persistenceManager } from '@/services/persistence';
import type {
  PluginInstance,
  PluginManifest,
  MainViewContribution,
  SidePanelContribution,
  BottomPanelContribution,
  ToolbarContribution,
  CommandContribution,
} from '@shared/types';

// =============================================================================
// Types
// =============================================================================

interface PluginContributions {
  mainViews: Array<{ pluginId: string; contribution: MainViewContribution[] | undefined }>;
  sidePanels: Array<{ pluginId: string; contribution: SidePanelContribution[] | undefined }>;
  bottomPanels: Array<{ pluginId: string; contribution: BottomPanelContribution[] | undefined }>;
  toolbars: Array<{ pluginId: string; contribution: ToolbarContribution[] | undefined }>;
  commands: Array<{ pluginId: string; contribution: CommandContribution[] | undefined }>;
}

interface PluginState {
  // Plugin list
  plugins: Map<string, PluginInstance>;

  // UI contribution points
  contributions: PluginContributions;

  // Loading state
  initialized: boolean;
  isLoading: boolean;
  loadingPluginId: string | null;

  // Error message
  error: string | null;

  // Get plugin
  getPlugin: (id: string) => PluginInstance | undefined;

  // Get active plugins
  getActivePlugins: () => PluginInstance[];

  // Register plugins (from PluginManager)
  syncPlugins: (plugins: PluginInstance[]) => void;

  // Update contribution points
  updateContributions: (contributions: PluginContributions) => void;

  // Enable/disable plugins
  enablePlugin: (id: string) => Promise<void>;
  disablePlugin: (id: string) => Promise<void>;

  // Update plugin config
  updatePluginConfig: (id: string, config: Record<string, unknown>) => void;

  // Set loading state
  setLoading: (loading: boolean, pluginId?: string | null) => void;
  setInitialized: (initialized: boolean) => void;
  setError: (error: string | null) => void;
}

// =============================================================================
// Store
// =============================================================================

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: new Map(),
  contributions: {
    mainViews: [],
    sidePanels: [],
    bottomPanels: [],
    toolbars: [],
    commands: [],
  },
  initialized: false,
  isLoading: false,
  loadingPluginId: null,
  error: null,

  getPlugin: (id) => get().plugins.get(id),

  getActivePlugins: () => {
    const plugins = get().plugins;
    return Array.from(plugins.values()).filter(p => p.state.active);
  },

  syncPlugins: (pluginsList) => {
    const plugins = new Map<string, PluginInstance>();
    for (const plugin of pluginsList) {
      plugins.set(plugin.manifest.id, plugin);
    }
    set({ plugins });
  },

  updateContributions: (contributions) => {
    set({ contributions });
  },

  enablePlugin: async (id) => {
    set({ isLoading: true, loadingPluginId: id, error: null });

    try {
      // Activate via PluginManager
      const { getPluginManager } = await import('@/lib/plugin-manager');
      const manager = getPluginManager();
      const success = await manager.activatePlugin(id);

      if (!success) {
        set({
          isLoading: false,
          loadingPluginId: null,
          error: i18n.t('renderer.plugin.failedToActivate', { ns: 'errors', id }),
        });
        return;
      }

      // Persist enabled plugin (TICKET_007)
      persistenceManager.addEnabledPlugin(id);

      // Sync state
      get().syncPlugins(manager.getAllPlugins());
      get().updateContributions(manager.getContributions());

      set({ isLoading: false, loadingPluginId: null });
    } catch (error) {
      set({
        isLoading: false,
        loadingPluginId: null,
        error: error instanceof Error ? error.message : i18n.t('MSG_UNKNOWN_ERROR', { ns: 'errors' }),
      });
    }
  },

  disablePlugin: async (id) => {
    set({ isLoading: true, loadingPluginId: id, error: null });

    try {
      const { getPluginManager } = await import('@/lib/plugin-manager');
      const manager = getPluginManager();
      await manager.deactivatePlugin(id);

      // Remove from persisted enabled plugins (TICKET_007)
      persistenceManager.removeEnabledPlugin(id);

      // Sync state
      get().syncPlugins(manager.getAllPlugins());
      get().updateContributions(manager.getContributions());

      set({ isLoading: false, loadingPluginId: null });
    } catch (error) {
      set({
        isLoading: false,
        loadingPluginId: null,
        error: error instanceof Error ? error.message : i18n.t('MSG_UNKNOWN_ERROR', { ns: 'errors' }),
      });
    }
  },

  updatePluginConfig: (id, config) => {
    set((state) => {
      const plugins = new Map(state.plugins);
      const plugin = plugins.get(id);
      if (plugin) {
        plugin.state.config = config;
        plugin.api?.setConfig?.(config);
      }
      return { plugins };
    });
  },

  setLoading: (loading, pluginId = null) => {
    set({ isLoading: loading, loadingPluginId: pluginId });
  },

  setInitialized: (initialized) => {
    set({ initialized });
  },

  setError: (error) => {
    set({ error });
  },
}));
