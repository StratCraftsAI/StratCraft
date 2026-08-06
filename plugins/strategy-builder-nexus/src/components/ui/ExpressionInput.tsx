/**
 * ExpressionInput Component
 *
 * Logic expression input with help text and add button.
 * Used in Zone C of Strategy Studio pages.
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_078 - Input Theming and Portal Patterns
 */

import React, { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Info } from 'lucide-react';
import { cn } from '../../lib/utils';
import { THEME_COLORS } from '@shared/constants/colors';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ExpressionInputProps {
  /** Placeholder text for the input */
  placeholder?: string;
  /** Help text shown below the input */
  helpText?: string;
  /** Label for the add button */
  buttonLabel?: string;
  /** Minimum expression length for validation */
  minLength?: number;
  /** Callback when expression is added */
  onAdd: (expression: string) => void;
  /** Additional class names */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

// Default keys moved to i18n: ui.expressionInput.*
const DEFAULT_MIN_LENGTH = 3;
const ERROR_FLASH_DURATION = 2000;

// -----------------------------------------------------------------------------
// ExpressionInput Component
// -----------------------------------------------------------------------------

export const ExpressionInput: React.FC<ExpressionInputProps> = ({
  placeholder,
  helpText,
  buttonLabel,
  minLength = DEFAULT_MIN_LENGTH,
  onAdd,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const displayPlaceholder = placeholder ?? t('ui.expressionInput.placeholder');
  const displayHelpText = helpText ?? t('ui.expressionInput.helpText');
  const displayButtonLabel = buttonLabel ?? t('ui.expressionInput.buttonLabel');
  const [value, setValue] = useState('');
  const [hasError, setHasError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle input change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    if (hasError) {
      setHasError(false);
    }
  }, [hasError]);

  // Handle add button click
  const handleAdd = useCallback(() => {
    const trimmedValue = value.trim();

    // Validation
    if (!trimmedValue || trimmedValue.length < minLength) {
      setHasError(true);
      inputRef.current?.focus();

      // Clear error state after duration
      setTimeout(() => {
        setHasError(false);
      }, ERROR_FLASH_DURATION);

      return;
    }

    // Call onAdd callback
    onAdd(trimmedValue);

    // Clear input and refocus
    setValue('');
    inputRef.current?.focus();
  }, [value, minLength, onAdd]);

  // Handle Enter key press
  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  }, [handleAdd]);

  return (
    <div className={cn('expression-input space-y-3', className)}>
      {/* Input Field */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyPress={handleKeyPress}
        placeholder={displayPlaceholder}
        className={cn(
          'w-full px-4 py-3 text-xs terminal-mono',
          'border rounded',
          'focus:outline-none transition-colors duration-200',
          hasError
            ? 'border-red-500 focus:border-red-500'
            : 'focus:border-color-terminal-accent-gold/50'
        )}
        style={{
          backgroundColor: THEME_COLORS.INPUT_BG,
          borderColor: hasError ? undefined : THEME_COLORS.INPUT_BORDER,
          color: THEME_COLORS.INPUT_TEXT,
        }}
      />

      {/* Help Text */}
      <div className="flex items-start gap-2 text-[10px] text-color-terminal-text-muted">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>{displayHelpText}</span>
      </div>

      {/* Add Button */}
      <div className="w-1/2 ml-auto">
        <button
          onClick={handleAdd}
          className={cn(
            'w-full flex items-center justify-center gap-2',
            'px-4 py-3 text-xs font-bold',
            'border border-dashed border-color-terminal-border rounded-lg',
            'text-color-terminal-text-secondary',
            'hover:border-color-terminal-accent-teal/50 hover:text-color-terminal-accent-teal',
            'transition-all duration-200'
          )}
        >
          <Plus className="w-4 h-4" />
          {displayButtonLabel}
        </button>
      </div>
    </div>
  );
};

export default ExpressionInput;
