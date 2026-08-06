/**
 * PluginCard - Individual plugin card display
 *
 * TICKET_051: Plugin Marketplace Implementation
 */

import React from 'react';
import { Download, Star, RefreshCw, Trash2, Package, ShoppingCart, AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { RegistryPlugin, RegistryStats, InstalledPlugin, PluginPricing, LicenseStatusInfo } from '@shared/types/marketplace';
import type { PluginActionState } from '../stores/useMarketplaceStore';
import { OwnershipBadge } from '@/components/common/OwnershipBadge';

interface PluginCardProps {
  plugin: RegistryPlugin;
  stats?: RegistryStats[string];
  installed?: InstalledPlugin;
  hasUpdate?: boolean;
  /** TICKET_447_1: Plugin pricing info */
  pricing?: PluginPricing;
  /** TICKET_447_1: License status */
  licenseStatus?: LicenseStatusInfo;
  /** TICKET_447_1: Pre-computed action state */
  actionState?: PluginActionState;
  onClick?: () => void;
  onInstall?: () => void;
  /** TICKET_453: Uninstall handler for installed plugins */
  onUninstall?: () => void;
  /** TICKET_447_1: Purchase handler */
  onPurchase?: () => void;
  /** TICKET_892_4: Plugin ownership from server-authoritative cache */
  owned?: boolean;
}

export function PluginCard({
  plugin,
  stats,
  installed,
  hasUpdate,
  pricing,
  licenseStatus,
  actionState,
  onClick,
  onInstall,
  onUninstall,
  onPurchase,
  owned,
}: PluginCardProps) {
  const { t } = useTranslation('marketplace');
  const handleInstallClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onInstall?.();
  };
  const handleUninstallClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUninstall?.();
  };
  const handlePurchaseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPurchase?.();
  };

  const isPaid = pricing && pricing.type !== 'free';

  return (
    <div
      onClick={onClick}
      className={cn(
        'group cursor-pointer rounded-lg border bg-card p-4 transition-all',
        'hover:border-primary/50 hover:shadow-md'
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
          {plugin.icon ? (
            <img
              src={plugin.icon}
              alt={plugin.name}
              className="h-8 w-8 rounded"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <Package className="h-6 w-6 text-muted-foreground" />
          )}
        </div>

        {/* Title & Author */}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {plugin.name}
          </h3>
          <p className="text-xs text-muted-foreground">{plugin.author}</p>
        </div>

        {/* Version + Price/Buyout Badge */}
        <div className="flex flex-shrink-0 items-center gap-1">
          {owned ? (
            <OwnershipBadge owned={owned} />
          ) : (
            isPaid && pricing.price && (
              <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {pricing.price}
              </span>
            )
          )}
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            v{plugin.version}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">
        {plugin.description}
      </p>

      {/* Tags */}
      {plugin.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {plugin.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between">
        {/* Stats */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {stats?.downloads !== undefined && (
            <span className="flex items-center gap-1">
              <Download className="h-3 w-3" />
              {formatNumber(stats.downloads)}
            </span>
          )}
          {stats?.stars !== undefined && (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {formatNumber(stats.stars)}
            </span>
          )}
        </div>

        {/*
          Action Button - explicit per-state rendering.
          TICKET_579: suppress purchase for owned plugins (checked first).
          TICKET_800: every action state is matched explicitly. Unknown /
          undefined state renders the neutral 'Checking...' chip rather than
          defaulting to the Install button, which previously mis-labelled
          paid plugins as installable on first paint.
        */}
        {actionState === 'owned' ? (
          <span className="rounded-md bg-green-600/10 px-3 py-1.5 text-xs font-medium text-green-400">
            {t('plugin.owned', 'Owned')}
          </span>
        ) : actionState === 'update' ? (
          <button
            onClick={handleInstallClick}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw className="h-3 w-3" />
            {t('plugin.update')}
          </button>
        ) : actionState === 'installed' ? (
          <button
            onClick={handleUninstallClick}
            className="flex items-center gap-1 rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3 w-3" />
            {t('plugin.uninstall')}
          </button>
        ) : actionState === 'purchase' ? (
          <button
            onClick={handlePurchaseClick}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <ShoppingCart className="h-3 w-3" />
            {isPaid && pricing.price ? pricing.price : t('plugin.purchase')}
          </button>
        ) : actionState === 'enter-license' ? (
          <button
            onClick={handlePurchaseClick}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('plugin.enterLicense')}
          </button>
        ) : actionState === 'license-expired' ? (
          <span className="flex items-center gap-1 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {t('plugin.licenseExpired')}
          </span>
        ) : actionState === 'install' || actionState === 'free-install' ? (
          <button
            onClick={handleInstallClick}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('plugin.install')}
          </button>
        ) : (
          // 'loading' or undefined: pricing/entitlement not yet resolved.
          // Disabled neutral chip avoids the misleading "Install" flash on
          // paid plugins before entitlement data arrives.
          <span
            aria-busy="true"
            aria-label={t('plugin.checking', 'Checking...')}
            className="flex items-center gap-1 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('plugin.checking', 'Checking...')}
          </span>
        )}
      </div>
    </div>
  );
}

function formatNumber(num: number | undefined): string {
  if (num == null) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

export default PluginCard;
