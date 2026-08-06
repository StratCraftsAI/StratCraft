/**
 * Unified Type Definitions
 *
 * Part of TICKET_036_1: Module Authentication System Implementation
 * Consolidates all electronAPI type definitions to prevent conflicts.
 */

import type { IAuthorizationTransport } from './authorization';
import type { AuthStateInfo, AuthContext, AuthResult, Credentials } from './auth';
import type { User, AuthState } from './authentication';

// =============================================================================
// Electron API Type Definitions
// =============================================================================

/**
 * Module Authentication API
 */
export interface ElectronModuleAuthAPI {
  isAuthenticated(pluginId: string): Promise<AuthStateInfo>;
  getUserContext(pluginId: string): Promise<{
    success: boolean;
    context?: AuthContext;
    offlineMode?: boolean;
    errorCode?: string;
    errorMessage?: string;
  }>;
  hasPermission(pluginId: string, permission: string): Promise<{
    allowed: boolean;
    deniedReason?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
  requestAuth(pluginId: string, providerUrl: string, reason: string): Promise<AuthResult>;
  authenticate(pluginId: string, providerUrl: string, credentials: Credentials): Promise<{
    success: boolean;
    context?: AuthContext;
    errorCode?: string;
    errorMessage?: string;
  }>;
  refreshToken(pluginId: string): Promise<{
    success: boolean;
    context?: AuthContext;
    errorCode?: string;
    errorMessage?: string;
  }>;
  logout(pluginId: string): Promise<{
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  }>;
  subscribeAuthEvents(
    pluginId: string,
    callback: (authenticated: boolean) => void
  ): () => void;
}

/**
 * Credential API
 */
export interface ElectronCredentialAPI {
  set(pluginId: string, key: string, value: string, metadata?: Record<string, string>): Promise<{
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  }>;
  get(pluginId: string, key: string): Promise<{
    success: boolean;
    value?: string;
    metadata?: Record<string, string>;
    errorCode?: string;
    errorMessage?: string;
  }>;
  has(pluginId: string, key: string): Promise<{
    success: boolean;
    exists: boolean;
    errorCode?: string;
    errorMessage?: string;
  }>;
  delete(pluginId: string, key: string): Promise<{
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  }>;
  list(pluginId: string): Promise<{
    success: boolean;
    keys?: string[];
    errorCode?: string;
    errorMessage?: string;
  }>;
  clear(pluginId: string): Promise<{
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  }>;
}

/**
 * System Authentication API
 */
export interface ElectronAuthenticationAPI {
  getCurrentUser(): Promise<{
    success: boolean;
    authenticated?: boolean;
    user?: User;
    errorCode?: number;
    errorMessage?: string;
  }>;
  getAuthState(): Promise<{
    success: boolean;
    state?: AuthState;
    expiresAt?: number;
    errorCode?: number;
    errorMessage?: string;
  }>;
  login(email: string, password: string, rememberMe: boolean): Promise<{
    success: boolean;
    user?: User;
    errorCode?: number;
    errorMessage?: string;
  }>;
  logout(): Promise<{
    success: boolean;
    errorMessage?: string;
  }>;
  register(email: string, password: string, displayName: string): Promise<{
    success: boolean;
    user?: User;
    errorCode?: number;
    errorMessage?: string;
  }>;
  refreshToken(): Promise<{
    success: boolean;
    user?: User;
    errorCode?: number;
    errorMessage?: string;
  }>;
  subscribeAuthEvents(callback: (event: string, user?: User) => void): () => void;
}

/**
 * Complete Electron API interface
 */
export interface ElectronAPI {
  // System-level authorization (TICKET_033)
  authorization: IAuthorizationTransport;

  // System-level authentication (TICKET_035)
  authentication: ElectronAuthenticationAPI;

  // Module-level authentication (TICKET_036_1)
  moduleAuth: ElectronModuleAuthAPI;

  // Credential management (TICKET_036_1)
  credential: ElectronCredentialAPI;
}

// =============================================================================
// Global Type Augmentation
// =============================================================================

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
