/**
 * ModalDialog - Modal confirmation dialog component
 *
 * @see TICKET_096 - Host Layer Message Utils Design (Section 11)
 */

import React, { useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, AlertTriangle, XCircle, HelpCircle, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';
import type { ModalType, ModalOptions } from './modal-types';

interface ModalDialogProps {
  visible: boolean;
  options: ModalOptions | null;
  onOk: () => void;
  onCancel: () => void;
}

const ICON_MAP: Record<ModalType, React.ElementType> = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
  confirm: HelpCircle,
  destructive: Trash2,
};

const TYPE_STYLES: Record<ModalType, { border: string; icon: string }> = {
  info: {
    border: 'border-l-color-terminal-accent-teal',
    icon: 'text-color-terminal-accent-teal',
  },
  warning: {
    border: 'border-l-color-terminal-accent-gold',
    icon: 'text-color-terminal-accent-gold',
  },
  error: {
    border: 'border-l-red-500',
    icon: 'text-red-500',
  },
  confirm: {
    border: 'border-l-color-terminal-accent-teal',
    icon: 'text-color-terminal-accent-teal',
  },
  // TICKET_770: destructive variant for delete/remove confirmations
  destructive: {
    border: 'border-l-red-500',
    icon: 'text-red-500',
  },
};

export function ModalDialog({ visible, options, onOk, onCancel }: ModalDialogProps) {
  const { t } = useTranslation('ui');

  // Keyboard support
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        onOk();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [visible, onOk, onCancel]
  );

  const handleSignUpClick = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('nexus:auth-required', {
        // `action: 'open-login'` is the only field consumed by AuthWidget;
        // `message` is a stable label for debugging only, kept as a sentinel.
        detail: { message: 'SIGN_UP', action: 'open-login' },
      })
    );
    onOk();
  }, [onOk]);

  // TICKET_727: Navigate to BYOK / LLM Settings when user needs to configure API key
  const handleConfigureApiKey = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('nexus:open-settings', {
        detail: { tab: 'llm' },
      })
    );
    onOk();
  }, [onOk]);

  const tierUpgrade = options?.action === 'tier-upgrade' ? options.tierUpgrade : undefined;

  const handleTierUpgrade = useCallback(() => {
    tierUpgrade?.onUpgrade();
    onCancel();
  }, [tierUpgrade, onCancel]);

  const handleTierBuyout = useCallback(() => {
    tierUpgrade?.onBuyout?.();
    onCancel();
  }, [tierUpgrade, onCancel]);

  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!visible || !options) {
    return null;
  }

  const type = options.type ?? 'info';
  const isPromptType = type === 'confirm' || type === 'destructive';
  const title = options.title ?? (
    type === 'destructive'
      ? t('modal.defaultDestructiveTitle', { defaultValue: 'Confirm Delete' })
      : isPromptType
        ? t('modal.defaultConfirmTitle')
        : t('modal.defaultInfoTitle')
  );
  const okText = options.okText ?? t('modal.defaultOkText');
  const cancelText = options.cancelText ?? t('modal.defaultCancelText');
  const showCancel = options.showCancel ?? isPromptType;

  const Icon = ICON_MAP[type];
  const styles = TYPE_STYLES[type];
  const isAuthAction = options.action === 'auth-required';
  const isByokAction = options.action === 'byok-required';
  const isDestructive = type === 'destructive';
  const isTierUpgradeAction = options.action === 'tier-upgrade';

  return (
    <div
      className={cn(
        'fixed inset-0',
        'flex items-center justify-center',
        'bg-black/60 backdrop-blur-[4px]',
        'animate-in fade-in duration-150'
      )}
      style={{ zIndex: Z_INDEX_MODAL }}
      onMouseDown={() => { mouseDownOnBackdrop.current = true; }}
      onMouseUp={() => {
        if (mouseDownOnBackdrop.current) onCancel();
        mouseDownOnBackdrop.current = false;
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className={cn(
          'min-w-[320px] max-w-[480px]',
          'rounded-lg border border-color-terminal-border',
          'bg-color-terminal-surface',
          'shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
          'animate-in zoom-in-95 duration-150'
        )}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center gap-2 px-4 py-3',
            'border-b border-color-terminal-border border-l-[3px]',
            'bg-color-terminal-panel rounded-t-lg',
            styles.border
          )}
        >
          <Icon className={cn('w-[18px] h-[18px] flex-shrink-0', styles.icon)} />
          <span
            id="modal-title"
            className={cn(
              'flex-1 font-mono text-[12px] font-semibold',
              'text-color-terminal-text uppercase tracking-wider'
            )}
          >
            {title}
          </span>
          <button
            onClick={onCancel}
            className={cn(
              'p-1',
              'text-color-terminal-text-muted hover:text-color-terminal-text',
              'transition-colors duration-200'
            )}
            aria-label={t('modal.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-6">
          <div
            className={cn(
              'font-mono text-[12px] leading-relaxed',
              'text-color-terminal-text text-center'
            )}
          >
            {options.content.split('\n').map((line, i, arr) => (
              <React.Fragment key={i}>
                {isAuthAction && line.toLowerCase().startsWith('sign up') ? (
                  <button
                    onClick={handleSignUpClick}
                    className={cn(
                      'font-mono text-[12px] font-semibold',
                      'text-color-terminal-accent-teal hover:underline',
                      'cursor-pointer bg-transparent border-none p-0',
                      'inline'
                    )}
                  >
                    {line}
                  </button>
                ) : (
                  line
                )}
                {i < arr.length - 1 && <br />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          className={cn(
            'flex justify-center gap-3 px-4 py-4',
            'border-t border-color-terminal-border'
          )}
        >
          {/* TICKET_799: tier-upgrade footer -- Cancel + (optional Buyout) + Upgrade.
              Replaces the standard OK/Cancel layout for the install-gate acquisition
              surface. The standard `onOk` is unused here because the dialog has no
              single primary "confirm" action -- both CTAs are equally first-class
              acquisition paths and route through their own callbacks. */}
          {isTierUpgradeAction && tierUpgrade ? (
            <>
              <button
                onClick={onCancel}
                className={cn(
                  'min-w-[80px] px-4 py-2',
                  'font-mono text-[11px] font-semibold uppercase tracking-wider',
                  'rounded border border-color-terminal-border',
                  'bg-transparent text-color-terminal-text-secondary',
                  'hover:border-color-terminal-text-muted hover:text-color-terminal-text',
                  'transition-all duration-200'
                )}
              >
                {cancelText}
              </button>
              {tierUpgrade.onBuyout && (
                <button
                  onClick={handleTierBuyout}
                  className={cn(
                    'min-w-[80px] px-4 py-2',
                    'font-mono text-[11px] font-semibold uppercase tracking-wider',
                    'rounded border border-color-terminal-border',
                    'bg-transparent text-color-terminal-accent-teal',
                    'hover:border-color-terminal-accent-teal hover:bg-color-terminal-accent-teal/10',
                    'transition-all duration-200'
                  )}
                >
                  {tierUpgrade.buyoutPrice
                    ? `${t('modal.tierUpgrade.buyoutCta', { defaultValue: 'Buyout' })} -- ${tierUpgrade.buyoutPrice}`
                    : t('modal.tierUpgrade.buyoutCta', { defaultValue: 'Buyout' })}
                </button>
              )}
              <button
                onClick={handleTierUpgrade}
                className={cn(
                  'min-w-[80px] px-4 py-2',
                  'font-mono text-[11px] font-semibold uppercase tracking-wider',
                  'rounded border border-color-terminal-accent-teal',
                  'bg-color-terminal-accent-teal text-color-terminal-bg',
                  'hover:brightness-110',
                  'transition-all duration-200'
                )}
                autoFocus
              >
                {tierUpgrade.subscriptionPrice
                  ? `${t('modal.tierUpgrade.upgradeCta', { defaultValue: 'Upgrade to Gold' })} -- ${tierUpgrade.subscriptionPrice}`
                  : t('modal.tierUpgrade.upgradeCta', { defaultValue: 'Upgrade to Gold' })}
              </button>
            </>
          ) : (
            <>
              {showCancel && (
                <button
                  onClick={onCancel}
                  className={cn(
                    'min-w-[80px] px-4 py-2',
                    'font-mono text-[11px] font-semibold uppercase tracking-wider',
                    'rounded border border-color-terminal-border',
                    'bg-transparent text-color-terminal-text-secondary',
                    'hover:border-color-terminal-text-muted hover:text-color-terminal-text',
                    'transition-all duration-200'
                  )}
                >
                  {cancelText}
                </button>
              )}
              <button
                onClick={onOk}
                className={cn(
                  'min-w-[80px] px-4 py-2',
                  'font-mono text-[11px] font-semibold uppercase tracking-wider',
                  'rounded border',
                  isByokAction
                    ? 'border-color-terminal-border bg-transparent text-color-terminal-text-secondary hover:border-color-terminal-text-muted hover:text-color-terminal-text'
                    : isDestructive
                      // TICKET_770: red filled OK button for destructive confirmations.
                      ? 'border-red-500 bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'border-color-terminal-accent-teal bg-color-terminal-accent-teal text-color-terminal-bg hover:brightness-110',
                  'transition-all duration-200'
                )}
                autoFocus={!isByokAction}
              >
                {okText}
              </button>
              {/* TICKET_727: "Configure API Key" primary action for byok-required notices */}
              {isByokAction && (
                <button
                  onClick={handleConfigureApiKey}
                  className={cn(
                    'min-w-[80px] px-4 py-2',
                    'font-mono text-[11px] font-semibold uppercase tracking-wider',
                    'rounded border border-color-terminal-accent-teal',
                    'bg-color-terminal-accent-teal text-color-terminal-bg',
                    'hover:brightness-110',
                    'transition-all duration-200'
                  )}
                  autoFocus
                >
                  {t('modal.configureApiKey')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
