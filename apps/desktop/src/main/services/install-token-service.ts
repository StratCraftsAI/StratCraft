/**
 * Install Token Service (TICKET_673)
 *
 * Manages anonymous installation tokens for quota tracking on free endpoints.
 * Tokens identify installations (not users) and persist across app restarts
 * and login/logout cycles.
 *
 * Pattern follows consent-service.ts (lightweight electron-store instance).
 */

import Store from 'electron-store';
import { DESKTOP_API_BASE_URL } from '@StratCraft/types';
import { z } from 'zod';
import { appLog } from '../utils/logger';

// ============================================================================
// Constants
// ============================================================================

const DESKTOP_API_URL = process.env.DESKTOP_API_URL || DESKTOP_API_BASE_URL;
const REGISTER_TIMEOUT_MS = 5000;
const installTokenResponseSchema = z.object({
  install_token: z.string().min(1),
}).loose();

// ============================================================================
// Types
// ============================================================================

interface InstallTokenSchema {
  installToken: string;
}

// ============================================================================
// Store Instance
// ============================================================================

const store = new Store<InstallTokenSchema>({
  name: 'install-token',
  schema: {
    installToken: {
      type: 'string',
      default: '',
    },
  },
});

// No dev-mode reset: token should persist across dev restarts (unlike consent)

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the stored install token.
 * Returns null if no token has been registered yet.
 */
export function getInstallToken(): string | null {
  const token = store.get('installToken');
  return token || null;
}

/**
 * Persist an install token.
 */
export function setInstallToken(token: string): void {
  store.set('installToken', token);
  appLog.info('[INSTALL_TOKEN] Token stored successfully');
}

/**
 * Clear the stored install token.
 */
export function clearInstallToken(): void {
  store.delete('installToken');
  appLog.info('[INSTALL_TOKEN] Token cleared');
}

/**
 * Re-register install token after invalidation (TICKET_673 Task 4).
 *
 * Clears the current token, calls backend to obtain a new one,
 * and persists it. Returns the new token on success, null on failure.
 */
export async function reRegisterInstallToken(): Promise<string | null> {
  clearInstallToken();
  appLog.info('[INSTALL_TOKEN] Re-registering (token invalidated)');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REGISTER_TIMEOUT_MS);

  try {
    const response = await fetch(`${DESKTOP_API_URL}/api/anonymous/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'desktop',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      appLog.warn(`[INSTALL_TOKEN] Re-registration failed: HTTP ${response.status}`);
      return null;
    }

    const parsed = installTokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      appLog.warn('[INSTALL_TOKEN] Re-registration response missing install_token field');
      return null;
    }
    const token = parsed.data.install_token;

    setInstallToken(token);
    appLog.info('[INSTALL_TOKEN] Re-registered successfully');
    return token;
  } catch (error) {
    clearTimeout(timeoutId);
    const message = error instanceof Error ? error.message : String(error);
    appLog.warn(`[INSTALL_TOKEN] Re-registration failed: ${message}`);
    return null;
  }
}

/**
 * Ensure an install token exists.
 *
 * If a token is already stored, returns immediately.
 * If absent, registers with the backend to obtain a new token.
 * Non-blocking: failures are logged but do not throw.
 */
export async function ensureInstallToken(): Promise<void> {
  const existing = getInstallToken();
  if (existing) {
    appLog.info('[INSTALL_TOKEN] Token already present');
    return;
  }

  appLog.info('[INSTALL_TOKEN] No token found, registering with backend...');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REGISTER_TIMEOUT_MS);

  try {
    const response = await fetch(`${DESKTOP_API_URL}/api/anonymous/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'desktop',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      appLog.warn(`[INSTALL_TOKEN] Registration failed: HTTP ${response.status}`);
      return;
    }

    const parsed = installTokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      appLog.warn('[INSTALL_TOKEN] Registration response missing install_token field');
      return;
    }
    const token = parsed.data.install_token;

    setInstallToken(token);
    appLog.info('[INSTALL_TOKEN] Registered successfully');
  } catch (error) {
    clearTimeout(timeoutId);
    const message = error instanceof Error ? error.message : String(error);
    appLog.warn(`[INSTALL_TOKEN] Registration failed: ${message}`);
  }
}
