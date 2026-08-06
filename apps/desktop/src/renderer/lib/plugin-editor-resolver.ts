/**
 * Plugin Editor Resolver
 *
 * Dynamically resolves editor components from plugins based on service name.
 * Host layer uses this to avoid hardcoding plugin page imports.
 *
 * @see TICKET_079 - Dynamic Page Routing Architecture
 * @see TICKET_056 - VS Code Plugin Architecture
 */

import React from 'react';
import { getPluginManager } from './plugin-manager';
import type { PluginManifest, EditorContribution, ServiceEntitlementDefinition } from '@shared/types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Generate result from API (TICKET_082)
 */
export interface GenerateResult {
  code?: string;
  error?: string;
}

/**
 * Props passed to editor components
 */
export interface EditorProps {
  onGenerate?: (config: unknown) => Promise<void>;
  onSettingsClick?: () => void;
  pageTitle?: string;
  /** Loading state during generation (TICKET_082) */
  isGenerating?: boolean;
  /** Result from generation API (TICKET_082) */
  generateResult?: GenerateResult | null;
}

/**
 * Editor resolution result
 */
export interface EditorResolution {
  viewType: string;
  displayName: string;
  component: React.ComponentType<EditorProps> | null;
}

// -----------------------------------------------------------------------------
// Plugin Editor Registries (populated by plugins)
// -----------------------------------------------------------------------------

/**
 * Global editor component registry
 * Plugins register their components here during activation
 */
const editorComponentRegistry: Map<string, React.ComponentType<EditorProps>> = new Map();

/**
 * Register an editor component for a viewType
 * Called by plugins during activation
 */
export function registerEditorComponent(
  viewType: string,
  component: React.ComponentType<EditorProps>
): void {
  editorComponentRegistry.set(viewType, component);
}

/**
 * Unregister an editor component
 * Called by plugins during deactivation
 */
export function unregisterEditorComponent(viewType: string): void {
  editorComponentRegistry.delete(viewType);
}

// -----------------------------------------------------------------------------
// Resolution Functions
// -----------------------------------------------------------------------------

/**
 * Find service definition by name or ID in manifest
 */
function findServiceByNameOrId(
  manifest: PluginManifest,
  serviceNameOrId: string
): ServiceEntitlementDefinition | undefined {
  return manifest.entitlements?.services?.find(
    (s) => s.name === serviceNameOrId || s.id === serviceNameOrId
  );
}

/**
 * Find editor contribution by service ID in manifest
 */
function findEditorByServiceId(
  manifest: PluginManifest,
  serviceId: string
): EditorContribution | undefined {
  return manifest.contributes?.editors?.find(
    (e) => e.serviceIds?.includes(serviceId)
  );
}

/**
 * Get editor component from registry by viewType
 */
function getEditorComponentByViewType(
  viewType: string
): React.ComponentType<EditorProps> | null {
  return editorComponentRegistry.get(viewType) ?? null;
}

/**
 * Resolve editor by service name
 *
 * Flow:
 * 1. Get plugin manifest
 * 2. Find service by name
 * 3. Find editor with matching serviceId
 * 4. Get component from registry
 *
 * @param pluginId - Plugin ID to search
 * @param serviceName - Service name (display name from button)
 * @returns EditorResolution or null if not found
 */
export function resolveEditorByServiceName(
  pluginId: string,
  serviceName: string
): EditorResolution | null {
  const manager = getPluginManager();
  const plugin = manager.getPlugin(pluginId);

  if (!plugin) {
    console.warn(`[W:EDITOR:PLUGIN_NOT_FOUND] Plugin not found: ${pluginId}`);
    return null;
  }

  // Step 1: Find service by name
  const service = findServiceByNameOrId(plugin.manifest, serviceName);
  if (!service) {
    console.warn(`[W:EDITOR:SERVICE_NOT_FOUND] Service not found: ${serviceName}`);
    return null;
  }

  // Step 2: Find editor by service ID
  const editor = findEditorByServiceId(plugin.manifest, service.id);
  if (!editor) {
    console.warn(`[W:EDITOR:EDITOR_NOT_FOUND] Editor not found for service: ${service.id}`);
    return null;
  }

  // Step 3: Get component from registry
  const component = getEditorComponentByViewType(editor.viewType);

  return {
    viewType: editor.viewType,
    displayName: editor.displayName,
    component,
  };
}

/**
 * Get editor component by service name (convenience function)
 *
 * @param pluginId - Plugin ID
 * @param serviceName - Service name
 * @returns React component or null
 */
export function getEditorByServiceName(
  pluginId: string,
  serviceName: string
): React.ComponentType<EditorProps> | null {
  const resolution = resolveEditorByServiceName(pluginId, serviceName);
  return resolution?.component ?? null;
}

/**
 * Check if an editor exists for a service
 *
 * @param pluginId - Plugin ID
 * @param serviceName - Service name
 * @returns true if editor is registered
 */
export function hasEditorForService(
  pluginId: string,
  serviceName: string
): boolean {
  const resolution = resolveEditorByServiceName(pluginId, serviceName);
  return resolution?.component !== null;
}

// -----------------------------------------------------------------------------
// Debug Utilities
// -----------------------------------------------------------------------------

/**
 * Get all registered editor viewTypes (for debugging)
 */
export function getRegisteredEditors(): string[] {
  return Array.from(editorComponentRegistry.keys());
}

/**
 * Log registry state (for debugging)
 */
export function debugEditorRegistry(): void {
  console.log('[EditorResolver] Registered editors:', getRegisteredEditors());
}
