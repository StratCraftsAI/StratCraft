/**
 * ApiKeyValidator - Validate LLM API keys
 *
 * TICKET_192: API Key Validation Test Button
 * TICKET_311: Alpaca Paper/Live key type auto-detection
 *
 * Uses lightweight API calls (list models) to validate keys without consuming tokens.
 * Keys are validated directly from Desktop - never sent to backend server.
 */

import { appLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import {
  API_KEY_VALIDATION_HARD_TIMEOUT_MS,
  API_KEY_VALIDATION_TIMEOUT_MS,
} from '../../shared/constants/timing';
import {
  PROVIDER_ALPHA_VANTAGE,
  LLM_PROVIDER_RECORDS,
  LLM_CREDENTIAL_KEYS,
  DATA_API_BASE_ALPACA,
  DATA_API_BASE_ALPACA_LIVE,
  DATA_API_BASE_ALPACA_PAPER,
  DATA_API_BASE_ALPHA_VANTAGE,
  DATA_API_BASE_POLYGON,
} from '@StratCraft/types';
import {
  discoverByokModels,
  LlmCredentialValidationError,
} from '@StratCraft/llm-providers';

// =============================================================================
// Types
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: 'INVALID_FORMAT' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'TIMEOUT' | 'UNKNOWN';
  provider: string;
  /** TICKET_311: Alpaca key type detected during validation */
  keyType?: 'paper' | 'live';
}

interface ProviderConfig {
  name: string;
  validateUrl: string;
  buildHeaders: (apiKey: string) => Record<string, string>;
  buildUrl?: (apiKey: string) => string; // For providers that use query param
  /**
   * TICKET_810: response-body discriminator. Some providers (notably
   * Alpha Vantage) return HTTP 200 with an error-bearing JSON body
   * on invalid keys instead of a 4xx status, so HTTP status alone is
   * insufficient to decide validity. Per-shape parsing is wired in
   * the validator's 200-handling branch below.
   */
  responseBodyShape?: typeof PROVIDER_ALPHA_VANTAGE;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// =============================================================================
// Provider Configurations
// =============================================================================

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  ALPACA: {
    name: 'Alpaca Markets',
    validateUrl: `${DATA_API_BASE_ALPACA}/stocks/SPY/bars?timeframe=1Day&limit=1&sort=desc`,
    buildHeaders: (apiKey) => {
      // apiKey format: "keyId:secretKey"
      const [keyId, secretKey] = apiKey.split(':');
      return {
        'APCA-API-KEY-ID': keyId || '',
        'APCA-API-SECRET-KEY': secretKey || '',
      };
    },
  },

  // TICKET_810: BYOK credential validation for Alpha Vantage.
  // SYMBOL_SEARCH is the cheapest authenticated probe -- 1 quota
  // point on success. The provider's well-known quirk is returning
  // HTTP 200 with `{"Error Message": "..."}` on invalid keys (and
  // `{"Information": "..."}` on rate-limit / wrong-tier failures),
  // so the response body must be inspected; HTTP status alone is
  // insufficient. The `responseBodyShape: PROVIDER_ALPHA_VANTAGE` flag
  // wires that body inspection into the 200 branch.
  ALPHA_VANTAGE: {
    name: 'Alpha Vantage',
    validateUrl: `${DATA_API_BASE_ALPHA_VANTAGE}/query?function=SYMBOL_SEARCH&keywords=SPY`,
    buildUrl: (apiKey) =>
      `${DATA_API_BASE_ALPHA_VANTAGE}/query?function=SYMBOL_SEARCH&keywords=SPY&apikey=${encodeURIComponent(apiKey)}`,
    buildHeaders: () => ({}),
    responseBodyShape: PROVIDER_ALPHA_VANTAGE,
  },

  // TICKET_810: BYOK credential validation for Polygon.io.
  // /v3/reference/tickers/AAPL is cheap, returns 200 on valid keys
  // and 401 on invalid keys (proper status semantics, no body
  // inspection required).
  POLYGON: {
    name: 'Polygon.io',
    validateUrl: `${DATA_API_BASE_POLYGON}/v3/reference/tickers/AAPL`,
    buildUrl: (apiKey) =>
      `${DATA_API_BASE_POLYGON}/v3/reference/tickers/AAPL?apiKey=${encodeURIComponent(apiKey)}`,
    buildHeaders: () => ({}),
  },
};

// =============================================================================
// TICKET_1266: OpenAI-Compatible custom-endpoint URL policy
// =============================================================================

/**
 * Enforce the base-URL scheme policy for OPENAI_COMPATIBLE: HTTPS only, with an
 * exception for `http://localhost` / `http://127.0.0.1` (and `[::1]`) so users
 * can point at a local relay/proxy. Returns null when acceptable, else a reason
 * key ('missing' | 'insecure') the caller localizes.
 */
export function checkOpenAICompatibleBaseUrl(
  baseUrl: string | undefined,
): 'missing' | 'insecure' | null {
  if (!baseUrl || baseUrl.trim().length === 0) return 'missing';
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return 'insecure';
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:') {
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
      return null;
    }
    return 'insecure';
  }
  return 'insecure';
}

// =============================================================================
// TICKET_311: Alpaca Paper/Live Detection
// =============================================================================

const ALPACA_LIVE_ACCOUNT_URL = `${DATA_API_BASE_ALPACA_LIVE}/account`;
const ALPACA_PAPER_ACCOUNT_URL = `${DATA_API_BASE_ALPACA_PAPER}/account`;

/**
 * Probe Alpaca trading endpoints to determine if the key is Paper or Live.
 * Result returned to UI for display and cached in-memory by AlpacaProvider.
 */
async function detectAlpacaKeyType(
  headers: Record<string, string>,
  timeout: number,
): Promise<'paper' | 'live'> {
  const probe = async (url: string): Promise<boolean> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      clearTimeout(timeoutId);
      return resp.ok;
    } catch {
      clearTimeout(timeoutId);
      return false;
    }
  };

  // Try live first
  if (await probe(ALPACA_LIVE_ACCOUNT_URL)) {
    appLog.info('[ApiKeyValidator] Alpaca key type detected: live');
    return 'live';
  }

  // Try paper
  if (await probe(ALPACA_PAPER_ACCOUNT_URL)) {
    appLog.info('[ApiKeyValidator] Alpaca key type detected: paper');
    return 'paper';
  }

  throw new Error(mainT(getCurrentMainLocale(), 'errors', 'apiKeyValidator.alpacaDetectionFailed'));
}

// =============================================================================
// Validator Class
// =============================================================================

export class ApiKeyValidator {
  private timeout: number;

  constructor(timeout = API_KEY_VALIDATION_TIMEOUT_MS) {
    this.timeout = timeout;
  }

  /**
   * Validate an API key for a specific provider.
   *
   * TICKET_1266: `baseUrl` is required for OPENAI_COMPATIBLE (the user-supplied
   * endpoint) and ignored for every other provider (their endpoint is a
   * hardcoded constant). The custom endpoint is validated with a `GET
   * {baseUrl}/models` probe against the same normalized `.../v1` host discovery
   * and inference use.
   */
  async validateKey(provider: string, apiKey: string, baseUrl?: string): Promise<ValidationResult> {
    const providerUpper = provider.toUpperCase();

    if (LLM_PROVIDER_RECORDS.some(record => record.id === providerUpper)) {
      let hardTimeoutId: NodeJS.Timeout | undefined;
      try {
        const hardTimeout = new Promise<never>((_resolve, reject) => {
          hardTimeoutId = setTimeout(
            () => reject(new LlmCredentialValidationError('timeout', 'Provider validation timed out')),
            API_KEY_VALIDATION_HARD_TIMEOUT_MS,
          );
        });
        await Promise.race([
          discoverByokModels(
            providerUpper,
            {
              primary: apiKey,
              extra: baseUrl
                ? { [LLM_CREDENTIAL_KEYS.OPENAI_COMPATIBLE_BASE_URL]: baseUrl }
                : undefined,
            },
            this.timeout,
          ),
          hardTimeout,
        ]);
        return { valid: true, provider };
      } catch (reason) {
        const error = reason instanceof LlmCredentialValidationError ? reason : null;
        const errorCode: ValidationResult['errorCode'] = error?.code === 'invalid_format'
          ? 'INVALID_FORMAT'
          : error?.code === 'auth_failed'
            ? 'AUTH_FAILED'
            : error?.code === 'timeout'
              ? 'TIMEOUT'
              : error?.code === 'network_error' || error?.code === 'provider_unavailable'
                ? 'NETWORK_ERROR'
                : 'UNKNOWN';
        return {
          valid: false,
          error: reason instanceof Error ? reason.message : String(reason),
          errorCode,
          provider,
        };
      } finally {
        if (hardTimeoutId) clearTimeout(hardTimeoutId);
      }
    }

    const config = PROVIDER_CONFIGS[providerUpper];

    if (!config) {
      return {
        valid: false,
        error: mainT(getCurrentMainLocale(), 'errors', 'apiKeyValidator.unknownProvider', { provider }),
        errorCode: 'UNKNOWN',
        provider,
      };
    }

    // Basic format validation
    if (!apiKey || apiKey.trim().length === 0) {
      return {
        valid: false,
        error: mainT(getCurrentMainLocale(), 'errors', 'apiKeyValidator.emptyKey'),
        errorCode: 'INVALID_FORMAT',
        provider,
      };
    }

    try {
      const url = config.buildUrl ? config.buildUrl(apiKey) : config.validateUrl;
      const headers = config.buildHeaders(apiKey);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      // Promise.race hard-timeout: belt-and-braces guard against undici
      // socket-pool edge cases where AbortSignal does not propagate to an
      // in-flight fetch (observed post-TICKET_809 when validation is fired
      // shortly after BYOKModelFetcher's startup probes). The hard timeout
      // is slightly larger than the abort timeout so the abort path gets
      // first chance to report a richer 'TIMEOUT' errorCode.
      let hardTimeoutId: NodeJS.Timeout | undefined;
      const hardTimeoutPromise = new Promise<never>((_, reject) => {
        hardTimeoutId = setTimeout(() => {
          reject(new Error('FETCH_HARD_TIMEOUT'));
        }, API_KEY_VALIDATION_HARD_TIMEOUT_MS);
      });

      appLog.debug(`[ApiKeyValidator] fetch start: ${providerUpper} ${url}`);
      let response: Response;
      try {
        response = await Promise.race([
          fetch(url, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              ...headers,
            },
            signal: controller.signal,
          }),
          hardTimeoutPromise,
        ]);
      } finally {
        clearTimeout(timeoutId);
        if (hardTimeoutId) clearTimeout(hardTimeoutId);
      }
      appLog.debug(
        `[ApiKeyValidator] fetch end: ${providerUpper} status=${response.status}`,
      );

      if (response.ok || response.status === 429) {
        // TICKET_810: Alpha Vantage returns HTTP 200 with an
        // error-bearing JSON body on invalid keys (`Error Message`)
        // and on rate-limit / tier-exceeded failures
        // (`Information`). Inspect the body before declaring the
        // key valid. Read it once here so the post-200 branches do
        // not try to consume an already-consumed stream.
        if (config.responseBodyShape === PROVIDER_ALPHA_VANTAGE) {
          let body: Record<string, unknown> | null = null;
          try {
            const parsed: unknown = await response.json();
            body = isJsonObject(parsed) ? parsed : null;
          } catch {
            // Empty or non-JSON 200 on Alpha Vantage means the
            // request was wedged; treat it as invalid rather than
            // silently passing. The user can retry.
            return {
              valid: false,
              error: mainT(getCurrentMainLocale(), 'errors', 'apiKeyValidator.emptyOrNonJsonAlphaVantage'),
              errorCode: 'UNKNOWN',
              provider,
            };
          }
          const errorMessage = typeof body?.['Error Message'] === 'string'
            ? body['Error Message'] as string
            : null;
          const info = typeof body?.['Information'] === 'string'
            ? body['Information'] as string
            : null;
          if (errorMessage) {
            return {
              valid: false,
              error: errorMessage,
              errorCode: 'AUTH_FAILED',
              provider,
            };
          }
          if (info) {
            return {
              valid: false,
              error: info,
              errorCode: 'AUTH_FAILED',
              provider,
            };
          }
          return { valid: true, provider };
        }

        // TICKET_311: For Alpaca, detect Paper/Live key type after successful validation
        let keyType: 'paper' | 'live' | undefined;
        if (providerUpper === 'ALPACA') {
          try {
            keyType = await detectAlpacaKeyType(headers, this.timeout);
          } catch (e) {
            appLog.warn(`[ApiKeyValidator] Alpaca key type detection failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        return {
          valid: true,
          provider,
          keyType,
        };
      }

      // Handle specific error codes
      if (response.status === 401 || response.status === 403) {
        return {
          valid: false,
          error: mainT(getCurrentMainLocale(), 'errors', 'apiKeyValidator.invalidKeyOrUnauthorized'),
          errorCode: 'AUTH_FAILED',
          provider,
        };
      }

      // Try to get error message from response
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorBody: unknown = await response.json();
        if (isJsonObject(errorBody)) {
          const nestedError = isJsonObject(errorBody.error) ? errorBody.error : null;
          if (typeof nestedError?.message === 'string') {
            errorMessage = nestedError.message;
          } else if (typeof errorBody.message === 'string') {
            errorMessage = errorBody.message;
          }
        }
      } catch {
        // Ignore JSON parse errors
      }

      return {
        valid: false,
        error: errorMessage,
        errorCode: 'UNKNOWN',
        provider,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message === 'FETCH_HARD_TIMEOUT') {
          appLog.warn(
            `[ApiKeyValidator] fetch timeout: ${providerUpper} (${error.message === 'FETCH_HARD_TIMEOUT' ? 'hard-timeout' : 'abort'})`,
          );
          return {
            valid: false,
            error: mainT(getCurrentMainLocale(), 'errors', 'apiKeyValidator.requestTimeout'),
            errorCode: 'TIMEOUT',
            provider,
          };
        }

        appLog.warn(
          `[ApiKeyValidator] fetch error: ${providerUpper} ${error.name}: ${error.message}`,
        );
        return {
          valid: false,
          error: error.message || mainT(getCurrentMainLocale(), 'errors', 'apiKeyValidator.networkError'),
          errorCode: 'NETWORK_ERROR',
          provider,
        };
      }

      appLog.warn(`[ApiKeyValidator] fetch unknown error: ${providerUpper} ${String(error)}`);
      return {
        valid: false,
        error: 'Unknown error',
        errorCode: 'UNKNOWN',
        provider,
      };
    }
  }

  /**
   * Get list of supported providers
   */
  getSupportedProviders(): string[] {
    // TICKET_1266: OPENAI_COMPATIBLE is validated via a dedicated dynamic-URL
    // path (validateOpenAICompatible), not the static PROVIDER_CONFIGS map.
    return [...Object.keys(PROVIDER_CONFIGS), ...LLM_PROVIDER_RECORDS.map(record => record.id)];
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let validatorInstance: ApiKeyValidator | null = null;

export function getApiKeyValidator(): ApiKeyValidator {
  if (!validatorInstance) {
    validatorInstance = new ApiKeyValidator();
  }
  return validatorInstance;
}

export default ApiKeyValidator;
