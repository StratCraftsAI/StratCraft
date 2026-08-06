/**
 * MarketplacePage - Plugin Marketplace main view
 *
 * TICKET_051: Plugin Marketplace Implementation
 * TICKET_447_1: Paid Plugin Purchase and License Flow
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LogIn, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BreadcrumbBar } from '@/components/host';
import { MiniNameplate } from '@/components/common';
import { AccessGate } from '@plugins/strategy-builder-nexus/components/ui/AccessGate';
import { useIsAuthenticated } from '@/hooks/useAuth';
import { PluginFilters } from './components/PluginFilters';
import { PluginList } from './components/PluginList';
import { PluginDetailModal } from './components/PluginDetailModal';
import { InstallProgressDialog } from './components/InstallProgressDialog';
import { InstallConfirmDialog } from './components/InstallConfirmDialog';
import { UninstallConfirmDialog } from './components/UninstallConfirmDialog';
import { LicenseKeyDialog } from './components/LicenseKeyDialog';
import { useMarketplaceStore } from './stores/useMarketplaceStore';
import { useMarketplaceApi } from './hooks/useMarketplaceApi';
import type { PluginDetails } from '@shared/types/marketplace';
import { AUTH_CONFIG } from '@shared/constants';
import { useEntitledPlugins } from '@/hooks/usePluginOwnership';
import { useModal } from '@/hooks/useMessage';

// Pending install state for confirmation dialog
interface PendingInstall {
  plugin: PluginDetails;
  version?: string;
}

export function MarketplacePage() {
  const { t } = useTranslation('marketplace');
  const { t: tErr } = useTranslation('errors');
  const { t: tUi } = useTranslation('ui');
  const isAuthenticated = useIsAuthenticated();
  const store = useMarketplaceStore();
  const api = useMarketplaceApi();
  // TICKET_799: tier-upgrade acquisition-choice surface (Upgrade Plan + Buyout)
  const { showModal } = useModal();
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | null>(null);

  // TICKET_453: Pending uninstall state for confirmation dialog
  const [pendingUninstall, setPendingUninstall] = useState<{ pluginId: string; pluginName: string; fromDetail: boolean } | null>(null);

  // TICKET_447_1: License dialog state
  const [licenseDialogPlugin, setLicenseDialogPlugin] = useState<PluginDetails | null>(null);

  // TICKET_892_4: Fetch entitled plugins and populate ownership map
  const { data: entitledPlugins } = useEntitledPlugins();
  useEffect(() => {
    if (!entitledPlugins || entitledPlugins.length === 0) return;

    const ownedMap = new Map<string, boolean>();
    for (const ep of entitledPlugins) {
      ownedMap.set(ep.plugin_id, true);
    }
    store.setOwnedPlugins(ownedMap);
  }, [entitledPlugins]);

  // TICKET_892_6: Track auth state changes so entitlement batch re-fires on login.
  // Without this, a user who opens Marketplace before logging in sees "Purchase"
  // on entitled plugins, and logging in never re-triggers the batch check because
  // registry.length and pricingCache.size haven't changed.
  const [authGeneration, setAuthGeneration] = useState(0);
  useEffect(() => {
    if (!window.electronAPI?.auth?.onStateChanged) return;
    const unsub = window.electronAPI.auth.onStateChanged(() => {
      setAuthGeneration((g) => g + 1);
    });
    return unsub;
  }, []);

  // TICKET_600: Ref guard prevents React StrictMode double-mount from triggering duplicate IPC calls
  const registryFetchedRef = useRef(false);

  // Fetch registry on mount (TICKET_893: only when authenticated)
  useEffect(() => {
    if (!isAuthenticated) return;
    if (registryFetchedRef.current) return;
    registryFetchedRef.current = true;
    api.fetchRegistry();
  }, [isAuthenticated]);

  // TICKET_551 + TICKET_800: Fetch entitlements for first-party paid plugins.
  //
  // History: the original implementation keyed this effect on `pricingCache`,
  // which is only populated when the user opens a plugin detail modal. That
  // meant entitlement was never fetched until after a click, so the resolver
  // had no entitlement record on first paint and (pre-TICKET_800) silently
  // fell through to 'free-install', mis-labelling paid cards as installable.
  //
  // TICKET_800: derive the first-party paid set directly from `registry`,
  // whose entries carry inline pricing (TICKET_725). This fires immediately
  // after the registry loads, before any user interaction, so:
  //   - entitled users see 'install' from first paint
  //   - non-entitled users see 'purchase' from first paint (after a brief
  //     'loading' chip while the batch is in flight)
  //
  // pricingCache is still merged in (union of ids) so any detail-fetched
  // first-party paid plugin missing from the registry pricing is still
  // covered -- defensive, not load-bearing today.
  useEffect(() => {
    const idsFromRegistry = store.registry
      .filter((p) => p.pricing && p.pricing.type !== 'free' && p.pricing.provider !== 'third-party')
      .map((p) => p.id);

    const idsFromCache = Array.from(store.pricingCache.entries())
      .filter(([_, pricing]) => pricing.type !== 'free' && pricing.provider !== 'third-party')
      .map(([id]) => id);

    const merged = Array.from(new Set([...idsFromRegistry, ...idsFromCache]));

    if (merged.length > 0) {
      api.checkEntitlementsBatch(merged);
    }
  }, [store.registry.length, store.pricingCache.size, authGeneration]);

  // TICKET_892_4_6: Reconcile ownedPlugins when server-authoritative batch returns.
  // ownedPlugins (login cache) is the initial paint source, but entitlementStatuses
  // (server batch) is authoritative. Remove plugins the server says are NOT entitled.
  useEffect(() => {
    if (store.entitlementStatuses.size === 0) return;
    const reconciled = new Map(store.ownedPlugins);
    let changed = false;
    for (const [pluginId, status] of store.entitlementStatuses) {
      if (!status.entitled || status.status !== 'active') {
        if (reconciled.has(pluginId)) {
          reconciled.delete(pluginId);
          changed = true;
        }
      }
    }
    if (changed) {
      store.setOwnedPlugins(reconciled);
    }
  }, [store.entitlementStatuses]);

  // TICKET_551: Stop polling on unmount
  useEffect(() => {
    return () => {
      api.stopEntitlementPolling();
    };
  }, []);

  // TICKET_892_6 Layer C: Re-check entitlements when window regains focus.
  // Covers the alt-tab-back-from-browser scenario after a web purchase.
  useEffect(() => {
    let lastCheck = 0;
    const DEBOUNCE_MS = 10_000;

    const handleFocus = () => {
      const now = Date.now();
      if (now - lastCheck < DEBOUNCE_MS) return;
      lastCheck = now;

      const paidIds = store.registry
        .filter((p) => p.pricing && p.pricing.type !== 'free' && p.pricing.provider !== 'third-party')
        .map((p) => p.id);
      if (paidIds.length > 0) {
        api.checkEntitlementsBatch(paidIds);
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [store.registry.length]);

  const handlePluginSelect = async (pluginId: string) => {
    store.setSelectedPluginId(pluginId);
    await api.fetchPluginDetails(pluginId);
    setShowDetailModal(true);
  };

  const handleInstall = async (pluginId: string, version?: string) => {
    // Fetch plugin details to show confirmation dialog
    const details = await api.fetchPluginDetails(pluginId);
    if (details) {
      setPendingInstall({ plugin: details as PluginDetails, version });
    }
  };

  const handleConfirmInstall = async () => {
    if (!pendingInstall) return;
    setPendingInstall(null);
    await api.installPlugin(pendingInstall.plugin.id, pendingInstall.version);
  };

  const handleCancelInstall = () => {
    setPendingInstall(null);
  };

  // TICKET_453: Show confirmation dialog before uninstall
  const handleUninstall = (pluginId: string) => {
    const plugin = store.registry.find((p) => p.id === pluginId);
    setPendingUninstall({ pluginId, pluginName: plugin?.name || pluginId, fromDetail: false });
  };

  const handleDetailUninstall = (pluginId: string) => {
    const plugin = store.registry.find((p) => p.id === pluginId);
    setPendingUninstall({ pluginId, pluginName: plugin?.name || pluginId, fromDetail: true });
  };

  const handleConfirmUninstall = async () => {
    if (!pendingUninstall) return;
    const { pluginId, fromDetail } = pendingUninstall;
    setPendingUninstall(null);
    await api.uninstallPlugin(pluginId);
    if (fromDetail) {
      setShowDetailModal(false);
    }
  };

  const handleCancelUninstall = () => {
    setPendingUninstall(null);
  };

  const handleRefresh = () => {
    api.fetchRegistry(true);
  };

  // TICKET_799: open the acquisition-choice dialog (Upgrade Plan + optional Buyout)
  // for a first-party paid plugin whose install was blocked by the tier gate.
  // Reused both by handlePurchaseOrLicense (proactive Purchase click) and by
  // the install-failure effect below (reactive install rejection).
  const openTierUpgradeDialog = useCallback(
    (
      pluginDetails: PluginDetails,
      requiredTier: string,
      currentTier: string,
    ) => {
      const pluginId = pluginDetails.id;
      const pluginPricing = pluginDetails.pricing;
      const isFirstParty = !pluginPricing?.provider || pluginPricing.provider === 'StratCraft';
      const hasBuyoutOption = isFirstParty && pluginPricing?.type !== 'free';

      // Upgrade URL: explicit `upgradeUrl` if registry provides it, otherwise
      // the canonical pricing page with `?required=` so the WP page can
      // pre-select the right plan card. `&plugin=` is appended for analytics
      // attribution -- harmless if the backend ignores it.
      const upgradeUrl =
        (pluginPricing as { upgradeUrl?: string } | undefined)?.upgradeUrl
        ?? `${AUTH_CONFIG.BASE_URL}/pricing?required=${encodeURIComponent(requiredTier)}&source=install_gate&plugin=${encodeURIComponent(pluginId)}`;

      // Buyout URL: reuse the existing `purchaseUrl` field convention from
      // TICKET_551_1; fallback to a canonical per-plugin buyout path. Only
      // relevant when a bundle covers this plugin (bundleId !== null).
      const buyoutUrl =
        pluginPricing?.purchaseUrl
        ?? pluginPricing?.premiumUrl
        ?? `${AUTH_CONFIG.BASE_URL}/plugins/${pluginId}/buyout`;

      void showModal({
        type: 'warning',
        action: 'tier-upgrade',
        title: tUi('modal.tierUpgrade.title', {
          plugin: pluginDetails.name,
          defaultValue: `GET ACCESS TO ${pluginDetails.name.toUpperCase()}`,
        }),
        content: tUi('modal.tierUpgrade.body', {
          required: requiredTier.toUpperCase(),
          current: currentTier.toUpperCase(),
          defaultValue: `This plugin requires ${requiredTier.toUpperCase()} tier.\nYou are on ${currentTier.toUpperCase()}.\n\nChoose how you'd like to get access:\n\n- Upgrade Plan: unlocks all ${requiredTier.toUpperCase()} features\n- Buyout: one-time purchase, this plugin only`,
        }),
        cancelText: tUi('modal.defaultCancelText', { defaultValue: 'Cancel' }),
        showCancel: true,
        tierUpgrade: {
          pluginId,
          pluginName: pluginDetails.name,
          requiredTier,
          currentTier,
          // `upgradeUrl` / `buyoutUrl` are captured by the onUpgrade / onBuyout
          // closures below rather than stored on the payload -- ModalDialog
          // only consumes labels/handlers, not URLs.
          onUpgrade: () => {
            api.openPurchaseUrl(upgradeUrl);
            api.startEntitlementPolling(pluginId);
          },
          onBuyout: hasBuyoutOption
            ? () => {
                api.openPurchaseUrl(buyoutUrl);
                api.startEntitlementPolling(pluginId);
              }
            : undefined,
          subscriptionPrice: (pluginPricing as { subscriptionPrice?: string } | undefined)?.subscriptionPrice,
          buyoutPrice: (pluginPricing as { buyoutPrice?: string } | undefined)?.buyoutPrice,
        },
      });
    },
    [api, showModal, tUi],
  );

  // TICKET_447_1 + TICKET_799: Handle purchase or license key entry for a plugin.
  // First-party paid (provider undefined / 'StratCraft') routes through the
  // acquisition-choice dialog instead of opening the checkout URL directly,
  // so the user can see both Upgrade Plan and Buyout as first-class paths.
  // Third-party paid keeps the existing LicenseKeyDialog flow untouched.
  const handlePurchaseOrLicense = useCallback(async (pluginId: string) => {
    const details = await api.fetchPluginDetails(pluginId);
    if (!details) return;

    const pluginDetails = details as PluginDetails;
    const actionState = store.getPluginActionState(pluginId, pluginDetails);

    if (actionState === 'purchase') {
      const provider = pluginDetails.pricing?.provider;
      const isFirstParty = !provider || provider === 'StratCraft';

      if (isFirstParty) {
        // TICKET_799: open AcquireAccessDialog (Upgrade + Buyout) instead of
        // dumping the user straight into the WP checkout. `pricing.tier` is the
        // required-tier source of truth; current tier is best-effort 'unknown'
        // here because the renderer doesn't recompute the install gate locally
        // -- on the reactive install-failure path (tierRejection effect below)
        // we have the authoritative currentTier from the backend payload.
        const requiredTier = pluginDetails.pricing?.tier ?? 'gold';
        openTierUpgradeDialog(pluginDetails, requiredTier, 'unknown');
        return;
      }

      // Third-party paid: existing direct-checkout path
      const purchaseUrl = pluginDetails.pricing?.purchaseUrl
        || pluginDetails.pricing?.premiumUrl
        || `${AUTH_CONFIG.BASE_URL}/plugins/${pluginId}/purchase`;
      api.openPurchaseUrl(purchaseUrl);
      api.startEntitlementPolling(pluginId);
    } else if (actionState === 'enter-license' || actionState === 'license-expired') {
      // Show license key dialog
      setLicenseDialogPlugin(pluginDetails);
    }
  }, [api, store, openTierUpgradeDialog]);

  // TICKET_799: react to install-time tier rejections by opening the same
  // acquisition-choice dialog. The install hook writes a structured
  // TierRejection into the store; we fetch the plugin details to enrich the
  // dialog with `pluginName` / pricing, then clear the rejection so a second
  // attempt re-triggers cleanly.
  useEffect(() => {
    const rejection = store.tierRejection;
    if (!rejection) return;

    let cancelled = false;
    (async () => {
      const details = await api.fetchPluginDetails(rejection.pluginId);
      if (cancelled || !details) return;
      openTierUpgradeDialog(details as PluginDetails, rejection.requiredTier, rejection.currentTier);
      // Single-shot: clear so the dialog isn't reopened on subsequent renders.
      store.clearTierRejection();
    })();

    return () => {
      cancelled = true;
    };
  }, [store.tierRejection, api, openTierUpgradeDialog]);

  // TICKET_447_1: Handle license activation from dialog
  const handleLicenseActivate = useCallback(async (licenseKey: string) => {
    if (!licenseDialogPlugin) return;

    const success = await api.activateLicense(licenseDialogPlugin.id, licenseKey);
    if (success) {
      setLicenseDialogPlugin(null);
      // License activated - now user can install
      handleInstall(licenseDialogPlugin.id);
    }
  }, [licenseDialogPlugin, api]);

  // TICKET_447_1: Handle purchase from license dialog
  const handleLicensePurchase = useCallback(() => {
    if (!licenseDialogPlugin) return;
    const purchaseUrl = licenseDialogPlugin.pricing?.purchaseUrl;
    if (purchaseUrl) {
      api.openPurchaseUrl(purchaseUrl);
    }
  }, [licenseDialogPlugin, api]);

  // TICKET_447_1: Get action state for a plugin (used by PluginList)
  const getActionState = useCallback((pluginId: string) => {
    return store.getPluginActionState(pluginId);
  }, [store]);

  // TICKET_447_1: Detail modal action state
  const detailActionState = showDetailModal && store.selectedPluginDetails
    ? store.getPluginActionState(store.selectedPluginId!, store.selectedPluginDetails)
    : undefined;

  const filteredPlugins = store.getFilteredPlugins();

  // TICKET_893: Auth gate — show login CTA instead of plugin listing
  if (!isAuthenticated) {
    return (
      <div className="flex h-full flex-col">
        <BreadcrumbBar
          centerContent={<MiniNameplate text={t('title')} />}
        />
        <AccessGate
          title={t('authGate.title', 'Login required')}
          description={t('authGate.description', 'Log in to browse and install plugins.')}
          ctaLabel={t('authGate.cta', 'Login / Sign Up')}
          ctaIcon={LogIn}
          onAction={() => window.dispatchEvent(new CustomEvent('nexus:auth-required', { detail: { action: 'open-login' } }))}
          testId="marketplace-auth-gate"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <BreadcrumbBar
        centerContent={<MiniNameplate text={t('title')} />}
        rightContent={
          <button
            onClick={handleRefresh}
            disabled={store.isLoadingRegistry}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${store.isLoadingRegistry ? 'animate-spin' : ''}`}
            />
            {t('ui:common.refresh')}
          </button>
        }
      />

      {/* Filters */}
      <div className="flex-none border-b bg-card px-6 py-3">
        <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {t('subtitle')}
        </p>
        <PluginFilters />
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Error Banner */}
        {/* TICKET_799: suppress the dead-end banner when a tier rejection is
            being handled by the acquisition-choice dialog (set by the install
            hook, cleared after the dialog opens). The dialog is the right
            surface for tier failures; doubling up with a red banner is noise. */}
        {store.error && !store.tierRejection && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            {/* TICKET_786_2: hook stores 'MSG_*' codes; non-code strings (e.g. backend errors) pass through */}
            <p className="text-sm text-red-500">{store.error.startsWith('MSG_') ? tErr(store.error) : store.error}</p>
          </div>
        )}

        {/* Plugin Grid */}
        <PluginList
          plugins={filteredPlugins}
          stats={store.stats}
          installedPlugins={store.installedPlugins}
          isLoading={store.isLoadingRegistry}
          onSelect={handlePluginSelect}
          onInstall={handleInstall}
          onUninstall={handleUninstall}
          getActionState={getActionState}
          onPurchaseOrLicense={handlePurchaseOrLicense}
          pricingCache={store.pricingCache}
          ownedPlugins={store.ownedPlugins}
        />

        {/* Result Count */}
        {!store.isLoadingRegistry && filteredPlugins.length > 0 && (
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {filteredPlugins.length === 1
              ? t('results.showing', { count: filteredPlugins.length })
              : t('results.showingPlural', { count: filteredPlugins.length })}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {showDetailModal && store.selectedPluginDetails && (
        <PluginDetailModal
          plugin={store.selectedPluginDetails}
          installedVersion={store.getInstalledVersion(store.selectedPluginId!)}
          licenseStatus={store.licenseStatuses.get(store.selectedPluginId!)}
          actionState={detailActionState}
          owned={store.ownedPlugins.get(store.selectedPluginId!) ?? false}
          onClose={() => setShowDetailModal(false)}
          onInstall={handleInstall}
          onUninstall={handleDetailUninstall}
          onPurchase={() => handlePurchaseOrLicense(store.selectedPluginId!)}
          onActivateLicense={() => {
            if (store.selectedPluginDetails) {
              setLicenseDialogPlugin(store.selectedPluginDetails);
            }
          }}
        />
      )}

      {/* Install Progress */}
      {store.isInstalling && store.installProgress && (
        <InstallProgressDialog progress={store.installProgress} />
      )}

      {/* Install Confirmation Dialog (TICKET_051 Section 5.3) */}
      {pendingInstall && (
        <InstallConfirmDialog
          plugin={pendingInstall.plugin}
          stats={store.stats[pendingInstall.plugin.id]}
          onConfirm={handleConfirmInstall}
          onCancel={handleCancelInstall}
        />
      )}

      {/* TICKET_453: Uninstall Confirmation Dialog */}
      {pendingUninstall && (
        <UninstallConfirmDialog
          pluginName={pendingUninstall.pluginName}
          onConfirm={handleConfirmUninstall}
          onCancel={handleCancelUninstall}
        />
      )}

      {/* TICKET_447_1: License Key Dialog */}
      {licenseDialogPlugin && (
        <LicenseKeyDialog
          plugin={licenseDialogPlugin}
          isValidating={store.isValidatingLicense}
          error={store.licenseError}
          onActivate={handleLicenseActivate}
          onPurchase={handleLicensePurchase}
          onCancel={() => {
            setLicenseDialogPlugin(null);
            store.setLicenseError(null);
          }}
        />
      )}
    </div>
  );
}

export default MarketplacePage;
