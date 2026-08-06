/**
 * UI Service SDK
 *
 * Part of TICKET_035: Progressive Authentication Implementation
 * Provides methods for plugins to trigger core UI components.
 */

import type { User } from './authentication';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for authentication view
 */
export interface AuthViewOptions {
  /**
   * Custom prompt message shown in the auth dialog
   * Example: "Login to unlock Binance advanced features"
   */
  prompt?: string;

  /**
   * Request ID for tracking which operation triggered auth
   * Returned in AuthResult for plugin to correlate
   */
  requestId?: string;
}

/**
 * Authentication result from UI flow
 */
export interface AuthResult {
  success: boolean;
  user?: User;
  cancelled?: boolean;
  error?: string;
  /**
   * Echo of requestId from AuthViewOptions
   * Allows plugin to identify which operation triggered this auth flow
   */
  requestId?: string;
}

/**
 * UI service interface for plugins
 */
export interface IUIService {
  /**
   * Show the authentication view (login/register)
   * This opens the central auth UI controlled by the main application.
   * @param options Optional configuration for the auth view
   * @returns Result of the auth flow
   */
  showAuthView(options?: AuthViewOptions): Promise<AuthResult>;

  /**
   * Show plugin configuration view
   * Opens the settings page for the specified plugin.
   * @param pluginId Plugin identifier
   */
  showPluginSettings(pluginId: string): Promise<void>;
}

/**
 * Backend transport interface for UI operations
 */
export interface IUITransport {
  showAuthView(options?: AuthViewOptions): Promise<AuthResult>;
  showPluginSettings(pluginId: string): Promise<{
    success: boolean;
    errorMessage?: string;
  }>;
}

// =============================================================================
// UIService
// =============================================================================

/**
 * UI Service client for triggering core UI components
 *
 * Usage:
 * ```typescript
 * const uiService = createUIService();
 *
 * // Show login dialog when plugin needs authentication
 * const handleProtectedAction = async () => {
 *   const authClient = createAuthenticationClient();
 *   await authClient.initialize();
 *
 *   if (!authClient.isAuthenticated()) {
 *     const result = await uiService.showAuthView({
 *       prompt: 'Login to access trading features',
 *       requestId: 'trade-action-123'
 *     });
 *
 *     if (!result.success) {
 *       console.log('User cancelled login');
 *       return;
 *     }
 *   }
 *
 *   // Proceed with protected action
 * };
 * ```
 */
export class UIService implements IUIService {
  private transport: IUITransport;

  constructor(transport: IUITransport) {
    this.transport = transport;
  }

  /**
   * Show the authentication view (login/register dialog)
   *
   * This method opens the central authentication UI managed by the main
   * application. Plugins should use this instead of implementing their
   * own login forms to ensure consistent UX and security.
   *
   * @param options Optional configuration
   * @returns Result of the authentication flow
   */
  async showAuthView(options?: AuthViewOptions): Promise<AuthResult> {
    return this.transport.showAuthView(options);
  }

  /**
   * Show plugin configuration/settings view
   *
   * Opens the settings page for the specified plugin where users can
   * configure API keys, preferences, etc.
   *
   * @param pluginId Plugin identifier
   */
  async showPluginSettings(pluginId: string): Promise<void> {
    const result = await this.transport.showPluginSettings(pluginId);
    if (!result.success) {
      throw new Error(`Failed to show plugin settings: ${result.errorMessage}`);
    }
  }
}

// =============================================================================
// Electron Transport Implementation
// =============================================================================

/**
 * Transport implementation for Electron renderer process
 */
export class ElectronUITransport implements IUITransport {
  private getElectronAPI(): ElectronUIAPI {
    if (typeof window === 'undefined' || !window.electronAPI?.ui) {
      throw new Error(
        'Electron API not available. This transport only works in Electron renderer process.'
      );
    }
    return window.electronAPI.ui;
  }

  async showAuthView(options?: AuthViewOptions): Promise<AuthResult> {
    return this.getElectronAPI().showAuthView(options);
  }

  async showPluginSettings(pluginId: string) {
    return this.getElectronAPI().showPluginSettings(pluginId);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a UIService for Electron renderer process
 */
export function createUIService(): UIService {
  const transport = new ElectronUITransport();
  return new UIService(transport);
}

// =============================================================================
// Type Definitions for Window
// =============================================================================

/**
 * Electron API shape for UI operations
 */
interface ElectronUIAPI {
  showAuthView(options?: AuthViewOptions): Promise<AuthResult>;
  showPluginSettings(pluginId: string): Promise<{
    success: boolean;
    errorMessage?: string;
  }>;
  /**
   * Internal: Send auth result back to main process (used by AuthView component)
   */
  sendAuthResult?(result: AuthResult): void;
}

declare global {
  interface Window {
    electronAPI: {
      ui: ElectronUIAPI;
    };
  }
}
