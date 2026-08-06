/**
 * BespokeConfigPanel Component (component23)
 *
 * Bespoke mode configuration panel with 6 slider inputs for custom parameter tuning.
 * Only visible when "bespoke" preset is selected.
 * Uses SliderInputGroup (component11) internally.
 *
 * @see TICKET_077_19 - Kronos AI Entry Components
 * @see TICKET_077_11 - SliderInputGroup Component
 * @see TICKET_211 - Page 34 - Kronos AI Entry
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import { SliderInputGroup } from './SliderInputGroup';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface BespokeConfig {
  lookbackBars: number;
  positionLimits: number;
  leverage: number;
  tradingFrequency: number;
  typicalYield: number;
  maxDrawdown: number;
}

export interface SliderConfig {
  key: keyof BespokeConfig;
  label: string;
  /** TICKET_786_16: i18n key resolved via t() at render time; `label` is the English fallback */
  labelKey?: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
}

export interface BespokeConfigPanelProps {
  /** Component title */
  title?: string;
  /** Current configuration values */
  config: BespokeConfig;
  /** Callback when config changes */
  onChange: (config: BespokeConfig) => void;
  /** Override default slider configs */
  sliderConfigs?: SliderConfig[];
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants - Default Slider Configurations
// -----------------------------------------------------------------------------

const DEFAULT_SLIDER_CONFIGS: SliderConfig[] = [
  {
    key: 'lookbackBars',
    label: 'Lookback Bars',
    labelKey: 'ui.bespokeConfig.lookbackBars',
    min: 20,
    max: 200,
    step: 10,
    defaultValue: 100,
  },
  {
    key: 'positionLimits',
    label: 'Position Limits',
    labelKey: 'ui.bespokeConfig.positionLimits',
    min: 0,
    max: 100,
    step: 5,
    defaultValue: 100,
    unit: '%',
  },
  {
    key: 'leverage',
    label: 'Leverage',
    labelKey: 'ui.bespokeConfig.leverage',
    min: 1,
    max: 1000,
    step: 1,
    defaultValue: 1,
    unit: 'x',
  },
  {
    key: 'tradingFrequency',
    label: 'Trading Frequency',
    labelKey: 'ui.bespokeConfig.tradingFrequency',
    min: 1,
    max: 1000,
    step: 10,
    defaultValue: 10,
  },
  {
    key: 'typicalYield',
    label: 'Typical Yield',
    labelKey: 'ui.bespokeConfig.typicalYield',
    min: 1,
    max: 500,
    step: 5,
    defaultValue: 50,
    unit: '%',
  },
  {
    key: 'maxDrawdown',
    label: 'Max Drawdown',
    labelKey: 'ui.bespokeConfig.maxDrawdown',
    min: 1,
    max: 90,
    step: 1,
    defaultValue: 20,
    unit: '%',
  },
];

export const DEFAULT_BESPOKE_CONFIG: BespokeConfig = {
  lookbackBars: 100,
  positionLimits: 100,
  leverage: 1,
  tradingFrequency: 10,
  typicalYield: 50,
  maxDrawdown: 20,
};

// -----------------------------------------------------------------------------
// BespokeConfigPanel Component
// -----------------------------------------------------------------------------

export const BespokeConfigPanel: React.FC<BespokeConfigPanelProps> = ({
  title,
  config,
  onChange,
  sliderConfigs = DEFAULT_SLIDER_CONFIGS,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');

  // Handle individual slider value change
  const handleSliderChange = useCallback(
    (key: keyof BespokeConfig, value: number) => {
      onChange({
        ...config,
        [key]: value,
      });
    },
    [config, onChange]
  );

  // Generate range text for a slider
  const getRangeText = (sliderConfig: SliderConfig): string => {
    const { min, max, unit } = sliderConfig;
    const minLabel = unit ? `${min}${unit}` : String(min);
    const maxLabel = unit ? `${max}${unit}` : String(max);
    return t('ui.bespokeConfig.rangeText', { min: minLabel, max: maxLabel });
  };

  return (
    <div
      className={cn(
        'bespoke-config-panel',
        'mb-6 p-5',
        'bg-color-terminal-surface',
        'rounded-lg',
        'border border-color-terminal-border',
        className
      )}
    >
      {/* Title with Icon */}
      <h3 className="flex items-center gap-2 text-sm font-bold terminal-mono uppercase tracking-widest text-color-terminal-accent-gold mb-6">
        <Pencil className="w-5 h-5 text-color-terminal-accent-teal" />
        {title || t('ui.bespokeConfig.title')}
      </h3>

      {/* Slider Grid */}
      <div className="space-y-6">
        {sliderConfigs.map((sliderConfig) => (
          <SliderInputGroup
            key={sliderConfig.key}
            label={sliderConfig.labelKey ? t(sliderConfig.labelKey, { defaultValue: sliderConfig.label }) : sliderConfig.label}
            value={config[sliderConfig.key]}
            onChange={(value) => handleSliderChange(sliderConfig.key, value)}
            min={sliderConfig.min}
            max={sliderConfig.max}
            step={sliderConfig.step}
            suffix={sliderConfig.unit}
            rangeText={getRangeText(sliderConfig)}
          />
        ))}
      </div>
    </div>
  );
};

export default BespokeConfigPanel;
