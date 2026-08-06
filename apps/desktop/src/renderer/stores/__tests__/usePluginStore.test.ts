/**
 * TICKET_634_3: usePluginStore Tests
 *
 * Tests for plugin state management store.
 * Validates sync, contribution updates, loading, and error states.
 * Note: enablePlugin/disablePlugin require PluginManager and are tested separately.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/persistence', () => ({
  persistenceManager: {
    addEnabledPlugin: vi.fn(),
    removeEnabledPlugin: vi.fn(),
  },
}));

import { usePluginStore } from '../usePluginStore';
import type { PluginInstance, PluginManifest } from '@shared/types';

function makePlugin(id: string, active = false): PluginInstance {
  return {
    manifest: { id, name: `Plugin ${id}`, version: '1.0.0' } as PluginManifest,
    state: { active, loaded: true, config: {} },
    api: undefined,
    module: undefined,
  } as unknown as PluginInstance;
}

describe('usePluginStore', () => {
  beforeEach(() => {
    usePluginStore.setState({
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
    });
  });

  describe('syncPlugins', () => {
    it('should sync empty plugin list', () => {
      usePluginStore.getState().syncPlugins([]);
      expect(usePluginStore.getState().plugins.size).toBe(0);
    });

    it('should sync plugin list and index by manifest.id', () => {
      const plugins = [makePlugin('p1'), makePlugin('p2'), makePlugin('p3')];
      usePluginStore.getState().syncPlugins(plugins);

      expect(usePluginStore.getState().plugins.size).toBe(3);
      expect(usePluginStore.getState().getPlugin('p1')).toBeDefined();
      expect(usePluginStore.getState().getPlugin('p2')).toBeDefined();
    });

    it('should replace existing plugins on re-sync', () => {
      usePluginStore.getState().syncPlugins([makePlugin('p1'), makePlugin('p2')]);
      usePluginStore.getState().syncPlugins([makePlugin('p3')]);

      expect(usePluginStore.getState().plugins.size).toBe(1);
      expect(usePluginStore.getState().getPlugin('p1')).toBeUndefined();
      expect(usePluginStore.getState().getPlugin('p3')).toBeDefined();
    });
  });

  describe('getPlugin', () => {
    it('should return undefined for unknown plugin', () => {
      expect(usePluginStore.getState().getPlugin('unknown')).toBeUndefined();
    });

    it('should return plugin by id', () => {
      usePluginStore.getState().syncPlugins([makePlugin('test-plugin')]);
      const plugin = usePluginStore.getState().getPlugin('test-plugin');
      expect(plugin).toBeDefined();
      expect(plugin!.manifest.id).toBe('test-plugin');
    });
  });

  describe('getActivePlugins', () => {
    it('should return only active plugins', () => {
      usePluginStore.getState().syncPlugins([
        makePlugin('p1', true),
        makePlugin('p2', false),
        makePlugin('p3', true),
      ]);

      const active = usePluginStore.getState().getActivePlugins();
      expect(active).toHaveLength(2);
      expect(active.map((p) => p.manifest.id).sort()).toEqual(['p1', 'p3']);
    });

    it('should return empty array when no active plugins', () => {
      usePluginStore.getState().syncPlugins([makePlugin('p1', false)]);
      expect(usePluginStore.getState().getActivePlugins()).toHaveLength(0);
    });
  });

  describe('updateContributions', () => {
    it('should update contribution points', () => {
      usePluginStore.getState().updateContributions({
        mainViews: [{ pluginId: 'p1', contribution: [] }],
        sidePanels: [],
        bottomPanels: [],
        toolbars: [],
        commands: [],
      });

      expect(usePluginStore.getState().contributions.mainViews).toHaveLength(1);
    });
  });

  describe('updatePluginConfig', () => {
    it('should update config for existing plugin', () => {
      usePluginStore.getState().syncPlugins([makePlugin('p1')]);
      usePluginStore.getState().updatePluginConfig('p1', { theme: 'dark' });

      const plugin = usePluginStore.getState().getPlugin('p1');
      expect(plugin!.state.config).toEqual({ theme: 'dark' });
    });

    it('should not throw for unknown plugin', () => {
      expect(() => {
        usePluginStore.getState().updatePluginConfig('unknown', { key: 'value' });
      }).not.toThrow();
    });
  });

  describe('loading and error states', () => {
    it('should set loading state', () => {
      usePluginStore.getState().setLoading(true, 'p1');
      expect(usePluginStore.getState().isLoading).toBe(true);
      expect(usePluginStore.getState().loadingPluginId).toBe('p1');
    });

    it('should clear loading state', () => {
      usePluginStore.getState().setLoading(true, 'p1');
      usePluginStore.getState().setLoading(false);
      expect(usePluginStore.getState().isLoading).toBe(false);
      expect(usePluginStore.getState().loadingPluginId).toBeNull();
    });

    it('should set initialized', () => {
      usePluginStore.getState().setInitialized(true);
      expect(usePluginStore.getState().initialized).toBe(true);
    });

    it('should set and clear error', () => {
      usePluginStore.getState().setError('Plugin failed');
      expect(usePluginStore.getState().error).toBe('Plugin failed');

      usePluginStore.getState().setError(null);
      expect(usePluginStore.getState().error).toBeNull();
    });
  });
});
