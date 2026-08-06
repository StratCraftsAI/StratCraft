/**
 * useProviderList -- unified provider status hook (back-test copy)
 *
 * TICKET_883 Phase 2: Single source of truth for data provider list + status.
 * Reads cached snapshot from main process via `data:listProviders` (instant),
 * subscribes to `data:providerStatusChanged` for live updates.
 *
 * Three identical copies exist (plugin tier boundary -- no cross-imports):
 *   - Host: apps/desktop/src/renderer/hooks/useProviderList.ts
 *   - quant-lab: plugins/quant-lab-nexus/ui/quant-lab-nexus/src/hooks/useProviderList.ts
 *   - back-test: plugins/back-test-nexus/ui/src/hooks/useProviderList.ts (this file)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type ProviderStatus = 'connected' | 'disconnected' | 'error' | 'not-configured' | 'checking';

export interface ProviderEntry {
  id: string;
  name: string;
  status: ProviderStatus;
  capabilities: Record<string, unknown>;
  latencyMs?: number;
  error?: string;
}

export interface UseProviderListResult {
  providers: ProviderEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useProviderList(): UseProviderListResult {
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const api = window.electronAPI?.data;
    if (!api?.listProviders) {
      setLoading(false);
      return;
    }

    api.listProviders()
      .then((list: ProviderEntry[]) => {
        if (!mountedRef.current) return;
        setProviders(list);
        const allChecking = list.length > 0 && list.every(p => p.status === 'checking');
        setLoading(allChecking);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    let unsub: (() => void) | undefined;
    if (api.onProviderStatusChanged) {
      unsub = api.onProviderStatusChanged((entries: ProviderEntry[]) => {
        if (!mountedRef.current) return;
        setProviders(entries);
        setLoading(false);
      });
    }

    return () => {
      mountedRef.current = false;
      unsub?.();
    };
  }, []);

  const refresh = useCallback(() => {
    const api = window.electronAPI?.data;
    if (!api?.refreshProviderStatus) return;
    api.refreshProviderStatus()
      .then((list: ProviderEntry[]) => {
        if (!mountedRef.current) return;
        setProviders(list);
        setLoading(false);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  return { providers, loading, error, refresh };
}
