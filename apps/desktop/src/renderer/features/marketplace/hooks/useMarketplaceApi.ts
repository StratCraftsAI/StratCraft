/**
 * useMarketplaceApi - Hook for marketplace operations via IPC
 *
 * TICKET_051: Plugin Marketplace Implementation
 */

import { useCallback, useEffect, useRef } from 'react';
import { useMarketplaceStore } from '../stores/useMarketplaceStore';
import { emitTelemetry } from '@/services/telemetry-renderer';
import type { TierRejection } from '../stores/useMarketplaceStore';
import type { InstallProgress, PluginDetails, LicenseStatusInfo, EntitlementStatus } from '@shared/types/marketplace';
import { MARKETPLACE_POLL_INTERVAL_MS } from '@shared/constants/timing';

/**
 * TICKET_799: Parse the `TIER_INSUFFICIENT:<json>:<human>` sentinel emitted by
 * `plugin-market-service.checkPaidPluginGates()` when a first-party paid
 * plugin's install gate rejects the user for tier reasons. Returns the
 * structured payload on match, null otherwise (so the caller falls back to
 * the existing string-error / banner path).
 *
 * The wire format is deliberately a single string because Electron IPC
 * serialises Error to its `message` only -- custom properties are dropped.
 */
const TIER_SENTINEL_PREFIX = 'TIER_INSUFFICIENT:';

/**
 * Exported for unit tests only. Production callers should not import this --
 * use the install hook flow, which routes parsed rejections into the store
 * automatically. Underscored prefix marks the test-only contract.
 */
export function __parseTierRejectionForTests(rawMessage: string): TierRejection | null {
  return parseTierRejection(rawMessage);
}

function parseTierRejection(rawMessage: string): TierRejection | null {
  if (!rawMessage.startsWith(TIER_SENTINEL_PREFIX)) return null;
  const afterPrefix = rawMessage.slice(TIER_SENTINEL_PREFIX.length);
  // payload JSON is delimited by the next ":" -- objects are guaranteed to
  // start with "{" so any ":" inside the JSON value is preserved, and the
  // first top-level "}" + ":" marks the boundary back to the human fallback.
  const closeBrace = afterPrefix.indexOf('}');
  if (closeBrace < 0) return null;
  const jsonStr = afterPrefix.slice(0, closeBrace + 1);
  try {
    const parsed = JSON.parse(jsonStr) as Partial<TierRejection>;
    if (
      typeof parsed.pluginId === 'string' &&
      typeof parsed.requiredTier === 'string' &&
      typeof parsed.currentTier === 'string'
    ) {
      return {
        pluginId: parsed.pluginId,
        requiredTier: parsed.requiredTier,
        currentTier: parsed.currentTier,
      };
    }
  } catch {
    // malformed payload -- fall through to null so the caller uses the
    // raw message as a banner string, preserving the human fallback.
  }
  return null;
}

/**
 * TICKET_800: Run a batch entitlement check with a deterministic fallback so
 * the resolver never gets stranded in the 'loading' state.
 *
 * On success, the returned statuses are written verbatim. On failure
 * (API surface absent, IPC throws, or success=false), a synthetic
 * "not entitled" record is written for every requested id. Showing
 * 'purchase' on a real entitlement check failure is conservative and
 * recoverable: the user can log in or retry, and the next successful
 * batch overwrites the synthetic record. The alternative (no write)
 * silently strands the UI on "Checking...".
 *
 * Extracted as a free function (rather than living inside the hook closure)
 * so it is testable without React-DOM and without `@testing-library/react`.
 *
 * @internal exported for tests.
 */
export async function runEntitlementBatchWithFallback(
  pluginIds: string[],
  deps: {
    callApi: (ids: string[]) => Promise<{ success: boolean; data?: EntitlementStatus[]; error?: string } | undefined> | undefined;
    writeStatuses: (statuses: EntitlementStatus[]) => void;
  },
): Promise<void> {
  if (pluginIds.length === 0) return;

  const fallback = (): EntitlementStatus[] =>
    pluginIds.map((pluginId) => ({
      pluginId,
      entitled: false,
      status: null,
      purchasedAt: null,
      expiresAt: null,
    }));

  let result: { success: boolean; data?: EntitlementStatus[]; error?: string } | undefined;
  try {
    const maybePromise = deps.callApi(pluginIds);
    result = maybePromise ? await maybePromise : undefined;
  } catch {
    deps.writeStatuses(fallback());
    return;
  }

  if (result && result.success && result.data) {
    deps.writeStatuses(result.data);
  } else {
    deps.writeStatuses(fallback());
  }
}

/**
 * TICKET_805_2: pure decision helper for `marketplace.promo.converted`.
 *
 * Returns true iff the entitlement transition represents a promo
 * (`expires_at != null`) graduating to a permanent buyout
 * (`expires_at == null`). Both prev and next must report `entitled: true`;
 * a flip through `entitled: false` is a churn event, not a conversion.
 *
 * Exported for unit tests only.
 */
export function __isPromoToBuyoutTransitionForTests(
  prev: EntitlementStatus | undefined,
  next: EntitlementStatus,
): boolean {
  return (
    prev?.entitled === true &&
    prev.expiresAt != null &&
    next.entitled === true &&
    next.expiresAt == null
  );
}

/**
 * TICKET_805_2: async runner for the `marketplace.promo.converted` emit
 * sequence. Extracted as a pure function (taking IPC + emit + clock as deps)
 * so it can be unit-tested without React or Sentry.
 *
 * Sequence:
 *   1. Read install_with_promo_at via IPC (per-plugin).
 *   2. If null -> no-op (this user was never on promo, or already converted).
 *   3. Compute days_since_install = floor((now - installedAt) / 86400000).
 *   4. Emit marketplace.promo.converted with payload.
 *   5. Clear install_with_promo_at via IPC (idempotent guard against double-fire).
 *
 * All IPC errors are swallowed: telemetry must never break the entitlement
 * UI path. The caller schedules this on a microtask so the synchronous
 * store update happens first.
 *
 * Exported for unit tests only.
 */
export async function __runPromoConvertedForTests(
  pluginId: string,
  deps: {
    getInstallWithPromoAt: (id: string) => Promise<{ success: boolean; installWithPromoAt: number | null } | undefined>;
    clearInstallWithPromoAt: (id: string) => Promise<{ success: boolean } | undefined>;
    emit: (name: string, payload: Record<string, string | number>) => void;
    now: () => number;
  },
): Promise<void> {
  try {
    const res = await deps.getInstallWithPromoAt(pluginId);
    const installedAt = res?.installWithPromoAt ?? null;
    if (installedAt == null) return;
    const daysSinceInstall = Math.floor((deps.now() - installedAt) / 86400000);
    deps.emit('marketplace.promo.converted', {
      plugin_id: pluginId,
      days_since_install: daysSinceInstall,
    });
    await deps.clearInstallWithPromoAt(pluginId);
  } catch {
    // Telemetry persistence/emit is non-critical; never surface failures.
  }
}

/**
 * TICKET_805_2: async runner for the `marketplace.promo.first_run` emit
 * sequence. Extracted as a pure function for the same reason as
 * __runPromoConvertedForTests.
 *
 * Sequence:
 *   1. Read install_with_promo_at via IPC -- skip if null (plugin was never
 *      on promo, so first_run is not on the promo funnel).
 *   2. Call markFirstRunIfFirst (the once-only gate lives in main-process
 *      SQLite) -- skip if not the first activation.
 *   3. Emit marketplace.promo.first_run.
 *
 * IPC errors are swallowed by design.
 *
 * Exported for unit tests only.
 */
export async function __runPromoFirstRunForTests(
  pluginId: string,
  deps: {
    getInstallWithPromoAt: (id: string) => Promise<{ success: boolean; installWithPromoAt: number | null } | undefined>;
    markFirstRunIfFirst: (id: string) => Promise<{ success: boolean; isFirstRun: boolean } | undefined>;
    emit: (name: string, payload: Record<string, string | number>) => void;
  },
): Promise<void> {
  try {
    const installed = await deps.getInstallWithPromoAt(pluginId);
    if (installed?.installWithPromoAt == null) return;
    const res = await deps.markFirstRunIfFirst(pluginId);
    if (res?.isFirstRun) {
      deps.emit('marketplace.promo.first_run', { plugin_id: pluginId });
    }
  } catch {
    // Telemetry is non-critical.
  }
}

export function useMarketplaceApi() {
  const store = useMarketplaceStore();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  // Subscribe to install progress events
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.marketplace) return;

    const unsubProgress = api.marketplace.onInstallProgress(
      (progress: InstallProgress) => {
        store.setInstallProgress(progress);
      }
    );

    const unsubComplete = api.marketplace.onInstallComplete(
      ({ pluginId }: { pluginId: string }) => {
        store.setInstalling(false);
        store.setInstallProgress(null);
        // TICKET_805 P1.4: emit marketplace.promo.install when the just-installed
        // TICKET_892_4: promo telemetry removed (server-authoritative entitlement)
        // Refresh registry to get updated installed list
        fetchRegistry(true);
      }
    );

    const unsubError = api.marketplace.onInstallError(
      ({ pluginId, error }: { pluginId: string; error: string }) => {
        store.setInstalling(false);
        store.setInstallProgress(null);
        // TICKET_799: same sentinel split as the installPlugin() catch path --
        // async install-error events can also carry the TIER_INSUFFICIENT
        // payload if the gate rejection arrives via the event channel rather
        // than the synchronous IPC reject.
        const tierRejection = parseTierRejection(error);
        if (tierRejection) {
          store.setTierRejection(tierRejection);
          store.setError(null);
        } else {
          store.setError(error);
        }
      }
    );

    // TICKET_447_1: Subscribe to license status change events
    const unsubLicense = api.marketplace.onLicenseStatusChanged?.(
      (status: LicenseStatusInfo) => {
        store.updateLicenseStatus(status);
      }
    );

    // TICKET_551: Subscribe to entitlement change events
    const unsubEntitlement = api.marketplace.onEntitlementChanged?.(
      (status: EntitlementStatus) => {
        // TICKET_805_2: detect promo -> permanent-buyout transition for
        // marketplace.promo.converted.
        const prev = store.entitlementStatuses.get(status.pluginId);
        if (__isPromoToBuyoutTransitionForTests(prev, status)) {
          // Schedule on a microtask so the state update below runs first
          // (keeps store consistent even if the IPC call throws).
          void __runPromoConvertedForTests(status.pluginId, {
            getInstallWithPromoAt: (id) =>
              window.electronAPI?.marketplace?.promoTelemetry?.getInstallWithPromoAt(id) as
                | Promise<{ success: boolean; installWithPromoAt: number | null } | undefined>
                | undefined ?? Promise.resolve(undefined),
            clearInstallWithPromoAt: (id) =>
              window.electronAPI?.marketplace?.promoTelemetry?.clearInstallWithPromoAt(id) as
                | Promise<{ success: boolean } | undefined>
                | undefined ?? Promise.resolve(undefined),
            emit: emitTelemetry,
            now: () => Date.now(),
          });
        }
        store.updateEntitlementStatus(status);
        if (status.entitled && status.status === 'active') {
          store.setPluginOwned(status.pluginId, true);
        }
        // Stop polling if entitlement confirmed for the polling plugin
        if (status.entitled && store.pollingPluginId === status.pluginId) {
          stopEntitlementPolling();
        }
      }
    );

    // TICKET_805_2: Subscribe to plugin activation broadcasts for
    // marketplace.promo.first_run. Activation events fire on every app start
    // (auto-activate); the once-only gate lives in main-process SQLite
    // (plugin_telemetry_state.first_run_emitted_at) and is consulted via
    // markFirstRunIfFirst. We only emit when this plugin also had a promo
    // install recorded -- otherwise we'd be measuring activations of
    // plugins that were never on promo, which is not what this funnel
    // tracks (install_with_promo -> first_run -> converted).
    const unsubActivated = api.marketplace.onPluginActivated?.(
      ({ pluginId }: { pluginId: string }) => {
        void __runPromoFirstRunForTests(pluginId, {
          getInstallWithPromoAt: (id) =>
            window.electronAPI?.marketplace?.promoTelemetry?.getInstallWithPromoAt(id) as
              | Promise<{ success: boolean; installWithPromoAt: number | null } | undefined>
              | undefined ?? Promise.resolve(undefined),
          markFirstRunIfFirst: (id) =>
            window.electronAPI?.marketplace?.promoTelemetry?.markFirstRunIfFirst(id) as
              | Promise<{ success: boolean; isFirstRun: boolean } | undefined>
              | undefined ?? Promise.resolve(undefined),
          emit: emitTelemetry,
        });
      }
    );

    return () => {
      unsubProgress();
      unsubComplete();
      unsubError();
      unsubLicense?.();
      unsubEntitlement?.();
      unsubActivated?.();
    };
  }, []);

  const fetchRegistry = useCallback(async (forceRefresh = false) => {
    const api = window.electronAPI;
    if (!api?.marketplace?.getRegistry) {
      store.setError('MSG_MARKETPLACE_API_UNAVAILABLE');
      return;
    }

    store.setLoadingRegistry(true);
    store.setError(null);

    try {
      const result = await api.marketplace.getRegistry(forceRefresh);

      if (result.success) {
        store.setRegistry(result.registry || [], result.stats || {});

        // Sync installed plugins
        if (result.installed) {
          store.setInstalledPlugins(result.installed);
        }
      } else {
        // TICKET_786_4: prefer MSG code so MarketplacePage can translate
        store.setError(result.error || 'MSG_MARKETPLACE_FETCH_REGISTRY_FAILED');
      }
    } catch (err) {
      store.setError(err instanceof Error ? err.message : 'MSG_MARKETPLACE_FETCH_REGISTRY_FAILED');
    } finally {
      store.setLoadingRegistry(false);
    }
  }, []);

  const fetchPluginDetails = useCallback(async (pluginId: string) => {
    const api = window.electronAPI;
    if (!api?.marketplace?.getPluginDetails) {
      store.setError('MSG_MARKETPLACE_API_UNAVAILABLE');
      return null;
    }

    store.setLoadingDetails(true);
    store.setError(null);

    try {
      const result = await api.marketplace.getPluginDetails(pluginId);

      if (result.success) {
        const details = result.details as PluginDetails;
        store.setSelectedPluginDetails(details);
        // TICKET_551: Cache pricing for card display
        if (details.pricing) {
          store.cachePricing(pluginId, details.pricing);
        }
        return result.details;
      } else {
        // TICKET_786_4: prefer MSG code so MarketplacePage can translate
        store.setError(result.error || 'MSG_MARKETPLACE_FETCH_DETAILS_FAILED');
        return null;
      }
    } catch (err) {
      store.setError(
        err instanceof Error ? err.message : 'MSG_MARKETPLACE_FETCH_DETAILS_FAILED'
      );
      return null;
    } finally {
      store.setLoadingDetails(false);
    }
  }, []);

  const installPlugin = useCallback(async (pluginId: string, version?: string) => {
    const api = window.electronAPI;
    if (!api?.marketplace?.install) {
      store.setError('MSG_MARKETPLACE_API_UNAVAILABLE');
      return false;
    }

    store.setInstalling(true);
    store.setError(null);

    try {
      const result = await api.marketplace.install(pluginId, version);
      return result.success;
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : 'MSG_MARKETPLACE_INSTALL_FAILED';
      // TICKET_799: route tier-insufficient rejections into the structured
      // `tierRejection` slot so MarketplacePage opens the acquisition-choice
      // dialog instead of dumping the wire string into the red banner.
      const tierRejection = parseTierRejection(rawMessage);
      if (tierRejection) {
        store.setTierRejection(tierRejection);
        store.setError(null);
      } else {
        // TICKET_786_4: prefer MSG code so MarketplacePage can translate
        store.setError(rawMessage);
      }
      store.setInstalling(false);
      return false;
    }
  }, []);

  const uninstallPlugin = useCallback(async (pluginId: string) => {
    const api = window.electronAPI;
    if (!api?.marketplace?.uninstall) {
      store.setError('MSG_MARKETPLACE_API_UNAVAILABLE');
      return false;
    }

    try {
      const result = await api.marketplace.uninstall(pluginId);

      if (result.success) {
        store.removeInstalledPlugin(pluginId);
        // TICKET_452: Refresh PluginManager so NexusHub removes the plugin
        const { getPluginManager } = await import('@/lib/plugin-manager');
        getPluginManager().refresh().catch(err => {
          console.error('[E:MARKETPLACE:REFRESH_AFTER_UNINSTALL_FAILED] Failed to refresh PluginManager after uninstall:', err);
        });
        return true;
      } else {
        // TICKET_786_4: prefer MSG code so MarketplacePage can translate
        store.setError(result.error || 'MSG_MARKETPLACE_UNINSTALL_FAILED');
        return false;
      }
    } catch (err) {
      store.setError(err instanceof Error ? err.message : 'MSG_MARKETPLACE_UNINSTALL_FAILED');
      return false;
    }
  }, []);

  const checkUpdates = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.marketplace?.checkUpdates) return [];

    try {
      const result = await api.marketplace.checkUpdates();
      return result.success ? result.updates || [] : [];
    } catch {
      return [];
    }
  }, []);

  // TICKET_447_1: Open external purchase URL
  const openPurchaseUrl = useCallback(async (url: string) => {
    const api = window.electronAPI;
    if (!api?.marketplace?.openPurchaseUrl) return;
    await api.marketplace.openPurchaseUrl(url);
  }, []);

  // TICKET_447_1: Activate (validate + store) a license key
  const activateLicense = useCallback(async (pluginId: string, licenseKey: string) => {
    const api = window.electronAPI;
    if (!api?.marketplace?.activateLicense) {
      // TICKET_786_4: prefer MSG code so LicenseKeyDialog can translate
      store.setLicenseError('MSG_MARKETPLACE_API_UNAVAILABLE');
      return false;
    }

    store.setValidatingLicense(true);
    store.setLicenseError(null);

    try {
      const result = await api.marketplace.activateLicense(pluginId, licenseKey);
      if (result.success && result.data?.valid) {
        return true;
      } else {
        store.setLicenseError(result.data?.error || result.error || 'MSG_MARKETPLACE_LICENSE_VALIDATION_FAILED');
        return false;
      }
    } catch (err) {
      store.setLicenseError(err instanceof Error ? err.message : 'MSG_MARKETPLACE_LICENSE_ACTIVATION_FAILED');
      return false;
    } finally {
      store.setValidatingLicense(false);
    }
  }, []);

  // TICKET_447_1: Fetch license statuses for paid plugins
  const fetchLicenseStatuses = useCallback(async (pluginIds: string[]) => {
    const api = window.electronAPI;
    if (!api?.marketplace?.getLicenseStatus || pluginIds.length === 0) return;

    try {
      const result = await api.marketplace.getLicenseStatus(pluginIds);
      if (result.success && result.data) {
        store.setLicenseStatuses(result.data);
      }
    } catch {
      // Non-critical: license status fetch failure is not blocking
    }
  }, []);

  // TICKET_447_1: Remove a stored license key
  const removeLicense = useCallback(async (pluginId: string) => {
    const api = window.electronAPI;
    if (!api?.marketplace?.removeLicense) return false;

    try {
      const result = await api.marketplace.removeLicense(pluginId);
      if (result.success) {
        store.removeLicenseStatus(pluginId);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  // TICKET_551: Check entitlement for a single plugin
  const checkEntitlement = useCallback(async (pluginId: string) => {
    const api = window.electronAPI;
    if (!api?.marketplace?.checkEntitlement) return null;

    try {
      const result = await api.marketplace.checkEntitlement(pluginId);
      if (result.success && result.data) {
        store.updateEntitlementStatus(result.data);
        if (result.data.entitled && result.data.status === 'active') {
          store.setPluginOwned(pluginId, true);
        }
        return result.data;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const checkEntitlementsBatch = useCallback(async (pluginIds: string[]) => {
    await runEntitlementBatchWithFallback(pluginIds, {
      callApi: (ids) => window.electronAPI?.marketplace?.checkEntitlementsBatch?.(ids),
      writeStatuses: (statuses) => store.setEntitlementStatuses(statuses),
    });
  }, []);

  // TICKET_551: Start polling entitlement after purchase
  const startEntitlementPolling = useCallback((pluginId: string) => {
    // Stop any existing polling
    stopEntitlementPolling();

    store.setPollingPluginId(pluginId);
    pollCountRef.current = 0;

    pollingRef.current = setInterval(async () => {
      pollCountRef.current += 1;

      // Max attempts reached - stop polling
      if (pollCountRef.current >= 60) {
        stopEntitlementPolling();
        return;
      }

      const status = await checkEntitlement(pluginId);
      if (status?.entitled) {
        stopEntitlementPolling();
      }
    }, MARKETPLACE_POLL_INTERVAL_MS);
  }, [checkEntitlement]);

  // TICKET_551: Stop entitlement polling
  const stopEntitlementPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    pollCountRef.current = 0;
    store.setPollingPluginId(null);
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  return {
    fetchRegistry,
    fetchPluginDetails,
    installPlugin,
    uninstallPlugin,
    checkUpdates,
    openPurchaseUrl,
    activateLicense,
    fetchLicenseStatuses,
    removeLicense,
    checkEntitlement,
    checkEntitlementsBatch,
    startEntitlementPolling,
    stopEntitlementPolling,
  };
}

export default useMarketplaceApi;
