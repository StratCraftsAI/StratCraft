/**
 * InstallConfirmDialog - Permission confirmation before plugin installation
 *
 * TICKET_051: Plugin Marketplace Implementation (Section 5.3)
 */

import React, { useRef } from 'react';
import {
  AlertTriangle,
  Shield,
  Wifi,
  HardDrive,
  Download,
  Star,
  User,
  Package,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { PluginDetails, PluginPermissions } from '@shared/types/marketplace';

interface InstallConfirmDialogProps {
  plugin: PluginDetails;
  stats?: { downloads: number; stars: number };
  onConfirm: () => void;
  onCancel: () => void;
}

export function InstallConfirmDialog({
  plugin,
  stats,
  onConfirm,
  onCancel,
}: InstallConfirmDialogProps) {
  const { t } = useTranslation('marketplace');
  const permissions = plugin.permissions;
  const hasRiskyPermissions = checkRiskyPermissions(permissions);

  const mouseDownOnBackdrop = useRef(false);

  const getFilesystemDetailTranslated = (level: 'none' | 'plugin' | 'user'): string => {
    switch (level) {
      case 'none':
        return t('install.permissions.filesystemNone');
      case 'plugin':
        return t('install.permissions.filesystemPlugin');
      case 'user':
        return t('install.permissions.filesystemUser');
      default:
        return t('install.permissions.filesystemUnknown');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => {
        if (mouseDownOnBackdrop.current && e.target === e.currentTarget) onCancel();
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
            <Package className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t('install.installQuestion', { name: plugin.name })}</h2>
            <p className="text-sm text-muted-foreground">
              v{plugin.versions[0]?.version}
            </p>
          </div>
        </div>

        {/* Permissions Section */}
        {permissions && (
          <div className="mb-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Shield className="h-4 w-4" />
              {t('install.permissions.title')}
            </h3>
            <div className="space-y-2 rounded-lg bg-muted/50 p-3">
              <PermissionRow
                icon={Wifi}
                label={t('install.permissions.network')}
                detail={permissions.network ? t('install.permissions.networkDetail') : t('install.permissions.filesystemNone')}
                enabled={permissions.network}
                warning={permissions.network}
              />
              <PermissionRow
                icon={HardDrive}
                label={t('install.permissions.filesystem')}
                detail={getFilesystemDetailTranslated(permissions.filesystem)}
                enabled={permissions.filesystem !== 'none'}
                warning={permissions.filesystem === 'user'}
              />
              <PermissionRow
                icon={Shield}
                label={t('install.permissions.native')}
                detail={permissions.native ? t('install.permissions.nativeDetail') : t('install.permissions.filesystemNone')}
                enabled={permissions.native}
                warning={permissions.native}
              />
            </div>
          </div>
        )}

        {/* Author Section */}
        <div className="mb-4 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                {plugin.author.github ? (
                  <span>
                    @{plugin.author.github}{' '}
                    <span className="text-xs text-muted-foreground">{t('install.author.unverified')}</span>
                  </span>
                ) : (
                  <span>{plugin.author.name}</span>
                )}
              </span>
            </div>
            {stats && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Download className="h-3 w-3" />
                  {formatNumber(stats.downloads)}
                </span>
                <span className="flex items-center gap-1">
                  <Star className="h-3 w-3" />
                  {formatNumber(stats.stars)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Warning Banner */}
        {hasRiskyPermissions && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-500" />
            <p className="text-xs text-yellow-600 dark:text-yellow-400">
              {t('install.warning.riskyPermissions')}
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            {t('install.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium',
              hasRiskyPermissions
                ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            {hasRiskyPermissions ? t('install.installAnyway') : t('plugin.install')}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

interface PermissionRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
  enabled: boolean;
  warning?: boolean;
}

function PermissionRow({
  icon: Icon,
  label,
  detail,
  enabled,
  warning,
}: PermissionRowProps) {
  if (!enabled) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      {warning ? (
        <AlertTriangle className="h-4 w-4 text-yellow-500" />
      ) : (
        <Icon className="h-4 w-4 text-muted-foreground" />
      )}
      <span className={warning ? 'text-yellow-600 dark:text-yellow-400' : ''}>
        {label}
      </span>
      <span className="text-xs text-muted-foreground">({detail})</span>
    </div>
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

function checkRiskyPermissions(permissions?: PluginPermissions): boolean {
  if (!permissions) return false;
  return (
    permissions.network ||
    permissions.filesystem === 'user' ||
    permissions.native
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

export default InstallConfirmDialog;
