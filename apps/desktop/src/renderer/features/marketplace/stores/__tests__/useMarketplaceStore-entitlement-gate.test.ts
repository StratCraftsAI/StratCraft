/**
 * Marketplace Store - Installed + Entitlement Gate Tests
 *
 * TICKET_892_5: Verifies getPluginActionState() returns 'purchase' for
 * installed-but-unentitled paid plugins, and 'update'/'installed' only
 * when the user has valid entitlement or the plugin is free.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useMarketplaceStore } from '../useMarketplaceStore';
import type { PluginPricing, EntitlementStatus, InstalledPlugin, RegistryPlugin } from '@shared/types/marketplace';

function resetStore() {
  useMarketplaceStore.setState({
    registry: [],
    installedPlugins: new Map(),
    licenseStatuses: new Map(),
    entitlementStatuses: new Map(),
    ownedPlugins: new Map(),
    pricingCache: new Map(),
  });
}

const PLUGIN_ID = 'com.stratcraft.quant-lab-nexus';

const paidPricing: PluginPricing = {
  type: 'paid',
  provider: 'StratCraft',
  price: '$29.99',
  priceType: 'one-time',
};

const paidDetails = { id: PLUGIN_ID, pricing: paidPricing } as any;

const installedEntry: InstalledPlugin = {
  id: PLUGIN_ID,
  version: '1.0.0',
  installedAt: '2026-01-01T00:00:00Z',
  source: 'marketplace' as const,
  path: '/plugins/' + PLUGIN_ID,
};

const registryEntry: RegistryPlugin = {
  id: PLUGIN_ID,
  name: 'Sigma',
  version: '2.0.0',
  description: '',
  author: '',
  tier: 1,
  tags: [],
  pricing: paidPricing,
};

const activeEntitlement: EntitlementStatus = {
  pluginId: PLUGIN_ID,
  entitled: true,
  status: 'active',
  purchasedAt: '2026-01-01T00:00:00Z',
  expiresAt: null,
};

const notEntitled: EntitlementStatus = {
  pluginId: PLUGIN_ID,
  entitled: false,
  status: null,
  purchasedAt: null,
  expiresAt: null,
};

describe('useMarketplaceStore - entitlement gate for installed plugins (TICKET_892_5)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns "purchase" when installed + paid + not owned + not entitled', () => {
    useMarketplaceStore.setState({
      installedPlugins: new Map([[PLUGIN_ID, installedEntry]]),
      entitlementStatuses: new Map([[PLUGIN_ID, notEntitled]]),
    });

    const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID, paidDetails);
    expect(result).toBe('purchase');
  });

  it('returns "purchase" when installed + paid + has update + not entitled', () => {
    useMarketplaceStore.setState({
      installedPlugins: new Map([[PLUGIN_ID, installedEntry]]),
      registry: [registryEntry],
      entitlementStatuses: new Map([[PLUGIN_ID, notEntitled]]),
    });

    const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID, paidDetails);
    expect(result).toBe('purchase');
  });

  it('returns "purchase" when installed + paid + no entitlement record (pricing from cache)', () => {
    useMarketplaceStore.setState({
      installedPlugins: new Map([[PLUGIN_ID, installedEntry]]),
      pricingCache: new Map([[PLUGIN_ID, paidPricing]]),
    });

    const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID, {} as any);
    expect(result).toBe('purchase');
  });

  it('returns "purchase" when installed + paid + pricing from registry inline', () => {
    useMarketplaceStore.setState({
      installedPlugins: new Map([[PLUGIN_ID, installedEntry]]),
      registry: [registryEntry],
    });

    const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID, {} as any);
    expect(result).toBe('purchase');
  });

  it('returns "installed" when installed + paid + owned', () => {
    useMarketplaceStore.setState({
      installedPlugins: new Map([[PLUGIN_ID, installedEntry]]),
      ownedPlugins: new Map([[PLUGIN_ID, true]]),
    });

    const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID, paidDetails);
    expect(result).toBe('installed');
  });

  it('returns "update" when installed + paid + owned + newer registry version', () => {
    useMarketplaceStore.setState({
      installedPlugins: new Map([[PLUGIN_ID, installedEntry]]),
      ownedPlugins: new Map([[PLUGIN_ID, true]]),
      registry: [registryEntry],
    });

    const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID, paidDetails);
    expect(result).toBe('update');
  });

  it('returns "installed" when installed + paid + active entitlement (not owned)', () => {
    useMarketplaceStore.setState({
      installedPlugins: new Map([[PLUGIN_ID, installedEntry]]),
      entitlementStatuses: new Map([[PLUGIN_ID, activeEntitlement]]),
    });

    const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID, paidDetails);
    expect(result).toBe('installed');
  });

  it('returns "update" when installed + paid + active entitlement + newer registry', () => {
    useMarketplaceStore.setState({
      installedPlugins: new Map([[PLUGIN_ID, installedEntry]]),
      entitlementStatuses: new Map([[PLUGIN_ID, activeEntitlement]]),
      registry: [registryEntry],
    });

    const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID, paidDetails);
    expect(result).toBe('update');
  });

  it('returns "installed" when installed + free + not owned', () => {
    const freeDetails = { id: PLUGIN_ID, pricing: { type: 'free' as const } } as any;
    useMarketplaceStore.setState({
      installedPlugins: new Map([[PLUGIN_ID, installedEntry]]),
    });

    const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID, freeDetails);
    expect(result).toBe('installed');
  });

  it('returns "installed" when installed + no pricing info (treated as free)', () => {
    useMarketplaceStore.setState({
      installedPlugins: new Map([[PLUGIN_ID, installedEntry]]),
    });

    const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID, {} as any);
    expect(result).toBe('installed');
  });
});
