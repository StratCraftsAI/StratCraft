/**
 * Marketplace Store - Ownership Integration Tests
 *
 * TICKET_892_4 Step 5: Verifies getPluginActionState() correctly returns 'owned'
 * when a plugin has server-authoritative ownership.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useMarketplaceStore } from '../useMarketplaceStore';
import type { PluginPricing, EntitlementStatus } from '@shared/types/marketplace';

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

const PLUGIN_ID = 'com.stratcraft.signal-generator-nexus';

const paidPricing: PluginPricing = {
  type: 'paid',
  provider: 'StratCraft',
  price: '$29.99',
  priceType: 'one-time',
};

const paidDetails = {
  id: PLUGIN_ID,
  pricing: paidPricing,
} as any;

const notEntitled: EntitlementStatus = {
  pluginId: PLUGIN_ID,
  entitled: false,
  status: null,
  purchasedAt: null,
  expiresAt: null,
};

describe('useMarketplaceStore - ownership integration (TICKET_892_4)', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('getPluginActionState', () => {
    it('returns "purchase" for paid plugin without ownership when explicitly not entitled', () => {
      useMarketplaceStore.setState({
        entitlementStatuses: new Map([[PLUGIN_ID, notEntitled]]),
      });

      const state = useMarketplaceStore.getState();
      const result = state.getPluginActionState(PLUGIN_ID, paidDetails);
      expect(result).toBe('purchase');
    });

    it('returns "loading" for paid plugin without ownership when entitlement is unknown', () => {
      const state = useMarketplaceStore.getState();
      const result = state.getPluginActionState(PLUGIN_ID, paidDetails);
      expect(result).toBe('loading');
    });

    it('returns "owned" for paid plugin with server-authoritative ownership', () => {
      useMarketplaceStore.setState({
        ownedPlugins: new Map([[PLUGIN_ID, true]]),
      });

      const state = useMarketplaceStore.getState();
      const result = state.getPluginActionState(PLUGIN_ID, paidDetails);
      expect(result).toBe('owned');
    });

    it('returns "purchase" for paid plugin with ownership=false (when not entitled)', () => {
      useMarketplaceStore.setState({
        ownedPlugins: new Map([[PLUGIN_ID, false]]),
        entitlementStatuses: new Map([[PLUGIN_ID, notEntitled]]),
      });

      const state = useMarketplaceStore.getState();
      const result = state.getPluginActionState(PLUGIN_ID, paidDetails);
      expect(result).toBe('purchase');
    });

    it('returns "installed" even when owned (install takes priority)', () => {
      useMarketplaceStore.setState({
        ownedPlugins: new Map([[PLUGIN_ID, true]]),
        installedPlugins: new Map([[PLUGIN_ID, {
          id: PLUGIN_ID,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00Z',
          source: 'marketplace' as const,
          path: '/plugins/' + PLUGIN_ID,
        }]]),
      });

      const state = useMarketplaceStore.getState();
      const result = state.getPluginActionState(PLUGIN_ID, paidDetails);
      expect(result).toBe('installed');
    });

    it('returns "owned" for free plugin with ownership (ownership takes precedence)', () => {
      useMarketplaceStore.setState({
        ownedPlugins: new Map([[PLUGIN_ID, true]]),
      });

      const freeDetails = {
        id: PLUGIN_ID,
        pricing: { type: 'free' as const },
      } as any;

      const state = useMarketplaceStore.getState();
      const result = state.getPluginActionState(PLUGIN_ID, freeDetails);
      expect(result).toBe('owned');
    });

    it('returns "owned" for paid plugin with active entitlement (not in ownedPlugins)', () => {
      const entitlement: EntitlementStatus = {
        pluginId: PLUGIN_ID,
        entitled: true,
        status: 'active',
        purchasedAt: '2026-01-01T00:00:00Z',
        expiresAt: null,
      };

      useMarketplaceStore.setState({
        entitlementStatuses: new Map([[PLUGIN_ID, entitlement]]),
      });

      const state = useMarketplaceStore.getState();
      const result = state.getPluginActionState(PLUGIN_ID, paidDetails);
      expect(result).toBe('owned');
    });
  });

  describe('TICKET_892_4_6: entitlementStatuses overrides ownedPlugins', () => {
    it('returns "purchase" when ownedPlugins=true but server says not entitled', () => {
      useMarketplaceStore.setState({
        ownedPlugins: new Map([[PLUGIN_ID, true]]),
        entitlementStatuses: new Map([[PLUGIN_ID, notEntitled]]),
      });

      const state = useMarketplaceStore.getState();
      const result = state.getPluginActionState(PLUGIN_ID, paidDetails);
      expect(result).toBe('purchase');
    });

    it('returns "owned" when ownedPlugins=true and no entitlementStatuses (fallback)', () => {
      useMarketplaceStore.setState({
        ownedPlugins: new Map([[PLUGIN_ID, true]]),
      });

      const state = useMarketplaceStore.getState();
      const result = state.getPluginActionState(PLUGIN_ID, paidDetails);
      expect(result).toBe('owned');
    });

    it('returns "purchase" for installed+paid when ownedPlugins=true but server says not entitled', () => {
      useMarketplaceStore.setState({
        ownedPlugins: new Map([[PLUGIN_ID, true]]),
        entitlementStatuses: new Map([[PLUGIN_ID, notEntitled]]),
        installedPlugins: new Map([[PLUGIN_ID, {
          id: PLUGIN_ID,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00Z',
          source: 'marketplace' as const,
          path: '/plugins/' + PLUGIN_ID,
        }]]),
      });

      const state = useMarketplaceStore.getState();
      const result = state.getPluginActionState(PLUGIN_ID, paidDetails);
      expect(result).toBe('purchase');
    });

    it('returns "installed" for installed+paid when ownedPlugins=true and server says entitled', () => {
      const activeEntitlement: EntitlementStatus = {
        pluginId: PLUGIN_ID,
        entitled: true,
        status: 'active',
        purchasedAt: '2026-01-01T00:00:00Z',
        expiresAt: null,
      };

      useMarketplaceStore.setState({
        ownedPlugins: new Map([[PLUGIN_ID, true]]),
        entitlementStatuses: new Map([[PLUGIN_ID, activeEntitlement]]),
        installedPlugins: new Map([[PLUGIN_ID, {
          id: PLUGIN_ID,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00Z',
          source: 'marketplace' as const,
          path: '/plugins/' + PLUGIN_ID,
        }]]),
      });

      const state = useMarketplaceStore.getState();
      const result = state.getPluginActionState(PLUGIN_ID, paidDetails);
      expect(result).toBe('installed');
    });
  });

  describe('setOwnedPlugins', () => {
    it('sets the ownership map', () => {
      const owned = new Map<string, boolean>([[PLUGIN_ID, true]]);
      useMarketplaceStore.getState().setOwnedPlugins(owned);

      const state = useMarketplaceStore.getState();
      expect(state.ownedPlugins.size).toBe(1);
      expect(state.ownedPlugins.get(PLUGIN_ID)).toBe(true);
    });
  });

  describe('setPluginOwned', () => {
    it('sets a single ownership entry', () => {
      useMarketplaceStore.getState().setPluginOwned(PLUGIN_ID, true);

      const state = useMarketplaceStore.getState();
      expect(state.ownedPlugins.get(PLUGIN_ID)).toBe(true);
    });

    it('preserves existing entries when adding new one', () => {
      const otherPlugin = 'com.stratcraft.quant-lab-nexus';
      useMarketplaceStore.getState().setPluginOwned(PLUGIN_ID, true);
      useMarketplaceStore.getState().setPluginOwned(otherPlugin, true);

      const state = useMarketplaceStore.getState();
      expect(state.ownedPlugins.size).toBe(2);
      expect(state.ownedPlugins.has(PLUGIN_ID)).toBe(true);
      expect(state.ownedPlugins.has(otherPlugin)).toBe(true);
    });
  });
});
