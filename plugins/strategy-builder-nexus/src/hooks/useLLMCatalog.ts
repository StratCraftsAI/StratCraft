/**
 * useLLMCatalog Hook
 *
 * TICKET_646 Phase 3: Unified LLM provider/model catalog access for renderer.
 *
 * Wraps the `llm-catalog:*` IPC channels exposed by the preload bridge. The
 * underlying main-process implementation is the same `getProAvailableProviders()`
 * / `getProCatalogModels()` / `invalidateModelCache()` path used by the
 * legacy shims; consumers should migrate to this hook.
 *
 * Behaviour:
 * - Single fetch on mount; cached in component state.
 * - `getModels(providerId)` is a synchronous lookup against the already-fetched
 *   provider list (no extra IPC round-trip per call).
 * - `refresh()` invalidates the main-process cache then re-fetches.
 *
 * Empty providers (unauthenticated users / first run + offline) are returned
 * as-is per TICKET_646 D2/D3 -- the consumer surfaces the appropriate UI
 * (login prompt, offline badge, etc.); this hook does not gate.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Single model entry as returned by the catalog. */
export interface LLMCatalogModel {
  id: string;
  name: string;
}

/** Single provider entry as returned by the catalog. */
export interface LLMCatalogProvider {
  id: string;
  name: string;
  defaultModel: string;
  models: LLMCatalogModel[];
}

/** TICKET_646 Phase 5: Catalog source state for offline-badge gating. */
export type LLMCatalogSource = 'live' | 'snapshot' | 'empty';

export interface LLMCatalogStatus {
  source: LLMCatalogSource;
  snapshotTimestamp: number | null;
  lastFetchAttempt: number | null;
}

/** Default status used before the first IPC response lands. */
const INITIAL_STATUS: LLMCatalogStatus = {
  source: 'live',
  snapshotTimestamp: null,
  lastFetchAttempt: null,
};

export interface UseLLMCatalogReturn {
  /** Full provider list. Empty array while loading or for unauthenticated users. */
  providers: LLMCatalogProvider[];
  /** Synchronous lookup. Accepts canonical id (e.g. 'OPENAI') or display name ('OpenAI'). */
  getModels: (providerId: string) => LLMCatalogModel[];
  /** True while the initial fetch (or a refresh) is in flight. */
  loading: boolean;
  /** Error from the most recent IPC call, or null. */
  error: string | null;
  /** Invalidate main-process cache and re-fetch. */
  refresh: () => Promise<void>;
  /** TICKET_646 Phase 5: Catalog source / snapshot metadata. */
  catalogStatus: LLMCatalogStatus;
}

export function useLLMCatalog(): UseLLMCatalogReturn {
  const [providers, setProviders] = useState<LLMCatalogProvider[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<LLMCatalogStatus>(INITIAL_STATUS);
  const mountedRef = useRef<boolean>(true);

  /** TICKET_646 Phase 5: Pull current catalog status from main. */
  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.llmCatalog.getStatus();
      if (!mountedRef.current) {
        return;
      }
      if (result.success && result.data) {
        setCatalogStatus(result.data);
      }
    } catch {
      // Status fetch failures are non-fatal; keep prior status.
    }
  }, []);

  const fetchCatalog = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.llmCatalog.getProviders();
      if (!mountedRef.current) {
        return;
      }
      if (result.success && result.data) {
        setProviders(result.data);
      } else {
        setProviders([]);
        setError(result.error ?? 'MSG_LLM_CATALOG_ERROR');
      }
    } catch (e) {
      if (!mountedRef.current) {
        return;
      }
      setProviders([]);
      setError(e instanceof Error ? e.message : 'MSG_LLM_CATALOG_ERROR');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
    // Status reflects whatever source served the catalog; refresh after the
    // provider fetch so the two are consistent.
    await fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchCatalog();

    // TICKET_646 Phase 5: subscribe to live source transitions emitted by main.
    const unsubscribe = window.electronAPI.llmCatalog.onStatusChanged((status) => {
      if (!mountedRef.current) {
        return;
      }
      setCatalogStatus(status);
    });

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [fetchCatalog]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      await window.electronAPI.llmCatalog.refresh();
    } catch (e) {
      // Refresh-side failures don't abort the subsequent fetch -- the next
      // getProviders() call will still hit the resolver, which has its own
      // error handling. We surface the refresh error only if the fetch then
      // also fails.
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : 'MSG_LLM_CATALOG_ERROR');
      }
    }
    await fetchCatalog();
  }, [fetchCatalog]);

  const providerIndex = useMemo(() => buildProviderIndex(providers), [providers]);

  const getModels = useCallback(
    (providerId: string): LLMCatalogModel[] =>
      lookupModels(providerIndex, providerId),
    [providerIndex]
  );

  return { providers, getModels, loading, error, refresh, catalogStatus };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export interface ProviderIndex {
  byId: Map<string, LLMCatalogProvider>;
  byName: Map<string, LLMCatalogProvider>;
}

/** Build a lookup index keyed by upper-case id and lower-case display name. */
export function buildProviderIndex(providers: LLMCatalogProvider[]): ProviderIndex {
  const byId = new Map<string, LLMCatalogProvider>();
  const byName = new Map<string, LLMCatalogProvider>();
  for (const p of providers) {
    byId.set(p.id.toUpperCase(), p);
    byName.set(p.name.toLowerCase(), p);
  }
  return { byId, byName };
}

/**
 * Resolve a provider key (id or display name) to its model list.
 * Returns an empty array when the key is empty or unknown.
 */
export function lookupModels(
  index: ProviderIndex,
  providerId: string
): LLMCatalogModel[] {
  if (!providerId) {
    return [];
  }
  const match =
    index.byId.get(providerId.toUpperCase()) ??
    index.byName.get(providerId.toLowerCase());
  return match ? match.models : [];
}
