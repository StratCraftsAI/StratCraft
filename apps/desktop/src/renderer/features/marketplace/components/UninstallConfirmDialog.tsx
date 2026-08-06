/**
 * UninstallConfirmDialog - Confirmation dialog before plugin uninstallation
 *
 * TICKET_453: Marketplace Installed Plugin UX Improvement
 */

import React, { useRef } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface UninstallConfirmDialogProps {
  pluginName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function UninstallConfirmDialog({
  pluginName,
  onConfirm,
  onCancel,
}: UninstallConfirmDialogProps) {
  const { t } = useTranslation('marketplace');

  const mouseDownOnBackdrop = useRef(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => {
        if (mouseDownOnBackdrop.current && e.target === e.currentTarget) onCancel();
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div className="w-full max-w-sm rounded-lg bg-card p-6 shadow-xl">
        {/* Icon + Title */}
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold">{t('uninstall.title')}</h2>
        </div>

        {/* Message */}
        <p className="mb-6 text-sm text-muted-foreground">
          {t('uninstall.confirm')}
        </p>

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
            className="flex items-center gap-1 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('plugin.uninstall')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UninstallConfirmDialog;
