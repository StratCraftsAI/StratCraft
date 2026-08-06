/**
 * RiskOverrideRuleCard Component
 *
 * Individual card for a risk override rule with enable/disable toggle,
 * priority reorder, delete, and type-specific configuration form.
 * Color-coded left border per rule type (Section 6.1).
 *
 * @see TICKET_274 - Indicator Exit Generator (Risk Manager)
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap,
  Clock,
  Activity,
  TrendingDown,
  Shield,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { ToggleSwitch } from './ToggleSwitch';
import { CircuitBreakerConfig } from './CircuitBreakerConfig';
import { TimeLimitConfig } from './TimeLimitConfig';
import { RegimeDetectionConfig } from './RegimeDetectionConfig';
import { DrawdownLimitConfig } from './DrawdownLimitConfig';
import { IndicatorGuardConfig } from './IndicatorGuardConfig';
import type {
  RiskOverrideRule,
  CircuitBreakerRule,
  TimeLimitRule,
  RegimeDetectionRule as RegimeDetectionRuleType,
  DrawdownLimitRule,
  IndicatorGuardRule,
} from '../../services/risk-override-exit-service';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface RiskOverrideRuleCardProps {
  rule: RiskOverrideRule;
  onChange: (rule: RiskOverrideRule) => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

// -----------------------------------------------------------------------------
// Rule Type Metadata
// -----------------------------------------------------------------------------

const RULE_META: Record<string, {
  label: string;
  icon: React.FC<{ className?: string }>;
  borderColor: string;
  badgeBg: string;
}> = {
  circuit_breaker: {
    label: 'Circuit Breaker',
    icon: Zap,
    borderColor: 'border-l-red-500',
    badgeBg: 'bg-red-500/20 text-red-300',
  },
  time_limit: {
    label: 'Time Limit',
    icon: Clock,
    borderColor: 'border-l-teal-500',
    badgeBg: 'bg-teal-500/20 text-teal-300',
  },
  regime_detection: {
    label: 'Regime Detection',
    icon: Activity,
    borderColor: 'border-l-amber-500',
    badgeBg: 'bg-amber-500/20 text-amber-300',
  },
  drawdown_limit: {
    label: 'Drawdown Limit',
    icon: TrendingDown,
    borderColor: 'border-l-red-500',
    badgeBg: 'bg-red-500/20 text-red-300',
  },
  indicator_guard: {
    label: 'Indicator Guard',
    icon: Shield,
    borderColor: 'border-l-blue-500',
    badgeBg: 'bg-blue-500/20 text-blue-300',
  },
};

// -----------------------------------------------------------------------------
// Summary Builder
// -----------------------------------------------------------------------------

function getRuleSummary(rule: RiskOverrideRule, t: (key: string, options?: Record<string, unknown>) => string): string {
  const ns = 'ui.riskOverrideRuleCard';
  switch (rule.type) {
    case 'circuit_breaker': {
      const actionStr = rule.action === 'close_all' ? t(`${ns}.closeAll`) : t(`${ns}.reduceTo`, { percent: rule.reduceToPercent ?? 50 });
      const scopeStr = rule.scope === 'per_position' ? t(`${ns}.scopePerPosition`) : rule.scope === 'per_signal_group' ? t(`${ns}.scopePerGroup`) : t(`${ns}.scopePortfolio`);
      return `${t(`${ns}.pnlLessThan`)} ${rule.triggerPnlPercent}% | ${scopeStr} | ${actionStr} | ${t(`${ns}.cooldown`)} ${rule.cooldownBars}`;
    }
    case 'time_limit': {
      const actionStr = rule.action === 'close_all' ? t(`${ns}.closeAll`) : t(`${ns}.reduceTo`, { percent: rule.reduceToPercent ?? 50 });
      const decayStr = rule.decay === 'none' ? t(`${ns}.noDecay`) : `${rule.decay} ${t(`${ns}.decay`)}`;
      return `${rule.maxHolding} ${rule.unit} | ${decayStr} | ${actionStr}`;
    }
    case 'regime_detection': {
      const indName = rule.indicator?.name || t(`${ns}.na`);
      const actionStr = rule.action === 'reduce_all' ? `${t(`${ns}.reduce`)} ${rule.reducePercent ?? 50}%` : rule.action === 'close_all' ? t(`${ns}.closeAll`) : t(`${ns}.haltEntry`);
      return `${indName} ${rule.condition} ${rule.threshold} | ${actionStr} | ${rule.recovery} ${t(`${ns}.recovery`)}`;
    }
    case 'drawdown_limit': {
      const actionStr = rule.action === 'halt_trading' ? t(`${ns}.haltTrading`) : rule.action === 'close_all' ? t(`${ns}.closeAll`) : `${t(`${ns}.reduce`)} ${rule.reducePercent ?? 50}%`;
      return `${t(`${ns}.drawdownLabel`)} ${rule.maxDrawdownPercent}% | ${actionStr} | ${rule.recovery} ${t(`${ns}.recovery`)}`;
    }
    case 'indicator_guard': {
      const indName = rule.indicator?.name || t(`${ns}.na`);
      const actionStr = rule.action === 'close_position' ? t(`${ns}.closePosition`) : t(`${ns}.reduceTo`, { percent: rule.reduceToPercent ?? 50 });
      return `${indName} ${rule.condition} ${rule.threshold} | ${rule.appliesTo} | ${actionStr}`;
    }
  }
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const RiskOverrideRuleCard: React.FC<RiskOverrideRuleCardProps> = ({
  rule,
  onChange,
  onDelete,
  onToggle,
  onMoveUp,
  onMoveDown,
}) => {
  const { t } = useTranslation('strategy-builder');
  const [expanded, setExpanded] = useState(true);

  const meta = RULE_META[rule.type] || RULE_META.circuit_breaker;
  const Icon = meta.icon;

  // Get translated rule label
  const ruleLabel = t(`ui.riskOverrideRuleCard.rule${rule.type.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')}` as any) || meta.label;

  return (
    <div
      className={cn(
        'rounded-lg border border-color-terminal-border bg-color-terminal-surface/50',
        'border-l-4',
        meta.borderColor,
        !rule.enabled && 'opacity-50'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Priority reorder buttons */}
        <div className="flex flex-col gap-0.5">
          <button
            onClick={onMoveUp}
            disabled={!onMoveUp}
            className="p-0.5 text-color-terminal-text-muted hover:text-color-terminal-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronUp className="w-3 h-3" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={!onMoveDown}
            className="p-0.5 text-color-terminal-text-muted hover:text-color-terminal-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>

        {/* Priority number */}
        <span className="text-[10px] font-mono text-color-terminal-text-muted w-4 text-center">
          #{rule.priority}
        </span>

        {/* Rule type badge */}
        <span className={cn('flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider', meta.badgeBg)}>
          <Icon className="w-3 h-3" />
          {ruleLabel}
        </span>

        {/* Expand/collapse toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-auto p-1 text-color-terminal-text-muted hover:text-color-terminal-text transition-colors"
        >
          <ChevronRight
            className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-90')}
          />
        </button>

        {/* Enable/disable toggle */}
        <ToggleSwitch
          label=""
          checked={rule.enabled}
          onChange={onToggle}
        />

        {/* Delete button */}
        <button
          onClick={onDelete}
          className="p-1 text-color-terminal-text-muted hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Collapsed Summary */}
      {!expanded && (
        <div className="px-4 pb-2 text-[10px] text-color-terminal-text-muted font-mono truncate">
          {getRuleSummary(rule, t)}
        </div>
      )}

      {/* Config Area (expandable) */}
      {expanded && rule.enabled && (
        <div className="px-4 pb-4 pt-1 border-t border-color-terminal-border/50">
          {rule.type === 'circuit_breaker' && (
            <CircuitBreakerConfig
              rule={rule as CircuitBreakerRule}
              onChange={onChange as (r: CircuitBreakerRule) => void}
            />
          )}
          {rule.type === 'time_limit' && (
            <TimeLimitConfig
              rule={rule as TimeLimitRule}
              onChange={onChange as (r: TimeLimitRule) => void}
            />
          )}
          {rule.type === 'regime_detection' && (
            <RegimeDetectionConfig
              rule={rule as RegimeDetectionRuleType}
              onChange={onChange as (r: RegimeDetectionRuleType) => void}
            />
          )}
          {rule.type === 'drawdown_limit' && (
            <DrawdownLimitConfig
              rule={rule as DrawdownLimitRule}
              onChange={onChange as (r: DrawdownLimitRule) => void}
            />
          )}
          {rule.type === 'indicator_guard' && (
            <IndicatorGuardConfig
              rule={rule as IndicatorGuardRule}
              onChange={onChange as (r: IndicatorGuardRule) => void}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default RiskOverrideRuleCard;
