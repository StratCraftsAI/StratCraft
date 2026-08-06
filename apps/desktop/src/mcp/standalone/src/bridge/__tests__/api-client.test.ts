/**
 * Unit tests for MCP Service API Client
 *
 * Tests all exported functions from api-client.ts:
 * - Simple request functions (listBacktestResults, getBacktestResult, etc.)
 * - Generation functions with extended timeouts (generateStrategy, etc.)
 * - runBacktest / getBacktestStatus
 *
 * Covers: success, HTTP error, network error, abort/timeout, URL/header/body correctness.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('../../constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../constants')>()),
  MCP_REQUEST_TIMEOUT_MS: 5000,
  MCP_GENERATION_TIMEOUT_MS: 120000,
  MCP_BACKTEST_TIMEOUT_MS: 300000,
}));

// TICKET_1265_4: api-client self-heals stale discovery files on
// connection-level failure; stub the fs-touching part.
const { mockRemoveStaleDiscoveryFiles } = vi.hoisted(() => ({
  mockRemoveStaleDiscoveryFiles: vi.fn(),
}));

vi.mock('../discovery', () => ({
  removeStaleDiscoveryFiles: mockRemoveStaleDiscoveryFiles,
}));

import {
  listBacktestResults,
  getBacktestResult,
  listStrategies,
  getStrategy,
  listFactors,
  listSignalSources,
  listPersonas,
  generateStrategy,
  generateEntrySignal,
  generateExitStrategy,
  generateKronosStrategy,
  generateAILiberoStrategy,
  runBacktest,
  getBacktestStatus,
  getLstmFitQualityReport,
  startGenerationSession,
  cancelGenerationSession,
  getGenerationState,
  generateFromCatalog,
  startBatchGeneration,
  cancelBatchGeneration,
  getBatchGenerationState,
  marketplaceGetRegistry,
  marketplaceGetPluginDetails,
  marketplaceCheckUpdates,
  marketplaceActivateLicense,
  marketplaceGetLicenseStatus,
  marketplaceRemoveLicense,
  marketplaceCheckEntitlement,
  marketplaceCheckEntitlementsBatch,
  entitlementGetAuditLog,
  getAppRateLimitStatus,
  getAppServerStatus,
  reloadSystemConfig,
  getSystemConfigHealth,
  getMachineInfo,
  backupDatabase,
  listDatabaseBackups,
  restoreDatabase,
  getCommercialCapability,
  executeCommercialOperation,
} from '../api-client';
import type { ServiceApiConfig } from '../discovery';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIG: ServiceApiConfig = {
  baseUrl: 'http://127.0.0.1:12345',
  token: 'test-token',
};

function mockFetchOk(data: unknown = { success: true, data: {} }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
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

function mockFetchAbortError() {
  const err = new DOMException('The operation was aborted.', 'AbortError');
  return vi.fn().mockRejectedValue(err);
}

function lastFetchCall(mockFn: Mock) {
  return mockFn.mock.calls[mockFn.mock.calls.length - 1];
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  vi.useFakeTimers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Shared test factory for simple request-based functions
// ---------------------------------------------------------------------------

interface SimpleCase {
  name: string;
  call: () => Promise<unknown>;
  expectedPath: string;
  expectedBody: Record<string, unknown>;
}

const simpleCases: SimpleCase[] = [
  {
    name: 'getAppRateLimitStatus',
    call: () => getAppRateLimitStatus(CONFIG),
    expectedPath: '/api/v1/app/rate-limit-status',
    expectedBody: {},
  },
  {
    name: 'getAppServerStatus',
    call: () => getAppServerStatus(CONFIG),
    expectedPath: '/api/v1/app/server-status',
    expectedBody: {},
  },
  {
    name: 'listBacktestResults',
    call: () => listBacktestResults(CONFIG, 10),
    expectedPath: '/api/v1/backtest/list',
    expectedBody: { limit: 10 },
  },
  {
    name: 'listBacktestResults (default limit)',
    call: () => listBacktestResults(CONFIG),
    expectedPath: '/api/v1/backtest/list',
    expectedBody: { limit: 20 },
  },
  {
    name: 'getBacktestResult',
    call: () => getBacktestResult(CONFIG, 'task-abc'),
    expectedPath: '/api/v1/backtest/result',
    expectedBody: { task_id: 'task-abc' },
  },
  {
    name: 'listStrategies',
    call: () => listStrategies(CONFIG, 25),
    expectedPath: '/api/v1/strategy/list',
    expectedBody: { limit: 25 },
  },
  {
    name: 'listStrategies (default limit)',
    call: () => listStrategies(CONFIG),
    expectedPath: '/api/v1/strategy/list',
    expectedBody: { limit: 50 },
  },
  {
    name: 'getStrategy',
    call: () => getStrategy(CONFIG, 42),
    expectedPath: '/api/v1/strategy/get',
    expectedBody: { id: 42 },
  },
  {
    name: 'listFactors',
    call: () => listFactors(CONFIG, 30),
    expectedPath: '/api/v1/factor/list',
    expectedBody: { limit: 30 },
  },
  {
    name: 'listSignalSources',
    call: () => listSignalSources(CONFIG, 15),
    expectedPath: '/api/v1/signal-source/list',
    expectedBody: { limit: 15 },
  },
  {
    name: 'listPersonas',
    call: () => listPersonas(CONFIG),
    expectedPath: '/api/v1/persona/list',
    expectedBody: {},
  },
  {
    name: 'getBacktestStatus',
    call: () => getBacktestStatus(CONFIG, 'task-xyz'),
    expectedPath: '/api/v1/backtest/status',
    expectedBody: { task_id: 'task-xyz' },
  },
  {
    name: 'getLstmFitQualityReport',
    call: () => getLstmFitQualityReport(CONFIG, {
      limit: 3,
      include_incompatible: true,
      include_process_state: true,
    }),
    expectedPath: '/api/v1/quant-lab/lstm-fit-quality-report',
    expectedBody: {
      limit: 3,
      include_incompatible: true,
      include_process_state: true,
    },
  },
  {
    name: 'startGenerationSession',
    call: () => startGenerationSession(CONFIG, {
      page_id: 'regime-detector',
      strategy_name: 'TrendStrategy',
      start_endpoint: '/api/start_market_regime_analysis',
      poll_endpoint: '/api/check_market_regime_status',
      request_body: { locale: 'en_US' },
      poll_interval_ms: 500,
      timeout_ms: 180000,
    }),
    expectedPath: '/api/v1/generation/session/start',
    expectedBody: {
      page_id: 'regime-detector',
      strategy_name: 'TrendStrategy',
      start_endpoint: '/api/start_market_regime_analysis',
      poll_endpoint: '/api/check_market_regime_status',
      request_body: { locale: 'en_US' },
      poll_interval_ms: 500,
      timeout_ms: 180000,
    },
  },
  {
    name: 'cancelGenerationSession',
    call: () => cancelGenerationSession(CONFIG, 'regime-detector'),
    expectedPath: '/api/v1/generation/session/cancel',
    expectedBody: { page_id: 'regime-detector' },
  },
  {
    name: 'getGenerationState',
    call: () => getGenerationState(CONFIG, 'regime-detector'),
    expectedPath: '/api/v1/generation/session/state',
    expectedBody: { page_id: 'regime-detector' },
  },
  {
    name: 'generateFromCatalog',
    call: () => generateFromCatalog(CONFIG, {
      catalog_id: 'trend-following-1',
      strategy_name: 'CatalogStrategy',
      llm_provider: 'OPENAI',
      llm_model: 'gpt-4',
      customization: { timeframe: '1h', risk_level: 'MEDIUM' },
    }),
    expectedPath: '/api/v1/strategy/generate-from-catalog',
    expectedBody: {
      catalog_id: 'trend-following-1',
      strategy_name: 'CatalogStrategy',
      llm_provider: 'OPENAI',
      llm_model: 'gpt-4',
      customization: { timeframe: '1h', risk_level: 'MEDIUM' },
    },
  },
  {
    name: 'startBatchGeneration',
    call: () => startBatchGeneration(CONFIG, {
      regime: 'trend',
      indicators: ['SMA'],
      quantity: 2,
      llm_provider: 'OPENAI',
      llm_model: 'gpt-4',
    }),
    expectedPath: '/api/v1/strategy/batch-generation/start',
    expectedBody: {
      regime: 'trend',
      indicators: ['SMA'],
      quantity: 2,
      llm_provider: 'OPENAI',
      llm_model: 'gpt-4',
    },
  },
  {
    name: 'cancelBatchGeneration',
    call: () => cancelBatchGeneration(CONFIG),
    expectedPath: '/api/v1/strategy/batch-generation/cancel',
    expectedBody: {},
  },
  {
    name: 'getBatchGenerationState',
    call: () => getBatchGenerationState(CONFIG),
    expectedPath: '/api/v1/strategy/batch-generation/state',
    expectedBody: {},
  },
  {
    name: 'marketplaceGetRegistry',
    call: () => marketplaceGetRegistry(CONFIG, { force_refresh: true }),
    expectedPath: '/api/v1/marketplace/get-registry',
    expectedBody: { force_refresh: true },
  },
  {
    name: 'marketplaceGetPluginDetails',
    call: () => marketplaceGetPluginDetails(CONFIG, { plugin_id: 'plugin.a' }),
    expectedPath: '/api/v1/marketplace/get-plugin-details',
    expectedBody: { plugin_id: 'plugin.a' },
  },
  {
    name: 'marketplaceCheckUpdates',
    call: () => marketplaceCheckUpdates(CONFIG),
    expectedPath: '/api/v1/marketplace/check-updates',
    expectedBody: {},
  },
  {
    name: 'marketplaceActivateLicense',
    call: () => marketplaceActivateLicense(CONFIG, {
      plugin_id: 'plugin.a',
      license_key: 'secret',
      confirm: true,
    }),
    expectedPath: '/api/v1/marketplace/activate-license',
    expectedBody: { plugin_id: 'plugin.a', license_key: 'secret', confirm: true },
  },
  {
    name: 'marketplaceGetLicenseStatus',
    call: () => marketplaceGetLicenseStatus(CONFIG, { plugin_ids: ['plugin.a'] }),
    expectedPath: '/api/v1/marketplace/get-license-status',
    expectedBody: { plugin_ids: ['plugin.a'] },
  },
  {
    name: 'marketplaceRemoveLicense',
    call: () => marketplaceRemoveLicense(CONFIG, { plugin_id: 'plugin.a', confirm: true }),
    expectedPath: '/api/v1/marketplace/remove-license',
    expectedBody: { plugin_id: 'plugin.a', confirm: true },
  },
  {
    name: 'marketplaceCheckEntitlement',
    call: () => marketplaceCheckEntitlement(CONFIG, { plugin_id: 'plugin.a' }),
    expectedPath: '/api/v1/marketplace/check-entitlement',
    expectedBody: { plugin_id: 'plugin.a' },
  },
  {
    name: 'marketplaceCheckEntitlementsBatch',
    call: () => marketplaceCheckEntitlementsBatch(CONFIG, { plugin_ids: ['plugin.a'] }),
    expectedPath: '/api/v1/marketplace/check-entitlements-batch',
    expectedBody: { plugin_ids: ['plugin.a'] },
  },
  {
    name: 'entitlementGetAuditLog',
    call: () => entitlementGetAuditLog(CONFIG, { limit: 10 }),
    expectedPath: '/api/v1/entitlement/get-audit-log',
    expectedBody: { limit: 10 },
  },
];

describe('api-client simple request functions', () => {
  for (const tc of simpleCases) {
    describe(tc.name, () => {
      it('returns data on successful response', async () => {
        const payload = { success: true, data: { items: [1, 2] } };
        vi.stubGlobal('fetch', mockFetchOk(payload));

        const result = await tc.call();

        expect(result).toEqual(payload);
      });

      it('sends correct URL, method, headers, and body', async () => {
        vi.stubGlobal('fetch', mockFetchOk());

        await tc.call();

        const [url, opts] = lastFetchCall(globalThis.fetch as Mock);
        expect(url).toBe(`${CONFIG.baseUrl}${tc.expectedPath}`);
        expect(opts.method).toBe('POST');
        expect(opts.headers['Content-Type']).toBe('application/json');
        expect(opts.headers['Authorization']).toBe('Bearer test-token');
        expect(JSON.parse(opts.body)).toEqual(tc.expectedBody);
      });

      it('returns error on HTTP non-200', async () => {
        vi.stubGlobal('fetch', mockFetchHttpError(500));

        const result = await tc.call();

        expect(result).toEqual({ success: false, error: 'HTTP 500' });
      });

      it('returns error on network failure', async () => {
        vi.stubGlobal('fetch', mockFetchNetworkError('connection refused'));

        const result = await tc.call();

        expect(result).toEqual({ success: false, error: 'connection refused' });
      });

      it('returns error on abort/timeout', async () => {
        vi.stubGlobal('fetch', mockFetchAbortError());

        const result = await tc.call();

        expect(result).toEqual({ success: false, error: 'The operation was aborted.' });
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Generation functions (extended timeout, inline fetch)
// ---------------------------------------------------------------------------

interface GenerationCase {
  name: string;
  call: () => Promise<unknown>;
  expectedPath: string;
  expectedBody: Record<string, unknown>;
}

const generationCases: GenerationCase[] = [
  {
    name: 'generateStrategy',
    call: () =>
      generateStrategy(CONFIG, {
        regime: 'trend',
        indicators: ['RSI', 'MACD'],
        strategy_name: 'Trend Alpha',
        preference: 'aggressive',
        llm_provider: 'GEMINI',
        llm_model: 'gpt-4',
      }),
    expectedPath: '/api/v1/strategy/generate',
    expectedBody: {
      regime: 'trend',
      indicators: ['RSI', 'MACD'],
      strategy_name: 'Trend Alpha',
      preference: 'aggressive',
      llm_provider: 'GEMINI',
      llm_model: 'gpt-4',
    },
  },
  {
    name: 'generateEntrySignal',
    call: () =>
      generateEntrySignal(CONFIG, {
        strategy_name: 'RSI Entry',
        indicators: ['RSI'],
        entry_signal_base: 'standalone',
        auto_reverse: true,
      }),
    expectedPath: '/api/v1/strategy/generate-entry',
    expectedBody: {
      strategy_name: 'RSI Entry',
      indicators: ['RSI'],
      entry_signal_base: 'standalone',
      auto_reverse: true,
    },
  },
  {
    name: 'generateExitStrategy',
    call: () =>
      generateExitStrategy(CONFIG, {
        strategy_name: 'Stop Loss Exit',
        exit_rules: [
          { type: 'circuit_breaker', trigger_pnl_percent: -5, scope: 'per_position' },
          { type: 'time_limit', max_holding_hours: 24 },
        ],
        max_loss_percent: 10,
      }),
    expectedPath: '/api/v1/strategy/generate-exit',
    expectedBody: {
      strategy_name: 'Stop Loss Exit',
      exit_rules: [
        { type: 'circuit_breaker', trigger_pnl_percent: -5, scope: 'per_position' },
        { type: 'time_limit', max_holding_hours: 24 },
      ],
      max_loss_percent: 10,
    },
  },
  {
    name: 'generateKronosStrategy',
    call: () =>
      generateKronosStrategy(CONFIG, {
        strategy_name: 'Kronos Pred',
        model: 'kronos-small',
        lookback: 400,
        pred_len: 120,
        temperature: 1.0,
        top_p: 0.9,
        top_k: 0,
        sample_count: 1,
      }),
    expectedPath: '/api/v1/strategy/generate-kronos',
    expectedBody: {
      strategy_name: 'Kronos Pred',
      model: 'kronos-small',
      lookback: 400,
      pred_len: 120,
      temperature: 1.0,
      top_p: 0.9,
      top_k: 0,
      sample_count: 1,
    },
  },
  {
    name: 'generateAILiberoStrategy',
    call: () =>
      generateAILiberoStrategy(CONFIG, {
        strategy_name: 'AI Libero Agent',
        prompt: 'Buy low sell high with RSI confirmation',
        preset_mode: 'warrior',
        indicators: ['RSI', 'EMA'],
        analysis_interval: 10,
      }),
    expectedPath: '/api/v1/strategy/generate-ai-libero',
    expectedBody: {
      strategy_name: 'AI Libero Agent',
      prompt: 'Buy low sell high with RSI confirmation',
      preset_mode: 'warrior',
      indicators: ['RSI', 'EMA'],
      analysis_interval: 10,
    },
  },
];

describe('api-client generation functions', () => {
  for (const tc of generationCases) {
    describe(tc.name, () => {
      it('returns data on successful response', async () => {
        const payload = { success: true, data: { algorithmId: 1, strategyName: 'test' } };
        vi.stubGlobal('fetch', mockFetchOk(payload));

        const result = await tc.call();

        expect(result).toEqual(payload);
      });

      it('sends correct URL, method, headers, and body', async () => {
        vi.stubGlobal('fetch', mockFetchOk());

        await tc.call();

        const [url, opts] = lastFetchCall(globalThis.fetch as Mock);
        expect(url).toBe(`${CONFIG.baseUrl}${tc.expectedPath}`);
        expect(opts.method).toBe('POST');
        expect(opts.headers['Content-Type']).toBe('application/json');
        expect(opts.headers['Authorization']).toBe('Bearer test-token');
        expect(JSON.parse(opts.body)).toEqual(tc.expectedBody);
      });

      it('passes an AbortSignal for timeout control', async () => {
        vi.stubGlobal('fetch', mockFetchOk());

        await tc.call();

        const [, opts] = lastFetchCall(globalThis.fetch as Mock);
        expect(opts.signal).toBeInstanceOf(AbortSignal);
      });

      it('returns error on HTTP 503', async () => {
        vi.stubGlobal('fetch', mockFetchHttpError(503));

        const result = await tc.call();

        expect(result).toEqual({ success: false, error: 'HTTP 503' });
      });

      it('returns error on network failure', async () => {
        vi.stubGlobal('fetch', mockFetchNetworkError('ECONNREFUSED'));

        const result = await tc.call();

        expect(result).toEqual({ success: false, error: 'ECONNREFUSED' });
      });

      it('returns error on abort/timeout', async () => {
        vi.stubGlobal('fetch', mockFetchAbortError());

        const result = await tc.call();

        expect(result).toEqual({ success: false, error: 'The operation was aborted.' });
      });
    });
  }
});

// ---------------------------------------------------------------------------
// runBacktest (extended backtest timeout)
// ---------------------------------------------------------------------------

describe('runBacktest', () => {
  const backtestParams = {
    algorithm_id: 99,
    symbol: 'BTC-USD',
    interval: '1h',
    start_date: '2024-01-01',
    end_date: '2024-12-31',
    initial_capital: 50000,
    commission: 0.001,
    slippage: 0.0001,
    allow_short: false,
    data_source: 'yfinance',
    dry_run: false,
  };

  it('returns data on successful response', async () => {
    const payload = { success: true, data: { taskId: 'bt-001' } };
    vi.stubGlobal('fetch', mockFetchOk(payload));

    const result = await runBacktest(CONFIG, backtestParams);

    expect(result).toEqual(payload);
  });

  it('sends correct URL and body', async () => {
    vi.stubGlobal('fetch', mockFetchOk());

    await runBacktest(CONFIG, backtestParams);

    const [url, opts] = lastFetchCall(globalThis.fetch as Mock);
    expect(url).toBe('http://127.0.0.1:12345/api/v1/backtest/run');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toBe('Bearer test-token');
    expect(JSON.parse(opts.body)).toEqual(backtestParams);
  });

  it('passes an AbortSignal for timeout control', async () => {
    vi.stubGlobal('fetch', mockFetchOk());

    await runBacktest(CONFIG, backtestParams);

    const [, opts] = lastFetchCall(globalThis.fetch as Mock);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns error on HTTP 400', async () => {
    vi.stubGlobal('fetch', mockFetchHttpError(400));

    const result = await runBacktest(CONFIG, backtestParams);

    expect(result).toEqual({ success: false, error: 'HTTP 400' });
  });

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', mockFetchNetworkError('socket hang up'));

    const result = await runBacktest(CONFIG, backtestParams);

    expect(result).toEqual({ success: false, error: 'socket hang up' });
  });

  it('returns error on abort/timeout', async () => {
    vi.stubGlobal('fetch', mockFetchAbortError());

    const result = await runBacktest(CONFIG, backtestParams);

    expect(result).toEqual({ success: false, error: 'The operation was aborted.' });
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('api-client edge cases', () => {
  it('handles non-Error throw from fetch gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('string-error'));

    const result = await listStrategies(CONFIG);

    expect(result).toEqual({ success: false, error: 'string-error' });
  });

  it('handles null throw from fetch gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(null));

    const result = await listFactors(CONFIG);

    expect(result).toEqual({ success: false, error: 'null' });
  });
});

// ---------------------------------------------------------------------------
// TICKET_1265_4: unreachable classification + discovery self-heal
// ---------------------------------------------------------------------------

function econnrefusedFetchError(): TypeError {
  // undici shape: TypeError('fetch failed') with ErrnoException cause.
  const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:12345'), { code: 'ECONNREFUSED' });
  return new TypeError('fetch failed', { cause });
}

describe('api-client unreachable classification (TICKET_1265_4)', () => {
  it('marks ECONNREFUSED (via cause chain) as unreachable and self-heals discovery files', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(econnrefusedFetchError()));

    const result = await listStrategies(CONFIG);

    expect(result.success).toBe(false);
    expect(result.unreachable).toBe(true);
    expect(mockRemoveStaleDiscoveryFiles).toHaveBeenCalledWith(CONFIG);
  });

  it('marks AggregateError containing ECONNREFUSED as unreachable', async () => {
    const inner = Object.assign(new Error('connect ECONNREFUSED ::1:12345'), { code: 'ECONNREFUSED' });
    const cause = new AggregateError([inner], 'All connection attempts failed');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause })));

    const result = await listBacktestResults(CONFIG);

    expect(result.unreachable).toBe(true);
    expect(mockRemoveStaleDiscoveryFiles).toHaveBeenCalledWith(CONFIG);
  });

  it('classifies generation-path fetch failures too (shared failure path)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(econnrefusedFetchError()));

    const result = await generateKronosStrategy(CONFIG, { strategy_name: 's' });

    expect(result.unreachable).toBe(true);
    expect(mockRemoveStaleDiscoveryFiles).toHaveBeenCalledWith(CONFIG);
  });

  it('does NOT mark a plain network error without a connection code as unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up mid-body')));

    const result = await listStrategies(CONFIG);

    expect(result.success).toBe(false);
    expect(result.unreachable).toBeUndefined();
    expect(mockRemoveStaleDiscoveryFiles).not.toHaveBeenCalled();
  });

  it('does NOT mark an HTTP error as unreachable (Electron is alive)', async () => {
    vi.stubGlobal('fetch', mockFetchHttpError(500));

    const result = await listStrategies(CONFIG);

    expect(result).toEqual({ success: false, error: 'HTTP 500' });
    expect(mockRemoveStaleDiscoveryFiles).not.toHaveBeenCalled();
  });

  it('does NOT mark abort/timeout as unreachable (a slow Electron is alive)', async () => {
    vi.stubGlobal('fetch', mockFetchAbortError());

    const result = await listStrategies(CONFIG);

    expect(result.success).toBe(false);
    expect(result.unreachable).toBeUndefined();
    expect(mockRemoveStaleDiscoveryFiles).not.toHaveBeenCalled();
  });
});

describe('TICKET_1302 U8 administration routes', () => {
  it('uses the typed loopback routes and forwards only the restore contract', async () => {
    const fetchMock = mockFetchOk({ success: true });
    vi.stubGlobal('fetch', fetchMock);
    await reloadSystemConfig(CONFIG);
    await getSystemConfigHealth(CONFIG);
    await getMachineInfo(CONFIG);
    await backupDatabase(CONFIG);
    await listDatabaseBackups(CONFIG);
    await restoreDatabase(CONFIG, { backup_id: 'StratCraft_test.db', confirm: true });

    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      `${CONFIG.baseUrl}/api/v1/admin/config/reload`,
      `${CONFIG.baseUrl}/api/v1/admin/config/health`,
      `${CONFIG.baseUrl}/api/v1/admin/machine-info`,
      `${CONFIG.baseUrl}/api/v1/admin/database/backup`,
      `${CONFIG.baseUrl}/api/v1/admin/database/backups`,
      `${CONFIG.baseUrl}/api/v1/admin/database/restore`,
    ]);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toEqual({
      backup_id: 'StratCraft_test.db',
      confirm: true,
    });
  });
});

describe('TICKET_1304_15 commercial Service API bridge', () => {
  it('preserves the shared contract instead of reconstructing package behavior', async () => {
    const capability = {
      state: 'absent',
      operationId: 'research.discovery.execute',
      code: 'COMMERCIAL_PACKAGE_ABSENT',
      message: 'absent',
      remediation: 'install',
    };
    const operationResult = {
      contractVersion: '1.0.0',
      requestId: 'request-1',
      operationId: 'research.discovery.execute',
      status: 'failed',
      code: 'COMMERCIAL_PACKAGE_ABSENT',
      message: 'absent',
      remediation: 'install',
      retryable: false,
      entitlementDecisionId: null,
      resourceDecisionId: null,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(capability) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(operationResult) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCommercialCapability(
      CONFIG,
      'research.discovery.execute',
    )).resolves.toEqual(capability);
    await expect(executeCommercialOperation(CONFIG, {
      contractVersion: '1.0.0',
      requestId: 'request-1',
      operationId: 'research.discovery.execute',
      input: {},
    })).resolves.toEqual(operationResult);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      `${CONFIG.baseUrl}/api/v1/commercial/capability`,
      `${CONFIG.baseUrl}/api/v1/commercial/execute`,
    ]);
  });

  it('uses the shared unreachable failure classification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(econnrefusedFetchError()));
    await expect(getCommercialCapability(
      CONFIG,
      'research.discovery.execute',
    )).resolves.toMatchObject({ success: false, unreachable: true });
    expect(mockRemoveStaleDiscoveryFiles).toHaveBeenCalledWith(CONFIG);
  });
});
