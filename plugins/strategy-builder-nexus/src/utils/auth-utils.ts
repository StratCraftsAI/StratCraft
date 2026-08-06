/**
 * Centralized user ID retrieval for Plugin Renderer process.
 * Single source of truth - all services import from here.
 * Fail-fast: throws if not authenticated (no silent fallbacks).
 *
 * TICKET_786 D.1: errors are thrown as sentinel codes
 * (AUTH_API_UNAVAILABLE / AUTH_NOT_AUTHENTICATED) and translated at the
 * presentation layer via errors:MSG_* keys.
 */

export async function getCurrentUserId(): Promise<string> {
  if (!window.electronAPI.auth) {
    throw new Error('AUTH_API_UNAVAILABLE');
  }
  const result = await window.electronAPI.auth.getUser();
  if (!result?.success || !result.data?.id) {
    throw new Error('AUTH_NOT_AUTHENTICATED');
  }
  return result.data.id;
}

export async function getCurrentUserIdAsString(): Promise<string> {
  if (!window.electronAPI.auth) {
    throw new Error('AUTH_API_UNAVAILABLE');
  }
  const result = await window.electronAPI.auth.getUser();
  if (!result?.success || !result.data?.id) {
    throw new Error('AUTH_NOT_AUTHENTICATED');
  }
  return result.data.id;
}

/**
 * TICKET_719: Auth-optional user ID for free strategy types.
 * Returns authenticated user ID when available, 'local' otherwise.
 * Mirrors main process getAlgorithmOwnerIdOrLocal() (TICKET_670).
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
