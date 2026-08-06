/**
 * SaveTemplateDialog Component (component25)
 *
 * Template save dialog with name input for persisting indicator configurations.
 * Used in Trader AI Entry pages for template management.
 *
 * @see TICKET_214 - Page 36 - Trader Mode AI Entry
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';
import type { RawIndicatorBlock } from './RawIndicatorSelector';

// -----------------------------------------------------------------------------
// Icons
// -----------------------------------------------------------------------------

const SaveIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface IndicatorTemplate {
  id: string;
  name: string;
  description?: string;
  indicators: RawIndicatorBlock[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveTemplateDialogProps {
  /** Dialog visibility */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
  /** Save callback with template data */
  onSave: (template: IndicatorTemplate) => void;
  /** Current indicators to save */
  indicators: RawIndicatorBlock[];
  /** Existing template names (for duplicate check) */
  existingNames?: string[];
  /** Additional class names */
  className?: string;
}

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

const generateTemplateId = (): string => `tpl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const SaveTemplateDialog: React.FC<SaveTemplateDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  indicators,
  existingNames = [],
}) => {
  const { t } = useTranslation('strategy-builder');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setError(null);
    }
  }, [isOpen]);

  // Validate name
  const validateName = useCallback((value: string): string | null => {
    if (!value.trim()) {
      return t('saveTemplate.nameRequired');
    }
    if (value.trim().length < 3) {
      return t('saveTemplate.nameTooShort');
    }
    if (existingNames.includes(value.trim())) {
      return t('saveTemplate.nameExists');
    }
    return null;
  }, [existingNames, t]);

  // Handle name change
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setName(value);
    setError(validateName(value));
  }, [validateName]);

  // Handle save
  const handleSave = useCallback(() => {
    const validationError = validateName(name);
    if (validationError) {
      setError(validationError);
      return;
    }

    const now = new Date().toISOString();
    const template: IndicatorTemplate = {
      id: generateTemplateId(),
      name: name.trim(),
      description: description.trim() || undefined,
      indicators: [...indicators],
      createdAt: now,
      updatedAt: now,
    };

    onSave(template);
  }, [name, description, indicators, validateName, onSave]);

  // Handle keyboard
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && !e.shiftKey && !error && name.trim()) {
        e.preventDefault();
        handleSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, handleSave, error, name]);

  if (!isOpen) {
    return null;
  }

  const isValid = name.trim().length >= 3 && !error;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[4px]"
      style={{ zIndex: Z_INDEX_MODAL }}
      onClick={onClose}
    >
      <div
        className="min-w-[400px] max-w-[500px] rounded-lg border border-color-terminal-border bg-color-terminal-surface shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-color-terminal-border border-l-[3px] border-l-color-terminal-accent-gold bg-color-terminal-panel rounded-t-lg">
          <SaveIcon className="w-[18px] h-[18px] text-color-terminal-accent-gold" />
          <span className="flex-1 font-mono text-xs font-semibold text-color-terminal-text">
            {t('saveTemplate.title')}
          </span>
          <button
            onClick={onClose}
            className="p-1 text-color-terminal-text-muted hover:text-color-terminal-text transition-colors"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-5 space-y-4">
          {/* Template Name */}
          <div className="space-y-2">
            <label className="block text-[11px] text-color-terminal-text-muted uppercase tracking-wider">
              {t('saveTemplate.templateName')} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              placeholder={t('saveTemplate.namePlaceholder')}
              className={cn(
                'w-full px-3 py-2 rounded border font-mono text-sm',
                'bg-color-terminal-panel text-color-terminal-text',
                'placeholder:text-color-terminal-text-muted/50',
                'focus:outline-none',
                error
                  ? 'border-red-500 focus:border-red-500'
                  : 'border-color-terminal-border focus:border-color-terminal-accent-teal'
              )}
              autoFocus
            />
            {error && (
              <p className="text-[10px] text-red-400">{error}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="block text-[11px] text-color-terminal-text-muted uppercase tracking-wider">
              {t('saveTemplate.description')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('saveTemplate.descriptionPlaceholder')}
              rows={3}
              className={cn(
                'w-full px-3 py-2 rounded border font-mono text-sm resize-none',
                'bg-color-terminal-panel text-color-terminal-text',
                'placeholder:text-color-terminal-text-muted/50',
                'focus:outline-none focus:border-color-terminal-accent-teal',
                'border-color-terminal-border'
              )}
            />
          </div>

          {/* Indicator Count */}
          <div className="pt-2 border-t border-color-terminal-border">
            <div className="text-[11px] text-color-terminal-text-muted">
              {t('saveTemplate.indicatorsToSave')} <span className="text-color-terminal-accent-teal font-bold">{indicators.length}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-4 py-4 border-t border-color-terminal-border">
          <button
            onClick={onClose}
            className="min-w-[80px] px-4 py-2 font-mono text-[11px] font-semibold rounded border border-color-terminal-border bg-transparent text-color-terminal-text-secondary hover:border-color-terminal-text-muted hover:text-color-terminal-text transition-all"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid}
            className={cn(
              'min-w-[120px] px-4 py-2 font-mono text-[11px] font-semibold rounded border transition-all',
              isValid
                ? 'border-color-terminal-accent-gold bg-color-terminal-accent-gold/20 text-color-terminal-accent-gold hover:bg-color-terminal-accent-gold/30'
                : 'border-color-terminal-border bg-color-terminal-surface text-color-terminal-text-muted cursor-not-allowed'
            )}
          >
            {t('saveTemplate.saveTemplate')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveTemplateDialog;
