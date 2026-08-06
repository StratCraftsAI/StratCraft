/**
 * HardSafetyConfig Component
 *
 * Configuration form for the Hard Safety Net (Layer 2).
 * Absolute emergency stop - always active, cannot be disabled.
 *
 * @see TICKET_274 - Indicator Exit Generator (Risk Manager)
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { OctagonX } from 'lucide-react';
import { SliderInputGroup } from './SliderInputGroup';
import { RULE_DEFAULTS } from '../../services/risk-override-exit-service';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface HardSafetyConfigProps {
  maxLossPercent: number;
  onChange: (maxLossPercent: number) => void;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const HardSafetyConfig: React.FC<HardSafetyConfigProps> = ({
  maxLossPercent,
  onChange,
}) => {
  const { t } = useTranslation('strategy-builder');

  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <OctagonX className="w-4 h-4 text-red-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-red-400">
          {t('ui.hardSafetyConfig.title')}
        </span>
        <span className="ml-auto text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 font-medium">
          {t('ui.hardSafetyConfig.badge')}
        </span>
      </div>

      {/* Description */}
      <p className="text-[11px] text-color-terminal-text-muted mb-4">
        {t('ui.hardSafetyConfig.description')}
      </p>

      {/* Max Loss Slider */}
      <SliderInputGroup
        label={t('ui.hardSafetyConfig.maxLoss')}
        hint={t('ui.hardSafetyConfig.fromEntry')}
        value={maxLossPercent}
        onChange={onChange}
        min={-50}
        max={-5}
        step={0.5}
        suffix="%"
        decimals={1}
        rangeText={t('ui.sliderInputGroup.rangeText', { min: -50, max: -5 })}
      />
    </div>
  );
};

export default HardSafetyConfig;
