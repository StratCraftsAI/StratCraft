/**
 * API request Hook
 *
 * @deprecated TICKET_133: V1 Python FastAPI hooks
 * V3 architecture does not use Python FastAPI server.
 * Use useExecutor hooks from './useExecutor' instead.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_CONFIG } from '@shared/constants';
import { TASK_POLL_INTERVAL_MS, HEALTH_CHECK_INTERVAL_MS } from '@shared/constants/timing';
import type { ApiResponse, Strategy, BacktestConfig, BacktestResult } from '@shared/types';

// API client base function
async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_CONFIG.BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    // TICKET_786 D.1: throw sentinel code; presentation layer translates via errors:MSG_API_ERROR
    const err = new Error('API_ERROR') as Error & { status?: number; statusText?: string };
    err.status = response.status;
    err.statusText = response.statusText;
    throw err;
  }

  return response.json();
}

// Strategy list
export function useStrategies() {
  return useQuery({
    queryKey: ['strategies'],
    queryFn: () => apiRequest<ApiResponse<Strategy[]>>('/strategy/list'),
  });
}

// Single strategy
export function useStrategy(id: string) {
  return useQuery({
    queryKey: ['strategy', id],
    queryFn: () => apiRequest<ApiResponse<Strategy>>(`/strategy/${id}`),
    enabled: !!id,
  });
}

// Save strategy
export function useSaveStrategy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (strategy: Partial<Strategy>) => {
      const method = strategy.id ? 'PUT' : 'POST';
      const url = strategy.id ? `/strategy/${strategy.id}` : '/strategy';
      return apiRequest<ApiResponse<Strategy>>(url, {
        method,
        body: JSON.stringify(strategy),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
    },
  });
}

// Delete strategy
export function useDeleteStrategy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<ApiResponse<void>>(`/strategy/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
    },
  });
}

/**
 * Run backtest via V1 Python API
 * @deprecated TICKET_133: Use useExecutor().runBacktest() instead
 */
export function useRunBacktest() {
  return useMutation({
    mutationFn: (config: BacktestConfig) =>
      apiRequest<ApiResponse<{ taskId: string }>>('/backtest/run', {
        method: 'POST',
        body: JSON.stringify(config),
      }),
  });
}

/**
 * Get backtest result from V1 Python API
 * @deprecated TICKET_133: Use useExecutorResult() instead
 */
export function useBacktestResult(taskId: string) {
  return useQuery({
    queryKey: ['backtest', taskId],
    queryFn: () =>
      apiRequest<ApiResponse<BacktestResult>>(`/backtest/results/${taskId}`),
    enabled: !!taskId,
    refetchInterval: (query) => {
      // Poll while task is in progress
      const status = query.state.data?.data?.status;
      if (status === 'processing') {
        return TASK_POLL_INTERVAL_MS;
      }
      return false;
    },
  });
}

// Health check
export function useHealthCheck() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiRequest<{ status: string; version: string }>('/health'),
    refetchInterval: HEALTH_CHECK_INTERVAL_MS,
  });
}
