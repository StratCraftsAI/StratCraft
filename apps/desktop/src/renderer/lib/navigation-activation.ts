/**
 * Navigation-triggered plugin activation (TICKET_1231)
 *
 * Single choke point for `onView:<viewId>` activation events: subscribes to
 * the app store's activeView and forwards every view change to
 * PluginManager.handleViewNavigation(). Also fires once for the view that is
 * current at wire time, so a persisted activeView (the app can boot straight
 * into a plugin page) and any navigation that happened while the plugin
 * system was still initializing are both covered.
 *
 * Wire AFTER PluginManager.initialize() resolves -- the lazy-pending set is
 * populated there.
 *
 * @see docs/design/TICKET_1231_PLUGIN_LAZY_ACTIVATION_EVENTS.md
 */

import { useAppStore } from '@/stores';
import { VIEW_REGISTRY, type ViewId, type ViewConfig } from '@/config/view-registry';
import type { PluginManager } from './plugin-manager';

/**
 * Resolve the host's own plugin mapping for a view (VIEW_REGISTRY), used as
 * the logged fallback when a plugin's declared onView targets are stale.
 * The store's activeView union is wider than ViewId, so look up defensively.
 */
function getMappedPluginId(viewId: string): string | undefined {
  const config = (VIEW_REGISTRY as Record<string, ViewConfig | undefined>)[viewId as ViewId];
  return config?.pluginId;
}

/**
 * Start forwarding view navigation to the plugin manager.
 * Returns an unsubscribe function.
 */
export function wireNavigationActivation(manager: PluginManager): () => void {
  // Cover the view that is already active at wire time (persisted view or
  // navigation that raced plugin initialization).
  let lastView = useAppStore.getState().activeView;
  void manager.handleViewNavigation(lastView, getMappedPluginId(lastView));

  return useAppStore.subscribe((state) => {
    if (state.activeView === lastView) return;
    lastView = state.activeView;
    void manager.handleViewNavigation(state.activeView, getMappedPluginId(state.activeView));
  });
}
