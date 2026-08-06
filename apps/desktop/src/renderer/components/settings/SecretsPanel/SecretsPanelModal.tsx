/**
 * SecretsPanelModal
 *
 * TICKET_809_1 Phase 3 (TICKET_809_5). Thin in-context shortcut wrapper
 * around `<SecretsPanel mode="modal" />`. Plugins (e.g. BYOKSetupDialog in
 * Phase 4) render this to ask the user "you tried to use feature X but
 * provider Y isn't configured -- set it up here right now."
 *
 * Per TICKET_809_1 section 12.3: the modal cannot be coerced into page
 * mode. The `mode` prop is hardwired to `'modal'` here; the only
 * customizable surfaces are the filter, the heading, and the dismiss
 * behavior.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { Z_INDEX_MODAL } from '../../../../shared/constants/z-index';
import { SecretsPanel } from './SecretsPanel';
import type {
  ProviderCredentialContributionId,
  SecretsPanelFilter,
} from './types';

export interface SecretsPanelModalProps {
  visible: boolean;
  onClose: () => void;
  /** Restrict the panel to a specific subset of providers. Required: a
   *  modal that shows every provider is just System Settings reinvented. */
  filter: SecretsPanelFilter;
  /** Optional heading i18n key. Falls back to `secretsPanel.modalTitle`. */
  headingKey?: string;
  /**
   * Auto-close the modal after a successful provider configuration.
   * Defaults to true (the modal exists because the user was trying to do
   * something else; staying open after config noise is annoying).
   */
  autoCloseOnConfigured?: boolean;
}

export function SecretsPanelModal({
  visible,
  onClose,
  filter,
  headingKey,
  autoCloseOnConfigured = true,
}: SecretsPanelModalProps): JSX.Element | null {
  const { t } = useTranslation('settings');

  useEffect(() => {
    if (!visible) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, onClose]);

  const handleProviderConfigured = useCallback(
    (_providerId: ProviderCredentialContributionId) => {
      if (autoCloseOnConfigured) {
        onClose();
      }
    },
    [autoCloseOnConfigured, onClose],
  );

  const mouseDownOnBackdrop = useRef(false);

  if (!visible) return null;

  const title = headingKey
    ? t(headingKey, { defaultValue: '' })
    : t('secretsPanel.modalTitle', { defaultValue: 'Configure credentials' });

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 flex items-center justify-center',
        'bg-black/60 backdrop-blur-[4px]',
        'animate-in fade-in duration-150',
      )}
      style={{ zIndex: Z_INDEX_MODAL }}
      onMouseDown={() => { mouseDownOnBackdrop.current = true; }}
      onMouseUp={() => {
        if (mouseDownOnBackdrop.current) onClose();
        mouseDownOnBackdrop.current = false;
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="secrets-modal-title"
    >
      <div
        className={cn(
          'min-w-[480px] max-w-[640px] max-h-[80vh]',
          'flex flex-col',
          'rounded-lg border border-color-terminal-border',
          'bg-color-terminal-surface',
          'shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
          'animate-in zoom-in-95 duration-150',
        )}
        onMouseDown={e => e.stopPropagation()}
      >
        <div
          className={cn(
            'flex items-center gap-2 px-4 py-3',
            'border-b border-color-terminal-border border-l-[3px] border-l-color-terminal-accent-teal',
            'bg-color-terminal-panel rounded-t-lg',
          )}
        >
          <span
            id="secrets-modal-title"
            className="flex-1 font-mono text-[12px] font-semibold text-color-terminal-text"
          >
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ui:common.close')}
            className="p-1 text-color-terminal-text-muted hover:text-color-terminal-text transition-colors duration-150"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto">
          <SecretsPanel
            mode="modal"
            filter={filter}
            onProviderConfigured={handleProviderConfigured}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
