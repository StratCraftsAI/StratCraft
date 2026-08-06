/**
 * PluginConfigManager - Plugin User Configuration Manager
 *
 * TICKET_066: Service Entitlement Architecture
 * Manages user-config.json for each plugin (Layer 3 configuration)
 *
 * Configuration hierarchy:
 * - manifest.json: Plugin declares services (read-only, by developer)
 * - user-config.json: User preferences for services (read-write, by user)
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolvePluginEntitlements as resolvePluginEntitlementsCore,
  resolveServiceState as resolveServiceStateCore,
} from '@StratCraft/plugin-store';
import { appLog } from '../utils/logger';
import { ENTITLEMENT_TIER_LEVELS } from '../../shared/constants/entitlement';
import type {
  UserServiceConfig,
  ServiceEntitlementDefinition,
  ServiceEntitlementState,
  PluginEntitlementState,
  ServiceTier,
  PluginManifest,
} from '../../shared/types/plugin';

// =============================================================================
// Constants
// =============================================================================

const USER_CONFIG_FILENAME = 'user-config.json';

// =============================================================================
// PluginConfigManager Class
// =============================================================================

export class PluginConfigManager {
  private static instance: PluginConfigManager | null = null;
  private pluginConfigCache: Map<string, UserServiceConfig> = new Map();
  private initialized = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): PluginConfigManager {
    if (!PluginConfigManager.instance) {
      PluginConfigManager.instance = new PluginConfigManager();
    }
    return PluginConfigManager.instance;
  }

  /**
   * Initialize the plugin config manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      appLog.warn('PluginConfigManager already initialized');
      return;
    }

    appLog.info('Initializing PluginConfigManager...');
    this.initialized = true;
    appLog.info('PluginConfigManager initialized');
  }

  /**
   * Get the user config directory for a plugin
   */
  private getPluginConfigDir(pluginId: string): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'plugins', pluginId);
  }

  /**
   * Get the user-config.json path for a plugin
   */
  private getUserConfigPath(pluginId: string): string {
    return path.join(this.getPluginConfigDir(pluginId), USER_CONFIG_FILENAME);
  }

  /**
   * Ensure plugin config directory exists
   */
  private ensureConfigDir(pluginId: string): void {
    const configDir = this.getPluginConfigDir(pluginId);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      appLog.debug(`Created plugin config directory: ${configDir}`);
    }
  }

  // ===========================================================================
  // User Config Operations
  // ===========================================================================

  /**
   * Load user config for a plugin
   */
  loadUserConfig(pluginId: string): UserServiceConfig {
    // Check cache first
    const cached = this.pluginConfigCache.get(pluginId);
    if (cached) {
      return cached;
    }

    const configPath = this.getUserConfigPath(pluginId);

    // Return default if file doesn't exist
    if (!fs.existsSync(configPath)) {
      const defaultConfig: UserServiceConfig = { services: {} };
      return defaultConfig;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content) as UserServiceConfig;

      // Cache it
      this.pluginConfigCache.set(pluginId, config);

      return config;
    } catch (error) {
      appLog.error(`Failed to load user config for ${pluginId}:`, error);
      return { services: {} };
    }
  }

  /**
   * Save user config for a plugin
   */
  saveUserConfig(pluginId: string, config: UserServiceConfig): void {
    this.ensureConfigDir(pluginId);
    const configPath = this.getUserConfigPath(pluginId);

    try {
      const content = JSON.stringify(config, null, 2);
      fs.writeFileSync(configPath, content, 'utf-8');

      // Update cache
      this.pluginConfigCache.set(pluginId, config);

      appLog.debug(`Saved user config for ${pluginId}`);
    } catch (error) {
      appLog.error(`Failed to save user config for ${pluginId}:`, error);
      throw error;
    }
  }

  /**
   * Toggle a service's enabled state
   */
  toggleService(pluginId: string, serviceId: string, enabled: boolean): void {
    const config = this.loadUserConfig(pluginId);

    // Ensure services object exists
    if (!config.services) {
      config.services = {};
    }

    // Update service state
    config.services[serviceId] = { enabled };

    // Save
    this.saveUserConfig(pluginId, config);

    appLog.info(`Toggled service ${serviceId} in ${pluginId} to ${enabled}`);
  }

  /**
   * Get a service's enabled state from user config
   * Returns undefined if not explicitly set (will use manifest default)
   */
  getServiceEnabled(pluginId: string, serviceId: string): boolean | undefined {
    const config = this.loadUserConfig(pluginId);
    return config.services?.[serviceId]?.enabled;
  }

  // ===========================================================================
  // Entitlement State Resolution
  // ===========================================================================

  /**
   * Resolve the final entitlement state for a plugin's services
   * Merges: manifest defaults -> user config -> server entitlements (future)
   *
   * TICKET_1276 P2 Batch C2: the pure merge/tier-gating logic is the shared,
   * Electron-free `@StratCraft/plugin-store` entitlement core -- the SAME
   * function the MCP standalone server calls -- so both processes resolve
   * identical entitlement state (single owning-layer codebase, TICKET_854).
   * This method supplies the Electron-owned inputs (user-config from disk).
   */
  resolvePluginEntitlements(manifest: PluginManifest, userTier = 'free'): PluginEntitlementState {
    const userConfig = this.loadUserConfig(manifest.id);
    return resolvePluginEntitlementsCore(manifest, userConfig, userTier);
  }

  /**
   * Get tier mapping for a plugin (TICKET_075)
   */
  getPluginTierMapping(manifest: PluginManifest): Record<string, number> {
    return manifest.entitlements?.tierMapping || ENTITLEMENT_TIER_LEVELS;
  }

  /**
   * Resolve the final state for a single service.
   * TICKET_105: locked state based on user tier.
   *
   * TICKET_1276 P2 Batch C2: delegates to the shared, Electron-free
   * `@StratCraft/plugin-store` `resolveServiceState` core -- single owning-layer
   * implementation shared with the MCP standalone server (TICKET_854).
   */
  private resolveServiceState(
    _pluginId: string,
    definition: ServiceEntitlementDefinition,
    userConfig: UserServiceConfig,
    tierMapping?: Record<string, number>,
    userTier = 'free'
  ): ServiceEntitlementState {
    return resolveServiceStateCore(definition, userConfig, tierMapping, userTier);
  }

  /**
   * Check if a specific service is enabled
   */
  isServiceEnabled(manifest: PluginManifest, serviceId: string): boolean {
    const entitlements = this.resolvePluginEntitlements(manifest);
    const service = entitlements.services.find((s) => s.id === serviceId);
    return service?.enabled ?? false;
  }

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  /**
   * Clear cache for a plugin
   */
  clearCache(pluginId: string): void {
    this.pluginConfigCache.delete(pluginId);
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    this.pluginConfigCache.clear();
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    this.clearAllCache();
    this.initialized = false;
    appLog.info('PluginConfigManager shutdown');
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let pluginConfigManagerInstance: PluginConfigManager | null = null;

/**
 * Get the PluginConfigManager singleton
 */
export function getPluginConfigManager(): PluginConfigManager {
  if (!pluginConfigManagerInstance) {
    pluginConfigManagerInstance = PluginConfigManager.getInstance();
  }
  return pluginConfigManagerInstance;
}

/**
 * Initialize PluginConfigManager (call after app.whenReady)
 */
export async function initializePluginConfigManager(): Promise<PluginConfigManager> {
  const manager = getPluginConfigManager();
  await manager.initialize();
  return manager;
}

export default PluginConfigManager;
