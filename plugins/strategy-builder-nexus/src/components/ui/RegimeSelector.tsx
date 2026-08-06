/**
 * RegimeSelector Component (component2)
 *
 * Market regime selector with 5 icon cards.
 * Includes Bespoke input area when "bespoke" mode is selected.
 * Used in Zone C of Strategy Studio pages.
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_078 - Input Theming and Portal Patterns
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, ArrowLeftRight, Minus, Activity, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import { THEME_COLORS } from '@shared/constants/colors';
import { REGIME_OPTIONS } from '@StratCraft/types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface RegimeOption {
  key: string;
  label: string;
  icon: React.ElementType;
}

export interface BespokeData {
  name: string;
  notes: string;
}

export interface RegimeSelectorProps {
  /** Component title */
  title?: string;
  /** Currently selected regime key */
  selectedRegime: string;
  /** Callback when regime is selected */
  onSelect: (regime: string) => void;
  /** Custom options (overrides default) */
  options?: RegimeOption[];
  /** Bespoke mode data */
  bespokeData?: BespokeData;
  /** Callback when bespoke data changes */
  onBespokeChange?: (data: BespokeData) => void;
  /** Additional class names */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const REGIME_ICONS: Record<string, React.ElementType> = {
  trend: TrendingUp,
  range: ArrowLeftRight,
  consolidation: Minus,
  oscillation: Activity,
  bespoke: Pencil,
};

const DEFAULT_OPTIONS: RegimeOption[] = REGIME_OPTIONS.map((option) => ({
  key: option.id,
  label: option.displayName,
  icon: REGIME_ICONS[option.id],
}));

// -----------------------------------------------------------------------------
// RegimeSelector Component
// -----------------------------------------------------------------------------

export const RegimeSelector: React.FC<RegimeSelectorProps> = ({
  title,
  selectedRegime,
  onSelect,
  options = DEFAULT_OPTIONS,
  bespokeData = { name: '', notes: '' },
  onBespokeChange,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  
  const handleSelect = useCallback((key: string) => {
    onSelect(key);
  }, [onSelect]);

  const handleBespokeNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onBespokeChange?.({ ...bespokeData, name: e.target.value });
  }, [bespokeData, onBespokeChange]);

  const handleBespokeNotesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onBespokeChange?.({ ...bespokeData, notes: e.target.value });
  }, [bespokeData, onBespokeChange]);

  const isBespokeMode = selectedRegime === 'bespoke';

  return (
    <div className={cn('regime-selector', className)}>
      {/* Regime Cards - 5 equal columns spanning full width */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}
      >
        {options.map((option) => {
          const Icon = option.icon;
          const isSelected = selectedRegime === option.key;

          return (
            <button
              key={option.key}
              onClick={() => handleSelect(option.key)}
              className={cn(
                'flex flex-col items-center justify-center',
                'py-4',
                'border rounded-lg',
                'bg-color-terminal-surface',
                'transition-all duration-200',
                'cursor-pointer',
                isSelected
                  ? 'border-color-terminal-accent-gold border-2'
                  : 'border-color-terminal-border hover:border-color-terminal-accent-teal/50'
              )}
            >
              {/* Icon */}
              <div
                className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center mb-2',
                  isSelected
                    ? 'bg-color-terminal-accent-gold/20'
                    : 'bg-white/5'
                )}
              >
                <Icon
                  className={cn(
                    'w-5 h-5',
                    isSelected
                      ? 'text-color-terminal-accent-gold'
                      : 'text-color-terminal-text-secondary'
                  )}
                />
              </div>

              {/* Label */}
              <span
                className={cn(
                  'text-xs font-bold capitalize',
                  isSelected
                    ? 'text-color-terminal-text'
                    : 'text-color-terminal-text-secondary'
                )}
              >
                {t(`ui.regimeSelectorLabels.${option.key}`)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bespoke Input Area - shown when bespoke mode is selected */}
      {isBespokeMode && (
        <div className="mt-6 space-y-4 p-4 border border-color-terminal-border rounded-lg bg-color-terminal-surface/50">
          {/* Bespoke Name Input */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
              {t('ui.regimeSelectorLabels.bespokeName')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={bespokeData.name}
              onChange={handleBespokeNameChange}
              placeholder={t('ui.regimeSelectorLabels.bespokeNamePlaceholder')}
              className="w-full px-4 py-3 text-xs terminal-mono border rounded focus:outline-none"
              style={{
                backgroundColor: THEME_COLORS.INPUT_BG,
                borderColor: THEME_COLORS.INPUT_BORDER,
                color: THEME_COLORS.INPUT_TEXT,
              }}
            />
          </div>

          {/* Bespoke Notes Input */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
              {t('ui.regimeSelectorLabels.notes')} <span className="text-color-terminal-text-muted">{t('ui.regimeSelectorLabels.notesOptional')}</span>
            </label>
            <input
              type="text"
              value={bespokeData.notes}
              onChange={handleBespokeNotesChange}
              placeholder={t('ui.regimeSelectorLabels.notesPlaceholder')}
              className="w-full px-4 py-3 text-xs terminal-mono border rounded focus:outline-none"
              style={{
                backgroundColor: THEME_COLORS.INPUT_BG,
                borderColor: THEME_COLORS.INPUT_BORDER,
                color: THEME_COLORS.INPUT_TEXT,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default RegimeSelector;
