/**
 * Auth-Gated Options Hook
 *
 * TICKET_293: Filters or disables options based on their requiresAuth field
 * and the current authentication state. Uses useIsAuthenticated() internally
 * (React Query cache, zero extra IPC).
 *
 * @example
 * ```tsx
 * const sources = useAuthGatedOptions(allSources, { behavior: 'disable' });
 * // When unauthenticated: items with requiresAuth=true get disabled=true
 * ```
 */

import { useMemo } from 'react';
import { useIsAuthenticated } from './useAuth';

export interface AuthGatedOption {
  requiresAuth?: boolean;
  disabled?: boolean;
}

export function useAuthGatedOptions<T extends AuthGatedOption>(
  options: T[],
  config: { behavior: 'disable' | 'hide' },
): T[] {
  const isAuthenticated = useIsAuthenticated();

  return useMemo(() => {
    if (isAuthenticated) return options;

    if (config.behavior === 'hide') {
      return options.filter((opt) => !opt.requiresAuth);
    }

    // 'disable' mode: mark requiresAuth options as disabled
    return options.map((opt) =>
      opt.requiresAuth ? { ...opt, disabled: true } : opt,
    );
  }, [options, isAuthenticated, config.behavior]);
}
