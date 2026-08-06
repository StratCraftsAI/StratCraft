/**
 * NewChatButton Component (component19B)
 *
 * Button to create a new chat conversation.
 *
 * @see TICKET_077_19_AI_STRATEGY_STUDIO_COMPONENTS.md - Component specification
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface NewChatButtonProps {
  /** Click handler */
  onClick: () => void;
  /** Disabled state */
  disabled?: boolean;
  /** Button label */
  label?: string;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const NewChatButton: React.FC<NewChatButtonProps> = ({
  onClick,
  disabled = false,
  label,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const displayLabel = label ?? t('aiStudio.newChat');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // Layout
        'w-full flex items-center justify-center gap-2',
        'px-4 py-3 m-4',
        // Appearance
        'bg-color-terminal-accent-primary text-color-terminal-bg',
        'rounded-lg',
        'text-sm font-medium',
        // Interaction
        'cursor-pointer',
        'transition-all duration-200',
        'hover:bg-color-terminal-accent-primary/90',
        'hover:shadow-lg hover:shadow-color-terminal-accent-primary/20',
        'active:scale-[0.98]',
        // Disabled state
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'disabled:hover:bg-color-terminal-accent-primary',
        'disabled:hover:shadow-none',
        'disabled:active:scale-100',
        className
      )}
      aria-label={displayLabel}
    >
      <Plus className="w-4 h-4" />
      <span>{displayLabel}</span>
    </button>
  );
};

export default NewChatButton;
