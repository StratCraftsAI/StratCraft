/**
 * runEntitlementBatchWithFallback -- TICKET_800
 *
 * Verifies that when the entitlement batch IPC call fails (API surface
 * absent, throws, or returns success=false), the helper writes a synthetic
 * "not entitled" record for every requested plugin id. Without this
 * fallback, the new resolver 'loading' branch (TICKET_800) would strand the
 * UI at "Checking..." forever whenever the entitlement backend is unreachable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runEntitlementBatchWithFallback } from '../useMarketplaceApi';
import { useMarketplaceStore } from '../../stores/useMarketplaceStore';
import type { EntitlementStatus } from '@shared/types/marketplace';

const PLUGIN_A = 'com.stratcraft.signal-generator-nexus';
const PLUGIN_B = 'com.stratcraft.quant-lab-nexus';

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

describe('TICKET_800: runEntitlementBatchWithFallback', () => {
  beforeEach(() => {
    resetStore();
  });

  it('writes a synthetic not-entitled record for every id when the API surface is absent', async () => {
    await runEntitlementBatchWithFallback([PLUGIN_A, PLUGIN_B], {
      callApi: () => undefined,
      writeStatuses: (statuses) => useMarketplaceStore.getState().setEntitlementStatuses(statuses),
    });

    const statuses = useMarketplaceStore.getState().entitlementStatuses;
    expect(statuses.size).toBe(2);
    expect(statuses.get(PLUGIN_A)?.entitled).toBe(false);
    expect(statuses.get(PLUGIN_B)?.entitled).toBe(false);
    expect(statuses.get(PLUGIN_A)?.status).toBeNull();
    expect(statuses.get(PLUGIN_A)?.purchasedAt).toBeNull();
    expect(statuses.get(PLUGIN_A)?.expiresAt).toBeNull();
  });

  it('writes synthetic records when the IPC call rejects', async () => {
    await runEntitlementBatchWithFallback([PLUGIN_A, PLUGIN_B], {
      callApi: () => Promise.reject(new Error('network down')),
      writeStatuses: (statuses) => useMarketplaceStore.getState().setEntitlementStatuses(statuses),
    });

    const statuses = useMarketplaceStore.getState().entitlementStatuses;
    expect(statuses.size).toBe(2);
    expect(statuses.get(PLUGIN_A)?.entitled).toBe(false);
    expect(statuses.get(PLUGIN_B)?.entitled).toBe(false);
  });

  it('writes synthetic records when the IPC call resolves with success=false', async () => {
    await runEntitlementBatchWithFallback([PLUGIN_A, PLUGIN_B], {
      callApi: () => Promise.resolve({ success: false, error: 'unauthorized' }),
      writeStatuses: (statuses) => useMarketplaceStore.getState().setEntitlementStatuses(statuses),
    });

    const statuses = useMarketplaceStore.getState().entitlementStatuses;
    expect(statuses.size).toBe(2);
    expect(statuses.get(PLUGIN_A)?.entitled).toBe(false);
  });

  it('writes synthetic records when the IPC call resolves with success=true but no data', async () => {
    await runEntitlementBatchWithFallback([PLUGIN_A], {
      callApi: () => Promise.resolve({ success: true }),
      writeStatuses: (statuses) => useMarketplaceStore.getState().setEntitlementStatuses(statuses),
    });

    const statuses = useMarketplaceStore.getState().entitlementStatuses;
    expect(statuses.size).toBe(1);
    expect(statuses.get(PLUGIN_A)?.entitled).toBe(false);
  });

  it('on success: stores the returned statuses verbatim (no synthetic overwrite)', async () => {
    const realStatuses: EntitlementStatus[] = [
      {
        pluginId: PLUGIN_A,
        entitled: true,
        status: 'active',
        purchasedAt: '2026-01-01T00:00:00Z',
        expiresAt: null,
      },
      {
        pluginId: PLUGIN_B,
        entitled: false,
        status: null,
        purchasedAt: null,
        expiresAt: null,
      },
    ];

    await runEntitlementBatchWithFallback([PLUGIN_A, PLUGIN_B], {
      callApi: () => Promise.resolve({ success: true, data: realStatuses }),
      writeStatuses: (statuses) => useMarketplaceStore.getState().setEntitlementStatuses(statuses),
    });

    const statuses = useMarketplaceStore.getState().entitlementStatuses;
    expect(statuses.get(PLUGIN_A)?.entitled).toBe(true);
    expect(statuses.get(PLUGIN_A)?.status).toBe('active');
    expect(statuses.get(PLUGIN_B)?.entitled).toBe(false);
  });

  it('does nothing for an empty id list (no fallback write, no IPC call)', async () => {
    const callApi = vi.fn();
    await runEntitlementBatchWithFallback([], {
      callApi,
      writeStatuses: (statuses) => useMarketplaceStore.getState().setEntitlementStatuses(statuses),
    });

    expect(callApi).not.toHaveBeenCalled();
    expect(useMarketplaceStore.getState().entitlementStatuses.size).toBe(0);
  });

  it('the resolver flips "loading" -> "purchase" after a failed batch (end-to-end)', async () => {
    useMarketplaceStore.getState().setRegistry(
      [{
        id: PLUGIN_A,
        name: 'Sigma',
        description: '...',
        author: 'StratCraft',
        version: '1.0.0',
        tags: [],
        pricing: { type: 'paid', provider: 'StratCraft', tier: 'gold' },
      }],
      {},
    );

    expect(useMarketplaceStore.getState().getPluginActionState(PLUGIN_A)).toBe('loading');

    await runEntitlementBatchWithFallback([PLUGIN_A], {
      callApi: () => Promise.reject(new Error('ECONNREFUSED')),
      writeStatuses: (statuses) => useMarketplaceStore.getState().setEntitlementStatuses(statuses),
    });

    expect(useMarketplaceStore.getState().getPluginActionState(PLUGIN_A)).toBe('purchase');
  });
});
