/**
 * Market Observer Service - Plugin Layer
 *
 * Provides market observation and watchlist precondition functionality.
 * Part of Trader Mode in Strategy Builder.
 *
 * @see TICKET_077_1 - Page 35 (MarketObserverPage)
 * @see TICKET_202 - Builder Page Base Class Mapping
 * @see TICKET_211 - Market Observer API Integration
 * @see ISSUE_7016 - Market Observer API Protocol Specification
 */

import i18n from 'i18next';
import { pluginApiClient, createStandardPollHandler } from './api-client';
import { API_START_WATCHLIST, API_CHECK_WATCHLIST } from '@StratCraft/types';
import { toApiProvider } from '@shared/constants/llm-providers';
import { isWatchlistSupportedIndicatorSlug } from './watchlist-indicator-support';
import {
  checkBoundaryThresholdParam,
  resolveBoundaryThresholdParam,
} from './strategy-logic-contract';
import { checkDuplicateTemplateRules } from './indicator-duplicate-contract';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const API_ENDPOINTS = {
  START: API_START_WATCHLIST,
  STATUS: API_CHECK_WATCHLIST,
};

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface MarketObserverConfig {
  rules: MarketObserverRule[];
  strategy_name?: string;
  llm_provider?: string;
  llm_model?: string;
  storage_mode?: 'local' | 'remote' | 'hybrid';
}

export interface MarketObserverRule {
  rule_type: 'template_based';
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
      /** crossover / band_break: first line (price, fast_indicator) */
      line1?: string;
      /** crossover / band_break: second line (indicator, slow_indicator, upperband) */
      line2?: string;
      /** band_break: band name (upperband / middleband / lowerband) */
      band?: string;
      /** boundary_comparison: threshold param (upperband / lowerband) */
      threshold_param?: string;
      /** pattern_detected: signal trigger value */
      signal_when_value_is?: number;
      /** pattern_detected: signal type (bullish / bearish / reversal_*) */
      signal_type?: string;
    };
  };
}

export interface MarketObserverResult {
  status: 'completed' | 'failed' | 'processing' | 'rejected';
  validation_status?: 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID';
  reason_code?: string;
  strategy_code?: string;
  /** ISSUE_7252: C++ nonabt migration fields */
  language?: 'python' | 'cpp';
  includes?: string[];
  class_name?: string;
  base_class?: string;
  error?: {
    error_code?: string;
    error_message?: string;
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Known error codes for Market Observer service.
 * Values are resolved via i18n at lookup time (strategy-builder:errorCodes.XXX).
 */
const OBSERVER_ERROR_CODES: ReadonlySet<string> = new Set([
  // Security violations
  'SECURITY_VIOLATION',
  // Validation errors
  'INVALID',
  'SYNTAX_ERROR',
  'UNKNOWN_INDICATOR',
  'UNSUPPORTED_OPERATOR',
  'STRATEGY_CONFIG_INVALID',
  // Network/System errors
  'TIMEOUT',
  'NETWORK_ERROR',
  'TASK_FAILED',
  // Auth/Quota errors (ISSUE_7234)
  'AUTH_ERROR',
  'QUOTA_EXCEEDED',
  // LLM errors
  'LLM_ERROR',
  'LLM_PROVIDER_ERROR',
  'GENERATION_FAILED',
]);

/**
 * Resolve a known error code to a localized message via i18n.
 * Returns undefined if the code is not in the known set.
 */
function resolveErrorCode(code: string | undefined): string | undefined {
  if (!code || !OBSERVER_ERROR_CODES.has(code)) return undefined;
  return i18n.t(`errorCodes.${code}`, { ns: 'strategy-builder' });
}

/**
 * Get user-friendly error message from error response
 */
export function getErrorMessage(result: MarketObserverResult): string {
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
// Request Builder Types (ISSUE_7016 Protocol)
// -----------------------------------------------------------------------------

/**
 * Server request format per ISSUE_7016 / ISSUE_7252
 * - symbol, item_type, strategy_name in operation_data
 * - llm_provider, llm_model, temporary_api_key, storage_mode at top level
 * - condition_type removed (ISSUE_7252: nonabt C++ only, no expression mode)
 * - output_format removed (backend always produces C++)
 */
interface ServerRequest {
  operation_type: 'add_item' | 'remove_item' | 'add_alert' | 'get_list' | 'get_item';
  locale?: string;
  llm_provider: string;
  llm_model: string;
  temporary_api_key?: string;
  storage_mode: 'local' | 'remote' | 'hybrid';
  language?: string; // TICKET_710: Target language for code generation
  operation_data: {
    symbol: string;
    item_type: 'CRYPTO' | 'STOCK' | 'FUND';
    strategy_name: string;
    indicator?: {
      name: string;
      slug: string;
      params?: Record<string, unknown>;
    };
    strategy?: {
      type: string;
      label?: string;
      description?: string;
      logic: Record<string, unknown>;
    };
  };
}

// -----------------------------------------------------------------------------
// Request Builder (ISSUE_7016 Protocol)
// -----------------------------------------------------------------------------

/**
 * Map templateKey to backend strategy.type
 * Backend supports: threshold_level, crossover, band_break, indicator_crossover,
 *                   boundary_comparison, pattern_detected
 * @see @StratCraft/types STRATEGY_TEMPLATE_CATALOG
 */
const TEMPLATE_KEY_TO_TYPE: Record<string, string> = {
  // threshold_level
  threshold_simple: 'threshold_level',
  volatility_threshold: 'threshold_level',
  volume_spike: 'threshold_level',
  // crossover
  crossover_price_indicator: 'crossover',
  crossover_fast_slow_ma: 'crossover',
  // boundary_comparison
  boundary_comparison_oscillator: 'boundary_comparison',
  // band_break
  band_break_bollinger: 'band_break',
  // pattern_detected
  pattern_recognition: 'pattern_detected',
};

/**
 * Convert templateKey to backend strategy.type
 */
function mapTemplateKeyToType(templateKey: string | undefined): string {
  if (!templateKey) return 'threshold_level';
  return TEMPLATE_KEY_TO_TYPE[templateKey] || templateKey;
}


/**
 * Resolve API key for the selected provider and model
 */
async function resolveApiKeyForProvider(providerId: string, modelId: string): Promise<string | undefined> {
  // TICKET_516: PRO_CATALOG provider does not need API key (platform handles it)
  if (providerId === 'PRO_CATALOG') {
    return undefined;
  }

  try {
    let keyProviderId = providerId;

    const result = await window.electronAPI.entitlement.resolveLLMApiKey(keyProviderId);
    if (result.success && result.data?.key) {
      return result.data.key;
    }
    return undefined;
  } catch (error) {
    console.error(`[E:STRATEGY:MARKET_OBSERVER_API_KEY_FAILED] [MarketObserverService] Failed to resolve API key:`, error);
    return undefined;
  }
}

function mapModelToProvider(modelId: string): string {
  if (modelId.startsWith('gpt-') || modelId.startsWith('o3-')) return 'OPENAI';
  if (modelId.startsWith('claude-')) return 'CLAUDE';
  if (modelId.startsWith('gemini-')) return 'GEMINI';
  if (modelId.startsWith('deepseek-')) return 'DEEPSEEK';
  if (modelId.startsWith('grok-')) return 'GROK';
  if (modelId.startsWith('qwen')) return 'QWEN';
  return 'PRO_CATALOG';
}

/**
 * Build strategy.logic dict per backend prompt template contract
 * (template-watchlist-code-generation.ch:29-46).
 *
 * Each strategy.type requires specific logic fields:
 * - threshold_level:       operator, threshold_value
 * - crossover:             operator, line1, line2
 * - boundary_comparison:   operator, threshold_param
 * - band_break:            operator, band (line2)
 * - indicator_crossover:   operator, line1, line2
 * - pattern_detected:      signal_when_value_is, signal_type
 */
function buildStrategyLogic(
  strategyType: string,
  ruleLogic: MarketObserverRule['strategy'],
): Record<string, unknown> {
  const logic = ruleLogic?.logic || {};
  const operator = logic.operator || '>';

  switch (strategyType) {
    case 'threshold_level':
      return {
        operator,
        threshold_value: logic.threshold_value ?? 0,
      };

    case 'crossover':
      return {
        operator,
        line1: logic.line1 || 'price',
        line2: logic.line2 || 'indicator',
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

    case 'indicator_crossover':
      return {
        operator,
        line1: logic.line1 || 'fast_indicator',
        line2: logic.line2 || 'slow_indicator',
      };

    case 'pattern_detected':
      return {
        signal_when_value_is: logic.signal_when_value_is ?? 100,
        signal_type: logic.signal_type || 'bullish',
      };

    default:
      // Unknown type: pass through all logic fields
      return { operator, ...logic };
  }
}

/**
 * Build human-readable label from indicator + logic for the strategy field
 */
function buildStrategyLabel(
  indicatorName: string,
  strategyType: string,
  logic: Record<string, unknown>,
): string {
  const op = logic.operator || '>';

  switch (strategyType) {
    case 'threshold_level':
      return `${indicatorName} ${op} ${logic.threshold_value ?? 0}`;
    case 'crossover':
      return `${indicatorName} ${logic.line1 || 'price'} ${op === '>' ? 'crosses above' : 'crosses below'} ${logic.line2 || 'indicator'}`;
    case 'boundary_comparison':
      return `${indicatorName} ${op} ${logic.threshold_param || 'boundary'}`;
    case 'band_break':
      return `${indicatorName} breaks ${logic.band || 'band'}`;
    case 'pattern_detected':
      return `${indicatorName} ${logic.signal_type || 'bullish'} pattern detected`;
    default:
      return `${indicatorName} ${op} ${logic.threshold_value ?? 0}`;
  }
}

/**
 * Build server request per ISSUE_7016 protocol
 * - symbol, item_type in operation_data
 * - llm_provider, llm_model, storage_mode at top level
 *
 * TICKET_688: strategy field must include full logic dict per backend
 * prompt template contract (template-watchlist-code-generation.ch:29-46).
 */
function buildServerRequest(config: MarketObserverConfig, apiKey?: string): ServerRequest {
  const strategyName = config.strategy_name || i18n.t('common.untitledObserver', { ns: 'strategy-builder' });

  // Build operation_data - always indicator mode (ISSUE_7252: expression mode removed)
  const operationData: ServerRequest['operation_data'] = {
    symbol: 'BTC/USDT',
    item_type: 'CRYPTO',
    strategy_name: strategyName,
  };

  // Single indicator rule (nonabt C++ only path)
  const rule = config.rules[0];
  if (rule) {
    const indicatorName = rule.indicator?.name || rule.indicator?.slug || '';
    const strategyType = mapTemplateKeyToType(rule.strategy?.logic?.type);
    const logic = buildStrategyLogic(strategyType, rule.strategy);
    const label = buildStrategyLabel(indicatorName, strategyType, logic);

    operationData.indicator = {
      name: indicatorName,
      slug: rule.indicator?.slug || '',
      params: rule.indicator?.params,
    };
    operationData.strategy = {
      type: strategyType,
      label,
      description: `${rule.strategy?.logic?.operator || '>'} ${rule.strategy?.logic?.threshold_value ?? 0}`,
      logic,
    };
  }

  return {
    operation_type: 'add_item',
    // TICKET_1220: code generation is always English-only (TICKET_850);
    // locale must not follow UI language or OS locale.
    locale: 'en_US',
    // TICKET_644: No silent fallback -- provider must be set by caller
    llm_provider: toApiProvider(config.llm_provider || ''),
    llm_model: config.llm_model || '',
    temporary_api_key: apiKey,
    storage_mode: config.storage_mode || 'local',
    language: 'cpp', // TICKET_710: Explicit C++ target language for SDK-compliant code generation
    operation_data: operationData,
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
export function buildMarketObserverRequest(config: MarketObserverConfig): {
  startEndpoint: string;
  pollEndpoint: string;
  requestBody: Record<string, unknown>;
} {
  const requestPayload = buildServerRequest(config, undefined);
  return {
    startEndpoint: API_ENDPOINTS.START,
    pollEndpoint: API_ENDPOINTS.STATUS,
    requestBody: requestPayload as unknown as Record<string, unknown>,
  };
}

/**
 * Execute market observer generation
 */
export async function executeMarketObserverGeneration(
  config: MarketObserverConfig,
  signal?: AbortSignal
): Promise<MarketObserverResult> {
  // TICKET_644: No silent fallback -- provider must be set by caller
  const providerId = config.llm_provider || '';
  const modelId = config.llm_model || '';
  const apiKey = await resolveApiKeyForProvider(providerId, modelId);

  const requestPayload = buildServerRequest(config, apiKey);

  return await pluginApiClient.executeWithPolling<MarketObserverResult>({
    initialData: requestPayload,
    startEndpoint: API_ENDPOINTS.START,
    pollEndpoint: API_ENDPOINTS.STATUS,
    signal,

    // TICKET_417: Centralized poll handler
    // ISSUE_7252: Backend wraps C++ response in result.operation_result.data.*
    handlePollResponse: createStandardPollHandler<MarketObserverResult>(
      'MarketObserver',
      (status, result) => {
        // Unwrap nested operation_result.data structure
        const opData = (result?.operation_result as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
        const strategyCode = (opData?.strategy_code ?? result?.strategy_code) as string | undefined;
        const language = (opData?.language ?? result?.language) as MarketObserverResult['language'];
        const includes = (opData?.includes ?? result?.includes) as string[] | undefined;
        const className = (opData?.class_name ?? result?.class_name) as string | undefined;
        const baseClass = (opData?.base_class ?? result?.base_class) as string | undefined;

        return {
          ...(result || {}),
          status: status as MarketObserverResult['status'],
          validation_status: result?.validation_status as MarketObserverResult['validation_status'],
          reason_code: result?.reason_code as string | undefined,
          strategy_code: strategyCode,
          language,
          includes,
          class_name: className,
          base_class: baseClass,
          error: result?.error as MarketObserverResult['error'],
        } as MarketObserverResult;
      },
    ),
  });
}

/**
 * Validate market observer configuration.
 * `error` is an i18n key resolved by useGenerateWorkflow.
 */
export function validateMarketObserverConfig(
  config: Partial<MarketObserverConfig>
): { valid: boolean; error?: string; errorParams?: Record<string, unknown> } {
  // TICKET_644: Validate LLM provider is configured (no silent NONA fallback)
  if (!config.llm_provider) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_LLM_PROVIDER_REQUIRED' };
  }

  if (!config.rules || config.rules.length === 0) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_AT_LEAST_ONE_RULE' };
  }

  for (const rule of config.rules) {
    if (!rule.indicator?.slug) {
      return { valid: false, error: 'MSG_BUILDER_VALIDATION_RULE_REQUIRES_INDICATOR' };
    }
    if (!isWatchlistSupportedIndicatorSlug(rule.indicator.slug)) {
      return {
        valid: false,
        error: 'MSG_BUILDER_VALIDATION_INDICATOR_NOT_AVAILABLE_WATCHLIST',
        errorParams: { slug: rule.indicator.slug },
      };
    }
    // TICKET_1224: fail fast when boundary_comparison references a
    // threshold_param the indicator does not define (backend rejects it).
    const violation = checkBoundaryThresholdParam(rule);
    if (violation) {
      return { valid: false, ...violation };
    }
  }

  // TICKET_1227: refuse duplicate indicator rules (same indicator, params, logic).
  const duplicate = checkDuplicateTemplateRules(config.rules);
  if (duplicate) {
    return { valid: false, ...duplicate };
  }

  return { valid: true };
}
