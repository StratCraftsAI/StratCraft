/**
 * @StratCraft/plugin-store -- Electron-free plugin read core.
 *
 * TICKET_1276 P2 Batch C2: manifest scan / get, user-config + config reads, and
 * entitlement-state resolution behind the five storage-owned marketplace MCP
 * tools, shared verbatim between Electron main and the MCP standalone server.
 */

export {
  scanPluginDir,
  discoverPlugins,
  findPluginManifest,
  readPluginConfig,
  readUserConfig,
  type PluginDirs,
} from './plugin-store';

export {
  resolveServiceState,
  resolvePluginEntitlements,
  resolveUserTier,
  resolvePluginEntitlementsWithContext,
  resolvePluginAdmission,
  ENTITLEMENT_TIER_LEVELS,
  type UserTierContext,
  type PluginAdmissionResult,
} from './entitlements';

export type {
  ServiceTier,
  ServiceEntitlementDefinition,
  PluginEntitlementDefinition,
  PluginManifest,
  ParsedPluginManifest,
  UserServiceConfig,
  ServiceEntitlementState,
  PluginEntitlementState,
  DiscoveredPlugin,
} from './types';
