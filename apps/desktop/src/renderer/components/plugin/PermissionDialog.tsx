/**
 * PermissionDialog - Plugin permission approval dialog
 *
 * Display required plugin permissions and let user decide whether to authorize
 */

import React from 'react';
import type { PluginManifest, PluginPermission } from '@shared/types';
import { useTranslation } from 'react-i18next';
import { PERMISSION_DEFINITIONS } from '@/lib/plugin-permissions';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Network,
  HardDrive,
  Database,
  Bell,
  Clipboard,
  Terminal,
  Cpu,
  X,
} from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

interface PermissionDialogProps {
  manifest: PluginManifest;
  permissions: PluginPermission[];
  onApprove: () => void;
  onDeny: () => void;
}

// =============================================================================
// Permission Icons
// =============================================================================

const PERMISSION_ICONS: Record<PluginPermission, React.ComponentType<{ className?: string }>> = {
  'network': Network,
  'network:internal': Network,
  'filesystem': HardDrive,
  'filesystem:full': HardDrive,
  'database': Database,
  'notification': Bell,
  'clipboard': Clipboard,
  'shell': Terminal,
  'native': Cpu,
};

// =============================================================================
// Risk Level Colors
// =============================================================================

const RISK_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  low: {
    bg: 'bg-green-500/10',
    text: 'text-green-600 dark:text-green-400',
    border: 'border-green-500/20',
  },
  medium: {
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-600 dark:text-yellow-400',
    border: 'border-yellow-500/20',
  },
  high: {
    bg: 'bg-orange-500/10',
    text: 'text-orange-600 dark:text-orange-400',
    border: 'border-orange-500/20',
  },
  dangerous: {
    bg: 'bg-red-500/10',
    text: 'text-red-600 dark:text-red-400',
    border: 'border-red-500/20',
  },
};

// =============================================================================
// Permission Item Component
// =============================================================================

function PermissionItem({ permission }: { permission: PluginPermission }): JSX.Element {
  const { t } = useTranslation('ui');
  const def = PERMISSION_DEFINITIONS[permission];
  const Icon = PERMISSION_ICONS[permission] || Shield;
  const colors = RISK_COLORS[def?.level || 'low'];

  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${colors.bg} ${colors.border}`}>
      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${colors.bg}`}>
        <Icon className={`h-4 w-4 ${colors.text}`} />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{def?.nameKey ? t(def.nameKey) : (def?.name || permission)}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${colors.bg} ${colors.text}`}>
            {def?.level ? t(`permissions.riskLevels.${def.level}`) : t('permissions.riskLevels.unknown')}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {def?.descriptionKey ? t(def.descriptionKey) : (def?.description || t('permissions.unknownPermission'))}
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function PermissionDialog({
  manifest,
  permissions,
  onApprove,
  onDeny,
}: PermissionDialogProps): JSX.Element {
  const { t } = useTranslation('ui');
  // Analyze risk level
  const hasDangerous = permissions.some(
    p => PERMISSION_DEFINITIONS[p]?.level === 'dangerous'
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            {hasDangerous ? (
              <ShieldAlert className="h-6 w-6 text-destructive" />
            ) : (
              <ShieldCheck className="h-6 w-6 text-primary" />
            )}
            <div>
              <h2 className="text-lg font-semibold">{t('permissions.title')}</h2>
              <p className="text-sm text-muted-foreground">
                {manifest.name} v{manifest.version}
              </p>
            </div>
          </div>
          <button
            onClick={onDeny}
            className="rounded-lg p-2 hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <p className="mb-4 text-sm text-muted-foreground">
            {t('permissions.requestingPermissions')}
          </p>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {permissions.map(permission => (
              <PermissionItem key={permission} permission={permission} />
            ))}
          </div>

          {/* Warning for dangerous permissions */}
          {hasDangerous && (
            <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3">
              <div className="flex items-start gap-2">
                <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">
                    {t('permissions.dangerousPermissions')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('permissions.dangerousWarning')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          <button
            onClick={onDeny}
            className="rounded-lg px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            {t('permissions.deny')}
          </button>
          <button
            onClick={onApprove}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
              hasDangerous
                ? 'bg-destructive hover:bg-destructive/90'
                : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {hasDangerous ? t('permissions.approveAnyway') : t('permissions.approve')}
          </button>
        </div>

        {/* Plugin Info */}
        <div className="border-t bg-muted/30 px-6 py-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('permissions.pluginId')}: {manifest.id}</span>
            {manifest.author && <span>{t('permissions.author')}: {manifest.author}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PermissionDialog;
