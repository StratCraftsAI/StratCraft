/**
 * ActionButtons Component (component19K)
 *
 * Action button group for strategy operations (Generate Code).
 *
 * @see TICKET_077_19_AI_STRATEGY_STUDIO_COMPONENTS.md - Component specification
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React, { useCallback } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ActionId = 'generate_code';

export interface ActionButton {
  /** Action identifier */
  id: ActionId;
  /** Button label */
  label: string;
  /** Disabled state */
  disabled?: boolean;
  /** Loading state */
  loading?: boolean;
}

export interface ActionButtonsProps {
  /** List of actions to display */
  actions: ActionButton[];
  /** Action click handler */
  onAction: (actionId: ActionId) => void;
  /** Global disabled state */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const ACTION_CONFIG: Record<ActionId, {
  icon: React.FC<{ className?: string }>;
  gradientClass: string;
  hoverGradientClass: string;
  shadowClass: string;
}> = {
  generate_code: {
    icon: Sparkles,
    gradientClass: 'bg-gradient-to-r from-indigo-500 to-purple-600',
    hoverGradientClass: 'hover:from-indigo-600 hover:to-purple-700',
    shadowClass: 'shadow-indigo-500/40',
  },
};

// -----------------------------------------------------------------------------
// Loading Spinner Sub-component
// -----------------------------------------------------------------------------

const LoadingSpinner: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={cn('animate-spin', className)}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  actions,
  onAction,
  disabled = false,
  className,
}) => {
  const handleClick = useCallback(
    (actionId: ActionId) => {
      if (!disabled) {
        onAction(actionId);
      }
    },
    [disabled, onAction]
  );

  if (actions.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex flex-wrap gap-3',
        'py-3',
        'animate-in slide-in-from-bottom-2 duration-300',
        className
      )}
    >
      {actions.map((action) => {
        const config = ACTION_CONFIG[action.id];
        const Icon = config.icon;
        const isDisabled = disabled || action.disabled;
        const isLoading = action.loading;

        return (
          <button
            key={action.id}
            type="button"
            onClick={() => handleClick(action.id)}
            disabled={isDisabled || isLoading}
            className={cn(
              // Layout
              'flex items-center justify-center gap-2',
              'px-6 py-3',
              'min-w-[160px]',
              // Appearance
              'text-white text-sm font-semibold',
              'rounded-lg',
              config.gradientClass,
              // Shadow
              'shadow-lg',
              config.shadowClass,
              // Interaction
              'transition-all duration-200',
              config.hoverGradientClass,
              'hover:-translate-y-0.5',
              'hover:shadow-xl',
              'active:translate-y-0',
              'active:shadow-lg',
              // Disabled state
              'disabled:opacity-50',
              'disabled:cursor-not-allowed',
              'disabled:hover:translate-y-0',
              'disabled:hover:shadow-lg'
            )}
            aria-label={action.label}
          >
            {isLoading ? (
              <LoadingSpinner className="w-4 h-4" />
            ) : (
              <Icon className="w-4 h-4" />
            )}
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ActionButtons;
