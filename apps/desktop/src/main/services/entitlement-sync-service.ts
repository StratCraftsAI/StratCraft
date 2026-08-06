/**
 * EntitlementSyncService - Auth-Entitlement Synchronization
 *
 * TICKET_187: Login Entitlement Synchronization
 * TICKET_892_4: Server-authoritative entitlement (single WP pipe)
 *
 * Bridges AuthService and EntitlementEnforcer to ensure entitlements are
 * updated when user login state changes.
 *
 * Responsibilities:
 * - Listen to AuthService 'stateChanged' event
 * - Read server-authoritative entitled_plugins from AuthUser
 * - Call EntitlementEnforcer.setPluginUserTier() per plugin from WP data
 * - Call EntitlementEnforcer.clearPluginUserTier() on logout
 * - Cache entitled_plugins for short offline grace period
 */

import { EventEmitter } from 'events';
import Store from 'electron-store';
import { appLog } from '../utils/logger';
import { getAuthService, AuthService } from './auth-service';
import { getEntitlementEnforcer, EntitlementEnforcer } from './entitlement-enforcer';
import { ENTITLEMENT_TIER_LEVELS } from '../../shared/constants/entitlement';
import { resolvePluginAdmission, type PluginAdmissionResult } from '@StratCraft/plugin-store';
import type { AuthUser, EntitledPlugin } from '../../shared/types/auth';

const ENTITLED_PLUGINS_CACHE_KEY = 'entitlement_entitled_plugins_cache';
const ENTITLED_PLUGINS_CACHE_TS_KEY = 'entitlement_entitled_plugins_cache_ts';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// =============================================================================
// EntitlementSyncService Class
// =============================================================================

export class EntitlementSyncService extends EventEmitter {
  private static instance: EntitlementSyncService | null = null;

  private authService: AuthService | null = null;
  private entitlementEnforcer: EntitlementEnforcer | null = null;
  private initialized = false;
  private store = new Store();

  private constructor() {
    super();
  }

  static getInstance(): EntitlementSyncService {
    if (!EntitlementSyncService.instance) {
      EntitlementSyncService.instance = new EntitlementSyncService();
    }
    return EntitlementSyncService.instance;
  }

  initialize(): void {
    if (this.initialized) {
      appLog.warn('[EntitlementSync] Already initialized');
      return;
    }

    appLog.info('[EntitlementSync] Initializing...');

    this.authService = getAuthService();
    this.entitlementEnforcer = getEntitlementEnforcer();

    this.authService.on('stateChanged', this.handleAuthStateChanged.bind(this));

    const authState = this.authService.getAuthState();
    if (authState.isAuthenticated && authState.user) {
      if (authState.user.entitledPlugins && authState.user.entitledPlugins.length > 0) {
        this.cacheEntitledPlugins(authState.user.entitledPlugins);
      }
      this.syncUserTierToPlugins(authState.user);
    }

    this.initialized = true;
    appLog.info('[EntitlementSync] Initialized');
  }

  // ===========================================================================
  // Auth State Handler
  // ===========================================================================

  private handleAuthStateChanged(data: { isAuthenticated: boolean; user: AuthUser | null }): void {
    appLog.info(`[EntitlementSync] Auth state changed: isAuthenticated=${data.isAuthenticated}`);

    if (data.isAuthenticated && data.user) {
      const serverPlugins = data.user.entitledPlugins ?? [];
      this.cacheEntitledPlugins(serverPlugins);
      this.syncUserTierToPlugins(data.user);
    } else {
      this.clearUserTierFromPlugins();
      this.clearEntitledPluginsCache();
    }
  }

  // ===========================================================================
  // TICKET_892_4 Step 3: Server-Authoritative Tier Sync (The Single Gate)
  // ===========================================================================

  private syncUserTierToPlugins(user: AuthUser): void {
    if (!this.entitlementEnforcer) return;

    const serverPlugins = user.entitledPlugins ?? this.getCachedEntitledPlugins();

    // Derive the highest tier from server plugins for default/per-plugin use.
    // This replaces mapPlanToEntitlementTier -- WP is the authority.
    const highestTier = this.resolveHighestTier(serverPlugins);

    // TICKET_1307 RC1: the ACCOUNT plan tier must come from the account plan
    // (`AuthUser.plan`), not from the grant snapshot. Deriving it from
    // `entitled_plugins` made a plan upgrade invisible until the backend
    // re-issued every grant entry, so a user who upgraded to GOLD kept
    // resolving at their stale grant tier and was denied by the admission gate.
    // The grant-derived tier may only RAISE the effective plan (a per-plugin
    // buyout can exceed the subscription), never lower it.
    const planTier = user.plan.toLowerCase();
    const accountTier =
      (ENTITLEMENT_TIER_LEVELS[highestTier] ?? 0) > (ENTITLEMENT_TIER_LEVELS[planTier] ?? 0)
        ? highestTier
        : planTier;

    this.entitlementEnforcer.setDefaultUserTier(accountTier);
    this.entitlementEnforcer.setAccountPlanTier(accountTier);

    appLog.info(
      `[EntitlementSync] Applying ${serverPlugins.length} server entitlements ` +
        `(plan=${planTier}, highestGrant=${highestTier}, account=${accountTier})`,
    );

    for (const { plugin_id, tier } of serverPlugins) {
      this.entitlementEnforcer.setPluginUserTier(plugin_id, tier);
    }
  }

  private clearUserTierFromPlugins(): void {
    if (!this.entitlementEnforcer) return;

    this.entitlementEnforcer.clearDefaultUserTier();
    this.entitlementEnforcer.clearAccountPlanTier();

    const pluginIds = this.getRegisteredPluginIds();

    appLog.info(`[EntitlementSync] Clearing tiers from ${pluginIds.length} plugins`);

    for (const pluginId of pluginIds) {
      this.entitlementEnforcer.clearPluginUserTier(pluginId);
    }
  }

  private resolveHighestTier(plugins: EntitledPlugin[]): string {
    let highest = 'free';
    let highestLevel = 0;
    for (const { tier } of plugins) {
      const level = ENTITLEMENT_TIER_LEVELS[tier] ?? 0;
      if (level > highestLevel) {
        highestLevel = level;
        highest = tier;
      }
    }
    return highest;
  }

  private getRegisteredPluginIds(): string[] {
    if (!this.entitlementEnforcer) return [];
    const allEntitlements = this.entitlementEnforcer.getAllEntitlements();
    return allEntitlements.map((e) => e.pluginId);
  }

  // ===========================================================================
  // TICKET_892_4 Step 2d: Entitled Plugins Cache (offline grace)
  // ===========================================================================

  cacheEntitledPlugins(plugins: EntitledPlugin[]): void {
    this.store.set(ENTITLED_PLUGINS_CACHE_KEY, plugins);
    this.store.set(ENTITLED_PLUGINS_CACHE_TS_KEY, Date.now());
    appLog.info(`[EntitlementSync] Cached ${plugins.length} entitled plugins for offline grace`);
  }

  getCachedEntitledPlugins(): EntitledPlugin[] {
    const ts = this.store.get(ENTITLED_PLUGINS_CACHE_TS_KEY);
    if (typeof ts === 'number' && Date.now() - ts > CACHE_TTL_MS) {
      appLog.warn('[EntitlementSync] Entitled plugins cache expired (>7d), clearing');
      this.clearEntitledPluginsCache();
      return [];
    }

    const raw = this.store.get(ENTITLED_PLUGINS_CACHE_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is EntitledPlugin =>
        typeof e === 'object' && e !== null &&
        typeof (e as EntitledPlugin).plugin_id === 'string' &&
        typeof (e as EntitledPlugin).tier === 'string',
    );
  }

  clearEntitledPluginsCache(): void {
    this.store.delete(ENTITLED_PLUGINS_CACHE_KEY);
    this.store.delete(ENTITLED_PLUGINS_CACHE_TS_KEY);
    appLog.info('[EntitlementSync] Cleared entitled plugins cache');
  }

  // ===========================================================================
  // TICKET_892_4 Step 4: Plugin Ownership Query (replaces buyout IPC)
  // ===========================================================================

  getPluginOwnership(pluginId: string): { owned: boolean; tier: string } {
    const cached = this.getCachedEntitledPlugins();
    const entry = cached.find((p) => p.plugin_id === pluginId);
    if (!entry) return { owned: false, tier: 'free' };
    return { owned: true, tier: entry.tier };
  }

  /**
   * TICKET_1307: Admission check comparing the user's effective tier against the
   * plugin's current required tier. The `requiredTier` comes from the registry
   * (bundled-registry.json or server) and can change over a plugin's lifetime.
   *
   * The granted side MUST come from the centralized `resolveUserTier`
   * (TICKET_1305), reached here via `EntitlementEnforcer.getPluginUserTier` --
   * NOT from `getPluginOwnership().tier`. The latter is the grant snapshot
   * recorded at purchase time; using it would deny a user who has since
   * upgraded their plan but whose grant entry the backend has not re-issued
   * (the add-only merge of RC3 means it may never be re-issued).
   */
  checkPluginAdmission(pluginId: string, requiredTier: string): PluginAdmissionResult {
    const enforcer = this.entitlementEnforcer ?? getEntitlementEnforcer();
    const grantedTier = enforcer.getPluginUserTier(pluginId);
    return resolvePluginAdmission(grantedTier, requiredTier);
  }

  getEntitledPlugins(): EntitledPlugin[] {
    return this.getCachedEntitledPlugins();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  shutdown(): void {
    if (this.authService) {
      this.authService.removeAllListeners('stateChanged');
    }
    this.initialized = false;
    appLog.info('[EntitlementSync] Shutdown');
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let entitlementSyncServiceInstance: EntitlementSyncService | null = null;

export function getEntitlementSyncService(): EntitlementSyncService {
  if (!entitlementSyncServiceInstance) {
    entitlementSyncServiceInstance = EntitlementSyncService.getInstance();
  }
  return entitlementSyncServiceInstance;
}

export function initializeEntitlementSyncService(): void {
  const service = getEntitlementSyncService();
  service.initialize();
}
