/**
 * useMarketplaceStore - Zustand store for Plugin Marketplace
 *
 * TICKET_051: Plugin Marketplace Implementation
 */

import { create } from 'zustand';
import { semverGt } from '@shared/utils/semver';
import type {
  RegistryPlugin,
  RegistryStats,
  PluginDetails,
  InstalledPlugin,
  InstallProgress,
  PluginCategory,
  PluginSortBy,
  LicenseStatusInfo,
  EntitlementStatus,
  PluginPricing,
} from '@shared/types/marketplace';

// =============================================================================
// Store State Types
// =============================================================================

interface MarketplaceStoreState {
  // Registry data
  registry: RegistryPlugin[];
  stats: RegistryStats;
  registryLastFetched: string | null;

  // Search and filter
  searchQuery: string;
  selectedCategory: PluginCategory;
  sortBy: PluginSortBy;

  // Selected plugin detail
  selectedPluginId: string | null;
  selectedPluginDetails: PluginDetails | null;

  // Installed plugins
  installedPlugins: Map<string, InstalledPlugin>;

  // Loading states
  isLoadingRegistry: boolean;
  isLoadingDetails: boolean;
  isInstalling: boolean;
  installProgress: InstallProgress | null;

  // Errors
  error: string | null;

  // TICKET_447_1: License status
  licenseStatuses: Map<string, LicenseStatusInfo>;
  isValidatingLicense: boolean;
  licenseError: string | null;

  // TICKET_551: Entitlement status (first-party paid plugins)
  entitlementStatuses: Map<string, EntitlementStatus>;
  pollingPluginId: string | null;

  // TICKET_551: Pricing cache for cards (populated from plugin details)
  pricingCache: Map<string, PluginPricing>;

  // TICKET_892_4: Plugin ownership from server-authoritative cache
  ownedPlugins: Map<string, boolean>;

  // TICKET_799: Typed tier-insufficient install rejection.
  // When the install gate rejects a first-party paid plugin for tier reasons,
  // the install hook routes the structured failure here instead of into
  // `error`, so MarketplacePage can open the acquisition-choice dialog
  // (Upgrade Plan / Buyout CTAs) and suppress the dead-end red banner.
  // null when no current rejection is pending.
  tierRejection: TierRejection | null;
}

/**
 * TICKET_799: Structured payload for a tier-insufficient install rejection.
 * Set by the install hook when `plugin-market-service.checkPaidPluginGates()`
 * throws a sentinel-prefixed `TIER_INSUFFICIENT:` error; consumed by
 * MarketplacePage to drive the AcquireAccessDialog and hide the red banner.
 */
export interface TierRejection {
  pluginId: string;
  requiredTier: string;
  currentTier: string;
}

/** TICKET_447_1: Possible action states for a plugin */
export type PluginActionState =
  | 'free-install'
  | 'purchase'
  | 'enter-license'
  | 'install'
  | 'installed'
  | 'update'
  | 'license-expired'
  | 'owned' // TICKET_601: Plugin owned (server-authoritative entitlement)
  | 'loading'; // TICKET_800: pricing or entitlement not yet known -- card must not assume free

interface MarketplaceStoreActions {
  // Registry
  setRegistry: (registry: RegistryPlugin[], stats: RegistryStats) => void;
  setRegistryLastFetched: (date: string) => void;

  // Search and filter
  setSearchQuery: (query: string) => void;
  setSelectedCategory: (category: PluginCategory) => void;
  setSortBy: (sortBy: PluginSortBy) => void;

  // Plugin details
  setSelectedPluginId: (id: string | null) => void;
  setSelectedPluginDetails: (details: PluginDetails | null) => void;

  // Installed plugins
  setInstalledPlugins: (plugins: InstalledPlugin[]) => void;
  addInstalledPlugin: (plugin: InstalledPlugin) => void;
  removeInstalledPlugin: (id: string) => void;

  // Loading states
  setLoadingRegistry: (loading: boolean) => void;
  setLoadingDetails: (loading: boolean) => void;
  setInstalling: (installing: boolean) => void;
  setInstallProgress: (progress: InstallProgress | null) => void;

  // Errors
  setError: (error: string | null) => void;

  // Computed
  getFilteredPlugins: () => RegistryPlugin[];
  isPluginInstalled: (pluginId: string) => boolean;
  hasUpdate: (pluginId: string) => boolean;
  getInstalledVersion: (pluginId: string) => string | undefined;

  // TICKET_447_1: License state
  setLicenseStatuses: (statuses: LicenseStatusInfo[]) => void;
  updateLicenseStatus: (status: LicenseStatusInfo) => void;
  removeLicenseStatus: (pluginId: string) => void;
  setValidatingLicense: (validating: boolean) => void;
  setLicenseError: (error: string | null) => void;
  getPluginActionState: (pluginId: string, details?: PluginDetails | null) => PluginActionState;

  // TICKET_551: Entitlement state
  setEntitlementStatuses: (statuses: EntitlementStatus[]) => void;
  updateEntitlementStatus: (status: EntitlementStatus) => void;
  setPollingPluginId: (pluginId: string | null) => void;

  // TICKET_551: Pricing cache
  cachePricing: (pluginId: string, pricing: PluginPricing) => void;

  // TICKET_892_4: Ownership statuses
  setOwnedPlugins: (owned: Map<string, boolean>) => void;
  setPluginOwned: (pluginId: string, owned: boolean) => void;

  // TICKET_799: Tier rejection
  setTierRejection: (rejection: TierRejection | null) => void;
  clearTierRejection: () => void;
}

type MarketplaceStore = MarketplaceStoreState & MarketplaceStoreActions;

// =============================================================================
// Initial State
// =============================================================================

const createInitialState = (): MarketplaceStoreState => ({
  registry: [],
  stats: {},
  registryLastFetched: null,

  searchQuery: '',
  selectedCategory: 'all',
  sortBy: 'downloads',

  selectedPluginId: null,
  selectedPluginDetails: null,

  installedPlugins: new Map(),

  isLoadingRegistry: false,
  isLoadingDetails: false,
  isInstalling: false,
  installProgress: null,

  error: null,

  licenseStatuses: new Map(),
  isValidatingLicense: false,
  licenseError: null,

  entitlementStatuses: new Map(),
  pollingPluginId: null,
  pricingCache: new Map(),
  ownedPlugins: new Map(),

  tierRejection: null,
});

// =============================================================================
// Store
// =============================================================================

export const useMarketplaceStore = create<MarketplaceStore>((set, get) => ({
  ...createInitialState(),

  setRegistry: (registry, stats) =>
    set({
      registry,
      stats,
      registryLastFetched: new Date().toISOString(),
    }),

  setRegistryLastFetched: (date) => set({ registryLastFetched: date }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSelectedCategory: (category) => set({ selectedCategory: category }),

  setSortBy: (sortBy) => set({ sortBy }),

  setSelectedPluginId: (id) => set({ selectedPluginId: id }),

  setSelectedPluginDetails: (details) => set({ selectedPluginDetails: details }),

  setInstalledPlugins: (plugins) =>
    set({
      installedPlugins: new Map(plugins.map((p) => [p.id, p])),
    }),

  addInstalledPlugin: (plugin) =>
    set((state) => {
      const newMap = new Map(state.installedPlugins);
      newMap.set(plugin.id, plugin);
      return { installedPlugins: newMap };
    }),

  removeInstalledPlugin: (id) =>
    set((state) => {
      const newMap = new Map(state.installedPlugins);
      newMap.delete(id);
      return { installedPlugins: newMap };
    }),

  setLoadingRegistry: (loading) => set({ isLoadingRegistry: loading }),

  setLoadingDetails: (loading) => set({ isLoadingDetails: loading }),

  setInstalling: (installing) => set({ isInstalling: installing }),

  setInstallProgress: (progress) => set({ installProgress: progress }),

  setError: (error) => set({ error }),

  getFilteredPlugins: () => {
    const { registry, searchQuery, selectedCategory, sortBy, stats } = get();

    let filtered = [...registry];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.tags.some((t) => t.toLowerCase().includes(query))
      );
    }

    // Filter by category
    if (selectedCategory !== 'all') {
      filtered = filtered.filter((p) => p.tags.includes(selectedCategory));
    }

    // Sort
    filtered.sort((a, b) => {
      const statsA = stats[a.id] || { downloads: 0, stars: 0, lastUpdated: '' };
      const statsB = stats[b.id] || { downloads: 0, stars: 0, lastUpdated: '' };

      switch (sortBy) {
        case 'downloads':
          return statsB.downloads - statsA.downloads;
        case 'stars':
          return statsB.stars - statsA.stars;
        case 'name':
          return a.name.localeCompare(b.name);
        case 'updated':
          return (
            new Date(statsB.lastUpdated || 0).getTime() -
            new Date(statsA.lastUpdated || 0).getTime()
          );
        default:
          return 0;
      }
    });

    return filtered;
  },

  isPluginInstalled: (pluginId) => {
    return get().installedPlugins.has(pluginId);
  },

  hasUpdate: (pluginId) => {
    const { registry, installedPlugins } = get();
    const installed = installedPlugins.get(pluginId);
    if (!installed) return false;

    const registryPlugin = registry.find((p) => p.id === pluginId);
    if (!registryPlugin) return false;

    return semverGt(registryPlugin.version, installed.version);
  },

  getInstalledVersion: (pluginId) => {
    return get().installedPlugins.get(pluginId)?.version;
  },

  // TICKET_447_1: License state actions
  setLicenseStatuses: (statuses) =>
    set({
      licenseStatuses: new Map(statuses.map((s) => [s.pluginId, s])),
    }),

  updateLicenseStatus: (status) =>
    set((state) => {
      const newMap = new Map(state.licenseStatuses);
      newMap.set(status.pluginId, status);
      return { licenseStatuses: newMap };
    }),

  removeLicenseStatus: (pluginId) =>
    set((state) => {
      const newMap = new Map(state.licenseStatuses);
      newMap.delete(pluginId);
      return { licenseStatuses: newMap };
    }),

  setValidatingLicense: (validating) => set({ isValidatingLicense: validating }),

  setLicenseError: (error) => set({ licenseError: error }),

  getPluginActionState: (pluginId, details) => {
    const { installedPlugins, registry, licenseStatuses, entitlementStatuses, ownedPlugins, pricingCache } = get();
    const installed = installedPlugins.get(pluginId);
    const registryPlugin = registry.find((p) => p.id === pluginId);

    // Check if installed -- but only honour 'update'/'installed' for plugins the
    // user is actually entitled to. TICKET_892_5: a paid plugin without
    // ownership/entitlement must show 'purchase' regardless of local install state.
    if (installed) {
      const entitlement = entitlementStatuses.get(pluginId);
      const pricing = details?.pricing ?? pricingCache.get(pluginId) ?? registryPlugin?.pricing;
      const isFree = !pricing || pricing.type === 'free';
      // TICKET_892_4_6: entitlementStatuses (server batch) is authoritative;
      // ownedPlugins (login cache) is fallback only when no batch data exists.
      const isEntitled = entitlement
        ? (entitlement.entitled && entitlement.status === 'active')
        : ownedPlugins.get(pluginId);

      if (isFree || isEntitled) {
        const hasUpdate = registryPlugin && semverGt(registryPlugin.version, installed.version);
        return hasUpdate ? 'update' : 'installed';
      }
      return 'purchase';
    }

    // TICKET_892_4_6: entitlementStatuses (server batch) takes priority over
    // ownedPlugins (login cache). ownedPlugins is only consulted when the
    // batch check has not returned data for this plugin yet.
    const entitlementForOwnership = entitlementStatuses.get(pluginId);
    if (entitlementForOwnership) {
      if (entitlementForOwnership.entitled && entitlementForOwnership.status === 'active') {
        return 'owned';
      }
      // Server explicitly says not entitled — do NOT fall back to ownedPlugins.
    } else if (ownedPlugins.get(pluginId)) {
      return 'owned';
    }

    // TICKET_800: Pricing fallback chain. registry entries (TICKET_725) carry
    // an inline `pricing` field that is a strict subset of PluginPricing -- it
    // is sufficient for the resolver because we only branch on `type` and
    // `provider`. The richer pricingCache / details.pricing override it when
    // available (they additionally carry `purchaseUrl`, `price`, etc.).
    //
    // The previous implementation only consulted `details.pricing` and
    // `pricingCache`, both of which are empty on first paint, so it
    // fell into `free-install` for every paid plugin until the user
    // clicked the card. Reading registry pricing as the third tier
    // eliminates the misleading first-paint label.
    const pricing = details?.pricing ?? pricingCache.get(pluginId) ?? registryPlugin?.pricing;

    // Unknown pricing -- registry has no entry AND no cache hit. Defer until
    // pricing arrives instead of guessing 'free'. PluginCard renders this as
    // a disabled neutral chip.
    if (!pricing) {
      return 'loading';
    }
    if (pricing.type === 'free') {
      return 'free-install';
    }

    // Paid plugin: check license status (third-party)
    if (pricing.provider === 'third-party') {
      const licenseStatus = licenseStatuses.get(pluginId);
      if (!licenseStatus || !licenseStatus.hasKey) {
        return 'enter-license';
      }
      if (licenseStatus.expiresAt && new Date(licenseStatus.expiresAt) < new Date()) {
        return 'license-expired';
      }
      if (licenseStatus.valid) {
        return 'install';
      }
      return 'enter-license';
    }

    // TICKET_551 + TICKET_800: First-party paid: check entitlement.
    // Missing entitlement record means the batch check has not completed
    // yet -- returning 'purchase' here would briefly mislead entitled users
    // before flipping to 'install'. Defer to 'loading' until we have a real
    // record (entitled or explicitly not-entitled). Once present, decide.
    const entitlement = entitlementStatuses.get(pluginId);
    if (!entitlement) {
      return 'loading';
    }
    if (entitlement.entitled && entitlement.status === 'active') {
      return 'install';
    }
    return 'purchase';
  },

  // TICKET_551: Entitlement actions
  setEntitlementStatuses: (statuses) =>
    set({
      entitlementStatuses: new Map(statuses.map((s) => [s.pluginId, s])),
    }),

  updateEntitlementStatus: (status) =>
    set((state) => {
      const newMap = new Map(state.entitlementStatuses);
      newMap.set(status.pluginId, status);
      return { entitlementStatuses: newMap };
    }),

  setPollingPluginId: (pluginId) => set({ pollingPluginId: pluginId }),

  // TICKET_551: Pricing cache
  cachePricing: (pluginId, pricing) =>
    set((state) => {
      const newMap = new Map(state.pricingCache);
      newMap.set(pluginId, pricing);
      return { pricingCache: newMap };
    }),

  // TICKET_892_4: Ownership statuses
  setOwnedPlugins: (owned) => set({ ownedPlugins: owned }),
  setPluginOwned: (pluginId, owned) =>
    set((state) => {
      const newMap = new Map(state.ownedPlugins);
      newMap.set(pluginId, owned);
      return { ownedPlugins: newMap };
    }),

  // TICKET_799: Tier rejection
  setTierRejection: (rejection) => set({ tierRejection: rejection }),
  clearTierRejection: () => set({ tierRejection: null }),
}));

export default useMarketplaceStore;
