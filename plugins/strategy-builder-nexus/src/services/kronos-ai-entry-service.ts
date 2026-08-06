/**
 * Kronos AI Entry Service - Plugin Layer
 *
 * TICKET_211: Kronos AI Entry Page
 *
 * Uses: /api/kronos_llm_entry for LLM-powered entry signal generation
 *
 * Key difference from Kronos Indicator Entry:
 * - Uses preset modes (Baseline/Monk/Warrior/Bespoke) instead of indicator rules
 * - Uses prompt-based generation with LLM
 * - Optional raw indicator context
 *
 * @see TICKET_211 - Kronos AI Entry Page
 * @see TICKET_077_19 - Kronos AI Entry Components
 * @see TICKET_202 - Builder Page Base Class Mapping
 */

import i18n from 'i18next';
import { pluginApiClient, createStandardPollHandler } from './api-client';
import { API_KRONOS_LLM_ENTRY, API_CHECK_KRONOS_LLM_ENTRY } from '@StratCraft/types';
import { toApiProvider } from '@shared/constants/llm-providers';
import {
  MIN_PROMPT_LENGTH,
  MAX_PROMPT_LENGTH,
  MIN_LOOKBACK_BARS,
  MAX_LOOKBACK_BARS,
  MIN_MAX_DRAWDOWN,
  MAX_MAX_DRAWDOWN,
} from '../constants/validation';
import { checkDuplicateRawIndicatorBlocks } from './indicator-duplicate-contract';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const API_ENDPOINTS = {
  START: API_KRONOS_LLM_ENTRY,
  STATUS: API_CHECK_KRONOS_LLM_ENTRY,
};

// -----------------------------------------------------------------------------
// Public Types (used by KronosAIEntryPage)
// -----------------------------------------------------------------------------

/**
 * Trader preset mode
 */
export type TraderPresetMode = 'baseline' | 'monk' | 'warrior' | 'bespoke';

/**
 * Bespoke configuration parameters
 */
export interface BespokeConfig {
  lookbackBars: number;
  positionLimits: number;
  leverage: number;
  tradingFrequency: number;
  typicalYield: number;
  maxDrawdown: number;
}

/**
 * Raw indicator block for context
 */
export interface RawIndicatorBlock {
  id: string;
  indicatorSlug: string | null;
  field: string;
  paramValues: Record<string, number | string>;
}

/**
 * Kronos AI Entry configuration (client format)
 */
export interface KronosAIEntryConfig {
  strategy_name: string;
  preset_mode: TraderPresetMode;
  bespoke_config?: BespokeConfig;
  prompt: string;
  indicators: RawIndicatorBlock[];
  llm_provider?: string;
  llm_model?: string;
  storage_mode?: 'local' | 'remote' | 'hybrid';
}

/**
 * Kronos AI Entry result
 */
export interface KronosAIEntryResult {
  status: 'completed' | 'failed' | 'processing' | 'rejected';
  strategy_id?: number;
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

/**
 * Known error codes for Kronos AI Entry service.
 * Values are resolved via i18n at lookup time (strategy-builder:errorCodes.XXX).
 */
const KRONOS_AI_ENTRY_ERROR_CODES: ReadonlySet<string> = new Set([
  'SECURITY_VIOLATION',
  'INVALID',
  'INVALID_PROMPT',
  'PROMPT_TOO_SHORT',
  'PROMPT_TOO_LONG',
  'INVALID_PRESET',
  'INVALID_BESPOKE_CONFIG',
  'TIMEOUT',
  'NETWORK_ERROR',
  'TASK_FAILED',
  'LLM_ERROR',
  'LLM_RATE_LIMIT',
  'LLM_CONTEXT_LENGTH',
  'GENERATION_FAILED',
  'SPEC_NOT_TRADING_ALGORITHM',
  'UNSUPPORTED_PROVIDER',
]);

/**
 * Resolve a known error code to a localized message via i18n.
 * Returns undefined if the code is not in the known set.
 */
function resolveErrorCode(code: string | undefined): string | undefined {
  if (!code || !KRONOS_AI_ENTRY_ERROR_CODES.has(code)) return undefined;
  return i18n.t(`errorCodes.${code}`, { ns: 'strategy-builder' });
}

/**
 * Get user-friendly error message from error response
 */
export function getKronosAIEntryErrorMessage(result: KronosAIEntryResult): string {
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
// Server Request Types (matches /api/kronos_llm_entry format)
// -----------------------------------------------------------------------------

/**
 * Server raw indicator format
 */
interface ServerRawIndicator {
  type: 'raw_indicator';
  indicator_slug: string;
  field: string;
  parameters: Record<string, unknown>;
  output_name: string;
}

/**
 * Server LLM configuration
 */
interface ServerLLMConfig {
  provider: string;
  model: string;
  timeout: number;
  retries: number;
  prompt: string;
}

/**
 * Server Kronos configuration
 */
interface ServerKronosConfig {
  confidenceThreshold: number;
  expectedReturnThreshold: number;
  directionFilter: boolean;
}

/**
 * Server request format for /api/kronos_llm_entry
 */
interface ServerRequest {
  task_id?: string;
  locale?: string;
  output_format?: 'v1' | 'v3'; // TICKET_223: V3 framework import format
  storage_mode: 'local' | 'remote' | 'hybrid';
  language?: string; // TICKET_710: Target language for code generation
  operation_type: 'generate_strategy';
  operation_data: {
    strategy_id?: number;
    strategy_name: string;
    prediction: {
      lookbackBars: number;
    };
    llm: ServerLLMConfig;
    rawIndicators: ServerRawIndicator[];
    kronosConfig: ServerKronosConfig;
  };
}

// -----------------------------------------------------------------------------
// Request Builder
// -----------------------------------------------------------------------------

/**
 * Default lookback bars by preset mode
 */
const PRESET_LOOKBACK_BARS: Record<TraderPresetMode, number> = {
  baseline: 100,
  monk: 150,
  warrior: 50,
  bespoke: 100, // Will be overridden by bespoke_config.lookbackBars
};

/**
 * Default Kronos config by preset mode
 */
const PRESET_KRONOS_CONFIG: Record<TraderPresetMode, ServerKronosConfig> = {
  baseline: {
    confidenceThreshold: 0.5,
    expectedReturnThreshold: 0.01,
    directionFilter: true,
  },
  monk: {
    confidenceThreshold: 0.7,
    expectedReturnThreshold: 0.03,
    directionFilter: true,
  },
  warrior: {
    confidenceThreshold: 0.3,
    expectedReturnThreshold: 0.005,
    directionFilter: false,
  },
  bespoke: {
    confidenceThreshold: 0.6,
    expectedReturnThreshold: 0.02,
    directionFilter: true,
  },
};

/**
 * Transform raw indicator blocks to server format
 */
function transformRawIndicators(blocks: RawIndicatorBlock[]): ServerRawIndicator[] {
  return blocks
    .filter(block => block.indicatorSlug)
    .map((block, index) => ({
      type: 'raw_indicator' as const,
      indicator_slug: block.indicatorSlug!,
      field: block.field,
      parameters: block.paramValues as Record<string, unknown>,
      output_name: `${block.indicatorSlug!.toLowerCase()}_${index}`,
    }));
}

/**
 * Build server request from client config
 */
function buildServerRequest(config: KronosAIEntryConfig): ServerRequest {
  // Determine lookback bars
  const lookbackBars = config.preset_mode === 'bespoke' && config.bespoke_config
    ? config.bespoke_config.lookbackBars
    : PRESET_LOOKBACK_BARS[config.preset_mode];

  // Get Kronos config for preset mode
  const kronosConfig = PRESET_KRONOS_CONFIG[config.preset_mode];

  // Generate task_id
  const taskId = `kronos_llm_entry_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  return {
    task_id: taskId,
    // TICKET_1220: code generation is always English-only (TICKET_850);
    // locale must not follow UI language or OS locale.
    locale: 'en_US',
    output_format: 'v3', // TICKET_223: V3 framework import format
    storage_mode: config.storage_mode || 'local',
    language: 'cpp', // TICKET_710: Explicit C++ target language for SDK-compliant code generation
    operation_type: 'generate_strategy',
    operation_data: {
      strategy_name: config.strategy_name || i18n.t('common.untitledKronosAI', { ns: 'strategy-builder' }),
      prediction: {
        lookbackBars,
      },
      llm: {
        provider: toApiProvider(config.llm_provider || ''),
        model: config.llm_model || '',
        timeout: 60,
        retries: 5,
        prompt: config.prompt,
      },
      rawIndicators: transformRawIndicators(config.indicators),
      kronosConfig,
    },
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
export function buildKronosAIEntryRequest(config: KronosAIEntryConfig): {
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
 * Execute Kronos AI Entry generation
 *
 * TICKET_211: Calls /api/kronos_llm_entry which generates
 * KronosAIEntryBase strategies using LLM-powered prompt analysis.
 */
export async function executeKronosAIEntry(
  config: KronosAIEntryConfig,
  signal?: AbortSignal
): Promise<KronosAIEntryResult> {
  const requestPayload = buildServerRequest(config);

  console.debug('[KronosAIEntry] Calling API:', API_ENDPOINTS.START);
  console.debug('[KronosAIEntry] Request payload:', JSON.stringify(requestPayload, null, 2).substring(0, 1000));

  return await pluginApiClient.executeWithPolling<KronosAIEntryResult>({
    initialData: requestPayload,
    startEndpoint: API_ENDPOINTS.START,
    pollEndpoint: API_ENDPOINTS.STATUS,
    signal,

    // TICKET_417: Centralized poll handler
    handlePollResponse: createStandardPollHandler<KronosAIEntryResult>(
      'KronosAIEntry',
      (status, result) => ({
        status: status as KronosAIEntryResult['status'],
        strategy_id: result?.strategy_id as number | undefined,
        validation_status: result?.validation_status as KronosAIEntryResult['validation_status'],
        reason_code: result?.reason_code as string | undefined,
        strategy_code: result?.strategy_code as string | undefined,
        class_name: result?.class_name as string | undefined,
        error: result?.error as KronosAIEntryResult['error'],
      }),
    ),
  });
}

/**
 * Validate Kronos AI Entry configuration.
 * `error` is an i18n key resolved by useGenerateWorkflow.
 */
export function validateKronosAIEntryConfig(
  config: Partial<KronosAIEntryConfig>
): { valid: boolean; error?: string; errorParams?: Record<string, unknown> } {
  if (!config.prompt || config.prompt.trim().length < MIN_PROMPT_LENGTH) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_PROMPT_MIN_LEN' };
  }

  if (config.prompt.length > MAX_PROMPT_LENGTH) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_PROMPT_MAX_LEN' };
  }

  const validModes: TraderPresetMode[] = ['baseline', 'monk', 'warrior', 'bespoke'];
  if (config.preset_mode && !validModes.includes(config.preset_mode)) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_PRESET_MODE_INVALID' };
  }

  // TICKET_396: Validate rawIndicators field completeness
  const validFields = ['close', 'open', 'high', 'low', 'volume'];
  if (config.indicators && config.indicators.length > 0) {
    for (const block of config.indicators) {
      if (block.indicatorSlug && !block.field) {
        return { valid: false, error: 'MSG_BUILDER_VALIDATION_INDICATOR_FIELD_REQUIRED' };
      }
      if (block.field && !validFields.includes(block.field)) {
        return {
          valid: false,
          error: 'MSG_BUILDER_VALIDATION_INDICATOR_FIELD_INVALID',
          errorParams: { field: block.field, valid: validFields.join(', ') },
        };
      }
    }

    // TICKET_1227: refuse duplicate indicators (same indicator, field, params).
    const duplicate = checkDuplicateRawIndicatorBlocks(config.indicators);
    if (duplicate) {
      return { valid: false, ...duplicate };
    }
  }

  // Bespoke config validation
  if (config.preset_mode === 'bespoke' && config.bespoke_config) {
    const bc = config.bespoke_config;

    if (bc.lookbackBars < MIN_LOOKBACK_BARS || bc.lookbackBars > MAX_LOOKBACK_BARS) {
      return { valid: false, error: 'MSG_BUILDER_VALIDATION_LOOKBACK_RANGE' };
    }

    if (bc.positionLimits < 0 || bc.positionLimits > 100) {
      return { valid: false, error: 'MSG_BUILDER_VALIDATION_POSITION_LIMITS_RANGE' };
    }

    if (bc.leverage < 1 || bc.leverage > 1000) {
      return { valid: false, error: 'MSG_BUILDER_VALIDATION_LEVERAGE_RANGE' };
    }

    if (bc.tradingFrequency < 1 || bc.tradingFrequency > 1000) {
      return { valid: false, error: 'MSG_BUILDER_VALIDATION_TRADING_FREQ_RANGE' };
    }

    if (bc.typicalYield < 1 || bc.typicalYield > 500) {
      return { valid: false, error: 'MSG_BUILDER_VALIDATION_TYPICAL_YIELD_RANGE' };
    }

    if (bc.maxDrawdown < MIN_MAX_DRAWDOWN || bc.maxDrawdown > MAX_MAX_DRAWDOWN) {
      return { valid: false, error: 'MSG_BUILDER_VALIDATION_MAX_DRAWDOWN_RANGE' };
    }
  }

  return { valid: true };
}

/**
 * Get default bespoke config
 */
export function getDefaultBespokeConfig(): BespokeConfig {
  return {
    lookbackBars: 100,
    positionLimits: 100,
    leverage: 1,
    tradingFrequency: 10,
    typicalYield: 50,
    maxDrawdown: 20,
  };
}

/**
 * Get preset mode description
 */
export function getPresetModeDescription(mode: TraderPresetMode): string {
  const descriptions: Record<TraderPresetMode, string> = {
    baseline: 'Maximize absolute returns without extra constraints',
    monk: 'Strict discipline, stability, and risk-adjusted returns',
    warrior: 'Aggressive assault with high leverage and risk',
    bespoke: 'Fully customized strategy tailored to your needs',
  };
  return descriptions[mode] || '';
}
