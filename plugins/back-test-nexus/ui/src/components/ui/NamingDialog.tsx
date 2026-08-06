/**
 * NamingDialog Component (component10)
 *
 * Reusable naming dialog for Builder, Backtest, and Export contexts.
 * Shows suggested name and allows custom input.
 *
 * @see TICKET_163 - Naming Dialog Design
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_264 - Export to Quant Lab context
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { INTERVAL_1d } from '@StratCraft/types';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';

// -----------------------------------------------------------------------------
// Icons
// -----------------------------------------------------------------------------

const EditIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type NamingDialogContext = 'builder' | 'backtest' | 'export';

export interface NamingDialogContextData {
  // Backtest context
  symbol?: string;
  timeframe?: string;
  // Builder context
  algorithm?: string;
  // Export context (TICKET_264)
  workflowName?: string;   // Original workflow/backtest name
  analysisName?: string;   // Analysis algorithm name
  entryName?: string;      // Entry algorithm name
}

export interface NamingDialogProps {
  /** Dialog visibility */
  visible: boolean;
  /** Context determines default prefix and suggested name format */
  context: NamingDialogContext;
  /** Data used to generate suggested name */
  contextData: NamingDialogContextData;
  /** Called when user confirms with final name */
  onConfirm: (finalName: string) => void;
  /** Called when user cancels */
  onCancel: () => void;
}

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

/**
 * Generate suggested name based on context
 */
export function generateSuggestedName(
  context: NamingDialogContext,
  contextData: NamingDialogContextData
): string {
  if (context === 'builder') {
    const algorithm = contextData.algorithm || 'Strategy';
    return `Builder_${algorithm}`;
  } else if (context === 'export') {
    // TICKET_264: Export context
    if (contextData.workflowName) {
      return `Export_${contextData.workflowName}`;
    }
    const analysis = contextData.analysisName || 'Analysis';
    const entry = contextData.entryName || 'Entry';
    return `Export_${analysis}_${entry}`;
  } else {
    const symbol = contextData.symbol || 'Unknown';
    const timeframe = contextData.timeframe || INTERVAL_1d;
    return `Backtest_${symbol}_${timeframe}`;
  }
}

/**
 * Generate final name with timestamp
 */
export function generateFinalName(baseName: string): string {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  return `${baseName}_${timestamp}`;
}

/**
 * Get dialog title based on context
 */
function getDialogTitle(context: NamingDialogContext, t: (key: string) => string): string {
  switch (context) {
    case 'builder':
      return t('namingDialog.titleBuilder');
    case 'export':
      return t('namingDialog.titleExport');
    default:
      return t('namingDialog.titleBacktest');
  }
}

/**
 * Get confirm button text based on context
 */
function getConfirmButtonText(context: NamingDialogContext, t: (key: string) => string): string {
  switch (context) {
    case 'builder':
      return t('namingDialog.confirmBuilder');
    case 'export':
      return t('namingDialog.confirmExport');
    default:
      return t('namingDialog.confirmBacktest');
  }
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const NamingDialog: React.FC<NamingDialogProps> = ({
  visible,
  context,
  contextData,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation('backtest');
  const [customName, setCustomName] = useState('');
  const [useCustom, setUseCustom] = useState(false);

  // Generate suggested name
  const suggestedName = generateSuggestedName(context, contextData);

  // Current base name (custom or suggested)
  const currentBaseName = useCustom && customName.trim() ? customName.trim() : suggestedName;

  // Preview of final name
  const finalNamePreview = generateFinalName(currentBaseName);

  // Reset state when dialog opens
  useEffect(() => {
    if (visible) {
      setCustomName('');
      setUseCustom(false);
    }
  }, [visible]);

  // Handle keyboard
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleConfirm();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onCancel, currentBaseName]);

  // Handle use suggested
  const handleUseSuggested = useCallback(() => {
    setUseCustom(false);
    setCustomName('');
  }, []);

  // Handle custom input change
  const handleCustomChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomName(e.target.value);
    setUseCustom(true);
  }, []);

  // Handle confirm
  const handleConfirm = useCallback(() => {
    const finalName = generateFinalName(currentBaseName);
    onConfirm(finalName);
  }, [currentBaseName, onConfirm]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[4px]"
      style={{ zIndex: Z_INDEX_MODAL }}
      onClick={onCancel}
    >
      <div
        className="min-w-[400px] max-w-[500px] rounded-lg border border-color-terminal-border bg-color-terminal-surface shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-color-terminal-border border-l-[3px] border-l-color-terminal-accent-teal bg-color-terminal-panel rounded-t-lg">
          <EditIcon className="w-[18px] h-[18px] text-color-terminal-accent-teal" />
          <span className="flex-1 font-mono text-xs font-semibold text-color-terminal-text uppercase tracking-wider">
            {getDialogTitle(context, t)}
          </span>
          <button
            onClick={onCancel}
            className="p-1 text-color-terminal-text-muted hover:text-color-terminal-text transition-colors"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-5 space-y-4">
          {/* Suggested Name Section */}
          <div className="space-y-2">
            <label className="block text-[11px] text-color-terminal-text-muted uppercase tracking-wider">
              {t('namingDialog.suggestedName')}
            </label>
            <div className="flex items-center gap-2">
              <div className={cn(
                "flex-1 px-3 py-2 rounded border font-mono text-sm",
                !useCustom
                  ? "border-color-terminal-accent-teal bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal"
                  : "border-color-terminal-border bg-color-terminal-panel text-color-terminal-text-secondary"
              )}>
                {suggestedName}
              </div>
              <button
                onClick={handleUseSuggested}
                className={cn(
                  "flex items-center gap-1 px-3 py-2 text-xs font-bold uppercase tracking-wider rounded border transition-all",
                  !useCustom
                    ? "border-color-terminal-accent-teal bg-color-terminal-accent-teal/20 text-color-terminal-accent-teal"
                    : "border-color-terminal-border bg-transparent text-color-terminal-text-muted hover:border-color-terminal-accent-teal hover:text-color-terminal-accent-teal"
                )}
              >
                <CheckIcon className="w-3 h-3" />
                {t('namingDialog.useThis')}
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 text-[10px] text-color-terminal-text-muted">
            <div className="flex-1 border-t border-dashed border-color-terminal-border" />
            <span>{t('namingDialog.or')}</span>
            <div className="flex-1 border-t border-dashed border-color-terminal-border" />
          </div>

          {/* Custom Name Section */}
          <div className="space-y-2">
            <label className="block text-[11px] text-color-terminal-text-muted uppercase tracking-wider">
              {t('namingDialog.customName')}
            </label>
            <input
              type="text"
              value={customName}
              onChange={handleCustomChange}
              placeholder={t('namingDialog.placeholder')}
              className={cn(
                "w-full px-3 py-2 rounded border font-mono text-sm",
                "bg-color-terminal-panel text-color-terminal-text",
                "placeholder:text-color-terminal-text-muted/50",
                "focus:outline-none focus:border-color-terminal-accent-teal",
                useCustom && customName
                  ? "border-color-terminal-accent-teal"
                  : "border-color-terminal-border"
              )}
              autoFocus
            />
          </div>

          {/* Final Name Preview */}
          <div className="pt-2 border-t border-color-terminal-border">
            <div className="text-[11px] text-color-terminal-text-muted">
              {t('namingDialog.finalName')} <span className="text-color-terminal-text-secondary font-mono">{finalNamePreview}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-center gap-3 px-4 py-4 border-t border-color-terminal-border">
          <button
            onClick={onCancel}
            className="min-w-[80px] px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider rounded border border-color-terminal-border bg-transparent text-color-terminal-text-secondary hover:border-color-terminal-text-muted hover:text-color-terminal-text transition-all"
          >
            {t('namingDialog.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            className="min-w-[120px] px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider rounded border border-color-terminal-accent-gold bg-color-terminal-accent-gold/20 text-color-terminal-accent-gold hover:bg-color-terminal-accent-gold/30 transition-all"
          >
            {getConfirmButtonText(context, t)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NamingDialog;
