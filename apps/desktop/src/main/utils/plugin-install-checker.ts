/**
 * Plugin Installation Checker - PLUGIN_TICKET_002
 *
 * Centralized utility for checking marketplace plugin installation status.
 * Used by plugin:scanAll to filter out uninstalled marketplace plugins.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from './logger';

const pluginLog = createLogger('PLUGIN');

// =============================================================================
// Types
// =============================================================================

interface InstalledPluginRecord {
  id: string;
  version: string;
  installedAt: string;
  source: 'marketplace' | 'bundled';
  path: string;
}

// =============================================================================
// Installation Check
// =============================================================================

/**
 * Check if a marketplace plugin is installed
 *
 * Reads from {userData}/plugins/.installed.json which is maintained
 * by PluginMarketService during install/uninstall operations.
 *
 * @param pluginId - The plugin ID to check
 * @returns true if installed, false otherwise
 */
export async function isMarketplacePluginInstalled(pluginId: string): Promise<boolean> {
  const userPluginsDir = path.join(app.getPath('userData'), 'plugins');
  const installedManifestPath = path.join(userPluginsDir, '.installed.json');

  try {
    if (!fs.existsSync(installedManifestPath)) {
      pluginLog.debug(`[PLUGIN_TICKET_002] No .installed.json found, plugin ${pluginId} not installed`);
      return false;
    }

    const content = await fs.promises.readFile(installedManifestPath, 'utf-8');
    const installed = JSON.parse(content) as InstalledPluginRecord[];

    const isInstalled = installed.some(p => p.id === pluginId);
    pluginLog.debug(`[PLUGIN_TICKET_002] Plugin ${pluginId} installed: ${isInstalled}`);

    return isInstalled;
  } catch (error) {
    pluginLog.warn(`[PLUGIN_TICKET_002] Error checking installation status for ${pluginId}:`, error);
    return false;
  }
}

/**
 * Get all installed marketplace plugins
 *
 * @returns Array of installed plugin records
 */
export async function getInstalledMarketplacePlugins(): Promise<InstalledPluginRecord[]> {
  const userPluginsDir = path.join(app.getPath('userData'), 'plugins');
  const installedManifestPath = path.join(userPluginsDir, '.installed.json');

  try {
    if (!fs.existsSync(installedManifestPath)) {
      return [];
    }

    const content = await fs.promises.readFile(installedManifestPath, 'utf-8');
    return JSON.parse(content) as InstalledPluginRecord[];
  } catch {
    return [];
  }
}
