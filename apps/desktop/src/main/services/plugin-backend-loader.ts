/**
 * Plugin Backend Registry
 *
 * Provides plugin backend registration and capability-based discovery.
 * Used by data-handlers.ts for dynamic plugin backend resolution.
 * TICKET_987 Phase 4: signal fusion plugin discovery + registration.
 */

import { appLog } from '../utils/logger';
import type { PluginManifest } from '../../shared/types/plugin';
import type { ISignalFusion } from './plugin-signal-fusion-registry';
import {
  registerPluginFusion,
  unregisterPluginFusion,
  validateFusionWeights,
} from './plugin-signal-fusion-registry';

// =============================================================================
// Plugin Backend Registry
// =============================================================================

/**
 * Global registry for plugin backends
 *
 * Stores all initialized plugin backends, making them
 * available for Host Layer proxy calls and dynamic discovery.
 */
const pluginBackends = new Map<string, {
  initialized: boolean;
  context: any;
  module: any;
}>();

/**
 * Register a plugin backend in the global registry
 *
 * Called after plugin backend initialization to make the backend
 * module available for Host Layer proxy calls.
 */
export function registerPluginBackend(pluginId: string, backend: {
  initialized: boolean;
  context: any;
  module: any;
}): void {
  if (pluginBackends.has(pluginId)) {
    const existing = pluginBackends.get(pluginId);
    appLog.warn(
      `[PluginBackendLoader] Plugin backend already registered: ${pluginId}. ` +
      `Duplicate initialization detected. ` +
      `Existing: initialized=${existing?.initialized}, New: initialized=${backend.initialized}. ` +
      `Skipping duplicate registration to prevent resource leak.`
    );
    return;
  }

  pluginBackends.set(pluginId, backend);
  appLog.info(`[PluginBackendLoader] Registered plugin backend: ${pluginId}`);
}

/**
 * Get first backend that has a specific capability (method)
 *
 * Dynamic plugin discovery instead of hardcoded IDs.
 *
 * @param methodName - Method name to check for (e.g., 'searchSymbols', 'fetchHistoricalData')
 * @returns First backend that has the method, or null if none found
 */
export function getBackendWithCapability(methodName: string): {
  pluginId: string;
  backend: {
    initialized: boolean;
    context: any;
    module: any;
  };
} | null {
  for (const [pluginId, backend] of pluginBackends) {
    if (backend.initialized && backend.module && typeof backend.module[methodName] === 'function') {
      return { pluginId, backend };
    }
  }
  return null;
}

// =============================================================================
// TICKET_987 Phase 4: Signal Fusion Plugin Discovery
// =============================================================================

const pluginFusionRegistrations = new Map<string, string[]>();

export function discoverAndRegisterPluginFusions(
  pluginId: string,
  manifest: PluginManifest,
  backendModule: any,
): { registered: string[]; errors: string[] } {
  const registered: string[] = [];
  const errors: string[] = [];
  const contributions = manifest.contributes?.signalFusion;
  if (!contributions || contributions.length === 0) return { registered, errors };

  for (const contrib of contributions) {
    const exportName = `fusion_${contrib.id}`;
    const exported = backendModule?.[exportName];
    if (!exported) {
      errors.push(
        `Plugin '${pluginId}' declares signal fusion '${contrib.id}' ` +
        `but backend does not export '${exportName}'`,
      );
      continue;
    }

    const fusion: ISignalFusion = {
      id: contrib.id,
      displayName: contrib.displayName,
      computeWeights:
        typeof exported.computeWeights === 'function'
          ? exported.computeWeights.bind(exported)
          : undefined as any,
      canRun:
        typeof exported.canRun === 'function'
          ? exported.canRun.bind(exported)
          : () => true,
    };

    if (typeof fusion.computeWeights !== 'function') {
      errors.push(
        `Plugin '${pluginId}' fusion '${contrib.id}': ` +
        `exported object missing computeWeights()`,
      );
      continue;
    }

    try {
      registerPluginFusion(fusion);
      registered.push(contrib.id);
      appLog.info(
        `[PluginBackendLoader] Registered plugin fusion '${contrib.id}' ` +
        `from plugin '${pluginId}'`,
      );
    } catch (err: any) {
      errors.push(
        `Plugin '${pluginId}' fusion '${contrib.id}': ${err.message}`,
      );
    }
  }

  if (registered.length > 0) {
    pluginFusionRegistrations.set(pluginId, registered);
  }

  for (const e of errors) {
    appLog.warn(`[PluginBackendLoader] ${e}`);
  }

  return { registered, errors };
}

export function unregisterPluginFusions(pluginId: string): string[] {
  const ids = pluginFusionRegistrations.get(pluginId);
  if (!ids) return [];
  for (const id of ids) {
    try {
      unregisterPluginFusion(id);
      appLog.info(
        `[PluginBackendLoader] Unregistered plugin fusion '${id}' ` +
        `from plugin '${pluginId}'`,
      );
    } catch {
      // already gone
    }
  }
  pluginFusionRegistrations.delete(pluginId);
  return ids;
}
