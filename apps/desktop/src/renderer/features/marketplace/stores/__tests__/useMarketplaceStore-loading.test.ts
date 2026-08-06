/**
 * Marketplace Store -- TICKET_800 loading-state resolver tests
 *
 * Covers:
 *   - unknown pricing -> 'loading' (not 'free-install')
 *   - registry pricing fallback chain (details > cache > registry)
 *   - first-party paid + unknown entitlement -> 'loading' (not 'purchase')
 *   - first-party paid + explicit not-entitled -> 'purchase'
 *   - first-party paid + entitled -> 'install'
 *   - free plugin still resolves correctly
 *   - ownership 'owned' still wins (TICKET_892_4)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useMarketplaceStore } from '../useMarketplaceStore';
import type { RegistryPlugin, PluginPricing, EntitlementStatus, RegistryStats } from '@shared/types/marketplace';

const PLUGIN_ID = 'com.stratcraft.signal-generator-nexus';

function resetStore() {
  useMarketplaceStore.setState({
    registry: [],
    stats: {},
    installedPlugins: new Map(),
    licenseStatuses: new Map(),
    entitlementStatuses: new Map(),
    ownedPlugins: new Map(),
    pricingCache: new Map(),
  });
}

function seedRegistry(plugins: RegistryPlugin[], stats: RegistryStats = {}) {
  useMarketplaceStore.getState().setRegistry(plugins, stats);
}

const paidRegistryEntry: RegistryPlugin = {
  id: PLUGIN_ID,
  name: 'Sigma',
  description: 'AI-powered signal generation',
  author: 'StratCraft',
  version: '1.0.0',
  tags: ['ai', 'ccxt'],
  pricing: {
    type: 'paid',
    provider: 'StratCraft',
    tier: 'gold',
  },
};

const freeRegistryEntry: RegistryPlugin = {
  id: 'com.example.free',
  name: 'Free Plugin',
  description: 'Free example',
  author: 'Example',
  version: '1.0.0',
  tags: [],
  pricing: { type: 'free' },
};

const notEntitled: EntitlementStatus = {
  pluginId: PLUGIN_ID,
  entitled: false,
  status: null,
  purchasedAt: null,
  expiresAt: null,
};

const activeEntitlement: EntitlementStatus = {
  pluginId: PLUGIN_ID,
  entitled: true,
  status: 'active',
  purchasedAt: '2026-01-01T00:00:00Z',
  expiresAt: null,
};

describe('useMarketplaceStore - TICKET_800 loading state', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('unknown pricing', () => {
    it('returns "loading" when no pricing anywhere (no registry, no cache, no details)', () => {
      const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID);
      expect(result).toBe('loading');
    });

    it('never returns "free-install" for a plugin with unknown pricing', () => {
      const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID);
      expect(result).not.toBe('free-install');
      expect(result).not.toBe('install');
      expect(result).not.toBe('purchase');
    });
  });

  describe('registry pricing fallback (TICKET_725 inline pricing)', () => {
    it('uses registry.pricing when pricingCache and details are empty', () => {
      seedRegistry([paidRegistryEntry]);
      const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID);
      expect(result).toBe('loading');
    });

    it('returns "free-install" when registry pricing says free', () => {
      seedRegistry([freeRegistryEntry]);
      const result = useMarketplaceStore.getState().getPluginActionState(freeRegistryEntry.id);
      expect(result).toBe('free-install');
    });

    it('details.pricing overrides registry.pricing', () => {
      seedRegistry([paidRegistryEntry]);
      const freeDetails = {
        id: PLUGIN_ID,
        pricing: { type: 'free' } as PluginPricing,
      } as any;
      const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID, freeDetails);
      expect(result).toBe('free-install');
    });

    it('pricingCache overrides registry.pricing', () => {
      seedRegistry([paidRegistryEntry]);
      useMarketplaceStore.getState().cachePricing(PLUGIN_ID, { type: 'free' });
      const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID);
      expect(result).toBe('free-install');
    });
  });

  describe('first-party paid + entitlement', () => {
    beforeEach(() => {
      seedRegistry([paidRegistryEntry]);
    });

    it('returns "loading" when entitlement record is missing', () => {
      const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID);
      expect(result).toBe('loading');
    });

    it('returns "owned" when entitlement is active and entitled (TICKET_892_4_6)', () => {
      useMarketplaceStore.setState({
        entitlementStatuses: new Map([[PLUGIN_ID, activeEntitlement]]),
      });
      const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID);
      expect(result).toBe('owned');
    });

    it('returns "purchase" when entitlement record exists but user is not entitled', () => {
      useMarketplaceStore.setState({
        entitlementStatuses: new Map([[PLUGIN_ID, notEntitled]]),
      });
      const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID);
      expect(result).toBe('purchase');
    });

    it('returns "purchase" when entitled=true but status=expired (not active)', () => {
      const expired: EntitlementStatus = {
        pluginId: PLUGIN_ID,
        entitled: true,
        status: 'expired',
        purchasedAt: '2025-01-01T00:00:00Z',
        expiresAt: '2025-06-01T00:00:00Z',
      };
      useMarketplaceStore.setState({
        entitlementStatuses: new Map([[PLUGIN_ID, expired]]),
      });
      const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID);
      expect(result).toBe('purchase');
    });
  });

  describe('ownership wins over loading (TICKET_892_4)', () => {
    it('returns "owned" when owned even with no pricing info', () => {
      useMarketplaceStore.setState({
        ownedPlugins: new Map([[PLUGIN_ID, true]]),
      });
      const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID);
      expect(result).toBe('owned');
    });

    it('returns "owned" when owned even with paid registry pricing', () => {
      seedRegistry([paidRegistryEntry]);
      useMarketplaceStore.setState({
        ownedPlugins: new Map([[PLUGIN_ID, true]]),
      });
      const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID);
      expect(result).toBe('owned');
    });
  });

  describe('installed + paid requires entitlement (TICKET_892_5)', () => {
    it('returns "purchase" when installed + paid but no entitlement', () => {
      seedRegistry([paidRegistryEntry]);
      useMarketplaceStore.setState({
        installedPlugins: new Map([[PLUGIN_ID, {
          id: PLUGIN_ID,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00Z',
          source: 'marketplace' as const,
          path: '/plugins/' + PLUGIN_ID,
        }]]),
      });
      const result = useMarketplaceStore.getState().getPluginActionState(PLUGIN_ID);
      expect(result).toBe('purchase');
    });
  });
});
