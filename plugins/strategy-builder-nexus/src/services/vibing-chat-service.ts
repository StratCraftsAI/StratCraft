/**
 * Vibing Chat Service - AI Strategy Studio Backend Communication
 *
 * Implements HTTP polling communication with /api/vibing_chat endpoints.
 *
 * @see ISSUE_7029_AI_STRATEGY_STUDIO_MESSAGE_FORMAT_SPECIFICATION.md
 */

import i18n from 'i18next';
import { pluginApiClient, createStandardPollHandler } from './api-client';
import { API_VIBING_CHAT, API_CHECK_VIBING_CHAT } from '@StratCraft/types';
import { toApiProvider } from '@shared/constants/llm-providers';
import { VIBING_CHAT_POLL_INTERVAL_MS, VIBING_CHAT_TIMEOUT_MS } from '@shared/constants/timing';
import {
  extractStrategyCode,
  buildVibingChatPayload,
  actionToMessage,
  isKnownVibingChatErrorCode,
  type VibingChatAction,
  type VibingChatResult,
  type StrategyRulesResponse,
  type EntryCondition,
  type ExitCondition,
  type StrategyIndicator,
  type RiskManagement,
} from '@StratCraft/ai-studio-operations/vibing-chat-protocol';

export type {
  VibingChatAction,
  VibingChatResult,
  StrategyRulesResponse,
  EntryCondition,
  ExitCondition,
  StrategyIndicator,
  RiskManagement,
};
export { extractStrategyCode };

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const API_ENDPOINTS = {
  START: API_VIBING_CHAT,
  STATUS: API_CHECK_VIBING_CHAT,
};

/**
 * Vibing chat request configuration
 */
export interface VibingChatRequest {
  session_id: string;
  message: string;
  message_id?: string;
  strategy_id?: string;
  strategy_name?: string;
  model?: string;
  output_format?: 'v1' | 'v3';
  storage_mode?: 'local' | 'remote' | 'hybrid';
  current_strategy_rules?: Partial<StrategyRulesResponse>;
  metadata?: {
    mode?: string;
    timestamp?: string;
  };
  llm_model?: string;
  signal?: AbortSignal;
}


/**
 * Vibing chat response (full polling response)
 */
export interface VibingChatResponse {
  success: boolean;
  task_id: string;
  session_id: string;
  status: 'processing' | 'completed' | 'failed';
  progress?: number;
  message?: string;
  result?: VibingChatResult;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  data?: {
    message?: string;
    processing_time?: number;
    tokens_used?: number;
  };
  metadata?: {
    model?: string;
    model_version?: string | null;
    temperature?: number;
    timestamp?: string;
    fishbone_enabled?: boolean;
    fishbone_module?: string;
    fishbone_confidence?: number;
  };
}

// TICKET_1376 step 2: the whitelist itself now lives in
// `@StratCraft/ai-studio-operations/vibing-chat-protocol` so the Guide WebUI
// surface resolves the identical backend codes. Only the i18n *resolution*
// stays here -- that is the surface-local adapter around the shared operation.
// Behaviour is unchanged: same 7 codes, same validate-then-translate order.
function resolveVibingChatErrorCode(code: string | undefined): string | undefined {
  if (!isKnownVibingChatErrorCode(code)) return undefined;
  return i18n.t(`errorCodes.${code}`, { ns: 'strategy-builder' });
}

/**
 * Get user-friendly error message
 */
export function getVibingChatErrorMessage(response: VibingChatResponse): string {
  const fromCode = resolveVibingChatErrorCode(response.error?.code);
  if (fromCode) return fromCode;

  if (response.error?.message) {
    return response.error.message;
  }

  return 'MSG_GENERIC_ERROR';
}

// -----------------------------------------------------------------------------
// Request Builder
// -----------------------------------------------------------------------------

/**
 * Build server request from client config
 */
function buildServerRequest(config: VibingChatRequest): Record<string, unknown> {
  return buildVibingChatPayload({
    sessionId: config.session_id,
    message: config.message,
    strategyName: config.strategy_name || '',
    llmProvider: toApiProvider(config.model || 'PRO_CATALOG'),
    llmModel: config.llm_model || '',
    outputFormat: config.output_format || 'v3',
    storageMode: config.storage_mode || 'local',
    messageId: config.message_id || `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    strategyId: config.strategy_id,
    // TICKET_710: Explicit C++ target language for SDK-compliant code generation
    language: 'cpp',
    currentStrategyRules: config.current_strategy_rules,
    metadata: {
      mode: config.metadata?.mode || 'generator',
      timestamp: config.metadata?.timestamp || new Date().toISOString(),
    },
  });
}

// -----------------------------------------------------------------------------
// Service Functions
// -----------------------------------------------------------------------------

/**
 * Execute vibing chat message
 *
 * Sends message to /api/vibing_chat and polls /api/check_vibing_chat_status
 * until completion.
 */
export async function executeVibingChat(
  config: VibingChatRequest,
  externalSignal?: AbortSignal
): Promise<VibingChatResponse> {
  const requestPayload = buildServerRequest(config);

  console.debug('[VibingChat] Calling API:', API_ENDPOINTS.START);
  console.debug('[VibingChat] Request payload:', JSON.stringify(requestPayload, null, 2).substring(0, 1000));

  return await pluginApiClient.executeWithPolling<VibingChatResponse>({
    initialData: requestPayload,
    startEndpoint: API_ENDPOINTS.START,
    pollEndpoint: API_ENDPOINTS.STATUS,
    pollInterval: VIBING_CHAT_POLL_INTERVAL_MS,
    timeout: VIBING_CHAT_TIMEOUT_MS,
    signal: externalSignal || config.signal,

    // TICKET_417: Centralized poll handler with VibingChat-specific result mapping
    handlePollResponse: createStandardPollHandler<VibingChatResponse>(
      'VibingChat',
      (status, result) => {
        const resp = result as Record<string, unknown> | undefined;
        return {
          success: status !== 'failed',
          task_id: '',
          session_id: (resp?.session_id as string) || '',
          status: status as VibingChatResponse['status'],
          result: resp as unknown as VibingChatResult | undefined,
          error: resp?.error as VibingChatResponse['error'],
          data: resp as VibingChatResponse['data'],
          metadata: resp?.metadata as VibingChatResponse['metadata'],
        } as VibingChatResponse;
      },
    ),
  });
}

/**
 * Execute action trigger (generate_code / save_strategy / run_backtest)
 */
export async function executeVibingChatAction(
  sessionId: string,
  action: VibingChatAction,
  currentRules?: Partial<StrategyRulesResponse>,
  llmProvider?: VibingChatRequest['model'],
  llmModel?: string,
  signal?: AbortSignal
): Promise<VibingChatResponse> {
  return executeVibingChat({
    session_id: sessionId,
    message: actionToMessage(action),
    current_strategy_rules: currentRules,
    output_format: 'v3',
    storage_mode: 'local',
    model: llmProvider,
    llm_model: llmModel,
    signal,
  });
}
