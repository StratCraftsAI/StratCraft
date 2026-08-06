/**
 * InstallConsentDialog - Plugin Installation Consent Dialog
 *
 * TICKET_100: Plugin Installation Flow & User Consent
 *
 * Displays:
 * - Trust level and publisher information
 * - Requested permissions with risk levels
 * - High-risk warnings for shell/native permissions
 * - Developer mode requirement for unsigned plugins
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  PluginInstallPreview,
  PluginTrustLevel,
  ParsedPluginPermission,
  PermissionRiskLevel,
} from '@shared/types';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Network,
  HardDrive,
  Key,
  Terminal,
  Cpu,
  Link2,
  AlertTriangle,
  CheckCircle2,
  X,
  Info,
} from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

interface InstallConsentDialogProps {
  preview: PluginInstallPreview;
  onConfirm: () => void;
  onCancel: () => void;
}

// =============================================================================
// Trust Level Display
// =============================================================================

const TRUST_LEVEL_CONFIG: Record<
  PluginTrustLevel,
  {
    icon: React.ComponentType<{ className?: string }>;
    labelKey: string;
    color: string;
    bgColor: string;
  }
> = {
  official: {
    icon: ShieldCheck,
    labelKey: 'installConsent.trustLevels.official',
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
  },
  verified: {
    icon: Shield,
    labelKey: 'installConsent.trustLevels.verified',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
  unverified: {
    icon: ShieldAlert,
    labelKey: 'installConsent.trustLevels.unverified',
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
  },
  unsigned: {
    icon: ShieldX,
    labelKey: 'installConsent.trustLevels.unsigned',
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
  },
};

// =============================================================================
// Risk Level Display
// =============================================================================

const RISK_LEVEL_CONFIG: Record<
  PermissionRiskLevel,
  {
    color: string;
    bgColor: string;
    borderColor: string;
  }
> = {
  low: {
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/20',
  },
  medium: {
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/20',
  },
  high: {
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/20',
  },
  critical: {
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
  },
};

// =============================================================================
// Permission Icons
// =============================================================================

const PERMISSION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  network: Network,
  fs: HardDrive,
  bridge: Link2,
  secrets: Key,
  shell: Terminal,
  native: Cpu,
};

// =============================================================================
// Trust Badge Component
// =============================================================================

function TrustBadge({ trustLevel }: { trustLevel: PluginTrustLevel }) {
  const { t } = useTranslation('ui');
  const config = TRUST_LEVEL_CONFIG[trustLevel];
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center gap-2 rounded-full px-3 py-1 ${config.bgColor}`}
    >
      <Icon className={`h-4 w-4 ${config.color}`} />
      <span className={`text-sm font-medium ${config.color}`}>{t(config.labelKey)}</span>
    </div>
  );
}

// =============================================================================
// Permission Item Component
// =============================================================================

function PermissionItem({ permission }: { permission: ParsedPluginPermission }) {
  const { t } = useTranslation('ui');
  const Icon = PERMISSION_ICONS[permission.type] || Shield;
  const riskConfig = RISK_LEVEL_CONFIG[permission.riskLevel];

  return (
    <div
      className={`rounded-lg border p-3 ${riskConfig.bgColor} ${riskConfig.borderColor}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${riskConfig.bgColor}`}
        >
          <Icon className={`h-4 w-4 ${riskConfig.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium capitalize">
              {permission.type === 'fs' ? t('installConsent.fileSystem') : permission.type}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs ${riskConfig.bgColor} ${riskConfig.color}`}
            >
              {permission.riskLevel}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{permission.description}</p>
          <p className="mt-1 text-xs text-muted-foreground/70 italic">
            "{permission.reason}"
          </p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Warning Banner Component
// =============================================================================

function WarningBanner({
  type,
  title,
  message,
}: {
  type: 'high-risk' | 'unverified' | 'dev-mode';
  title: string;
  message: string;
}) {
  const config = {
    'high-risk': {
      icon: AlertTriangle,
      bgColor: 'bg-orange-500/10',
      borderColor: 'border-orange-500/30',
      iconColor: 'text-orange-500',
      titleColor: 'text-orange-600 dark:text-orange-400',
    },
    unverified: {
      icon: ShieldAlert,
      bgColor: 'bg-yellow-500/10',
      borderColor: 'border-yellow-500/30',
      iconColor: 'text-yellow-500',
      titleColor: 'text-yellow-600 dark:text-yellow-400',
    },
    'dev-mode': {
      icon: ShieldX,
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30',
      iconColor: 'text-red-500',
      titleColor: 'text-red-600 dark:text-red-400',
    },
  }[type];

  const Icon = config.icon;

  return (
    <div className={`rounded-lg border p-4 ${config.bgColor} ${config.borderColor}`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${config.iconColor}`} />
        <div>
          <p className={`text-sm font-medium ${config.titleColor}`}>{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function InstallConsentDialog({
  preview,
  onConfirm,
  onCancel,
}: InstallConsentDialogProps): JSX.Element {
  const { t } = useTranslation('ui');
  const [devModeAcknowledged, setDevModeAcknowledged] = useState(false);

  const hasHighRiskPermissions = preview.permissions.some(
    p => p.riskLevel === 'high' || p.riskLevel === 'critical'
  );

  const isUpgrade = !!preview.existingVersion;
  const canInstall = !preview.requiresDevMode || devModeAcknowledged;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl bg-background shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            {preview.trustLevel === 'official' ? (
              <ShieldCheck className="h-6 w-6 text-green-500" />
            ) : hasHighRiskPermissions ? (
              <ShieldAlert className="h-6 w-6 text-orange-500" />
            ) : (
              <Shield className="h-6 w-6 text-primary" />
            )}
            <div>
              <h2 className="text-lg font-semibold">
                {isUpgrade ? t('installConsent.update') : t('installConsent.install')} "{preview.displayName}"
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('installConsent.version')} {preview.version}
                {isUpgrade && (
                  <span className="ml-2 text-xs">
                    ({t('installConsent.from')} {preview.existingVersion})
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg p-2 hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Publisher & Trust */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{t('installConsent.publisher')}</p>
              <p className="text-sm font-medium">
                {preview.publisher?.name || t('installConsent.unknown')}
              </p>
            </div>
            <TrustBadge trustLevel={preview.trustLevel} />
          </div>

          {/* Warnings */}
          {preview.trustLevel === 'unsigned' && (
            <WarningBanner
              type="dev-mode"
              title={t('installConsent.unsignedPlugin')}
              message={t('installConsent.unsignedMessage')}
            />
          )}

          {preview.trustLevel === 'unverified' && (
            <WarningBanner
              type="unverified"
              title={t('installConsent.unverifiedPublisher')}
              message={t('installConsent.unverifiedMessage')}
            />
          )}

          {hasHighRiskPermissions && (
            <WarningBanner
              type="high-risk"
              title={t('installConsent.highRiskPermissions')}
              message={t('installConsent.highRiskMessage')}
            />
          )}

          {/* Custom Warnings from Verification */}
          {preview.warnings.length > 0 && (
            <div className="space-y-2">
              {preview.warnings.map((warning, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg bg-muted/50 p-3"
                >
                  <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">{warning}</p>
                </div>
              ))}
            </div>
          )}

          {/* Permissions */}
          {preview.permissions.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-3">{t('installConsent.permissionsRequested')}</h3>
              <div className="space-y-2">
                {preview.permissions.map((permission, i) => (
                  <PermissionItem key={i} permission={permission} />
                ))}
              </div>
            </div>
          )}

          {preview.permissions.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-green-500/10 p-4">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <p className="text-sm text-green-600 dark:text-green-400">
                {t('installConsent.noPermissions')}
              </p>
            </div>
          )}

          {/* Dev Mode Acknowledgment */}
          {preview.requiresDevMode && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={devModeAcknowledged}
                  onChange={e => setDevModeAcknowledged(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-gray-300"
                />
                <div>
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    {t('installConsent.understandRisks')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('installConsent.riskAcknowledgment')}
                  </p>
                </div>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4 shrink-0">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={!canInstall}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              hasHighRiskPermissions || preview.requiresDevMode
                ? 'bg-orange-500 hover:bg-orange-600'
                : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {hasHighRiskPermissions || preview.requiresDevMode
              ? t('installConsent.iUnderstandInstall')
              : t('installConsent.install')}
          </button>
        </div>

        {/* Plugin Info Footer */}
        <div className="border-t bg-muted/30 px-6 py-3 shrink-0">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('installConsent.id')} {preview.pluginId}</span>
            {preview.publisher?.id && <span>{t('installConsent.publisherLabel')} {preview.publisher.id}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default InstallConsentDialog;
