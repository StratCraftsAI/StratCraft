/**
 * Market Regime Service - Plugin Layer (TICKET_091, TICKET_095)
 *
 * Provides market regime analysis functionality directly from plugin.
 * Uses plugin's own API client (CSP relaxed per TICKET_091).
 *
 * @see TICKET_091 - Desktop CSP Relaxation
 * @see TICKET_095 - Inline Code Display After Generate
 */

import i18n from 'i18next';
import { pluginApiClient, createStandardPollHandler } from './api-client';
import { API_START_MARKET_REGIME, API_CHECK_MARKET_REGIME } from '@StratCraft/types';
import { toApiProvider } from '@shared/constants/llm-providers';
import { checkDuplicateTemplateRules } from './indicator-duplicate-contract';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const API_ENDPOINTS = {
  START: API_START_MARKET_REGIME,
  STATUS: API_CHECK_MARKET_REGIME,
};

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface MarketRegimeConfig {
  regime: string;
  rules: MarketRegimeRule[];
  strategy_name?: string;
  bespoke_notes?: string;
  llm_provider?: string;
  llm_model?: string;
  /** TICKET_200: Storage mode preference - tells server whether to store generated data */
  storage_mode?: 'local' | 'remote' | 'hybrid';
  /** TICKET_260: Auto-reverse mode - range condition auto-generated as inverse of trend */
  auto_reverse?: boolean;
}

export interface MarketRegimeRule {
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
    };
    params?: Record<string, unknown>;
  };
  expression?: string;
  factor?: {
    name: string;
    category: string;
    params?: Record<string, unknown>;
  };
  /** TICKET_260: Indicator category for manual mode */
  category?: 'trend' | 'range';
}

export interface MarketRegimeResult {
  status: 'completed' | 'failed' | 'processing' | 'rejected';
  validation_status?: 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID';
  reason_code?: string;
  strategy_code?: string;
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
 * Known error codes for Market Regime service.
 * Values are resolved via i18n at lookup time (strategy-builder:errorCodes.XXX).
 * @see CODE_GENERATOR_PROMPT_BEST_PRACTICES.md
 */
const REGIME_ERROR_CODES: ReadonlySet<string> = new Set([
  // Security violations
  'SECURITY_VIOLATION',
  // Validation errors
  'INVALID',
  'SYNTAX_ERROR',
  'UNKNOWN_INDICATOR',
  'UNSUPPORTED_OPERATOR',
  // Network/System errors
  'TIMEOUT',
  'NETWORK_ERROR',
  'TASK_FAILED',
  // LLM errors
  'LLM_ERROR',
  'GENERATION_FAILED',
]);

/**
 * Resolve a known error code to a localized message via i18n.
 * Returns undefined if the code is not in the known set.
 */
function resolveErrorCode(code: string | undefined): string | undefined {
  if (!code || !REGIME_ERROR_CODES.has(code)) return undefined;
  return i18n.t(`errorCodes.${code}`, { ns: 'strategy-builder' });
}

/**
 * Get user-friendly error message from error response
 */
export function getErrorMessage(result: MarketRegimeResult): string {
  // Check reason_code first (from rejected status)
  const fromReasonCode = resolveErrorCode(result.reason_code);
  if (fromReasonCode) return fromReasonCode;

  // Check error.error_code
  const fromErrorCode = resolveErrorCode(result.error?.error_code);
  if (fromErrorCode) return fromErrorCode;

  // Check error.code (legacy format)
  const fromCode = resolveErrorCode(result.error?.code);
  if (fromCode) return fromCode;

  // Return error_message or message if available
  if (result.error?.error_message) {
    return result.error.error_message;
  }

  if (result.error?.message) {
    return result.error.message;
  }

  // Default message
  return 'MSG_GENERIC_ERROR';
}

// -----------------------------------------------------------------------------
// Request Builder Types
// -----------------------------------------------------------------------------

/**
 * TICKET_260: Protocol-compliant indicator format
 * @see TICKET_260_REGIME_DETECTOR_ENTRY_RESPONSIBILITY_CLARIFICATION.md
 */
interface ServerIndicator {
  type: string;
  name: string;
  params?: Record<string, unknown>;
  /** Required when auto_reverse=false */
  category?: 'trend' | 'range';
}

interface ServerRequest {
  strategy_name: string;
  locale: string;
  output_format?: 'v1' | 'v3'; // TICKET_223: V3 framework import format
  /** TICKET_200: Storage mode preference - server should not store data if 'local' */
  storage_mode?: 'local' | 'remote' | 'hybrid';
  language?: string; // TICKET_710: Target language for code generation
  /** TICKET_260: Auto-reverse mode */
  auto_reverse?: boolean;
  analysis_config: {
    regime: Array<{
      case_type: string;
      enabled?: boolean;
      params: {
        /** TICKET_260: Protocol-compliant indicator array */
        indicators: ServerIndicator[];
        factors?: unknown[];
      };
    }>;
    llm_config: {
      prompt: string;
      provider: string;
      model?: string;
      api_key?: string; // TICKET_193: BYOK API key
    };
    /** TICKET_260: Auto-reverse mode (also at top level for compatibility) */
    auto_reverse?: boolean;
  };
}

// -----------------------------------------------------------------------------
// Request Builder
// -----------------------------------------------------------------------------

function mapRegimeToCaseType(regime: string): string {
  const regimeMap: Record<string, string> = {
    trend: 'TREND_DETECTION',
    range: 'RANGE_DETECTION',
    consolidation: 'CONSOLIDATION_DETECTION',
    oscillation: 'OSCILLATION_DETECTION',
  };

  if (regime.startsWith('bespoke_')) {
    return regime;
  }

  return regimeMap[regime] || regime.toUpperCase();
}

/**
 * TICKET_260: Transform rules to protocol-compliant indicator format
 * @see TICKET_260_REGIME_DETECTOR_ENTRY_RESPONSIBILITY_CLARIFICATION.md
 */
function transformToServerIndicators(rules: MarketRegimeRule[], autoReverse: boolean): ServerIndicator[] {
  return rules
    .filter((rule) => rule.rule_type === 'template_based' && rule.indicator)
    .map((rule): ServerIndicator => {
      const indicator = rule.indicator!;
      const logic = rule.strategy?.logic;

      // Build params including threshold if specified
      const params: Record<string, unknown> = { ...indicator.params };
      if (logic?.threshold_value !== undefined) {
        params.threshold = logic.threshold_value;
      }
      if (logic?.operator) {
        params.operator = logic.operator;
      }

      return {
        type: indicator.slug,
        name: indicator.name || indicator.slug,
        params: Object.keys(params).length > 0 ? params : undefined,
        // TICKET_260: Include category (default to 'trend' for auto-reverse mode)
        category: rule.category || (autoReverse ? undefined : 'trend'),
      };
    });
}

function buildPrompt(config: MarketRegimeConfig): string {
  const ruleDescriptions = config.rules.map((rule) => {
    if (rule.rule_type === 'custom_expression') {
      return rule.expression || '';
    }

    if (rule.rule_type === 'factor_based') {
      const factor = rule.factor;
      const paramsStr = factor?.params
        ? Object.entries(factor.params).map(([k, v]) => `${k}=${v}`).join(', ')
        : '';
      return paramsStr ? `Factor:${factor?.name}(${paramsStr})` : `Factor:${factor?.name}`;
    }

    const indicator = rule.indicator;
    const logic = rule.strategy?.logic;
    const paramsStr = indicator?.params
      ? Object.entries(indicator.params).map(([k, v]) => `${k}=${v}`).join(', ')
      : '';
    const indicatorPart = paramsStr ? `${indicator?.name}(${paramsStr})` : indicator?.name;
    const logicStr = logic?.operator && logic?.threshold_value !== undefined
      ? `${logic.operator} ${logic.threshold_value}`
      : '';

    return logicStr ? `${indicatorPart} ${logicStr}` : indicatorPart;
  });

  const rulesStr = ruleDescriptions.filter(Boolean).join(' AND ');
  const regimeLabel = config.regime.replace(/_/g, ' ');

  if (config.bespoke_notes) {
    return `${config.bespoke_notes}\n\nRules: ${rulesStr}`;
  }

  return `Generate a ${regimeLabel} strategy using: ${rulesStr}`;
}

/**
 * TICKET_193: Build server request with optional API key
 * TICKET_200: Include storage_mode preference
 * TICKET_260: Include auto_reverse parameter and protocol-compliant format
 */
function buildServerRequest(config: MarketRegimeConfig, apiKey?: string): ServerRequest {
  // TICKET_260: Default to true if not specified
  const autoReverse = config.auto_reverse !== false;
  const serverIndicators = transformToServerIndicators(config.rules, autoReverse);
  const prompt = buildPrompt(config);
  const caseType = mapRegimeToCaseType(config.regime);

  // DEBUG: Log transformation for troubleshooting
  console.info('[MarketRegimeService] Input rules:', config.rules.length);
  console.info('[MarketRegimeService] Transformed indicators:', serverIndicators.length);
  console.info('[MarketRegimeService] Indicators:', JSON.stringify(serverIndicators));

  return {
    // TICKET_1220: code generation is always English-only (TICKET_850);
    // locale must not follow UI language or OS locale.
    locale: 'en_US',
    strategy_name: config.strategy_name || i18n.t('common.untitledStrategy', { ns: 'strategy-builder' }),
    output_format: 'v3', // TICKET_223: V3 framework import format
    // TICKET_200: Include storage mode preference (defaults to 'local' if not specified)
    storage_mode: config.storage_mode || 'local',
    language: 'cpp', // TICKET_710: Explicit C++ target language for SDK-compliant code generation
    // TICKET_260: Auto-reverse mode (top level)
    auto_reverse: autoReverse,
    analysis_config: {
      // TICKET_260: Protocol-compliant regime config
      regime: [{
        case_type: caseType,
        params: {
          indicators: serverIndicators,
          factors: [],
        },
      }],
      llm_config: {
        prompt,
        // TICKET_644: No silent fallback. Provider must be explicitly set
        // by the caller. Validation in useGenerateWorkflow ensures this is populated.
        provider: toApiProvider(config.llm_provider || ''),
        model: config.llm_model || '',
        api_key: apiKey, // TICKET_193: BYOK API key (undefined if not provided)
      },
      // TICKET_260: Auto-reverse mode (also in analysis_config for compatibility)
      auto_reverse: autoReverse,
    },
  };
}

// -----------------------------------------------------------------------------
// Service Functions
// -----------------------------------------------------------------------------

/**
 * TICKET_193/196: Resolve API key for the selected provider and model
 *
 * Rules per TICKET_196/516:
 * - PRO_CATALOG provider: No API key needed (platform handles it)
 * - Other providers (OPENAI, CLAUDE, etc.): Need API key (BYOK or system)
 */
async function resolveApiKeyForProvider(providerId: string, modelId: string): Promise<string | undefined> {
  // TICKET_516: PRO_CATALOG provider does not need API key (platform handles it)
  if (providerId === 'PRO_CATALOG') {
    console.debug('[MarketRegimeService] PRO_CATALOG provider, no API key needed');
    return undefined;
  }

  // For all other providers, try to resolve BYOK key
  try {
    const result = await window.electronAPI.entitlement.resolveLLMApiKey(providerId);
    if (result.success && result.data?.key) {
      console.debug(`[MarketRegimeService] Resolved API key for ${providerId}, source: ${result.data.source}`);
      return result.data.key;
    }
    console.debug(`[MarketRegimeService] No BYOK key found for ${providerId}, backend will use system key`);
    return undefined;
  } catch (error) {
    console.error(`[E:STRATEGY:MARKET_REGIME_API_KEY_FAILED] [MarketRegimeService] Failed to resolve API key:`, error);
    return undefined;
  }
}

/**
 * TICKET_196: Map model ID to provider ID for BYOK key lookup
 */
function mapModelToProvider(modelId: string): string {
  if (modelId.startsWith('gpt-') || modelId.startsWith('o3-')) return 'OPENAI';
  if (modelId.startsWith('claude-')) return 'CLAUDE';
  if (modelId.startsWith('gemini-')) return 'GEMINI';
  if (modelId.startsWith('deepseek-')) return 'DEEPSEEK';
  if (modelId.startsWith('grok-')) return 'GROK';
  if (modelId.startsWith('qwen')) return 'QWEN';
  return 'PRO_CATALOG'; // Fallback
}

/**
 * TICKET_1208_1: Build generation request for main-process polling.
 * Returns the start/poll endpoints and request body without resolving
 * the API key (the main process handles BYOK injection).
 */
export function buildMarketRegimeRequest(config: MarketRegimeConfig): {
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
 * Execute market regime analysis
 */
export async function executeMarketRegimeAnalysis(
  config: MarketRegimeConfig,
  signal?: AbortSignal
): Promise<MarketRegimeResult> {
  // TICKET_193/196: Resolve API key based on provider and model
  // TICKET_644: No silent fallback -- provider must be set by caller
  const providerId = config.llm_provider || '';
  const modelId = config.llm_model || '';
  const apiKey = await resolveApiKeyForProvider(providerId, modelId);

  const requestPayload = buildServerRequest(config, apiKey);

  return await pluginApiClient.executeWithPolling<MarketRegimeResult>({
    initialData: requestPayload,
    startEndpoint: API_ENDPOINTS.START,
    pollEndpoint: API_ENDPOINTS.STATUS,
    signal,

    // TICKET_417: Centralized poll handler
    handlePollResponse: createStandardPollHandler<MarketRegimeResult>(
      'MarketRegime',
      (status, result) => ({
        ...(result || {}),
        status: status as MarketRegimeResult['status'],
        validation_status: result?.validation_status as MarketRegimeResult['validation_status'],
        reason_code: result?.reason_code as string | undefined,
        strategy_code: result?.strategy_code as string | undefined,
        language: 'cpp' as const,
        includes: result?.includes as string[] | undefined,
        strategy_class: result?.strategy_class as string | undefined,
        error: result?.error as MarketRegimeResult['error'],
      } as MarketRegimeResult),
    ),
  });
}

/**
 * Validate market regime configuration.
 * `error` is an i18n key resolved by useGenerateWorkflow.
 */
export function validateMarketRegimeConfig(
  config: Partial<MarketRegimeConfig>
): { valid: boolean; error?: string; errorParams?: Record<string, unknown> } {
  // TICKET_644: Validate LLM provider is configured (no silent NONA fallback)
  if (!config.llm_provider) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_LLM_PROVIDER_REQUIRED' };
  }

  if (!config.regime) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_REGIME_TYPE_REQUIRED' };
  }

  if (!config.rules || config.rules.length === 0) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_AT_LEAST_ONE_RULE' };
  }

  for (const rule of config.rules) {
    if (rule.rule_type === 'template_based') {
      if (!rule.indicator?.slug) {
        return { valid: false, error: 'MSG_BUILDER_VALIDATION_TEMPLATE_REQUIRES_INDICATOR' };
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
