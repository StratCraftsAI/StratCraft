/**
 * TraderPresetSelector Component (component21)
 *
 * Quick preset mode selector for trading strategy configuration.
 * Displays 4 mode cards in a horizontal grid: Baseline, Monk, Warrior, Bespoke.
 * Used in Zone C of Kronos AI Entry page.
 *
 * @see TICKET_077_19 - Kronos AI Entry Components
 * @see TICKET_211 - Page 34 - Kronos AI Entry
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Scale, User, Triangle, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type TraderPresetMode = 'baseline' | 'monk' | 'warrior' | 'bespoke';

export interface TraderPresetOption {
  key: TraderPresetMode;
  labelKey: string;
  descriptionKey: string;
  icon: React.ElementType;
}

export interface TraderPresetSelectorProps {
  /** Currently selected preset */
  selectedPreset: TraderPresetMode;
  /** Callback when preset selected */
  onSelect: (preset: TraderPresetMode) => void;
  /** Override default options */
  options?: TraderPresetOption[];
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_OPTIONS: TraderPresetOption[] = [
  {
    key: 'baseline',
    labelKey: 'traderPresets.baseline',
    descriptionKey: 'traderPresets.baselineDesc',
    icon: Scale,
  },
  {
    key: 'monk',
    labelKey: 'traderPresets.monk',
    descriptionKey: 'traderPresets.monkDesc',
    icon: User,
  },
  {
    key: 'warrior',
    labelKey: 'traderPresets.warrior',
    descriptionKey: 'traderPresets.warriorDesc',
    icon: Triangle,
  },
  {
    key: 'bespoke',
    labelKey: 'traderPresets.bespoke',
    descriptionKey: 'traderPresets.bespokeDesc',
    icon: Pencil,
  },
];

// -----------------------------------------------------------------------------
// TraderPresetSelector Component
// -----------------------------------------------------------------------------

export const TraderPresetSelector: React.FC<TraderPresetSelectorProps> = ({
  selectedPreset,
  onSelect,
  options = DEFAULT_OPTIONS,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const handleSelect = useCallback(
    (key: TraderPresetMode) => {
      onSelect(key);
    },
    [onSelect]
  );

  return (
    <div
      className={cn(
        'trader-preset-selector',
        'mb-8 p-6',
        'bg-color-terminal-surface',
        'rounded-xl',
        'border border-color-terminal-border',
        className
      )}
    >
      {/* Title - follows Unified Component Title Format */}
      <h2 className="flex items-center gap-2 text-sm font-bold terminal-mono text-color-terminal-accent-gold mb-2">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-color-terminal-accent-teal"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v6m0 6v6" />
          <path d="m4.93 4.93 4.24 4.24m5.66 5.66 4.24 4.24" />
          <path d="M1 12h6m6 0h6" />
          <path d="m4.93 19.07 4.24-4.24m5.66-5.66 4.24-4.24" />
        </svg>
        {t('traderPresets.title')}
      </h2>

      {/* Description */}
      <p className="text-sm text-color-terminal-text-secondary mb-5 leading-relaxed">
        {t('traderPresets.subtitle')}
      </p>

      {/* Preset Cards Grid - 4 columns on desktop, 2 on tablet, 1 on mobile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {options.map((option) => {
          const Icon = option.icon;
          const isSelected = selectedPreset === option.key;

          return (
            <button
              key={option.key}
              onClick={() => handleSelect(option.key)}
              className={cn(
                'trader-preset-card',
                'flex flex-col items-center gap-2',
                'py-4 px-4',
                'rounded-xl',
                'border-2',
                'bg-color-terminal-surface',
                'transition-all duration-300',
                'cursor-pointer',
                'relative overflow-hidden',
                isSelected
                  ? 'border-color-terminal-accent-teal'
                  : 'border-color-terminal-border hover:border-color-terminal-accent-teal/50 hover:-translate-y-0.5'
              )}
              style={
                isSelected
                  ? { background: 'rgba(100, 255, 218, 0.05)' }
                  : undefined
              }
            >
              {/* Icon Container */}
              <div
                className={cn(
                  'w-12 h-12 rounded-full flex items-center justify-center',
                  'transition-all duration-300',
                  isSelected
                    ? 'bg-color-terminal-accent-teal/10'
                    : 'bg-white/5'
                )}
              >
                <Icon
                  className={cn(
                    'w-6 h-6',
                    'transition-colors duration-300',
                    isSelected
                      ? 'text-color-terminal-accent-teal'
                      : 'text-color-terminal-text-muted'
                  )}
                />
              </div>

              {/* Label */}
              <span
                className={cn(
                  'text-base font-semibold',
                  'transition-colors duration-300',
                  isSelected
                    ? 'text-color-terminal-text'
                    : 'text-color-terminal-text-muted'
                )}
              >
                {t(option.labelKey)}
              </span>

              {/* Description */}
              <span
                className={cn(
                  'text-xs text-center leading-relaxed',
                  'transition-colors duration-300',
                  isSelected
                    ? 'text-color-terminal-text-secondary'
                    : 'text-color-terminal-text-muted'
                )}
              >
                {t(option.descriptionKey)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TraderPresetSelector;
