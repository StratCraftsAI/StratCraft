/**
 * @StratCraft/plugin-store type shapes.
 *
 * Structural (not nominal) copies of the plugin manifest / entitlement types so
 * the package stays Electron-free and dependency-free. The Electron app's
 * `PluginManifest` / `UserServiceConfig` / `PluginEntitlementState` (in
 * apps/desktop/src/shared/types/plugin.ts) are structurally compatible and pass
 * straight through.
 */

export type ServiceTier = string;

export interface ServiceEntitlementDefinition {
  id: string;
  name: string;
  nameKey?: string;
  descriptionKey?: string;
  categoryKey?: string;
  description?: string;
  tier: ServiceTier;
  defaultEnabled: boolean;
  category?: string;
  icon?: string;
}

export interface PluginEntitlementDefinition {
  tierMapping?: Record<string, number>;
  services: ServiceEntitlementDefinition[];
}

/**
 * Minimal structural slice of a plugin manifest used by the read core. Only the
 * fields the core reads are required; the Electron `PluginManifest` (which
 * carries many more fields) is structurally assignable to this shape. `scan`
 * parses the full JSON, so callers keep every field on the returned object.
 */
export interface PluginManifest {
  id: string;
  name?: string;
  displayName?: string;
  version?: string;
  tier?: number;
  viewId?: string;
  entitlements?: PluginEntitlementDefinition;
}

/** A manifest parsed from disk, including plugin-defined extension fields. */
export type ParsedPluginManifest = PluginManifest & Record<string, unknown>;

export interface UserServiceConfig {
  services?: {
    [serviceId: string]: { enabled: boolean };
  };
  preferences?: {
    [key: string]: unknown;
  };
}

/**
 * Runtime service state (manifest defaults merged with user config + tier).
 * Matches the Electron `ServiceEntitlementState` shape including TICKET_106
 * `effectiveEnabled`.
 */
export interface ServiceEntitlementState {
  id: string;
  name: string;
  description?: string;
  tier: ServiceTier;
  category?: string;
  icon?: string;
  enabled: boolean;
  effectiveEnabled: boolean;
  source: 'manifest' | 'user-config' | 'server';
  locked: boolean;
  lockReason?: string;
  quota?: number;
  used?: number;
}

export interface PluginEntitlementState {
  pluginId: string;
  services: ServiceEntitlementState[];
}

/** A discovered plugin: id + directory + parsed manifest + provenance. */
export interface DiscoveredPlugin {
  id: string;
  path: string;
  source: 'bundled' | 'user';
  manifest: ParsedPluginManifest;
}
