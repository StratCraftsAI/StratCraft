/**
 * TICKET_1004: Plugin Installation Status Registry
 *
 * In-memory singleton for O(1) plugin installation status queries.
 * Replaces per-call filesystem scans with a Map lookup.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../utils/logger';
import type { InstalledPlugin } from '../../shared/types/marketplace';

const registryLog = createLogger('PLUGIN_REGISTRY');

export interface PluginStatusEntry {
  id: string;
  displayName: string;
  version: string;
  tier: number;
  distribution: 'bundled' | 'marketplace';
  installedAt: string;
  path: string;
  active: boolean;
}

export class PluginStatusRegistry {
  private static _instance: PluginStatusRegistry | null = null;
  private entries: Map<string, PluginStatusEntry> = new Map();
  private initialized = false;

  private constructor() {}

  static get instance(): PluginStatusRegistry {
    if (!PluginStatusRegistry._instance) {
      PluginStatusRegistry._instance = new PluginStatusRegistry();
    }
    return PluginStatusRegistry._instance;
  }

  // ---------------------------------------------------------------------------
  // Sync queries (main-process only)
  // ---------------------------------------------------------------------------

  isInstalled(pluginId: string): boolean {
    return this.entries.has(pluginId);
  }

  isActive(pluginId: string): boolean {
    return this.entries.get(pluginId)?.active ?? false;
  }

  get(pluginId: string): PluginStatusEntry | undefined {
    return this.entries.get(pluginId);
  }

  getAll(): PluginStatusEntry[] {
    return Array.from(this.entries.values());
  }

  getInstalled(): PluginStatusEntry[] {
    return this.getAll();
  }

  getByTier(tier: number): PluginStatusEntry[] {
    return this.getAll().filter(e => e.tier === tier);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) {
      registryLog.warn('PluginStatusRegistry already initialized');
      return;
    }

    await this.loadFromDisk();
    this.initialized = true;
    registryLog.info(`PluginStatusRegistry initialized: ${this.entries.size} plugins`);
  }

  onPluginInstalled(pluginId: string, installed: InstalledPlugin, manifest?: { displayName?: string; tier?: number }): void {
    const entry: PluginStatusEntry = {
      id: pluginId,
      displayName: manifest?.displayName ?? pluginId,
      version: installed.version,
      tier: manifest?.tier ?? (installed.source === 'bundled' ? 0 : 1),
      distribution: installed.source === 'marketplace' || installed.source === 'bundled' ? installed.source : 'marketplace',
      installedAt: installed.installedAt,
      path: installed.path,
      active: false,
    };
    this.entries.set(pluginId, entry);
    registryLog.info(`Plugin registered: ${pluginId} (${entry.distribution})`);
  }

  onPluginUninstalled(pluginId: string): void {
    if (this.entries.delete(pluginId)) {
      registryLog.info(`Plugin unregistered: ${pluginId}`);
    }
  }

  onPluginActivated(pluginId: string): void {
    const entry = this.entries.get(pluginId);
    if (entry) {
      entry.active = true;
      registryLog.debug(`Plugin activated: ${pluginId}`);
    }
  }

  onPluginDeactivated(pluginId: string): void {
    const entry = this.entries.get(pluginId);
    if (entry) {
      entry.active = false;
      registryLog.debug(`Plugin deactivated: ${pluginId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: build map from disk state
  // ---------------------------------------------------------------------------

  private async loadFromDisk(): Promise<void> {
    this.entries.clear();

    await this.loadMarketplacePlugins();
    await this.loadBundledPlugins();
  }

  private async loadMarketplacePlugins(): Promise<void> {
    const userPluginsDir = path.join(app.getPath('userData'), 'plugins');
    const manifestPath = path.join(userPluginsDir, '.installed.json');

    try {
      const data = await fs.readFile(manifestPath, 'utf-8');
      const plugins = JSON.parse(data) as InstalledPlugin[];

      for (const p of plugins) {
        const manifest = await this.readManifest(p.path);
        this.entries.set(p.id, {
          id: p.id,
          displayName: manifest?.displayName ?? p.id,
          version: p.version,
          tier: manifest?.tier ?? 1,
          distribution: 'marketplace',
          installedAt: p.installedAt,
          path: p.path,
          active: false,
        });
      }

      registryLog.debug(`Loaded ${plugins.length} marketplace plugins from .installed.json`);
    } catch {
      registryLog.debug('No .installed.json found (first run or empty)');
    }
  }

  private async loadBundledPlugins(): Promise<void> {
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    const bundledBase = isDev
      ? path.join(app.getAppPath(), '../../plugins')
      : path.join(process.resourcesPath, 'bundled_plugins');

    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(bundledBase, { withFileTypes: true });
    } catch {
      registryLog.debug(`Bundled plugins directory not found: ${bundledBase}`);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const pluginDir = path.join(bundledBase, entry.name);
      const manifest = await this.readManifest(pluginDir);
      if (!manifest) continue;

      const pluginId = manifest.id ?? entry.name;

      // Marketplace installs override bundled (already loaded above)
      if (this.entries.has(pluginId)) continue;

      this.entries.set(pluginId, {
        id: pluginId,
        displayName: manifest.displayName ?? pluginId,
        version: manifest.version ?? '0.0.0',
        tier: manifest.tier ?? 0,
        distribution: 'bundled',
        installedAt: new Date().toISOString(),
        path: pluginDir,
        active: false,
      });
    }

    registryLog.debug(`Scanned bundled plugins directory: ${bundledBase}`);
  }

  private async readManifest(pluginDir: string): Promise<{ id?: string; displayName?: string; version?: string; tier?: number } | null> {
    try {
      const content = await fs.readFile(path.join(pluginDir, 'manifest.json'), 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton accessors
// ---------------------------------------------------------------------------

export function getPluginStatusRegistry(): PluginStatusRegistry {
  return PluginStatusRegistry.instance;
}

export async function initializePluginStatusRegistry(): Promise<PluginStatusRegistry> {
  const registry = PluginStatusRegistry.instance;
  await registry.initialize();
  return registry;
}
