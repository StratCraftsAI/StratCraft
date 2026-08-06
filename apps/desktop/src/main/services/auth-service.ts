/**
 * AuthService - OAuth 2.0 + PKCE Authentication Service
 *
 * Part of TICKET_066_1: Remote User Authentication
 * Handles OAuth flow, token management, and user session.
 *
 * Flow (Loopback method - Google recommended):
 * 1. User clicks "Login" -> initiateLogin() -> starts local HTTP server
 * 2. Opens browser with auth URL (redirect_uri = http://127.0.0.1:{port}/callback)
 * 3. User authenticates in browser -> redirects to localhost
 * 4. Local server receives callback -> exchanges code for tokens
 * 5. Tokens stored in SecureCredentialManager (C++ Core)
 * 6. User info fetched and cached
 *
 * Reference: https://developers.google.com/identity/protocols/oauth2/native-app
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { shell, BrowserWindow, app } from 'electron';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { appLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
// TICKET_134: V3 uses SecureCredentialService instead of gRPC CoreClient
import { getSecureCredentialService, HOST_PLUGIN_ID } from './secure-credential-service';
import { OAUTH_TOKEN_FILE, LOOPBACK_PORT_RANGE_START, LOOPBACK_PORT_RANGE_END } from '../../shared/constants/network';
import { OAUTH_LOOPBACK_SHUTDOWN_DELAY_MS, TOKEN_REFRESH_BUFFER_MS, MS_PER_SECOND } from '../../shared/constants/timing';
import { API_CONFIG, AUTH_CONFIG, normalizeUserLevel } from '../../shared/constants';
import { getInstallToken, ensureInstallToken } from './install-token-service';
import type {
  AuthUser,
  AuthTokens,
  AuthState,
  OAuthConfig,
  PendingAuthState,
  PKCEChallenge,
  ServiceCredentials,
  EntitledPlugin,
} from '../../shared/types/auth';

// =============================================================================
// Constants
// =============================================================================

const TOKEN_KEY = 'oauth_tokens';
const USER_KEY = 'oauth_user';

const authErrorResponseSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
}).loose();

const oauthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).transform(String),
  email: z.string().min(1),
  display_name: z.string().optional(),
  avatar: z.string().optional(),
  user_level: z.string().min(1),
  level_expires_at: z.string().nullable().optional(),
  entitled_plugins: z.unknown().optional(),
}).loose();

const refreshTokenResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    access_token: z.string().min(1),
    refresh_token: z.string().optional(),
    expires_in: z.number().positive(),
    token_type: z.string().optional(),
  }).loose(),
  z.object({
    success: z.literal(false),
    error: z.string().optional(),
  }).loose(),
]);

const userInfoResponseSchema = z.object({
  nona_user_id: z.union([z.string(), z.number()]).transform(String),
  email: z.string().min(1),
  display_name: z.string().optional(),
  user_level: z.string().optional(),
  level_expires_at: z.string().nullable().optional(),
  entitled_plugins: z.unknown().optional(),
}).loose();

/**
 * TICKET_547: User-friendly messages for standard OAuth 2.0 error codes.
 * When the server returns ?error=<code> without an error_description,
 * this map provides a human-readable message instead of the raw code.
 */
const OAUTH_ERROR_KEY_MAP: Record<string, string> = {
  'server_error': 'auth.oauth.serverError',
  'access_denied': 'auth.oauth.accessDenied',
  'invalid_request': 'auth.oauth.invalidRequest',
  'unauthorized_client': 'auth.oauth.unauthorizedClient',
  'unsupported_response_type': 'auth.oauth.unsupportedResponseType',
  'invalid_scope': 'auth.oauth.invalidScope',
  'temporarily_unavailable': 'auth.oauth.temporarilyUnavailable',
};

function oauthErrorMessage(code: string): string {
  const key = OAUTH_ERROR_KEY_MAP[code];
  if (!key) return code;
  return mainT(getCurrentMainLocale(), 'errors', key);
}

// TICKET_492: Auth server URL from centralized constant (supports build-time injection)
const AUTH_SERVER_URL = AUTH_CONFIG.BASE_URL;

/**
 * OAuth configuration for nona_server
 * Base URL will be loaded from config
 * redirectUri is set dynamically based on loopback port
 */
const DEFAULT_OAUTH_CONFIG: Omit<OAuthConfig, 'authorizationEndpoint' | 'tokenEndpoint' | 'revokeEndpoint' | 'redirectUri'> = {
  clientId: 'StratCraft-desktop',
  scopes: ['openid', 'profile', 'email'],
};

// Loopback server configuration
const LOOPBACK_HOST = '127.0.0.1';

// Token refresh buffer imported from @shared/constants/timing

/**
 * TICKET_752_A1: Parse owned_features[] from WP /level response (ISSUE_9226).
 *
 * Tolerates absence (older WP, mocked tests, offline cache) and malformed shapes.
 * Returns [] when input is not a non-empty string array. Filters out non-string
 * entries silently.
 */
export function parseOwnedFeatures(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is string => typeof f === 'string' && f.length > 0);
}

export function parseEntitledPlugins(raw: unknown): EntitledPlugin[] | undefined {
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
// AuthService Class
// =============================================================================

export class AuthService extends EventEmitter {
  private static instance: AuthService | null = null;

  private initialized = false;
  private authServerUrl: string = '';
  private pendingAuth: PendingAuthState | null = null;
  private cachedUser: AuthUser | null = null;
  private cachedTokens: AuthTokens | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private loopbackServer: Server | null = null;
  private loopbackPort: number = 0;
  // TICKET_249: Promise reuse to prevent concurrent refresh requests
  private refreshPromise: Promise<AuthTokens> | null = null;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Initialize the auth service
   * Must be called after app.whenReady()
   */
  async initialize(authServerUrl?: string): Promise<void> {
    if (this.initialized) {
      appLog.warn('[Auth] AuthService already initialized');
      return;
    }

    appLog.info('[Auth] Initializing AuthService...');

    // Hardcoded auth server URL (VS Code pattern)
    this.authServerUrl = AUTH_SERVER_URL;
    appLog.info(`[Auth] Using hardcoded auth server URL: ${this.authServerUrl}`);

    // Try to restore session from stored tokens
    await this.restoreSession();

    this.initialized = true;
    appLog.info('[Auth] AuthService initialized');
  }

  /**
   * Shutdown the auth service
   */
  shutdown(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.stopLoopbackServer();
    appLog.info('[Auth] AuthService shutdown');
  }

  // ===========================================================================
  // OAuth Flow
  // ===========================================================================

  /**
   * Generate PKCE challenge pair
   */
  private generatePKCE(): PKCEChallenge {
    // Generate random code verifier (43-128 chars)
    const codeVerifier = randomBytes(32)
      .toString('base64url')
      .slice(0, 64);

    // Create SHA256 hash and base64url encode
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  /**
   * Generate random state for CSRF protection
   */
  private generateState(): string {
    return randomBytes(16).toString('base64url');
  }

  /**
   * Get OAuth configuration
   */
  private getOAuthConfig(redirectUri?: string): OAuthConfig {
    // OAuth uses WordPress auth server with new API format
    // ClickHouse credentials use Python tunnel (DESKTOP_API_BASE_URL) - see TICKET_140
    return {
      ...DEFAULT_OAUTH_CONFIG,
      redirectUri: redirectUri || `http://${LOOPBACK_HOST}:${this.loopbackPort}/callback`,
      authorizationEndpoint: `${this.authServerUrl}/auth/oauth/authorize`,
      tokenEndpoint: `${this.authServerUrl}/auth/oauth/token`,
      revokeEndpoint: `${this.authServerUrl}/auth/oauth/revoke`,
    };
  }

  /**
   * Initiate OAuth login flow
   * Starts local HTTP server and opens browser with authorization URL
   * Returns the auth URL for reference
   */
  async initiateLogin(providerName: string = 'StratCraft'): Promise<string> {
    appLog.info(`[Auth] Initiating login for provider: ${providerName}`);

    // Start loopback server to receive callback
    await this.startLoopbackServer();

    const redirectUri = `http://${LOOPBACK_HOST}:${this.loopbackPort}/callback`;
    const config = this.getOAuthConfig(redirectUri);
    const pkce = this.generatePKCE();
    const state = this.generateState();

    // Store pending auth state
    this.pendingAuth = {
      state,
      codeVerifier: pkce.codeVerifier,
      providerName,
      createdAt: Date.now(),
    };

    // Build authorization URL
    // prompt=login forces re-authentication even if browser has session (TICKET_074_1)
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scopes.join(' '),
      state,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'login',
    });

    const authUrl = `${config.authorizationEndpoint}?${params.toString()}`;

    appLog.info(`[Auth] Loopback server listening on port ${this.loopbackPort}`);
    appLog.debug(`[Auth] Opening auth URL: ${authUrl}`);

    // Open in default browser
    await shell.openExternal(authUrl);

    return authUrl;
  }

  /**
   * Handle OAuth callback from StratCraft:// URL scheme
   * Called when app receives the callback URL
   */
  async handleCallback(callbackUrl: string): Promise<AuthUser> {
    appLog.info('[Auth] Handling OAuth callback');

    const url = new URL(callbackUrl);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    // Check for error response
    if (error) {
      const message = errorDescription || oauthErrorMessage(error);
      appLog.error(`[Auth] OAuth error: ${message}`);
      this.pendingAuth = null;
      this.emitError(message);
      throw new Error(message);
    }

    // Validate state
    if (!this.pendingAuth) {
      const message = mainT(getCurrentMainLocale(), 'errors', 'auth.noPendingState');
      appLog.error(`[Auth] ${message}`);
      throw new Error(message);
    }

    if (state !== this.pendingAuth.state) {
      const message = mainT(getCurrentMainLocale(), 'errors', 'auth.stateMismatch');
      appLog.error(`[Auth] ${message}`);
      this.pendingAuth = null;
      throw new Error(message);
    }

    if (!code) {
      const message = mainT(getCurrentMainLocale(), 'errors', 'auth.noAuthorizationCode');
      appLog.error(`[Auth] ${message}`);
      this.pendingAuth = null;
      throw new Error(message);
    }

    // Exchange code for tokens (includes user info)
    const { tokens, user } = await this.exchangeCodeForTokens(code, this.pendingAuth.codeVerifier);
    this.pendingAuth = null;

    // Store tokens and user info
    await this.storeTokens(tokens);
    await this.storeUser(user);

    // Update cached state
    this.cachedTokens = tokens;
    this.cachedUser = user;

    // Schedule token refresh
    this.scheduleTokenRefresh();

    // Emit state change
    this.emitStateChange();

    // Focus the main window
    this.focusMainWindow();

    appLog.info(`[Auth] Login successful for user: ${user.email}`);
    return user;
  }

  /**
   * Exchange authorization code for tokens
   * Per API contract, token response includes user info
   * ClickHouse credentials are fetched on-demand (TICKET_130 v2.0)
   */
  private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<{ tokens: AuthTokens; user: AuthUser }> {
    const config = this.getOAuthConfig();

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    });

    appLog.debug('[Auth] Exchanging code for tokens...');

    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorData = authErrorResponseSchema.catch({}).parse(
        await response.json().catch(() => ({})),
      );
      const message = errorData.error_description || errorData.error || mainT(getCurrentMainLocale(), 'errors', 'auth.tokenExchangeFailed');
      appLog.error(`[Auth] Token exchange failed: ${message}`);
      throw new Error(message);
    }

    const data = oauthTokenResponseSchema.parse(await response.json());

    // Extract tokens
    const tokens: AuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * MS_PER_SECOND),
      tokenType: data.token_type || 'Bearer',
    };

    const user: AuthUser = {
      id: data.user_id,
      email: data.email,
      name: data.display_name || data.email,
      avatar: data.avatar || undefined,
      plan: normalizeUserLevel(data.user_level),
      levelExpiresAt: data.level_expires_at || undefined,
      rawUserLevel: data.user_level,  // TICKET_185: Store raw value for re-normalization on restore
      entitledPlugins: parseEntitledPlugins(data.entitled_plugins),
    };

    appLog.info(`[Auth] User info from token: id=${user.id}, email=${user.email}, plan=${user.plan} (raw: ${data.user_level}), expires=${user.levelExpiresAt || 'never'}, entitledPlugins=${user.entitledPlugins?.length ?? 0}`);

    // TICKET_130 v2.0: ClickHouse credentials are fetched on-demand, not in login response
    appLog.debug('[Auth] Login successful, ClickHouse credentials will be fetched on-demand');

    return { tokens, user };
  }

  // TICKET_544: normalizeUserLevel() moved to @shared/constants/entitlement.ts (single source of truth)

  /**
   * Refresh access token using refresh token
   * TICKET_165: Uses /api/v1/auth/refresh endpoint (JSON format)
   * TICKET_141: Refresh via Python tunnel, not WordPress
   * TICKET_249: Promise reuse to prevent concurrent refresh requests
   */
  async refreshTokens(): Promise<AuthTokens> {
    // TICKET_249: If refresh already in progress, return same promise
    if (this.refreshPromise) {
      appLog.debug('[Auth] Refresh already in progress, waiting...');
      return this.refreshPromise;
    }

    this.refreshPromise = this._doRefreshTokens();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Internal refresh implementation
   * TICKET_249: Extracted from refreshTokens() for Promise reuse pattern
   */
  private async _doRefreshTokens(): Promise<AuthTokens> {
    if (!this.cachedTokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    // TICKET_165 + TICKET_141: Token refresh via Python tunnel
    // WordPress only handles OAuth login, all other APIs go through Python tunnel
    const refreshEndpoint = `${API_CONFIG.BASE_URL}/api/v1/auth/refresh`;

    appLog.debug('[Auth] Refreshing tokens...');

    // TICKET_703: Wrap fetch in try-catch to distinguish network errors (transient)
    // from HTTP errors. Network errors must NOT clear auth state.
    let response: Response;
    try {
      response = await fetch(refreshEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refresh_token: this.cachedTokens.refreshToken,
        }),
      });
    } catch (networkError) {
      // TICKET_703: Network-level failure (DNS, timeout, no connectivity).
      // This is TRANSIENT -- do NOT clear auth state. User is still authenticated.
      appLog.warn(`[Auth] Token refresh network error (session preserved): ${networkError}`);
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'auth.tokenRefreshNetworkError'));
    }

    if (!response.ok) {
      const errorData = authErrorResponseSchema.catch({}).parse(
        await response.json().catch(() => ({})),
      );
      const message = errorData.error_description || errorData.error || mainT(getCurrentMainLocale(), 'errors', 'auth.tokenRefreshFailed');

      // TICKET_703: Only clear auth for PERMANENT failures (4xx = token revoked/invalid).
      // Do NOT clear for transient server errors (5xx). A single backend hiccup must
      // not destroy the user's entire auth session.
      if (response.status >= 400 && response.status < 500) {
        appLog.error(`[Auth] Token refresh rejected (${response.status}), clearing auth: ${message}`);
        await this.clearAuth();
      } else {
        appLog.warn(`[Auth] Token refresh server error (${response.status}), session preserved: ${message}`);
      }
      throw new Error(message);
    }

    const data = refreshTokenResponseSchema.parse(await response.json());

    // TICKET_165: Backend returns { success, access_token, refresh_token, expires_in, token_type }
    if (!data.success) {
      const message = data.error || mainT(getCurrentMainLocale(), 'errors', 'auth.tokenRefreshReturnedFalse');
      appLog.error(`[Auth] Token refresh failed: ${message}`);
      // TICKET_703: success=false with HTTP 200 is a definitive backend rejection -- clear auth
      await this.clearAuth();
      throw new Error(message);
    }

    const tokens: AuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.cachedTokens.refreshToken,
      expiresAt: Date.now() + (data.expires_in * MS_PER_SECOND),
      tokenType: data.token_type || 'Bearer',
    };

    // Store new tokens
    await this.storeTokens(tokens);
    this.cachedTokens = tokens;

    // TICKET_493: Re-fetch userinfo to detect plan tier changes after upgrade
    await this.syncUserInfoOnRefresh(tokens.accessToken);

    // Reschedule refresh
    this.scheduleTokenRefresh();

    appLog.info('[Auth] Tokens refreshed successfully');
    return tokens;
  }

  /**
   * TICKET_493: Sync user info on token refresh to detect plan tier changes.
   * TICKET_892_4_3: Merge-only entitlements — refresh can ADD plugins but never REMOVE.
   * Revocation is handled by explicit logout/login (TICKET_892_4_2), not background refresh.
   * Non-fatal: userinfo fetch failure does NOT fail the token refresh.
   * Reuses existing stateChanged event chain (EntitlementSyncService, useAuth, PlanBadge).
   */
  private async syncUserInfoOnRefresh(accessToken: string): Promise<void> {
    try {
      const freshUser = await this.fetchUserInfo(accessToken);
      if (!this.cachedUser) return;

      const planChanged = freshUser.plan !== this.cachedUser.plan;

      const mergedPlugins = this.mergeEntitledPlugins(
        this.cachedUser.entitledPlugins,
        freshUser.entitledPlugins,
      );
      const entitlementsChanged =
        JSON.stringify(mergedPlugins ?? []) !== JSON.stringify(this.cachedUser.entitledPlugins ?? []);

      if (planChanged || entitlementsChanged) {
        if (planChanged) {
          appLog.info(`[Auth] Plan tier changed: ${this.cachedUser.plan} -> ${freshUser.plan}`);
        }
        if (entitlementsChanged) {
          appLog.info(`[Auth] Entitled plugins added via refresh: ${mergedPlugins?.length ?? 0} total`);
        }
        freshUser.entitledPlugins = mergedPlugins;
        this.cachedUser = freshUser;
        await this.storeUser(freshUser);
        this.emitStateChange();
      }

    } catch (error) {
      appLog.warn(`[Auth] Failed to sync user info on refresh: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * TICKET_892_4_3: Merge entitled plugins — union of existing and fresh.
   * Fresh plugins are added; existing plugins are never removed.
   * When fresh has a duplicate plugin_id, the fresh tier wins (upgrade path).
   */
  private mergeEntitledPlugins(
    existing: EntitledPlugin[] | undefined,
    fresh: EntitledPlugin[] | undefined,
  ): EntitledPlugin[] | undefined {
    if (!fresh || fresh.length === 0) return existing;
    if (!existing || existing.length === 0) return fresh;

    const merged = new Map<string, EntitledPlugin>();
    for (const p of existing) merged.set(p.plugin_id, p);
    for (const p of fresh) merged.set(p.plugin_id, p);
    return Array.from(merged.values());
  }

  /**
   * Fetch user info from /api/v1/auth/me endpoint (Python tunnel).
   * TICKET_544: Fixed from non-existent /auth/oauth/userinfo to working /api/v1/auth/me.
   */
  private async fetchUserInfo(accessToken: string): Promise<AuthUser> {
    const meEndpoint = `${API_CONFIG.BASE_URL}/api/v1/auth/me`;

    appLog.debug('[Auth] Fetching user info from /api/v1/auth/me...');

    // X-Install-Token identifies this device for server-side entitlement decisions.
    // X-Client-Type required per ISSUE_7025 backend API spec.
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'X-Client-Type': 'desktop',
    };
    let installToken = getInstallToken();
    if (!installToken) {
      await ensureInstallToken();
      installToken = getInstallToken();
    }
    if (installToken) {
      headers['X-Install-Token'] = installToken;
    } else {
      appLog.warn('[Auth] No install token available for /me request');
    }

    const response = await fetch(meEndpoint, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const message = `Failed to fetch user info: HTTP ${response.status}`;
      appLog.error(`[Auth] ${message}`);
      throw new Error(message);
    }

    const data = userInfoResponseSchema.parse(await response.json());

    // TICKET_544: /api/v1/auth/me returns { nona_user_id, email, display_name, user_level, ... }
    const rawLevel = data.user_level || 'FREE';

    return {
      id: data.nona_user_id,
      email: data.email,
      name: data.display_name || data.email,
      avatar: this.cachedUser?.avatar,
      plan: normalizeUserLevel(rawLevel),
      levelExpiresAt: data.level_expires_at || undefined,
      rawUserLevel: rawLevel,
      entitledPlugins: parseEntitledPlugins(data.entitled_plugins),
    };
  }


  /**
   * TICKET_564: Login with pre-built tokens and user from inline auth.
   * Reuses the same post-login sequence as handleCallback() (store, cache, schedule, emit).
   */
  async loginWithTokens(tokens: AuthTokens, user: AuthUser): Promise<AuthUser> {
    // Store tokens and user info
    await this.storeTokens(tokens);
    await this.storeUser(user);

    // Update cached state
    this.cachedTokens = tokens;
    this.cachedUser = user;

    // Schedule token refresh
    this.scheduleTokenRefresh();

    // Emit state change
    this.emitStateChange();

    // Focus the main window
    this.focusMainWindow();

    appLog.info(`[Auth] Inline login successful for user: ${user.email}`);
    return user;
  }

  /**
   * Logout - revoke tokens and clear state
   */
  async logout(): Promise<void> {
    appLog.info('[Auth] Logging out...');

    // Try to revoke tokens
    if (this.cachedTokens?.refreshToken) {
      try {
        await this.revokeToken(this.cachedTokens.refreshToken);
      } catch (error) {
        appLog.warn('[Auth] Token revocation failed (continuing with logout):', error);
      }
    }

    // Clear auth state
    await this.clearAuth();

    appLog.info('[Auth] Logout complete');
  }

  /**
   * Revoke a token
   */
  private async revokeToken(token: string): Promise<void> {
    const config = this.getOAuthConfig();

    const params = new URLSearchParams({
      token,
      client_id: config.clientId,
    });

    await fetch(config.revokeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
  }

  /**
   * Clear all auth state
   */
  private async clearAuth(): Promise<void> {
    // Cancel refresh timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Clear cached state
    this.cachedUser = null;
    this.cachedTokens = null;
    this.pendingAuth = null;

    // Clear stored credentials -- failure is a security concern: the next
    // startup would restore a session the user intended to end.
    try {
      const credentialService = getSecureCredentialService();
      await credentialService.deleteSecret(HOST_PLUGIN_ID, TOKEN_KEY);
      await credentialService.deleteSecret(HOST_PLUGIN_ID, USER_KEY);
    } catch (error) {
      appLog.error('[Auth] Failed to clear stored credentials:', error);
      throw new Error(
        `Logout incomplete: could not delete stored credentials (${error instanceof Error ? error.message : String(error)})`,
      );
    }

    // TICKET_464: Remove OAuth token discovery file
    this.removeOAuthTokenFile();

    // Emit state change
    this.emitStateChange();
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Restore session from stored tokens
   */
  private async restoreSession(): Promise<void> {
    try {
      const credentialService = getSecureCredentialService();

      // Load tokens
      const tokenResponse = await credentialService.getSecret(HOST_PLUGIN_ID, TOKEN_KEY);
      if (!tokenResponse.success || !tokenResponse.value) {
        appLog.debug('[Auth] No stored tokens found');
        return;
      }

      const tokens: AuthTokens = JSON.parse(tokenResponse.value);

      // Check if tokens are expired
      this.cachedTokens = tokens;
      if (tokens.expiresAt < Date.now()) {
        appLog.info('[Auth] Stored tokens expired, attempting refresh...');

        try {
          await this.refreshTokens();
        } catch (error) {
          // TICKET_703 parity: refreshTokens() only clears auth on 4xx (permanent
          // rejection). For transient failures (network, 5xx), cachedTokens is
          // preserved. If clearAuth() already ran inside refreshTokens(), bail out.
          // Otherwise keep the session alive — the next getAccessToken() or
          // scheduled refresh will retry.
          if (!this.cachedTokens) {
            appLog.warn('[Auth] Token refresh permanently rejected, session cleared');
            return;
          }
          appLog.warn('[Auth] Token refresh failed (transient), session preserved:', error);
        }
      }

      // Load user info
      const userResponse = await credentialService.getSecret(HOST_PLUGIN_ID, USER_KEY);
      if (userResponse.success && userResponse.value) {
        const storedUser = JSON.parse(userResponse.value) as AuthUser;
        // TICKET_185: Re-normalize plan from rawUserLevel to handle mapping changes
        if (storedUser.rawUserLevel) {
          const normalizedPlan = normalizeUserLevel(storedUser.rawUserLevel);
          if (storedUser.plan !== normalizedPlan) {
            appLog.info(`[Auth] Re-normalized plan: ${storedUser.plan} -> ${normalizedPlan} (raw: ${storedUser.rawUserLevel})`);
            storedUser.plan = normalizedPlan;
            // Update stored user with correct plan
            await this.storeUser(storedUser);
          }
          this.cachedUser = storedUser;
        } else {
          // TICKET_185: Old cached data without rawUserLevel - fetch fresh user info
          appLog.info('[Auth] Cached user missing rawUserLevel, fetching fresh user info');
          try {
            this.cachedUser = await this.fetchUserInfo(this.cachedTokens.accessToken);
            await this.storeUser(this.cachedUser);
          } catch (error) {
            appLog.warn('[Auth] Failed to refresh user info, using cached data:', error);
            this.cachedUser = storedUser;
          }
        }
      } else if (this.cachedTokens) {
        // Fetch user info if not stored (only if tokens survived refresh)
        try {
          this.cachedUser = await this.fetchUserInfo(this.cachedTokens.accessToken);
          await this.storeUser(this.cachedUser);
        } catch (error) {
          appLog.warn('[Auth] Failed to fetch user info, session preserved without user data:', error);
        }
      }

      // Schedule token refresh
      this.scheduleTokenRefresh();

      appLog.info(`[Auth] Session restored for user: ${this.cachedUser?.email}`);
    } catch (error) {
      appLog.warn('[Auth] Failed to restore session:', error);
    }
  }

  /**
   * Schedule token refresh before expiry
   */
  private scheduleTokenRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    if (!this.cachedTokens) return;

    const timeUntilRefresh = this.cachedTokens.expiresAt - Date.now() - TOKEN_REFRESH_BUFFER_MS;

    if (timeUntilRefresh <= 0) {
      // Token already expired or about to expire, refresh now
      this.refreshTokens().catch((error) => {
        appLog.error('[Auth] Scheduled token refresh failed:', error);
      });
    } else {
      appLog.debug(`[Auth] Scheduling token refresh in ${Math.round(timeUntilRefresh / 1000)}s`);
      this.refreshTimer = setTimeout(() => {
        this.refreshTokens().catch((error) => {
          appLog.error('[Auth] Scheduled token refresh failed:', error);
        });
      }, timeUntilRefresh);
    }
  }

  // ===========================================================================
  // Storage
  // ===========================================================================

  /**
   * Store tokens in SecureCredentialManager
   */
  private async storeTokens(tokens: AuthTokens): Promise<void> {
    const credentialService = getSecureCredentialService();
    await credentialService.setSecret(HOST_PLUGIN_ID, TOKEN_KEY, JSON.stringify(tokens));
    // TICKET_464: Write access token to discovery file for direct backend testing
    this.writeOAuthTokenFile(tokens.accessToken);
  }

  /**
   * Store user info in SecureCredentialManager
   */
  private async storeUser(user: AuthUser): Promise<void> {
    const credentialService = getSecureCredentialService();
    await credentialService.setSecret(HOST_PLUGIN_ID, USER_KEY, JSON.stringify(user));
  }

  /**
   * TICKET_464: Write OAuth access token to discovery file for direct backend testing.
   * Same pattern as http-server.ts writeDiscoveryFiles (0o600 permissions).
   */
  private writeOAuthTokenFile(accessToken: string): void {
    try {
      const dir = app.isPackaged ? app.getPath('userData') : path.join(app.getAppPath(), 'data');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, OAUTH_TOKEN_FILE), accessToken, { encoding: 'utf-8', mode: 0o600 });
      appLog.debug('[Auth] OAuth token discovery file written');
    } catch (error) {
      appLog.warn('[Auth] Failed to write OAuth token discovery file:', error);
    }
  }

  /**
   * TICKET_464: Remove OAuth access token discovery file on logout.
   */
  private removeOAuthTokenFile(): void {
    try {
      const dir = app.isPackaged ? app.getPath('userData') : path.join(app.getAppPath(), 'data');
      const filePath = path.join(dir, OAUTH_TOKEN_FILE);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        appLog.debug('[Auth] OAuth token discovery file removed');
      }
    } catch (error) {
      appLog.warn('[Auth] Failed to remove OAuth token discovery file:', error);
    }
  }

  // ===========================================================================
  // State Access
  // ===========================================================================

  /**
   * Get current auth state
   */
  getAuthState(): AuthState {
    return {
      isAuthenticated: !!this.cachedUser && !!this.cachedTokens,
      user: this.cachedUser,
      tokens: this.cachedTokens,
      isLoading: false,
      error: null,
    };
  }

  /**
   * Get current user
   */
  getUser(): AuthUser | null {
    return this.cachedUser;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!this.cachedUser && !!this.cachedTokens;
  }


  /**
   * Get access token (for API calls)
   * Automatically refreshes if expired
   */
  async getAccessToken(): Promise<string | null> {
    if (!this.cachedTokens) return null;

    // Check if token is expired
    if (this.cachedTokens.expiresAt < Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      try {
        await this.refreshTokens();
      } catch (error) {
        // TICKET_703: After Phase 1 fix, cachedTokens is only cleared on 4xx
        // (permanent rejection). For transient failures (5xx, network), cachedTokens
        // is preserved -- return the existing token so the caller can attempt the
        // API call. The backend will return 401 if truly expired.
        if (this.cachedTokens?.accessToken) {
          appLog.warn(`[Auth] Token refresh failed, returning existing token: ${error}`);
          return this.cachedTokens.accessToken;
        }
        return null;
      }
    }

    return this.cachedTokens.accessToken;
  }

  /**
   * Get auth server URL for a specific plugin
   * Returns hardcoded URL (VS Code pattern - security best practice)
   */
  async getPluginAuthServerUrl(_pluginId: string): Promise<string> {
    return AUTH_SERVER_URL;
  }

  /**
   * Set auth server URL for a plugin (no-op, URL is hardcoded)
   * @deprecated URL is now hardcoded, this method does nothing
   */
  async setPluginAuthServerUrl(_pluginId: string, _url: string): Promise<void> {
    appLog.debug('[Auth] setPluginAuthServerUrl called but URL is hardcoded - ignoring');
  }

  /**
   * Get current auth server URL (for AuthService's own OAuth flow)
   */
  getAuthServerUrl(): string {
    return this.authServerUrl;
  }

  // ===========================================================================
  // Event Emission
  // ===========================================================================

  /**
   * Emit auth state change event
   */
  private emitStateChange(): void {
    this.emit('stateChanged', {
      isAuthenticated: this.isAuthenticated(),
      user: this.cachedUser,
    });
  }

  /**
   * Emit auth error event
   */
  private emitError(error: string): void {
    this.emit('error', { error });
  }

  // ===========================================================================
  // Loopback Server
  // ===========================================================================

  /**
   * Start loopback HTTP server to receive OAuth callback
   * Uses ephemeral port range (49152-65535)
   */
  private async startLoopbackServer(): Promise<void> {
    if (this.loopbackServer) {
      appLog.debug('[Auth] Loopback server already running');
      return;
    }

    return new Promise((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        this.handleLoopbackRequest(req, res);
      });

      // Try to find an available port
      const tryPort = (port: number): void => {
        if (port > LOOPBACK_PORT_RANGE_END) {
          reject(new Error('No available port for loopback server'));
          return;
        }

        server.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            tryPort(port + 1);
          } else {
            reject(err);
          }
        });

        server.listen(port, LOOPBACK_HOST, () => {
          this.loopbackServer = server;
          this.loopbackPort = port;
          appLog.info(`[Auth] Loopback server started on http://${LOOPBACK_HOST}:${port}`);
          resolve();
        });
      };

      tryPort(LOOPBACK_PORT_RANGE_START);
    });
  }

  /**
   * Stop loopback HTTP server
   */
  private stopLoopbackServer(): void {
    if (this.loopbackServer) {
      this.loopbackServer.close();
      this.loopbackServer = null;
      this.loopbackPort = 0;
      appLog.debug('[Auth] Loopback server stopped');
    }
  }

  /**
   * Handle incoming request on loopback server
   */
  private handleLoopbackRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || '/', `http://${LOOPBACK_HOST}:${this.loopbackPort}`);

    if (url.pathname === '/callback') {
      // Build full callback URL for handleCallback
      const callbackUrl = `http://${LOOPBACK_HOST}:${this.loopbackPort}${req.url}`;

      // Process callback asynchronously
      this.handleCallback(callbackUrl)
        .then(() => {
          // Send success page
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.getSuccessHtml());

          // Stop server after a short delay (allow browser to receive response)
          setTimeout(() => this.stopLoopbackServer(), OAUTH_LOOPBACK_SHUTDOWN_DELAY_MS);
        })
        .catch((error) => {
          // Send error page
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.getErrorHtml(error.message));

          setTimeout(() => this.stopLoopbackServer(), OAUTH_LOOPBACK_SHUTDOWN_DELAY_MS);
        });
    } else {
      // 404 for other paths
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }

  /**
   * Generate success HTML page for browser
   */
  private getSuccessHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StratCraft - Login Successful</title>
  <style>
    :root {
      --primary: #008F60;
      --bg: #fcfcfc;
      --text: #1a202c;
      --container-bg: #ffffff;
      --card-border: #edf2f7;
      --grid-line: #f0f0f0;
      --ribbon-green: #16a34a;
      --ribbon-yellow: #eab308;
      --ribbon-red: #dc2626;
      --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
      --badge-bg: #ebf8ff;
      --badge-text: #2b6cb0;
      --bg-glow: radial-gradient(circle at center, rgba(0, 143, 96, 0.05) 0%, transparent 70%);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #030712;
        --text: #f1f5f9;
        --container-bg: rgba(17, 24, 39, 0.8);
        --card-border: rgba(255, 255, 255, 0.1);
        --grid-line: rgba(255, 255, 255, 0.03);
        --shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2);
        --badge-bg: rgba(30, 64, 175, 0.4);
        --badge-text: #93c5fd;
        --bg-glow: radial-gradient(circle at center, rgba(0, 229, 153, 0.1) 0%, transparent 80%);
      }
    }

    body {
      font-family: Inter, system-ui, -apple-system, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background-color: var(--bg);
      background-image: 
        var(--bg-glow),
        linear-gradient(var(--grid-line) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
      background-size: 100% 100%, 32px 32px, 32px 32px;
      color: var(--text);
      overflow: hidden;
    }
    .container {
      position: relative;
      text-align: center;
      padding: 60px 40px;
      background: var(--container-bg);
      border-radius: 2px;
      box-shadow: var(--shadow);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(12px);
      max-width: 480px;
      width: 90%;
      overflow: hidden;
      animation: fadeIn 0.8s ease-out;
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

    /* Military Ribbon Decoration */
    .ribbon-tray {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 6px;
      display: flex;
      background: var(--bg);
      border-bottom: 1px solid var(--card-border);
    }
    .ribbon-block { flex: 1; height: 100%; }
    .b-green { background: var(--ribbon-green); }
    .b-yellow { background: var(--ribbon-yellow); }
    .b-red { background: var(--ribbon-red); }
    .b-blue1 { background: #1e3a8a; }
    .b-blue2 { background: #1d4ed8; }
    .b-blue3 { background: #2563eb; }
    .b-blue4 { background: #3b82f6; }
    .b-blue5 { background: #60a5fa; }
    .b-blue6 { background: #93c5fd; }

    .success-icon {
      width: 56px;
      height: 56px;
      margin: 0 auto 28px;
      background: rgba(0, 143, 96, 0.1);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--primary);
      font-size: 26px;
      border: 1px solid rgba(0, 143, 96, 0.2);
      animation: bounceIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55);
      box-shadow: 0 0 20px rgba(0, 143, 96, 0.1);
    }
    h1 { 
      margin: 0 0 16px; 
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--text);
    }
    p {
      margin: 0;
      font-size: 15px;
      line-height: 1.6;
      opacity: 0.8;
    }
    .status-badge {
      display: inline-block;
      margin-top: 24px;
      padding: 6px 16px;
      background: var(--badge-bg);
      color: var(--badge-text);
      border-radius: 2px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      border: 1px solid var(--card-border);
    }
    @keyframes bounceIn {
      0% { transform: scale(0.3); opacity: 0; }
      50% { transform: scale(1.05); }
      70% { transform: scale(0.9); }
      100% { transform: scale(1); opacity: 1; }
    }
    .wave-bg {
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, transparent, var(--primary), transparent);
      opacity: 0.3;
      animation: shift 3s linear infinite;
    }
    @keyframes shift { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
    
    /* Decoration Rays for Dark Theme */
    @media (prefers-color-scheme: dark) {
      .container::before {
        content: "";
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, rgba(0, 229, 153, 0.05) 0%, transparent 50%);
        pointer-events: none;
        z-index: -1;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="ribbon-tray">
      <div class="ribbon-block b-green"></div>
      <div class="ribbon-block b-yellow"></div>
      <div class="ribbon-block b-red"></div>
      <div class="ribbon-block b-blue1"></div>
      <div class="ribbon-block b-blue2"></div>
      <div class="ribbon-block b-blue3"></div>
      <div class="ribbon-block b-blue4"></div>
      <div class="ribbon-block b-blue5"></div>
      <div class="ribbon-block b-blue6"></div>
    </div>
    
    <div class="success-icon">[OK]</div>
    
    <h1>Login Successful</h1>
    <p>Authentication complete. Your session has been securely established.</p>
    <p class="close-hint">You may close this tab and return to StratCraft.</p>
    
    <div class="status-badge">NEXUS-LINKED</div>
    <div class="wave-bg"></div>
  </div>
</body>
</html>`;
  }

  /**
   * Generate error HTML page for browser
   */
  private getErrorHtml(errorMessage: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StratCraft - Login Failed</title>
  <style>
    :root {
      --error: #e53e3e;
      --bg: #fcfcfc;
      --text: #1a202c;
      --container-bg: #ffffff;
      --card-border: #edf2f7;
      --ribbon-red: #dc2626;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #030712;
        --text: #f1f5f9;
        --container-bg: rgba(17, 24, 39, 0.8);
        --card-border: rgba(255, 255, 255, 0.1);
      }
    }
    body {
      font-family: Inter, system-ui, -apple-system, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background-color: var(--bg);
      background-image: 
        linear-gradient(rgba(0, 0, 0, 0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 0, 0, 0.05) 1px, transparent 1px);
      background-size: 32px 32px;
      color: var(--text);
    }
    .container {
      position: relative;
      text-align: center;
      padding: 60px 40px;
      background: var(--container-bg);
      border-radius: 2px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(12px);
      max-width: 480px;
      width: 90%;
    }
    .error-icon {
      width: 56px;
      height: 56px;
      margin: 0 auto 24px;
      background: rgba(229, 62, 62, 0.1);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--error);
      font-size: 26px;
      border: 1px solid rgba(229, 62, 62, 0.2);
    }
    h1 { 
      margin: 0 0 16px; 
      font-size: 26px;
      color: var(--text);
    }
    p { 
      margin: 0; 
      font-size: 15px;
      opacity: 0.8;
    }
    .error-details {
      margin-top: 24px;
      padding: 16px;
      background: rgba(229, 62, 62, 0.05);
      border-radius: 2px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 13px;
      color: var(--error);
      border: 1px solid rgba(229, 62, 62, 0.1);
      word-break: break-all;
    }
    .close-hint {
      margin-top: 20px;
      font-size: 14px;
      opacity: 0.7;
    }
    .ribbon-tray {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 6px;
      background: var(--error);
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="ribbon-tray"></div>
    <div class="error-icon">x</div>
    <h1>Login Failed</h1>
    <p>We encountered an issue during the authentication process.</p>
    <div class="error-details">${errorMessage}</div>
    <p class="close-hint">You may close this tab and return to StratCraft.</p>
  </div>
</body>
</html>`;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Focus the main window (after callback)
   */
  private focusMainWindow(): void {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const mainWindow = windows[0];
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  }
}

// =============================================================================
// Singleton Access Functions
// =============================================================================

let authServiceInstance: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!authServiceInstance) {
    authServiceInstance = AuthService.getInstance();
  }
  return authServiceInstance;
}

export async function initializeAuthService(authServerUrl?: string): Promise<void> {
  const service = getAuthService();
  await service.initialize(authServerUrl);
}
