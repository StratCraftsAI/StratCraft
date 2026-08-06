/**
 * Auth Gate Hook
 *
 * TICKET_429: Centralized hook for gating UI actions that require authentication.
 * Dispatches nexus:auth-required event to highlight login button when not authenticated.
 *
 * @see TICKET_293 - Auth-Aware UI Gating (data source options)
 * @see TICKET_289 - Symbol Search Auth Error Feedback
 */

import { useCallback } from 'react';
import { useAuthState } from './useAuth';

/**
 * Hook for gating UI actions that require authentication.
 *
 * @returns { isAuthenticated, requireAuth }
 *
 * requireAuth(callback) - executes callback if authenticated,
 * otherwise dispatches nexus:auth-required to highlight login button.
 *
 * @example
 * ```tsx
 * const { isAuthenticated, requireAuth } = useAuthGate();
 *
 * <button
 *   disabled={!isAuthenticated || !canGenerate}
 *   onClick={() => requireAuth(() => doBackendCall())}
 * >
 *   Generate
 * </button>
 * ```
 */
export function useAuthGate() {
  const { isAuthenticated } = useAuthState();

  const requireAuth = useCallback((
    action: () => void,
  ) => {
    if (isAuthenticated) {
      action();
      return;
    }
    // Highlight login button via existing nexus:auth-required event
    window.dispatchEvent(new Event('nexus:auth-required'));
  }, [isAuthenticated]);

  return { isAuthenticated, requireAuth };
}
