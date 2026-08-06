/**
 * SignalFilterPanel Component
 *
 * Complete signal filter panel for prediction quality control.
 * Composite component combining ToggleSwitch, SliderInputGroup,
 * PresetButtonGroup, and CollapsiblePanel.
 *
 * @see TICKET_077_16 - SignalFilterPanel Specification
 * @see TICKET_077 - StratCraftsAI UI Component Library (component16)
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { SliderInputGroup } from './SliderInputGroup';
import { ToggleSwitch } from './ToggleSwitch';
import { PresetButtonGroup, type PresetOption } from './PresetButtonGroup';
import { CollapsiblePanel } from './CollapsiblePanel';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type DirectionMode = 'both' | 'buy_only' | 'sell_only';
export type CombinationLogic = 'AND' | 'OR';
export type FrequencyLevel = 'high' | 'moderate' | 'low';

const FREQUENCY_I18N_KEY: Record<FrequencyLevel, 'frequencyHigh' | 'frequencyModerate' | 'frequencyLow'> = {
  high: 'frequencyHigh',
  moderate: 'frequencyModerate',
  low: 'frequencyLow',
};

export interface SignalFilterConfig {
  confidence: {
    enabled: boolean;
    value: number; // 0-99 percentage
  };
  expectedReturn: {
    enabled: boolean;
    value: number; // 0.1-50 percentage
  };
  direction: {
    enabled: boolean;
    mode: DirectionMode;
  };
  magnitude: {
    enabled: boolean;
    value: number; // 0-10 percentage
  };
  consistency: {
    enabled: boolean;
    value: number; // 50-100 percentage
  };
  combinationLogic: CombinationLogic;
}

export interface SignalFilterPanelProps {
  /** Current filter configuration */
  config: SignalFilterConfig;
  /** Configuration change callback */
  onChange: (config: SignalFilterConfig) => void;
  /** Sample count (affects consistency filter visibility) */
  sampleCount?: number;
  /** Default expanded state */
  defaultExpanded?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

// TICKET_786_16: `label` is the English fallback; `labelKey` is resolved via t() at render time
const FILTER_PRESETS: (PresetOption & { labelKey: string })[] = [
  { id: 'test', label: 'Test', labelKey: 'ui.signalFilterPanel.presetTest', icon: 'T' },
  { id: 'aggressive', label: 'Aggressive', labelKey: 'ui.signalFilterPanel.presetAggressive', icon: 'A' },
  { id: 'balanced', label: 'Balanced', labelKey: 'ui.signalFilterPanel.presetBalanced', icon: 'B' },
  { id: 'conservative', label: 'Conservative', labelKey: 'ui.signalFilterPanel.presetConservative', icon: 'C' },
];

const PRESET_CONFIGS: Record<string, Partial<SignalFilterConfig>> = {
  test: {
    confidence: { enabled: false, value: 0 },
    expectedReturn: { enabled: false, value: 0.1 },
    direction: { enabled: false, mode: 'both' },
    magnitude: { enabled: false, value: 0 },
  },
  aggressive: {
    confidence: { enabled: true, value: 40 },
    expectedReturn: { enabled: true, value: 1 },
    direction: { enabled: false, mode: 'both' },
    magnitude: { enabled: false, value: 0.5 },
  },
  balanced: {
    confidence: { enabled: true, value: 60 },
    expectedReturn: { enabled: true, value: 2 },
    direction: { enabled: false, mode: 'both' },
    magnitude: { enabled: false, value: 1 },
  },
  conservative: {
    confidence: { enabled: true, value: 75 },
    expectedReturn: { enabled: true, value: 3 },
    direction: { enabled: false, mode: 'both' },
    magnitude: { enabled: true, value: 1.5 },
  },
};

// TICKET_786_4: `label` is the English fallback; renderers translate via `labelKey`
const DIRECTION_OPTIONS: { value: DirectionMode; label: string; labelKey: string }[] = [
  { value: 'both', label: 'Both (Long & Short)', labelKey: 'ui.signalFilterPanel.directionOptions.both' },
  { value: 'buy_only', label: 'Buy Only (Long)', labelKey: 'ui.signalFilterPanel.directionOptions.buy_only' },
  { value: 'sell_only', label: 'Sell Only (Short)', labelKey: 'ui.signalFilterPanel.directionOptions.sell_only' },
];

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

function detectActivePreset(config: SignalFilterConfig): string {
  for (const [presetId, presetConfig] of Object.entries(PRESET_CONFIGS)) {
    const matches =
      config.confidence.enabled === presetConfig.confidence?.enabled &&
      config.confidence.value === presetConfig.confidence?.value &&
      config.expectedReturn.enabled === presetConfig.expectedReturn?.enabled &&
      config.expectedReturn.value === presetConfig.expectedReturn?.value &&
      config.magnitude.enabled === presetConfig.magnitude?.enabled;

    if (matches) return presetId;
  }
  return '';
}

function calculateFrequency(config: SignalFilterConfig): FrequencyLevel {
  const enabledFilters = [
    config.confidence.enabled,
    config.expectedReturn.enabled,
    config.direction.enabled,
    config.magnitude.enabled,
    config.consistency.enabled,
  ].filter(Boolean);

  if (enabledFilters.length === 0) return 'high';

  let score = 0;
  if (config.confidence.enabled) score += config.confidence.value;
  if (config.expectedReturn.enabled) score += config.expectedReturn.value * 10;
  if (config.magnitude.enabled) score += config.magnitude.value * 20;

  const avgScore = score / enabledFilters.length;

  if (avgScore < 30) return 'high';
  if (avgScore < 60) return 'moderate';
  return 'low';
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const SignalFilterPanel: React.FC<SignalFilterPanelProps> = ({
  config,
  onChange,
  sampleCount = 1,
  defaultExpanded = true,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');

  // TICKET_786_16: Translate preset labels from module-level constants
  const translatedPresets = useMemo<PresetOption[]>(
    () => FILTER_PRESETS.map((p) => ({ ...p, label: t(p.labelKey, { defaultValue: p.label }) })),
    [t]
  );

  // Detect active preset
  const activePreset = useMemo(() => detectActivePreset(config), [config]);

  // Calculate frequency indicator
  const frequency = useMemo(() => calculateFrequency(config), [config]);

  // Check if at least one filter is enabled
  const hasEnabledFilter = useMemo(
    () =>
      config.confidence.enabled ||
      config.expectedReturn.enabled ||
      config.direction.enabled ||
      config.magnitude.enabled ||
      config.consistency.enabled,
    [config]
  );

  // Show consistency filter only when sample count > 1
  const showConsistency = sampleCount > 1;

  // Update helper
  const updateConfig = useCallback(
    (updates: Partial<SignalFilterConfig>) => {
      onChange({ ...config, ...updates });
    },
    [config, onChange]
  );

  // Handle preset selection
  const handlePresetSelect = useCallback(
    (presetId: string) => {
      const presetConfig = PRESET_CONFIGS[presetId];
      if (presetConfig) {
        onChange({
          ...config,
          ...presetConfig,
          // Preserve consistency as it's not part of presets
          consistency: config.consistency,
          combinationLogic: config.combinationLogic,
        } as SignalFilterConfig);
      }
    },
    [config, onChange]
  );

  return (
    <CollapsiblePanel
      title={t('ui.signalFilterPanel.title')}
      badge={t('ui.signalFilterPanel.badge')}
      subtitle={t('ui.signalFilterPanel.subtitle')}
      defaultExpanded={defaultExpanded}
      className={className}
    >
      <div className="flex flex-col gap-5">
        {/* Quick Presets */}
        <div>
          <label className="block text-xs font-medium text-color-terminal-text-secondary mb-2">
            {t('ui.signalFilterPanel.quickPresets')}
          </label>
          <PresetButtonGroup
            presets={translatedPresets}
            activePreset={activePreset}
            onSelect={handlePresetSelect}
            variant="compact"
          />
        </div>

        {/* Filter Items */}
        <div className="flex flex-col gap-3">
          {/* Confidence Threshold */}
          <FilterItem
            enabled={config.confidence.enabled}
            onEnabledChange={(enabled) =>
              updateConfig({ confidence: { ...config.confidence, enabled } })
            }
            label={t('ui.signalFilterPanel.confidenceThreshold')}
          >
            <SliderInputGroup
              label=""
              value={config.confidence.value}
              onChange={(value) =>
                updateConfig({ confidence: { ...config.confidence, value } })
              }
              min={0}
              max={99}
              step={5}
              suffix="%"
              disabled={!config.confidence.enabled}
            />
            <FilterScale left={t('ui.signalFilterPanel.moreSignals')} right={t('ui.signalFilterPanel.higherQuality')} />
          </FilterItem>

          {/* Expected Return */}
          <FilterItem
            enabled={config.expectedReturn.enabled}
            onEnabledChange={(enabled) =>
              updateConfig({ expectedReturn: { ...config.expectedReturn, enabled } })
            }
            label={t('ui.signalFilterPanel.expectedReturn')}
          >
            <SliderInputGroup
              label=""
              value={config.expectedReturn.value}
              onChange={(value) =>
                updateConfig({ expectedReturn: { ...config.expectedReturn, value } })
              }
              min={0.1}
              max={50}
              step={0.1}
              decimals={1}
              suffix="%"
              disabled={!config.expectedReturn.enabled}
            />
            <FilterScale left={t('ui.signalFilterPanel.smallReturns')} right={t('ui.signalFilterPanel.largeReturnsOnly')} />
          </FilterItem>

          {/* Direction Filter */}
          <FilterItem
            enabled={config.direction.enabled}
            onEnabledChange={(enabled) =>
              updateConfig({ direction: { ...config.direction, enabled } })
            }
            label={t('ui.signalFilterPanel.directionFilter')}
          >
            <select
              value={config.direction.mode}
              onChange={(e) =>
                updateConfig({
                  direction: {
                    ...config.direction,
                    mode: e.target.value as DirectionMode,
                  },
                })
              }
              disabled={!config.direction.enabled}
              className={cn(
                'w-full px-3 py-2',
                'border border-color-terminal-border rounded',
                'bg-color-terminal-surface text-color-terminal-text',
                'text-[13px]',
                'focus:outline-none focus:border-color-terminal-accent-teal',
                'transition-colors duration-200',
                !config.direction.enabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              {DIRECTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey, { defaultValue: opt.label })}
                </option>
              ))}
            </select>
          </FilterItem>

          {/* Price Magnitude */}
          <FilterItem
            enabled={config.magnitude.enabled}
            onEnabledChange={(enabled) =>
              updateConfig({ magnitude: { ...config.magnitude, enabled } })
            }
            label={t('ui.signalFilterPanel.priceMagnitude')}
          >
            <SliderInputGroup
              label=""
              value={config.magnitude.value}
              onChange={(value) =>
                updateConfig({ magnitude: { ...config.magnitude, value } })
              }
              min={0}
              max={10}
              step={0.5}
              decimals={1}
              suffix="%"
              disabled={!config.magnitude.enabled}
            />
            <FilterScale left={t('ui.signalFilterPanel.smallMoves')} right={t('ui.signalFilterPanel.largeMovesOnly')} />
          </FilterItem>

          {/* Sample Consistency (conditional) */}
          {showConsistency && (
            <FilterItem
              enabled={config.consistency.enabled}
              onEnabledChange={(enabled) =>
                updateConfig({ consistency: { ...config.consistency, enabled } })
              }
              label={t('ui.signalFilterPanel.sampleConsistency')}
              badge={t('ui.signalFilterPanel.multiSample')}
            >
              <SliderInputGroup
                label=""
                value={config.consistency.value}
                onChange={(value) =>
                  updateConfig({ consistency: { ...config.consistency, value } })
                }
                min={50}
                max={100}
                step={5}
                suffix="%"
                disabled={!config.consistency.enabled}
              />
              <FilterScale left={t('ui.signalFilterPanel.flexible')} right={t('ui.signalFilterPanel.highAgreement')} />
            </FilterItem>
          )}
        </div>

        {/* Filter Logic */}
        <div>
          <label className="block text-xs font-medium text-color-terminal-text-secondary mb-2">
            {t('ui.signalFilterPanel.filterLogic')}
          </label>
          <div className="flex gap-3">
            <LogicOption
              label={t('ui.signalFilterPanel.logicAnd')}
              description={t('ui.signalFilterPanel.logicAndDesc')}
              selected={config.combinationLogic === 'AND'}
              onSelect={() => updateConfig({ combinationLogic: 'AND' })}
            />
            <LogicOption
              label={t('ui.signalFilterPanel.logicOr')}
              description={t('ui.signalFilterPanel.logicOrDesc')}
              selected={config.combinationLogic === 'OR'}
              onSelect={() => updateConfig({ combinationLogic: 'OR' })}
            />
          </div>
        </div>

        {/* Validation Warning */}
        {!hasEnabledFilter && (
          <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            <span className="text-xs text-yellow-500">
              {t('ui.signalFilterPanel.filterWarning')}
            </span>
          </div>
        )}

        {/* Frequency Indicator */}
        <div className="flex items-center gap-3 px-4 py-3 bg-color-terminal-surface-50 rounded-lg">
          <BarChart3 className="w-4 h-4 text-color-terminal-text-muted" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-color-terminal-text-secondary">
              {t('ui.signalFilterPanel.expectedFrequency')}
            </span>
            <span
              className={cn(
                'text-xs font-bold',
                frequency === 'high' && 'text-green-500',
                frequency === 'moderate' && 'text-color-terminal-accent-gold',
                frequency === 'low' && 'text-red-500'
              )}
            >
              {t(`ui.signalFilterPanel.${FREQUENCY_I18N_KEY[frequency]}` as any)}
            </span>
          </div>
        </div>
      </div>
    </CollapsiblePanel>
  );
};

// -----------------------------------------------------------------------------
// Sub-Components
// -----------------------------------------------------------------------------

interface FilterItemProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  label: string;
  badge?: string;
  children: React.ReactNode;
}

const FilterItem: React.FC<FilterItemProps> = ({
  enabled,
  onEnabledChange,
  label,
  badge,
  children,
}) => (
  <div className="border border-color-terminal-border rounded-lg overflow-hidden">
    {/* Header */}
    <div className="px-4 py-3 bg-color-terminal-surface-50 border-b border-color-terminal-border">
      <div className="flex items-center gap-2">
        <ToggleSwitch
          label={label}
          checked={enabled}
          onChange={onEnabledChange}
        />
        {badge && (
          <span className="px-2 py-0.5 text-[12px] font-bold uppercase tracking-wide bg-color-terminal-accent-teal/20 text-color-terminal-accent-teal rounded">
            {badge}
          </span>
        )}
      </div>
    </div>

    {/* Body */}
    <div
      className={cn(
        'px-4 py-3 transition-opacity duration-200',
        !enabled && 'opacity-50 pointer-events-none'
      )}
    >
      {children}
    </div>
  </div>
);

interface FilterScaleProps {
  left: string;
  right: string;
}

const FilterScale: React.FC<FilterScaleProps> = ({ left, right }) => (
  <div className="flex justify-between mt-1">
    <span className="text-[10px] text-color-terminal-text-muted">{left}</span>
    <span className="text-[10px] text-color-terminal-text-muted">{right}</span>
  </div>
);

interface LogicOptionProps {
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}

const LogicOption: React.FC<LogicOptionProps> = ({
  label,
  description,
  selected,
  onSelect,
}) => (
  <button
    type="button"
    onClick={onSelect}
    className={cn(
      'flex-1 flex flex-col items-start gap-1',
      'px-3 py-2 rounded-lg border',
      'transition-all duration-200',
      'text-left',
      selected
        ? 'border-color-terminal-accent-teal bg-color-terminal-accent-teal/5'
        : 'border-color-terminal-border hover:border-color-terminal-accent-teal/50'
    )}
  >
    <span
      className={cn(
        'text-sm font-bold',
        selected ? 'text-color-terminal-accent-teal' : 'text-color-terminal-text'
      )}
    >
      {label}
    </span>
    <span className="text-[10px] text-color-terminal-text-muted">
      {description}
    </span>
  </button>
);

export default SignalFilterPanel;
