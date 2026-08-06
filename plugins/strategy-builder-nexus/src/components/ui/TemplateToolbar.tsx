/**
 * TemplateToolbar Component (component19)
 *
 * Template management toolbar for indicator configurations.
 * Provides Load, Save, Clear, and Add functionality.
 *
 * @see TICKET_077_19 - Kronos AI Entry Components
 * @see TICKET_211 - Page 34 - Kronos AI Entry
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Save, Trash2, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface TemplateToolbarLabels {
  loadTemplate?: string;
  save?: string;
  clearAll?: string;
  add?: string;
}

export interface TemplateToolbarProps {
  /** Callback when Load Template clicked */
  onLoadTemplate: () => void;
  /** Callback when Save clicked */
  onSave: () => void;
  /** Callback when Clear All clicked */
  onClearAll: () => void;
  /** Callback when Add clicked */
  onAdd: () => void;
  /** Custom labels */
  labels?: TemplateToolbarLabels;
  /** Disable all buttons */
  disabled?: boolean;
  /** Additional class names */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_LABELS: Required<TemplateToolbarLabels> = {
  loadTemplate: 'Load Template',
  save: 'Save',
  clearAll: 'Clear All',
  add: '+ Add Indicator',
};

// -----------------------------------------------------------------------------
// Button Styles
// -----------------------------------------------------------------------------

const baseButtonStyles = cn(
  'inline-flex items-center gap-2',
  'px-4 py-2',
  'rounded-md',
  'text-[13px] font-medium',
  'cursor-pointer',
  'transition-all duration-200',
  'disabled:opacity-50 disabled:cursor-not-allowed'
);

const primaryButtonStyles = cn(
  baseButtonStyles,
  'bg-color-terminal-accent-teal',
  'border border-color-terminal-accent-teal',
  'text-color-terminal-bg',
  'hover:opacity-90'
);

const secondaryButtonStyles = cn(
  baseButtonStyles,
  'bg-transparent',
  'border border-color-terminal-border',
  'text-color-terminal-text-secondary',
  'hover:border-color-terminal-text-secondary hover:text-color-terminal-text'
);

const dangerButtonStyles = cn(
  baseButtonStyles,
  'bg-transparent',
  'border border-red-500',
  'text-red-500',
  'hover:bg-red-500/10'
);

const addButtonStyles = cn(
  baseButtonStyles,
  'ml-auto',
  'bg-color-terminal-accent-gold',
  'border border-color-terminal-accent-gold',
  'text-color-terminal-bg',
  'hover:opacity-90'
);

// -----------------------------------------------------------------------------
// TemplateToolbar Component
// -----------------------------------------------------------------------------

export const TemplateToolbar: React.FC<TemplateToolbarProps> = ({
  onLoadTemplate,
  onSave,
  onClearAll,
  onAdd,
  labels = {},
  disabled = false,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const mergedLabels = {
    loadTemplate: labels.loadTemplate || t('ui.templateToolbar.loadLabel'),
    save: labels.save || t('ui.templateToolbar.saveLabel'),
    clearAll: labels.clearAll || t('ui.templateToolbar.clearLabel'),
    add: labels.add || t('ui.templateToolbar.addLabel'),
  };

  const handleLoadTemplate = useCallback(() => {
    if (!disabled) onLoadTemplate();
  }, [disabled, onLoadTemplate]);

  const handleSave = useCallback(() => {
    if (!disabled) onSave();
  }, [disabled, onSave]);

  const handleClearAll = useCallback(() => {
    if (!disabled) onClearAll();
  }, [disabled, onClearAll]);

  const handleAdd = useCallback(() => {
    if (!disabled) onAdd();
  }, [disabled, onAdd]);

  return (
    <div
      className={cn(
        'template-toolbar',
        'flex items-center gap-3',
        'mb-5 p-4',
        'bg-color-terminal-surface',
        'border border-color-terminal-border',
        'rounded-lg',
        className
      )}
    >
      {/* Load Template - Primary */}
      <button
        type="button"
        onClick={handleLoadTemplate}
        disabled={disabled}
        className={primaryButtonStyles}
      >
        <FolderOpen className="w-4 h-4" />
        {mergedLabels.loadTemplate}
      </button>

      {/* Save - Secondary */}
      <button
        type="button"
        onClick={handleSave}
        disabled={disabled}
        className={secondaryButtonStyles}
      >
        <Save className="w-4 h-4" />
        {mergedLabels.save}
      </button>

      {/* Clear All - Danger */}
      <button
        type="button"
        onClick={handleClearAll}
        disabled={disabled}
        className={dangerButtonStyles}
      >
        <Trash2 className="w-4 h-4" />
        {mergedLabels.clearAll}
      </button>

      {/* Add Indicator - Gold, pushed to right */}
      <button
        type="button"
        onClick={handleAdd}
        disabled={disabled}
        className={addButtonStyles}
      >
        <Plus className="w-4 h-4" />
        {mergedLabels.add}
      </button>
    </div>
  );
};

export default TemplateToolbar;
