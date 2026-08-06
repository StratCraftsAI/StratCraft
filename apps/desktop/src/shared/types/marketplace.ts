/**
 * Plugin Marketplace Type Definitions
 * TICKET_051: Plugin Marketplace Implementation
 */

// =============================================================================
// Registry Types
// =============================================================================

export interface RegistryPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  icon?: string;
  tags: string[];
  tier?: number;
  /** TICKET_725: Inline pricing from bundled registry for offline display */
  pricing?: {
    type: 'free' | 'paid' | 'subscription';
    provider?: string;
    tier?: string;
  };
  /** TICKET_725: Plugin categories from bundled registry */
  categories?: string[];
}

export interface RegistryIndex {
  version: string;
  lastUpdated: string;
  plugins: RegistryPlugin[];
}

export interface PluginAuthor {
  name: string;
  github?: string;
  email?: string;
}

export interface PluginPricing {
  type: 'free' | 'paid' | 'subscription';
  premiumUrl?: string;
  /** TICKET_447_1: Provider of the paid plugin */
  provider?: 'StratCraft' | 'third-party';
  /** Display price string (e.g., "$29.99") */
  price?: string;
  /** Pricing model */
  priceType?: 'one-time' | 'monthly' | 'yearly';
  /** External purchase URL (for third-party plugins) */
  purchaseUrl?: string;
  /** Required entitlement tier (for first-party plugins) */
  tier?: string;
  /** License validation config (for third-party plugins) */
  licenseValidation?: LicenseValidationConfig;
}

/** TICKET_447_1: Configuration for third-party license validation */
export interface LicenseValidationConfig {
  type: 'http';
  url: string;
  method: 'POST' | 'GET';
  /** Request body template; {{LICENSE_KEY}} and {{PLUGIN_ID}} are replaced at runtime */
  body?: Record<string, string>;
  /** JSON path field in response that indicates success */
  successField: string;
  /** Expected value of successField for a valid license */
  successValue: string | boolean;
}

/** TICKET_447_1: Distribution config for paid plugins */
export interface PluginDistribution {
  type: 'public-github' | 'authenticated';
  /** Download URL for authenticated distribution; {{LICENSE_KEY}} placeholder supported */
  authenticatedDownloadUrl?: string;
}

/** TICKET_447_1: Result of a license validation attempt */
export interface LicenseValidationResult {
  valid: boolean;
  error?: string;
  i18nKey?: string;
  expiresAt?: string;
}

/** TICKET_447_1: License status for a plugin */
export interface LicenseStatusInfo {
  pluginId: string;
  hasKey: boolean;
  valid: boolean;
  checkedAt: string;
  expiresAt?: string;
}

export interface PluginPermissions {
  network: boolean;
  filesystem: 'none' | 'plugin' | 'user';
  native: boolean;
}

/** TICKET_725_2: Platform identifier for per-platform plugin ZIPs */
export type PluginPlatform = 'linux-x64' | 'darwin-arm64' | 'darwin-x64' | 'win32-x64' | 'universal';

export interface PluginVersionInfo {
  version: string;
  releaseDate: string;
  downloadUrl: string;
  sha256: string;
  minEngine: string;
  changelog?: string;
  /** TICKET_725_2: Platform target. Omitted or 'universal' for JS-only plugins */
  platform?: PluginPlatform;
}

export interface PluginDetails {
  id: string;
  name: string;
  description: string;
  author: PluginAuthor;
  repository: string;
  license: string;
  categories: string[];
  pricing: PluginPricing;
  permissions: PluginPermissions;
  ui?: Record<string, unknown>;
  logic?: Record<string, unknown>;
  dependencies?: {
    python?: string[];
    node?: Record<string, string>;
  };
  pluginDependencies?: Record<string, string>;
  versions: PluginVersionInfo[];
  /** TICKET_447_1: Distribution config for paid plugins */
  distribution?: PluginDistribution;
}

export interface RegistryStats {
  [pluginId: string]: {
    downloads: number;
    stars: number;
    lastUpdated: string;
  };
}

// =============================================================================
// Installation Types
// =============================================================================

export type InstallPhase =
  | 'downloading'
  | 'verifying'
  | 'resolving_dependencies'
  | 'extracting'
  | 'installing_python_deps'
  | 'finalizing'
  | 'complete'
  | 'error';

export interface InstallProgress {
  pluginId: string;
  phase: InstallPhase;
  progress: number; // 0-100
  message: string;
}

export interface InstalledPlugin {
  id: string;
  version: string;
  installedAt: string;
  source: 'marketplace' | 'user' | 'bundled';
  path: string;
}

// =============================================================================
// Filter and Search Types
// =============================================================================

export type PluginCategory =
  | 'all'
  | 'visualization'
  | 'indicators'
  | 'trading'
  | 'data'
  | 'ai'
  | 'tools';

export type PluginSortBy = 'downloads' | 'stars' | 'updated' | 'name';

export interface PluginSearchQuery {
  query?: string;
  category?: PluginCategory;
  sortBy?: PluginSortBy;
  installedOnly?: boolean;
  updatesOnly?: boolean;
}

// =============================================================================
// IPC Response Types
// =============================================================================

export interface MarketplaceRegistryResponse {
  success: boolean;
  registry?: RegistryPlugin[];
  stats?: RegistryStats;
  installed?: InstalledPlugin[];
  error?: string;
}

export interface MarketplaceDetailsResponse {
  success: boolean;
  details?: PluginDetails;
  installedVersion?: string;
  error?: string;
}

export interface MarketplaceInstallResponse {
  success: boolean;
  error?: string;
}

export interface MarketplaceUpdatesResponse {
  success: boolean;
  updates?: Array<{
    pluginId: string;
    currentVersion: string;
    latestVersion: string;
  }>;
  error?: string;
}

// =============================================================================
// TICKET_447_1: License IPC Response Types
// =============================================================================

export interface MarketplaceLicenseResponse {
  success: boolean;
  data?: LicenseValidationResult;
  error?: string;
}

export interface MarketplaceLicenseStatusResponse {
  success: boolean;
  data?: LicenseStatusInfo[];
  error?: string;
}

// =============================================================================
// TICKET_551: Entitlement Types (First-Party Paid Plugins)
// =============================================================================

/** Entitlement status for a first-party paid plugin */
export interface EntitlementStatus {
  pluginId: string;
  entitled: boolean;
  status: 'active' | 'expired' | 'revoked' | null;
  purchasedAt: string | null;
  expiresAt: string | null;
}

export interface MarketplaceEntitlementResponse {
  success: boolean;
  data?: EntitlementStatus;
  error?: string;
}

export interface MarketplaceEntitlementsBatchResponse {
  success: boolean;
  data?: EntitlementStatus[];
  error?: string;
}
