/**
 * NavigationGuardDialog - Confirmation dialog when navigating during strategy generation
 *
 * Shows when user clicks sidebar/breadcrumb while generation is in progress.
 * Confirm dispatches cancel event to plugin, then navigates.
 * Cancel dismisses dialog and continues generation.
 *
 * @see TICKET_701 - Generation Navigation Guard
 */

import React, { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';
import { RENDERER_EVENTS } from '@shared/constants/events';
import { useAppStore } from '@/stores';

export function NavigationGuardDialog() {
  const { t } = useTranslation('ui');
  const pendingNavigation = useAppStore((s) => s.pendingNavigation);
  const confirmNavigation = useAppStore((s) => s.confirmNavigation);
  const cancelNavigation = useAppStore((s) => s.cancelNavigation);

  const visible = pendingNavigation !== null;

  const handleConfirm = useCallback(() => {
    // Signal plugin to cancel generation
    window.dispatchEvent(new CustomEvent(RENDERER_EVENTS.GENERATION_CANCEL));
    confirmNavigation();
  }, [confirmNavigation]);

  const handleCancel = useCallback(() => {
    cancelNavigation();
  }, [cancelNavigation]);

  // Keyboard support
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    },
    [visible, handleConfirm, handleCancel]
  );

  useEffect(() => {
    if (!visible) return;
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [visible, handleKeyDown]);

  if (!visible) {
    return null;
  }

  return createPortal(
    <div
      className={cn(
        'fixed inset-0',
        'flex items-center justify-center',
        'bg-black/60 backdrop-blur-[4px]',
        'animate-in fade-in duration-150'
      )}
      style={{ zIndex: Z_INDEX_MODAL }}
      onClick={handleCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nav-guard-dialog-title"
    >
      <div
        className={cn(
          'min-w-[320px] max-w-[400px]',
          'rounded-lg border border-color-terminal-border',
          'bg-color-terminal-surface',
          'shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
          'animate-in zoom-in-95 duration-150'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center gap-2 px-4 py-3',
            'border-b border-color-terminal-border border-l-[3px]',
            'bg-color-terminal-panel rounded-t-lg',
            'border-l-color-terminal-accent-gold'
          )}
        >
          <AlertTriangle className="w-[18px] h-[18px] flex-shrink-0 text-color-terminal-accent-gold" />
          <span
            id="nav-guard-dialog-title"
            className={cn(
              'flex-1 font-mono text-[12px] font-semibold',
              'text-color-terminal-text'
            )}
          >
            {t('navigationGuard.title', 'Generation In Progress')}
          </span>
          <button
            onClick={handleCancel}
            className={cn(
              'p-1',
              'text-color-terminal-text-muted hover:text-color-terminal-text',
              'transition-colors duration-200'
            )}
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-6">
          <p
            className={cn(
              'font-mono text-[12px] leading-relaxed',
              'text-color-terminal-text text-center'
            )}
          >
            {t('navigationGuard.message', 'Strategy generation is in progress. Leaving will cancel the current task.')}
          </p>
        </div>

        {/* Footer */}
        <div
          className={cn(
            'flex justify-center gap-3 px-4 py-4',
            'border-t border-color-terminal-border'
          )}
        >
          <button
            onClick={handleCancel}
            className={cn(
              'min-w-[80px] px-4 py-2',
              'font-mono text-[12px] font-semibold',
              'rounded border border-color-terminal-border',
              'bg-transparent text-color-terminal-text-secondary',
              'hover:border-color-terminal-text-muted hover:text-color-terminal-text',
              'transition-all duration-200'
            )}
          >
            {t('navigationGuard.cancel', 'Stay')}
          </button>
          <button
            onClick={handleConfirm}
            className={cn(
              'min-w-[80px] px-4 py-2',
              'font-mono text-[12px] font-semibold',
              'rounded border border-red-500',
              'bg-red-500/10 text-red-400',
              'hover:bg-red-500/20',
              'transition-all duration-200'
            )}
            autoFocus
          >
            {t('navigationGuard.confirm', 'Leave Page')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default NavigationGuardDialog;
