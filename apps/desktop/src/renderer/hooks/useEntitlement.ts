/**
 * Entitlement Hooks
 *
 * TICKET_066: Service Entitlement Architecture
 *
 * Provides React hooks for accessing entitlement state and toggling services.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// =============================================================================
// Types
// =============================================================================

export interface ServiceEntitlementState {
  id: string;
  name: string;
  description?: string;
  tier: string;
  category?: string;
  icon?: string;
  enabled: boolean;
  effectiveEnabled: boolean; // TICKET_106: Runtime execution state (locked ? false : enabled)
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

// =============================================================================
// API Helpers
// =============================================================================

const api = window.electronAPI;

async function fetchPluginEntitlements(pluginId: string): Promise<PluginEntitlementState | null> {
  const result = await api.entitlement.getPluginEntitlements(pluginId);
  if (!result.success) {
    console.error('[E:UI:ENTITLEMENT_FETCH_FAILED] Failed to fetch plugin entitlements:', result.error);
    return null;
  }
  return result.data || null;
}

async function fetchAllEntitlements(): Promise<PluginEntitlementState[]> {
  const result = await api.entitlement.getAllEntitlements();
  if (!result.success) {
    console.error('[E:UI:ENTITLEMENT_FETCH_ALL_FAILED] Failed to fetch all entitlements:', result.error);
    return [];
  }
  return result.data || [];
}

async function toggleServiceApi(
  pluginId: string,
  serviceId: string,
  enabled: boolean
): Promise<boolean> {
  const result = await api.entitlement.toggleService(pluginId, serviceId, enabled);
  return result.success;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to get entitlements for a specific plugin
 */
export function usePluginEntitlements(pluginId: string) {
  return useQuery({
    queryKey: ['entitlements', 'plugin', pluginId],
    queryFn: () => fetchPluginEntitlements(pluginId),
    enabled: !!pluginId,
    staleTime: 0, // Always consider data stale for immediate refetch on invalidation
  });
}

/**
 * Hook to get all entitlements across all plugins
 */
export function useAllEntitlements() {
  return useQuery({
    queryKey: ['entitlements', 'all'],
    queryFn: fetchAllEntitlements,
  });
}

/**
 * Hook to toggle a service's enabled state
 */
export function useToggleService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pluginId,
      serviceId,
      enabled,
    }: {
      pluginId: string;
      serviceId: string;
      enabled: boolean;
    }) => {
      const success = await toggleServiceApi(pluginId, serviceId, enabled);
      if (!success) {
        // TICKET_786 D.1: sentinel code; presentation layer translates via errors:MSG_ENTITLEMENT_TOGGLE_FAILED
        throw new Error('ENTITLEMENT_TOGGLE_FAILED');
      }
      return { pluginId, serviceId, enabled };
    },
    onSuccess: ({ pluginId }) => {
      // Refetch relevant queries immediately
      queryClient.refetchQueries({ queryKey: ['entitlements', 'plugin', pluginId] });
      queryClient.refetchQueries({ queryKey: ['entitlements', 'all'] });
    },
  });
}

/**
 * Hook to check if a specific service is enabled
 */
export function useIsServiceEnabled(pluginId: string, serviceId: string) {
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function check() {
      const result = await api.entitlement.isServiceEnabled(pluginId, serviceId);
      if (mounted) {
        setIsEnabled(result.success ? result.data ?? false : false);
        setIsLoading(false);
      }
    }

    check();

    return () => {
      mounted = false;
    };
  }, [pluginId, serviceId]);

  return { isEnabled, isLoading };
}

/**
 * Hook to subscribe to entitlement changes
 * TICKET_187: Also subscribes to user tier changes
 */
export function useEntitlementChanges(
  onServiceToggled?: (data: { pluginId: string; serviceId: string; enabled: boolean }) => void
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribeToggle = api.entitlement.onServiceToggled((data) => {
      // Invalidate queries on change
      queryClient.invalidateQueries({ queryKey: ['entitlements'] });

      // Call callback if provided
      onServiceToggled?.(data);
    });

    // TICKET_187: Subscribe to user tier changes to refresh entitlements after login/logout
    const unsubscribeTier = api.entitlement.onUserTierChanged(() => {
      queryClient.invalidateQueries({ queryKey: ['entitlements'] });
    });

    return () => {
      unsubscribeToggle();
      unsubscribeTier();
    };
  }, [queryClient, onServiceToggled]);
}

/**
 * Hook to get services grouped by category for a plugin
 */
export function useServicesByCategory(pluginId: string) {
  const { data, isLoading, error } = usePluginEntitlements(pluginId);

  const grouped = data?.services.reduce(
    (acc, service) => {
      const category = service.category || 'Uncategorized';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(service);
      return acc;
    },
    {} as Record<string, ServiceEntitlementState[]>
  );

  return {
    data: grouped,
    services: data?.services || [],
    isLoading,
    error,
  };
}
