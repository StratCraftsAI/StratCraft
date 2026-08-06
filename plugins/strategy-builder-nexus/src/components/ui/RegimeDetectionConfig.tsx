/**
 * RegimeDetectionConfig Component
 *
 * Configuration form for Regime Detection risk override rule.
 * Detect market regime change via indicators, override combinator.
 *
 * @see TICKET_274 - Indicator Exit Generator (Risk Manager)
 */

import React, { useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SliderInputGroup } from './SliderInputGroup';
import { PortalDropdown } from './PortalDropdown';
import { RawIndicatorSelector } from './RawIndicatorSelector';
import type { RawIndicatorBlock } from './RawIndicatorSelector';
import type { IndicatorDefinition } from './IndicatorSelector';
import {
  INDICATOR_CONDITIONS,
  RECOVERY_MODES,
  RULE_DEFAULTS,
} from '../../services/risk-override-exit-service';
import type { RegimeDetectionRule } from '../../services/risk-override-exit-service';

import { STRATEGY_INDICATOR_CATALOG as indicatorData } from '@StratCraft/types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface RegimeDetectionConfigProps {
  rule: RegimeDetectionRule;
  onChange: (rule: RegimeDetectionRule) => void;
}

// Subset of conditions for regime detection
const REGIME_CONDITIONS = INDICATOR_CONDITIONS.filter(
  c => ['>', '<', 'crosses_above', 'crosses_below'].includes(c.value)
);

// Actions specific to regime detection (TICKET_786_4: translation keys from shared riskOverride namespace)
const REGIME_ACTIONS = [
  { value: 'reduce_all', label: 'Reduce All Positions', labelKey: 'riskOverride.ruleActions.reduce_all' },
  { value: 'close_all', label: 'Close All', labelKey: 'riskOverride.ruleActions.close_all' },
  { value: 'halt_new_entry', label: 'Halt New Entry', labelKey: 'riskOverride.ruleActions.halt_new_entry' },
] as const;

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const RegimeDetectionConfig: React.FC<RegimeDetectionConfigProps> = ({
  rule,
  onChange,
}) => {
  const { t } = useTranslation('strategy-builder');
  const conditionRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const recoveryRef = useRef<HTMLButtonElement>(null);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  // TICKET_786_4: translate via labelKey, fall back to English label / default
  const conditionEntry = REGIME_CONDITIONS.find(c => c.value === rule.condition);
  const conditionLabel = conditionEntry
    ? (conditionEntry.labelKey
        ? t(conditionEntry.labelKey, { defaultValue: conditionEntry.label })
        : conditionEntry.label)
    : t('ui.regimeDetectionConfig.conditionDefault');
  const actionEntry = REGIME_ACTIONS.find(a => a.value === rule.action);
  const actionLabel = actionEntry
    ? t(actionEntry.labelKey, { defaultValue: actionEntry.label })
    : t('ui.regimeDetectionConfig.actionDefault');
  const recoveryEntry = RECOVERY_MODES.find(r => r.value === rule.recovery);
  const recoveryLabel = recoveryEntry
    ? t(recoveryEntry.labelKey, { defaultValue: recoveryEntry.label })
    : t('ui.regimeDetectionConfig.recoveryDefault');

  const handleFieldChange = useCallback((field: string, value: unknown) => {
    onChange({ ...rule, [field]: value });
  }, [rule, onChange]);

  // Map rule.indicator to RawIndicatorBlock for RawIndicatorSelector
  const indicatorBlocks: RawIndicatorBlock[] = rule.indicator?.name
    ? [{
        id: 'regime-ind-0',
        indicatorSlug: rule.indicator.name,
        field: 'close',
        paramValues: rule.indicator.parameters as Record<string, number | string>,
      }]
    : [];

  const handleIndicatorChange = useCallback((blocks: RawIndicatorBlock[]) => {
    if (blocks.length > 0 && blocks[0].indicatorSlug) {
      const params: Record<string, number> = {};
      for (const [k, v] of Object.entries(blocks[0].paramValues)) {
        params[k] = typeof v === 'number' ? v : parseFloat(String(v)) || 0;
      }
      onChange({
        ...rule,
        indicator: {
          name: blocks[0].indicatorSlug,
          parameters: params,
        },
      });
    }
  }, [rule, onChange]);

  return (
    <div className="space-y-4">
      {/* Indicator Selector */}
      <RawIndicatorSelector
        title={t('ui.regimeDetectionConfig.title')}
        indicators={indicatorData as IndicatorDefinition[]}
        blocks={indicatorBlocks}
        onChange={handleIndicatorChange}
        addButtonLabel={t('ui.regimeDetectionConfig.addButton')}
      />

      {/* Condition Selector */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary mb-1.5">
          {t('ui.regimeDetectionConfig.condition')}
        </label>
        <button
          ref={conditionRef}
          onClick={() => setConditionOpen(!conditionOpen)}
          className="w-full px-3 py-2 text-xs text-left border rounded bg-[#112240] border-[#233554] text-[#e6f1ff] hover:border-color-terminal-accent-primary/50 transition-colors"
        >
          {conditionLabel}
        </button>
        <PortalDropdown isOpen={conditionOpen} triggerRef={conditionRef} onClose={() => setConditionOpen(false)}>
          {REGIME_CONDITIONS.map(c => (
            <button
              key={c.value}
              onClick={() => { handleFieldChange('condition', c.value); setConditionOpen(false); }}
              className="w-full px-3 py-2 text-xs text-left hover:bg-white/10 text-[#e6f1ff] transition-colors"
            >
              {c.labelKey ? t(c.labelKey, { defaultValue: c.label }) : c.label}
            </button>
          ))}
        </PortalDropdown>
      </div>

      {/* Threshold */}
      <SliderInputGroup
        label={t('ui.regimeDetectionConfig.threshold')}
        value={rule.threshold}
        onChange={(v) => handleFieldChange('threshold', v)}
        min={0}
        max={100}
        step={0.5}
        decimals={1}
        rangeText={t('ui.sliderInputGroup.rangeText', { min: 0, max: 100 })}
      />

      {/* Action Selector */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary mb-1.5">
          {t('ui.regimeDetectionConfig.action')}
        </label>
        <button
          ref={actionRef}
          onClick={() => setActionOpen(!actionOpen)}
          className="w-full px-3 py-2 text-xs text-left border rounded bg-[#112240] border-[#233554] text-[#e6f1ff] hover:border-color-terminal-accent-primary/50 transition-colors"
        >
          {actionLabel}
        </button>
        <PortalDropdown isOpen={actionOpen} triggerRef={actionRef} onClose={() => setActionOpen(false)}>
          {REGIME_ACTIONS.map(a => (
            <button
              key={a.value}
              onClick={() => { handleFieldChange('action', a.value); setActionOpen(false); }}
              className="w-full px-3 py-2 text-xs text-left hover:bg-white/10 text-[#e6f1ff] transition-colors"
            >
              {t(a.labelKey, { defaultValue: a.label })}
            </button>
          ))}
        </PortalDropdown>
      </div>

      {/* Reduce Percent (conditional) */}
      {rule.action === 'reduce_all' && (
        <SliderInputGroup
          label={t('ui.regimeDetectionConfig.reduceBy')}
          value={rule.reducePercent ?? RULE_DEFAULTS.regime_detection.reducePercent}
          onChange={(v) => handleFieldChange('reducePercent', v)}
          min={10}
          max={90}
          step={5}
          suffix="%"
        />
      )}

      {/* Recovery Selector */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary mb-1.5">
          {t('ui.regimeDetectionConfig.recoveryMode')}
        </label>
        <button
          ref={recoveryRef}
          onClick={() => setRecoveryOpen(!recoveryOpen)}
          className="w-full px-3 py-2 text-xs text-left border rounded bg-[#112240] border-[#233554] text-[#e6f1ff] hover:border-color-terminal-accent-primary/50 transition-colors"
        >
          {recoveryLabel}
        </button>
        <PortalDropdown isOpen={recoveryOpen} triggerRef={recoveryRef} onClose={() => setRecoveryOpen(false)}>
          {RECOVERY_MODES.map(r => (
            <button
              key={r.value}
              onClick={() => { handleFieldChange('recovery', r.value); setRecoveryOpen(false); }}
              className="w-full px-3 py-2 text-xs text-left hover:bg-white/10 text-[#e6f1ff] transition-colors"
            >
              {t(r.labelKey, { defaultValue: r.label })}
            </button>
          ))}
        </PortalDropdown>
      </div>
    </div>
  );
};

export default RegimeDetectionConfig;
