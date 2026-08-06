/**
 * TICKET_1305 -- unit tests for the centralized `resolveUserTier` contract and
 * the `resolvePluginEntitlementsWithContext` convenience wrapper. Covers the
 * priority order (override > plan > free default) that AC1 requires and the
 * shared-cache behaviour AC8 relies on (an empty override map falls back to the
 * plan, and no context at all falls back to 'free').
 */

import { describe, it, expect } from 'vitest';
import {
  resolveUserTier,
  resolvePluginEntitlementsWithContext,
  type UserTierContext,
  type PluginManifest,
  type UserServiceConfig,
} from '../index';

describe('resolveUserTier', () => {
  const PLUGIN = 'com.stratcraft.example';

  it('prefers a per-plugin override over the account plan (AC1 priority 1)', () => {
    const context: UserTierContext = {
      plan: 'PRO',
      pluginTierOverrides: { [PLUGIN]: 'gold' },
    };
    expect(resolveUserTier(PLUGIN, context)).toBe('gold');
  });

  it('falls back to the account plan (lowercased) when no override matches (AC1 priority 2)', () => {
    const context: UserTierContext = {
      plan: 'PRO',
      pluginTierOverrides: { 'other.plugin': 'gold' },
    };
    expect(resolveUserTier(PLUGIN, context)).toBe('pro');
  });

  it('lowercases the plan so tier-mapping lookups stay case-insensitive', () => {
    expect(resolveUserTier(PLUGIN, { plan: 'GOLD' })).toBe('gold');
  });

  it('defaults to free when there is no override and no plan (AC1 priority 3, TICKET_638)', () => {
    expect(resolveUserTier(PLUGIN, {})).toBe('free');
    expect(resolveUserTier(PLUGIN, { pluginTierOverrides: {} })).toBe('free');
  });

  it('defaults to free when the override map is empty even with an absent plan (AC8 stale-cache fallback)', () => {
    // AC8: an expired shared cache surfaces as an empty pluginTierOverrides map
    // and no session plan -- the resolver must yield the free-tier baseline.
    const staleContext: UserTierContext = { plan: undefined, pluginTierOverrides: {} };
    expect(resolveUserTier(PLUGIN, staleContext)).toBe('free');
  });
});

describe('resolvePluginEntitlementsWithContext', () => {
  const manifest: PluginManifest = {
    id: 'com.stratcraft.example',
    entitlements: {
      services: [
        {
          id: 'basic-service',
          name: 'Basic',
          description: '',
          tier: 'free',
          category: 'core',
          defaultEnabled: true,
        },
        {
          id: 'pro-service',
          name: 'Pro',
          description: '',
          tier: 'pro',
          category: 'core',
          defaultEnabled: true,
        },
      ],
    },
  } as unknown as PluginManifest;

  const emptyConfig: UserServiceConfig = {};

  it('unlocks a PRO service when the account plan is PRO', () => {
    const state = resolvePluginEntitlementsWithContext(
      manifest,
      emptyConfig,
      manifest.id,
      { plan: 'PRO' },
    );
    const pro = state.services.find((s) => s.id === 'pro-service');
    expect(pro?.locked).toBe(false);
  });

  it('locks a PRO service for the unauthenticated free baseline', () => {
    const state = resolvePluginEntitlementsWithContext(
      manifest,
      emptyConfig,
      manifest.id,
      {},
    );
    const pro = state.services.find((s) => s.id === 'pro-service');
    expect(pro?.locked).toBe(true);
  });

  it('unlocks a PRO service via a per-plugin override even when the plan is free', () => {
    const state = resolvePluginEntitlementsWithContext(
      manifest,
      emptyConfig,
      manifest.id,
      { pluginTierOverrides: { [manifest.id]: 'pro' } },
    );
    const pro = state.services.find((s) => s.id === 'pro-service');
    expect(pro?.locked).toBe(false);
  });
});
