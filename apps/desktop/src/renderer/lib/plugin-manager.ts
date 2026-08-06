/**
 * PluginManager - Plugin Manager
 *
 * Unified entry point, integrating:
 * - PluginLoader (loading)
 * - PluginContext (context)
 * - PermissionManager (permissions)
 *
 * Provides complete plugin lifecycle management
 */

import { PluginLoader, type LoaderConfig, type PluginLoadEvent } from './plugin-loader';
import { createPluginContext, cleanupPluginContext } from './plugin-context';
import { PermissionManager, permissionManager as defaultPermissionManager } from './plugin-permissions';
import { classifyActivationEvents } from '@shared/constants/plugin-activation';
import { safeForEach } from '@shared/utils/safe-emit';
import type { PluginManifest, PluginInstance, PluginPermission } from '@shared/types';

// =============================================================================
// Types
// =============================================================================

/**
 * TICKET_1231_1: Host view bindings for activation classification. The host
 * (VIEW_REGISTRY) is the single owner of the viewId -> pluginId binding;
 * plugins declare intent (`onView`), the host resolves identity.
 */
export interface ActivationViewResolver {
  /** All view ids the host registers for a plugin (derived `onView` set). */
  resolveViewIds: (pluginId: string) => string[];
  /** Whether a string names a registered host view (validates `onView:<id>`). */
  isKnownViewId: (viewId: string) => boolean;
}

export interface PluginManagerConfig extends LoaderConfig {
  autoActivate?: boolean;              // Auto-activate enabled plugins
  // TICKET_1231_1: host view bindings; without it, bare `onView` cannot be
  // honored (reported as unknown) and explicit ids cannot be validated.
  activationViewResolver?: ActivationViewResolver;
  onPermissionRequest?: (             // Permission request callback
    manifest: PluginManifest,
    permissions: PluginPermission[]
  ) => Promise<boolean>;
}

export type PluginManagerEventType =
  | 'discover:start'
  | 'discover:complete'
  | 'plugin:loading'
  | 'plugin:loaded'
  | 'plugin:activated'
  | 'plugin:deactivated'
  | 'plugin:lazy-pending'
  | 'plugin:error'
  | 'permission:request'
  | 'permission:granted'
  | 'permission:denied';

export interface PluginManagerEvent {
  type: PluginManagerEventType;
  pluginId?: string;
  data?: unknown;
}

type PluginManagerEventHandler = (event: PluginManagerEvent) => void;

// =============================================================================
// PluginManager Class
// =============================================================================

export class PluginManager {
  private loader: PluginLoader;
  private permissions: PermissionManager;
  private config: PluginManagerConfig;
  private eventHandlers: Set<PluginManagerEventHandler> = new Set();
  private initialized = false;
  // TICKET_1231: enabled plugins whose activation waits for first navigation
  // to one of their declared onView targets. pluginId -> host ViewIds.
  private lazyPending: Map<string, string[]> = new Map();

  constructor(config: PluginManagerConfig) {
    this.config = config;
    this.permissions = defaultPermissionManager;

    // Create PluginLoader
    this.loader = new PluginLoader({
      pluginsDir: config.pluginsDir,
      enabledPlugins: config.enabledPlugins,
      trustedPlugins: config.trustedPlugins,
    });

    // Set context factory
    this.loader.setContextFactory(createPluginContext);

    // Forward loader events
    this.loader.onEvent((event: PluginLoadEvent) => {
      this.emit({
        type: `plugin:${event.type}` as PluginManagerEventType,
        pluginId: event.pluginId,
        data: event.message,
      });
    });
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  onEvent(handler: PluginManagerEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: PluginManagerEvent): void {
    safeForEach(this.eventHandlers, '[E:PLUGIN_MANAGER:EVENT_HANDLER_ERROR] PluginManager event handler error:', event);
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize plugin system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.emit({ type: 'discover:start' });

    // Discover plugins
    const manifests = await this.loader.discoverPlugins();

    // Load plugins
    await this.loader.loadPlugins(manifests);

    this.emit({
      type: 'discover:complete',
      data: { count: manifests.length },
    });

    // Auto-activate (TICKET_1231: partitioned by manifest activationEvents)
    if (this.config.autoActivate && this.config.enabledPlugins) {
      await this.autoActivateEnabled(this.config.enabledPlugins);
    }

    this.initialized = true;
  }

  /**
   * TICKET_1231: Activate enabled plugins according to their declared
   * activation events.
   * - `*` (or no declaration): activate now, exactly as before.
   * - `onStartupFinished`: activate after the current task, off the boot
   *   critical path.
   * - `onView` (TICKET_1231_1) / `onView:<viewId>`: record as lazy-pending;
   *   activation happens on first navigation to a view in the set
   *   (handleViewNavigation). The bare form derives the set from the host
   *   registry; explicit ids are validated against it at this point -- the
   *   load-time boundary, the earliest validation point for installed
   *   third-party manifests CI cannot see.
   */
  private async autoActivateEnabled(enabledPluginIds: string[]): Promise<void> {
    const startupFinished: string[] = [];
    const resolver = this.config.activationViewResolver;

    for (const pluginId of enabledPluginIds) {
      const plugin = this.loader.getPlugin(pluginId);
      if (!plugin) {
        // Preserve legacy behavior for unknown ids: activatePlugin logs the
        // deprecated-plugin warning (TICKET_135) and returns false.
        await this.activatePlugin(pluginId);
        continue;
      }
      if (plugin.state.active) continue;

      const strategy = classifyActivationEvents(plugin.manifest, {
        onUnknownEvent: (event) => {
          console.warn(
            `[W:PLUGIN_MANAGER:UNKNOWN_ACTIVATION_EVENT] Plugin ${pluginId} declares unrecognized activation event "${event}"`
          );
        },
        resolveViewIds: resolver?.resolveViewIds,
        onEmptyDerivedViews: (id) => {
          // TICKET_1231_1: lazy intent with no host-registered view is dead
          // by construction -- surface it (TICKET_858); classifier already
          // fell back to eager (TICKET_856).
          const message = `Plugin ${id} declares "onView" but the host registers no view for it -- activating eagerly`;
          console.error(`[E:PLUGIN_MANAGER:ONVIEW_NO_HOST_VIEW] ${message}`);
          this.emit({ type: 'plugin:error', pluginId: id, data: message });
        },
      });

      switch (strategy.kind) {
        case 'eager':
          await this.activatePlugin(pluginId);
          break;
        case 'startupFinished':
          startupFinished.push(pluginId);
          break;
        case 'onView': {
          // TICKET_1231_1: validate explicit onView targets at load time.
          // Derived ids come from the registry and are valid by construction.
          const viewIds = resolver
            ? strategy.viewIds.filter((viewId) => {
                if (resolver.isKnownViewId(viewId)) return true;
                const message = `Plugin ${pluginId} declares onView:${viewId} but no such host view exists -- dropping the stale target`;
                console.error(`[E:PLUGIN_MANAGER:STALE_ONVIEW_TARGET] ${message}`);
                this.emit({ type: 'plugin:error', pluginId, data: message });
                return false;
              })
            : strategy.viewIds;
          if (viewIds.length === 0) {
            // All declared targets were stale: eager keeps the plugin usable
            // (TICKET_856); the errors above already made the drift visible.
            await this.activatePlugin(pluginId);
            break;
          }
          console.info(`[PluginManager] TICKET_1231: ${pluginId} pending lazy activation (onView: ${viewIds.join(', ')})`);
          this.lazyPending.set(pluginId, viewIds);
          this.emit({ type: 'plugin:lazy-pending', pluginId });
          break;
        }
      }
    }

    this.scheduleStartupFinishedActivation(startupFinished);
  }

  /**
   * TICKET_1231: Activate onStartupFinished plugins after the initial render,
   * without blocking boot. Failures surface through the same plugin:error
   * event path as boot-time activation (TICKET_858).
   */
  private scheduleStartupFinishedActivation(pluginIds: string[]): void {
    if (pluginIds.length === 0) return;
    const run = () => {
      void (async () => {
        for (const pluginId of pluginIds) {
          console.info(`[PluginManager] TICKET_1231: onStartupFinished activation: ${pluginId}`);
          await this.activatePlugin(pluginId);
        }
      })();
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run);
    } else {
      setTimeout(run, 0);
    }
  }

  /**
   * TICKET_1231: Navigation choke-point hook. Activates any enabled plugin
   * whose declared `onView:<viewId>` matches the view being navigated to.
   *
   * `mappedPluginId` is the host's own VIEW_REGISTRY plugin mapping for the
   * view. If a pending plugin's declared viewIds are stale (they never match
   * any navigable view) but the host mapping identifies it, activate anyway
   * and warn. TICKET_1231_1 removed the root cause of that divergence (bare
   * `onView` derives the view set from the registry; explicit ids are
   * validated at load time), so this branch is defense-in-depth only
   * (TICKET_859): it firing means a validation escape (loader bug or a
   * manifest that bypassed load-time validation), never a normal path.
   *
   * On failure the plugin stays pending (a later navigation retries) and the
   * error surfaces via the loader's plugin:error event (TICKET_858).
   */
  async handleViewNavigation(viewId: string, mappedPluginId?: string): Promise<void> {
    for (const [pluginId, viewIds] of [...this.lazyPending.entries()]) {
      const declaredMatch = viewIds.includes(viewId);
      const mappingMatch = mappedPluginId !== undefined && pluginId === mappedPluginId;
      if (!declaredMatch && !mappingMatch) continue;
      if (!declaredMatch && mappingMatch) {
        console.warn(
          `[W:PLUGIN_MANAGER:STALE_ONVIEW_DECLARATION] Plugin ${pluginId} pends on [${viewIds.join(', ')}] but was reached via host view mapping "${viewId}" -- validation escape (TICKET_1231_1), fix the manifest or the load-time validation`
        );
      } else {
        console.info(`[PluginManager] TICKET_1231: onView:${viewId} -> activating ${pluginId}`);
      }
      const success = await this.activatePlugin(pluginId);
      if (success) {
        this.lazyPending.delete(pluginId);
      }
    }
  }

  /**
   * TICKET_1231: Plugins that are enabled but waiting for their first
   * navigation-triggered activation.
   */
  getPendingLazyPluginIds(): string[] {
    return [...this.lazyPending.keys()];
  }

  /**
   * TICKET_1231: Whether a plugin is enabled but pending lazy activation.
   */
  isPendingLazy(pluginId: string): boolean {
    return this.lazyPending.has(pluginId);
  }

  // ===========================================================================
  // Plugin Lifecycle
  // ===========================================================================

  /**
   * Activate plugin (includes permission check)
   */
  async activatePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.loader.getPlugin(pluginId);
    if (!plugin) {
      // TICKET_135: Skip deprecated/removed plugins gracefully
      console.warn(`[W:PLUGIN_MANAGER:PLUGIN_NOT_FOUND] Plugin not found (may be deprecated): ${pluginId}`);
      return false;
    }

    // Check permissions
    const requiredPermissions = plugin.manifest.permissions || [];
    if (requiredPermissions.length > 0) {
      const hasPermissions = await this.checkAndRequestPermissions(plugin.manifest);
      if (!hasPermissions) {
        this.emit({
          type: 'permission:denied',
          pluginId,
          data: { permissions: requiredPermissions },
        });
        return false;
      }
    }

    // Activate
    const activated = await this.loader.activatePlugin(pluginId);
    if (activated) {
      // TICKET_1231: a direct activation (user toggle, install, navigation)
      // supersedes any pending lazy activation.
      this.lazyPending.delete(pluginId);
    }
    return activated;
  }

  /**
   * Deactivate plugin
   */
  async deactivatePlugin(pluginId: string): Promise<boolean> {
    // TICKET_1231: disabling a pending-lazy plugin must clear its pending
    // entry. The loader early-returns true for non-active plugins without
    // emitting, so emit deactivated here to keep UI state (hub cards,
    // pending list) in sync.
    const wasPendingLazy = this.lazyPending.delete(pluginId);

    const result = await this.loader.deactivatePlugin(pluginId);

    if (result) {
      // Cleanup context
      cleanupPluginContext(pluginId);
      if (wasPendingLazy) {
        this.emit({ type: 'plugin:deactivated', pluginId });
      }
    }

    return result;
  }

  /**
   * TICKET_452: Re-discover plugins after marketplace install/uninstall.
   * - Loads newly installed plugins (loadPlugin skips already-loaded IDs)
   * - Removes plugins that are no longer on disk (uninstalled)
   */
  async refresh(): Promise<void> {
    this.emit({ type: 'discover:start' });

    const manifests = await this.loader.discoverPlugins();
    const discoveredIds = new Set(manifests.map(m => m.id));

    // Remove plugins that are no longer discovered (uninstalled from disk)
    const loadedIds = this.loader.getAllPlugins().map(p => p.manifest.id);
    for (const pluginId of loadedIds) {
      if (!discoveredIds.has(pluginId)) {
        await this.deactivatePlugin(pluginId);
        this.loader.removePlugin(pluginId);
      }
    }

    // Load newly discovered plugins
    await this.loader.loadPlugins(manifests);

    // TICKET_457: Read CURRENT enabledPlugins from persistence, not stale config snapshot
    // TICKET_1231: same activation-event partition as initialize() -- refresh
    // must not force-activate plugins that declared lazy activation.
    if (this.config.autoActivate) {
      const { persistenceManager } = await import('@/services/persistence');
      const currentEnabledPlugins = persistenceManager.getEnabledPlugins();
      await this.autoActivateEnabled(
        currentEnabledPlugins.filter((pluginId: string) => {
          const plugin = this.loader.getPlugin(pluginId);
          return plugin !== undefined && !plugin.state.active;
        })
      );
    }

    this.emit({
      type: 'discover:complete',
      data: { count: manifests.length },
    });
  }

  /**
   * Reload plugin
   */
  async reloadPlugin(pluginId: string): Promise<boolean> {
    await this.deactivatePlugin(pluginId);

    // Re-discover and load
    const manifests = await this.loader.discoverPlugins();
    const manifest = manifests.find(m => m.id === pluginId);

    if (!manifest) {
      throw new Error(`Plugin manifest not found: ${pluginId}`);
    }

    const result = await this.loader.loadPlugin(manifest);
    if (!result.success) {
      return false;
    }

    return this.activatePlugin(pluginId);
  }

  // ===========================================================================
  // Permission Management
  // ===========================================================================

  /**
   * Check and request permissions
   */
  private async checkAndRequestPermissions(manifest: PluginManifest): Promise<boolean> {
    const requiredPermissions = manifest.permissions || [];

    // Already has permissions
    if (this.permissions.hasAllPermissions(manifest.id, requiredPermissions)) {
      return true;
    }

    // Request permissions
    this.emit({
      type: 'permission:request',
      pluginId: manifest.id,
      data: { permissions: requiredPermissions },
    });

    const onPrompt = this.config.onPermissionRequest || this.defaultPermissionPrompt;

    const granted = await this.permissions.requestPermissions(manifest, onPrompt);

    if (granted) {
      this.emit({
        type: 'permission:granted',
        pluginId: manifest.id,
        data: { permissions: requiredPermissions },
      });
    }

    return granted;
  }

  /**
   * Default permission prompt (console)
   */
  private defaultPermissionPrompt = async (
    manifest: PluginManifest,
    permissions: PluginPermission[]
  ): Promise<boolean> => {
    console.log(`Plugin "${manifest.name}" requests permissions:`, permissions);
    // Auto-grant in development environment
    return true;
  };

  /**
   * Revoke plugin permissions
   */
  revokePermissions(pluginId: string): void {
    this.permissions.revokePermissions(pluginId);
  }

  // ===========================================================================
  // Plugin Access
  // ===========================================================================

  /**
   * Get plugin instance
   */
  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.loader.getPlugin(pluginId);
  }

  /**
   * Get all plugins
   */
  getAllPlugins(): PluginInstance[] {
    return this.loader.getAllPlugins();
  }

  /**
   * Get active plugins
   */
  getActivePlugins(): PluginInstance[] {
    return this.loader.getAllPlugins().filter(p => p.state.active);
  }

  /**
   * Get UI contribution points
   */
  getContributions() {
    return this.loader.getContributions();
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Check if initialization is complete
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Shutdown plugin system
   */
  async shutdown(): Promise<void> {
    // Deactivate all plugins
    await this.loader.unloadAll();

    // Cleanup event handlers
    this.eventHandlers.clear();

    this.initialized = false;
  }
}

// =============================================================================
// React Hook
// =============================================================================

import { useEffect, useState, useCallback } from 'react';

let globalPluginManager: PluginManager | null = null;

/**
 * Get or create global PluginManager instance
 */
export function getPluginManager(config?: PluginManagerConfig): PluginManager {
  if (!globalPluginManager && config) {
    globalPluginManager = new PluginManager(config);
  }
  if (!globalPluginManager) {
    throw new Error('PluginManager not initialized. Call with config first.');
  }
  return globalPluginManager;
}

/**
 * React Hook: Use plugin manager
 */
export function usePluginManager() {
  const [plugins, setPlugins] = useState<PluginInstance[]>([]);
  const [loading, setLoading] = useState(true);
  // TICKET_1231: plugins enabled but waiting for navigation-triggered activation
  const [pendingLazyIds, setPendingLazyIds] = useState<string[]>([]);

  useEffect(() => {
    const manager = getPluginManager();

    // Initial state
    setPlugins(manager.getAllPlugins());
    setPendingLazyIds(manager.getPendingLazyPluginIds());
    setLoading(!manager.isInitialized());

    // Listen for changes
    const unsubscribe = manager.onEvent((event) => {
      setPlugins(manager.getAllPlugins());
      setPendingLazyIds(manager.getPendingLazyPluginIds());

      // Stop loading when initialization completes
      if (event.type === 'discover:complete') {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const activatePlugin = useCallback(async (pluginId: string) => {
    const manager = getPluginManager();
    const success = await manager.activatePlugin(pluginId);

    // Persist enabled plugin on success (TICKET_007)
    if (success) {
      const { persistenceManager } = await import('@/services/persistence');
      persistenceManager.addEnabledPlugin(pluginId);
    }

    return success;
  }, []);

  const deactivatePlugin = useCallback(async (pluginId: string) => {
    const manager = getPluginManager();
    const success = await manager.deactivatePlugin(pluginId);

    // Remove from persisted enabled plugins on success (TICKET_007)
    if (success) {
      const { persistenceManager } = await import('@/services/persistence');
      persistenceManager.removeEnabledPlugin(pluginId);
    }

    return success;
  }, []);

  return {
    plugins,
    loading,
    pendingLazyIds,
    activatePlugin,
    deactivatePlugin,
    getContributions: () => getPluginManager().getContributions(),
  };
}

// =============================================================================
// Export
// =============================================================================

export default PluginManager;
