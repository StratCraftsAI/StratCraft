/**
 * Authentication IPC Handlers
 *
 * Part of TICKET_066_1: Remote User Authentication
 * Provides IPC bridge between renderer and AuthService.
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import { getAuthService } from '../services/auth-service';
import { AUTH_CHANNELS } from '../../shared/constants/channels';
import { ipcLog } from '../utils/logger';
import { setCrashReporterUser, clearCrashReporterUser } from '../services/crash-reporter';
import type {
  AuthResponse,
  LoginInitResponse,
  LoginCompleteResponse,
  GetAuthStateResponse,
  AuthUser,
} from '../../shared/types/auth';

/**
 * Register authentication IPC handlers
 */
export function registerAuthHandlers(): void {
  const authService = getAuthService();

  // ---------------------------------------------------------------------------
  // Initiate Login
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    AUTH_CHANNELS.LOGIN,
    async (_event: IpcMainInvokeEvent, providerName?: string): Promise<AuthResponse<LoginInitResponse>> => {
      ipcLog.debug('[Auth] IPC: Login initiated');
      try {
        const authUrl = await authService.initiateLogin(providerName);
        return {
          success: true,
          data: { authUrl },
        };
      } catch (error) {
        ipcLog.error('[Auth] IPC: Login failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'MSG_AUTH_LOGIN_FAILED',
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    AUTH_CHANNELS.LOGOUT,
    async (_event: IpcMainInvokeEvent): Promise<AuthResponse> => {
      ipcLog.debug('[Auth] IPC: Logout requested');
      try {
        await authService.logout();
        return { success: true };
      } catch (error) {
        ipcLog.error('[Auth] IPC: Logout failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'MSG_AUTH_LOGOUT_FAILED',
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Handle Callback (called internally by URL scheme handler)
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    AUTH_CHANNELS.CALLBACK,
    async (_event: IpcMainInvokeEvent, callbackUrl: string): Promise<AuthResponse<LoginCompleteResponse>> => {
      ipcLog.debug('[Auth] IPC: Handling callback');
      try {
        const user = await authService.handleCallback(callbackUrl);
        const state = authService.getAuthState();
        return {
          success: true,
          data: {
            user,
            tokens: state.tokens!,
          },
        };
      } catch (error) {
        ipcLog.error('[Auth] IPC: Callback handling failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'MSG_AUTH_CALLBACK_FAILED',
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Refresh Tokens
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    AUTH_CHANNELS.REFRESH,
    async (_event: IpcMainInvokeEvent): Promise<AuthResponse> => {
      ipcLog.debug('[Auth] IPC: Token refresh requested');
      try {
        await authService.refreshTokens();
        return { success: true };
      } catch (error) {
        ipcLog.error('[Auth] IPC: Token refresh failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'MSG_AUTH_REFRESH_FAILED',
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Get Auth State
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    AUTH_CHANNELS.GET_STATE,
    async (_event: IpcMainInvokeEvent): Promise<AuthResponse<GetAuthStateResponse>> => {
      ipcLog.debug('[Auth] IPC: Getting auth state');
      try {
        const state = authService.getAuthState();
        return {
          success: true,
          data: {
            isAuthenticated: state.isAuthenticated,
            user: state.user,
            expiresAt: state.tokens?.expiresAt ?? null,
          },
        };
      } catch (error) {
        ipcLog.error('[Auth] IPC: Get state failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'MSG_AUTH_STATE_FAILED',
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Get User
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    AUTH_CHANNELS.GET_USER,
    async (_event: IpcMainInvokeEvent): Promise<AuthResponse<AuthUser | null>> => {
      ipcLog.debug('[Auth] IPC: Getting user');
      try {
        const user = authService.getUser();
        return {
          success: true,
          data: user,
        };
      } catch (error) {
        ipcLog.error('[Auth] IPC: Get user failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'MSG_AUTH_USER_FAILED',
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Get Access Token (TICKET_165: Silent Token Refresh)
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    AUTH_CHANNELS.GET_ACCESS_TOKEN,
    async (_event: IpcMainInvokeEvent): Promise<AuthResponse<string | null>> => {
      ipcLog.debug('[Auth] IPC: Getting access token');
      try {
        const accessToken = await authService.getAccessToken();
        return {
          success: true,
          data: accessToken,
        };
      } catch (error) {
        ipcLog.error('[Auth] IPC: Get access token failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'MSG_AUTH_TOKEN_FAILED',
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Event Forwarding
  // ---------------------------------------------------------------------------

  // Forward auth state changes to renderer + update Sentry user context (TICKET_881)
  authService.on('stateChanged', (data) => {
    if (data.isAuthenticated && data.user) {
      setCrashReporterUser(data.user.id, data.user.email);
    } else {
      clearCrashReporterUser();
    }

    const windows = BrowserWindow.getAllWindows();
    windows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(AUTH_CHANNELS.STATE_CHANGED, data);
      }
    });
  });

  // Forward auth errors to renderer
  authService.on('error', (data) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(AUTH_CHANNELS.ERROR, data);
      }
    });
  });

  ipcLog.info('[Auth] IPC handlers registered');
}
