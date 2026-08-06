/**
 * Authentication Types
 *
 * Part of TICKET_066_1: Remote User Authentication
 * Defines types for OAuth 2.0 + PKCE authentication flow.
 */

// =============================================================================
// User Types
// =============================================================================

/**
 * User subscription plan levels (Display)
 * TICKET_185: Added GOLD tier for premium users
 * Note: ENT deprecated. PRO and GOLD have same entitlement (pro), GOLD is display-only distinction.
 */
export type AuthPlan = 'FREE' | 'BASIC' | 'PRO' | 'GOLD';

/**
 * Per-plugin entitlement from WP (TICKET_892_4).
 * WP merges subscription + buyout server-side; Desktop reads the result.
 */
export interface EntitledPlugin {
  plugin_id: string;
  tier: string;
}

/**
 * Authenticated user information
 * TICKET_185: Added levelExpiresAt for subscription expiry tracking
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  plan: AuthPlan;
  levelExpiresAt?: string;  // ISO8601 format, undefined means never expires
  rawUserLevel?: string;    // TICKET_185: Original user_level from backend for re-normalization on restore
  entitledPlugins?: EntitledPlugin[];
}

// =============================================================================
// Token Types
// =============================================================================

/**
 * OAuth tokens received from auth server
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  tokenType: string;
}

/**
 * ClickHouse service credentials (TICKET_130)
 */
export interface ClickHouseServiceCredentials {
  url: string;
  username: string;
  password: string;
  expires_at: string; // ISO 8601 format
}

/**
 * Service credentials from auth server (TICKET_130)
 */
export interface ServiceCredentials {
  clickhouse?: ClickHouseServiceCredentials;
}

/**
 * Combined auth state (tokens + user info)
 */
export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  error: string | null;
}

// =============================================================================
// OAuth Flow Types
// =============================================================================

/**
 * OAuth configuration for a provider
 */
export interface OAuthConfig {
  /** OAuth authorization endpoint */
  authorizationEndpoint: string;
  /** OAuth token endpoint */
  tokenEndpoint: string;
  /** OAuth revoke endpoint */
  revokeEndpoint: string;
  /** Client ID for this application */
  clientId: string;
  /** Redirect URI for callback */
  redirectUri: string;
  /** OAuth scopes to request */
  scopes: string[];
}

/**
 * PKCE challenge pair
 */
export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * Pending OAuth state (stored during auth flow)
 */
export interface PendingAuthState {
  state: string;
  codeVerifier: string;
  providerName: string;
  createdAt: number;
}

// =============================================================================
// IPC Response Types
// =============================================================================

/**
 * Generic auth response
 */
export interface AuthResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Login initiation response
 */
export interface LoginInitResponse {
  authUrl: string;
}

/**
 * Login completion response
 */
export interface LoginCompleteResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

/**
 * Token refresh response
 */
export interface TokenRefreshResponse {
  tokens: AuthTokens;
}

/**
 * Get current auth state response
 */
export interface GetAuthStateResponse {
  isAuthenticated: boolean;
  user: AuthUser | null;
  expiresAt: number | null;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Auth state change event data
 */
export interface AuthStateChangeEvent {
  isAuthenticated: boolean;
  user: AuthUser | null;
}

/**
 * Auth error event data
 */
export interface AuthErrorEvent {
  error: string;
  code?: string;
}
