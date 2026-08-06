/**
 * PromptTextarea Component (component24)
 *
 * Multi-line text input for analysis prompt configuration.
 * Used for LLM prompt input in AI-powered strategy generation pages.
 *
 * @see TICKET_077_19 - Kronos AI Entry Components
 * @see TICKET_211 - Page 34 - Kronos AI Entry
 */

import React, { useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface PromptTextareaProps {
  /** Component title */
  title?: string;
  /** Current prompt value */
  value: string;
  /** Callback when value changes */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Number of rows */
  rows?: number;
  /** Disabled state */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_TITLE = 'PROMPT';
const DEFAULT_ROWS = 12;

// -----------------------------------------------------------------------------
// PromptTextarea Component
// -----------------------------------------------------------------------------

export const PromptTextarea: React.FC<PromptTextareaProps> = ({
  title,
  value,
  onChange,
  placeholder,
  rows = DEFAULT_ROWS,
  disabled = false,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const componentTitle = title || t('ui.promptTextarea.title');
  const placeholderText = placeholder || t('ui.promptTextarea.placeholder');
  const textareaId = useId();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  return (
    <div
      className={cn(
        'prompt-textarea',
        'mb-6 p-5',
        'bg-color-terminal-surface',
        'rounded-lg',
        'border border-color-terminal-border',
        className
      )}
    >
      {/* Title with Icon */}
      <label
        htmlFor={textareaId}
        className="flex items-center gap-2 text-sm font-bold terminal-mono uppercase tracking-widest text-color-terminal-accent-gold mb-4"
      >
        <FileText className="w-5 h-5 text-color-terminal-accent-teal" />
        {componentTitle}
      </label>

      {/* Textarea */}
      <textarea
        id={textareaId}
        value={value}
        onChange={handleChange}
        placeholder={placeholderText}
        rows={rows}
        disabled={disabled}
        className={cn(
          'w-full',
          'px-4 py-3',
          'font-mono text-[13px] leading-relaxed',
          'text-color-terminal-text',
          'bg-color-terminal-bg',
          'border border-color-terminal-border rounded-md',
          'resize-y',
          'transition-colors duration-200',
          'focus:outline-none focus:border-color-terminal-accent-teal',
          'placeholder:text-color-terminal-text-muted',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      />
    </div>
  );
};

export default PromptTextarea;
