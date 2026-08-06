/**
 * LicenseKeyDialog - License key entry modal for third-party paid plugins
 *
 * TICKET_447_1: Paid Plugin Purchase and License Flow
 *
 * Follows the InstallConfirmDialog pattern for modal structure.
 */

import React, { useRef, useState } from 'react';
import { Key, ExternalLink, Loader2, AlertCircle, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { PluginDetails } from '@shared/types/marketplace';

interface LicenseKeyDialogProps {
  plugin: PluginDetails;
  isValidating: boolean;
  error: string | null;
  onActivate: (licenseKey: string) => void;
  onPurchase: () => void;
  onCancel: () => void;
}

export function LicenseKeyDialog({
  plugin,
  isValidating,
  error,
  onActivate,
  onPurchase,
  onCancel,
}: LicenseKeyDialogProps) {
  const { t } = useTranslation('marketplace');
  // TICKET_786_4: translate MSG_-prefixed error codes through the errors namespace
  const { t: tErr } = useTranslation('errors');
  const [licenseKey, setLicenseKey] = useState('');

  const displayError = error
    ? (error.startsWith('MSG_') ? tErr(error) : error)
    : null;

  const mouseDownOnBackdrop = useRef(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (licenseKey.trim() && !isValidating) {
      onActivate(licenseKey.trim());
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current = e.target === e.currentTarget;
      }}
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
            <h2 className="text-lg font-semibold">{t('license.title')}</h2>
            <p className="text-sm text-muted-foreground">
              {plugin.name} - v{plugin.versions[0]?.version}
            </p>
          </div>
        </div>

        {/* License Key Input */}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label
              htmlFor="license-key-input"
              className="mb-2 flex items-center gap-2 text-sm font-medium"
            >
              <Key className="h-4 w-4" />
              {t('license.keyLabel')}
            </label>
            <input
              id="license-key-input"
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder={t('license.keyPlaceholder')}
              disabled={isValidating}
              autoFocus
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2 text-sm font-mono',
                'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
                'disabled:opacity-50',
                error && 'border-destructive'
              )}
            />
          </div>

          {/* Error Display */}
          {displayError && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <p className="text-xs text-destructive">{displayError}</p>
            </div>
          )}

          {/* Purchase Link */}
          {plugin.pricing?.purchaseUrl && (
            <div className="mb-4">
              <button
                type="button"
                onClick={onPurchase}
                className="flex items-center gap-1 text-sm text-primary hover:underline"
              >
                {t('license.noPurchaseLink')}
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isValidating}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {t('install.cancel')}
            </button>
            <button
              type="submit"
              disabled={!licenseKey.trim() || isValidating}
              className={cn(
                'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:opacity-50'
              )}
            >
              {isValidating && <Loader2 className="h-4 w-4 animate-spin" />}
              {isValidating ? t('license.validating') : t('license.activate')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LicenseKeyDialog;
