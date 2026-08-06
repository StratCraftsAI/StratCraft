/**
 * PluginManager Activation-Event Partition Tests (TICKET_1231)
 *
 * Covers:
 * - initialize(): eager (undeclared / "*"), onStartupFinished deferral,
 *   onView lazy-pending registration
 * - handleViewNavigation(): declared match, host-mapping fallback, failure
 *   keeps pending, non-match no-op
 * - activate/deactivate interactions with the lazy-pending set
 * - refresh(): partition applied to persisted enabledPlugins
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PluginInstance, PluginManifest } from '@shared/types';

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

const loaderInstances: FakeLoader[] = [];

class FakeLoader {
  plugins = new Map<string, PluginInstance>();
  eventHandler: ((event: { type: string; pluginId?: string; message?: string }) => void) | null = null;
  discoverPlugins = vi.fn(async () => [...this.plugins.values()].map(p => p.manifest));
  loadPlugins = vi.fn(async () => []);
  loadPlugin = vi.fn(async () => ({ success: true, pluginId: 'x' }));
  setContextFactory = vi.fn();
  onEvent = vi.fn((handler: (event: { type: string; pluginId?: string }) => void) => {
    this.eventHandler = handler;
  });
  getPlugin = vi.fn((id: string) => this.plugins.get(id));
  getAllPlugins = vi.fn(() => [...this.plugins.values()]);
  activatePlugin = vi.fn(async (id: string) => {
    const instance = this.plugins.get(id);
    if (!instance) throw new Error(`Plugin not found: ${id}`);
    instance.state.active = true;
    return true;
  });
  deactivatePlugin = vi.fn(async (id: string) => {
    const instance = this.plugins.get(id);
    if (!instance) throw new Error(`Plugin not found: ${id}`);
    instance.state.active = false;
    return true;
  });
  removePlugin = vi.fn();
  getContributions = vi.fn(() => []);
  unloadAll = vi.fn(async () => undefined);

  constructor() {
    loaderInstances.push(this);
  }
}

vi.mock('../plugin-loader', () => ({
  PluginLoader: vi.fn(() => new FakeLoader()),
}));

vi.mock('../plugin-context', () => ({
  createPluginContext: vi.fn(() => ({})),
  cleanupPluginContext: vi.fn(),
}));

vi.mock('../plugin-permissions', () => ({
  PermissionManager: vi.fn(),
  permissionManager: {
    hasAllPermissions: vi.fn(() => true),
    requestPermissions: vi.fn(async () => true),
    revokePermissions: vi.fn(),
  },
}));

const getEnabledPluginsMock = vi.fn<[], string[]>(() => []);
vi.mock('@/services/persistence', () => ({
  persistenceManager: {
    getEnabledPlugins: () => getEnabledPluginsMock(),
  },
}));

import { PluginManager, type ActivationViewResolver } from '../plugin-manager';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makePlugin(id: string, activationEvents?: string[], active = false): PluginInstance {
  const manifest = {
    id,
    name: id,
    displayName: id,
    version: '1.0.0',
    main: './dist/index.js',
    type: 'nexus',
    ...(activationEvents !== undefined ? { activationEvents } : {}),
  } as unknown as PluginManifest;
  return {
    manifest,
    state: { id, enabled: false, loaded: true, active },
  };
}

function createManager(
  enabledPlugins: string[],
  activationViewResolver?: ActivationViewResolver
): { manager: PluginManager; loader: FakeLoader } {
  const manager = new PluginManager({ pluginsDir: '', autoActivate: true, enabledPlugins, activationViewResolver });
  const loader = loaderInstances[loaderInstances.length - 1];
  return { manager, loader };
}

/** Flush the onStartupFinished scheduling (setTimeout fallback in node env). */
function flushStartupFinished(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  loaderInstances.length = 0;
  getEnabledPluginsMock.mockReset();
  getEnabledPluginsMock.mockReturnValue([]);
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// initialize(): activation-event partition
// -----------------------------------------------------------------------------

describe('PluginManager.initialize activation partition', () => {
  it('activates plugins without activationEvents eagerly (legacy behavior, AC3)', async () => {
    const { manager, loader } = createManager(['legacy']);
    loader.plugins.set('legacy', makePlugin('legacy'));

    await manager.initialize();

    expect(loader.activatePlugin).toHaveBeenCalledWith('legacy');
    expect(manager.isPendingLazy('legacy')).toBe(false);
  });

  it('activates plugins declaring "*" eagerly', async () => {
    const { manager, loader } = createManager(['eager']);
    loader.plugins.set('eager', makePlugin('eager', ['*']));

    await manager.initialize();

    expect(loader.activatePlugin).toHaveBeenCalledWith('eager');
  });

  it('does NOT activate onView plugins at boot; records them lazy-pending (AC1/AC2)', async () => {
    const { manager, loader } = createManager(['lazy']);
    loader.plugins.set('lazy', makePlugin('lazy', ['onView:signalGenerator']));

    const events: string[] = [];
    manager.onEvent((e) => events.push(e.type));

    await manager.initialize();

    expect(loader.activatePlugin).not.toHaveBeenCalled();
    expect(manager.isPendingLazy('lazy')).toBe(true);
    expect(manager.getPendingLazyPluginIds()).toEqual(['lazy']);
    expect(events).toContain('plugin:lazy-pending');
  });

  it('defers onStartupFinished plugins off the boot path, then activates them (AC4)', async () => {
    const { manager, loader } = createManager(['deferred']);
    loader.plugins.set('deferred', makePlugin('deferred', ['onStartupFinished']));

    await manager.initialize();
    // Not activated synchronously during initialize
    expect(loader.activatePlugin).not.toHaveBeenCalled();

    await flushStartupFinished();
    expect(loader.activatePlugin).toHaveBeenCalledWith('deferred');
  });

  it('falls back to eager (with a warning) when only unknown events are declared', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { manager, loader } = createManager(['stale']);
    loader.plugins.set('stale', makePlugin('stale', ['onCommand:backtest.*', 'onStartup']));

    await manager.initialize();

    expect(loader.activatePlugin).toHaveBeenCalledWith('stale');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN_ACTIVATION_EVENT'));
    warn.mockRestore();
  });

  it('skips plugins that are already active', async () => {
    const { manager, loader } = createManager(['running']);
    loader.plugins.set('running', makePlugin('running', ['*'], true));

    await manager.initialize();

    expect(loader.activatePlugin).not.toHaveBeenCalled();
  });

  it('keeps the legacy warn path for enabled ids that are not loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { manager } = createManager(['ghost']);

    await manager.initialize();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PLUGIN_NOT_FOUND'));
    warn.mockRestore();
  });
});

// -----------------------------------------------------------------------------
// handleViewNavigation()
// -----------------------------------------------------------------------------

describe('PluginManager.handleViewNavigation', () => {
  it('activates a pending plugin whose declared onView matches, exactly once (AC1)', async () => {
    const { manager, loader } = createManager(['lazy']);
    loader.plugins.set('lazy', makePlugin('lazy', ['onView:signalGenerator']));
    await manager.initialize();

    await manager.handleViewNavigation('signalGenerator');

    expect(loader.activatePlugin).toHaveBeenCalledTimes(1);
    expect(loader.activatePlugin).toHaveBeenCalledWith('lazy');
    expect(manager.isPendingLazy('lazy')).toBe(false);

    // Second navigation: nothing pending anymore
    await manager.handleViewNavigation('signalGenerator');
    expect(loader.activatePlugin).toHaveBeenCalledTimes(1);
  });

  it('ignores navigation to views no pending plugin declared', async () => {
    const { manager, loader } = createManager(['lazy']);
    loader.plugins.set('lazy', makePlugin('lazy', ['onView:signalGenerator']));
    await manager.initialize();

    await manager.handleViewNavigation('backtest');

    expect(loader.activatePlugin).not.toHaveBeenCalled();
    expect(manager.isPendingLazy('lazy')).toBe(true);
  });

  it('activates via the host view mapping (with warning) when declared targets are stale', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { manager, loader } = createManager(['lazy']);
    loader.plugins.set('lazy', makePlugin('lazy', ['onView:lazy.internalView']));
    await manager.initialize();

    await manager.handleViewNavigation('lazyHostView', 'lazy');

    expect(loader.activatePlugin).toHaveBeenCalledWith('lazy');
    expect(manager.isPendingLazy('lazy')).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('STALE_ONVIEW_DECLARATION'));
    warn.mockRestore();
  });

  it('keeps the plugin pending when activation fails, so navigation can retry (AC5)', async () => {
    const { manager, loader } = createManager(['lazy']);
    loader.plugins.set('lazy', makePlugin('lazy', ['onView:signalGenerator']));
    await manager.initialize();

    loader.activatePlugin.mockResolvedValueOnce(false);
    await manager.handleViewNavigation('signalGenerator');
    expect(manager.isPendingLazy('lazy')).toBe(true);

    // Retry succeeds
    await manager.handleViewNavigation('signalGenerator');
    expect(manager.isPendingLazy('lazy')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// TICKET_1231_1: derived onView + load-time validation of explicit targets
// -----------------------------------------------------------------------------

describe('PluginManager derived onView and load-time validation (TICKET_1231_1)', () => {
  const resolver: ActivationViewResolver = {
    resolveViewIds: (pluginId) =>
      pluginId === 'com.stratcraft.signal-generator-nexus' ? ['signalGenerator'] : [],
    isKnownViewId: (viewId) => ['signalGenerator', 'quantLab', 'backtest'].includes(viewId),
  };

  it('derives the pending view set from the host registry for bare "onView" (AC1)', async () => {
    const { manager, loader } = createManager(['com.stratcraft.signal-generator-nexus'], resolver);
    loader.plugins.set(
      'com.stratcraft.signal-generator-nexus',
      makePlugin('com.stratcraft.signal-generator-nexus', ['onView'])
    );

    await manager.initialize();
    expect(loader.activatePlugin).not.toHaveBeenCalled();
    expect(manager.isPendingLazy('com.stratcraft.signal-generator-nexus')).toBe(true);

    // Navigation to the derived view activates via declaredMatch -- the
    // mapping fallback (STALE_ONVIEW_DECLARATION) must NOT fire (F4).
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await manager.handleViewNavigation('signalGenerator', 'com.stratcraft.signal-generator-nexus');
    expect(loader.activatePlugin).toHaveBeenCalledWith('com.stratcraft.signal-generator-nexus');
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('STALE_ONVIEW_DECLARATION'));
    warn.mockRestore();
  });

  it('surfaces plugin:error and activates eagerly when bare "onView" derives no view (AC4)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { manager, loader } = createManager(['com.example.no-view'], resolver);
    loader.plugins.set('com.example.no-view', makePlugin('com.example.no-view', ['onView']));

    const events: string[] = [];
    manager.onEvent((e) => events.push(e.type));

    await manager.initialize();

    expect(events).toContain('plugin:error');
    expect(loader.activatePlugin).toHaveBeenCalledWith('com.example.no-view');
    expect(manager.isPendingLazy('com.example.no-view')).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ONVIEW_NO_HOST_VIEW'));
    error.mockRestore();
  });

  it('drops a stale explicit onView target with plugin:error, keeps valid ones (AC5)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { manager, loader } = createManager(['mixed'], resolver);
    loader.plugins.set('mixed', makePlugin('mixed', ['onView:ghostView', 'onView:quantLab']));

    const events: string[] = [];
    manager.onEvent((e) => events.push(e.type));

    await manager.initialize();

    expect(events).toContain('plugin:error');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('STALE_ONVIEW_TARGET'));
    expect(manager.isPendingLazy('mixed')).toBe(true);
    await manager.handleViewNavigation('quantLab');
    expect(loader.activatePlugin).toHaveBeenCalledWith('mixed');
    error.mockRestore();
  });

  it('falls back to eager (usable, TICKET_856) when ALL explicit targets are stale (AC5)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { manager, loader } = createManager(['stale-only'], resolver);
    loader.plugins.set('stale-only', makePlugin('stale-only', ['onView:ghostView']));

    const events: string[] = [];
    manager.onEvent((e) => events.push(e.type));

    await manager.initialize();

    expect(events).toContain('plugin:error');
    expect(loader.activatePlugin).toHaveBeenCalledWith('stale-only');
    expect(manager.isPendingLazy('stale-only')).toBe(false);
    error.mockRestore();
  });

  it('keeps legacy explicit-onView behavior when no resolver is configured', async () => {
    const { manager, loader } = createManager(['lazy']);
    loader.plugins.set('lazy', makePlugin('lazy', ['onView:anythingGoes']));

    await manager.initialize();

    expect(manager.isPendingLazy('lazy')).toBe(true);
    expect(loader.activatePlugin).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// activate/deactivate interactions with lazy-pending
// -----------------------------------------------------------------------------

describe('PluginManager lazy-pending lifecycle interactions', () => {
  it('clears pending when the plugin is activated directly (user toggle)', async () => {
    const { manager, loader } = createManager(['lazy']);
    loader.plugins.set('lazy', makePlugin('lazy', ['onView:signalGenerator']));
    await manager.initialize();

    await manager.activatePlugin('lazy');

    expect(manager.isPendingLazy('lazy')).toBe(false);
  });

  it('clears pending and emits plugin:deactivated when a pending plugin is disabled', async () => {
    const { manager, loader } = createManager(['lazy']);
    loader.plugins.set('lazy', makePlugin('lazy', ['onView:signalGenerator']));
    await manager.initialize();

    const events: string[] = [];
    manager.onEvent((e) => events.push(e.type));

    const result = await manager.deactivatePlugin('lazy');

    expect(result).toBe(true);
    expect(manager.isPendingLazy('lazy')).toBe(false);
    expect(events).toContain('plugin:deactivated');
  });
});

// -----------------------------------------------------------------------------
// refresh(): partition on persisted enabledPlugins
// -----------------------------------------------------------------------------

describe('PluginManager.refresh activation partition', () => {
  it('applies the same partition: eager activates, onView stays pending', async () => {
    const { manager, loader } = createManager([]);
    await manager.initialize();

    loader.plugins.set('eager', makePlugin('eager', ['*']));
    loader.plugins.set('lazy', makePlugin('lazy', ['onView:signalGenerator']));
    getEnabledPluginsMock.mockReturnValue(['eager', 'lazy']);

    await manager.refresh();

    expect(loader.activatePlugin).toHaveBeenCalledWith('eager');
    expect(loader.activatePlugin).not.toHaveBeenCalledWith('lazy');
    expect(manager.isPendingLazy('lazy')).toBe(true);
  });
});
