/**
 * TICKET_688 Tests
 *
 * Task A: buildServerRequest must include strategy.logic dict
 * Task F: poll error extraction must read data.result.error.error_message
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock i18next
// ---------------------------------------------------------------------------

vi.mock('i18next', () => ({
  default: {
    language: 'en_US',
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  },
}));

// ---------------------------------------------------------------------------
// Mock global objects
// ---------------------------------------------------------------------------

const mockGetAccessToken = vi.fn();
const mockApiProxy = vi.fn();

const mockElectronAPI = {
  auth: {
    getAccessToken: mockGetAccessToken,
    refresh: vi.fn(),
  },
  api: {
    proxy: mockApiProxy,
  },
  installToken: {
    get: vi.fn(),
    reRegister: vi.fn(),
  },
};

(globalThis as Record<string, unknown>).window = {
  electronAPI: mockElectronAPI,
  dispatchEvent: vi.fn(),
};

(globalThis as Record<string, unknown>).nexus = {
  window: { showAlert: vi.fn() },
};

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { pluginApiClient } from '../api-client';
import type { MarketObserverConfig } from '../market-observer-service';

// ---------------------------------------------------------------------------
// Helpers: Access unexported buildServerRequest via executeMarketObserverGeneration
//
// Since buildServerRequest is not exported, we test it indirectly by calling
// executeMarketObserverGeneration and inspecting the IPC proxy call payload.
// ---------------------------------------------------------------------------

async function captureStartPayload(config: MarketObserverConfig): Promise<Record<string, unknown>> {
  mockGetAccessToken.mockResolvedValue({ success: true, data: 'test-access-token' });

  // Mock start endpoint to return task_id, then poll to return completed
  mockApiProxy
    .mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ success: true, data: { task_id: 'test-task' } }),
    })
    .mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        success: true,
        data: {
          status: 'completed',
          result: { status: 'completed', strategy_code: '// test' },
        },
      }),
    });

  // We need to dynamically import to avoid circular issues
  const { executeMarketObserverGeneration } = await import('../market-observer-service');
  await executeMarketObserverGeneration(config);

  // First proxy call is the start endpoint
  const startCall = mockApiProxy.mock.calls[0][0];
  return JSON.parse(JSON.stringify(startCall.body));
}

// ---------------------------------------------------------------------------
// Task A: buildServerRequest strategy.logic tests
// ---------------------------------------------------------------------------

describe('TICKET_688 Task A: buildServerRequest includes strategy.logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should include logic dict for boundary_comparison type', async () => {
    const config: MarketObserverConfig = {
      rules: [{
        rule_type: 'template_based',
        indicator: { slug: 'PriceOscillator', name: 'PriceOscillator', params: { period1: 12, period2: 26 } },
        strategy: {
          logic: {
            type: 'boundary_comparison_oscillator',
            operator: '>',
            threshold_value: 0,
          },
        },
      }],
      strategy_name: 'Test Strategy',
      llm_provider: 'GROK',
      llm_model: 'grok-3',
    };

    const payload = await captureStartPayload(config);
    const opData = payload.operation_data as Record<string, unknown>;
    const strategy = opData.strategy as Record<string, unknown>;

    expect(strategy.type).toBe('boundary_comparison');
    expect(strategy.logic).toBeDefined();

    const logic = strategy.logic as Record<string, unknown>;
    expect(logic.operator).toBe('>');
    expect(logic.threshold_param).toBe('upperband');
  });

  it('should include logic dict for threshold_level type', async () => {
    const config: MarketObserverConfig = {
      rules: [{
        rule_type: 'template_based',
        indicator: { slug: 'RSI', name: 'RSI', params: { period: 14 } },
        strategy: {
          logic: {
            type: 'threshold_simple',
            operator: '>',
            threshold_value: 70,
          },
        },
      }],
      strategy_name: 'RSI Threshold',
      llm_provider: 'GROK',
      llm_model: 'grok-3',
    };

    const payload = await captureStartPayload(config);
    const opData = payload.operation_data as Record<string, unknown>;
    const strategy = opData.strategy as Record<string, unknown>;

    expect(strategy.type).toBe('threshold_level');
    expect(strategy.logic).toBeDefined();

    const logic = strategy.logic as Record<string, unknown>;
    expect(logic.operator).toBe('>');
    expect(logic.threshold_value).toBe(70);
  });

  it('should include logic dict for crossover type', async () => {
    const config: MarketObserverConfig = {
      rules: [{
        rule_type: 'template_based',
        indicator: { slug: 'SMA', name: 'SMA', params: { period: 20 } },
        strategy: {
          logic: {
            type: 'crossover_price_indicator',
            operator: '>',
            threshold_value: 0,
          },
        },
      }],
      strategy_name: 'SMA Crossover',
      llm_provider: 'GROK',
      llm_model: 'grok-3',
    };

    const payload = await captureStartPayload(config);
    const opData = payload.operation_data as Record<string, unknown>;
    const strategy = opData.strategy as Record<string, unknown>;

    expect(strategy.type).toBe('crossover');
    expect(strategy.logic).toBeDefined();

    const logic = strategy.logic as Record<string, unknown>;
    expect(logic.operator).toBe('>');
    expect(logic.line1).toBe('price');
    expect(logic.line2).toBe('indicator');
  });

  it('should include label field in strategy', async () => {
    const config: MarketObserverConfig = {
      rules: [{
        rule_type: 'template_based',
        indicator: { slug: 'ATR', name: 'ATR', params: { period: 14 } },
        strategy: {
          logic: {
            type: 'volatility_threshold',
            operator: '>',
            threshold_value: 0.05,
          },
        },
      }],
      strategy_name: 'ATR Volatility',
      llm_provider: 'GROK',
      llm_model: 'grok-3',
    };

    const payload = await captureStartPayload(config);
    const opData = payload.operation_data as Record<string, unknown>;
    const strategy = opData.strategy as Record<string, unknown>;

    expect(strategy.label).toBeDefined();
    expect(typeof strategy.label).toBe('string');
    expect((strategy.label as string).length).toBeGreaterThan(0);
  });

  it('should NOT include condition_type or output_format in request (ISSUE_7252)', async () => {
    const config: MarketObserverConfig = {
      rules: [{
        rule_type: 'template_based',
        indicator: { slug: 'RSI', name: 'RSI', params: { period: 14 } },
        strategy: {
          logic: {
            type: 'threshold_simple',
            operator: '>',
            threshold_value: 70,
          },
        },
      }],
      strategy_name: 'RSI Test',
      llm_provider: 'GROK',
      llm_model: 'grok-3',
    };

    const payload = await captureStartPayload(config);
    const opData = payload.operation_data as Record<string, unknown>;

    expect(opData.condition_type).toBeUndefined();
    expect(opData.expression).toBeUndefined();
    expect(payload.output_format).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Task F: Poll error extraction tests
// ---------------------------------------------------------------------------

describe('TICKET_688 Task F: poll error reads data.result.error.error_message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should extract error_message from data.result.error (structured error contract)', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'test-access-token' });

    // Start succeeds
    mockApiProxy.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ success: true, data: { task_id: 'task-err' } }),
    });

    // Poll returns structured error (per structured_error.py contract)
    mockApiProxy.mockResolvedValueOnce({
      status: 500,
      body: JSON.stringify({
        success: false,
        data: {
          task_id: 'task-err',
          status: 'FAILED',
          result: {
            status: 'FAILED',
            error: {
              error_code: 'LLM_SERVICE_ERROR',
              error_message: 'AI analysis service temporarily unavailable',
              suggested_action: 'Please retry in 60 seconds',
              retry_suggested: true,
            },
          },
        },
      }),
    });

    await expect(
      pluginApiClient.executeWithPolling({
        initialData: { test: true },
        startEndpoint: '/api/start_watchlist_operation',
        pollEndpoint: '/api/check_watchlist_operation_status',
        handlePollResponse: (response: unknown) => {
          const resp = response as { success: boolean; data?: { status?: string; result?: unknown } };
          return {
            isComplete: resp.data?.status === 'completed',
            result: resp.data?.result,
            rawResponse: response,
          };
        },
      }),
    ).rejects.toThrow('AI analysis service temporarily unavailable');
  });

  it('lets a domain decoder reject an HTTP-200 failed task before completion mapping', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'test-access-token' });
    mockApiProxy
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({ success: true, data: { task_id: 'task-failed-200' } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({
          success: false,
          data: { status: 'failed', result: { error: { error_code: 'LLM_SERVICE_ERROR' } } },
        }),
      });

    const decodeTaskFailure = vi.fn((response: unknown) => {
      const body = response as { data?: { status?: string } };
      return body.data?.status === 'failed'
        ? { message: 'Decoded provider failure', backendCode: 'LLM_SERVICE_ERROR' }
        : undefined;
    });

    const operation = pluginApiClient.executeWithPolling({
      initialData: { test: true },
      startEndpoint: '/api/vibing_chat',
      pollEndpoint: '/api/check_vibing_chat_status',
      decodeTaskFailure,
      handlePollResponse: () => ({
        isComplete: true,
        result: 'must-not-complete',
        rawResponse: null,
      }),
    });

    await expect(operation).rejects.toMatchObject({
      message: 'Decoded provider failure',
      code: 'LLM_SERVICE_ERROR',
    });
    expect(decodeTaskFailure).toHaveBeenCalledTimes(2);
  });

  it('should extract message from data.result.error.message (proxy-normalized TICKET_682 format)', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'test-access-token' });

    mockApiProxy.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ success: true, data: { task_id: 'task-proxy' } }),
    });

    // Proxy-normalized error: data.result.error.{code, message} (not error_code/error_message)
    mockApiProxy.mockResolvedValueOnce({
      status: 502,
      body: JSON.stringify({
        success: false,
        data: {
          status: 'failed',
          result: {
            error: {
              code: 'HTTP_502',
              message: 'Service temporarily unavailable. Please try again later.',
            },
          },
        },
      }),
    });

    await expect(
      pluginApiClient.executeWithPolling({
        initialData: { test: true },
        startEndpoint: '/api/start_watchlist_operation',
        pollEndpoint: '/api/check_watchlist_operation_status',
        handlePollResponse: (response: unknown) => {
          const resp = response as { success: boolean; data?: { status?: string; result?: unknown } };
          return {
            isComplete: resp.data?.status === 'completed',
            result: resp.data?.result,
            rawResponse: response,
          };
        },
      }),
    ).rejects.toThrow('Service temporarily unavailable. Please try again later.');
  });

  it('should fallback to data.error.message for legacy error format', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'test-access-token' });

    mockApiProxy.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ success: true, data: { task_id: 'task-legacy' } }),
    });

    // Legacy error format: data.error.message
    mockApiProxy.mockResolvedValueOnce({
      status: 500,
      body: JSON.stringify({
        success: false,
        data: {
          error: {
            code: 'LEGACY_ERROR',
            message: 'Legacy error message',
          },
        },
      }),
    });

    await expect(
      pluginApiClient.executeWithPolling({
        initialData: { test: true },
        startEndpoint: '/api/start_watchlist_operation',
        pollEndpoint: '/api/check_watchlist_operation_status',
        handlePollResponse: (response: unknown) => {
          const resp = response as { success: boolean; data?: { status?: string; result?: unknown } };
          return {
            isComplete: resp.data?.status === 'completed',
            result: resp.data?.result,
            rawResponse: response,
          };
        },
      }),
    ).rejects.toThrow('Legacy error message');
  });

  it('should fallback to generic message when no error detail available', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'test-access-token' });

    mockApiProxy.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ success: true, data: { task_id: 'task-empty' } }),
    });

    // No error detail at all
    mockApiProxy.mockResolvedValueOnce({
      status: 500,
      body: JSON.stringify({
        success: false,
        data: { status: 'FAILED' },
      }),
    });

    await expect(
      pluginApiClient.executeWithPolling({
        initialData: { test: true },
        startEndpoint: '/api/start_watchlist_operation',
        pollEndpoint: '/api/check_watchlist_operation_status',
        handlePollResponse: (response: unknown) => {
          const resp = response as { success: boolean; data?: { status?: string; result?: unknown } };
          return {
            isComplete: resp.data?.status === 'completed',
            result: resp.data?.result,
            rawResponse: response,
          };
        },
      }),
    ).rejects.toThrow('errors.pollRequestFailed');
  });
});
