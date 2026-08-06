/**
 * V3 Executor Hooks
 *
 * TICKET_133 Phase 4: Renderer Adaptation
 *
 * React hooks for interacting with the V3 Executor architecture.
 * Replaces the complex multi-service hooks (useBacktestApi, useSSE, etc.)
 * with a simple unified interface.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useEventWatchdog } from '@StratCraft/shared-ui';
import { UI_WATCHDOG_BACKTEST_PROGRESS_MS } from '../../shared/constants/timing';
import type { BacktestExecutorRequest } from '../../shared/types/backtest';

// =============================================================================
// Types
// =============================================================================

export type ExecutorConfig = BacktestExecutorRequest;

export interface ExecutorMetrics {
  totalPnl: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
}

export interface ExecutorTrade {
  entryTime: number;
  exitTime: number;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  commission: number;
  reason: string;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
  drawdown: number;
}

export interface ExecutorResult {
  success: boolean;
  errorMessage?: string;
  startTime: number;
  endTime: number;
  executionTimeMs: number;
  metrics: ExecutorMetrics;
  equityCurve: EquityPoint[];
  trades: ExecutorTrade[];
}

export interface ExecutorProgress {
  taskId: string;
  percent: number;
  message: string;
}

export type ExecutorStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExecutorState {
  status: ExecutorStatus;
  taskId: string | null;
  progress: number;
  // TICKET_786_2: `progressMessage` and `error` carry i18n message codes
  // (e.g. 'MSG_BACKTEST_STARTING', 'MSG_BACKTEST_EXECUTOR_UNAVAILABLE'),
  // not user-facing strings. Consumers translate via `t(code, errorParams)`
  // from the `errors` namespace. Backend errors arriving via IPC may still
  // be free-form strings; treat any non-`MSG_*`-prefixed value as a passthrough.
  progressMessage: string;
  result: ExecutorResult | null;
  error: string | null;
  errorParams?: Record<string, unknown>;
}

export interface StrategyInfo {
  name: string;
  path: string;
  description?: string;
  createdAt: number;
  modifiedAt: number;
}

// =============================================================================
// useExecutor - Main execution hook
// =============================================================================

/**
 * Hook for running backtests via the V3 Executor
 *
 * @example
 * ```tsx
 * const { run, cancel, status, progress, result, error } = useExecutor();
 *
 * const handleRun = async () => {
 *   await run({
 *     strategyPath: '/path/to/main.py',
 *     symbol: 'BTC/USDT',
 *     interval: '1h',
 *     startTime: 1704067200,
 *     endTime: 1706745600,
 *   });
 * };
 * ```
 */
export function useExecutor() {
  const [state, setState] = useState<ExecutorState>({
    status: 'idle',
    taskId: null,
    progress: 0,
    progressMessage: '',
    result: null,
    error: null,
  });

  const cleanupRef = useRef<Array<() => void>>([]);
  // TICKET_755: progress tick counter -- bumped on every onProgress event,
  // consumed by the watchdog as a reset signal so that any forward motion
  // from the executor restarts the silence countdown.
  const [progressTick, setProgressTick] = useState(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current.forEach(cleanup => cleanup());
    };
  }, []);

  // Subscribe to executor events
  useEffect(() => {
    const api = window.electronAPI?.executor;
    if (!api) return;

    const unsubProgress = api.onProgress((data: ExecutorProgress) => {
      if (data.taskId === state.taskId) {
        setState(prev => ({
          ...prev,
          progress: data.percent,
          progressMessage: data.message,
        }));
        setProgressTick(t => t + 1);
      }
    });

    // TICKET_398_1: completion payload is lightweight (no equityCurve /
    // trades). TICKET_789 step 6 widened the preload return type to expose
    // `finalSeq`; cast through `unknown` to the host hook's richer local
    // ExecutorResult, which downstream consumers read via getResult for
    // the full series (this hook stores metadata only).
    const unsubCompleted = api.onCompleted((data) => {
      if (data.taskId === state.taskId) {
        setState(prev => ({
          ...prev,
          status: 'completed',
          progress: 100,
          result: data.result as unknown as ExecutorResult,
        }));
      }
    });

    const unsubError = api.onError((data: { taskId: string; error: string }) => {
      if (data.taskId === state.taskId) {
        setState(prev => ({
          ...prev,
          status: 'failed',
          error: data.error,
        }));
      }
    });

    const unsubCancelled = api.onCancelled((data: { taskId: string }) => {
      if (data.taskId === state.taskId) {
        setState(prev => ({
          ...prev,
          status: 'cancelled',
        }));
      }
    });

    cleanupRef.current = [unsubProgress, unsubCompleted, unsubError, unsubCancelled];

    return () => {
      unsubProgress();
      unsubCompleted();
      unsubError();
      unsubCancelled();
    };
  }, [state.taskId]);

  // TICKET_755: UI watchdog. Last line of defense against backend hangs and
  // dropped IPC events. Active during pending/running; resets on every
  // progress tick. Fires once per active session.
  useEventWatchdog({
    active: state.status === 'pending' || state.status === 'running',
    timeoutMs: UI_WATCHDOG_BACKTEST_PROGRESS_MS,
    resetSignals: [progressTick],
    onTimeout: () => {
      const seconds = Math.round(UI_WATCHDOG_BACKTEST_PROGRESS_MS / 1000);
      console.error('[E:EXECUTOR:WATCHDOG_TIMEOUT] watchdog timeout', { seconds });
      setState(prev => ({
        ...prev,
        status: 'failed',
        error: 'MSG_BACKTEST_WATCHDOG_TIMEOUT',
        errorParams: { seconds },
      }));
    },
  });

  // Run backtest
  const run = useCallback(async (config: ExecutorConfig) => {
    const api = window.electronAPI?.executor;
    if (!api) {
      setState(prev => ({ ...prev, status: 'failed', error: 'MSG_BACKTEST_EXECUTOR_UNAVAILABLE' }));
      return;
    }

    setState({
      status: 'pending',
      taskId: null,
      progress: 0,
      progressMessage: 'MSG_BACKTEST_STARTING',
      result: null,
      error: null,
    });
    setProgressTick(0);

    try {
      const response = await api.runBacktest(config);

      if (response.success && response.taskId) {
        setState(prev => ({
          ...prev,
          status: 'running',
          taskId: response.taskId!,
        }));
      } else {
        setState(prev => ({
          ...prev,
          status: 'failed',
          error: response.error || 'MSG_BACKTEST_START_FAILED',
        }));
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        status: 'failed',
        error: error instanceof Error ? error.message : 'MSG_UNKNOWN_ERROR',
      }));
    }
  }, []);

  // Cancel backtest
  const cancel = useCallback(async () => {
    const api = window.electronAPI?.executor;
    if (!api || !state.taskId) return;

    try {
      await api.cancelBacktest(state.taskId);
    } catch (error) {
      console.error('[E:EXECUTOR:CANCEL_FAILED] Failed to cancel backtest:', error);
    }
  }, [state.taskId]);

  // Reset state
  const reset = useCallback(() => {
    setState({
      status: 'idle',
      taskId: null,
      progress: 0,
      progressMessage: '',
      result: null,
      error: null,
    });
    setProgressTick(0);
  }, []);

  return {
    ...state,
    run,
    cancel,
    reset,
    isRunning: state.status === 'running' || state.status === 'pending',
  };
}

// =============================================================================
// useExecutorResult - Fetch results for a task
// =============================================================================

/**
 * Hook for fetching backtest results by task ID
 *
 * @example
 * ```tsx
 * const { result, loading, error, refetch } = useExecutorResult(taskId);
 * ```
 */
export function useExecutorResult(taskId: string | null) {
  const [result, setResult] = useState<ExecutorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!taskId) return;

    const api = window.electronAPI?.executor;
    if (!api) {
      setError('MSG_BACKTEST_EXECUTOR_UNAVAILABLE');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.getResults(taskId);

      if (response.success && response.result) {
        setResult(response.result as ExecutorResult);
      } else {
        setError(response.error || 'MSG_BACKTEST_FETCH_RESULTS_FAILED');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MSG_UNKNOWN_ERROR');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { result, loading, error, refetch: fetch };
}

// =============================================================================
// useStrategies - List and manage saved strategies
// =============================================================================

/**
 * Hook for listing saved strategies
 *
 * @example
 * ```tsx
 * const { strategies, loading, error, refetch } = useStrategies();
 * ```
 */
export function useStrategiesV3() {
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    const api = window.electronAPI?.executor;
    if (!api) {
      setError('MSG_BACKTEST_EXECUTOR_UNAVAILABLE');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.listStrategies();

      if (response.success && response.strategies) {
        setStrategies(response.strategies);
      } else {
        setError(response.error || 'MSG_STRATEGY_LIST_FAILED');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MSG_UNKNOWN_ERROR');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { strategies, loading, error, refetch: fetch };
}

// =============================================================================
// useSaveStrategy - Save strategy to disk
// =============================================================================

/**
 * Hook for saving strategies
 *
 * @example
 * ```tsx
 * const { save, saving, error } = useSaveStrategy();
 *
 * await save({
 *   name: 'MyStrategy',
 *   code: strategyCode,
 *   description: 'My trading strategy',
 * });
 * ```
 */
export function useSaveStrategyV3() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async (config: {
    name: string;
    code: string;
    params?: Record<string, unknown>;
    description?: string;
  }) => {
    const api = window.electronAPI?.executor;
    if (!api) {
      setError('MSG_BACKTEST_EXECUTOR_UNAVAILABLE');
      return null;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await api.saveStrategy(config);

      if (response.success) {
        return response.path;
      } else {
        setError(response.error || 'MSG_STRATEGY_SAVE_FAILED');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MSG_UNKNOWN_ERROR');
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  return { save, saving, error };
}

// =============================================================================
// useLoadStrategy - Load strategy from disk
// =============================================================================

/**
 * Hook for loading a strategy by name
 *
 * @example
 * ```tsx
 * const { load, loading, error } = useLoadStrategy();
 *
 * const { code, metadata } = await load('MyStrategy');
 * ```
 */
export function useLoadStrategyV3() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (name: string) => {
    const api = window.electronAPI?.executor;
    if (!api) {
      setError('MSG_BACKTEST_EXECUTOR_UNAVAILABLE');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.loadStrategy(name);

      if (response.success) {
        return {
          code: response.code,
          metadata: response.metadata,
          path: response.path,
        };
      } else {
        setError(response.error || 'MSG_STRATEGY_LOAD_FAILED');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MSG_UNKNOWN_ERROR');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { load, loading, error };
}

// =============================================================================
// useGenerateStrategy - Generate strategy via LLM
// =============================================================================

/**
 * Hook for generating strategy code via LLM
 *
 * @example
 * ```tsx
 * const { generate, generating, error } = useGenerateStrategy();
 *
 * const { code, strategyName } = await generate({
 *   prompt: 'Create a moving average crossover strategy',
 * });
 * ```
 */
export function useGenerateStrategy() {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (config: {
    prompt: string;
    strategyType?: string;
    indicators?: string[];
  }) => {
    const api = window.electronAPI?.executor;
    if (!api) {
      setError('MSG_BACKTEST_EXECUTOR_UNAVAILABLE');
      return null;
    }

    setGenerating(true);
    setError(null);

    try {
      const response = await api.generateStrategy(config);

      if (response.success) {
        return {
          code: response.code,
          strategyName: response.strategyName,
        };
      } else {
        setError(response.error || 'MSG_STRATEGY_GENERATION_FAILED');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MSG_UNKNOWN_ERROR');
      return null;
    } finally {
      setGenerating(false);
    }
  }, []);

  return { generate, generating, error };
}
