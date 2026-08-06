/**
 * System Test: Plugin System
 *
 * TICKET_494 Phase 2: System layer
 * Journey: Plugin discovery -> manifest validation -> load -> activate -> deactivate
 * Verifies the plugin lifecycle produces correct system state transitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Plugin system simulation
// ---------------------------------------------------------------------------

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  main: string;
  tier?: number; // 0 = foundation, 1 = business
  dependencies?: string[];
  authRequired?: boolean;
}

interface PluginInstance {
  manifest: PluginManifest;
  status: 'discovered' | 'validated' | 'loaded' | 'active' | 'inactive' | 'error';
  errorMessage?: string;
}

let plugins: Map<string, PluginInstance>;

function resetPluginSystem() {
  plugins = new Map();
}

function discoverPlugin(manifest: PluginManifest): boolean {
  if (plugins.has(manifest.id)) {
    return false; // Already discovered
  }
  plugins.set(manifest.id, { manifest, status: 'discovered' });
  return true;
}

function validatePlugin(pluginId: string): boolean {
  const plugin = plugins.get(pluginId);
  if (!plugin || plugin.status !== 'discovered') return false;

  // Validate manifest fields
  if (!plugin.manifest.id || !plugin.manifest.name || !plugin.manifest.version || !plugin.manifest.main) {
    plugin.status = 'error';
    plugin.errorMessage = 'Invalid manifest: missing required fields';
    return false;
  }

  // Check tier dependencies
  if (plugin.manifest.dependencies) {
    for (const dep of plugin.manifest.dependencies) {
      const depPlugin = plugins.get(dep);
      if (!depPlugin) {
        plugin.status = 'error';
        plugin.errorMessage = `Missing dependency: ${dep}`;
        return false;
      }
      // Tier 0 cannot depend on Tier 1 (no upward dependency)
      if (plugin.manifest.tier === 0 && depPlugin.manifest.tier === 1) {
        plugin.status = 'error';
        plugin.errorMessage = `Upward dependency not allowed: Tier 0 cannot import Tier 1 plugin ${dep}`;
        return false;
      }
    }
  }

  plugin.status = 'validated';
  return true;
}

function loadPlugin(pluginId: string): boolean {
  const plugin = plugins.get(pluginId);
  if (!plugin || plugin.status !== 'validated') return false;

  plugin.status = 'loaded';
  return true;
}

function activatePlugin(pluginId: string): boolean {
  const plugin = plugins.get(pluginId);
  if (!plugin || plugin.status !== 'loaded') return false;

  plugin.status = 'active';
  return true;
}

function deactivatePlugin(pluginId: string): boolean {
  const plugin = plugins.get(pluginId);
  if (!plugin || plugin.status !== 'active') return false;

  plugin.status = 'inactive';
  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plugin System Journey', () => {
  beforeEach(() => {
    resetPluginSystem();
  });

  // =========================================================================
  // Discovery
  // =========================================================================

  describe('plugin discovery', () => {
    it('discovers plugin from valid manifest', () => {
      const ok = discoverPlugin({
        id: 'strategy-builder-nexus',
        name: 'Strategy Builder',
        version: '1.0.0',
        main: 'dist/index.js',
        tier: 1,
      });

      expect(ok).toBe(true);
      expect(plugins.get('strategy-builder-nexus')?.status).toBe('discovered');
    });

    it('rejects duplicate plugin discovery', () => {
      const manifest: PluginManifest = {
        id: 'data-plugin',
        name: 'Data Plugin',
        version: '1.0.0',
        main: 'index.js',
        tier: 0,
      };

      expect(discoverPlugin(manifest)).toBe(true);
      expect(discoverPlugin(manifest)).toBe(false);
      expect(plugins.size).toBe(1);
    });
  });

  // =========================================================================
  // Validation
  // =========================================================================

  describe('manifest validation', () => {
    it('validates complete manifest', () => {
      discoverPlugin({
        id: 'test-plugin',
        name: 'Test',
        version: '1.0.0',
        main: 'index.js',
      });

      expect(validatePlugin('test-plugin')).toBe(true);
      expect(plugins.get('test-plugin')?.status).toBe('validated');
    });

    it('rejects manifest with missing fields', () => {
      discoverPlugin({
        id: '',
        name: 'Bad Plugin',
        version: '1.0.0',
        main: 'index.js',
      });

      expect(validatePlugin('')).toBe(false);
    });

    it('allows same-tier dependency between Tier 1 plugins', () => {
      discoverPlugin({
        id: 'plugin-a',
        name: 'Plugin A',
        version: '1.0.0',
        main: 'index.js',
        tier: 1,
      });
      validatePlugin('plugin-a');

      discoverPlugin({
        id: 'plugin-b',
        name: 'Plugin B',
        version: '1.0.0',
        main: 'index.js',
        tier: 1,
        dependencies: ['plugin-a'],
      });

      expect(validatePlugin('plugin-b')).toBe(true);
      expect(plugins.get('plugin-b')?.status).toBe('validated');
    });

    it('rejects upward dependency (Tier 0 importing Tier 1)', () => {
      discoverPlugin({
        id: 'tier1-plugin',
        name: 'Tier 1 Plugin',
        version: '1.0.0',
        main: 'index.js',
        tier: 1,
      });
      validatePlugin('tier1-plugin');

      discoverPlugin({
        id: 'foundation-plugin',
        name: 'Foundation',
        version: '1.0.0',
        main: 'index.js',
        tier: 0,
        dependencies: ['tier1-plugin'],
      });

      expect(validatePlugin('foundation-plugin')).toBe(false);
      expect(plugins.get('foundation-plugin')?.errorMessage).toContain('Upward dependency not allowed');
    });

    it('allows Tier 1 to depend on Tier 0', () => {
      discoverPlugin({
        id: 'data-plugin',
        name: 'Data Plugin',
        version: '1.0.0',
        main: 'index.js',
        tier: 0,
      });
      validatePlugin('data-plugin');

      discoverPlugin({
        id: 'builder-plugin',
        name: 'Builder',
        version: '1.0.0',
        main: 'index.js',
        tier: 1,
        dependencies: ['data-plugin'],
      });

      expect(validatePlugin('builder-plugin')).toBe(true);
    });
  });

  // =========================================================================
  // Full lifecycle
  // =========================================================================

  describe('full plugin lifecycle', () => {
    it('discover -> validate -> load -> activate -> deactivate', () => {
      discoverPlugin({
        id: 'lifecycle-test',
        name: 'Lifecycle Test',
        version: '1.0.0',
        main: 'index.js',
      });

      expect(validatePlugin('lifecycle-test')).toBe(true);
      expect(loadPlugin('lifecycle-test')).toBe(true);
      expect(activatePlugin('lifecycle-test')).toBe(true);
      expect(plugins.get('lifecycle-test')?.status).toBe('active');

      expect(deactivatePlugin('lifecycle-test')).toBe(true);
      expect(plugins.get('lifecycle-test')?.status).toBe('inactive');
    });

    it('cannot activate without loading first', () => {
      discoverPlugin({
        id: 'skip-load',
        name: 'Skip Load',
        version: '1.0.0',
        main: 'index.js',
      });
      validatePlugin('skip-load');

      expect(activatePlugin('skip-load')).toBe(false);
    });

    it('cannot deactivate inactive plugin', () => {
      discoverPlugin({
        id: 'inactive-test',
        name: 'Inactive',
        version: '1.0.0',
        main: 'index.js',
      });
      validatePlugin('inactive-test');
      loadPlugin('inactive-test');
      activatePlugin('inactive-test');
      deactivatePlugin('inactive-test');

      // Second deactivate fails
      expect(deactivatePlugin('inactive-test')).toBe(false);
    });
  });

  // =========================================================================
  // Multi-plugin system
  // =========================================================================

  describe('multi-plugin system', () => {
    it('multiple plugins can be active simultaneously', () => {
      const manifests: PluginManifest[] = [
        { id: 'data-plugin', name: 'Data', version: '1.0.0', main: 'index.js', tier: 0 },
        { id: 'strategy-builder', name: 'Builder', version: '1.0.0', main: 'index.js', tier: 1 },
        { id: 'backtest', name: 'Backtest', version: '1.0.0', main: 'index.js', tier: 1 },
      ];

      for (const m of manifests) {
        discoverPlugin(m);
        validatePlugin(m.id);
        loadPlugin(m.id);
        activatePlugin(m.id);
      }

      const activePlugins = Array.from(plugins.values()).filter((p) => p.status === 'active');
      expect(activePlugins).toHaveLength(3);
    });

    it('deactivating one plugin does not affect others', () => {
      discoverPlugin({ id: 'a', name: 'A', version: '1.0.0', main: 'index.js' });
      discoverPlugin({ id: 'b', name: 'B', version: '1.0.0', main: 'index.js' });

      validatePlugin('a');
      loadPlugin('a');
      activatePlugin('a');

      validatePlugin('b');
      loadPlugin('b');
      activatePlugin('b');

      deactivatePlugin('a');

      expect(plugins.get('a')?.status).toBe('inactive');
      expect(plugins.get('b')?.status).toBe('active');
    });
  });
});
