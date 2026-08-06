/**
 * PluginDetailModal - Plugin detail overlay
 *
 * TICKET_051: Plugin Marketplace Implementation
 */

import React, { useRef } from 'react';
import {
  X,
  Download,
  Star,
  ExternalLink,
  Shield,
  Wifi,
  HardDrive,
  Package,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { PluginDetails, LicenseStatusInfo } from '@shared/types/marketplace';
import type { PluginActionState } from '../stores/useMarketplaceStore';
import { OwnershipBadge } from '@/components/common/OwnershipBadge';

interface PluginDetailModalProps {
  plugin: PluginDetails;
  installedVersion?: string;
  /** TICKET_447_1: License status for this plugin */
  licenseStatus?: LicenseStatusInfo;
  /** TICKET_447_1: Pre-computed action state */
  actionState?: PluginActionState;
  /** TICKET_892_4: Plugin owned from server-authoritative cache */
  owned?: boolean;
  onClose: () => void;
  onInstall: (pluginId: string, version?: string) => void;
  onUninstall: (pluginId: string) => void;
  /** TICKET_447_1: Purchase handler */
  onPurchase?: () => void;
  /** TICKET_447_1: Enter license key handler */
  onActivateLicense?: () => void;
}

export function PluginDetailModal({
  plugin,
  installedVersion,
  licenseStatus,
  actionState,
  owned,
  onClose,
  onInstall,
  onUninstall,
  onPurchase,
  onActivateLicense,
}: PluginDetailModalProps) {
  const { t } = useTranslation('marketplace');
  const isInstalled = !!installedVersion;
  const hasUpdate =
    isInstalled && plugin.versions[0]?.version !== installedVersion;
  const latestVersion = plugin.versions[0];

  const mouseDownOnBackdrop = useRef(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => {
        if (mouseDownOnBackdrop.current && e.target === e.currentTarget) onClose();
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-start gap-4 border-b p-6">
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
            <Package className="h-8 w-8 text-muted-foreground" />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold">{plugin.name}</h2>
            <p className="text-sm text-muted-foreground">
              {t('detail.by')} {plugin.author.name}
              {plugin.author.github && (
                <a
                  href={`https://github.com/${plugin.author.github}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 text-primary hover:underline"
                >
                  @{plugin.author.github}
                </a>
              )}
            </p>
            <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-2 py-0.5">
                v{latestVersion?.version || plugin.versions[0]?.version}
              </span>
              <span>{plugin.license}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[50vh] overflow-y-auto p-6">
          {/* Description */}
          <section className="mb-6">
            <h3 className="mb-2 text-sm font-medium">{t('detail.description')}</h3>
            <p className="text-sm text-muted-foreground">{plugin.description}</p>
          </section>

          {/* TICKET_447_1: Pricing Info */}
          {plugin.pricing?.type !== 'free' && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-medium">{t('pricing.title')}</h3>
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{t('pricing.price')}</span>
                  {owned ? (
                    <OwnershipBadge owned={owned} />
                  ) : (
                    <span className="text-sm font-semibold text-primary">
                      {plugin.pricing.price || t('pricing.paid')}
                    </span>
                  )}
                </div>
                {plugin.pricing.priceType && (
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{t('pricing.type')}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(`pricing.${plugin.pricing.priceType}`)}
                    </span>
                  </div>
                )}
                {licenseStatus?.valid && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-green-500">
                    <Shield className="h-3 w-3" />
                    {t('plugin.licenseActive')}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Repository */}
          {plugin.repository && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-medium">{t('detail.repository')}</h3>
              <a
                href={plugin.repository}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-primary hover:underline"
              >
                {plugin.repository}
                <ExternalLink className="h-3 w-3" />
              </a>
            </section>
          )}

          {/* Permissions */}
          {plugin.permissions && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-medium">{t('detail.permissions')}</h3>
              <div className="space-y-2">
                <PermissionItem
                  icon={Wifi}
                  label={t('detail.networkAccess')}
                  value={plugin.permissions.network ? t('permissionValue.enabled') : t('permissionValue.disabled')}
                  warning={plugin.permissions.network}
                />
                <PermissionItem
                  icon={HardDrive}
                  label={t('detail.fileSystem')}
                  value={plugin.permissions.filesystem}
                  warning={plugin.permissions.filesystem === 'user'}
                />
                <PermissionItem
                  icon={Shield}
                  label={t('detail.nativeModules')}
                  value={plugin.permissions.native ? t('permissionValue.enabled') : t('permissionValue.disabled')}
                  warning={plugin.permissions.native}
                />
              </div>
            </section>
          )}

          {/* Dependencies */}
          {plugin.dependencies?.python && plugin.dependencies.python.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-medium">{t('detail.pythonDependencies')}</h3>
              <div className="flex flex-wrap gap-1">
                {plugin.dependencies.python.map((dep) => (
                  <span
                    key={dep}
                    className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {dep}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Changelog */}
          {latestVersion?.changelog && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-medium">
                {t('detail.changelog')} (v{latestVersion.version})
              </h3>
              <p className="text-sm text-muted-foreground">
                {latestVersion.changelog}
              </p>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t p-6">
          {/* Left side: Uninstall button (dangerous action) */}
          <div className="flex items-center gap-3">
            {isInstalled && (
              <button
                onClick={() => onUninstall(plugin.id)}
                className="rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                {t('plugin.uninstall')}
              </button>
            )}
            {isInstalled && (
              <span className="text-sm text-muted-foreground">
                {t('detail.installedVersion', { version: installedVersion })}
                {hasUpdate && (
                  <span className="ml-2 text-primary">
                    {t('detail.updateAvailable', { version: latestVersion?.version })}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Right side: Primary actions */}
          <div className="flex items-center gap-2">
            {actionState === 'update' ? (
              <button
                onClick={() => onInstall(plugin.id, latestVersion?.version)}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t('detail.updateTo', { version: latestVersion?.version })}
              </button>
            ) : actionState === 'owned' ? (
              /* TICKET_601: Owned - show Install button (no Purchase) */
              <button
                onClick={() => onInstall(plugin.id)}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t('plugin.install')}
              </button>
            ) : actionState === 'purchase' ? (
              <button
                onClick={() => onPurchase?.()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {plugin.pricing?.price
                  ? `${t('plugin.purchase')} - ${plugin.pricing.price}`
                  : t('plugin.purchase')}
              </button>
            ) : actionState === 'enter-license' ? (
              <button
                onClick={() => onActivateLicense?.()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t('plugin.enterLicense')}
              </button>
            ) : actionState === 'license-expired' ? (
              <button
                onClick={() => onActivateLicense?.()}
                className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
              >
                {t('plugin.licenseExpired')}
              </button>
            ) : actionState === 'install' || actionState === 'free-install' ? (
              <button
                onClick={() => onInstall(plugin.id)}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t('plugin.install')}
              </button>
            ) : actionState === 'loading' ? (
              // TICKET_800: pricing or entitlement still resolving -- show
              // disabled busy chip rather than committing to install/purchase.
              <span
                aria-busy="true"
                className="flex items-center gap-2 rounded-md bg-muted px-4 py-2 text-sm font-medium text-muted-foreground"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('plugin.checking', 'Checking...')}
              </span>
            ) : null}

            <button
              onClick={onClose}
              className="rounded-md bg-muted px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/80"
            >
              {t('detail.done')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface PermissionItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | boolean;
  warning?: boolean;
}

function PermissionItem({
  icon: Icon,
  label,
  value,
  warning,
}: PermissionItemProps) {
  const { t } = useTranslation('marketplace');

  return (
    <div className="flex items-center justify-between rounded bg-muted/50 px-3 py-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">{label}</span>
      </div>
      <div className="flex items-center gap-1">
        {warning && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
        <span
          className={cn(
            'text-xs',
            warning ? 'text-yellow-500' : 'text-muted-foreground'
          )}
        >
          {typeof value === 'boolean' ? (value ? t('permissionValue.yes') : t('permissionValue.no')) : value}
        </span>
      </div>
    </div>
  );
}

export default PluginDetailModal;
