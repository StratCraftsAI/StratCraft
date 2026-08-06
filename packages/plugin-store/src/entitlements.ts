/**
 * Entitlement-state resolution -- pure functions, no fs / Electron.
 *
 * TICKET_1276 P2 Batch C2. Extracted verbatim from
 * `PluginConfigManager.resolveServiceState` / `resolvePluginEntitlements`
 * (apps/desktop/src/main/services/plugin-config-manager.ts) so Electron and MCP
 * compute identical entitlement state from the same (manifest, user-config,
 * tier) inputs. The Electron `PluginConfigManager` now delegates here.
 */

import type {
  PluginManifest,
  UserServiceConfig,
  ServiceEntitlementDefinition,
  ServiceEntitlementState,
  PluginEntitlementState,
} from './types';

/**
 * TICKET_544 SSOT tier levels. Duplicated here (not imported from the Electron
 * shared constants) to keep the package dependency-free; the values are the
 * canonical four-tier mapping and callers may override per-manifest via
 * `entitlements.tierMapping`.
 */
export const ENTITLEMENT_TIER_LEVELS: Record<string, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  gold: 3,
};

/**
 * TICKET_1305: Authentication context consumed by `resolveUserTier`. Decouples
 * auth-provider specifics (Electron `AuthUser`, MCP `BrowserOAuthSessionRecord`,
 * web-dashboard `AuthSession`) from entitlement evaluation -- every runtime
 * builds this from whatever auth source it has and gets an identical tier.
 */
export interface UserTierContext {
  /** Account plan from the auth provider (FREE / PRO / GOLD). */
  plan?: string;
  /** Per-plugin tier overrides from server-authoritative entitled_plugins. */
  pluginTierOverrides?: Record<string, string>;
}

/**
 * TICKET_1305: Resolve the effective user tier for a given plugin. The SOLE
 * authority mapping an authentication context to the `userTier` string consumed
 * by `resolvePluginEntitlements`.
 *
 * Priority (highest wins):
 *   1. pluginTierOverrides[pluginId] -- server-authoritative per-plugin grant
 *   2. plan                          -- account-level plan tier
 *   3. 'free'                        -- unauthenticated default (TICKET_638)
 */
export function resolveUserTier(
  pluginId: string,
  context: UserTierContext,
): string {
  return context.pluginTierOverrides?.[pluginId]
    ?? context.plan?.toLowerCase()
    ?? 'free';
}

/**
 * TICKET_1305: convenience wrapper that resolves the effective tier for
 * `pluginId` from `context`, then delegates to `resolvePluginEntitlements`.
 * Backward-compatible: the underlying signature is unchanged.
 */
export function resolvePluginEntitlementsWithContext(
  manifest: PluginManifest,
  userConfig: UserServiceConfig,
  pluginId: string,
  context: UserTierContext,
): PluginEntitlementState {
  return resolvePluginEntitlements(manifest, userConfig, resolveUserTier(pluginId, context));
}

/**
 * Resolve the final runtime state for a single service.
 * Priority: user config > manifest default. `effectiveEnabled` is forced false
 * when the service is locked by an insufficient tier (TICKET_106).
 */
export function resolveServiceState(
  definition: ServiceEntitlementDefinition,
  userConfig: UserServiceConfig,
  tierMapping: Record<string, number> | undefined,
  userTier: string,
): ServiceEntitlementState {
  const userEnabled = userConfig.services?.[definition.id]?.enabled;
  const enabled = userEnabled !== undefined ? userEnabled : definition.defaultEnabled;
  const source: ServiceEntitlementState['source'] =
    userEnabled !== undefined ? 'user-config' : 'manifest';

  const mapping = tierMapping || ENTITLEMENT_TIER_LEVELS;
  const userLevel = mapping[userTier.toLowerCase()] ?? 0;
  const requiredLevel = mapping[definition.tier.toLowerCase()] ?? 0;

  const locked = userLevel < requiredLevel;
  const lockReason = locked ? `Requires ${definition.tier.toUpperCase()} tier` : undefined;
  const effectiveEnabled = locked ? false : enabled;

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    tier: definition.tier,
    category: definition.category,
    icon: definition.icon,
    enabled,
    effectiveEnabled,
    source,
    locked,
    lockReason,
    quota: -1,
    used: 0,
  };
}

/**
 * Resolve the full entitlement state for one plugin from its manifest and the
 * user's saved config. Mirrors `PluginConfigManager.resolvePluginEntitlements`.
 */
export function resolvePluginEntitlements(
  manifest: PluginManifest,
  userConfig: UserServiceConfig,
  userTier = 'free',
): PluginEntitlementState {
  const entitlements = manifest.entitlements;
  const serviceEntitlements = entitlements?.services || [];
  const tierMapping = entitlements?.tierMapping;

  const services = serviceEntitlements.map((def) =>
    resolveServiceState(def, userConfig, tierMapping, userTier),
  );

  return { pluginId: manifest.id, services };
}

// =============================================================================
// TICKET_1307: Plugin Admission Resolver
// =============================================================================

export interface PluginAdmissionResult {
  admitted: boolean;
  grantedTier: string;
  requiredTier: string;
  reason?: string;
}

/**
 * TICKET_1307: Compare the user's granted tier against the plugin's required
 * tier and return a structured admission verdict. This is the SOLE authority for
 * "may the user run this plugin right now?" -- every runtime gate (Electron IPC,
 * MCP, web-dashboard) MUST consume this, never a raw `owned` boolean.
 *
 * The granted side MUST be the output of `resolveUserTier` (override > plan >
 * free), not a raw grant snapshot: a grant records the tier a plugin was
 * acquired at, which goes stale the moment the user's plan changes.
 *
 * Both tiers are normalized to lowercase in the result so equivalent contexts
 * from different surfaces (Electron 'pro' vs MCP 'PRO') yield byte-identical
 * verdicts -- AC6 parity is an equality of payloads, not just of booleans.
 */
export function resolvePluginAdmission(
  grantedTier: string,
  requiredTier: string,
): PluginAdmissionResult {
  const granted = grantedTier.toLowerCase();
  const required = requiredTier.toLowerCase();
  const grantedLevel = ENTITLEMENT_TIER_LEVELS[granted] ?? 0;
  const requiredLevel = ENTITLEMENT_TIER_LEVELS[required] ?? 0;

  if (grantedLevel >= requiredLevel) {
    return { admitted: true, grantedTier: granted, requiredTier: required };
  }

  return {
    admitted: false,
    grantedTier: granted,
    requiredTier: required,
    reason: `Requires ${required.toUpperCase()} tier (current: ${granted.toUpperCase()})`,
  };
}
