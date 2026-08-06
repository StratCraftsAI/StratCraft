/**
 * ConfigService - Main configuration service
 *
 * TICKET_046: System-Level Configuration Implementation
 * Singleton service for managing system configuration.
 */

import { EventEmitter } from 'events';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { watch, FSWatcher } from 'chokidar';
import type {
  SystemConfig,
  ResolvedPaths,
  ConfigChangeEvent,
  PathsConfig,
  PerformanceConfig,
} from '../../shared/types/config';
import {
  DEFAULT_SYSTEM_CONFIG,
  HOT_RELOAD_ALLOWED_KEYS,
  REQUIRES_RESTART_KEYS,
} from '../../shared/types/config';
import {
  loadConfigWithDefaults,
  saveConfigFile,
  createDefaultConfigIfNotExists,
  getConfigFilePath,
  getResolvedPaths,
  expandAllPathVariables,
  getValueByPath,
  setValueByPath,
  ConfigParseError,
  // TICKET_055_1: Module config utilities
  extractModuleId,
  loadAllModuleConfigs,
  loadModuleConfig,
  saveModuleConfig,
} from './config-loader';
import { appLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import {
  isSystemConfigCapabilityKey,
  validateSystemConfigCapabilitySnapshot,
  validateSystemConfigCapabilityValue,
} from '@StratCraft/types';

// =============================================================================
// Workload Caps File (TICKET_1283)
// =============================================================================

/**
 * TICKET_1283: sweep / mining chains are bash-launched manually via systemd-run
 * (NOT from Electron), so they cannot read the Electron config directly. On every
 * config save ConfigService writes this small JSON next to the main config file so
 * those chains can consume the per-workload caps.
 */
export const WORKLOAD_CAPS_FILENAME = 'workload-caps.json';

// =============================================================================
// Config Health Types (TICKET_641_3)
// =============================================================================

export type ConfigHealthStatus = 'healthy' | 'warning' | 'error';

export interface ConfigHealth {
  status: ConfigHealthStatus;
  message: string;
  /** Timestamp of last successful config load */
  lastGoodLoadAt: number | null;
  /** Whether currently using last-known-good fallback */
  usingFallback: boolean;
}

// =============================================================================
// ConfigService Class
// =============================================================================

export class ConfigService extends EventEmitter {
  private static instance: ConfigService | null = null;

  private config: SystemConfig;
  private resolvedConfig: SystemConfig;
  private resolvedPaths: ResolvedPaths;
  private watcher: FSWatcher | null = null;
  private initialized = false;

  // TICKET_055_1: Module-level configuration storage
  private moduleConfigs: Map<string, Record<string, unknown>> = new Map();

  // TICKET_641_3: Config health tracking
  private _configHealth: ConfigHealth = {
    status: 'healthy',
    message: mainT(getCurrentMainLocale(), 'ui', 'configService.loadedSuccessfully'),
    lastGoodLoadAt: null,
    usingFallback: false,
  };

  private constructor() {
    super();
    this.config = { ...DEFAULT_SYSTEM_CONFIG };
    this.resolvedPaths = getResolvedPaths();
    this.resolvedConfig = expandAllPathVariables(this.config, this.resolvedPaths);
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  /**
   * Initialize the config service
   * Must be called after app.whenReady()
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      appLog.warn('ConfigService already initialized');
      return;
    }

    appLog.info('Initializing ConfigService...');

    // Update resolved paths (app paths may not be available before app.whenReady)
    this.resolvedPaths = getResolvedPaths();

    // Create default config if it doesn't exist
    const isFirstRun = createDefaultConfigIfNotExists();
    if (isFirstRun) {
      appLog.info('First run detected, created default config');
    }

    // Load configuration
    await this.reload();

    // TICKET_055_1: Load all module configs
    this.moduleConfigs = loadAllModuleConfigs();
    if (this.moduleConfigs.size > 0) {
      appLog.debug(`Loaded ${this.moduleConfigs.size} module config(s)`);
    }

    // Start file watcher for hot-reload
    this.startWatcher();

    this.initialized = true;
    appLog.info('ConfigService initialized');
  }

  /**
   * Reload configuration from file.
   * TICKET_641_3: On fatal parse error, retains the last-known-good config,
   * emits configHealthChanged for UI notification, and returns rejection info.
   *
   * @returns Result indicating whether the reload was accepted or rejected.
   */
  async reload(): Promise<{ accepted: boolean; error?: string }> {
    appLog.info('Reloading configuration...');

    try {
      // Load base config (throws ConfigParseError on fatal syntax errors)
      this.config = loadConfigWithDefaults();

      // Resolve path variables
      this.resolvedConfig = expandAllPathVariables(this.config, this.resolvedPaths);

      // Keep the non-Electron workload consumers on the same accepted
      // resource-governance snapshot after file-watcher, explicit, or startup
      // reloads. Previously this sidecar was refreshed only by Electron UI
      // writes, so a valid MCP config update could leave runtime enforcement
      // on stale caps.
      this.writeWorkloadCapsFile();

      // Mark healthy
      this.setConfigHealth({
        status: 'healthy',
        message: mainT(getCurrentMainLocale(), 'ui', 'configService.loadedSuccessfully'),
        lastGoodLoadAt: Date.now(),
        usingFallback: false,
      });

      this.emit('reloaded');
      appLog.info('Configuration reloaded');
      return { accepted: true };
    } catch (error) {
      if (error instanceof ConfigParseError) {
        // Retain current (last-known-good) config -- do NOT overwrite this.config
        const message = `Config file has fatal parse errors: ${error.message}. Using last-known-good configuration.`;
        appLog.error(`Config reload rejected: ${message}`);
        this.setConfigHealth({
          status: 'error',
          message,
          lastGoodLoadAt: this._configHealth.lastGoodLoadAt,
          usingFallback: true,
        });
        return { accepted: false, error: message };
      }
      throw error; // Unexpected errors propagate
    }
  }

  // ===========================================================================
  // Config Health (TICKET_641_3)
  // ===========================================================================

  /**
   * Get current config health status.
   * Accessible via IPC for UI display.
   */
  getConfigHealth(): ConfigHealth {
    return { ...this._configHealth };
  }

  /**
   * Update config health and emit event for UI notification.
   */
  private setConfigHealth(health: ConfigHealth): void {
    this._configHealth = health;
    this.emit('configHealthChanged', health);
  }

  /**
   * Start file watcher for hot-reload
   */
  private startWatcher(): void {
    const configPath = getConfigFilePath();

    this.watcher = watch(configPath, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', async () => {
      appLog.info('Config file changed, reloading...');
      await this.reload();
    });

    appLog.debug('Started config file watcher');
  }

  /**
   * Stop file watcher
   */
  private stopWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      appLog.debug('Stopped config file watcher');
    }
  }

  /**
   * Shutdown the config service
   */
  shutdown(): void {
    this.stopWatcher();
    this.initialized = false;
    appLog.info('ConfigService shutdown');
  }

  // ===========================================================================
  // Getters - Raw Config (with path variables)
  // ===========================================================================

  /**
   * Get raw config value by dot-notation path
   */
  getRaw<T>(path: string): T | undefined {
    return getValueByPath<T>(this.config as unknown as Record<string, unknown>, path);
  }

  /**
   * Get entire raw configuration
   */
  getAllRaw(): SystemConfig {
    return { ...this.config };
  }

  // ===========================================================================
  // Getters - Resolved Config (path variables expanded)
  // ===========================================================================

  /**
   * Get resolved config value by dot-notation path
   * TICKET_055_1: Supports both system config and module config paths
   */
  get<T>(path: string): T | undefined {
    // Check if this is a module config path
    const moduleId = extractModuleId(path);
    if (moduleId) {
      const moduleConfig = this.moduleConfigs.get(moduleId) || {};
      // Remove module prefix for lookup within module config
      const subPath = path.substring(moduleId.length + 1);
      return getValueByPath<T>(moduleConfig, subPath);
    }
    // System config
    return getValueByPath<T>(this.resolvedConfig as unknown as Record<string, unknown>, path);
  }

  /**
   * Get entire resolved configuration
   */
  getAll(): SystemConfig {
    return { ...this.resolvedConfig };
  }

  // ===========================================================================
  // Convenience Getters
  // ===========================================================================

  /**
   * Get paths configuration (resolved)
   */
  getPathsConfig(): PathsConfig {
    return { ...this.resolvedConfig.paths };
  }

  /**
   * Get performance configuration
   */
  getPerformanceConfig(): PerformanceConfig {
    return { ...this.resolvedConfig.performance };
  }

  /**
   * Get resolved paths
   */
  getResolvedPaths(): ResolvedPaths {
    return { ...this.resolvedPaths };
  }

  // ===========================================================================
  // Setters
  // ===========================================================================

  /**
   * Set a config value and save to file
   * TICKET_055_1: Routes to module config or system config based on path
   * Returns ConfigChangeEvent if value was changed, null otherwise
   */
  async set(path: string, value: unknown): Promise<ConfigChangeEvent | null> {
    // Check if this is a module config path
    const moduleId = extractModuleId(path);

    if (moduleId) {
      // Module config handling
      let moduleConfig = this.moduleConfigs.get(moduleId) || {};
      const subPath = path.substring(moduleId.length + 1);
      const oldValue = getValueByPath(moduleConfig, subPath);

      // No change
      if (JSON.stringify(oldValue) === JSON.stringify(value)) {
        return null;
      }

      // Update module config
      setValueByPath(moduleConfig, subPath, value);
      this.moduleConfigs.set(moduleId, moduleConfig);

      // Save to module config file
      saveModuleConfig(moduleId, moduleConfig);

      const event: ConfigChangeEvent = {
        path,
        oldValue,
        newValue: value,
        requiresRestart: false, // Module configs typically don't require restart
      };

      this.emit('changed', event);
      appLog.info(`Module config changed: ${path}`);

      return event;
    }

    // System config handling (original logic)
    const oldValue = this.getRaw(path);

    // No change
    if (JSON.stringify(oldValue) === JSON.stringify(value)) {
      return null;
    }

    if (isSystemConfigCapabilityKey(path)) {
      validateSystemConfigCapabilityValue(path, value);
      const candidate = structuredClone(this.config) as unknown as Record<string, unknown>;
      setValueByPath(candidate, path, value);
      const validation = validateSystemConfigCapabilitySnapshot(candidate);
      if (!validation.valid) {
        throw new Error(validation.errors.map(error => error.message).join('; '));
      }
    }

    // Update raw config
    setValueByPath(this.config as unknown as Record<string, unknown>, path, value);

    // Re-resolve with new values
    this.resolvedConfig = expandAllPathVariables(this.config, this.resolvedPaths);

    // Save to file
    saveConfigFile(this.config);

    // TICKET_1283: mirror the per-workload caps to a sidecar JSON that the
    // bash-launched sweep/mining chains read (they cannot see the Electron config).
    this.writeWorkloadCapsFile();

    // Check if requires restart
    const requiresRestart = this.requiresRestart(path);

    const event: ConfigChangeEvent = {
      path,
      oldValue,
      newValue: value,
      requiresRestart,
    };

    this.emit('changed', event);
    appLog.info(`Config changed: ${path}`, requiresRestart ? '(requires restart)' : '');

    return event;
  }

  // ===========================================================================
  // Hot-Reload Helpers
  // ===========================================================================

  /**
   * Check if a config key change requires restart
   */
  requiresRestart(path: string): boolean {
    // Check if the path starts with any of the requires-restart keys
    return REQUIRES_RESTART_KEYS.some(
      (key) => path === key || path.startsWith(key + '.')
    );
  }

  /**
   * Check if a config key supports hot-reload
   */
  supportsHotReload(path: string): boolean {
    return HOT_RELOAD_ALLOWED_KEYS.some(
      (key) => path === key || path.startsWith(key + '.')
    );
  }

  /**
   * Get list of pending restart-required changes
   */
  getPendingRestartChanges(): string[] {
    // This would track changes that require restart
    // For now, return empty - implement if needed
    return [];
  }

  // ===========================================================================
  // Workload Caps File (TICKET_1283)
  // ===========================================================================

  /**
   * TICKET_1283: write the per-workload resource caps to a sidecar JSON next to
   * the main config file so the manually systemd-run-launched sweep/mining chains
   * can read them. Defensive: a caps-file write failure must not break config save,
   * but the error is logged (never swallowed silently -- TICKET_858).
   */
  private writeWorkloadCapsFile(): void {
    const gov = this.config.resourceGovernance;
    if (!gov) return; // governance block absent -- nothing to mirror
    try {
      const configDir = dirname(getConfigFilePath());
      const capsPath = join(configDir, WORKLOAD_CAPS_FILENAME);
      const payload = {
        enabled: gov.enabled,
        sweep: gov.sweep.capPercent,
        mining: gov.mining.capPercent,
        lstm: gov.lstm.capPercent,
      };
      writeFileSync(capsPath, JSON.stringify(payload, null, 2), 'utf-8');
      appLog.debug(`[TICKET_1283] Wrote workload caps file: ${capsPath}`);
    } catch (error) {
      appLog.error(
        `[TICKET_1283] Failed to write ${WORKLOAD_CAPS_FILENAME}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /**
   * Validate current configuration
   */
  validate(): { valid: boolean; errors: string[] } {
    const result = validateSystemConfigCapabilitySnapshot(
      this.config as unknown as Record<string, unknown>,
    );
    return {
      valid: result.valid,
      errors: result.errors.map(error => error.message),
    };
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let configServiceInstance: ConfigService | null = null;

/**
 * Get the ConfigService singleton
 */
export function getConfigService(): ConfigService {
  if (!configServiceInstance) {
    configServiceInstance = ConfigService.getInstance();
  }
  return configServiceInstance;
}

/**
 * Initialize ConfigService (call after app.whenReady)
 */
export async function initializeConfigService(): Promise<ConfigService> {
  const service = getConfigService();
  await service.initialize();
  return service;
}

export default ConfigService;
