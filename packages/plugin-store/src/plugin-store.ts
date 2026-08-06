/**
 * Plugin filesystem read core -- manifest scan / get + user-config read.
 *
 * TICKET_1276 P2 Batch C2. The storage truth for the plugin reads lives in
 * `plugins/<id>/manifest.json` (developer-authored) and
 * `plugins/<id>/user-config.json` + `config.json` (user-authored). The
 * historical Electron `plugin-lifecycle-api.ts` / `PluginConfigManager` reads
 * were pure fs apart from resolving those directories via `app.getPath`.
 *
 * This module reads them from CALLER-SUPPLIED directories (no `electron`
 * import), so:
 *   - Electron main resolves the dirs from `app.getAppPath()` /
 *     `app.getPath('userData')` and delegates here.
 *   - The MCP standalone server resolves them from its own data dir
 *     (`db.ts:resolveDevDataDir` -> `<userData>/plugins`, bundled at
 *     `<appPath>/../../plugins`) and calls here directly, so the answer is
 *     identical whether or not Electron is alive (TICKET_1276 AC4).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ParsedPluginManifest,
  UserServiceConfig,
  DiscoveredPlugin,
} from './types';

const MANIFEST_FILENAME = 'manifest.json';
const USER_CONFIG_FILENAME = 'user-config.json';
const PLUGIN_CONFIG_FILENAME = 'config.json';

/**
 * The plugin source directories to scan, in precedence order. `user` entries
 * override `bundled` entries with the same plugin id (a user install shadows a
 * bundled copy).
 */
export interface PluginDirs {
  /** Built-in / bundled plugins directory. */
  bundled: string;
  /** User-installed plugins directory (also the user-config home). */
  user: string;
}

// =============================================================================
// Manifest scan / get
// =============================================================================

function readManifestSync(pluginDir: string): ParsedPluginManifest | null {
  const manifestPath = path.join(pluginDir, MANIFEST_FILENAME);
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content) as ParsedPluginManifest;
  } catch {
    return null;
  }
}

/**
 * Scan a single directory for plugins (subdirectories containing a valid
 * `manifest.json`). Symlinked plugin directories are followed. Returns each
 * plugin's resolved id (manifest.id, falling back to the directory name),
 * absolute path, and parsed manifest.
 */
export function scanPluginDir(baseDir: string, source: 'bundled' | 'user'): DiscoveredPlugin[] {
  if (!fs.existsSync(baseDir)) return [];
  const out: DiscoveredPlugin[] = [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const pluginDir = path.join(baseDir, entry.name);
    const manifest = readManifestSync(pluginDir);
    if (!manifest) continue;
    out.push({
      id: (manifest.id as string) || entry.name,
      path: pluginDir,
      source,
      manifest,
    });
  }
  return out;
}

/**
 * Discover all plugins across the bundled + user directories. A user plugin
 * shadows a bundled plugin of the same id (matching the historical
 * `listPlugins` dedup: user source wins).
 *
 * NOTE: this returns the STORAGE truth (manifest on disk). It deliberately does
 * NOT attach live runtime status (process state, marketplace-installed gate) --
 * those are runtime-owned (Class-R) and only meaningful with the app running.
 * The Electron caller augments the returned plugins with runtime status; the
 * MCP caller returns the storage view as-is.
 */
export function discoverPlugins(dirs: PluginDirs): DiscoveredPlugin[] {
  const all = [
    ...scanPluginDir(dirs.bundled, 'bundled'),
    ...scanPluginDir(dirs.user, 'user'),
  ];
  const byId = new Map<string, DiscoveredPlugin>();
  for (const plugin of all) {
    const existing = byId.get(plugin.id);
    if (!existing || plugin.source === 'user') {
      byId.set(plugin.id, plugin);
    }
  }
  return Array.from(byId.values());
}

/**
 * Find a plugin's manifest by id across the bundled + user directories. Matches
 * on `manifest.id === pluginId` OR directory name === pluginId (parity with the
 * historical `findPluginManifest`). Returns null when not found.
 */
export function findPluginManifest(dirs: PluginDirs, pluginId: string): ParsedPluginManifest | null {
  for (const basePath of [dirs.bundled, dirs.user]) {
    if (!fs.existsSync(basePath)) continue;
    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const pluginDir = path.join(basePath, entry.name);
      const manifest = readManifestSync(pluginDir);
      if (!manifest) continue;
      if (manifest.id === pluginId || entry.name === pluginId) {
        return manifest;
      }
    }
  }
  return null;
}

// =============================================================================
// Config reads
// =============================================================================

/**
 * Read a plugin's `config.json` (the free-form plugin config surfaced by the
 * `get_plugin_config` tool). Returns `{}` when the file is absent (a plugin
 * that has never been configured), matching the historical `getPluginConfig`.
 * A parse error is thrown (TICKET_858: a corrupt config is a real error, never
 * silently an empty object).
 */
export function readPluginConfig(userPluginsDir: string, pluginId: string): Record<string, unknown> {
  const configPath = path.join(userPluginsDir, pluginId, PLUGIN_CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const content = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

/**
 * Read a plugin's `user-config.json` (per-service enable/disable + preferences,
 * consumed by entitlement resolution). Returns the default `{ services: {} }`
 * when the file is absent. A parse error yields the default (matching the
 * historical `PluginConfigManager.loadUserConfig`, which logs-and-defaults so a
 * single corrupt user-config cannot brick the whole entitlement listing).
 */
export function readUserConfig(userPluginsDir: string, pluginId: string): UserServiceConfig {
  const configPath = path.join(userPluginsDir, pluginId, USER_CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return { services: {} };
  }
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as UserServiceConfig;
  } catch {
    return { services: {} };
  }
}
