/**
 * ExportNameModal - Modal for naming strategy before saving
 *
 * @see TICKET_268 - Export Name Modal
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';
import { ACCENT_COLORS } from '@shared/constants/colors';

interface ExportNameModalProps {
  visible: boolean;
  defaultName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
  isExporting?: boolean;
}

export function ExportNameModal({
  visible,
  defaultName,
  onConfirm,
  onCancel,
  isExporting = false,
}: ExportNameModalProps) {
  const { t } = useTranslation('backtest');
  const [name, setName] = useState(defaultName);

  // Reset name when modal opens with new defaultName
  useEffect(() => {
    if (visible) {
      setName(defaultName);
    }
  }, [visible, defaultName]);

  // Keyboard support
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible || isExporting) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && name.trim()) {
        e.preventDefault();
        onConfirm(name.trim());
      }
    },
    [visible, isExporting, name, onConfirm, onCancel]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleConfirm = useCallback(() => {
    if (name.trim() && !isExporting) {
      onConfirm(name.trim());
    }
  }, [name, isExporting, onConfirm]);

  const mouseDownOnBackdrop = useRef(false);

  if (!visible) {
    return null;
  }

  const isValid = name.trim().length > 0;

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
      aria-labelledby="export-dialog-title"
    >
      <div
        className={cn(
          'min-w-[360px] max-w-[440px]',
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
            `border-l-[${ACCENT_COLORS.CYAN_400}]`
          )}
        >
          <Save className={`w-[18px] h-[18px] flex-shrink-0 text-[${ACCENT_COLORS.CYAN_400}]`} />
          <span
            id="export-dialog-title"
            className={cn(
              'flex-1 font-mono text-[12px] font-semibold',
              'text-color-terminal-text'
            )}
          >
            {t('exportDialog.title', 'Save Strategy')}
          </span>
          <button
            onClick={onCancel}
            disabled={isExporting}
            className={cn(
              'p-1',
              'text-color-terminal-text-muted hover:text-color-terminal-text',
              'transition-colors duration-200',
              isExporting && 'opacity-50 cursor-not-allowed'
            )}
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-5">
          <label
            htmlFor="signal-source-name"
            className={cn(
              'block mb-2 font-mono text-[12px] font-medium',
              'text-color-terminal-text-secondary'
            )}
          >
            {t('exportDialog.nameLabel', 'Strategy Name')}
          </label>
          <input
            id="signal-source-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isExporting}
            autoFocus
            className={cn(
              'w-full px-3 py-2',
              'font-mono text-[12px]',
              'rounded border border-color-terminal-border',
              'bg-color-terminal-bg text-color-terminal-text',
              'placeholder:text-color-terminal-text-muted',
              `focus:outline-none focus:border-[${ACCENT_COLORS.CYAN_400}] focus:ring-1 focus:ring-[${ACCENT_COLORS.CYAN_400}]/30`,
              'transition-all duration-200',
              isExporting && 'opacity-50 cursor-not-allowed'
            )}
            placeholder={t('exportDialog.namePlaceholder', 'Enter strategy name...')}
          />
          <p
            className={cn(
              'mt-2 font-mono text-[12px]',
              'text-color-terminal-text-muted'
            )}
          >
            {t('exportDialog.nameHint', 'This name will be used to identify the strategy in your library.')}
          </p>
        </div>

        {/* Footer */}
        <div
          className={cn(
            'flex justify-end gap-3 px-4 py-4',
            'border-t border-color-terminal-border'
          )}
        >
          <button
            onClick={onCancel}
            disabled={isExporting}
            className={cn(
              'min-w-[80px] px-4 py-2',
              'font-mono text-[12px] font-semibold',
              'rounded border border-color-terminal-border',
              'bg-transparent text-color-terminal-text-secondary',
              'hover:border-color-terminal-text-muted hover:text-color-terminal-text',
              'transition-all duration-200',
              isExporting && 'opacity-50 cursor-not-allowed'
            )}
          >
            {t('exportDialog.cancel', 'Cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid || isExporting}
            className={cn(
              'min-w-[80px] px-4 py-2',
              'font-mono text-[12px] font-semibold',
              `rounded border border-[${ACCENT_COLORS.CYAN_400}]`,
              `bg-[${ACCENT_COLORS.CYAN_400}]/10 text-[${ACCENT_COLORS.CYAN_400}]`,
              `hover:bg-[${ACCENT_COLORS.CYAN_400}]/20`,
              'transition-all duration-200',
              (!isValid || isExporting) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {isExporting
              ? t('exportDialog.saving', 'Saving...')
              : t('exportDialog.confirm', 'Save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ExportNameModal;
