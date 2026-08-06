/**
 * Unit tests for chart-market-data handler functions.
 * TICKET_1235_9: CH1 market data reads + CH3 Kronos prediction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDiscoverServiceApi, mockApiClient } = vi.hoisted(() => ({
  mockDiscoverServiceApi: vi.fn(),
  mockApiClient: {
    marketGetData: vi.fn(),
    marketGetSymbols: vi.fn(),
    kronosRunPrediction: vi.fn(),
    kronosCancelPrediction: vi.fn(),
    kronosListModels: vi.fn(),
  },
}));

vi.mock('../../bridge/discovery', () => ({
  discoverServiceApi: mockDiscoverServiceApi,
}));

vi.mock('../../bridge/api-client', () => mockApiClient);

import {
  handleGetMarketData,
  handleGetMarketSymbols,
  handleRunKronosPrediction,
  handleCancelKronosPrediction,
  handleListKronosModels,
} from '../chart-market-data';

const mockConfig = { baseUrl: 'http://localhost:19876', token: 'test-token' };

// =============================================================================
// CH1: get_market_data
// =============================================================================

describe('handleGetMarketData', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns OHLCV bars on success', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.marketGetData.mockResolvedValue({
      success: true,
      data: {
        symbol: 'AAPL',
        interval: '1d',
        provider: 'yfinance',
        bar_count: 252,
        start_date: '2023-01-01',
        end_date: '2023-12-31',
        bars: [],
      },
    });

    const result = await handleGetMarketData({
      symbol: 'AAPL',
      interval: '1d',
      start_date: '2023-01-01',
      end_date: '2023-12-31',
    });
    expect(result.isError).toBeUndefined();
    expect(mockApiClient.marketGetData).toHaveBeenCalledWith(mockConfig, {
      symbol: 'AAPL',
      interval: '1d',
      start_date: '2023-01-01',
      end_date: '2023-12-31',
    });
  });

  it('returns isError when Electron not running', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);
    const result = await handleGetMarketData({
      symbol: 'AAPL',
      interval: '1d',
      start_date: '2023-01-01',
      end_date: '2023-12-31',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not running');
  });

  it('returns isError on bridge failure', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.marketGetData.mockResolvedValue({
      success: false,
      error: 'Provider not found',
    });

    const result = await handleGetMarketData({
      symbol: 'AAPL',
      interval: '1d',
      start_date: '2023-01-01',
      end_date: '2023-12-31',
      provider: 'unknown',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Provider not found');
  });

  it('passes provider when specified', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.marketGetData.mockResolvedValue({
      success: true,
      data: { symbol: 'EURUSD', interval: '5m', provider: 'dukascopy', bar_count: 100, bars: [] },
    });

    await handleGetMarketData({
      symbol: 'EURUSD',
      interval: '5m',
      start_date: '2024-01-01',
      end_date: '2024-01-07',
      provider: 'dukascopy',
    });
    expect(mockApiClient.marketGetData).toHaveBeenCalledWith(mockConfig, {
      symbol: 'EURUSD',
      interval: '5m',
      start_date: '2024-01-01',
      end_date: '2024-01-07',
      provider: 'dukascopy',
    });
  });

  it('handles thrown exceptions from bridge', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.marketGetData.mockRejectedValue(new Error('Network timeout'));

    const result = await handleGetMarketData({
      symbol: 'AAPL',
      interval: '1d',
      start_date: '2023-01-01',
      end_date: '2023-12-31',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Network timeout');
  });
});

// =============================================================================
// CH1: get_market_symbols
// =============================================================================

describe('handleGetMarketSymbols', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns symbols on success', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.marketGetSymbols.mockResolvedValue({
      success: true,
      data: { results: [{ symbol: 'AAPL', name: 'Apple Inc.' }], totalCount: 1, truncated: false },
    });

    const result = await handleGetMarketSymbols({ query: 'AAPL' });
    expect(result.isError).toBeUndefined();
    expect(mockApiClient.marketGetSymbols).toHaveBeenCalledWith(mockConfig, { query: 'AAPL' });
  });

  it('returns isError when Electron not running', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);
    const result = await handleGetMarketSymbols({ query: 'AAPL' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not running');
  });

  it('passes provider and limit', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.marketGetSymbols.mockResolvedValue({
      success: true,
      data: { results: [], totalCount: 0, truncated: false },
    });

    await handleGetMarketSymbols({ query: 'BTC', provider: 'ccxt', limit: 10 });
    expect(mockApiClient.marketGetSymbols).toHaveBeenCalledWith(mockConfig, {
      query: 'BTC', provider: 'ccxt', limit: 10,
    });
  });
});

// =============================================================================
// CH3: run_kronos_prediction
// =============================================================================

describe('handleRunKronosPrediction', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns prediction on success', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.kronosRunPrediction.mockResolvedValue({
      success: true,
      data: {
        symbol: 'AAPL',
        timeframe: '1d',
        model_version: 'kronos-small',
        prediction_length: 120,
        prediction: [],
      },
    });

    const result = await handleRunKronosPrediction({ symbol: 'AAPL', timeframe: '1d' });
    expect(result.isError).toBeUndefined();
    expect(mockApiClient.kronosRunPrediction).toHaveBeenCalledWith(mockConfig, {
      symbol: 'AAPL',
      timeframe: '1d',
    });
  });

  it('returns isError when Electron not running', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);
    const result = await handleRunKronosPrediction({ symbol: 'AAPL', timeframe: '1d' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not running');
  });

  it('passes prediction_settings and advanced_settings', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.kronosRunPrediction.mockResolvedValue({
      success: true,
      data: { prediction: [] },
    });

    await handleRunKronosPrediction({
      symbol: 'EURUSD',
      timeframe: '1h',
      prediction_settings: { lookback: 500, pred_len: 200, model_version: 'kronos-base' },
      advanced_settings: { temperature: 0.8, top_p: 0.95, top_k: 50, sample_count: 5 },
    });

    expect(mockApiClient.kronosRunPrediction).toHaveBeenCalledWith(mockConfig, {
      symbol: 'EURUSD',
      timeframe: '1h',
      prediction_settings: { lookback: 500, pred_len: 200, model_version: 'kronos-base' },
      advanced_settings: { temperature: 0.8, top_p: 0.95, top_k: 50, sample_count: 5 },
    });
  });

  it('handles bridge error response', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.kronosRunPrediction.mockResolvedValue({
      success: false,
      error: 'Kronos server unavailable',
    });

    const result = await handleRunKronosPrediction({ symbol: 'AAPL', timeframe: '1d' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Kronos server unavailable');
  });
});

// =============================================================================
// CH3: cancel_kronos_prediction
// =============================================================================

describe('handleCancelKronosPrediction', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns cancel acknowledgment on success', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.kronosCancelPrediction.mockResolvedValue({
      success: true,
      data: { task_id: 'pred-123', note: 'Cancel request acknowledged.' },
    });

    const result = await handleCancelKronosPrediction({ task_id: 'pred-123' });
    expect(result.isError).toBeUndefined();
    expect(mockApiClient.kronosCancelPrediction).toHaveBeenCalledWith(mockConfig, { task_id: 'pred-123' });
  });

  it('returns isError when Electron not running', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);
    const result = await handleCancelKronosPrediction({ task_id: 'pred-123' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not running');
  });
});

// =============================================================================
// CH3: list_kronos_models
// =============================================================================

describe('handleListKronosModels', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns model catalog on success', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.kronosListModels.mockResolvedValue({
      success: true,
      data: {
        models: [
          { id: 'kronos-mini', name: 'Kronos Mini', params: '8M', max_context: 512 },
          { id: 'kronos-small', name: 'Kronos Small', params: '20M', max_context: 1024 },
          { id: 'kronos-base', name: 'Kronos Base', params: '84M', max_context: 2048 },
        ],
      },
    });

    const result = await handleListKronosModels();
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.models).toHaveLength(3);
    expect(parsed.models[0].id).toBe('kronos-mini');
  });

  it('returns isError when Electron not running', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);
    const result = await handleListKronosModels();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not running');
  });
});
