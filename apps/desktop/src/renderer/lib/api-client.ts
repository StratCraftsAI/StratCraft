/**
 * API Client (TICKET_082, DESKTOP_CLIENT_INTEGRATION_GUIDE)
 *
 * Provides HTTP communication with backend server.
 * Supports both simple requests and long-running task polling.
 *
 * IMPORTANT: Server already returns structured response.
 * Do NOT wrap it again - return server response directly.
 */

import { API_CONFIG, TASK_CONFIG } from '@shared/constants';
import i18n from 'i18next';
import type { ApiResponse, PollOptions } from '@shared/types';

// Renderer logging via IPC to main process
const log = {
  debug: (msg: string, ...args: unknown[]) => {
    console.debug(`[API] ${msg}`, ...args);
    window.electronAPI?.log?.('debug', 'API', msg, ...args);
  },
  info: (msg: string, ...args: unknown[]) => {
    console.info(`[API] ${msg}`, ...args);
    window.electronAPI?.log?.('info', 'API', msg, ...args);
  },
  warn: (msg: string, ...args: unknown[]) => {
    console.warn(`[W:API:GENERIC_WARN] [API] ${msg}`, ...args);
    window.electronAPI?.log?.('warn', 'API', msg, ...args);
  },
  error: (msg: string, ...args: unknown[]) => {
    console.error(`[E:API:GENERIC_ERROR] [API] ${msg}`, ...args);
    window.electronAPI?.log?.('error', 'API', msg, ...args);
  },
};

class ApiClient {
  private baseUrl: string;
  private timeout: number;
  private isRefreshing: boolean = false;

  constructor(baseUrl: string = API_CONFIG.BASE_URL, timeout: number = API_CONFIG.TIMEOUT) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  /**
   * Get access token from AuthService via IPC
   * TICKET_165: Silent Token Refresh
   */
  private async getAccessToken(): Promise<string | null> {
    try {
      const response = await window.electronAPI?.auth?.getAccessToken();
      if (response?.success && response.data) {
        return response.data;
      }
      return null;
    } catch (error) {
      log.warn('Failed to get access token:', error);
      return null;
    }
  }

  /**
   * Refresh access token via IPC
   * TICKET_165: Silent Token Refresh
   */
  private async refreshToken(): Promise<boolean> {
    if (this.isRefreshing) {
      return false;
    }

    this.isRefreshing = true;
    try {
      const response = await window.electronAPI?.auth?.refresh();
      return response?.success ?? false;
    } catch (error) {
      log.error('Token refresh failed:', error);
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Make HTTP request to backend
   * Returns server response directly without wrapping
   * TICKET_165: Auto-injects Authorization header and handles 401
   */
  private async request<T extends ApiResponse>(
    endpoint: string,
    options: RequestInit = {},
    isRetry: boolean = false
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    // Log request
    log.info(`Request: ${options.method || 'GET'} ${url}`);
    if (options.body) {
      log.debug(`Request body: ${options.body}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // TICKET_165: Get access token and inject Authorization header
      const accessToken = await this.getAccessToken();

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'X-Client-Type': 'desktop',  // REQUIRED: Identifies desktop client
        ...options.headers,
      };

      if (accessToken) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers,
      });

      clearTimeout(timeoutId);

      // TICKET_165: Handle 401 - trigger token refresh and retry once
      if (response.status === 401 && !isRetry) {
        log.info('Received 401, attempting token refresh...');
        const refreshed = await this.refreshToken();
        if (refreshed) {
          log.info('Token refreshed, retrying request...');
          return this.request<T>(endpoint, options, true);
        }
        log.warn('Token refresh failed, returning 401 response');
      }

      // Server returns { success, task_id, status, result, error, ... }
      // Return it directly - do NOT wrap it again
      const serverResponse = await response.json();
      log.info(`Response: ${response.status} ${response.statusText}`);
      log.debug(`Response body: ${JSON.stringify(serverResponse)}`);
      return serverResponse as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        log.error(`Request timeout: ${url}`);
        return {
          success: false,
          data: {
            status: 'failed' as const,
            result: {
              error: {
                // i18n key in the `errors` namespace; consumer translates via tErrors()
                code: 'MSG_TIMEOUT_ERROR',
                message: 'MSG_TIMEOUT_ERROR',
              },
            },
          },
        } as unknown as T;
      }

      log.error(`Request error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        data: {
          status: 'failed' as const,
          result: {
            error: {
              code: 'NETWORK_ERROR',
              message: error instanceof Error ? error.message : i18n.t('MSG_UNKNOWN_ERROR', { ns: 'errors' }),
            },
          },
        },
      } as unknown as T;
    }
  }

  async get<T extends ApiResponse>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T extends ApiResponse>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T extends ApiResponse>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T extends ApiResponse>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  // Health check
  async health(): Promise<boolean> {
    const result = await this.get<ApiResponse & { status?: string }>('/health');
    return result.success && (result as { status?: string }).status === 'healthy';
  }

  /**
   * Execute long-running task with polling (TICKET_082, DESKTOP_CLIENT_INTEGRATION_GUIDE)
   *
   * Pattern: Start task (POST) -> Poll for completion (GET) -> Return result
   *
   * IMPORTANT: Read task_id and status from TOP-LEVEL response, not nested data.
   *
   * @param options - Polling configuration
   * @returns Promise resolving to task result
   */
  async executeWithPolling<T>(options: PollOptions<T>): Promise<T> {
    const {
      initialData,
      startEndpoint,
      pollEndpoint,
      pollInterval = TASK_CONFIG.DEFAULT_POLL_INTERVAL,
      timeout = TASK_CONFIG.DEFAULT_TIMEOUT,
      handlePollResponse,
    } = options;

    // 1. Start task (POST)
    // Response: { success, data: { task_id, status, result, ... } }
    log.info(`Starting task: ${startEndpoint}`);
    log.debug(`Task payload: ${JSON.stringify(initialData)}`);

    const startResponse = await this.post<ApiResponse>(startEndpoint, initialData);

    if (!startResponse.success) {
      // Error location: response.data.result.error
      const resultError = startResponse.data?.result as { error?: { message?: string } } | undefined;
      const errorMsg = resultError?.error?.message || i18n.t('renderer.api.failedToStartTask', { ns: 'errors' });
      log.error(`Task start failed: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // task_id location: response.data.task_id
    const taskId = startResponse.data?.task_id;
    if (!taskId) {
      log.error('No task_id in response');
      // TICKET_786 D.1: sentinel; presentation translates via errors:MSG_TASK_NO_ID
      throw new Error('TASK_NO_ID');
    }

    log.info(`Task started: ${taskId}`);

    // 2. Poll for completion (POST with task_id in body)
    const startTime = Date.now();
    let pollCount = 0;

    while (Date.now() - startTime < timeout) {
      pollCount++;
      log.debug(`Polling (${pollCount}): ${taskId}`);

      const pollResponse = await this.post<ApiResponse>(
        pollEndpoint,
        { task_id: taskId }
      );

      if (!pollResponse.success) {
        const resultError = pollResponse.data?.result as { error?: { message?: string } } | undefined;
        log.error(`Poll failed: ${resultError?.error?.message || 'Unknown error'}`);
        throw new Error(resultError?.error?.message || i18n.t('renderer.api.pollRequestFailed', { ns: 'errors' }));
      }

      // status location: response.data.status
      const status = pollResponse.data?.status;
      log.debug(`Poll status: ${status}`);

      if (status === 'failed') {
        const resultError = pollResponse.data?.result as { error?: { message?: string } } | undefined;
        log.error(`Task failed: ${resultError?.error?.message || 'Unknown error'}`);
        throw new Error(resultError?.error?.message || i18n.t('renderer.api.taskFailed', { ns: 'errors' }));
      }

      // Use custom handler to determine completion
      const result = handlePollResponse(pollResponse);

      if (result.isComplete) {
        if (result.result === undefined) {
          log.error('Task completed but no result');
          // TICKET_786 D.1: sentinel; presentation translates via errors:MSG_TASK_NO_RESULT
          throw new Error('TASK_NO_RESULT');
        }
        log.info(`Task completed: ${taskId}`);
        return result.result;
      }

      // Wait before next poll
      await this.delay(pollInterval);
    }

    log.error(`Task timeout: ${taskId}`);
    // TICKET_786 D.1: sentinel + interpolation data; presentation translates via errors:MSG_TASK_TIMEOUT
    const err = new Error('TASK_TIMEOUT') as Error & { timeoutMs?: number };
    err.timeoutMs = timeout;
    throw err;
  }

  /**
   * Delay helper for polling
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Default export singleton
export const apiClient = new ApiClient();
