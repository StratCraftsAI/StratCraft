/**
 * AdvancedConfigPanel Component (component26)
 *
 * Advanced configuration panel for AI Libero with Prediction Configuration parameters.
 * Uses collapsible design with summary view and expandable manual controls.
 *
 * Features:
 * - Collapsible panel using CollapsiblePanel (component15)
 * - Summary view showing current values from selected preset
 * - "Customize" button to expand manual controls
 * - Reset button to restore preset defaults
 * - 4 slider inputs for Prediction Configuration
 *
 * @see TICKET_077_26 - AI Libero Page (page37)
 * @see TICKET_077_15 - CollapsiblePanel Component
 * @see TICKET_077_11 - SliderInputGroup Component
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, RotateCcw, ChevronRight, Box } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CollapsiblePanel } from './CollapsiblePanel';
import { SliderInputGroup } from './SliderInputGroup';
import type { TraderPresetMode } from './TraderPresetSelector';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface PredictionConfig {
  batchSize: number;
  warmupPeriod: number;
  lookbackBars: number;
  analysisInterval: number;
}

export interface AdvancedConfigPanelProps {
  /** Panel title */
  title?: string;
  /** Current preset mode (for summary display) */
  presetMode: TraderPresetMode;
  /** Current prediction config values */
  predictionConfig: PredictionConfig;
  /** Callback when prediction config changes */
  onPredictionConfigChange: (config: PredictionConfig) => void;
  /** Callback when reset clicked */
  onReset: () => void;
  /** Default expanded state */
  defaultExpanded?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

export const DEFAULT_PREDICTION_CONFIG: PredictionConfig = {
  batchSize: 100,
  warmupPeriod: 100,
  lookbackBars: 100,
  analysisInterval: 10,
};

/**
 * Preset mode defaults for prediction config
 */
const PRESET_PREDICTION_CONFIGS: Record<TraderPresetMode, PredictionConfig> = {
  baseline: {
    batchSize: 100,
    warmupPeriod: 100,
    lookbackBars: 100,
    analysisInterval: 10,
  },
  monk: {
    batchSize: 100,
    warmupPeriod: 100,
    lookbackBars: 100,
    analysisInterval: 10,
  },
  warrior: {
    batchSize: 150,
    warmupPeriod: 150,
    lookbackBars: 80,
    analysisInterval: 5,
  },
  bespoke: {
    batchSize: 100,
    warmupPeriod: 100,
    lookbackBars: 100,
    analysisInterval: 10,
  },
};

/**
 * Get preset default prediction config
 */
export function getPresetPredictionConfig(mode: TraderPresetMode): PredictionConfig {
  return { ...PRESET_PREDICTION_CONFIGS[mode] };
}

interface SliderConfig {
  key: keyof PredictionConfig;
  label: string;
  min: number;
  max: number;
  step: number;
}

const PREDICTION_SLIDER_CONFIGS: SliderConfig[] = [
  {
    key: 'batchSize',
    label: 'ui.advancedConfig.batchSize',
    min: 50,
    max: 500,
    step: 50,
  },
  {
    key: 'warmupPeriod',
    label: 'ui.advancedConfig.warmupPeriod',
    min: 50,
    max: 500,
    step: 50,
  },
  {
    key: 'lookbackBars',
    label: 'ui.advancedConfig.lookbackBars',
    min: 20,
    max: 200,
    step: 10,
  },
  {
    key: 'analysisInterval',
    label: 'ui.advancedConfig.analysisInterval',
    min: 1,
    max: 100,
    step: 1,
  },
];

// -----------------------------------------------------------------------------
// Mode Label Map
// -----------------------------------------------------------------------------

const MODE_LABEL_KEYS: Record<TraderPresetMode, string> = {
  baseline: 'advancedConfig.mode.baseline',
  monk: 'advancedConfig.mode.monk',
  warrior: 'advancedConfig.mode.warrior',
  bespoke: 'advancedConfig.mode.bespoke',
};

// -----------------------------------------------------------------------------
// AdvancedConfigPanel Component
// -----------------------------------------------------------------------------

export const AdvancedConfigPanel: React.FC<AdvancedConfigPanelProps> = ({
  title,
  presetMode,
  predictionConfig,
  onPredictionConfigChange,
  onReset,
  defaultExpanded = false,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const [showManualControls, setShowManualControls] = useState(false);

  // Handle individual slider change
  const handleSliderChange = useCallback(
    (key: keyof PredictionConfig, value: number) => {
      onPredictionConfigChange({
        ...predictionConfig,
        [key]: value,
      });
    },
    [predictionConfig, onPredictionConfigChange]
  );

  // Handle customize button click
  const handleCustomize = useCallback(() => {
    setShowManualControls(true);
  }, []);

  // Handle reset button click
  const handleReset = useCallback(() => {
    setShowManualControls(false);
    onReset();
  }, [onReset]);

  // Compute if config differs from preset defaults
  const isCustomized = useMemo(() => {
    const presetDefaults = PRESET_PREDICTION_CONFIGS[presetMode];
    return (
      predictionConfig.batchSize !== presetDefaults.batchSize ||
      predictionConfig.warmupPeriod !== presetDefaults.warmupPeriod ||
      predictionConfig.lookbackBars !== presetDefaults.lookbackBars ||
      predictionConfig.analysisInterval !== presetDefaults.analysisInterval
    );
  }, [presetMode, predictionConfig]);

  // Get mode label from translation
  const modeLabel = t(MODE_LABEL_KEYS[presetMode]);

  return (
    <CollapsiblePanel
      title={title || t('ui.advancedConfig.title')}
      badge={isCustomized ? t('ui.advancedConfig.custom') : undefined}
      badgeVariant={isCustomized ? 'warning' : 'default'}
      defaultExpanded={defaultExpanded}
      className={className}
    >
      <div className="space-y-4">
        {/* Summary View */}
        {!showManualControls && (
          <div className="flex items-center justify-between p-4 bg-color-terminal-bg/50 rounded-lg border border-color-terminal-border/50">
            {/* Left: Current Configuration */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-color-terminal-text">
                  {t('ui.advancedConfig.currentConfig')}
                </span>
                <span className="text-sm font-bold text-color-terminal-accent-teal">
                  {modeLabel}
                </span>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-color-terminal-text-secondary">
                <span>
                  {t('ui.advancedConfig.batchSizeLabel')} <span className="text-color-terminal-accent-gold font-semibold">{predictionConfig.batchSize}</span>
                </span>
                <span>
                  {t('ui.advancedConfig.warmupLabel')} <span className="text-color-terminal-accent-gold font-semibold">{predictionConfig.warmupPeriod}</span>
                </span>
                <span>
                  {t('ui.advancedConfig.lookbackLabel')} <span className="text-color-terminal-accent-gold font-semibold">{predictionConfig.lookbackBars}</span>
                </span>
                <span>
                  {t('ui.advancedConfig.intervalLabel')} <span className="text-color-terminal-accent-gold font-semibold">{predictionConfig.analysisInterval}</span>
                </span>
              </div>
            </div>

            {/* Right: Customize Button */}
            <button
              type="button"
              onClick={handleCustomize}
              className={cn(
                'flex items-center gap-1 px-3 py-1.5',
                'text-xs font-medium',
                'text-color-terminal-accent-teal',
                'bg-transparent border border-color-terminal-accent-teal/50',
                'rounded',
                'hover:bg-color-terminal-accent-teal/10',
                'transition-all duration-200'
              )}
            >
              {t('ui.advancedConfig.customizeParams')}
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Manual Controls */}
        {showManualControls && (
          <div className="p-4 bg-color-terminal-surface-50 rounded-lg border border-color-terminal-border">
            {/* Header with Reset */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-color-terminal-accent-teal" />
                <span className="text-sm font-semibold text-color-terminal-text">
                  {t('ui.advancedConfig.predictionConfig')}
                </span>
                {isCustomized && (
                  <span className="px-2 py-0.5 text-[12px] font-bold uppercase tracking-wide rounded bg-color-terminal-accent-gold text-color-terminal-bg">
                    {t('ui.advancedConfig.custom')}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleReset}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5',
                  'text-xs font-medium',
                  'text-color-terminal-text-secondary',
                  'bg-transparent border border-color-terminal-border',
                  'rounded',
                  'hover:border-color-terminal-text hover:text-color-terminal-text',
                  'transition-all duration-200'
                )}
              >
                <RotateCcw className="w-3 h-3" />
                {t('ui.advancedConfig.reset')}
              </button>
            </div>

            {/* Sliders */}
            <div className="space-y-5">
              {PREDICTION_SLIDER_CONFIGS.map((sliderConfig) => (
                <SliderInputGroup
                  key={sliderConfig.key}
                  label={sliderConfig.label}
                  value={predictionConfig[sliderConfig.key]}
                  onChange={(value) => handleSliderChange(sliderConfig.key, value)}
                  min={sliderConfig.min}
                  max={sliderConfig.max}
                  step={sliderConfig.step}
                  rangeText={t('ui.advancedConfig.rangeText', { min: sliderConfig.min, max: sliderConfig.max })}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </CollapsiblePanel>
  );
};

export default AdvancedConfigPanel;
