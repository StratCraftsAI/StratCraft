/**
 * EntitlementEnforcer - Architecture-Level Entitlement Control
 *
 * TICKET_066: Service Entitlement Architecture
 *
 * This service enforces entitlements at the L1 (Extension Host) layer.
 * Plugins do NOT self-enforce entitlements - this service is the single
 * point of enforcement.
 *
 * Key responsibilities:
 * - Check if a service is enabled before execution
 * - Aggregate entitlements from all plugins
 * - Provide API for UI to query service states
 * - Log all entitlement checks for audit
 */

import { EventEmitter } from 'events';
import { appLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import { AUDIT_LOG_MAX_ENTRIES } from '../../shared/constants/validation';
import {
  getPluginConfigManager,
  PluginConfigManager,
} from './plugin-config-manager';
import { resolveUserTier, type UserTierContext } from '@StratCraft/plugin-store';
import type {
  PluginManifest,
  ServiceEntitlementState,
  PluginEntitlementState,
} from '../../shared/types/plugin';

// =============================================================================
// Types
// =============================================================================

export interface EntitlementCheckResult {
  allowed: boolean;
  reason?: string;
  service?: ServiceEntitlementState;
}

export interface ServiceExecutionContext {
  pluginId: string;
  serviceId: string;
  params?: unknown;
}

export interface EntitlementAuditEntry {
  timestamp: number;
  pluginId: string;
  serviceId: string;
  action: 'check' | 'execute' | 'toggle';
  result: 'allowed' | 'denied';
  reason?: string;
}

// =============================================================================
// EntitlementEnforcer Class
// =============================================================================

export class EntitlementEnforcer extends EventEmitter {
  private static instance: EntitlementEnforcer | null = null;

  private pluginConfigManager: PluginConfigManager;
  private manifestCache: Map<string, PluginManifest> = new Map();
  private auditLog: EntitlementAuditEntry[] = [];
  private initialized = false;

  // Connected mode setting
  private connectionMode: 'standalone' | 'connected' = 'standalone';

  // TICKET_105: User tier tracking (per-plugin user tier, default to 'free' when not logged in)
  private pluginUserTiers: Map<string, string> = new Map();

  // TICKET_188: Default user tier for newly registered plugins
  private defaultUserTier: string = 'free';

  // TICKET_798: Account-level plan tier, independent of per-plugin overrides.
  // Set by entitlement-sync-service after login / refresh; consulted by the
  // marketplace install gate so error messages quote the user's real plan
  // (not the 'free' sentinel that pluginUserTiers returns for uninstalled
  // plugins).
  private accountPlanTier: string = 'free';

  private constructor() {
    super();
    this.pluginConfigManager = getPluginConfigManager();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): EntitlementEnforcer {
    if (!EntitlementEnforcer.instance) {
      EntitlementEnforcer.instance = new EntitlementEnforcer();
    }
    return EntitlementEnforcer.instance;
  }

  /**
   * Initialize the enforcer
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      appLog.warn('EntitlementEnforcer already initialized');
      return;
    }

    appLog.info('Initializing EntitlementEnforcer...');

    // Ensure plugin config manager is initialized
    await this.pluginConfigManager.initialize();

    this.initialized = true;
    appLog.info('EntitlementEnforcer initialized (mode: standalone)');
  }

  // ===========================================================================
  // Manifest Registration
  // ===========================================================================

  /**
   * Register a plugin's manifest for entitlement checking
   *
   * TICKET_132 Week 3: Also clears hub permission cache
   */
  registerPlugin(manifest: PluginManifest): void {
    this.manifestCache.set(manifest.id, manifest);
    // TICKET_132: Clear hub permission cache when manifest is updated
    this.hubPermissionCache.delete(manifest.id);

    // TICKET_188: Apply default user tier to newly registered plugins
    if (this.defaultUserTier !== 'free') {
      this.pluginUserTiers.set(manifest.id, this.defaultUserTier);
      appLog.debug(`Applied default tier '${this.defaultUserTier}' to plugin: ${manifest.id}`);
    }

    appLog.debug(`Registered plugin for entitlements: ${manifest.id}`);
  }

  /**
   * Unregister a plugin
   *
   * TICKET_132 Week 3: Also clears hub permission cache
   */
  unregisterPlugin(pluginId: string): void {
    this.manifestCache.delete(pluginId);
    // TICKET_132: Clear hub permission cache when plugin is unregistered
    this.hubPermissionCache.delete(pluginId);
    appLog.debug(`Unregistered plugin from entitlements: ${pluginId}`);
  }

  /**
   * Get registered manifest
   */
  getManifest(pluginId: string): PluginManifest | undefined {
    return this.manifestCache.get(pluginId);
  }

  // ===========================================================================
  // Entitlement Checking (Core Enforcement)
  // ===========================================================================

  /**
   * Check if a service is enabled and accessible
   * This is the main enforcement point
   * TICKET_106: Uses effectiveEnabled for runtime execution checks
   */
  checkServiceEntitlement(
    pluginId: string,
    serviceId: string
  ): EntitlementCheckResult {
    const manifest = this.manifestCache.get(pluginId);

    if (!manifest) {
      this.recordAudit(pluginId, serviceId, 'check', 'denied', 'plugin_not_found');
      return {
        allowed: false,
        reason: mainT(getCurrentMainLocale(), 'errors', 'main.entitlement.pluginNotRegistered'),
      };
    }

    // TICKET_105: Pass user tier to resolve locked state
    const userTier = this.getPluginUserTier(pluginId);
    const entitlements = this.pluginConfigManager.resolvePluginEntitlements(manifest, userTier);
    const service = entitlements.services.find((s) => s.id === serviceId);

    if (!service) {
      this.recordAudit(pluginId, serviceId, 'check', 'denied', 'service_not_found');
      return {
        allowed: false,
        reason: mainT(getCurrentMainLocale(), 'errors', 'main.entitlement.serviceNotDefined'),
      };
    }

    // TICKET_106: Check effectiveEnabled instead of separate enabled/locked checks
    // effectiveEnabled = locked ? false : enabled
    if (!service.effectiveEnabled) {
      // Determine specific reason for detailed error messages
      if (service.locked) {
        this.recordAudit(pluginId, serviceId, 'check', 'denied', service.lockReason);
        return {
          allowed: false,
          reason: service.lockReason || mainT(getCurrentMainLocale(), 'errors', 'main.entitlement.serviceLocked'),
          service,
        };
      } else {
        this.recordAudit(pluginId, serviceId, 'check', 'denied', 'service_disabled');
        return {
          allowed: false,
          reason: mainT(getCurrentMainLocale(), 'errors', 'main.entitlement.serviceDisabled'),
          service,
        };
      }
    }

    // In connected mode, check quota (future)
    if (this.connectionMode === 'connected' && service.quota !== undefined && service.quota !== -1) {
      if ((service.used || 0) >= service.quota) {
        this.recordAudit(pluginId, serviceId, 'check', 'denied', 'quota_exceeded');
        return {
          allowed: false,
          reason: mainT(getCurrentMainLocale(), 'errors', 'main.entitlement.quotaExceeded'),
          service,
        };
      }
    }

    // All checks passed
    this.recordAudit(pluginId, serviceId, 'check', 'allowed');
    return {
      allowed: true,
      service,
    };
  }

  /**
   * Check if a service is enabled (simple boolean check)
   */
  isServiceEnabled(pluginId: string, serviceId: string): boolean {
    const result = this.checkServiceEntitlement(pluginId, serviceId);
    return result.allowed;
  }

  // ===========================================================================
  // Tier Check (TICKET_075 - TypeScript UX only)
  // ===========================================================================

  /**
   * Check service entitlement using TypeScript tier comparison
   * NOTE: This is UX only - real security is enforced by service provider backend
   *
   * Uses tierMapping from plugin manifest to compare user tier with service tier
   */
  checkServiceEntitlementWithTier(
    pluginId: string,
    serviceId: string,
    userPlan: string
  ): EntitlementCheckResult {
    const manifest = this.manifestCache.get(pluginId);

    if (!manifest) {
      this.recordAudit(pluginId, serviceId, 'check', 'denied', 'plugin_not_found');
      return {
        allowed: false,
        reason: mainT(getCurrentMainLocale(), 'errors', 'main.entitlement.pluginNotRegistered'),
      };
    }

    const entitlements = this.pluginConfigManager.resolvePluginEntitlements(manifest);
    const service = entitlements.services.find((s) => s.id === serviceId);

    if (!service) {
      this.recordAudit(pluginId, serviceId, 'check', 'denied', 'service_not_found');
      return {
        allowed: false,
        reason: mainT(getCurrentMainLocale(), 'errors', 'main.entitlement.serviceNotDefined'),
      };
    }

    // Check if service is enabled by user
    if (!service.enabled) {
      this.recordAudit(pluginId, serviceId, 'check', 'denied', 'service_disabled');
      return {
        allowed: false,
        reason: mainT(getCurrentMainLocale(), 'errors', 'main.entitlement.serviceDisabled'),
        service,
      };
    }

    // Get tier mapping from manifest (TICKET_075)
    const tierMapping = this.pluginConfigManager.getPluginTierMapping(manifest);

    // Compare tiers using mapping
    const userLevel = tierMapping[userPlan.toLowerCase()] ?? 0;
    const requiredLevel = tierMapping[service.tier.toLowerCase()] ?? 0;

    if (userLevel < requiredLevel) {
      this.recordAudit(pluginId, serviceId, 'check', 'denied', 'tier_insufficient');
      return {
        allowed: false,
        reason: `Requires ${service.tier} plan`,
        service: {
          ...service,
          locked: true,
          lockReason: `Requires ${service.tier} plan`,
        },
      };
    }

    this.recordAudit(pluginId, serviceId, 'check', 'allowed');
    return {
      allowed: true,
      service,
    };
  }

  // ===========================================================================
  // Service State Management
  // ===========================================================================

  /**
   * Get all service entitlements for a plugin
   */
  getPluginEntitlements(pluginId: string): PluginEntitlementState | null {
    const manifest = this.manifestCache.get(pluginId);
    if (!manifest) {
      return null;
    }
    // TICKET_105: Pass user tier to resolve locked state
    const userTier = this.getPluginUserTier(pluginId);
    return this.pluginConfigManager.resolvePluginEntitlements(manifest, userTier);
  }

  /**
   * Get all service entitlements across all registered plugins
   */
  getAllEntitlements(): PluginEntitlementState[] {
    const results: PluginEntitlementState[] = [];

    for (const [pluginId, manifest] of this.manifestCache) {
      // TICKET_105: Pass user tier to resolve locked state
      const userTier = this.getPluginUserTier(pluginId);
      const entitlements = this.pluginConfigManager.resolvePluginEntitlements(manifest, userTier);
      results.push(entitlements);
    }

    return results;
  }

  /**
   * Get service state by ID (searches all plugins)
   */
  getServiceState(serviceId: string): ServiceEntitlementState | null {
    for (const [pluginId, manifest] of this.manifestCache) {
      // TICKET_105: Pass user tier to resolve locked state
      const userTier = this.getPluginUserTier(pluginId);
      const entitlements = this.pluginConfigManager.resolvePluginEntitlements(manifest, userTier);
      const service = entitlements.services.find((s) => s.id === serviceId);
      if (service) {
        return service;
      }
    }
    return null;
  }

  /**
   * Toggle a service's enabled state
   */
  toggleService(pluginId: string, serviceId: string, enabled: boolean): void {
    this.pluginConfigManager.toggleService(pluginId, serviceId, enabled);

    this.recordAudit(
      pluginId,
      serviceId,
      'toggle',
      'allowed',
      `set to ${enabled}`
    );

    // Emit change event for UI updates
    this.emit('serviceToggled', { pluginId, serviceId, enabled });

    appLog.info(`Service ${serviceId} toggled to ${enabled}`);
  }

  // ===========================================================================
  // User Tier Management (TICKET_105)
  // ===========================================================================

  /**
   * Set user tier for a plugin (called after OAuth login)
   * @param pluginId - Plugin ID
   * @param tier - User's tier/plan (e.g., 'free', 'pro', 'enterprise')
   */
  setPluginUserTier(pluginId: string, tier: string): void {
    const previousTier = this.pluginUserTiers.get(pluginId);
    this.pluginUserTiers.set(pluginId, tier.toLowerCase());

    if (previousTier !== tier.toLowerCase()) {
      appLog.info(`User tier for ${pluginId} changed: ${previousTier || 'free'} -> ${tier.toLowerCase()}`);

      // Emit tier change event
      this.emit('userTierChanged', { pluginId, tier: tier.toLowerCase() });
    }
  }

  /**
   * TICKET_1305: build the centralized `UserTierContext` from this runtime's
   * auth state -- per-plugin grants (`pluginUserTiers`) as overrides and the
   * account-level plan (`accountPlanTier`) as the plan fallback. This is the
   * single source Electron feeds to `resolveUserTier`, so the tier a plugin
   * resolves to is computed by the SAME contract the MCP and web-dashboard
   * runtimes use.
   */
  private buildUserTierContext(): UserTierContext {
    return {
      plan: this.accountPlanTier,
      pluginTierOverrides: Object.fromEntries(this.pluginUserTiers),
    };
  }

  /**
   * Get user tier for a plugin (defaults to 'free' if not set).
   *
   * TICKET_1305: delegates to the shared `resolveUserTier` (override > plan >
   * free) instead of the local `pluginUserTiers.get() ?? 'free'` lookup, so
   * Electron and the MCP standalone resolve identical tiers from equivalent
   * contexts. This is the SOLE tier-resolution callsite in the enforcer (AC5).
   * @param pluginId - Plugin ID
   * @returns User tier string
   */
  getPluginUserTier(pluginId: string): string {
    return resolveUserTier(pluginId, this.buildUserTierContext());
  }

  /**
   * Clear user tier for a plugin (after logout)
   * @param pluginId - Plugin ID
   */
  clearPluginUserTier(pluginId: string): void {
    this.pluginUserTiers.delete(pluginId);
    appLog.info(`Cleared user tier for ${pluginId}, reverting to 'free'`);

    // Emit tier change event
    this.emit('userTierChanged', { pluginId, tier: 'free' });
  }

  /**
   * TICKET_188: Set default user tier for newly registered plugins
   * This ensures plugins registered after auth restore get the correct tier
   * @param tier - Default tier to apply to new plugins
   */
  setDefaultUserTier(tier: string): void {
    this.defaultUserTier = tier.toLowerCase();
    appLog.info(`Default user tier set to: ${this.defaultUserTier}`);
  }

  /**
   * TICKET_188: Clear default user tier (after logout)
   */
  clearDefaultUserTier(): void {
    this.defaultUserTier = 'free';
    appLog.info('Default user tier cleared, reverting to free');
  }

  // ===========================================================================
  // Account Plan Tier (TICKET_798)
  // ===========================================================================

  /**
   * TICKET_798: Set the account-level plan tier (independent of per-plugin
   * overrides). Wired from entitlement-sync-service at login / refresh.
   */
  setAccountPlanTier(tier: string): void {
    this.accountPlanTier = tier.toLowerCase();
    appLog.info(`Account plan tier set to: ${this.accountPlanTier}`);
  }

  /**
   * TICKET_798: Get the account-level plan tier. Consumed by the marketplace
   * install gate so error messages quote the user's real plan rather than
   * the per-plugin 'free' sentinel returned for uninstalled plugins.
   */
  getAccountPlanTier(): string {
    return this.accountPlanTier;
  }

  /**
   * TICKET_1345: expose the per-plugin tier overrides as a plain record for
   * the operation admission evidence repository. Same data as
   * `buildUserTierContext().pluginTierOverrides` but without coupling the
   * caller to `UserTierContext`.
   */
  getPluginTierOverrides(): Record<string, string> {
    return Object.fromEntries(this.pluginUserTiers);
  }

  /**
   * TICKET_798: Clear the account plan tier (called from logout handler).
   */
  clearAccountPlanTier(): void {
    this.accountPlanTier = 'free';
    appLog.info('Account plan tier cleared, reverting to free');
  }

  // ===========================================================================
  // Service Execution (with Enforcement)
  // ===========================================================================

  /**
   * Execute a service with entitlement enforcement
   * This wraps actual service execution with entitlement checks
   */
  async executeService<T>(
    context: ServiceExecutionContext,
    executor: () => Promise<T>
  ): Promise<T> {
    const { pluginId, serviceId } = context;

    // Check entitlements first
    const check = this.checkServiceEntitlement(pluginId, serviceId);

    if (!check.allowed) {
      this.recordAudit(pluginId, serviceId, 'execute', 'denied', check.reason);
      throw new EntitlementError(
        check.reason || mainT(getCurrentMainLocale(), 'errors', 'main.entitlement.serviceAccessDenied'),
        pluginId,
        serviceId
      );
    }

    // Execute the service
    this.recordAudit(pluginId, serviceId, 'execute', 'allowed');

    try {
      const result = await executor();

      // Record usage (for quota tracking in connected mode)
      // this.recordUsage(pluginId, serviceId);

      return result;
    } catch (error) {
      throw error;
    }
  }

  // ===========================================================================
  // Audit Log
  // ===========================================================================

  /**
   * Record an audit entry
   */
  private recordAudit(
    pluginId: string,
    serviceId: string,
    action: EntitlementAuditEntry['action'],
    result: EntitlementAuditEntry['result'],
    reason?: string
  ): void {
    const entry: EntitlementAuditEntry = {
      timestamp: Date.now(),
      pluginId,
      serviceId,
      action,
      result,
      reason,
    };

    this.auditLog.push(entry);

    // Keep only last N entries
    if (this.auditLog.length > AUDIT_LOG_MAX_ENTRIES) {
      this.auditLog = this.auditLog.slice(-AUDIT_LOG_MAX_ENTRIES);
    }
  }

  /**
   * Get audit log entries
   */
  getAuditLog(limit = 100): EntitlementAuditEntry[] {
    return this.auditLog.slice(-limit);
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  // ===========================================================================
  // Connection Mode (Future)
  // ===========================================================================

  /**
   * Set connection mode (standalone or connected)
   */
  setConnectionMode(mode: 'standalone' | 'connected'): void {
    this.connectionMode = mode;
    appLog.info(`Connection mode set to: ${mode}`);
    this.emit('connectionModeChanged', mode);
  }

  /**
   * Get current connection mode
   */
  getConnectionMode(): 'standalone' | 'connected' {
    return this.connectionMode;
  }

  // ===========================================================================
  // TICKET_132 Week 3: Hub Entity Permission Checks (merged from HubPermissionService)
  // ===========================================================================

  // Hub permission cache (pluginId -> { contributes, consumes })
  private hubPermissionCache: Map<string, { contributes: string[], consumes: string[] }> = new Map();

  /**
   * Get hub permissions for a plugin from manifest
   */
  private getHubPermissions(pluginId: string): { contributes: string[], consumes: string[] } | null {
    if (this.hubPermissionCache.has(pluginId)) {
      return this.hubPermissionCache.get(pluginId)!;
    }

    const manifest = this.manifestCache.get(pluginId);
    if (!manifest || !manifest.hub) {
      return null;
    }

    const perms = {
      contributes: manifest.hub.contributes || [],
      consumes: manifest.hub.consumes || [],
    };

    this.hubPermissionCache.set(pluginId, perms);
    return perms;
  }

  /**
   * Check if a plugin can read/consume a hub entity
   *
   * TICKET_132 Week 3: Merged from HubPermissionService
   * Based on manifest.json hub.consumes declaration
   */
  async canReadHubEntity(pluginId: string, entity: string): Promise<boolean> {
    // System plugins have full access
    if (this.isSystemPlugin(pluginId)) {
      return true;
    }

    const perms = this.getHubPermissions(pluginId);
    if (!perms) {
      return false;
    }

    return perms.consumes.includes(entity) || perms.consumes.includes('*');
  }

  /**
   * Check if a plugin can write/contribute a hub entity
   *
   * TICKET_132 Week 3: Merged from HubPermissionService
   * Based on manifest.json hub.contributes declaration
   */
  async canWriteHubEntity(pluginId: string, entity: string): Promise<boolean> {
    // System plugins have full access
    if (this.isSystemPlugin(pluginId)) {
      return true;
    }

    const perms = this.getHubPermissions(pluginId);
    if (!perms) {
      return false;
    }

    return perms.contributes.includes(entity) || perms.contributes.includes('*');
  }

  /**
   * Check if a plugin is a system plugin (full hub access)
   */
  private isSystemPlugin(pluginId: string): boolean {
    const systemIds = ['system', 'com.stratcraft.core', 'com.stratcraft.strategy'];
    return systemIds.includes(pluginId);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Shutdown the enforcer
   */
  shutdown(): void {
    this.manifestCache.clear();
    this.auditLog = [];
    this.initialized = false;
    appLog.info('EntitlementEnforcer shutdown');
  }
}

// =============================================================================
// EntitlementError
// =============================================================================

export class EntitlementError extends Error {
  public readonly pluginId: string;
  public readonly serviceId: string;

  constructor(message: string, pluginId: string, serviceId: string) {
    super(message);
    this.name = 'EntitlementError';
    this.pluginId = pluginId;
    this.serviceId = serviceId;
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let entitlementEnforcerInstance: EntitlementEnforcer | null = null;

/**
 * Get the EntitlementEnforcer singleton
 */
export function getEntitlementEnforcer(): EntitlementEnforcer {
  if (!entitlementEnforcerInstance) {
    entitlementEnforcerInstance = EntitlementEnforcer.getInstance();
  }
  return entitlementEnforcerInstance;
}

/** TICKET_1302 U1: shared read contract for IPC and MCP Service API callers. */
export function getEntitlementAuditLog(limit?: number): EntitlementAuditEntry[] {
  return getEntitlementEnforcer().getAuditLog(limit);
}

/**
 * Initialize EntitlementEnforcer (call after app.whenReady)
 */
export async function initializeEntitlementEnforcer(): Promise<EntitlementEnforcer> {
  const enforcer = getEntitlementEnforcer();
  await enforcer.initialize();
  return enforcer;
}

export default EntitlementEnforcer;
