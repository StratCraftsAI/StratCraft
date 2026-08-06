/**
 * TICKET_992_7: Tests for direct nona_server HTTP client.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { NONA_TEST_BASE_URL } from './test-endpoints';

vi.mock('../constants', async (importOriginal) => ({
  ...await importOriginal<typeof import('../constants')>(),
  MCP_REQUEST_TIMEOUT_MS: 5000,
  MCP_GENERATION_TIMEOUT_MS: 180000,
  MCP_GENERATION_POLL_INTERVAL_MS: 0,
}));

import {
  generateStrategy,
  generateEntrySignal,
  generateExitStrategy,
  generateKronosStrategy,
  generateAILiberoStrategy,
  executeVibingChat,
  listPersonas,
} from '../nona-client';
import type { NonaServerConfig } from '../nona-server-config';

const CONFIG: NonaServerConfig = {
  baseUrl: NONA_TEST_BASE_URL,
  authToken: 'test-token',
  baseUrlSource: 'default',
};

const CONFIG_NO_TOKEN: NonaServerConfig = {
  baseUrl: NONA_TEST_BASE_URL,
  authToken: null,
  baseUrlSource: 'default',
};

function mockFetchOk(data: unknown = { success: true, data: {} }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(data),
  });
}

function mockFetchHttpError(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn(),
  });
}

function mockFetchNetworkError(message = 'network failure') {
  return vi.fn().mockRejectedValue(new Error(message));
}

function lastFetchCall(mockFn: Mock) {
  return mockFn.mock.calls[mockFn.mock.calls.length - 1];
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('nona-client auth header', () => {
  it('sends Authorization header when authToken is present', async () => {
    globalThis.fetch = mockFetchOk();
    await listPersonas(CONFIG);

    const [, init] = lastFetchCall(globalThis.fetch as Mock);
    expect(init.headers['Authorization']).toBe('Bearer test-token');
  });

  it('omits Authorization header when authToken is null', async () => {
    globalThis.fetch = mockFetchOk();
    await listPersonas(CONFIG_NO_TOKEN);

    const [, init] = lastFetchCall(globalThis.fetch as Mock);
    expect(init.headers['Authorization']).toBeUndefined();
  });
});

describe('generateStrategy', () => {
  it('sends to correct endpoint', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: { task_id: 'TASK-1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          data: {
            status: 'completed',
            result: { status: 'success', strategy_code: 'class Trend {}' },
          },
        }),
      });
    await generateStrategy(CONFIG, { regime: 'trend', indicators: ['RSI'], strategy_name: 'T' });

    const [url] = (globalThis.fetch as Mock).mock.calls[0];
    expect(url).toBe(`${NONA_TEST_BASE_URL}/api/start_market_regime_analysis`);
  });

  it('polls the production status endpoint and returns its completed result', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: { task_id: 'TASK-2' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          data: {
            status: 'completed',
            result: { status: 'success', strategy_code: 'class Trend {}' },
          },
        }),
      });

    const result = await generateStrategy(CONFIG, { locale: 'en_US' });

    expect(result).toEqual({
      success: true,
      data: { status: 'success', strategy_code: 'class Trend {}' },
    });
    const [url, init] = lastFetchCall(globalThis.fetch as Mock);
    expect(url).toBe(`${NONA_TEST_BASE_URL}/api/check_market_regime_status`);
    expect(JSON.parse(init.body)).toEqual({ task_id: 'TASK-2', locale: 'en_US' });
  });

  it('returns the structured task failure from the poll response', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: { task_id: 'TASK-3' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          data: {
            status: 'failed',
            result: { error: { error_message: 'Provider key rejected' } },
          },
        }),
      });

    await expect(generateStrategy(CONFIG, {})).resolves.toEqual({
      success: false,
      error: 'Provider key rejected',
    });
  });

  it('rejects a start response without a task id', async () => {
    globalThis.fetch = mockFetchOk({ success: true, data: {} });
    const result = await generateStrategy(CONFIG, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('task_id');
  });

  it('rejects a completed task without a result payload', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: { task_id: 'TASK-4' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: { status: 'completed' } }),
      });

    const result = await generateStrategy(CONFIG, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('completed without a result');
  });

  it('retries transient 502/503/504 on status poll and succeeds when backend recovers', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: { task_id: 'TASK-5' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: vi.fn().mockRejectedValue(new Error('non-json')),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          data: { status: 'completed', result: { strategy_code: 'class Recovered {}' } },
        }),
      });

    const result = await generateStrategy(CONFIG, {});
    expect(result).toEqual({
      success: true,
      data: { strategy_code: 'class Recovered {}' },
    });
    expect((globalThis.fetch as Mock).mock.calls).toHaveLength(3);
  });

  it('fails after exhausting transient retry budget on status poll', async () => {
    const pollError = () => ({
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new Error('non-json')),
    });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: { task_id: 'TASK-5b' } }),
      })
      .mockResolvedValueOnce(pollError())
      .mockResolvedValueOnce(pollError())
      .mockResolvedValueOnce(pollError())
      .mockResolvedValueOnce(pollError())
      .mockResolvedValueOnce(pollError())
      .mockResolvedValueOnce(pollError());

    const result = await generateStrategy(CONFIG, {});
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect((globalThis.fetch as Mock).mock.calls).toHaveLength(7);
  });

  it('propagates a non-transient HTTP failure from the status poll immediately', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: { task_id: 'TASK-5c' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: vi.fn().mockRejectedValue(new Error('non-json')),
      });

    const result = await generateStrategy(CONFIG, {});
    expect(result).toEqual({
      success: false,
      error: `HTTP 401 from ${NONA_TEST_BASE_URL}/api/check_market_regime_status`,
      status: 401,
    });
    expect((globalThis.fetch as Mock).mock.calls).toHaveLength(2);
  });

  it('times out after a non-terminal poll response', async () => {
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(180001);
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: { task_id: 'TASK-6' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: { status: 'processing' } }),
      });

    try {
      const result = await generateStrategy(CONFIG, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('did not complete within');
    } finally {
      now.mockRestore();
    }
  });

  it('treats rejected status as terminal (parity with GenerationService)', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: { task_id: 'TASK-REJ' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          data: {
            status: 'rejected',
            result: { reason_code: 'CONTENT_POLICY', error: 'Content policy violation' },
          },
        }),
      });

    const result = await generateStrategy(CONFIG, {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('Content policy violation');
    expect((globalThis.fetch as Mock).mock.calls).toHaveLength(2);
  });

  it('extracts reason_code when error field is absent on rejected status', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: { task_id: 'TASK-REJ2' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          data: {
            status: 'rejected',
            result: { reason_code: 'QUOTA_EXCEEDED' },
          },
        }),
      });

    const result = await generateStrategy(CONFIG, {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('QUOTA_EXCEEDED');
  });

  it('returns error on network failure', async () => {
    globalThis.fetch = mockFetchNetworkError();
    const result = await generateStrategy(CONFIG, { regime: 'trend', indicators: ['RSI'], strategy_name: 'T' });
    expect(result.success).toBe(false);
  });
});

describe('executeVibingChat', () => {
  it('starts and polls the authoritative Vibing Chat endpoints', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          data: { task_id: 'VIBE-1', status: 'pending' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          data: {
            status: 'completed',
            result: {
              content: 'Larry Williams rules',
              available_actions: ['generate_code'],
            },
          },
        }),
      });

    const result = await executeVibingChat(CONFIG, {
      task_id: 'VIBE-1',
      session_id: 'session-1',
      message: 'extract Larry Williams strategy',
    });

    expect(result).toEqual({
      success: true,
      data: {
        content: 'Larry Williams rules',
        available_actions: ['generate_code'],
      },
    });
    expect((globalThis.fetch as Mock).mock.calls[0][0]).toBe(
      `${NONA_TEST_BASE_URL}/api/vibing_chat`,
    );
    const [pollUrl, pollInit] = lastFetchCall(globalThis.fetch as Mock);
    expect(pollUrl).toBe(
      `${NONA_TEST_BASE_URL}/api/check_vibing_chat_status`,
    );
    expect(JSON.parse(pollInit.body)).toEqual({ task_id: 'VIBE-1' });
    expect(pollInit.headers.Authorization).toBe('Bearer test-token');
  });

  it('returns a synchronous completed result without polling', async () => {
    globalThis.fetch = mockFetchOk({
      success: true,
      data: {
        status: 'completed',
        result: { content: 'defined rules' },
      },
    });

    await expect(executeVibingChat(CONFIG, {
      task_id: 'VIBE-SYNC',
    })).resolves.toEqual({
      success: true,
      data: { content: 'defined rules' },
    });
    expect((globalThis.fetch as Mock).mock.calls).toHaveLength(1);
  });

  it('preserves an HTTP-200 failed-task code before generic transport handling', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          data: { task_id: 'VIBE-FAILED-200', status: 'processing' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: false,
          data: {
            task_id: 'VIBE-FAILED-200',
            status: 'failed',
            result: {
              error: {
                error_code: 'LLM_SERVICE_ERROR',
                error_message: 'Provider generation failed.',
              },
            },
          },
        }),
      });

    await expect(executeVibingChat(CONFIG, {
      task_id: 'VIBE-FAILED-200',
    })).resolves.toEqual({
      success: false,
      error: 'Provider generation failed.',
      errorCode: 'LLM_SERVICE_ERROR',
      taskFailure: {
        status: 'failed',
        backendCode: 'LLM_SERVICE_ERROR',
        message: 'Provider generation failed.',
        taskId: 'VIBE-FAILED-200',
      },
    });
  });

  it('never targets the nonexistent Electron session route on nona_server', async () => {
    globalThis.fetch = mockFetchHttpError(401);
    await executeVibingChat(CONFIG, { task_id: 'VIBE-401' });

    const [url] = (globalThis.fetch as Mock).mock.calls[0];
    expect(url).not.toContain('/api/v1/ai-studio/session/');
    expect(url.endsWith('/api/vibing_chat')).toBe(true);
  });

  it('refreshes a rejected bearer once and retries the start request', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({
          success: false,
          data: {
            status: 'failed',
            result: { error: { error_code: 'INVALID_TOKEN', error_message: 'Expired token' } },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          data: {
            status: 'completed',
            result: { content: 'defined rules' },
          },
        }),
      });
    const recover = vi.fn().mockResolvedValue('refreshed-token');

    const result = await executeVibingChat(
      CONFIG,
      { task_id: 'VIBE-REFRESH' },
      recover,
    );

    expect(result).toEqual({
      success: true,
      data: { content: 'defined rules' },
    });
    expect(recover).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith('test-token');
    const [, retryInit] = (globalThis.fetch as Mock).mock.calls[1];
    expect(retryInit.headers.Authorization).toBe('Bearer refreshed-token');
  });

  it('does not retry a second 401 after one auth recovery', async () => {
    const unauthorized = () => ({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({
        success: false,
        data: {
          status: 'failed',
          result: { error: { error_message: 'Authentication required' } },
        },
      }),
    });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized());
    const recover = vi.fn().mockResolvedValue('still-invalid');

    await expect(executeVibingChat(
      CONFIG,
      { task_id: 'VIBE-REJECTED' },
      recover,
    )).resolves.toEqual({
      success: false,
      error: 'Authentication required',
      status: 401,
    });
    expect(recover).toHaveBeenCalledOnce();
    expect((globalThis.fetch as Mock).mock.calls).toHaveLength(2);
  });

  it('recovers once when the bearer expires during polling', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          data: { task_id: 'VIBE-POLL-REFRESH', status: 'processing' },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({
          data: {
            status: 'failed',
            result: { error: { error_message: 'Expired token' } },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          data: {
            status: 'completed',
            result: { content: 'defined rules' },
          },
        }),
      });
    const recover = vi.fn().mockResolvedValue('poll-refreshed-token');

    await expect(executeVibingChat(
      CONFIG,
      { task_id: 'VIBE-POLL-REFRESH' },
      recover,
    )).resolves.toEqual({
      success: true,
      data: { content: 'defined rules' },
    });
    expect(recover).toHaveBeenCalledOnce();
    const [, retryInit] = (globalThis.fetch as Mock).mock.calls[2];
    expect(retryInit.headers.Authorization).toBe('Bearer poll-refreshed-token');
  });

  it('preserves the backend structured authentication error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({
        success: false,
        data: {
          status: 'failed',
          result: {
            error: {
              error_code: 'AUTH_REQUIRED',
              error_message: 'Authentication required',
            },
          },
        },
      }),
    });

    await expect(executeVibingChat(CONFIG_NO_TOKEN, {
      task_id: 'VIBE-AUTH',
    })).resolves.toEqual({
      success: false,
      error: 'Authentication required',
      status: 401,
    });
  });
});

describe('generateEntrySignal', () => {
  it('sends to correct endpoint', async () => {
    globalThis.fetch = mockFetchOk();
    await generateEntrySignal(CONFIG, { strategy_name: 'E', indicators: ['RSI'] });

    const [url] = lastFetchCall(globalThis.fetch as Mock);
    expect(url).toBe(`${NONA_TEST_BASE_URL}/api/v1/strategy/generate-entry`);
  });
});

describe('generateExitStrategy', () => {
  it('sends to correct endpoint', async () => {
    globalThis.fetch = mockFetchOk();
    await generateExitStrategy(CONFIG, { strategy_name: 'X', exit_rules: [] });

    const [url] = lastFetchCall(globalThis.fetch as Mock);
    expect(url).toBe(`${NONA_TEST_BASE_URL}/api/v1/strategy/generate-exit`);
  });
});

describe('generateKronosStrategy', () => {
  it('sends to correct endpoint', async () => {
    globalThis.fetch = mockFetchOk();
    await generateKronosStrategy(CONFIG, { strategy_name: 'K' });

    const [url] = lastFetchCall(globalThis.fetch as Mock);
    expect(url).toBe(`${NONA_TEST_BASE_URL}/api/v1/strategy/generate-kronos`);
  });
});

describe('generateAILiberoStrategy', () => {
  it('sends to correct endpoint', async () => {
    globalThis.fetch = mockFetchOk();
    await generateAILiberoStrategy(CONFIG, { strategy_name: 'L', prompt: 'test' });

    const [url] = lastFetchCall(globalThis.fetch as Mock);
    expect(url).toBe(`${NONA_TEST_BASE_URL}/api/v1/strategy/generate-ai-libero`);
  });
});

describe('listPersonas', () => {
  it('sends to correct endpoint', async () => {
    globalThis.fetch = mockFetchOk();
    await listPersonas(CONFIG);

    const [url] = lastFetchCall(globalThis.fetch as Mock);
    expect(url).toBe(`${NONA_TEST_BASE_URL}/api/v1/persona/list`);
  });
});
