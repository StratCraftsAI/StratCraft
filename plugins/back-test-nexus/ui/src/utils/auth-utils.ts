/**
 * Centralized user ID retrieval for Plugin Renderer process.
 * Single source of truth - all services import from here.
 * Fail-fast: throws if not authenticated (no silent fallbacks).
 *
 * TICKET_420: Fix hardcoded userId='default' in algorithmService queries.
 * Replicates pattern from strategy-builder-nexus/src/utils/auth-utils.ts.
 */

import i18n from 'i18next';

export async function getCurrentUserIdAsString(): Promise<string> {
  if (!window.electronAPI.auth) {
    throw new Error('Auth API not available');
  }
  const result = await window.electronAPI.auth.getUser();
  if (!result?.success || !result.data?.id) {
    throw new Error(i18n.t('errors.userNotAuthenticated', { ns: 'backtest' }));
  }
  return result.data.id;
}

/**
 * Auth-optional user ID for backtest history / algorithm queries.
 * Returns authenticated user ID when available, 'local' otherwise.
 * Mirrors main process getAlgorithmOwnerIdOrLocal() (TICKET_670) and the
 * sibling helper in strategy-builder-nexus/src/utils/auth-utils.ts.
 *
 * TICKET_770 follow-up: needed so the algorithmService.getAlgorithms wrapper
 * can compile without forcing every caller to pass userId. Strict
 * authentication is preserved via the original getCurrentUserIdAsString()
 * helper above for paths that genuinely require it.
 */
export async function getCurrentUserIdOrLocal(): Promise<string> {
  if (!window.electronAPI.auth) {
    return 'local';
  }
  const result = await window.electronAPI.auth.getUser();
  if (!result?.success || !result.data?.id) {
    return 'local';
  }
  return result.data.id;
}
