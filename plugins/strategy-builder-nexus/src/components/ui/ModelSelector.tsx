/**
 * ModelSelector Component
 *
 * Radio card selection component for AI model options
 * with visual model information display.
 *
 * @see TICKET_077_12 - ModelSelector Specification
 * @see TICKET_077 - StratCraftsAI UI Component Library (component12)
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ModelOption {
  /** Unique model identifier */
  id: string;
  /** Display name */
  name: string;
  /** Parameter count display (e.g., "4.1M", "24.7M") */
  params: string;
  /** Maximum context length */
  maxContext: number;
  /** Show recommended badge */
  recommended?: boolean;
  /** Optional description */
  description?: string;
}

export interface ModelSelectorProps {
  /** Available model options */
  models: ModelOption[];
  /** Currently selected model ID */
  selectedModel: string;
  /** Selection change callback */
  onSelect: (modelId: string) => void;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  selectedModel,
  onSelect,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const title = t('modelSelector.title');
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Title */}
      <h3 className="font-mono text-sm font-bold text-color-terminal-accent-gold">
        {title}
      </h3>

      {/* Model Cards */}
      <div
        className="flex gap-3"
        role="radiogroup"
        aria-label={title}
      >
        {models.map((model) => {
          const isSelected = model.id === selectedModel;

          return (
            <button
              key={model.id}
              type="button"
              onClick={() => onSelect(model.id)}
              role="radio"
              aria-checked={isSelected}
              className={cn(
                'relative flex flex-col items-center',
                'flex-1 px-6 py-4',
                'border-2 rounded-lg',
                'transition-all duration-200',
                'cursor-pointer',
                isSelected
                  ? 'border-color-terminal-accent-gold bg-color-terminal-accent-gold/5'
                  : 'border-color-terminal-border bg-color-terminal-surface',
                !isSelected && 'hover:border-color-terminal-accent-teal'
              )}
            >
              {/* Recommended Badge */}
              {model.recommended && (
                <span
                  className={cn(
                    'absolute -top-2 -right-2',
                    'px-2 py-0.5',
                    'text-[12px] font-bold uppercase tracking-wide',
                    'bg-color-terminal-accent-teal text-color-terminal-bg',
                    'rounded'
                  )}
                >
                  {t('modelSelector.recommended')}
                </span>
              )}

              {/* Model Name */}
              <span
                className={cn(
                  'text-sm font-bold',
                  isSelected
                    ? 'text-color-terminal-accent-gold'
                    : 'text-color-terminal-text'
                )}
              >
                {model.name}
              </span>

              {/* Parameter Count */}
              <span className="text-xs text-color-terminal-text-secondary mt-1">
                {model.params}
              </span>

              {/* Context Length */}
              <span className="text-[11px] text-color-terminal-text-muted mt-2">
                {t('modelSelector.context')} {model.maxContext}
              </span>

              {/* Hidden radio for accessibility */}
              <input
                type="radio"
                name="model-selector"
                value={model.id}
                checked={isSelected}
                onChange={() => onSelect(model.id)}
                className="sr-only"
                aria-label={t('modelSelector.modelAria', { name: model.name, params: model.params, maxContext: model.maxContext })}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ModelSelector;
