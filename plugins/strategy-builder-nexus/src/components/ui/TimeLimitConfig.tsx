/**
 * TimeLimitConfig Component
 *
 * Configuration form for Time Limit risk override rule.
 * Force close positions held beyond expected signal lifetime.
 *
 * @see TICKET_274 - Indicator Exit Generator (Risk Manager)
 */

import React, { useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SliderInputGroup } from './SliderInputGroup';
import { PortalDropdown } from './PortalDropdown';
import { TIME_UNITS, DECAY_SCHEDULES, RULE_DEFAULTS } from '../../services/risk-override-exit-service';
import type { TimeLimitRule } from '../../services/risk-override-exit-service';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface TimeLimitConfigProps {
  rule: TimeLimitRule;
  onChange: (rule: TimeLimitRule) => void;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const TimeLimitConfig: React.FC<TimeLimitConfigProps> = ({
  rule,
  onChange,
}) => {
  const { t } = useTranslation('strategy-builder');
  const unitRef = useRef<HTMLButtonElement>(null);
  const decayRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const [unitOpen, setUnitOpen] = useState(false);
  const [decayOpen, setDecayOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);

  // TICKET_786_4: translate via labelKey, fall back to English label / default
  const unitEntry = TIME_UNITS.find(u => u.value === rule.unit);
  const unitLabel = unitEntry
    ? t(unitEntry.labelKey, { defaultValue: unitEntry.label })
    : t('ui.timeLimitConfig.unitDefault');
  const decayEntry = DECAY_SCHEDULES.find(d => d.value === rule.decay);
  const decayLabel = decayEntry
    ? t(decayEntry.labelKey, { defaultValue: decayEntry.label })
    : t('ui.timeLimitConfig.decayDefault');
  const actionLabel = rule.action === 'close_all' ? t('ui.timeLimitConfig.closeAll') : t('ui.timeLimitConfig.reduceToPercent');

  const handleFieldChange = useCallback((field: string, value: unknown) => {
    onChange({ ...rule, [field]: value });
  }, [rule, onChange]);

  return (
    <div className="space-y-4">
      {/* Max Holding */}
      <SliderInputGroup
        label={t('ui.timeLimitConfig.maxHolding')}
        value={rule.maxHolding}
        onChange={(v) => handleFieldChange('maxHolding', v)}
        min={1}
        max={rule.unit === 'hours' ? 720 : 500}
        step={1}
        rangeText={t('ui.sliderInputGroup.rangeText', { min: 1, max: rule.unit === 'hours' ? 720 : 500 })}
      />

      {/* Unit Selector */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary mb-1.5">
          {t('ui.timeLimitConfig.unit')}
        </label>
        <button
          ref={unitRef}
          onClick={() => setUnitOpen(!unitOpen)}
          className="w-full px-3 py-2 text-xs text-left border rounded bg-[#112240] border-[#233554] text-[#e6f1ff] hover:border-color-terminal-accent-primary/50 transition-colors"
        >
          {unitLabel}
        </button>
        <PortalDropdown isOpen={unitOpen} triggerRef={unitRef} onClose={() => setUnitOpen(false)}>
          {TIME_UNITS.map(u => (
            <button
              key={u.value}
              onClick={() => { handleFieldChange('unit', u.value); setUnitOpen(false); }}
              className="w-full px-3 py-2 text-xs text-left hover:bg-white/10 text-[#e6f1ff] transition-colors"
            >
              {t(u.labelKey, { defaultValue: u.label })}
            </button>
          ))}
        </PortalDropdown>
      </div>

      {/* Decay Selector */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary mb-1.5">
          {t('ui.timeLimitConfig.decaySchedule')}
        </label>
        <button
          ref={decayRef}
          onClick={() => setDecayOpen(!decayOpen)}
          className="w-full px-3 py-2 text-xs text-left border rounded bg-[#112240] border-[#233554] text-[#e6f1ff] hover:border-color-terminal-accent-primary/50 transition-colors"
        >
          {decayLabel}
        </button>
        <PortalDropdown isOpen={decayOpen} triggerRef={decayRef} onClose={() => setDecayOpen(false)}>
          {DECAY_SCHEDULES.map(d => (
            <button
              key={d.value}
              onClick={() => { handleFieldChange('decay', d.value); setDecayOpen(false); }}
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
          {t('ui.timeLimitConfig.actionAtExpiry')}
        </label>
        <button
          ref={actionRef}
          onClick={() => setActionOpen(!actionOpen)}
          className="w-full px-3 py-2 text-xs text-left border rounded bg-[#112240] border-[#233554] text-[#e6f1ff] hover:border-color-terminal-accent-primary/50 transition-colors"
        >
          {actionLabel}
        </button>
        <PortalDropdown isOpen={actionOpen} triggerRef={actionRef} onClose={() => setActionOpen(false)}>
          {(['close_all', 'reduce_to'] as const).map(a => (
            <button
              key={a}
              onClick={() => { handleFieldChange('action', a); setActionOpen(false); }}
              className="w-full px-3 py-2 text-xs text-left hover:bg-white/10 text-[#e6f1ff] transition-colors"
            >
              {a === 'close_all' ? t('ui.timeLimitConfig.closeAll') : t('ui.timeLimitConfig.reduceToPercent')}
            </button>
          ))}
        </PortalDropdown>
      </div>

      {/* Reduce To % (conditional) */}
      {rule.action === 'reduce_to' && (
        <SliderInputGroup
          label={t('ui.timeLimitConfig.reduceTo')}
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

export default TimeLimitConfig;
