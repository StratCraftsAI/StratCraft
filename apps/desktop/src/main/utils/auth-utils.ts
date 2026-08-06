/**
 * Centralized user ID retrieval for Main Process.
 * Single source of truth - all IPC handlers import from here.
 * Fail-fast: throws if not authenticated (no silent fallbacks).
 */

import { getAuthService } from '../services/auth-service';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from '../services/locale-service';

export function getMainProcessUserId(): string {
  const user = getAuthService().getUser();
  if (!user?.id) {
    throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.authUtils.userNotAuthenticated'));
  }
  return user.id;
}

export function getMainProcessUserIdAsString(): string {
  const user = getAuthService().getUser();
  if (!user?.id) {
    throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.authUtils.userNotAuthenticated'));
  }
  return user.id;
}

/**
 * TICKET_670: Local algorithm persistence is machine-scoped.
 * Keep authenticated helpers fail-fast and use this only for local algorithm ownership metadata.
 */
export function getAlgorithmOwnerIdOrLocal(): string {
  const user = getAuthService().getUser();
  return user?.id || 'local';
}
