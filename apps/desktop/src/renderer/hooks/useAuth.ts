/**
 * Authentication Hooks
 *
 * TICKET_066_1: Remote User Authentication
 *
 * Provides React hooks for accessing authentication state and actions.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { AUTH_QUERY_STALE_TIME_MS } from '@shared/constants/timing';
import { ENTITLEMENT_TIER_LEVELS } from '@shared/constants/entitlement';

// =============================================================================
// Types
// =============================================================================

export type AuthPlan = 'FREE' | 'BASIC' | 'PRO' | 'GOLD';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  plan: AuthPlan;
  levelExpiresAt?: string; // TICKET_519: ISO8601 subscription expiry
}

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  expiresAt: number | null;
  isLoading: boolean;
  error: string | null;
}

// =============================================================================
// API Helpers
// =============================================================================

/**
 * Check if auth API is available (running in Electron with preload)
 */
function isAuthApiAvailable(): boolean {
  return typeof window !== 'undefined' &&
         window.electronAPI !== undefined &&
         window.electronAPI.auth !== undefined;
}

/**
 * Get the default unauthenticated state
 */
function getDefaultAuthState(): AuthState {
  return {
    isAuthenticated: false,
    user: null,
    expiresAt: null,
    isLoading: false,
    error: null,
  };
}

async function fetchAuthState(): Promise<AuthState> {
  if (!isAuthApiAvailable()) {
    return getDefaultAuthState();
  }

  try {
    const result = await window.electronAPI.auth.getState();
    if (!result.success) {
      return {
        ...getDefaultAuthState(),
        error: result.error || i18n.t('renderer.auth.failedToFetchState', { ns: 'errors' }),
      };
    }
    return {
      isAuthenticated: result.data?.isAuthenticated ?? false,
      user: result.data?.user ?? null,
      expiresAt: result.data?.expiresAt ?? null,
      isLoading: false,
      error: null,
    };
  } catch (error) {
    return {
      ...getDefaultAuthState(),
      error: error instanceof Error ? error.message : i18n.t('MSG_UNKNOWN_ERROR', { ns: 'errors' }),
    };
  }
}

async function initiateLogin(providerName?: string): Promise<{ authUrl: string }> {
  if (!isAuthApiAvailable()) {
    throw new Error('AUTH_API_UNAVAILABLE');
  }

  const result = await window.electronAPI.auth.login(providerName);
  if (!result.success) {
    throw new Error(result.error || i18n.t('MSG_AUTH_LOGIN_FAILED', { ns: 'errors' }));
  }
  return result.data!;
}

async function performLogout(): Promise<void> {
  if (!isAuthApiAvailable()) {
    throw new Error('AUTH_API_UNAVAILABLE');
  }

  const result = await window.electronAPI.auth.logout();
  if (!result.success) {
    throw new Error(result.error || i18n.t('MSG_AUTH_LOGOUT_FAILED', { ns: 'errors' }));
  }
}

// =============================================================================
// Main Hook: useAuth
// =============================================================================

/**
 * Main authentication hook
 * Provides access to auth state and login/logout actions
 */
export function useAuth() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');
  const [error, setError] = useState<string | null>(null);

  // TICKET_786 D.1: translate known sentinel codes to user-facing strings
  const setTranslatedError = useCallback((raw: string) => {
    if (raw === 'AUTH_API_UNAVAILABLE') {
      setError(t('MSG_AUTH_API_UNAVAILABLE'));
    } else {
      setError(raw);
    }
  }, [t]);

  // Fetch auth state
  const {
    data: authState,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['auth', 'state'],
    queryFn: fetchAuthState,
    staleTime: AUTH_QUERY_STALE_TIME_MS, // Consider data stale after 30 seconds
    refetchOnWindowFocus: true,
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: initiateLogin,
    onError: (err: Error) => {
      setTranslatedError(err.message);
    },
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: performLogout,
    onSuccess: () => {
      // Immediately update the cache to reflect logged out state
      queryClient.setQueryData(['auth', 'state'], getDefaultAuthState());
      // Invalidate to trigger a refetch
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
    onError: (err: Error) => {
      setTranslatedError(err.message);
    },
  });

  // Subscribe to auth state changes from main process
  useEffect(() => {
    if (!isAuthApiAvailable()) {
      return;
    }

    const unsubscribeState = window.electronAPI.auth.onStateChanged((data) => {
      // Update cache with new state
      queryClient.setQueryData(['auth', 'state'], {
        isAuthenticated: data.isAuthenticated,
        user: data.user,
        expiresAt: null, // Will be fetched on next query
        isLoading: false,
        error: null,
      });
    });

    const unsubscribeError = window.electronAPI.auth.onError((data) => {
      setError(data.error);
    });

    return () => {
      unsubscribeState();
      unsubscribeError();
    };
  }, [queryClient]);

  // Login action
  const login = useCallback((providerName?: string) => {
    setError(null);
    return loginMutation.mutateAsync(providerName);
  }, [loginMutation]);

  // Logout action
  const logout = useCallback(() => {
    setError(null);
    return logoutMutation.mutateAsync();
  }, [logoutMutation]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    // State
    isAuthenticated: authState?.isAuthenticated ?? false,
    user: authState?.user ?? null,
    isLoading: isLoading || loginMutation.isPending || logoutMutation.isPending,
    error: error || authState?.error || null,

    // Actions
    login,
    logout,
    refetch,
    clearError,

    // Mutation states (for UI feedback)
    isLoggingIn: loginMutation.isPending,
    isLoggingOut: logoutMutation.isPending,
  };
}

// =============================================================================
// Specialized Hooks
// =============================================================================

/**
 * Hook to get current user only
 *
 * TICKET_241: Derive user from ['auth', 'state'] query instead of
 * independent ['auth', 'user'] query to prevent cache desync.
 */
export function useAuthUser() {
  const { data } = useQuery({
    queryKey: ['auth', 'state'],
    queryFn: fetchAuthState,
    staleTime: AUTH_QUERY_STALE_TIME_MS,
  });

  return data?.user ?? null;
}

/**
 * Hook to check if user is authenticated
 */
export function useIsAuthenticated() {
  const { data } = useQuery({
    queryKey: ['auth', 'state'],
    queryFn: fetchAuthState,
    staleTime: AUTH_QUERY_STALE_TIME_MS,
  });

  return data?.isAuthenticated ?? false;
}

/**
 * Hook to get user's plan
 */
export function useAuthPlan(): AuthPlan | null {
  const user = useAuthUser();
  return user?.plan ?? null;
}

/**
 * Hook to subscribe to auth state changes only
 * Lightweight version that doesn't trigger login/logout
 */
export function useAuthState() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'state'],
    queryFn: fetchAuthState,
    staleTime: AUTH_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });

  // Subscribe to auth state changes from main process
  useEffect(() => {
    if (!isAuthApiAvailable()) {
      return;
    }

    const unsubscribe = window.electronAPI.auth.onStateChanged((newState) => {
      queryClient.setQueryData(['auth', 'state'], {
        isAuthenticated: newState.isAuthenticated,
        user: newState.user,
        expiresAt: null,
        isLoading: false,
        error: null,
      });
    });

    return () => unsubscribe();
  }, [queryClient]);

  return {
    isAuthenticated: data?.isAuthenticated ?? false,
    user: data?.user ?? null,
    isLoading,
  };
}

/**
 * Hook to check if user has a specific plan or higher
 */
export function useHasPlan(requiredPlan: AuthPlan): boolean {
  const currentPlan = useAuthPlan();

  return useMemo(() => {
    if (!currentPlan) return false;

    // TICKET_707: Use centralized ENTITLEMENT_TIER_LEVELS (lowercase keys)
    const currentLevel = ENTITLEMENT_TIER_LEVELS[currentPlan.toLowerCase()] ?? 0;
    const requiredLevel = ENTITLEMENT_TIER_LEVELS[requiredPlan.toLowerCase()] ?? 0;
    return currentLevel >= requiredLevel;
  }, [currentPlan, requiredPlan]);
}

/**
 * TICKET_704: Hook to get user's entitlement tier as lowercase string.
 * Returns 'free' | 'basic' | 'pro' | 'gold' for tier-level comparison.
 */
export function useUserTier(): 'free' | 'basic' | 'pro' | 'gold' {
  const plan = useAuthPlan();
  return useMemo(() => {
    if (!plan) return 'free';
    return plan.toLowerCase() as 'free' | 'basic' | 'pro' | 'gold';
  }, [plan]);
}
