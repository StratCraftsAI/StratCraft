/**
 * Plugin Auth Hook
 *
 * TICKET_571: IPC-based auth state hook for plugin components.
 * Uses window.electronAPI.auth directly (no React Query dependency),
 * suitable for both bundled and marketplace plugins.
 *
 * Replaces the repeated ~10-line IPC auth subscription boilerplate
 * found in SignalDiscoverySection, AlphaFactoryPage, BacktestPage, etc.
 *
 * @see TICKET_293 - Auth-Aware UI Gating
 * @see TICKET_293_1 - Plugin Auth SDK Hook
 */

import { useState, useEffect } from 'react';

/**
 * Hook that subscribes to auth state via IPC.
 *
 * @returns { isAuthenticated } - current authentication state
 *
 * @example
 * ```tsx
 * const { isAuthenticated } = usePluginAuth();
 *
 * if (!isAuthenticated) {
 *   return <AuthRequiredBanner isAuthenticated={false} />;
 * }
 * ```
 */
export function usePluginAuth(): { isAuthenticated: boolean } {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.auth) return;

    api.auth.getState().then((result) => {
      if (result.success && result.data) {
        setIsAuthenticated(result.data.isAuthenticated);
      }
    });

    const unsubscribe = api.auth.onStateChanged((data) => {
      setIsAuthenticated(data.isAuthenticated);
    });

    return () => unsubscribe();
  }, []);

  return { isAuthenticated };
}
