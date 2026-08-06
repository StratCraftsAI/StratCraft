/**
 * useCreditStatus - Hook for fetching and computing credit status
 *
 * TICKET_519: Subscription Plan & Credit Display
 * React Query hook with threshold computation and session-based toast notifications.
 */

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useIsAuthenticated } from './useAuth';
import { CREDIT_CONFIG } from '@shared/constants';
import type { CreditStatus } from '@shared/types/credit';

// =============================================================================
// Constants
// =============================================================================

const CREDIT_QUERY_STALE_TIME_MS = 60_000; // 1 minute
const SESSION_WARNING_KEY = 'credit_warning_shown';

// =============================================================================
// API
// =============================================================================

async function fetchCreditStatus(): Promise<CreditStatus | null> {
  const result = await window.electronAPI.credit.getStatus();
  if (!result.success || !result.data) {
    return null;
  }
  return result.data;
}

// =============================================================================
// Hook
// =============================================================================

export function useCreditStatus() {
  const isAuthenticated = useIsAuthenticated();
  const warningShownRef = useRef(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['credit', 'status'],
    queryFn: fetchCreditStatus,
    staleTime: CREDIT_QUERY_STALE_TIME_MS,
    enabled: isAuthenticated,
    refetchOnWindowFocus: true,
  });

  // Compute threshold states
  // total = totalRecharged if available, otherwise cannot compute percentage
  const total = data?.totalRecharged ?? 0;
  const percentRemaining = data && total > 0
    ? (data.remaining / total) * 100
    : data ? (data.remaining > 0 ? 100 : 0) : 100;

  const isLow = data !== null && data !== undefined
    && percentRemaining <= CREDIT_CONFIG.LOW_THRESHOLD_PERCENT
    && percentRemaining > CREDIT_CONFIG.CRITICAL_THRESHOLD_PERCENT;

  const isCritical = data !== null && data !== undefined
    && percentRemaining <= CREDIT_CONFIG.CRITICAL_THRESHOLD_PERCENT
    && percentRemaining > 0;

  const isExhausted = data !== null && data !== undefined
    && data.remaining <= 0;

  // Session-based toast notification (via custom event)
  useEffect(() => {
    if (!data || warningShownRef.current) return;

    const alreadyShown = sessionStorage.getItem(SESSION_WARNING_KEY);
    if (alreadyShown) {
      warningShownRef.current = true;
      return;
    }

    if (isExhausted || isCritical || isLow) {
      sessionStorage.setItem(SESSION_WARNING_KEY, 'true');
      warningShownRef.current = true;

      // Dispatch custom event for toast - consumed by components with useMessage
      window.dispatchEvent(new CustomEvent('nexus:credit-warning', {
        detail: {
          level: isExhausted ? 'error' : isCritical ? 'error' : 'warning',
          remaining: data.remaining,
          total: data.totalRecharged ?? 0,
        },
      }));
    }
  }, [data, isLow, isCritical, isExhausted]);

  return {
    data: data ?? null,
    isLoading,
    percentRemaining,
    isLow,
    isCritical,
    isExhausted,
    refetch,
  };
}
