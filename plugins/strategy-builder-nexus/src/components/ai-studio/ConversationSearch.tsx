/**
 * ConversationSearch Component (component19C)
 *
 * Search input for filtering conversations.
 *
 * @see TICKET_077_19_AI_STRATEGY_STUDIO_COMPONENTS.md - Component specification
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ConversationSearchProps {
  /** Current search value */
  value: string;
  /** Change handler */
  onChange: (query: string) => void;
  /** Clear handler */
  onClear: () => void;
  /** Placeholder text */
  placeholder?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const ConversationSearch: React.FC<ConversationSearchProps> = ({
  value,
  onChange,
  onClear,
  placeholder,
  disabled = false,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const displayPlaceholder = placeholder ?? t('aiStudio.searchConversations');
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  const handleClear = useCallback(() => {
    onClear();
  }, [onClear]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape' && value) {
        e.preventDefault();
        onClear();
      }
    },
    [value, onClear]
  );

  return (
    <div
      className={cn(
        'relative flex items-center',
        'mx-4 mb-3',
        className
      )}
    >
      {/* Search Icon */}
      <Search
        className={cn(
          'absolute left-3 w-4 h-4',
          'text-color-terminal-text-muted',
          'pointer-events-none'
        )}
      />

      {/* Input */}
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={displayPlaceholder}
        disabled={disabled}
        autoComplete="off"
        aria-label={t('aiStudio.searchConversationsLabel')}
        className={cn(
          // Layout
          'w-full',
          'pl-10 pr-8 py-2',
          // Appearance
          'bg-color-terminal-surface',
          'border border-color-terminal-border',
          'rounded-lg',
          'text-sm text-color-terminal-text',
          'placeholder:text-color-terminal-text-muted/70',
          // Focus
          'outline-none',
          'transition-all duration-200',
          'focus:border-color-terminal-accent-primary',
          'focus:ring-1 focus:ring-color-terminal-accent-primary/30',
          // Disabled
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      />

      {/* Clear Button */}
      {value && !disabled && (
        <button
          type="button"
          onClick={handleClear}
          className={cn(
            'absolute right-2',
            'p-1 rounded',
            'text-color-terminal-text-muted',
            'transition-colors duration-200',
            'hover:text-color-terminal-text',
            'hover:bg-color-terminal-surface-hover'
          )}
          aria-label={t('aiStudio.clearSearch')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export default ConversationSearch;
