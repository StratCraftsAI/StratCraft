/**
 * Trader AI Entry Service - Plugin Layer
 *
 * TICKET_214: Page 36 - Trader Mode AI Entry
 *
 * Uses: /api/llm_trader for LLM-powered trader strategy generation
 *
 * Key difference from Kronos AI Entry (Page 34):
 * - Uses /api/llm_trader instead of /api/kronos_llm_entry
 * - Full template management with local storage
 * - TraderModeConfig request format matching web implementation
 *
 * @see TICKET_214 - Page 36 - Trader Mode AI Entry
 * @see TICKET_077_19 - Kronos AI Entry Components (shared components)
 */

import i18n from 'i18next';
import { pluginApiClient, createStandardPollHandler } from './api-client';
import { API_LLM_TRADER, API_CHECK_LLM_TRADER } from '@StratCraft/types';
import { toApiProvider } from '@shared/constants/llm-providers';
import type { RawIndicatorBlock } from '../components/ui/RawIndicatorSelector';
import type { IndicatorTemplate } from '../components/ui/SaveTemplateDialog';
import { checkDuplicateRawIndicatorBlocks } from './indicator-duplicate-contract';
import {
  MIN_PROMPT_LENGTH,
  MAX_PROMPT_LENGTH,
  MIN_LOOKBACK_BARS,
  MAX_LOOKBACK_BARS,
  RISK_LEVEL_LOW_THRESHOLD,
  RISK_LEVEL_MEDIUM_THRESHOLD,
  FREQ_LEVEL_LOW_THRESHOLD,
  FREQ_LEVEL_MEDIUM_THRESHOLD,
} from '../constants/validation';

// Re-export for convenience
export type { IndicatorTemplate };

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const API_ENDPOINTS = {
  START: API_LLM_TRADER,
  STATUS: API_CHECK_LLM_TRADER,
};

const TEMPLATE_STORAGE_KEY = 'trader-ai-entry-templates';
const PLUGIN_ID = 'com.stratcraft.strategy-builder-nexus';

// -----------------------------------------------------------------------------
// Public Types
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
 * Trader AI Entry configuration (client format)
 */
export interface TraderAIEntryConfig {
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
 * Trader AI Entry result
 */
export interface TraderAIEntryResult {
  status: 'completed' | 'failed' | 'processing' | 'rejected';
  validation_status?: 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID';
  reason_code?: string;
  strategy_code?: string;
  strategy_id?: string;
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
 * Known error codes for Trader AI Entry service.
 * Values are resolved via i18n at lookup time (strategy-builder:errorCodes.XXX).
 */
const TRADER_AI_ENTRY_ERROR_CODES: ReadonlySet<string> = new Set([
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
  if (!code || !TRADER_AI_ENTRY_ERROR_CODES.has(code)) return undefined;
  return i18n.t(`errorCodes.${code}`, { ns: 'strategy-builder' });
}

/**
 * Get user-friendly error message from error response
 */
export function getTraderAIEntryErrorMessage(result: TraderAIEntryResult): string {
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
// Server Request Types (matches /api/llm_trader format from web)
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
 * Trader mode configuration for server
 */
interface ServerTraderMode {
  mode: TraderPresetMode;
  version: string;
  config_source: string;
  constraints: TraderModeConstraints;
}

/**
 * Trader mode constraints (ISSUE_3299)
 * 8 required fields with space-separated key names
 * Source of truth: ModeDetailsPanel.tsx
 */
interface TraderModeConstraints {
  'Core Goal': string;
  'Risk Tolerance': string;
  'Position Limits': string;
  'Trading Frequency': string;
  'Leverage': string;
  'Risk Metrics': string;
  'Decision Inputs': string;
  'Model Requirements': string;
}

/**
 * Server request format for /api/llm_trader (ISSUE_3299)
 * - llm_provider/llm_model at top level (Page 35 pattern)
 * - llm object includes provider/model
 */
interface ServerRequest {
  task_id?: string;
  locale?: string;
  output_format?: 'v1' | 'v3'; // TICKET_220: V3 framework import format
  llm_provider: string;
  llm_model: string;
  storage_mode: 'local' | 'remote' | 'hybrid';
  language?: string; // TICKET_710: Target language for code generation
  operation_type: 'generate_strategy';
  operation_data: {
    strategy_id?: number;
    strategy_name: string;
    trader_mode: ServerTraderMode;
    prediction: {
      lookbackBars: number;
    };
    llm: {
      provider: string;
      model: string;
      timeout: number;
      retries: number;
      prompt: string;
    };
    rawIndicators: ServerRawIndicator[];
  };
}

// -----------------------------------------------------------------------------
// Preset Mode Constraints
// -----------------------------------------------------------------------------

/**
 * Preset mode constraints (source: ModeDetailsPanel.tsx:40-97)
 */
const PRESET_MODE_CONSTRAINTS: Record<TraderPresetMode, TraderModeConstraints> = {
  baseline: {
    'Core Goal': 'Maximize absolute returns without extra constraints',
    'Risk Tolerance': 'Medium to High (Model decided)',
    'Position Limits': 'None or very loose',
    'Trading Frequency': 'Unlimited (High frequency or long term)',
    'Leverage': '1x (No leverage) or very low',
    'Risk Metrics': 'Sharpe Ratio, Max Drawdown',
    'Decision Inputs': 'Market data, News, Fundamentals',
    'Model Requirements': 'Comprehensive capabilities',
  },
  monk: {
    'Core Goal': 'Stability and risk-adjusted returns under strict limits',
    'Risk Tolerance': 'Very Low (Mandatory rules)',
    'Position Limits': 'Strict (e.g., <2% per trade, sector limits)',
    'Trading Frequency': 'Very Low (Daily/Weekly caps, forced "asceticism")',
    'Leverage': 'Forbidden',
    'Risk Metrics': 'Sortino Ratio, Max Drawdown, Volatility',
    'Decision Inputs': 'Filter short-term noise, focus on long-term trends',
    'Model Requirements': 'Discipline, Patience, Long-term value',
  },
  warrior: {
    'Core Goal': 'Maximize returns through aggressive market engagement',
    'Risk Tolerance': 'Very High (Aggressive pursuit)',
    'Position Limits': 'Flexible (Concentrated positions allowed)',
    'Trading Frequency': 'High (Active market participation)',
    'Leverage': 'High (5x-10x or more)',
    'Risk Metrics': 'Absolute Returns, Recovery Speed',
    'Decision Inputs': 'Real-time data, Momentum, Volatility',
    'Model Requirements': 'Precise execution, Quick adaptation, Stop-loss discipline',
  },
  bespoke: {
    'Core Goal': 'Customized objectives based on user configuration',
    'Risk Tolerance': 'User defined',
    'Position Limits': 'User defined',
    'Trading Frequency': 'User defined',
    'Leverage': 'User defined',
    'Risk Metrics': 'User defined',
    'Decision Inputs': 'User defined',
    'Model Requirements': 'Tailored to specific needs',
  },
};

const PRESET_LOOKBACK_BARS: Record<TraderPresetMode, number> = {
  baseline: 100,
  monk: 150,
  warrior: 50,
  bespoke: 100,
};

// -----------------------------------------------------------------------------
// Request Builder
// -----------------------------------------------------------------------------

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
 * Build server request from client config (ISSUE_3299)
 * Reference: market-observer-service.ts (Page 35 pattern)
 */
function buildServerRequest(config: TraderAIEntryConfig): ServerRequest {
  const lookbackBars = config.preset_mode === 'bespoke' && config.bespoke_config
    ? config.bespoke_config.lookbackBars
    : PRESET_LOOKBACK_BARS[config.preset_mode];

  const taskId = `llm_trader_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const llmProvider = toApiProvider(config.llm_provider || '');
  const llmModel = config.llm_model || '';

  // Build constraints with bespoke overrides if applicable
  let constraints: TraderModeConstraints = { ...PRESET_MODE_CONSTRAINTS[config.preset_mode] };
  if (config.preset_mode === 'bespoke' && config.bespoke_config) {
    const bc = config.bespoke_config;
    const riskLevel = bc.maxDrawdown <= RISK_LEVEL_LOW_THRESHOLD ? 'Low' : bc.maxDrawdown <= RISK_LEVEL_MEDIUM_THRESHOLD ? 'Medium' : 'High';
    const freqLevel = bc.tradingFrequency <= FREQ_LEVEL_LOW_THRESHOLD ? 'Low' : bc.tradingFrequency <= FREQ_LEVEL_MEDIUM_THRESHOLD ? 'Medium' : 'High';
    constraints = {
      'Core Goal': 'Customized objectives based on user configuration',
      'Risk Tolerance': riskLevel,
      'Position Limits': `${bc.positionLimits}%`,
      'Trading Frequency': freqLevel,
      'Leverage': `${bc.leverage}x`,
      'Risk Metrics': 'User defined',
      'Decision Inputs': 'User defined',
      'Model Requirements': 'Tailored to specific needs',
    };
  }

  return {
    task_id: taskId,
    output_format: 'v3', // TICKET_220: V3 framework import format
    llm_provider: llmProvider,
    llm_model: llmModel,
    storage_mode: config.storage_mode || 'local',
    language: 'cpp', // TICKET_710: Explicit C++ target language for SDK-compliant code generation
    operation_type: 'generate_strategy',
    operation_data: {
      strategy_name: config.strategy_name || i18n.t('common.untitledTrader', { ns: 'strategy-builder' }),
      trader_mode: {
        mode: config.preset_mode,
        version: '1.0.0',
        config_source: 'trader-modes.json',
        constraints,
      },
      prediction: {
        lookbackBars,
      },
      llm: {
        provider: llmProvider,
        model: llmModel,
        timeout: 120,
        retries: 3,
        prompt: config.prompt,
      },
      rawIndicators: transformRawIndicators(config.indicators),
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
export function buildTraderAIEntryRequest(config: TraderAIEntryConfig): {
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
 * Execute Trader AI Entry generation
 *
 * TICKET_214: Calls /api/llm_trader which generates
 * trader strategies using LLM-powered prompt analysis.
 */
export async function executeTraderAIEntry(
  config: TraderAIEntryConfig,
  signal?: AbortSignal
): Promise<TraderAIEntryResult> {
  const requestPayload = buildServerRequest(config);

  console.debug('[TraderAIEntry] Calling API:', API_ENDPOINTS.START);
  console.debug('[TraderAIEntry] Request payload:', JSON.stringify(requestPayload, null, 2).substring(0, 1000));

  return await pluginApiClient.executeWithPolling<TraderAIEntryResult>({
    initialData: requestPayload,
    startEndpoint: API_ENDPOINTS.START,
    pollEndpoint: API_ENDPOINTS.STATUS,
    signal,

    // TICKET_417: Centralized poll handler
    handlePollResponse: createStandardPollHandler<TraderAIEntryResult>(
      'TraderAIEntry',
      (status, result) => ({
        status: status as TraderAIEntryResult['status'],
        validation_status: result?.validation_status as TraderAIEntryResult['validation_status'],
        reason_code: result?.reason_code as string | undefined,
        strategy_code: result?.strategy_code as string | undefined,
        strategy_id: result?.strategy_id as string | undefined,
        class_name: result?.class_name as string | undefined,
        language: 'cpp' as const,
        includes: result?.includes as string[] | undefined,
        strategy_class: result?.strategy_class as string | undefined,
        error: result?.error as TraderAIEntryResult['error'],
      }),
    ),
  });
}

/**
 * Validate Trader AI Entry configuration.
 * `error` is an i18n key resolved by useGenerateWorkflow.
 */
export function validateTraderAIEntryConfig(
  config: Partial<TraderAIEntryConfig>
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
  }

  return { valid: true };
}

// -----------------------------------------------------------------------------
// Template Storage Functions
// -----------------------------------------------------------------------------

interface TemplateStorage {
  templates: IndicatorTemplate[];
}

/**
 * Load all saved templates using hub state
 */
export async function loadTemplates(): Promise<IndicatorTemplate[]> {
  try {
    const stored = await window.electronAPI.hub.getState(TEMPLATE_STORAGE_KEY) as TemplateStorage | undefined;
    return stored?.templates || [];
  } catch (error) {
    console.error('[E:STRATEGY:TRADER_AI_LOAD_TEMPLATES_FAILED] [TraderAIEntry] Failed to load templates:', error);
    return [];
  }
}

/**
 * Save a new template using hub state
 */
export async function saveTemplate(template: IndicatorTemplate): Promise<void> {
  try {
    const stored = await window.electronAPI.hub.getState(TEMPLATE_STORAGE_KEY) as TemplateStorage | undefined;
    const templates = stored?.templates || [];
    templates.push(template);
    window.electronAPI.hub.setState(TEMPLATE_STORAGE_KEY, { templates }, PLUGIN_ID);
  } catch (error) {
    console.error('[E:STRATEGY:TRADER_AI_SAVE_TEMPLATE_FAILED] [TraderAIEntry] Failed to save template:', error);
    throw error;
  }
}

/**
 * Delete a template by ID
 */
export async function deleteTemplate(templateId: string): Promise<void> {
  try {
    const stored = await window.electronAPI.hub.getState(TEMPLATE_STORAGE_KEY) as TemplateStorage | undefined;
    const templates = (stored?.templates || []).filter(t => t.id !== templateId);
    window.electronAPI.hub.setState(TEMPLATE_STORAGE_KEY, { templates }, PLUGIN_ID);
  } catch (error) {
    console.error('[E:STRATEGY:TRADER_AI_DELETE_TEMPLATE_FAILED] [TraderAIEntry] Failed to delete template:', error);
    throw error;
  }
}

/**
 * Get all existing template names (for duplicate check)
 */
export async function getExistingTemplateNames(): Promise<string[]> {
  const templates = await loadTemplates();
  return templates.map(t => t.name);
}

// -----------------------------------------------------------------------------
// Default Configuration
// -----------------------------------------------------------------------------

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

export function getPresetModeDescription(mode: TraderPresetMode): string {
  return PRESET_MODE_CONSTRAINTS[mode]['Core Goal'];
}
