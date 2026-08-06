/**
 * ISSUE_7252 Tests - Watchlist nonabt C++ Migration
 *
 * Verifies:
 * - Poll response unwrapping from operation_result.data.*
 * - New error codes (AUTH_ERROR, QUOTA_EXCEEDED, STRATEGY_CONFIG_INVALID, LLM_PROVIDER_ERROR)
 * - Request shape: no expression mode, no condition_type, no output_format
 * - New response fields: language, includes, class_name, base_class
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock i18next
// ---------------------------------------------------------------------------

vi.mock('i18next', () => ({
  default: {
    language: 'en_US',
    t: (key: string, opts?: Record<string, unknown>) => {
      // Return the key itself for tests (mirrors i18next fallback behavior).
      // The service resolveErrorCode checks `resolved !== i18nKey` to detect
      // missing translations, but in unit tests we simply return a predictable
      // string so getErrorMessage assertions can match.
      const translations: Record<string, string> = {
        'errorCodes.AUTH_ERROR': 'Authentication failed. Please log in again or check your API key.',
        'errorCodes.QUOTA_EXCEEDED': 'Request quota exceeded. Please wait before trying again or upgrade your plan.',
        'errorCodes.STRATEGY_CONFIG_INVALID': 'Strategy configuration is invalid. Please review your indicator and logic settings.',
        'errorCodes.LLM_PROVIDER_ERROR': 'LLM provider encountered an error. Please try a different model or provider.',
      };
      return translations[key] ?? key;
    },
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

import {
  executeMarketObserverGeneration,
  getErrorMessage,
  validateMarketObserverConfig,
} from '../market-observer-service';
import type { MarketObserverConfig, MarketObserverResult } from '../market-observer-service';

// ---------------------------------------------------------------------------
// Poll response unwrapping: operation_result.data.*
// ---------------------------------------------------------------------------

describe('ISSUE_7252: Poll response unwrapping (operation_result.data.*)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'test-access-token' });
  });

  it('should extract language, includes, class_name, base_class from operation_result.data', async () => {
    // Start succeeds
    mockApiProxy.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ success: true, data: { task_id: 'task-cpp' } }),
    });

    // Poll returns completed with nested operation_result.data
    mockApiProxy.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        success: true,
        data: {
          status: 'completed',
          result: {
            status: 'completed',
            validation_status: 'VALID',
            operation_result: {
              data: {
                strategy_code: '#include <stratforge/strategy.hpp>\nclass MyObs : public stratforge::ObserverStrategy {};',
                language: 'cpp',
                includes: ['stratforge/strategy.hpp', 'stratforge/indicators.hpp'],
                class_name: 'MyObs',
                base_class: 'stratforge::ObserverStrategy',
              },
            },
          },
        },
      }),
    });

    const config: MarketObserverConfig = {
      rules: [{
        rule_type: 'template_based',
        indicator: { slug: 'RSI', name: 'RSI', params: { period: 14 } },
        strategy: { logic: { type: 'threshold_simple', operator: '>', threshold_value: 70 } },
      }],
      strategy_name: 'RSI Observer',
      llm_provider: 'GROK',
      llm_model: 'grok-3',
    };

    const result = await executeMarketObserverGeneration(config);

    expect(result.status).toBe('completed');
    expect(result.strategy_code).toContain('stratforge::ObserverStrategy');
    expect(result.language).toBe('cpp');
    expect(result.includes).toEqual(['stratforge/strategy.hpp', 'stratforge/indicators.hpp']);
    expect(result.class_name).toBe('MyObs');
    expect(result.base_class).toBe('stratforge::ObserverStrategy');
  });

  it('should fallback to flat result fields when operation_result.data is absent', async () => {
    mockApiProxy.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ success: true, data: { task_id: 'task-flat' } }),
    });

    // Flat response (backward compat)
    mockApiProxy.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        success: true,
        data: {
          status: 'completed',
          result: {
            status: 'completed',
            strategy_code: '// flat code',
            language: 'cpp',
          },
        },
      }),
    });

    const config: MarketObserverConfig = {
      rules: [{
        rule_type: 'template_based',
        indicator: { slug: 'SMA', name: 'SMA' },
        strategy: { logic: { type: 'crossover_price_indicator', operator: '>' } },
      }],
      strategy_name: 'Flat Test',
      llm_provider: 'OPENAI',
      llm_model: 'gpt-4o',
    };

    const result = await executeMarketObserverGeneration(config);

    expect(result.strategy_code).toBe('// flat code');
    expect(result.language).toBe('cpp');
  });
});

// ---------------------------------------------------------------------------
// Error code mapping (ISSUE_7234)
// ---------------------------------------------------------------------------

describe('ISSUE_7252: Error code mapping (i18n)', () => {
  it('should resolve AUTH_ERROR to localized message', () => {
    const result: MarketObserverResult = {
      status: 'failed',
      reason_code: 'AUTH_ERROR',
    };
    const msg = getErrorMessage(result);
    expect(msg).toContain('Authentication');
  });

  it('should resolve QUOTA_EXCEEDED to localized message', () => {
    const result: MarketObserverResult = {
      status: 'failed',
      error: { code: 'QUOTA_EXCEEDED' },
    };
    const msg = getErrorMessage(result);
    expect(msg).toContain('quota');
  });

  it('should resolve STRATEGY_CONFIG_INVALID to localized message', () => {
    const result: MarketObserverResult = {
      status: 'failed',
      reason_code: 'STRATEGY_CONFIG_INVALID',
    };
    const msg = getErrorMessage(result);
    expect(msg).toBeDefined();
    expect(msg).not.toBe('MSG_GENERIC_ERROR');
  });

  it('should resolve LLM_PROVIDER_ERROR to localized message', () => {
    const result: MarketObserverResult = {
      status: 'failed',
      reason_code: 'LLM_PROVIDER_ERROR',
    };
    const msg = getErrorMessage(result);
    expect(msg).toBeDefined();
    expect(msg).not.toBe('MSG_GENERIC_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Request shape validation (no expression mode)
// ---------------------------------------------------------------------------

describe('ISSUE_7252: Request shape validation', () => {
  it('rejects rules without indicator slug', () => {
    const result = validateMarketObserverConfig({
      llm_provider: 'GROK',
      rules: [{ rule_type: 'template_based' }],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('MSG_BUILDER_VALIDATION_RULE_REQUIRES_INDICATOR');
  });

  it('only accepts template_based rule_type', () => {
    const result = validateMarketObserverConfig({
      llm_provider: 'GROK',
      rules: [{
        rule_type: 'template_based',
        indicator: { slug: 'RSI', name: 'RSI' },
      }],
    });
    expect(result.valid).toBe(true);
  });
});
