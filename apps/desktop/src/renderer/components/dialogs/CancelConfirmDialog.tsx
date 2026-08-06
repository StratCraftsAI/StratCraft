/**
 * CancelConfirmDialog - Confirmation dialog for cancelling backtest
 *
 * @see TICKET_237 - Backtest Result Page Control Buttons
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';

interface CancelConfirmDialogProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CancelConfirmDialog({ visible, onConfirm, onCancel }: CancelConfirmDialogProps) {
  const { t } = useTranslation('backtest');

  // Keyboard support
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    },
    [visible, onConfirm, onCancel]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const mouseDownOnBackdrop = useRef(false);

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
      onMouseDown={() => { mouseDownOnBackdrop.current = true; }}
      onMouseUp={() => {
        if (mouseDownOnBackdrop.current) onCancel();
        mouseDownOnBackdrop.current = false;
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-dialog-title"
    >
      <div
        className={cn(
          'min-w-[320px] max-w-[400px]',
          'rounded-lg border border-color-terminal-border',
          'bg-color-terminal-surface',
          'shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
          'animate-in zoom-in-95 duration-150'
        )}
        onMouseDown={(e) => e.stopPropagation()}
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
            id="cancel-dialog-title"
            className={cn(
              'flex-1 font-mono text-[12px] font-semibold',
              'text-color-terminal-text'
            )}
          >
            {t('cancelDialog.title', 'Cancel Backtest')}
          </span>
          <button
            onClick={onCancel}
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
            {t('cancelDialog.message', 'Are you sure you want to cancel the running backtest? This action cannot be undone.')}
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
            onClick={onCancel}
            className={cn(
              'min-w-[80px] px-4 py-2',
              'font-mono text-[12px] font-semibold',
              'rounded border border-color-terminal-border',
              'bg-transparent text-color-terminal-text-secondary',
              'hover:border-color-terminal-text-muted hover:text-color-terminal-text',
              'transition-all duration-200'
            )}
          >
            {t('cancelDialog.keep', 'Keep Running')}
          </button>
          <button
            onClick={onConfirm}
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
            {t('cancelDialog.confirm', 'Cancel Backtest')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default CancelConfirmDialog;
