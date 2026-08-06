/**
 * Plugin API Client - IPC Proxy Tests (TICKET_672 / TICKET_673 / TICKET_677)
 *
 * Tests that plugin api-client routes requests through Main Process IPC proxy.
 * Auth handling is enforced in both the plugin boundary and Main Process.
 * Plugin layer handles the AUTH_REQUIRED pre-check and locale injection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock i18next for locale injection (TICKET_677)
// ---------------------------------------------------------------------------

vi.mock('i18next', () => ({
  default: {
    language: 'en_US',
    t: (key: string) => key,
  },
}));

import i18n from 'i18next';

function setLanguage(lang: string) {
  (i18n as { language: string }).language = lang;
}

// ---------------------------------------------------------------------------
// Mock global objects (assign properties, do not replace globalThis/window)
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

// Assign onto globalThis so we don't clobber setTimeout/fetch etc.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api-client IPC proxy routing (TICKET_672)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should route requests through IPC api.proxy', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'jwt-token' });
    mockApiProxy.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ success: true, data: { task_id: 'abc' } }),
    });

    const result = await pluginApiClient.post('/api/some_endpoint', { test: true });

    expect(mockApiProxy).toHaveBeenCalledWith({
      endpoint: '/api/some_endpoint',
      method: 'POST',
      body: { locale: 'en_US', test: true },
      skipAuth: false,
    });
    expect(result.success).toBe(true);
  });

  it('should reject generation polling when user has no token', async () => {
    mockGetAccessToken.mockResolvedValue({ success: false });

    await expect(pluginApiClient.executeWithPolling({
      initialData: { symbol: 'AAPL' },
      startEndpoint: '/api/start_market_regime_analysis',
      pollEndpoint: '/api/check_market_regime_status',
      handlePollResponse: (response: unknown) => {
        const resp = response as { success: boolean; data?: { status?: string; result?: unknown } };
        return {
          isComplete: resp.data?.status === 'completed',
          result: resp.data?.result,
          rawResponse: response,
        };
      },
    })).rejects.toThrow('AUTH_REQUIRED');

    expect(mockApiProxy).not.toHaveBeenCalled();
  });

  it('should throw AUTH_REQUIRED for non-free endpoints without token', async () => {
    mockGetAccessToken.mockResolvedValue({ success: false });

    await expect(
      pluginApiClient.post('/api/some_pro_endpoint', { test: true }),
    ).rejects.toThrow('AUTH_REQUIRED');

    expect(mockApiProxy).not.toHaveBeenCalled();
  });

  it('should override skipAuth and require a token for generation endpoints', async () => {
    mockGetAccessToken.mockResolvedValue({ success: false });

    await expect(
      pluginApiClient.post('/api/start_market_regime_analysis', { test: true }, undefined, true),
    ).rejects.toThrow('AUTH_REQUIRED');

    expect(mockApiProxy).not.toHaveBeenCalled();
  });

  it('should return NETWORK_ERROR on IPC failure', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'jwt' });
    mockApiProxy.mockRejectedValue(new Error('IPC channel closed'));

    const result = await pluginApiClient.post('/api/some_endpoint', {});

    expect(result.success).toBe(false);
    const resultData = result.data?.result as Record<string, unknown>;
    const err = resultData?.error as { code?: string };
    expect(err?.code).toBe('NETWORK_ERROR');
  });

  it('should return PARSE_ERROR on non-JSON response body', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'jwt' });
    mockApiProxy.mockResolvedValue({
      status: 200,
      body: '<html>Error</html>',
    });

    const result = await pluginApiClient.post('/api/some_endpoint', {});

    expect(result.success).toBe(false);
    const resultData = result.data?.result as Record<string, unknown>;
    const err = resultData?.error as { code?: string };
    expect(err?.code).toBe('PARSE_ERROR');
  });
});

describe('api-client generation auth boundary (TICKET_1304_8 AC-7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject anonymous generation before a backend quota response', async () => {
    mockGetAccessToken.mockResolvedValue({ success: false });
    mockApiProxy.mockResolvedValue({
      status: 429,
      body: JSON.stringify({ error: 'Rate limited' }),
    });

    await expect(
      pluginApiClient.post('/api/start_market_regime_analysis', {}, undefined, true),
    ).rejects.toThrow('AUTH_REQUIRED');
    expect(mockApiProxy).not.toHaveBeenCalled();
  });

  it('should NOT throw quota error for authenticated 429', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'jwt' });
    mockApiProxy.mockResolvedValue({
      status: 429,
      body: JSON.stringify({ success: false, error: 'Rate limited' }),
    });

    // Non-skipAuth 429 should just parse response normally
    const result = await pluginApiClient.post('/api/some_endpoint', {});
    expect(result.success).toBe(false);
  });
});

describe('api-client locale injection (TICKET_677)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLanguage('en_US');
  });

  it('should auto-inject locale into POST body', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'jwt' });
    mockApiProxy.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ success: true, data: {} }),
    });

    await pluginApiClient.post('/api/some_endpoint', { strategy_name: 'Test' });

    const sentBody = mockApiProxy.mock.calls[0][0].body;
    expect(sentBody.locale).toBe('en_US');
    expect(sentBody.strategy_name).toBe('Test');
  });

  it('should use current i18n language for locale', async () => {
    setLanguage('zh_CN');
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'jwt' });
    mockApiProxy.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ success: true, data: {} }),
    });

    await pluginApiClient.post('/api/some_endpoint', { test: true });

    const sentBody = mockApiProxy.mock.calls[0][0].body;
    expect(sentBody.locale).toBe('zh_CN');
  });

  it('should NOT overwrite explicit locale in body', async () => {
    setLanguage('zh_CN');
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'jwt' });
    mockApiProxy.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ success: true, data: {} }),
    });

    await pluginApiClient.post('/api/some_endpoint', { locale: 'fr_FR', test: true });

    const sentBody = mockApiProxy.mock.calls[0][0].body;
    // Explicit locale wins because it comes after the default in spread
    expect(sentBody.locale).toBe('fr_FR');
  });

  it('should fall back to en_US for unknown language', async () => {
    setLanguage('xx_XX');
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'jwt' });
    mockApiProxy.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ success: true, data: {} }),
    });

    await pluginApiClient.post('/api/some_endpoint', { test: true });

    const sentBody = mockApiProxy.mock.calls[0][0].body;
    expect(sentBody.locale).toBe('en_US');
  });

  it('should NOT inject locale for non-object body', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'jwt' });
    mockApiProxy.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ success: true, data: {} }),
    });

    await pluginApiClient.post('/api/some_endpoint', undefined);

    const sentBody = mockApiProxy.mock.calls[0][0].body;
    expect(sentBody).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TICKET_1304_8 AC-7: Strategy generation auth header contract
// ---------------------------------------------------------------------------

describe('api-client AC-7: strategy generation always sends JWT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send skipAuth=false for free endpoint when user has token', async () => {
    // User is logged in
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'jwt-token-abc' });
    mockApiProxy
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({ success: true, data: { task_id: 'task-1' } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({ success: true, data: { status: 'completed', result: { output: 'ok' } } }),
      });

    await pluginApiClient.executeWithPolling({
      initialData: { symbol: 'AAPL' },
      startEndpoint: '/api/start_market_regime_analysis',
      pollEndpoint: '/api/check_market_regime_status',
      handlePollResponse: (response: unknown) => {
        const resp = response as { success: boolean; data?: { status?: string; result?: unknown } };
        return {
          isComplete: resp.data?.status === 'completed',
          result: resp.data?.result,
          rawResponse: response,
        };
      },
    });

    // TICKET_679: Even though endpoint is free, user has token -> skipAuth=false
    expect(mockApiProxy.mock.calls[0][0].skipAuth).toBe(false);
    expect(mockApiProxy.mock.calls[1][0].skipAuth).toBe(false);
  });

  it('should send skipAuth=false for free direct post when user has token', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'jwt-token-abc' });
    mockApiProxy.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ success: true, data: {} }),
    });

    // Direct post with skipAuth=true (as executeWithPolling would pass)
    await pluginApiClient.post('/api/start_market_regime_analysis', { test: true }, undefined, true);

    // TICKET_679: Token exists -> effectiveSkipAuth flipped to false
    expect(mockApiProxy.mock.calls[0][0].skipAuth).toBe(false);
  });

  it('should show login UI and reject generation without a token', async () => {
    mockGetAccessToken.mockResolvedValue({ success: false });
    mockApiProxy.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ success: true, data: {} }),
    });

    await expect(
      pluginApiClient.post('/api/start_market_regime_analysis', { test: true }, undefined, true),
    ).rejects.toThrow('AUTH_REQUIRED');

    const dispatchEvent = (globalThis as Record<string, unknown>).window as { dispatchEvent: ReturnType<typeof vi.fn> };
    const authRequiredCalls = dispatchEvent.dispatchEvent.mock.calls.filter(
      (call: unknown[]) => (call[0] as CustomEvent)?.type === 'nexus:auth-required'
    );
    expect(authRequiredCalls).toHaveLength(1);
    expect(mockApiProxy).not.toHaveBeenCalled();
  });

  it('should keep skipAuth=false for non-free endpoints (unchanged behavior)', async () => {
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'jwt' });
    mockApiProxy.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ success: true, data: {} }),
    });

    await pluginApiClient.post('/api/start_kronos_prediction', { test: true });

    expect(mockApiProxy.mock.calls[0][0].skipAuth).toBe(false);
  });
});
