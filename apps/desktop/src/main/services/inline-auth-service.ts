/**
 * Inline Auth Service - In-App Email + Verification Code Authentication
 *
 * TICKET_564: Desktop In-App Registration
 * Replaces external browser OAuth with email + 6-digit verification code flow.
 * Uses existing authenticatedFetch with skipAuth: true (public endpoints).
 */

import { authenticatedJsonFetch } from '../utils/api-request';
import { appLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import { normalizeUserLevel } from '../../shared/constants/entitlement';
import { AUTH_CONFIG } from '../../shared/constants';
import { MS_PER_SECOND } from '../../shared/constants/timing';
import type { AuthTokens, AuthUser, EntitledPlugin } from '../../shared/types/auth';

// =============================================================================
// Response Types
// =============================================================================

interface SendCodeResponse {
  success: boolean;
  message?: string;
  error?: string;
  retry_after?: number;
}

interface VerifyCodeSuccessResponse {
  success: true;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user_id: string;
  email: string;
  display_name: string;
  avatar?: string;
  user_level: string;
  level_expires_at?: string;
  owned_features?: string[]; // TICKET_752_A1 / ISSUE_9226
  entitled_plugins?: Array<{ plugin_id: string; tier: string }>;
}

interface VerifyCodeErrorResponse {
  success: false;
  error: string;
  attempts_remaining?: number;
}

type VerifyCodeResponse = VerifyCodeSuccessResponse | VerifyCodeErrorResponse;

// =============================================================================
// Result Types (returned to IPC handlers)
// =============================================================================

export interface SendCodeResult {
  success: boolean;
  message?: string;
  error?: string;
  retryAfter?: number;
}

export interface VerifyCodeResult {
  success: boolean;
  tokens?: AuthTokens;
  user?: AuthUser;
  error?: string;
  attemptsRemaining?: number;
}

export interface LoginPasswordResult {
  success: boolean;
  tokens?: AuthTokens;
  user?: AuthUser;
  error?: string;
}

function parseEntitledPlugins(raw: unknown): EntitledPlugin[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const parsed = raw
    .filter((e): e is { plugin_id: string; tier: string } =>
      typeof e === 'object' && e !== null &&
      typeof e.plugin_id === 'string' && e.plugin_id.length > 0 &&
      typeof e.tier === 'string' && e.tier.length > 0)
    .map(({ plugin_id, tier }) => ({ plugin_id, tier }));
  return parsed.length > 0 ? parsed : undefined;
}

// =============================================================================
// InlineAuthService
// =============================================================================

/**
 * Send verification code to email address.
 * Public endpoint (skipAuth: true).
 */
export async function sendCode(email: string): Promise<SendCodeResult> {
  appLog.info(`[InlineAuth] Sending verification code to: ${email}`);

  try {
    const data = await authenticatedJsonFetch<SendCodeResponse>(
      `${AUTH_CONFIG.BASE_URL}/api/auth/send-code`,
      {
        method: 'POST',
        body: JSON.stringify({ email }),
        skipAuth: true,
      }
    );

    if (!data.success) {
      appLog.warn(`[InlineAuth] Send code failed: ${data.error}`);
      return {
        success: false,
        error: data.error || mainT(getCurrentMainLocale(), 'errors', 'auth.failedToSendVerificationCode'),
        retryAfter: data.retry_after,
      };
    }

    appLog.info('[InlineAuth] Verification code sent successfully');
    return {
      success: true,
      message: data.message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appLog.error(`[InlineAuth] Send code error: ${message}`);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Verify email + code and return tokens + user.
 * Public endpoint (skipAuth: true).
 * On success, returns AuthTokens + AuthUser (same shape as exchangeCodeForTokens).
 */
export async function verifyCode(email: string, code: string): Promise<VerifyCodeResult> {
  appLog.info(`[InlineAuth] Verifying code for: ${email}`);

  try {
    const data = await authenticatedJsonFetch<VerifyCodeResponse>(
      `${AUTH_CONFIG.BASE_URL}/api/auth/verify-code`,
      {
        method: 'POST',
        body: JSON.stringify({ email, code }),
        skipAuth: true,
      }
    );

    if (!data.success) {
      const errorData = data as VerifyCodeErrorResponse;
      appLog.warn(`[InlineAuth] Verify code failed: ${errorData.error}`);
      return {
        success: false,
        error: errorData.error || mainT(getCurrentMainLocale(), 'errors', 'auth.invalidVerificationCode'),
        attemptsRemaining: errorData.attempts_remaining,
      };
    }

    const successData = data as VerifyCodeSuccessResponse;

    // Map response to AuthTokens (same mapping as exchangeCodeForTokens in auth-service.ts)
    const tokens: AuthTokens = {
      accessToken: successData.access_token,
      refreshToken: successData.refresh_token,
      expiresAt: Date.now() + (successData.expires_in * MS_PER_SECOND),
      tokenType: successData.token_type || 'Bearer',
    };

    const entitledPlugins = parseEntitledPlugins(successData.entitled_plugins);

    const user: AuthUser = {
      id: successData.user_id,
      email: successData.email,
      name: successData.display_name || successData.email,
      avatar: successData.avatar || undefined,
      plan: normalizeUserLevel(successData.user_level),
      levelExpiresAt: successData.level_expires_at || undefined,
      rawUserLevel: successData.user_level,
      entitledPlugins,
    };

    appLog.info(`[InlineAuth] Verification successful for user: ${user.email}, plan: ${user.plan}, entitledPlugins: ${entitledPlugins?.length ?? 0}`);
    return {
      success: true,
      tokens,
      user,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appLog.error(`[InlineAuth] Verify code error: ${message}`);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Login with email + password and return tokens + user.
 * Public endpoint (skipAuth: true).
 * On success, returns AuthTokens + AuthUser (same shape as verifyCode).
 */
export async function loginWithPassword(email: string, password: string): Promise<LoginPasswordResult> {
  appLog.info(`[InlineAuth] Password login for: ${email}`);

  try {
    const data = await authenticatedJsonFetch<VerifyCodeResponse>(
      `${AUTH_CONFIG.BASE_URL}/api/auth/login-password`,
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
        skipAuth: true,
      }
    );

    if (!data.success) {
      const errorData = data as VerifyCodeErrorResponse;
      appLog.warn(`[InlineAuth] Password login failed: ${errorData.error}`);
      return {
        success: false,
        error: errorData.error || mainT(getCurrentMainLocale(), 'errors', 'auth.invalidCredentials'),
      };
    }

    const successData = data as VerifyCodeSuccessResponse;

    const tokens: AuthTokens = {
      accessToken: successData.access_token,
      refreshToken: successData.refresh_token,
      expiresAt: Date.now() + (successData.expires_in * MS_PER_SECOND),
      tokenType: successData.token_type || 'Bearer',
    };

    const entitledPlugins = parseEntitledPlugins(successData.entitled_plugins);

    const user: AuthUser = {
      id: successData.user_id,
      email: successData.email,
      name: successData.display_name || successData.email,
      avatar: successData.avatar || undefined,
      plan: normalizeUserLevel(successData.user_level),
      levelExpiresAt: successData.level_expires_at || undefined,
      rawUserLevel: successData.user_level,
      entitledPlugins,
    };

    appLog.info(`[InlineAuth] Password login successful for user: ${user.email}, plan: ${user.plan}, entitledPlugins: ${entitledPlugins?.length ?? 0}`);
    return {
      success: true,
      tokens,
      user,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appLog.error(`[InlineAuth] Password login error: ${message}`);
    return {
      success: false,
      error: message,
    };
  }
}
