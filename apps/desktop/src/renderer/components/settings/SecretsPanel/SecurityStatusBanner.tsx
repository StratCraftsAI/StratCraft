/**
 * SecurityStatusBanner
 *
 * TICKET_809_1 Phase 6 (TICKET_809_6). Replaces the Phase 3 placeholder
 * banner with a real one driven by the existing main-process security
 * event channel (`security:keychain-unavailable`, TICKET_580_4).
 *
 * On platforms where the OS keychain is unavailable (Linux without
 * libsecret, etc.) the banner switches to a yellow "Reduced
 * Protection" state with the OS-specific install instructions
 * surfaced by the main process. Default state is a teal "Protected"
 * status with the standard reassurance copy.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

import { cn } from '../../../lib/utils';

interface KeychainUnavailablePayload {
  platform: string;
  desktop: string;
  instructions: string;
}

export function SecurityStatusBanner(): JSX.Element {
  const { t } = useTranslation('settings');
  const [unavailable, setUnavailable] = useState<KeychainUnavailablePayload | null>(null);

  useEffect(() => {
    const api = window.electronAPI?.credential;
    if (!api?.onKeychainUnavailable) return undefined;
    const off = api.onKeychainUnavailable(payload => {
      setUnavailable(payload);
    });
    return off;
  }, []);

  if (unavailable) {
    return (
      <div
        className={cn(
          'flex items-start gap-3 px-3 py-2 rounded',
          'border border-color-terminal-accent-amber/40 bg-color-terminal-accent-amber/5',
          'font-mono text-[11px] text-color-terminal-text',
        )}
        role="status"
      >
        <ShieldAlert className="w-4 h-4 mt-0.5 text-color-terminal-accent-amber flex-shrink-0" />
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-color-terminal-accent-amber">
            {t('secretsPanel.security.reducedTitle', {
              defaultValue: 'OS keychain unavailable -- reduced protection',
            })}
          </span>
          <span className="text-color-terminal-text-muted">
            {t('secretsPanel.security.reducedBody', {
              platform: unavailable.platform,
              desktop: unavailable.desktop,
              defaultValue:
                'Secrets are encrypted with a per-install AES-256-GCM key. For OS-keychain-backed protection on {{platform}}/{{desktop}}: ',
            })}
            {unavailable.instructions}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded',
        'border border-color-terminal-border bg-color-terminal-panel',
        'font-mono text-[11px] text-color-terminal-text-muted',
      )}
      role="status"
    >
      <ShieldCheck className="w-4 h-4 text-color-terminal-accent-teal flex-shrink-0" />
      <span>
        {t('secretsPanel.security.protected', {
          defaultValue:
            'Secrets are encrypted at rest with AES-256-GCM and (where available) the OS keychain.',
        })}
      </span>
    </div>
  );
}
