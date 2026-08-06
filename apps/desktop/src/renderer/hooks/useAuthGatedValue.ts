/**
 * Auth-Gated Value Hook
 *
 * TICKET_293: Selects a value based on the current authentication state.
 * Uses useIsAuthenticated() internally (React Query cache, zero extra IPC).
 *
 * @example
 * ```tsx
 * const defaultProvider = useAuthGatedValue({
 *   authenticated: 'clickhouse',
 *   unauthenticated: 'yfinance',
 * });
 * ```
 */

import { useIsAuthenticated } from './useAuth';

export function useAuthGatedValue<T>(options: {
  authenticated: T;
  unauthenticated: T;
}): T {
  const isAuthenticated = useIsAuthenticated();
  return isAuthenticated ? options.authenticated : options.unauthenticated;
}
