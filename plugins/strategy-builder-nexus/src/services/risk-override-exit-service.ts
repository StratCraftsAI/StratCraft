/**
 * Risk Override Exit Service - Plugin Layer
 *
 * TICKET_274: Indicator Exit Generator (Risk Manager)
 *
 * Generates Python risk override rules (Layer 1) that operate above
 * the Alpha Factory combinator. These rules activate ONLY when the
 * combinator fails or market conditions change drastically.
 *
 * Uses: /api/start_exit_strategy, /api/check_exit_strategy_status
 *
 * @see TICKET_274 - Indicator Exit Generator Page (Risk Manager)
 * @see TICKET_247 - Alpha Factory Architecture (Simons-style)
 */

import i18n from 'i18next';
import { pluginApiClient, createStandardPollHandler } from './api-client';
import { API_START_EXIT_STRATEGY, API_CHECK_EXIT_STRATEGY } from '@StratCraft/types';
import { toApiProvider } from '@shared/constants/llm-providers';
import { checkDuplicateRiskRules } from './indicator-duplicate-contract';

// =============================================================================
// Constants
// =============================================================================

const API_ENDPOINTS = {
  START: API_START_EXIT_STRATEGY,
  STATUS: API_CHECK_EXIT_STRATEGY,
};

/** Max rules per configuration */
export const MAX_RISK_RULES = 10;

/**
 * Rule type definitions with UI metadata.
 *
 * TICKET_786_4: `label` is the English fallback; consumers should render
 * `t(labelKey)` against the `strategy-builder` namespace.
 */
export const RISK_RULE_TYPES = [
  { value: 'circuit_breaker', label: 'Circuit Breaker', labelKey: 'riskOverride.ruleTypes.circuit_breaker', icon: 'Zap', color: 'red' },
  { value: 'time_limit', label: 'Time Limit', labelKey: 'riskOverride.ruleTypes.time_limit', icon: 'Clock', color: 'teal' },
  { value: 'regime_detection', label: 'Regime Detection', labelKey: 'riskOverride.ruleTypes.regime_detection', icon: 'Activity', color: 'warning' },
  { value: 'drawdown_limit', label: 'Drawdown Limit', labelKey: 'riskOverride.ruleTypes.drawdown_limit', icon: 'TrendingDown', color: 'red' },
  { value: 'indicator_guard', label: 'Indicator Guard', labelKey: 'riskOverride.ruleTypes.indicator_guard', icon: 'Shield', color: 'primary' },
] as const;

/** Circuit breaker scopes */
export const CB_SCOPES = [
  { value: 'per_position', label: 'Per Position', labelKey: 'riskOverride.cbScopes.per_position' },
  { value: 'per_signal_group', label: 'Per Signal Group', labelKey: 'riskOverride.cbScopes.per_signal_group' },
  { value: 'portfolio', label: 'Portfolio', labelKey: 'riskOverride.cbScopes.portfolio' },
] as const;

/** Rule actions */
export const RULE_ACTIONS = [
  { value: 'close_all', label: 'Close All', labelKey: 'riskOverride.ruleActions.close_all' },
  { value: 'close_position', label: 'Close Position', labelKey: 'riskOverride.ruleActions.close_position' },
  { value: 'reduce_all', label: 'Reduce All Positions', labelKey: 'riskOverride.ruleActions.reduce_all' },
  { value: 'reduce_to', label: 'Reduce To %', labelKey: 'riskOverride.ruleActions.reduce_to' },
  { value: 'halt_trading', label: 'Halt Trading', labelKey: 'riskOverride.ruleActions.halt_trading' },
  { value: 'halt_new_entry', label: 'Halt New Entry', labelKey: 'riskOverride.ruleActions.halt_new_entry' },
] as const;

/** Time limit units */
export const TIME_UNITS = [
  { value: 'hours', label: 'Hours', labelKey: 'riskOverride.timeUnits.hours' },
  { value: 'bars', label: 'Bars', labelKey: 'riskOverride.timeUnits.bars' },
] as const;

/** Decay schedules */
export const DECAY_SCHEDULES = [
  { value: 'none', label: 'None (hard cutoff)', labelKey: 'riskOverride.decaySchedules.none' },
  { value: 'linear', label: 'Linear Decay', labelKey: 'riskOverride.decaySchedules.linear' },
  { value: 'exponential', label: 'Exponential Decay', labelKey: 'riskOverride.decaySchedules.exponential' },
] as const;

/** Recovery modes */
export const RECOVERY_MODES = [
  { value: 'auto', label: 'Auto (when condition clears)', labelKey: 'riskOverride.recoveryModes.auto' },
  { value: 'manual', label: 'Manual Resume', labelKey: 'riskOverride.recoveryModes.manual' },
] as const;

/**
 * Indicator conditions.
 *
 * Numeric operators (`>`, `<`, `>=`, `<=`) are language-agnostic symbols and
 * do not need translation; their `labelKey` resolves to the same symbol.
 */
export const INDICATOR_CONDITIONS = [
  { value: '>', label: '>', labelKey: '' },
  { value: '<', label: '<', labelKey: '' },
  { value: '>=', label: '>=', labelKey: '' },
  { value: '<=', label: '<=', labelKey: '' },
  { value: 'crosses_above', label: 'Crosses Above', labelKey: 'riskOverride.indicatorConditions.crosses_above' },
  { value: 'crosses_below', label: 'Crosses Below', labelKey: 'riskOverride.indicatorConditions.crosses_below' },
] as const;

/** Direction options for per-rule appliesTo field (e.g. indicator_guard) */
export const DIRECTION_OPTIONS = [
  { value: 'long', label: 'Long', labelKey: 'riskOverride.directionOptions.long' },
  { value: 'short', label: 'Short', labelKey: 'riskOverride.directionOptions.short' },
  { value: 'both', label: 'Both', labelKey: 'riskOverride.directionOptions.both' },
] as const;

/** Default values per rule type */
export const RULE_DEFAULTS = {
  circuit_breaker: { triggerPnlPercent: -5, cooldownBars: 10 },
  time_limit: { maxHolding: 48, unit: 'hours' as const },
  regime_detection: { threshold: 2.5, reducePercent: 50 },
  drawdown_limit: { maxDrawdownPercent: -10 },
  indicator_guard: { threshold: 95 },
  hard_safety: { maxLossPercent: -20 },
} as const;

// =============================================================================
// Public Types
// =============================================================================

interface RiskOverrideRuleBase {
  id: string;
  enabled: boolean;
  priority: number;
}

export interface CircuitBreakerRule extends RiskOverrideRuleBase {
  type: 'circuit_breaker';
  triggerPnlPercent: number;
  scope: 'per_position' | 'per_signal_group' | 'portfolio';
  action: 'close_all' | 'reduce_to';
  reduceToPercent?: number;
  cooldownBars: number;
}

export interface TimeLimitRule extends RiskOverrideRuleBase {
  type: 'time_limit';
  maxHolding: number;
  unit: 'hours' | 'bars';
  decay: 'none' | 'linear' | 'exponential';
  action: 'close_all' | 'reduce_to';
  reduceToPercent?: number;
}

export interface RegimeDetectionRule extends RiskOverrideRuleBase {
  type: 'regime_detection';
  indicator: {
    name: string;
    parameters: Record<string, number>;
  };
  condition: '>' | '<' | 'crosses_above' | 'crosses_below';
  threshold: number;
  action: 'reduce_all' | 'close_all' | 'halt_new_entry';
  reducePercent?: number;
  recovery: 'auto' | 'manual';
}

export interface DrawdownLimitRule extends RiskOverrideRuleBase {
  type: 'drawdown_limit';
  maxDrawdownPercent: number;
  action: 'reduce_all' | 'close_all' | 'halt_trading';
  reducePercent?: number;
  recoveryBars?: number;
  recovery: 'auto' | 'manual';
}

export interface IndicatorGuardRule extends RiskOverrideRuleBase {
  type: 'indicator_guard';
  indicator: {
    name: string;
    parameters: Record<string, number>;
  };
  condition: '>' | '<' | '>=' | '<=';
  threshold: number;
  appliesTo: 'long' | 'short' | 'both';
  action: 'close_position' | 'reduce_to';
  reduceToPercent?: number;
}

export type RiskOverrideRule =
  | CircuitBreakerRule
  | TimeLimitRule
  | RegimeDetectionRule
  | DrawdownLimitRule
  | IndicatorGuardRule;

export type RiskRuleType = RiskOverrideRule['type'];

/**
 * Page state interface
 */
export interface IndicatorExitState {
  rules: RiskOverrideRule[];
  hardSafety: {
    maxLossPercent: number;
  };
  storageMode: 'local' | 'remote' | 'hybrid';
  llmProvider: string;
  llmModel: string;
}

/**
 * API config sent to useGenerateWorkflow
 */
export interface RiskOverrideExitConfig {
  strategy_name: string;
  rules: RiskOverrideRule[];
  hard_safety: {
    max_loss_percent: number;
  };
  llm_provider?: string;
  llm_model?: string;
  storage_mode?: 'local' | 'remote' | 'hybrid';
}

/**
 * API result
 */
export interface RiskOverrideExitResult {
  status: 'completed' | 'failed' | 'processing' | 'rejected';
  validation_status?: 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID';
  reason_code?: string;
  strategy_code?: string;
  class_name?: string;
  error?: {
    error_code?: string;
    error_message?: string;
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

// =============================================================================
// Error Handling
// =============================================================================

const EXIT_ERROR_CODES: ReadonlySet<string> = new Set([
  'SECURITY_VIOLATION',
  'INVALID',
  'TIMEOUT',
  'NETWORK_ERROR',
  'TASK_FAILED',
  'LLM_ERROR',
  'GENERATION_FAILED',
  'NO_RULES_ENABLED',
  'INVALID_RULE_CONFIG',
]);

function resolveExitErrorCode(code: string | undefined): string | undefined {
  if (!code || !EXIT_ERROR_CODES.has(code)) return undefined;
  return i18n.t(`errorCodes.${code}`, { ns: 'strategy-builder' });
}

/**
 * Get user-friendly error message from error response
 */
export function getExitErrorMessage(result: RiskOverrideExitResult): string {
  const fromReasonCode = resolveExitErrorCode(result.reason_code);
  if (fromReasonCode) return fromReasonCode;

  const fromErrorCode = resolveExitErrorCode(result.error?.error_code);
  if (fromErrorCode) return fromErrorCode;

  const fromCode = resolveExitErrorCode(result.error?.code);
  if (fromCode) return fromCode;

  if (result.error?.error_message) {
    return result.error.error_message;
  }

  if (result.error?.message) {
    return result.error.message;
  }

  return 'MSG_GENERIC_ERROR';
}

// =============================================================================
// Server Request Types
// =============================================================================

/**
 * Server rule format (snake_case for API)
 */
interface ServerRule {
  type: string;
  priority: number;
  [key: string]: unknown;
}

/**
 * Server request format for /api/start_exit_strategy
 */
interface ServerRequest {
  task_id: string;
  locale: string;
  output_format: 'v3';
  storage_mode: string;
  language?: string; // TICKET_710: Target language for code generation
  exit_config: {
    strategy_name: string;
    exit_model: 'risk_override';
    rules: ServerRule[];
    hard_safety: {
      max_loss_percent: number;
    };
    llm_provider?: string;
    llm_model?: string;
  };
  llm_provider?: string;
  llm_model?: string;
}

// =============================================================================
// Request Builder
// =============================================================================

/**
 * Transform UI rule to server format (camelCase -> snake_case)
 */
function transformRule(rule: RiskOverrideRule): ServerRule {
  const base = {
    type: rule.type,
    priority: rule.priority,
  };

  switch (rule.type) {
    case 'circuit_breaker':
      return {
        ...base,
        trigger_pnl_percent: rule.triggerPnlPercent,
        scope: rule.scope,
        action: rule.action,
        reduce_to_percent: rule.reduceToPercent,
        cooldown_bars: rule.cooldownBars,
      };

    case 'time_limit':
      return {
        ...base,
        max_holding: rule.maxHolding,
        unit: rule.unit,
        decay: rule.decay,
        action: rule.action,
        reduce_to_percent: rule.reduceToPercent,
      };

    case 'regime_detection':
      return {
        ...base,
        indicator: rule.indicator,
        condition: rule.condition,
        threshold: rule.threshold,
        action: rule.action,
        reduce_percent: rule.reducePercent,
        recovery: rule.recovery,
      };

    case 'drawdown_limit':
      return {
        ...base,
        max_drawdown_percent: rule.maxDrawdownPercent,
        action: rule.action,
        reduce_percent: rule.reducePercent,
        recovery_bars: rule.recoveryBars,
        recovery: rule.recovery,
      };

    case 'indicator_guard':
      return {
        ...base,
        indicator: rule.indicator,
        condition: rule.condition,
        threshold: rule.threshold,
        applies_to: rule.appliesTo,
        action: rule.action,
        reduce_to_percent: rule.reduceToPercent,
      };
  }
}

/**
 * Build server request from client config
 */
function buildServerRequest(config: RiskOverrideExitConfig): ServerRequest {
  const enabledRules = config.rules.filter(r => r.enabled);
  const serverRules = enabledRules.map(transformRule);

  const taskId = `exit_strategy_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  return {
    // TICKET_1220: code generation is always English-only (TICKET_850);
    // locale must not follow UI language or OS locale.
    locale: 'en_US',
    task_id: taskId,
    output_format: 'v3',
    storage_mode: config.storage_mode || 'local',
    language: 'cpp', // TICKET_710: Explicit C++ target language for SDK-compliant code generation
    exit_config: {
      strategy_name: config.strategy_name || i18n.t('common.untitledExit', { ns: 'strategy-builder' }),
      exit_model: 'risk_override',
      rules: serverRules,
      hard_safety: config.hard_safety,
      llm_provider: toApiProvider(config.llm_provider || ''),
      llm_model: config.llm_model || '',
    },
    llm_provider: toApiProvider(config.llm_provider || ''),
    llm_model: config.llm_model || '',
  };
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * TICKET_1208_1: Build generation request for main-process polling.
 * Returns the start/poll endpoints and request body without resolving
 * the API key (the main process handles BYOK injection).
 */
export function buildRiskOverrideExitRequest(config: RiskOverrideExitConfig): {
  startEndpoint: string;
  pollEndpoint: string;
  requestBody: Record<string, unknown>;
} {
  const requestPayload = buildServerRequest(config);
  return {
    startEndpoint: API_ENDPOINTS.START,
    pollEndpoint: API_ENDPOINTS.STATUS,
    requestBody: requestPayload as unknown as Record<string, unknown>,
  };
}

/**
 * Execute Risk Override Exit generation
 *
 * TICKET_274: Calls /api/start_exit_strategy which generates
 * ExitSignalBase strategies with risk override rules.
 */
export async function executeRiskOverrideExit(
  config: RiskOverrideExitConfig,
  signal?: AbortSignal
): Promise<RiskOverrideExitResult> {
  const requestPayload = buildServerRequest(config);

  console.debug('[RiskOverrideExit] Calling API:', API_ENDPOINTS.START);
  console.debug('[RiskOverrideExit] Request payload:', JSON.stringify(requestPayload, null, 2).substring(0, 1000));

  return await pluginApiClient.executeWithPolling<RiskOverrideExitResult>({
    initialData: requestPayload,
    startEndpoint: API_ENDPOINTS.START,
    pollEndpoint: API_ENDPOINTS.STATUS,
    signal,

    // TICKET_417: Centralized poll handler
    // Layer 2 standard: strategy_code and class_name at result top level
    handlePollResponse: createStandardPollHandler<RiskOverrideExitResult>(
      'RiskOverrideExit',
      (status, result) => ({
        status: status as RiskOverrideExitResult['status'],
        validation_status: result?.validation_status as RiskOverrideExitResult['validation_status'],
        reason_code: result?.reason_code as string | undefined,
        strategy_code: result?.strategy_code as string | undefined,
        class_name: result?.class_name as string | undefined,
        error: result?.error as RiskOverrideExitResult['error'],
      }),
    ),
  });
}

/**
 * Validate Risk Override Exit configuration.
 * `error` is an i18n key resolved by useGenerateWorkflow.
 */
export function validateRiskOverrideExitConfig(
  config: Partial<RiskOverrideExitConfig>
): { valid: boolean; error?: string; errorParams?: Record<string, unknown> } {
  if (!config.rules || config.rules.length === 0) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_RISK_AT_LEAST_ONE_RULE' };
  }

  const enabledRules = config.rules.filter(r => r.enabled);
  if (enabledRules.length === 0) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_RISK_AT_LEAST_ONE_ENABLED' };
  }

  // Validate each enabled rule
  for (const rule of enabledRules) {
    switch (rule.type) {
      case 'circuit_breaker':
        if (rule.triggerPnlPercent >= 0) {
          return { valid: false, error: 'MSG_BUILDER_VALIDATION_RISK_CB_TRIGGER_NEGATIVE' };
        }
        if (rule.cooldownBars < 0) {
          return { valid: false, error: 'MSG_BUILDER_VALIDATION_RISK_CB_COOLDOWN_NONNEG' };
        }
        break;

      case 'time_limit':
        if (rule.maxHolding <= 0) {
          return { valid: false, error: 'MSG_BUILDER_VALIDATION_RISK_TIME_LIMIT_POSITIVE' };
        }
        break;

      case 'regime_detection':
        if (!rule.indicator?.name) {
          return { valid: false, error: 'MSG_BUILDER_VALIDATION_RISK_REGIME_INDICATOR_REQUIRED' };
        }
        break;

      case 'drawdown_limit':
        if (rule.maxDrawdownPercent >= 0) {
          return { valid: false, error: 'MSG_BUILDER_VALIDATION_RISK_DD_NEGATIVE' };
        }
        break;

      case 'indicator_guard':
        if (!rule.indicator?.name) {
          return { valid: false, error: 'MSG_BUILDER_VALIDATION_RISK_GUARD_INDICATOR_REQUIRED' };
        }
        break;
    }
  }

  // TICKET_1227: refuse duplicate enabled rules (identical semantics, id/priority aside).
  const duplicate = checkDuplicateRiskRules(enabledRules);
  if (duplicate) {
    return { valid: false, ...duplicate };
  }

  // Validate hard safety
  if (!config.hard_safety || config.hard_safety.max_loss_percent >= 0) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_RISK_HARD_SAFETY_NEGATIVE' };
  }

  return { valid: true };
}
