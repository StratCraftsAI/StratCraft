import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Database, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';
import { ACCENT_COLORS } from '@shared/constants/colors';
import {
  PROVIDER_YFINANCE, PROVIDER_CCXT, PROVIDER_DUKASCOPY, PROVIDER_ALPACA,
  PROVIDER_AKSHARE, PROVIDER_TUSHARE, PROVIDER_BAOSTOCK, PROVIDER_CLICKHOUSE,
} from '@StratCraft/types';

const RESERVED_PACKAGE_NAMES = new Set([
  'parquet', 'base', 'imported-package',
  PROVIDER_YFINANCE, PROVIDER_CCXT, PROVIDER_DUKASCOPY, PROVIDER_ALPACA,
  PROVIDER_AKSHARE, PROVIDER_TUSHARE, PROVIDER_BAOSTOCK, PROVIDER_CLICKHOUSE,
]);

interface PackageNameModalProps {
  visible: boolean;
  defaultName: string;
  existingPackageNames: string[];
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function PackageNameModal({
  visible,
  defaultName,
  existingPackageNames,
  onConfirm,
  onCancel,
}: PackageNameModalProps) {
  const { t } = useTranslation('ui');
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (visible) {
      setName(defaultName);
    }
  }, [visible, defaultName]);

  const trimmed = name.trim();
  const isEmpty = trimmed.length === 0;
  const isReserved = RESERVED_PACKAGE_NAMES.has(trimmed.toLowerCase());
  const isReimport = !isEmpty && !isReserved && existingPackageNames.includes(trimmed);
  const isValid = !isEmpty && !isReserved;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && isValid) {
        e.preventDefault();
        onConfirm(trimmed);
      }
    },
    [visible, isValid, trimmed, onConfirm, onCancel]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleConfirm = useCallback(() => {
    if (isValid) {
      onConfirm(trimmed);
    }
  }, [isValid, trimmed, onConfirm]);

  const mouseDownOnBackdrop = useRef(false);

  if (!visible) return null;

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
      aria-labelledby="package-name-dialog-title"
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
          <Database className={`w-[18px] h-[18px] flex-shrink-0 text-[${ACCENT_COLORS.CYAN_400}]`} />
          <span
            id="package-name-dialog-title"
            className={cn(
              'flex-1 font-mono text-[12px] font-semibold',
              'text-color-terminal-text'
            )}
          >
            {t('dataManagement.importPackage.nameModal.title')}
          </span>
          <button
            onClick={onCancel}
            className={cn(
              'p-1',
              'text-color-terminal-text-muted hover:text-color-terminal-text',
              'transition-colors duration-200'
            )}
            aria-label={t('dataManagement.importPackage.cancelPreview')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-5">
          <label
            htmlFor="package-name-input"
            className={cn(
              'block mb-2 font-mono text-[12px] font-medium',
              'text-color-terminal-text-secondary'
            )}
          >
            {t('dataManagement.importPackage.nameModal.label')}
          </label>
          <input
            id="package-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className={cn(
              'w-full px-3 py-2',
              'font-mono text-[12px]',
              'rounded border border-color-terminal-border',
              'bg-color-terminal-bg text-color-terminal-text',
              'placeholder:text-color-terminal-text-muted',
              `focus:outline-none focus:border-[${ACCENT_COLORS.CYAN_400}] focus:ring-1 focus:ring-[${ACCENT_COLORS.CYAN_400}]/30`,
              'transition-all duration-200',
              isReserved && 'border-red-400 focus:border-red-400 focus:ring-red-400/30'
            )}
            placeholder={t('dataManagement.importPackage.nameModal.placeholder')}
          />
          {isReserved && (
            <p className="mt-2 font-mono text-[12px] text-red-400">
              {t('dataManagement.importPackage.nameModal.reservedError', { name: trimmed })}
            </p>
          )}
          {isReimport && (
            <p className="mt-2 font-mono text-[12px] text-amber-400">
              {t('dataManagement.importPackage.nameModal.reimportWarning')}
            </p>
          )}
          {!isReserved && !isReimport && (
            <p className={cn('mt-2 font-mono text-[12px]', 'text-color-terminal-text-muted')}>
              {t('dataManagement.importPackage.nameModal.hint')}
            </p>
          )}
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
            className={cn(
              'min-w-[80px] px-4 py-2',
              'font-mono text-[12px] font-semibold',
              'rounded border border-color-terminal-border',
              'bg-transparent text-color-terminal-text-secondary',
              'hover:border-color-terminal-text-muted hover:text-color-terminal-text',
              'transition-all duration-200'
            )}
          >
            {t('dataManagement.importPackage.nameModal.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className={cn(
              'min-w-[80px] px-4 py-2',
              'font-mono text-[12px] font-semibold',
              `rounded border border-[${ACCENT_COLORS.CYAN_400}]`,
              `bg-[${ACCENT_COLORS.CYAN_400}]/10 text-[${ACCENT_COLORS.CYAN_400}]`,
              `hover:bg-[${ACCENT_COLORS.CYAN_400}]/20`,
              'transition-all duration-200',
              !isValid && 'opacity-50 cursor-not-allowed'
            )}
          >
            {t('dataManagement.importPackage.nameModal.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
