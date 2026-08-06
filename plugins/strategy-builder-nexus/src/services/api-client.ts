/**
 * API Client Service for Strategy Builder Plugin
 *
 * Routes requests through the Electron Main Process IPC proxy.
 * See TICKET_672 for rationale.
 */

import i18n from 'i18next';
import {
  API_VIBING_CHAT,
  isStrategyGenerationEndpoint,
} from '@StratCraft/types';
import { getApiLocale } from '@shared/utils/format-locale';
import {
  actionToMessage,
  type VibingChatAction,
  type StrategyRulesResponse,
} from '@StratCraft/ai-studio-operations/vibing-chat-protocol';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL = 500;
const DEFAULT_POLL_TIMEOUT = 180000;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface VibingChatRequest {
  session_id: string;
  message: string;
  strategy_name: string;
  strategy_id?: string;
  current_strategy_rules?: Partial<StrategyRulesResponse>;
  output_format?: 'v2' | 'v3';
  storage_mode?: 'local' | 'cloud';
  model?: string;
  llm_model?: string;
  signal?: AbortSignal;
  metadata?: Record<string, any>;
}

export interface VibingChatResponse {
  success: boolean;
  result?: {
    content?: string;
    explanation?: string;
    strategy_rules?: StrategyRulesResponse;
    available_actions?: string[];
    suggested_title?: string;
    type?: 'strategy_code' | 'conversation';
    class_name?: string;
    metadata?: {
      opensource_algorithms?: Array<{
        id: number;
        name: string;
        url: string;
      }>;
    };
  };
  error?: string;
  error_details?: {
    code: string;
    message: string;
    rawResponse: unknown;
  };
}

export interface ApiResponse {
  success: boolean;
  data?: {
    task_id?: string;
    status?: string;
    result?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface PollOptions<T> {
  initialData: unknown;
  startEndpoint: string;
  pollEndpoint: string;
  pollInterval?: number;
  timeout?: number;
  signal?: AbortSignal;
  decodeTaskFailure?: (response: unknown) => {
    message: string;
    backendCode?: string;
  } | undefined;
  handlePollResponse: (response: unknown) => {
    isComplete: boolean;
    result?: T;
    rawResponse: unknown;
  };
}

function taskFailureError(failure: {
  message: string;
  backendCode?: string;
}): Error & { code?: string } {
  const error = new Error(failure.message) as Error & { code?: string };
  if (failure.backendCode) error.code = failure.backendCode;
  return error;
}

// -----------------------------------------------------------------------------
// Logger
// -----------------------------------------------------------------------------

const log = {
  debug: (msg: string) => console.debug(`[Plugin][API] ${msg}`),
  info: (msg: string) => console.info(`[Plugin][API] ${msg}`),
  error: (msg: string) => console.error(`[E:API:CLIENT_ERROR] [Plugin][API] ${msg}`),
};

// -----------------------------------------------------------------------------
// API Client
// -----------------------------------------------------------------------------

class PluginApiClient {
  private async request<T extends ApiResponse>(
    endpoint: string,
    method: string,
    body?: unknown,
    externalSignal?: AbortSignal,
    skipAuth: boolean = false,
  ): Promise<T> {
    const enrichedBody = body && typeof body === 'object' && !Array.isArray(body)
      ? { locale: getApiLocale(), ...(body as Record<string, unknown>) }
      : body;

    const generationEndpoint = isStrategyGenerationEndpoint(endpoint);
    const effectiveSkipAuth = generationEndpoint ? false : skipAuth;
    log.info(`Request: ${method} ${endpoint} (skipAuth=${effectiveSkipAuth}, strategyGeneration=${generationEndpoint})`);

    if (externalSignal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    if (!effectiveSkipAuth) {
      try {
        const tokenResult = await window.electronAPI?.auth?.getAccessToken();
        if (!tokenResult?.success || !tokenResult.data) {
          if (globalThis.nexus?.window?.showAlert) {
            globalThis.nexus.window.showAlert(
              i18n.t('MSG_BUILDER_LOGIN_REQUIRED_BODY', { ns: 'errors' }),
              { title: i18n.t('MSG_BUILDER_LOGIN_REQUIRED_TITLE', { ns: 'errors' }) },
            );
          }

          window.dispatchEvent(
            new CustomEvent('nexus:auth-required', {
              detail: { message: 'LOGIN_REQUIRED', action: 'login' },
            }),
          );

          throw new Error('AUTH_REQUIRED');
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'AUTH_REQUIRED') throw err;
        log.error(`getAccessToken: IPC call failed - ${err}`);
      }
    }

    try {
      const proxyResult = await window.electronAPI.api.proxy({
        endpoint,
        method,
        body: enrichedBody,
        skipAuth: effectiveSkipAuth,
      });

      try {
        return JSON.parse(proxyResult.body) as T;
      } catch {
        return {
          success: false,
          data: {
            status: 'failed',
            result: { error: { code: 'PARSE_ERROR', message: i18n.t('MSG_BUILDER_INVALID_JSON_RESPONSE', { ns: 'errors' }) } },
          },
        } as unknown as T;
      }
    } catch (error) {
      if (error instanceof Error && (
        error.message === 'AUTH_REQUIRED'
      )) {
        throw error;
      }

      return {
        success: false,
        data: {
          status: 'failed',
          result: { error: { code: 'NETWORK_ERROR', message: String(error) } },
        },
      } as unknown as T;
    }
  }

  async post<T extends ApiResponse>(
    endpoint: string,
    body?: unknown,
    signal?: AbortSignal,
    skipAuth: boolean = false,
  ): Promise<T> {
    return this.request<T>(endpoint, 'POST', body, signal, skipAuth);
  }

  async executeWithPolling<T>(options: PollOptions<T>): Promise<T> {
    const {
      initialData,
      startEndpoint,
      pollEndpoint,
      pollInterval = DEFAULT_POLL_INTERVAL,
      timeout = DEFAULT_POLL_TIMEOUT,
      signal,
      decodeTaskFailure,
      handlePollResponse,
    } = options;

    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    const startResponse = await this.post<ApiResponse>(startEndpoint, initialData, signal);

    const startFailure = decodeTaskFailure?.(startResponse);
    if (startFailure) throw taskFailureError(startFailure);

    if (!startResponse.success) {
      const resultData = startResponse.data?.result as Record<string, unknown> | undefined;
      const err = resultData?.error as { error_code?: string; error_message?: string; message?: string } | undefined;
      const reasonCode = resultData?.reason_code as string | undefined;
      const errorCode = err?.error_code || reasonCode;
      const errorMessage = err?.error_message || err?.message || i18n.t('errors.failedToStartTask', { ns: 'strategy-builder' });
      const error = new Error(errorMessage);
      (error as Error & { code?: string; reasonCode?: string }).code = errorCode;
      (error as Error & { code?: string; reasonCode?: string }).reasonCode = reasonCode;
      throw error;
    }

    const taskId = startResponse.data?.task_id;
    if (!taskId) {
      throw new Error('TASK_NO_ID');
    }

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      const pollResponse = await this.post<ApiResponse>(pollEndpoint, { task_id: taskId }, signal);

      const taskFailure = decodeTaskFailure?.(pollResponse);
      if (taskFailure) throw taskFailureError(taskFailure);

      if (!pollResponse.success) {
        const resultError = (pollResponse.data?.result as Record<string, unknown> | undefined)
          ?.error as {
            error_code?: string; error_message?: string; suggested_action?: string;
            code?: string; message?: string;
          } | undefined;
        const dataError = pollResponse.data?.error as { code?: string; message?: string } | undefined;
        const errorMessage = resultError?.error_message || resultError?.message || dataError?.message || i18n.t('errors.pollRequestFailed', { ns: 'strategy-builder' });
        throw new Error(errorMessage);
      }

      const result = handlePollResponse(pollResponse);
      if (result.isComplete) {
        if (result.result === undefined) {
          throw new Error('TASK_NO_RESULT');
        }
        return result.result;
      }

      await this.delay(pollInterval);
    }

    const err = new Error('TASK_TIMEOUT') as Error & { timeoutMs?: number };
    err.timeoutMs = timeout;
    throw err;
  }

  /**
   * TICKET_672: Route request through Main Process IPC proxy.
   * This is required to bypass CSP restrictions and use the centralized
   * OAuth/Authentication context.
   */
  async executeVibingChat(request: VibingChatRequest): Promise<VibingChatResponse> {
    log.debug(`Executing vibing_chat for session: ${request.session_id}`);

    try {
      const result = await this.post<VibingChatResponse>(API_VIBING_CHAT, request, request.signal);
      return result as VibingChatResponse;
    } catch (error) {
      log.error(`vibing_chat exception: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : i18n.t('MSG_UNKNOWN_ERROR', { ns: 'errors' }),
      };
    }
  }

  /**
   * TICKET_467: Execute a specific action on the current conversation
   */
  async executeVibingChatAction(
    sessionId: string,
    actionId: VibingChatAction,
    currentRules?: Partial<StrategyRulesResponse>,
    model?: VibingChatRequest['model'],
    llmModel?: string,
    signal?: AbortSignal
  ): Promise<VibingChatResponse> {
    log.debug(`Executing action: ${actionId} for session: ${sessionId}`);

    try {
      const result = await this.post<VibingChatResponse>(API_VIBING_CHAT, {
        session_id: sessionId,
        message: actionToMessage(actionId),
        strategy_name: 'AI Studio Action',
        current_strategy_rules: currentRules,
        output_format: 'v3',
        model,
        llm_model: llmModel,
        signal,
        metadata: {
          action_id: actionId,
          mode: 'generator',
        },
      });
      return result as VibingChatResponse;
    } catch (error) {
      log.error(`vibing_chat action exception: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : i18n.t('MSG_UNKNOWN_ERROR', { ns: 'errors' }),
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// -----------------------------------------------------------------------------
// Singleton
// -----------------------------------------------------------------------------

let apiClient: PluginApiClient | null = null;

export function getApiClient(): PluginApiClient {
  if (!apiClient) {
    apiClient = new PluginApiClient();
  }
  return apiClient;
}

export const pluginApiClient = getApiClient();

/**
 * Convenience wrapper for executeVibingChat
 */
export async function executeVibingChat(request: VibingChatRequest): Promise<VibingChatResponse> {
  return getApiClient().executeVibingChat(request);
}

/**
 * Convenience wrapper for executeVibingChatAction
 */
export async function executeVibingChatAction(
  sessionId: string,
  actionId: VibingChatAction,
  currentRules?: Partial<StrategyRulesResponse>,
  model?: VibingChatRequest['model'],
  llmModel?: string,
  signal?: AbortSignal
): Promise<VibingChatResponse> {
  return getApiClient().executeVibingChatAction(sessionId, actionId, currentRules, model, llmModel, signal);
}

/**
 * Translate backend error codes to user-friendly messages
 * TICKET_786 D.1: translate sentinel codes to i18n keys
 */
export function resolveErrorMessage(rawMsg: string): string {
  // api-client / auth-utils sentinels
  if (rawMsg === 'AUTH_REQUIRED' || rawMsg === 'AUTH_NOT_AUTHENTICATED') {
    return i18n.t('MSG_AUTH_NOT_AUTHENTICATED', { ns: 'errors' });
  }
  if (rawMsg === 'AUTH_API_UNAVAILABLE') {
    return i18n.t('MSG_AUTH_API_UNAVAILABLE', { ns: 'errors' });
  }
  if (rawMsg === 'TASK_NO_ID') {
    return i18n.t('MSG_TASK_NO_ID', { ns: 'errors' });
  }
  if (rawMsg === 'TASK_NO_RESULT') {
    return i18n.t('MSG_TASK_NO_RESULT', { ns: 'errors' });
  }
  if (rawMsg === 'TASK_TIMEOUT') {
    return i18n.t('MSG_TASK_TIMEOUT', { ns: 'errors' });
  }

  // Fallback to generic error
  return i18n.t('MSG_GENERIC_ERROR', { ns: 'errors' });
}

export function createStandardPollHandler<T>(
  tag: string,
  mapResult: (status: string | undefined, result: Record<string, unknown> | undefined) => T,
): (response: unknown) => { isComplete: boolean; result: T; rawResponse: unknown } {
  return (response: unknown) => {
    const resp = response as ApiResponse;
    const status = resp.data?.status;
    const isComplete = status === 'completed' || status === 'failed' || status === 'rejected';
    const result = resp.data?.result as Record<string, unknown> | undefined;

    console.debug(`[${tag}] Poll response:`, JSON.stringify(resp, null, 2).substring(0, 2000));

    return {
      isComplete,
      result: mapResult(status, result),
      rawResponse: response,
    };
  };
}
