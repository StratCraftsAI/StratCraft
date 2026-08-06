/**
 * KeychainWarningBanner Component
 *
 * TICKET_580_4: Amber warning banner shown when the OS keychain is unavailable.
 * Displays platform-specific install instructions for enabling secure credential storage.
 * Session-dismissable.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, X, Shield } from 'lucide-react';
import { useKeychainWarning } from '@/hooks/useKeychainWarning';

export function KeychainWarningBanner(): JSX.Element | null {
  const { t } = useTranslation('ui');
  const { keychainUnavailable, instructions, dismiss } = useKeychainWarning();

  if (!keychainUnavailable) return null;

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 text-xs border-b"
      style={{
        background: 'rgba(245, 158, 11, 0.08)',
        borderColor: 'rgba(245, 158, 11, 0.3)',
        color: 'rgb(245, 158, 11)',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Shield className="h-3.5 w-3.5 flex-shrink-0" />
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="truncate">
          {t('keychainWarning.message')}
        </span>
        <code
          className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
          style={{
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.2)',
          }}
        >
          {instructions}
        </code>
      </div>

      <button
        onClick={dismiss}
        className="p-0.5 rounded transition-colors flex-shrink-0 hover:bg-white/10"
        title={t('common.dismiss')}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
