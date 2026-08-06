/**
 * IndicatorGuardConfig Component
 *
 * Configuration form for Indicator Guard risk override rule.
 * Per-position indicator-based override when extreme zone is reached.
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
  DIRECTION_OPTIONS,
  RULE_DEFAULTS,
} from '../../services/risk-override-exit-service';
import type { IndicatorGuardRule } from '../../services/risk-override-exit-service';

import { STRATEGY_INDICATOR_CATALOG as indicatorData } from '@StratCraft/types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface IndicatorGuardConfigProps {
  rule: IndicatorGuardRule;
  onChange: (rule: IndicatorGuardRule) => void;
}

// Subset of conditions for indicator guard (no crosses)
const GUARD_CONDITIONS = INDICATOR_CONDITIONS.filter(
  c => ['>', '<', '>=', '<='].includes(c.value)
);

// Actions for indicator guard (TICKET_786_4: translation keys from shared riskOverride namespace)
const GUARD_ACTIONS = [
  { value: 'close_position', label: 'Close Position', labelKey: 'riskOverride.ruleActions.close_position' },
  { value: 'reduce_to', label: 'Reduce To %', labelKey: 'riskOverride.ruleActions.reduce_to' },
] as const;

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const IndicatorGuardConfig: React.FC<IndicatorGuardConfigProps> = ({
  rule,
  onChange,
}) => {
  const { t } = useTranslation('strategy-builder');
  const conditionRef = useRef<HTMLButtonElement>(null);
  const appliesToRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [appliesToOpen, setAppliesToOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);

  // TICKET_786_4: translate via labelKey, fall back to English label / default
  const conditionEntry = GUARD_CONDITIONS.find(c => c.value === rule.condition);
  const conditionLabel = conditionEntry
    ? (conditionEntry.labelKey
        ? t(conditionEntry.labelKey, { defaultValue: conditionEntry.label })
        : conditionEntry.label)
    : t('ui.indicatorGuardConfig.conditionDefault');
  const appliesToEntry = DIRECTION_OPTIONS.find(d => d.value === rule.appliesTo);
  const appliesToLabel = appliesToEntry
    ? t(appliesToEntry.labelKey, { defaultValue: appliesToEntry.label })
    : t('ui.indicatorGuardConfig.appliesToDefault');
  const actionEntry = GUARD_ACTIONS.find(a => a.value === rule.action);
  const actionLabel = actionEntry
    ? t(actionEntry.labelKey, { defaultValue: actionEntry.label })
    : t('ui.indicatorGuardConfig.actionDefault');

  const handleFieldChange = useCallback((field: string, value: unknown) => {
    onChange({ ...rule, [field]: value });
  }, [rule, onChange]);

  // Map rule.indicator to RawIndicatorBlock
  const indicatorBlocks: RawIndicatorBlock[] = rule.indicator?.name
    ? [{
        id: 'guard-ind-0',
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
        title={t('ui.indicatorGuardConfig.title')}
        indicators={indicatorData as IndicatorDefinition[]}
        blocks={indicatorBlocks}
        onChange={handleIndicatorChange}
        addButtonLabel={t('ui.indicatorGuardConfig.addButton')}
      />

      {/* Condition Selector */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary mb-1.5">
          {t('ui.indicatorGuardConfig.condition')}
        </label>
        <button
          ref={conditionRef}
          onClick={() => setConditionOpen(!conditionOpen)}
          className="w-full px-3 py-2 text-xs text-left border rounded bg-[#112240] border-[#233554] text-[#e6f1ff] hover:border-color-terminal-accent-primary/50 transition-colors"
        >
          {conditionLabel}
        </button>
        <PortalDropdown isOpen={conditionOpen} triggerRef={conditionRef} onClose={() => setConditionOpen(false)}>
          {GUARD_CONDITIONS.map(c => (
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
        label={t('ui.indicatorGuardConfig.threshold')}
        value={rule.threshold}
        onChange={(v) => handleFieldChange('threshold', v)}
        min={0}
        max={100}
        step={1}
        rangeText={t('ui.sliderInputGroup.rangeText', { min: 0, max: 100 })}
      />

      {/* Applies To Selector */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary mb-1.5">
          {t('ui.indicatorGuardConfig.appliesTo')}
        </label>
        <button
          ref={appliesToRef}
          onClick={() => setAppliesToOpen(!appliesToOpen)}
          className="w-full px-3 py-2 text-xs text-left border rounded bg-[#112240] border-[#233554] text-[#e6f1ff] hover:border-color-terminal-accent-primary/50 transition-colors"
        >
          {appliesToLabel}
        </button>
        <PortalDropdown isOpen={appliesToOpen} triggerRef={appliesToRef} onClose={() => setAppliesToOpen(false)}>
          {DIRECTION_OPTIONS.map(d => (
            <button
              key={d.value}
              onClick={() => { handleFieldChange('appliesTo', d.value); setAppliesToOpen(false); }}
              className="w-full px-3 py-2 text-xs text-left hover:bg-white/10 text-[#e6f1ff] transition-colors"
            >
              {t(d.labelKey, { defaultValue: d.label })}
            </button>
          ))}
        </PortalDropdown>
      </div>

      {/* Action Selector */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary mb-1.5">
          {t('ui.indicatorGuardConfig.action')}
        </label>
        <button
          ref={actionRef}
          onClick={() => setActionOpen(!actionOpen)}
          className="w-full px-3 py-2 text-xs text-left border rounded bg-[#112240] border-[#233554] text-[#e6f1ff] hover:border-color-terminal-accent-primary/50 transition-colors"
        >
          {actionLabel}
        </button>
        <PortalDropdown isOpen={actionOpen} triggerRef={actionRef} onClose={() => setActionOpen(false)}>
          {GUARD_ACTIONS.map(a => (
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

      {/* Reduce To % (conditional) */}
      {rule.action === 'reduce_to' && (
        <SliderInputGroup
          label={t('ui.indicatorGuardConfig.reduceTo')}
          value={rule.reduceToPercent ?? 50}
          onChange={(v) => handleFieldChange('reduceToPercent', v)}
          min={5}
          max={95}
          step={5}
          suffix="%"
        />
      )}
    </div>
  );
};

export default IndicatorGuardConfig;
