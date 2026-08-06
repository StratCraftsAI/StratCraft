/**
 * Centralized API Request Utility
 *
 * TICKET_217: All Builder API requests must include Authorization token.
 * This module provides authenticated fetch for all backend API calls.
 *
 * @see TICKET_141 - API Routing Architecture
 * @see TICKET_189 - Auth & Entitlement Flow
 */

import { app } from 'electron';
import { DESKTOP_API_BASE_URL } from '@StratCraft/types';
import { getAuthService } from '../services/auth-service';
import { getInstallToken, reRegisterInstallToken, ensureInstallToken } from '../services/install-token-service';  // TICKET_673, TICKET_675
import { mainT } from '../i18n/main-strings';
import { ipcLog } from './logger';
import { API_REQUEST_DEFAULT_TIMEOUT_MS } from '../../shared/constants/timing';

function getMainLocale(): string {
  return app.isReady() ? (app.getLocale()?.replace('-', '_') || 'en_US') : 'en_US';
}

// =============================================================================
// Constants
// =============================================================================

const DESKTOP_API_URL = process.env.DESKTOP_API_URL || DESKTOP_API_BASE_URL;

// =============================================================================
// Types
// =============================================================================

export interface ApiRequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  /** Skip authentication (for public endpoints) */
  skipAuth?: boolean;
  /** Custom timeout in milliseconds */
  timeout?: number;
  /**
   * When true AND authenticated, send `X-Install-Token` alongside `Authorization`.
   * Required for endpoints that use device identification (e.g. `/api/v1/auth/me`).
   * Ignored when `skipAuth` is true (skipAuth already injects X-Install-Token by itself).
   */
  includeInstallToken?: boolean;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// =============================================================================
// Auth Pre-flight (TICKET_429)
// =============================================================================

/**
 * Error thrown when an operation requires authentication but no token is available.
 * Provides a clear, actionable message identifying the operation.
 */
export class AuthRequiredError extends Error {
  constructor(operation: string) {
    super(`Authentication required for: ${operation}. Please log in first.`);
    this.name = 'AuthRequiredError';
  }
}

/**
 * Pre-flight auth check. Throws AuthRequiredError before any network call
 * if no access token is available.
 *
 * Usage:
 *   await assertAuthenticated('strategy generation');
 *   await authenticatedFetch(...);
 */
export async function assertAuthenticated(operation: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) {
    throw new AuthRequiredError(operation);
  }
}

// =============================================================================
// HTTP Error Message Mapping
// =============================================================================

/**
 * Map HTTP error responses to user-friendly messages.
 *
 * Priority:
 * 1. If the response body is valid JSON with an `error` or `message` field, use that
 *    (preserves backend-authored messages like "Invalid verification code").
 * 2. Otherwise fall back to a status-code-based friendly message
 *    (handles HTML error pages from Cloudflare, nginx, etc.).
 */
export function getHttpErrorMessage(status: number, responseText: string): string {
  try {
    const json = JSON.parse(responseText);
    if (json.error && typeof json.error === 'string') {
      return json.error;
    }
    if (json.message && typeof json.message === 'string') {
      return json.message;
    }
  } catch {
    // Not JSON - likely HTML error page (e.g. Cloudflare 502)
  }

  const locale = getMainLocale();
  switch (status) {
    case 400: return mainT(locale, 'errors', 'api.http400');
    case 401: return mainT(locale, 'errors', 'api.http401');
    case 403: return mainT(locale, 'errors', 'api.http403');
    case 404: return mainT(locale, 'errors', 'api.http404');
    case 429: return mainT(locale, 'errors', 'api.http429');
    case 500: return mainT(locale, 'errors', 'api.http500');
    case 502: return mainT(locale, 'errors', 'api.http502');
    case 503: return mainT(locale, 'errors', 'api.http503');
    case 504: return mainT(locale, 'errors', 'api.http504');
    default:
      return status >= 500
        ? mainT(locale, 'errors', 'api.httpServerDefault')
        : mainT(locale, 'errors', 'api.httpClientDefault');
  }
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Get current access token from AuthService
 * Automatically refreshes if expired
 */
export async function getAccessToken(): Promise<string | null> {
  return getAuthService().getAccessToken();
}

/**
 * Authenticated fetch wrapper
 *
 * Automatically adds Authorization header with Bearer token.
 * Throws error if not authenticated (unless skipAuth is true).
 *
 * @example
 * ```typescript
 * const response = await authenticatedFetch('/api/start_kronos_prediction', {
 *   method: 'POST',
 *   body: JSON.stringify(payload),
 * });
 * ```
 */
export async function authenticatedFetch(
  endpoint: string,
  options: ApiRequestOptions = {},
  _isRetry: boolean = false
): Promise<Response> {
  const { skipAuth = false, includeInstallToken = false, timeout = API_REQUEST_DEFAULT_TIMEOUT_MS, headers = {}, ...fetchOptions } = options;

  // Build full URL if endpoint is relative
  const url = endpoint.startsWith('http') ? endpoint : `${DESKTOP_API_URL}${endpoint}`;

  // Get access token unless skipping auth
  let authHeaders: Record<string, string> = {};
  if (!skipAuth) {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      ipcLog.error('[API] Not authenticated - no access token available');
      throw new Error(mainT(getMainLocale(), 'errors', 'api.notAuthenticated'));
    }
    authHeaders = { 'Authorization': `Bearer ${accessToken}` };

    if (includeInstallToken) {
      let installToken = getInstallToken();
      if (!installToken) {
        ipcLog.info('[API] No install token stored, attempting lazy registration (authenticated path)');
        await ensureInstallToken();
        installToken = getInstallToken();
      }
      if (installToken) {
        authHeaders['X-Install-Token'] = installToken;
      } else {
        ipcLog.warn('[API] includeInstallToken requested but no install token available');
      }
    }
  } else {
    // TICKET_673 + TICKET_675: Inject install token for anonymous free-tier requests
    // Lazy fallback: if no token stored (e.g., startup registration failed), attempt now
    let installToken = getInstallToken();
    if (!installToken) {
      ipcLog.info('[API] No install token stored, attempting lazy registration');
      await ensureInstallToken();
      installToken = getInstallToken();
    }
    if (installToken) {
      authHeaders = { 'X-Install-Token': installToken };
    }
  }

  // Merge headers
  // X-Client-Type required per ISSUE_7025 backend API spec
  const mergedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Type': 'desktop',
    ...authHeaders,
    ...headers,
  };

  ipcLog.debug(`[API] ${fetchOptions.method || 'GET'} ${url}`);

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers: mergedHeaders,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // TICKET_703: 401 retry for authenticated requests.
    // If token was expired/stale (transient refresh failure in getAccessToken),
    // attempt one refresh + retry. Same single-retry pattern as 403 below.
    if (response.status === 401 && !skipAuth && !_isRetry) {
      ipcLog.info('[API] Authenticated request got 401, attempting token refresh and retry');
      try {
        await getAuthService().refreshTokens();
        return authenticatedFetch(endpoint, options, true);
      } catch (refreshError) {
        ipcLog.warn(`[API] 401 retry refresh failed: ${refreshError}`);
        // Refresh failed -- return original 401 response
      }
    }

    // TICKET_673 Task 4 + TICKET_675: Self-healing on 403 for anonymous requests
    // Covers both INSTALL_TOKEN_INVALID and INSTALL_TOKEN_MISSING (or any token-related 403).
    // skipAuth=true requests are exclusively anonymous free-tier - a 403 can only be token-related.
    // Single retry (_isRetry guard) prevents infinite loops.
    if (response.status === 403 && skipAuth && !_isRetry) {
      ipcLog.info('[API] Anonymous request got 403, attempting token re-registration');
      const newToken = await reRegisterInstallToken();
      if (newToken) {
        return authenticatedFetch(endpoint, options, true);
      }
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(mainT(getMainLocale(), 'errors', 'api.requestTimeout'));
    }
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(mainT(getMainLocale(), 'errors', 'api.connectionFailed'));
    }
    throw error;
  }
}

/**
 * Authenticated JSON fetch - parses response as JSON
 *
 * @example
 * ```typescript
 * const data = await authenticatedJsonFetch<KronosResponse>('/api/start_kronos_prediction', {
 *   method: 'POST',
 *   body: JSON.stringify(payload),
 * });
 * ```
 */
export type JsonResponseParser<T> = (value: unknown) => T;

export async function authenticatedJsonFetch<T = unknown>(
  endpoint: string,
  options?: ApiRequestOptions,
): Promise<T>;
export async function authenticatedJsonFetch<T>(
  endpoint: string,
  options: ApiRequestOptions,
  parse: JsonResponseParser<T>,
): Promise<T>;
export async function authenticatedJsonFetch<T>(
  endpoint: string,
  options: ApiRequestOptions = {},
  parse?: JsonResponseParser<T>,
): Promise<T | unknown> {
  const response = await authenticatedFetch(endpoint, options);

  if (!response.ok) {
    const errorText = await response.text();
    ipcLog.error(`[API] Request failed: ${response.status} - ${errorText}`);
    throw new Error(getHttpErrorMessage(response.status, errorText));
  }

  const value: unknown = await response.json();
  return parse ? parse(value) : value;
}

/**
 * Get Desktop API base URL
 */
export function getDesktopApiUrl(): string {
  return DESKTOP_API_URL;
}
