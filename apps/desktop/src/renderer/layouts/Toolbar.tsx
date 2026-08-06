/**
 * Toolbar component
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X } from 'lucide-react';
import { useAppStore } from '@/stores';
import { createLogger } from '@/utils/logger';
import { AuthWidget } from '@/components/host/AuthWidget';

const log = createLogger('TOOLBAR');

export function Toolbar() {
  const { t } = useTranslation('ui');
  const { serverStatus } = useAppStore();

  const handleMinimize = () => {
    window.electronAPI?.window.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.window.maximize();
  };

  const handleClose = () => {
    log.info('Close button clicked');
    log.debug('electronAPI exists:', !!window.electronAPI);
    window.electronAPI?.window.close();
    log.info('close() IPC sent');
  };

  return (
    <div className="flex h-full w-full items-center justify-between">
      {/* Left side - Logo (Enlarged) */}
      <div className="flex items-center gap-3 app-region-drag pl-2">
        <img src="/images/logo/stratcraft_icon.png" alt={t('toolbar.logo')} className="h-7 w-7" />
      </div>

      {/* Center - Empty space (Removed Status Indicators) */}
      <div className="flex-1 app-region-drag h-full" />

      {/* TICKET_555: Global AuthWidget - always visible */}
      <div data-onboarding="toolbar-auth" className="app-region-no-drag flex items-center mr-1">
        <AuthWidget />
      </div>

      {/* Right side - Window controls (non-macOS only) */}
      {window.electronAPI?.platform !== 'darwin' && (
        <div className="flex items-center app-region-no-drag">
          <button
            onClick={handleMinimize}
            className="flex h-10 w-12 items-center justify-center hover:bg-muted"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            onClick={handleMaximize}
            className="flex h-10 w-12 items-center justify-center hover:bg-muted"
          >
            <Square className="h-3 w-3" />
          </button>
          <button
            onClick={handleClose}
            className="flex h-10 w-12 items-center justify-center hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function StatusDot({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`h-2 w-2 rounded-full ${
          active ? 'bg-profit animate-pulse' : 'bg-muted-foreground/50'
        }`}
      />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
