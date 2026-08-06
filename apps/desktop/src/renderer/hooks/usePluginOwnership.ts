/**
 * Plugin Ownership Hooks
 *
 * TICKET_892_4 Step 5: Server-authoritative plugin ownership queries.
 * Replaces useBuyoutStatus hooks with direct reads from the entitled_plugins
 * cache maintained by EntitlementSyncService.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntitledPlugin } from '../../shared/types/auth';

const api = window.electronAPI;

const OWNERSHIP_STALE_TIME = 30_000;

async function fetchPluginOwnership(pluginId: string): Promise<{ owned: boolean; tier: string }> {
  const result = await api.entitlement.getPluginOwnership(pluginId);
  if (!result.success) {
    return { owned: false, tier: 'free' };
  }
  return result.data ?? { owned: false, tier: 'free' };
}

async function fetchEntitledPlugins(): Promise<EntitledPlugin[]> {
  const result = await api.entitlement.getEntitledPlugins();
  if (!result.success) {
    return [];
  }
  return result.data ?? [];
}

/**
 * Hook to get ownership status for a specific plugin.
 * Returns `{ owned, tier }` from the server-authoritative entitled_plugins cache.
 */
export function usePluginOwnership(pluginId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!api?.auth?.onStateChanged) return;

    const unsub = api.auth.onStateChanged(() => {
      queryClient.invalidateQueries({ queryKey: ['ownership', pluginId] });
    });
    return unsub;
  }, [pluginId, queryClient]);

  return useQuery({
    queryKey: ['ownership', pluginId],
    queryFn: () => fetchPluginOwnership(pluginId),
    enabled: !!pluginId,
    staleTime: OWNERSHIP_STALE_TIME,
  });
}

interface PluginAdmission {
  admitted: boolean;
  grantedTier: string;
  requiredTier: string;
  reason?: string;
}

async function fetchPluginAdmission(pluginId: string): Promise<PluginAdmission> {
  const result = await api.entitlement.checkPluginAdmission(pluginId);
  // TICKET_858: propagate the failure instead of synthesising a denial. A
  // fabricated `{ admitted: false, requiredTier: 'gold' }` would render a
  // denial banner quoting a tier nobody computed, masking the real IPC error.
  if (!result.success || !result.data) {
    throw new Error(result.error ?? `Failed to resolve admission for ${pluginId}`);
  }
  return result.data;
}

/**
 * TICKET_1307: Tier-aware admission hook. Returns `{ admitted, grantedTier,
 * requiredTier, reason }` by comparing the user's effective tier against the
 * plugin's current required tier from the registry.
 */
export function usePluginAdmission(pluginId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!api?.auth?.onStateChanged) return;

    const unsub = api.auth.onStateChanged(() => {
      queryClient.invalidateQueries({ queryKey: ['admission', pluginId] });
    });
    return unsub;
  }, [pluginId, queryClient]);

  return useQuery({
    queryKey: ['admission', pluginId],
    queryFn: () => fetchPluginAdmission(pluginId),
    enabled: !!pluginId,
    staleTime: OWNERSHIP_STALE_TIME,
  });
}

/**
 * Hook to get all entitled plugins from the server-authoritative cache.
 * TICKET_892_6: Invalidates on auth state change so that logging in
 * immediately refreshes the ownedPlugins map in MarketplacePage.
 */
export function useEntitledPlugins() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!api?.auth?.onStateChanged) return;

    const unsub = api.auth.onStateChanged(() => {
      queryClient.invalidateQueries({ queryKey: ['ownership', 'all'] });
    });
    return unsub;
  }, [queryClient]);

  return useQuery({
    queryKey: ['ownership', 'all'],
    queryFn: fetchEntitledPlugins,
    staleTime: OWNERSHIP_STALE_TIME,
  });
}
