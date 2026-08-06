/**
 * PresetButtonGroup Component
 *
 * Horizontal button group for quick preset selection.
 * Used for model configuration presets and filter presets.
 *
 * @see TICKET_077_13 - PresetButtonGroup Specification
 * @see TICKET_077 - StratCraftsAI UI Component Library (component13)
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface PresetOption {
  /** Unique preset identifier */
  id: string;
  /** Display label */
  label: string;
  /** Optional icon (React node or emoji string) */
  icon?: React.ReactNode | string;
  /** Optional description (shown in full variant) */
  description?: string;
}

export type PresetButtonVariant = 'compact' | 'full';

export interface PresetButtonGroupProps {
  /** Available presets */
  presets: PresetOption[];
  /** Currently active preset ID */
  activePreset: string;
  /** Selection change callback */
  onSelect: (presetId: string) => void;
  /** Display variant (default: 'full') */
  variant?: PresetButtonVariant;
  /**
   * TICKET_077_27: explicit aria-label override. When omitted, falls back to
   * the `strategy-builder` i18n key. Lets the component be reused from plugins
   * that do not load the strategy-builder translation namespace (e.g.
   * quant-lab-nexus) without surfacing a raw i18n key as the group label.
   */
  ariaLabel?: string;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const PresetButtonGroup: React.FC<PresetButtonGroupProps> = ({
  presets,
  activePreset,
  onSelect,
  variant = 'full',
  ariaLabel,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const resolvedAriaLabel = ariaLabel ?? t('ui.presetButtonGroup.ariaLabel');

  // Render icon (handles both React nodes and emoji strings)
  const renderIcon = (icon: React.ReactNode | string | undefined) => {
    if (!icon) return null;

    // If it's a string (emoji), render as text
    if (typeof icon === 'string') {
      return <span className="preset-btn__emoji">{icon}</span>;
    }

    // Otherwise, render as React node
    return <span className="preset-btn__icon-wrapper">{icon}</span>;
  };

  if (variant === 'compact') {
    return (
      <div
        className={cn('flex gap-2 flex-wrap', className)}
        role="radiogroup"
        aria-label={resolvedAriaLabel}
      >
        {presets.map((preset) => {
          const isActive = preset.id === activePreset;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelect(preset.id)}
              role="radio"
              aria-checked={isActive}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2',
                'border rounded-full',
                'text-xs font-medium',
                'transition-all duration-200',
                isActive
                  ? 'bg-color-terminal-accent-teal border-color-terminal-accent-teal text-color-terminal-bg'
                  : 'bg-transparent border-color-terminal-border text-color-terminal-text-secondary',
                !isActive && 'hover:border-color-terminal-accent-teal hover:text-color-terminal-accent-teal'
              )}
            >
              {renderIcon(preset.icon)}
              <span>{preset.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // Full variant
  return (
    <div
      className={cn('flex gap-2 w-full', className)}
      role="radiogroup"
      aria-label={resolvedAriaLabel}
    >
      {presets.map((preset) => {
        const isActive = preset.id === activePreset;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelect(preset.id)}
            role="radio"
            aria-checked={isActive}
            className={cn(
              'flex flex-col items-center flex-1',
              'px-4 py-3 min-w-0',
              'border rounded-lg',
              'transition-all duration-200',
              isActive
                ? 'border-color-terminal-accent-gold bg-color-terminal-accent-gold/10'
                : 'border-color-terminal-border bg-transparent',
              !isActive && 'hover:border-color-terminal-accent-teal'
            )}
          >
            {/* Icon */}
            {preset.icon && (
              <div
                className={cn(
                  'text-xl mb-1',
                  isActive
                    ? 'text-color-terminal-accent-gold'
                    : 'text-color-terminal-text-secondary'
                )}
              >
                {renderIcon(preset.icon)}
              </div>
            )}

            {/* Label */}
            <span
              className={cn(
                'text-xs font-bold',
                isActive
                  ? 'text-color-terminal-accent-gold'
                  : 'text-color-terminal-text'
              )}
            >
              {preset.label}
            </span>

            {/* Description */}
            {preset.description && (
              <span className="text-[10px] text-color-terminal-text-muted mt-0.5">
                {preset.description}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default PresetButtonGroup;
