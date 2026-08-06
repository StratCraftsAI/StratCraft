/**
 * Plugin Discovery Utility
 *
 * TICKET_128_1 Phase 3: Extracted shared plugin discovery logic
 *
 * Provides a centralized function for discovering plugin paths from
 * configured directories. Used by both Extension Host Service and
 * Plugin Backend Loader to avoid code duplication.
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { appLog } from '../utils/logger';

/**
 * Discover plugin paths from configured directories
 *
 * TICKET_128_1 Phase 3: Shared plugin discovery logic
 *
 * Scans default plugin directories for valid plugins (those with manifest.json).
 * Used by both Extension Host Service and Plugin Backend Loader.
 *
 * @param pluginDirs - Optional custom plugin directories to scan
 * @returns Array of absolute paths to discovered plugins
 */
export async function discoverPluginPaths(pluginDirs?: string[]): Promise<string[]> {
  const paths: string[] = [];

  const defaultDirs = [
    path.join(app.getPath('userData'), 'plugins'),
    // Built-in plugins
    app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'plugins')
      : path.join(__dirname, '..', '..', '..', '..', 'plugins'),
  ];

  const dirsToScan = pluginDirs || defaultDirs;

  for (const dir of dirsToScan) {
    if (!fs.existsSync(dir)) {
      continue;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const pluginPath = path.join(dir, entry.name);
        const manifestPath = path.join(pluginPath, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          paths.push(pluginPath);
        }
      }
    }
  }

  appLog.debug('[PluginDiscovery] Discovered plugins:', paths);
  return paths;
}
