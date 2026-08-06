/**
 * Regime Indicator Entry Service - Plugin Layer
 *
 * TICKET_203: Renamed from kronos-indicator-entry-service.ts
 * TICKET_201 Phase 4: Corrected API for Entry Signal generation
 *
 * Uses: /api/start_regime_indicator_entry (NOT /api/start_kronos_indicator_entry)
 *
 * This service generates TrendStrategyBase/RangeStrategyBase/StandaloneStrategyBase strategies that:
 * - check_open_conditions() -> (long_signal, short_signal)
 * - check_close_conditions() -> bool
 * - Execute actual trades (unlike MarketStateBase which only detects states)
 *
 * @see TICKET_201 - Workflow Strategy Code Generation Fix
 * @see TICKET_202 - Builder Page Base Class Mapping
 * @see TICKET_203 - Regime Indicator Entry Service Rename
 */

import i18n from 'i18next';
import { pluginApiClient, createStandardPollHandler } from './api-client';
import { toApiProvider } from '@shared/constants/llm-providers';
import { API_START_ENTRY_SIGNAL, API_CHECK_ENTRY_SIGNAL } from '@StratCraft/types';
import {
  checkBoundaryThresholdParam,
  resolveBoundaryThresholdParam,
} from './strategy-logic-contract';
import { checkDuplicateTemplateRules } from './indicator-duplicate-contract';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const API_ENDPOINTS = {
  START: API_START_ENTRY_SIGNAL,
  STATUS: API_CHECK_ENTRY_SIGNAL,
};

// -----------------------------------------------------------------------------
// Public Types (used by EntrySignalPage)
// -----------------------------------------------------------------------------

export interface RegimeIndicatorEntryConfig {
  strategy_name: string;
  rules: IndicatorEntryRule[];
  entry_signal_base?: 'standalone' | 'trend' | 'range';
  llm_provider?: string;
  llm_model?: string;
  storage_mode?: 'local' | 'remote' | 'hybrid';
  /** TICKET_260: Auto-reverse mode - short condition auto-generated as inverse of long */
  auto_reverse?: boolean;
}

export interface IndicatorEntryRule {
  rule_type: 'template_based' | 'custom_expression' | 'factor_based';
  indicator?: {
    slug: string;
    name: string;
    params?: Record<string, unknown>;
  };
  strategy?: {
    logic: {
      type?: string;
      operator?: string;
      threshold_value?: string | number;
      line1?: string;
      line2?: string;
      threshold_param?: string;
      band?: string;
      signal_when_value_is?: number;
      signal_type?: string;
    };
    params?: Record<string, unknown>;
  };
  expression?: string;
  factor?: {
    name: string;
    category: string;
    params?: Record<string, unknown>;
  };
}

export interface RegimeIndicatorEntryResult {
  status: 'completed' | 'failed' | 'processing' | 'rejected';
  validation_status?: 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID';
  reason_code?: string;
  strategy_code?: string;
  class_name?: string;
  /** TICKET_010: C++23 stratforge:: code generation support */
  language?: 'python' | 'cpp';
  includes?: string[];
  strategy_class?: string;
  error?: {
    error_code?: string;
    error_message?: string;
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Known error codes for Regime Indicator Entry service.
 * Values are resolved via i18n at lookup time (strategy-builder:errorCodes.XXX).
 */
const ENTRY_ERROR_CODES: ReadonlySet<string> = new Set([
  'SECURITY_VIOLATION',
  'INVALID',
  'SYNTAX_ERROR',
  'UNKNOWN_INDICATOR',
  'UNSUPPORTED_OPERATOR',
  'TIMEOUT',
  'NETWORK_ERROR',
  'TASK_FAILED',
  'LLM_ERROR',
  'GENERATION_FAILED',
  'SPEC_NOT_TRADING_ALGORITHM',
]);

/**
 * Resolve a known error code to a localized message via i18n.
 * Returns undefined if the code is not in the known set.
 */
function resolveErrorCode(code: string | undefined): string | undefined {
  if (!code || !ENTRY_ERROR_CODES.has(code)) return undefined;
  return i18n.t(`errorCodes.${code}`, { ns: 'strategy-builder' });
}

/**
 * Get user-friendly error message from error response
 */
export function getEntryErrorMessage(result: RegimeIndicatorEntryResult): string {
  const fromReasonCode = resolveErrorCode(result.reason_code);
  if (fromReasonCode) return fromReasonCode;

  const fromErrorCode = resolveErrorCode(result.error?.error_code);
  if (fromErrorCode) return fromErrorCode;

  const fromCode = resolveErrorCode(result.error?.code);
  if (fromCode) return fromCode;

  if (result.error?.error_message) {
    return result.error.error_message;
  }

  if (result.error?.message) {
    return result.error.message;
  }

  return 'MSG_GENERIC_ERROR';
}

// -----------------------------------------------------------------------------
// Server Request Types (matches /api/start_regime_indicator_entry format)
// -----------------------------------------------------------------------------

/**
 * Server indicator rule format
 * @see nona_server/src/observer/entry_signal_google.py
 */
interface ServerIndicatorRule {
  indicator: {
    slug: string;
    name: string;
    params: Record<string, unknown>;
  };
  strategy: {
    type: string;
    label?: string;
    logic: {
      operator?: string;
      threshold_value?: string | number;
      line1?: string;
      line2?: string;
      threshold_param?: string;
      band?: string;
      signal_when_value_is?: number;
      signal_type?: string;
    };
  };
}

/**
 * Server request format for /api/start_regime_indicator_entry
 * @see nona_server/src/main_service/business/market_analysis_business.py
 */
interface ServerRequest {
  task_id?: string;
  locale?: string;
  output_format?: 'v1' | 'v3'; // TICKET_223: V3 framework import format
  storage_mode: 'local' | 'remote' | 'hybrid';
  language?: string; // TICKET_710: Target language for code generation
  /** TICKET_260: Auto-reverse mode */
  auto_reverse?: boolean;
  regime_indicator_entry_config: {
    longEntryIndicators: ServerIndicatorRule[];
    shortEntryIndicators: ServerIndicatorRule[];
    strategy_name: string;
    entry_signal_base: string;
    llm_provider?: string;
    llm_model?: string;
    /** TICKET_260: Auto-reverse mode (also in config for compatibility) */
    auto_reverse?: boolean;
  };
  llm_provider?: string;
  llm_model?: string;
}

// -----------------------------------------------------------------------------
// Request Builder
// -----------------------------------------------------------------------------

/**
 * TICKET_714: Map UI template key to backend strategy.type
 * @see market-observer-service.ts TEMPLATE_KEY_TO_TYPE
 * @see @StratCraft/types STRATEGY_TEMPLATE_CATALOG
 */
const TEMPLATE_KEY_TO_TYPE: Record<string, string> = {
  threshold_simple: 'threshold_level',
  volatility_threshold: 'threshold_level',
  volume_spike: 'threshold_level',
  crossover_price_indicator: 'crossover',
  crossover_fast_slow_ma: 'crossover',
  boundary_comparison_oscillator: 'boundary_comparison',
  band_break_bollinger: 'band_break',
  pattern_recognition: 'pattern_detected',
};

/**
 * TICKET_714: Build strategy.logic dict per backend prompt template contract.
 * Each strategy.type requires specific logic fields.
 * @see market-observer-service.ts buildStrategyLogic
 */
function buildStrategyLogic(
  strategyType: string,
  ruleLogic: IndicatorEntryRule['strategy'],
): ServerIndicatorRule['strategy']['logic'] {
  const logic = ruleLogic?.logic || {};
  const operator = logic.operator || '>';

  switch (strategyType) {
    case 'crossover':
      return {
        operator,
        line1: logic.line1 || 'price',
        line2: logic.line2 || 'indicator',
      };

    case 'indicator_crossover':
      return {
        operator,
        line1: logic.line1 || 'fast_indicator',
        line2: logic.line2 || 'slow_indicator',
      };

    case 'boundary_comparison':
      return {
        operator,
        threshold_param: resolveBoundaryThresholdParam(operator, logic.threshold_param),
      };

    case 'band_break':
      return {
        operator,
        band: logic.line2 || logic.band || (operator === '>' ? 'upperband' : 'lowerband'),
      };

    case 'pattern_detected':
      return {
        signal_when_value_is: logic.signal_when_value_is ?? 100,
        signal_type: logic.signal_type || 'bullish',
      };

    case 'threshold_level':
    default:
      return {
        operator,
        threshold_value: logic.threshold_value ?? 0,
      };
  }
}

/**
 * Transform UI indicator rule to server format
 */
function transformRule(rule: IndicatorEntryRule): ServerIndicatorRule | null {
  // Only template_based rules are supported for now
  if (rule.rule_type !== 'template_based') {
    console.warn('[W:STRATEGY:REGIME_ENTRY_SKIP_NON_TEMPLATE] [RegimeIndicatorEntry] Skipping non-template rule:', rule.rule_type);
    return null;
  }

  if (!rule.indicator?.slug) {
    console.warn('[W:STRATEGY:REGIME_ENTRY_SKIP_NO_SLUG] [RegimeIndicatorEntry] Skipping rule without indicator slug');
    return null;
  }

  // TICKET_714: Map template key to backend type before dispatching logic fields
  const rawType = rule.strategy?.logic?.type || 'threshold_level';
  const strategyType = TEMPLATE_KEY_TO_TYPE[rawType] || rawType;
  const logic = buildStrategyLogic(strategyType, rule.strategy);

  return {
    indicator: {
      slug: rule.indicator.slug,
      name: rule.indicator.name || rule.indicator.slug,
      params: (rule.indicator.params || {}) as Record<string, unknown>,
    },
    strategy: {
      type: strategyType,
      logic,
    },
  };
}

/**
 * Build server request from client config
 * TICKET_260: Include auto_reverse parameter
 */
function buildServerRequest(config: RegimeIndicatorEntryConfig): ServerRequest {
  // Transform all rules to server format
  // For now, all rules go to longEntryIndicators
  // TODO: Support separate long/short indicators from UI
  const serverRules: ServerIndicatorRule[] = [];

  for (const rule of config.rules) {
    const transformed = transformRule(rule);
    if (transformed) {
      serverRules.push(transformed);
    }
  }

  // Generate task_id
  const taskId = `regime_indicator_entry_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  // TICKET_260: Default to true if not specified
  const autoReverse = config.auto_reverse !== false;

  return {
    task_id: taskId,
    // TICKET_1220: code generation is always English-only (TICKET_850);
    // locale must not follow UI language or OS locale.
    locale: 'en_US',
    output_format: 'v3', // TICKET_223: V3 framework import format
    storage_mode: config.storage_mode || 'local',
    language: 'cpp', // TICKET_710: Explicit C++ target language for SDK-compliant code generation
    // TICKET_260: Auto-reverse mode (top level)
    auto_reverse: autoReverse,
    regime_indicator_entry_config: {
      longEntryIndicators: serverRules,
      shortEntryIndicators: [], // TODO: Support from UI
      strategy_name: config.strategy_name || i18n.t('common.untitledEntry', { ns: 'strategy-builder' }),
      entry_signal_base: config.entry_signal_base || 'standalone',
      // TICKET_644: No silent fallback -- provider must be set by caller
      llm_provider: toApiProvider(config.llm_provider || ''),
      llm_model: config.llm_model || '',
      // TICKET_260: Auto-reverse mode (also in config for compatibility)
      auto_reverse: autoReverse,
    },
    // TICKET_644: No silent fallback -- provider must be set by caller
    llm_provider: toApiProvider(config.llm_provider || ''),
    llm_model: config.llm_model || '',
  };
}

// -----------------------------------------------------------------------------
// Service Functions
// -----------------------------------------------------------------------------

/**
 * TICKET_1208_1: Build generation request for main-process polling.
 * Returns the start/poll endpoints and request body without resolving
 * the API key (the main process handles BYOK injection).
 */
export function buildRegimeIndicatorEntryRequest(config: RegimeIndicatorEntryConfig): {
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
 * Execute Regime Indicator Entry generation
 *
 * TICKET_201: Calls /api/start_regime_indicator_entry which generates
 * TrendStrategyBase/RangeStrategyBase/StandaloneStrategyBase strategies with actual trading logic.
 */
export async function executeRegimeIndicatorEntry(
  config: RegimeIndicatorEntryConfig,
  signal?: AbortSignal
): Promise<RegimeIndicatorEntryResult> {
  const requestPayload = buildServerRequest(config);

  console.debug('[RegimeIndicatorEntry] Calling API:', API_ENDPOINTS.START);
  console.debug('[RegimeIndicatorEntry] Request payload:', JSON.stringify(requestPayload, null, 2).substring(0, 1000));

  return await pluginApiClient.executeWithPolling<RegimeIndicatorEntryResult>({
    initialData: requestPayload,
    startEndpoint: API_ENDPOINTS.START,
    pollEndpoint: API_ENDPOINTS.STATUS,
    signal,

    // TICKET_417: Centralized poll handler
    // Layer 2 standard: strategy_code and class_name at result top level
    handlePollResponse: createStandardPollHandler<RegimeIndicatorEntryResult>(
      'RegimeIndicatorEntry',
      (status, result) => ({
        status: status as RegimeIndicatorEntryResult['status'],
        validation_status: result?.validation_status as RegimeIndicatorEntryResult['validation_status'],
        reason_code: result?.reason_code as string | undefined,
        strategy_code: result?.strategy_code as string | undefined,
        class_name: result?.class_name as string | undefined,
        language: 'cpp' as const,
        includes: result?.includes as string[] | undefined,
        strategy_class: result?.strategy_class as string | undefined,
        error: result?.error as RegimeIndicatorEntryResult['error'],
      }),
    ),
  });
}

/**
 * Validate Regime Indicator Entry configuration.
 * `error` is an i18n key resolved by useGenerateWorkflow.
 */
export function validateRegimeIndicatorEntryConfig(
  config: Partial<RegimeIndicatorEntryConfig>
): { valid: boolean; error?: string; errorParams?: Record<string, unknown> } {
  // TICKET_644: Validate LLM provider is configured (no silent NONA fallback)
  if (!config.llm_provider) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_LLM_PROVIDER_REQUIRED' };
  }

  if (!config.rules || config.rules.length === 0) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_AT_LEAST_ONE_INDICATOR_RULE' };
  }

  for (const rule of config.rules) {
    if (rule.rule_type === 'template_based') {
      if (!rule.indicator?.slug) {
        return { valid: false, error: 'MSG_BUILDER_VALIDATION_TEMPLATE_REQUIRES_INDICATOR' };
      }
      // TICKET_1224: fail fast when boundary_comparison references a
      // threshold_param the indicator does not define (backend rejects it).
      const violation = checkBoundaryThresholdParam(rule);
      if (violation) {
        return { valid: false, ...violation };
      }
    } else if (rule.rule_type === 'custom_expression') {
      if (!rule.expression || rule.expression.length < 3) {
        return { valid: false, error: 'MSG_BUILDER_VALIDATION_CUSTOM_EXPR_MIN_LEN' };
      }
    } else if (rule.rule_type === 'factor_based') {
      if (!rule.factor?.name) {
        return { valid: false, error: 'MSG_BUILDER_VALIDATION_FACTOR_REQUIRES_NAME' };
      }
    }
  }

  // TICKET_1227: refuse duplicate indicator rules (same indicator, params, logic).
  const duplicate = checkDuplicateTemplateRules(config.rules);
  if (duplicate) {
    return { valid: false, ...duplicate };
  }

  return { valid: true };
}
