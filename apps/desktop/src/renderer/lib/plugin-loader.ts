/**
 * PluginLoader - Plugin Loader
 *
 * Responsibilities:
 * 1. Scan plugin directories
 * 2. Parse manifest.json
 * 3. Validate plugin configuration
 * 4. Dynamically load plugin modules
 * 5. Manage plugin lifecycle
 */

import { safeForEach } from '@shared/utils/safe-emit';
import type {
  PluginManifest,
  PluginInstance,
  PluginState,
  PluginModule,
  PluginContext,
  PluginPermission,
  PluginType,
  I18nContribution,
} from '@shared/types';

import { addPluginTranslations, getCurrentLocale } from '../../i18n';
import { CORE_NAMESPACES, SUPPORTED_LOCALES } from '../../i18n/config';
import i18n from 'i18next';

// =============================================================================
// TICKET_454_2: Shared Module Registry for Marketplace Plugins
// =============================================================================
// Marketplace plugins are built as IIFE bundles with externalized shared deps.
// The host provides these deps via globalThis.__nexus_modules__ so plugins
// resolve them without relying on Vite's bare import rewrite pipeline.

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import * as ReactI18next from 'react-i18next';
import * as I18next from 'i18next';
import * as LucideReact from 'lucide-react';
import { AuthRequiredBanner, AuthRequiredButton } from '../components/common';
import { usePluginAuth } from '../hooks/usePluginAuth';
import { HOST_MODULES } from './host-module-registry';

const SHARED_MODULES: Record<string, unknown> = {
  'react': React,
  'react-dom': ReactDOM,
  'react/jsx-runtime': ReactJsxRuntime,
  'react-i18next': ReactI18next,
  'i18next': I18next,
  'lucide-react': LucideReact,
  // TICKET_571: Unified auth UI components for marketplace plugins
  '@nexus/auth': { AuthRequiredBanner, AuthRequiredButton, usePluginAuth },
};

// Initialize global module registry before any plugin loads
(globalThis as Record<string, unknown>).__nexus_modules__ = SHARED_MODULES;

// TICKET_809_4a: Host UI registry. Curated first-party renderer
// components plugins reuse (currently @host/secrets for credential UX).
(globalThis as Record<string, unknown>).__nexus_host__ = HOST_MODULES;

// =============================================================================
// Types
// =============================================================================

export interface LoaderConfig {
  pluginsDir: string;           // Plugin directory path
  enabledPlugins?: string[];    // List of enabled plugins
  trustedPlugins?: string[];    // List of trusted plugins (can skip sandbox)
}

export interface LoadResult {
  success: boolean;
  pluginId: string;
  /** Developer-facing English message (preserved for plugin authors / console) */
  error?: string;
  /**
   * Stable machine-readable error code from `PluginError.code`. UI consumers
   * should prefer translating this code over rendering `error` directly
   * (TICKET_786_4). Codes are scoped under `PLUGIN_LOADER_*` /
   * `PLUGIN_CONTEXT_*`.
   */
  errorCode?: string;
}

/**
 * TICKET_786_4: Plugin-system error with a stable machine-readable `code`
 * alongside the developer-facing English `message`. UI surfaces should
 * translate the code via the `errors` namespace; the message stays in
 * English so plugin authors reading the console keep useful detail.
 */
export class PluginError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
  }
}

export interface PluginLoadEvent {
  type: 'loading' | 'loaded' | 'error' | 'activated' | 'deactivated';
  pluginId: string;
  message?: string;
}

type PluginEventHandler = (event: PluginLoadEvent) => void;

// =============================================================================
// TICKET_135: V3 Deprecated Plugins
// =============================================================================

/**
 * Plugins deprecated in V3 architecture.
 * These will be filtered out during discovery.
 */
const DEPRECATED_PLUGIN_IDS = [
  'com.stratcraft.data-source-nexus', // V3: Data merged into Backtest module
] as const;

// =============================================================================
// Manifest Validation
// =============================================================================

// Core required fields (type is now optional for contribution-based plugins)
const REQUIRED_MANIFEST_FIELDS: (keyof PluginManifest)[] = [
  'id',
  'name',
  'displayName',
  'version',
  'main',
];

const VALID_PLUGIN_TYPES: PluginType[] = [
  'nexus',
  'ui',
  'data-source',
  'indicator',
  'strategy',
  'execution',
  'analysis',
  'utility',
];

const VALID_PERMISSIONS: PluginPermission[] = [
  'network',
  'network:internal',
  'filesystem',
  'filesystem:full',
  'database',
  'notification',
  'clipboard',
  'shell',
  'native',
];

/**
 * Infer plugin type from contributions (TICKET_097)
 * Used for backward compatibility when 'type' field is not provided
 */
function inferPluginType(contributes: Record<string, unknown>): PluginType {
  if (contributes.dataFeeds && Array.isArray(contributes.dataFeeds) && contributes.dataFeeds.length > 0) {
    return 'data-source';
  }
  if (contributes.strategies && Array.isArray(contributes.strategies) && contributes.strategies.length > 0) {
    return 'strategy';
  }
  if (contributes.backtestEngines && Array.isArray(contributes.backtestEngines) && contributes.backtestEngines.length > 0) {
    return 'execution';
  }
  if (contributes.indicators && Array.isArray(contributes.indicators) && contributes.indicators.length > 0) {
    return 'indicator';
  }
  if (contributes.liveTraders && Array.isArray(contributes.liveTraders) && contributes.liveTraders.length > 0) {
    return 'execution';
  }
  if (contributes.visualizations && Array.isArray(contributes.visualizations) && contributes.visualizations.length > 0) {
    return 'analysis';
  }
  // Default to utility for UI-only contributions
  return 'utility';
}

function validateManifest(manifest: unknown): manifest is PluginManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new PluginError('PLUGIN_LOADER_MANIFEST_NOT_OBJECT', i18n.t('PLUGIN_LOADER_MANIFEST_NOT_OBJECT', { ns: 'errors' }));
  }

  const m = manifest as Record<string, unknown>;

  // Check required fields
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!(field in m)) {
      throw new PluginError('PLUGIN_LOADER_MANIFEST_MISSING_FIELD', `Missing required field: ${field}`);
    }
  }

  // Validate id format (e.g., "com.stratcraft.chart")
  if (typeof m.id !== 'string' || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/.test(m.id)) {
    throw new PluginError('PLUGIN_LOADER_INVALID_ID_FORMAT', i18n.t('PLUGIN_LOADER_INVALID_ID_FORMAT', { ns: 'errors' }));
  }

  // Validate version format (semver)
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version)) {
    throw new PluginError('PLUGIN_LOADER_INVALID_VERSION_FORMAT', i18n.t('PLUGIN_LOADER_INVALID_VERSION_FORMAT', { ns: 'errors' }));
  }

  // Validate or infer plugin type (TICKET_097 backward compatibility)
  if (m.type) {
    // Explicit type provided - validate it
    if (!VALID_PLUGIN_TYPES.includes(m.type as PluginType)) {
      throw new PluginError('PLUGIN_LOADER_INVALID_TYPE', `Invalid plugin type: ${m.type}. Valid types: ${VALID_PLUGIN_TYPES.join(', ')}`);
    }
  } else if (m.contributes && typeof m.contributes === 'object') {
    // No type but has contributes - infer type
    m.type = inferPluginType(m.contributes as Record<string, unknown>);
  } else {
    // Neither type nor contributes - require type field
    throw new PluginError('PLUGIN_LOADER_MANIFEST_MISSING_FIELD', i18n.t('PLUGIN_LOADER_MANIFEST_MISSING_FIELD_TYPE', { ns: 'errors' }));
  }

  // Validate permissions
  if (m.permissions && Array.isArray(m.permissions)) {
    for (const perm of m.permissions) {
      if (!VALID_PERMISSIONS.includes(perm as PluginPermission)) {
        throw new PluginError('PLUGIN_LOADER_INVALID_PERMISSION', `Invalid permission: ${perm}. Valid permissions: ${VALID_PERMISSIONS.join(', ')}`);
      }
    }
  }

  return true;
}

// =============================================================================
// PluginLoader Class
// =============================================================================

export class PluginLoader {
  private config: LoaderConfig;
  private plugins: Map<string, PluginInstance> = new Map();
  private eventHandlers: Set<PluginEventHandler> = new Set();
  private contextFactory: ((pluginId: string, pluginPath: string) => PluginContext) | null = null;
  // Contribution registry disposables (TICKET_097)
  // Track loaded i18n namespaces to prevent conflicts (TICKET_086)
  private loadedI18nNamespaces: Map<string, string> = new Map();
  private activatingPlugins: Set<string> = new Set();

  constructor(config: LoaderConfig) {
    this.config = config;
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  /**
   * Register event listener
   */
  onEvent(handler: PluginEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: PluginLoadEvent): void {
    safeForEach(this.eventHandlers, '[E:PLUGIN_LOADER:EVENT_HANDLER_ERROR] Plugin event handler error:', event);
  }

  // ===========================================================================
  // Context Factory
  // ===========================================================================

  /**
   * Set PluginContext factory function
   */
  setContextFactory(factory: (pluginId: string, pluginPath: string) => PluginContext): void {
    this.contextFactory = factory;
  }

  // ===========================================================================
  // Plugin Discovery
  // ===========================================================================

  /**
   * Scan plugin directories to discover all available plugins
   *
   * Uses dual-path loading:
   * - bundled: Built-in plugins (read-only)
   * - user: User-installed plugins (read-write)
   */
  async discoverPlugins(): Promise<PluginManifest[]> {
    // Prefer new scanAll API (dual-path)
    const pluginApi = window.electronAPI?.plugin;
    if (pluginApi && typeof pluginApi.scanAll === 'function') {
      return this.discoverPluginsViasScanAll();
    }

    // Fallback: Use legacy single-path API
    return this.discoverPluginsLegacy();
  }

  /**
   * Discover plugins using new scanAll API (recommended)
   */
  private async discoverPluginsViasScanAll(): Promise<PluginManifest[]> {
    const scannedPlugins = await window.electronAPI!.plugin!.scanAll();
    console.debug('[PluginLoader] Scanned plugins:', scannedPlugins.map(p => p.id));
    const manifests: PluginManifest[] = [];

    for (const plugin of scannedPlugins) {
      // TICKET_135: Skip deprecated plugins
      if (DEPRECATED_PLUGIN_IDS.includes(plugin.id as typeof DEPRECATED_PLUGIN_IDS[number])) {
        console.debug(`[PluginLoader] Skipping deprecated plugin: ${plugin.id}`);
        continue;
      }

      try {
        const manifest = plugin.manifest as PluginManifest;
        validateManifest(manifest);

        // Add path and source information
        const extendedManifest = manifest as PluginManifest & {
          _path: string;
          _source: 'bundled' | 'user';
        };
        extendedManifest._path = plugin.path;
        extendedManifest._source = plugin.source;

        manifests.push(extendedManifest);
        console.debug(`[PluginLoader] Validated plugin: ${plugin.id}`);
      } catch (error) {
        console.warn(`[W:PLUGIN_LOADER:INVALID_MANIFEST] [PluginLoader] Invalid manifest for plugin ${plugin.id}:`, error);
      }
    }

    console.info(`[PluginLoader] Discovered ${manifests.length} valid plugins:`, manifests.map(m => m.id));
    return manifests;
  }

  /**
   * Discover plugins using legacy single-path API (deprecated)
   */
  private async discoverPluginsLegacy(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = [];
    const pluginDirs = await this.getPluginDirectories();

    for (const dir of pluginDirs) {
      try {
        const manifest = await this.loadManifest(dir);
        if (manifest) {
          manifests.push(manifest);
        }
      } catch (error) {
        console.warn(`[W:PLUGIN_LOADER:LOAD_MANIFEST_FAILED] Failed to load manifest from ${dir}:`, error);
      }
    }

    return manifests;
  }

  /**
   * Get plugin directories list (legacy)
   */
  private async getPluginDirectories(): Promise<string[]> {
    // New API
    if (window.electronAPI?.plugin?.getDirectories) {
      return window.electronAPI.plugin.getDirectories(this.config.pluginsDir);
    }

    // Old API (deprecated)
    if (window.electronAPI?.getPluginDirectories) {
      return window.electronAPI.getPluginDirectories(this.config.pluginsDir);
    }

    console.warn('[W:PLUGIN_LOADER:DIRECTORIES_API_MISSING] electronAPI plugin directories API not available');
    return [];
  }

  /**
   * Load and validate manifest.json
   */
  private async loadManifest(pluginDir: string): Promise<PluginManifest | null> {
    const manifestPath = `${pluginDir}/manifest.json`;

    // Read file via IPC
    let content: string;
    if (window.electronAPI?.plugin?.readFile) {
      // New API
      content = await window.electronAPI.plugin.readFile(manifestPath);
    } else if (window.electronAPI?.readFile) {
      // Old API (deprecated)
      content = await window.electronAPI.readFile(manifestPath);
    } else {
      // Development environment via fetch
      const response = await fetch(manifestPath);
      if (!response.ok) return null;
      content = await response.text();
    }

    const manifest = JSON.parse(content);
    validateManifest(manifest);

    // Add path information
    (manifest as PluginManifest & { _path: string })._path = pluginDir;

    return manifest as PluginManifest;
  }

  // ===========================================================================
  // Plugin Loading
  // ===========================================================================

  /**
   * Load a single plugin
   */
  async loadPlugin(manifest: PluginManifest): Promise<LoadResult> {
    const pluginId = manifest.id;

    // Check if already loaded
    if (this.plugins.has(pluginId)) {
      return { success: true, pluginId };
    }

    this.emit({ type: 'loading', pluginId });
    console.debug(`[PluginLoader] Loading plugin: ${pluginId}`);

    try {
      // Create plugin state
      const state: PluginState = {
        id: pluginId,
        enabled: false,
        loaded: false,
        active: false,
      };

      // Create plugin instance
      const instance: PluginInstance = {
        manifest,
        state,
      };

      // Load plugin module
      const pluginPath = (manifest as PluginManifest & { _path?: string })._path || '';
      console.debug(`[PluginLoader] Loading module for ${pluginId} from: ${pluginPath}/${manifest.main}`);
      const module = await this.loadModule(manifest, pluginPath);

      if (module) {
        instance.module = module;
        console.debug(`[PluginLoader] Module loaded successfully for ${pluginId}`);

        // Create context
        if (this.contextFactory) {
          instance.context = this.contextFactory(pluginId, pluginPath);
        }
      } else {
        console.warn(`[W:PLUGIN_LOADER:MODULE_LOAD_FAILED_RECOVERABLE] [PluginLoader] Failed to load module for ${pluginId}, but continuing...`);
      }

      // Mark as loaded
      state.loaded = true;
      state.loadedAt = Date.now();

      this.plugins.set(pluginId, instance);
      this.emit({ type: 'loaded', pluginId });
      console.info(`[PluginLoader] Plugin ${pluginId} loaded successfully (module: ${!!module}, context: ${!!instance.context})`);

      return { success: true, pluginId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MSG_UNKNOWN_ERROR';
      // TICKET_786_4: preserve machine-readable code for UI translation
      const errorCode = error instanceof PluginError ? error.code : undefined;
      console.error(`[E:PLUGIN_LOADER:LOAD_PLUGIN_FAILED] [PluginLoader] Failed to load plugin ${pluginId}:`, error);
      this.emit({ type: 'error', pluginId, message });
      return { success: false, pluginId, error: message, errorCode };
    }
  }

  /**
   * Dynamically load plugin module
   */
  private async loadModule(manifest: PluginManifest, pluginPath: string): Promise<PluginModule | null> {
    const mainEntry = manifest.main;
    const modulePath = `${pluginPath}/${mainEntry}`;
    const source = (manifest as PluginManifest & { _source?: string })._source;

    console.debug(`[PluginLoader] loadModule: ${manifest.id}, isolation: ${manifest.isolation}, source: ${source}, path: ${modulePath}`);

    try {
      // Choose loading method based on isolation mode
      if (manifest.isolation === 'sandbox') {
        // Sandbox mode: load via iframe or Web Worker
        return await this.loadSandboxedModule(modulePath);
      } else {
        // Trusted mode: bundled plugins use dynamic import, user plugins use IIFE eval
        return await this.loadTrustedModule(modulePath, source === 'user');
      }
    } catch (error) {
      console.error(`[E:PLUGIN_LOADER:MODULE_LOAD_FAILED] [PluginLoader] Failed to load module from ${modulePath}:`, error);
      return null;
    }
  }

  /**
   * Load trusted mode plugin
   *
   * TICKET_454_2: Two loading strategies:
   * - Bundled plugins: direct dynamic import (Vite resolves bare imports)
   * - User/Marketplace plugins: fetch + eval IIFE (bare imports resolve via __nexus_modules__)
   */
  private async loadTrustedModule(modulePath: string, isUserPlugin = false): Promise<PluginModule> {
    if (isUserPlugin) {
      return this.loadIIFEModule(modulePath);
    }

    console.debug(`[PluginLoader] Attempting dynamic import: ${modulePath}`);
    // Development: direct import
    // Production: load via file:// protocol
    const module = await import(/* @vite-ignore */ modulePath);
    console.debug(`[PluginLoader] Dynamic import successful, checking module structure...`);
    return module.default || module;
  }

  /**
   * TICKET_454_2: Load IIFE-formatted plugin via <script> tag injection.
   * Marketplace plugins are built as IIFE bundles that resolve shared deps
   * (react, react-dom, etc.) via globalThis.__nexus_modules__.
   *
   * Uses <script src="..."> instead of eval() to comply with CSP `script-src 'self'`.
   * Vite dev server serves user plugin files as same-origin (TICKET_442 server.fs.allow).
   * Rollup IIFE output assigns to `this.__nexus_plugin_export__` (window in browser).
   * Default export is at `.default` property of the assigned object.
   */
  private async loadIIFEModule(modulePath: string): Promise<PluginModule> {
    console.debug(`[PluginLoader] Loading IIFE module via script tag: ${modulePath}`);

    const win = window as unknown as Record<string, unknown>;
    const previousValue = win.__nexus_plugin_export__;

    try {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = modulePath;
        script.onload = () => {
          document.head.removeChild(script);
          resolve();
        };
        script.onerror = () => {
          document.head.removeChild(script);
          reject(new Error(`Failed to load plugin script: ${modulePath}`));
        };
        document.head.appendChild(script);
      });

      const exported = win.__nexus_plugin_export__ as Record<string, unknown> | undefined;
      if (!exported) {
        throw new PluginError('PLUGIN_LOADER_IIFE_NO_EXPORT', 'IIFE plugin did not assign to __nexus_plugin_export__');
      }
      // Rollup IIFE puts default export at .default
      const module = (exported.default || exported) as PluginModule;
      console.debug(`[PluginLoader] IIFE module loaded successfully`);
      return module;
    } finally {
      // Restore previous value (cleanup)
      win.__nexus_plugin_export__ = previousValue;
    }
  }

  /**
   * Load sandboxed mode plugin (via iframe)
   */
  private async loadSandboxedModule(_modulePath: string): Promise<PluginModule> {
    // TODO: Implement iframe sandbox loading
    // Returns a proxy module that communicates with iframe via postMessage
    throw new PluginError('PLUGIN_LOADER_SANDBOX_NOT_IMPLEMENTED', i18n.t('PLUGIN_LOADER_SANDBOX_NOT_IMPLEMENTED', { ns: 'errors' }));
  }

  /**
   * Batch load plugins
   */
  async loadPlugins(manifests: PluginManifest[]): Promise<LoadResult[]> {
    const results: LoadResult[] = [];

    for (const manifest of manifests) {
      const result = await this.loadPlugin(manifest);
      results.push(result);
    }

    return results;
  }

  // ===========================================================================
  // Plugin Activation
  // ===========================================================================

  /**
   * Activate plugin
   */
  async activatePlugin(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (instance.state.active || this.activatingPlugins.has(pluginId)) {
      return true;
    }

    if (!instance.module || !instance.context) {
      throw new Error(`Plugin not loaded: ${pluginId}`);
    }

    this.activatingPlugins.add(pluginId);
    try {
      // Load plugin i18n translations BEFORE activate() so resources are
      // available when the plugin's ViewProvider renders its first frame.
      const pluginPath = (instance.manifest as PluginManifest & { _path?: string })._path || '';
      await this.loadPluginI18n(instance.manifest, pluginPath);

      // Call plugin's activate method
      instance.api = await instance.module.activate(instance.context);
      instance.state.active = true;
      instance.state.enabled = true;
      instance.state.activatedAt = Date.now();

      this.emit({ type: 'activated', pluginId });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MSG_PLUGIN_ACTIVATION_FAILED';
      console.error(`[E:PLUGIN_LOADER:ACTIVATION_FAILED] [PluginLoader] Plugin ${pluginId} activation FAILED:`, error);
      instance.state.error = message;
      this.emit({ type: 'error', pluginId, message });
      return false;
    } finally {
      this.activatingPlugins.delete(pluginId);
    }
  }

  // ===========================================================================
  // Plugin I18N Loading (TICKET_086)
  // ===========================================================================

  /**
   * Validate i18n contribution namespaces
   * Returns validation result with errors if any
   */
  private validateI18nNamespaces(
    pluginId: string,
    i18nContrib: I18nContribution
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const ns of i18nContrib.namespaces) {
      // Check conflict with core namespaces
      if (CORE_NAMESPACES.includes(ns as typeof CORE_NAMESPACES[number])) {
        errors.push(`Plugin '${pluginId}': Namespace '${ns}' conflicts with core namespace`);
      }
      // Check conflict with other plugins (same plugin re-activating is OK)
      const owner = this.loadedI18nNamespaces.get(ns);
      if (owner && owner !== pluginId) {
        errors.push(`Plugin '${pluginId}': Namespace '${ns}' already loaded by another plugin`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Load plugin i18n translations
   */
  private async loadPluginI18n(manifest: PluginManifest, pluginPath: string): Promise<void> {
    const i18nContrib = manifest.contributes?.i18n;
    if (!i18nContrib) return;

    // Validate namespaces
    const validation = this.validateI18nNamespaces(manifest.id, i18nContrib);
    if (!validation.valid) {
      for (const error of validation.errors) {
        console.error(`[E:PLUGIN_LOADER:I18N_VALIDATION_ERROR] [PluginLoader] I18N validation error: ${error}`);
      }
      return;
    }

    const { path: localePath, namespaces } = i18nContrib;
    const supportedLocales = Object.keys(SUPPORTED_LOCALES);
    const currentLocale = getCurrentLocale();

    console.info(`[PluginLoader] Loading i18n for plugin ${manifest.id}, namespaces: ${namespaces.join(', ')}`);

    for (const ns of namespaces) {
      // Load current locale and fallback (en_US)
      const localesToLoad = [currentLocale];
      if (currentLocale !== 'en_US') {
        localesToLoad.push('en_US');
      }

      for (const locale of localesToLoad) {
        if (!supportedLocales.includes(locale)) continue;

        const filePath = `${pluginPath}/${localePath.replace(/^\.\//, '')}/${locale}/${ns}.json`;

        try {
          let translations: Record<string, unknown> | null = null;

          // Try to load via IPC
          if (window.electronAPI?.plugin?.readFile) {
            const content = await window.electronAPI.plugin.readFile(filePath);
            translations = JSON.parse(content);
          } else {
            // Fallback to fetch (development)
            const response = await fetch(filePath);
            if (response.ok) {
              translations = await response.json();
            }
          }

          if (translations) {
            addPluginTranslations(locale, ns, translations);
            console.debug(`[PluginLoader] Loaded i18n: ${manifest.id}/${locale}/${ns}`);
          }
        } catch (error) {
          console.warn(`[W:PLUGIN_LOADER:I18N_LOAD_FAILED] [PluginLoader] I18n load failed: ${filePath}`, error);
        }
      }

      // Mark namespace as loaded by this plugin
      this.loadedI18nNamespaces.set(ns, manifest.id);
    }
  }

  /**
   * Deactivate plugin
   */
  async deactivatePlugin(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (!instance.state.active) {
      return true; // Already deactivated
    }

    try {
      // Unregister i18n namespaces (TICKET_086)
      const i18nContrib = instance.manifest.contributes?.i18n;
      if (i18nContrib) {
        for (const ns of i18nContrib.namespaces) {
          this.loadedI18nNamespaces.delete(ns);
        }
      }

      // Call plugin's deactivate method
      if (instance.module?.deactivate) {
        await instance.module.deactivate();
      }

      // Cleanup API
      if (instance.api?.deactivate) {
        await instance.api.deactivate();
      }

      instance.state.active = false;
      instance.state.enabled = false;
      instance.api = undefined;

      this.emit({ type: 'deactivated', pluginId });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MSG_PLUGIN_DEACTIVATION_FAILED';
      instance.state.error = message;
      this.emit({ type: 'error', pluginId, message });
      return false;
    }
  }

  // ===========================================================================
  // Plugin Access
  // ===========================================================================

  /**
   * Get plugin instance
   */
  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get all plugins
   */
  getAllPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugins grouped by type
   */
  getPluginsByType(type: PluginType): PluginInstance[] {
    return this.getAllPlugins().filter(p => p.manifest.type === type);
  }

  /**
   * Get all UI contribution points
   */
  getContributions(): {
    mainViews: Array<{ pluginId: string; contribution: NonNullable<PluginManifest['contributes']>['mainView'] }>;
    sidePanels: Array<{ pluginId: string; contribution: NonNullable<PluginManifest['contributes']>['sidePanel'] }>;
    bottomPanels: Array<{ pluginId: string; contribution: NonNullable<PluginManifest['contributes']>['bottomPanel'] }>;
    toolbars: Array<{ pluginId: string; contribution: NonNullable<PluginManifest['contributes']>['toolbar'] }>;
    commands: Array<{ pluginId: string; contribution: NonNullable<PluginManifest['contributes']>['commands'] }>;
  } {
    const result = {
      mainViews: [] as Array<{ pluginId: string; contribution: NonNullable<PluginManifest['contributes']>['mainView'] }>,
      sidePanels: [] as Array<{ pluginId: string; contribution: NonNullable<PluginManifest['contributes']>['sidePanel'] }>,
      bottomPanels: [] as Array<{ pluginId: string; contribution: NonNullable<PluginManifest['contributes']>['bottomPanel'] }>,
      toolbars: [] as Array<{ pluginId: string; contribution: NonNullable<PluginManifest['contributes']>['toolbar'] }>,
      commands: [] as Array<{ pluginId: string; contribution: NonNullable<PluginManifest['contributes']>['commands'] }>,
    };

    for (const plugin of this.plugins.values()) {
      if (!plugin.state.active || !plugin.manifest.contributes) continue;

      const { contributes } = plugin.manifest;
      const pluginId = plugin.manifest.id;

      if (contributes.mainView) {
        result.mainViews.push({ pluginId, contribution: contributes.mainView });
      }
      if (contributes.sidePanel) {
        result.sidePanels.push({ pluginId, contribution: contributes.sidePanel });
      }
      if (contributes.bottomPanel) {
        result.bottomPanels.push({ pluginId, contribution: contributes.bottomPanel });
      }
      if (contributes.toolbar) {
        result.toolbars.push({ pluginId, contribution: contributes.toolbar });
      }
      if (contributes.commands) {
        result.commands.push({ pluginId, contribution: contributes.commands });
      }
    }

    return result;
  }

  // ===========================================================================
  // Plugin Removal
  // ===========================================================================

  /**
   * TICKET_452: Remove a plugin from the internal plugins Map.
   * Must be called AFTER deactivatePlugin() to ensure proper cleanup.
   */
  removePlugin(pluginId: string): void {
    this.plugins.delete(pluginId);
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Unload all plugins
   */
  async unloadAll(): Promise<void> {
    const pluginIds = Array.from(this.plugins.keys());

    for (const pluginId of pluginIds) {
      await this.deactivatePlugin(pluginId);
    }

    this.plugins.clear();
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default PluginLoader;
