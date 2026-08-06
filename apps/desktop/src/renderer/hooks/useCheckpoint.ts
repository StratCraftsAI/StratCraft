/**
 * Checkpoint Hooks
 *
 * TICKET_176: Backtest Checkpoint Resume
 * TICKET_176_1: Checkpoint Resume UI
 *
 * React hooks for checkpoint management and backtest resume.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import i18n from 'i18next';

// =============================================================================
// Types
// =============================================================================

export interface CheckpointInfo {
  taskId: string;
  barIndex: number;
  totalBars: number;
  createdAt: string;
  progressPercent: number;
  intermediateResults?: IntermediateResults;
  dataValidation: DataValidationStatus;
}

export interface IntermediateResults {
  metrics?: {
    totalPnl?: number;
    totalReturn?: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    winRate?: number;
    totalTrades?: number;
    winningTrades?: number;
    losingTrades?: number;
  };
  trades?: Array<{
    entryTime: number;
    exitTime: number;
    symbol: string;
    side: string;
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    pnl: number;
  }>;
  equityCurve?: Array<{
    timestamp: number;
    equity: number;
    drawdown: number;
  }>;
  openPositions?: Array<{
    symbol: string;
    size: number;
    price: number;
  }>;
}

export type DataValidationStatus = 'valid' | 'file_missing' | 'hash_mismatch' | 'pending';

export interface CheckpointSummary {
  task_id: string;
  bar_index: number;
  created_at: string;
}

// =============================================================================
// useCheckpoint Hook
// =============================================================================

export interface UseCheckpointResult {
  hasCheckpoint: boolean;
  checkpointInfo: CheckpointInfo | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  deleteCheckpoint: () => Promise<void>;
}

/**
 * Hook to check and manage checkpoint for a specific task
 */
export function useCheckpoint(taskId: string | null): UseCheckpointResult {
  const [hasCheckpoint, setHasCheckpoint] = useState(false);
  const [checkpointInfo, setCheckpointInfo] = useState<CheckpointInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!taskId) {
      setHasCheckpoint(false);
      setCheckpointInfo(null);
      return;
    }

    const api = (window as any).electronAPI?.backtest;
    if (!api) {
      console.warn('[W:BACKTEST:CHECKPOINT_API_UNAVAILABLE] Backtest API not available');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check if checkpoint exists
      const hasResult = await api.hasCheckpoint(taskId);
      if (!hasResult.success) {
        throw new Error(hasResult.error || i18n.t('renderer.checkpoint.failedToCheck', { ns: 'errors' }));
      }

      setHasCheckpoint(hasResult.hasCheckpoint);

      if (hasResult.hasCheckpoint) {
        // Get checkpoint info
        const infoResult = await api.getCheckpointInfo(taskId);
        if (!infoResult.success) {
          throw new Error(infoResult.error || 'MSG_CHECKPOINT_LOAD_FAILED');
        }
        setCheckpointInfo(infoResult.data);
      } else {
        setCheckpointInfo(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MSG_UNKNOWN_ERROR');
      setHasCheckpoint(false);
      setCheckpointInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  const deleteCheckpoint = useCallback(async () => {
    if (!taskId) return;

    const api = (window as any).electronAPI?.backtest;
    if (!api) return;

    try {
      const result = await api.deleteCheckpoint(taskId);
      if (!result.success) {
        throw new Error(result.error || 'MSG_CHECKPOINT_DELETE_FAILED');
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MSG_CHECKPOINT_DELETE_FAILED');
    }
  }, [taskId, refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    hasCheckpoint,
    checkpointInfo,
    isLoading,
    error,
    refresh,
    deleteCheckpoint,
  };
}

// =============================================================================
// useCheckpointList Hook
// =============================================================================

export interface UseCheckpointListResult {
  checkpoints: CheckpointSummary[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to list all checkpoints
 */
export function useCheckpointList(): UseCheckpointListResult {
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = (window as any).electronAPI?.backtest;
    if (!api) {
      console.warn('[W:BACKTEST:CHECKPOINT_LIST_API_UNAVAILABLE] Backtest API not available');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.listCheckpoints();
      if (!result.success) {
        throw new Error(result.error || 'MSG_CHECKPOINT_LIST_FAILED');
      }
      setCheckpoints(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MSG_UNKNOWN_ERROR');
      setCheckpoints([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    checkpoints,
    isLoading,
    error,
    refresh,
  };
}

// =============================================================================
// useBacktestResume Hook
// =============================================================================

export type ResumeState =
  | 'idle'
  | 'checkpoint_preview'
  | 'validating'
  | 'warmup'
  | 'executing'
  | 'complete'
  | 'error';

export interface ResumeProgress {
  percent: number;
  currentBar: number;
  totalBars: number;
  phase: 'warmup' | 'executing' | null;
  // TICKET_786_2: `message` carries an i18n key (e.g. 'MSG_CHECKPOINT_PROGRESS',
  // 'MSG_CHECKPOINT_WARMING_UP'); consumer translates via `t(message, messageParams)`
  // from the `errors` namespace.
  message: string;
  messageParams?: Record<string, unknown>;
}

export interface UseBacktestResumeResult {
  // State
  state: ResumeState;
  checkpoint: CheckpointInfo | null;
  error: string | null;

  // Results
  intermediateResults: IntermediateResults | null;
  displayResults: DisplayResults | null;

  // Progress
  progress: ResumeProgress;

  // Actions
  loadCheckpoint: (taskId: string) => Promise<void>;
  resume: (originalConfig: unknown) => Promise<string | null>;
  discard: () => Promise<void>;
  reset: () => void;
}

export interface DisplayResults {
  metrics?: IntermediateResults['metrics'];
  trades?: IntermediateResults['trades'];
  equityCurve?: IntermediateResults['equityCurve'];
  openPositions?: IntermediateResults['openPositions'];
  isPartial: boolean;
  checkpointBarIndex: number | null;
}

/**
 * Hook for managing backtest resume flow
 */
export function useBacktestResume(): UseBacktestResumeResult {
  const [state, setState] = useState<ResumeState>('idle');
  const [checkpoint, setCheckpoint] = useState<CheckpointInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intermediateResults, setIntermediateResults] = useState<IntermediateResults | null>(null);
  const [progress, setProgress] = useState<ResumeProgress>({
    percent: 0,
    currentBar: 0,
    totalBars: 0,
    phase: null,
    message: '',
  });

  const loadCheckpoint = useCallback(async (taskId: string) => {
    const api = (window as any).electronAPI?.backtest;
    if (!api) {
      setError('MSG_BACKTEST_API_UNAVAILABLE');
      setState('error');
      return;
    }

    setState('validating');
    setError(null);

    try {
      // Get checkpoint info
      const result = await api.getCheckpointInfo(taskId);
      if (!result.success || !result.data) {
        throw new Error(result.error || 'MSG_CHECKPOINT_NOT_FOUND');
      }

      const checkpointInfo = result.data as CheckpointInfo;
      setCheckpoint(checkpointInfo);

      // Check data validation
      if (checkpointInfo.dataValidation === 'file_missing') {
        setState('error');
        setError('MSG_CHECKPOINT_DATA_FILE_NOT_FOUND');
        return;
      }

      if (checkpointInfo.dataValidation === 'hash_mismatch') {
        setState('error');
        setError('MSG_CHECKPOINT_DATA_FILE_CHANGED');
        return;
      }

      // Extract intermediate results
      if (checkpointInfo.intermediateResults) {
        setIntermediateResults(checkpointInfo.intermediateResults);
      }

      setProgress({
        percent: checkpointInfo.progressPercent,
        currentBar: checkpointInfo.barIndex,
        totalBars: checkpointInfo.totalBars,
        phase: null,
        message: 'MSG_CHECKPOINT_PROGRESS',
        messageParams: { percent: checkpointInfo.progressPercent },
      });

      setState('checkpoint_preview');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'MSG_CHECKPOINT_LOAD_FAILED');
    }
  }, []);

  const resume = useCallback(async (originalConfig: unknown): Promise<string | null> => {
    if (!checkpoint) {
      setError('MSG_CHECKPOINT_NONE_LOADED');
      return null;
    }

    const api = (window as any).electronAPI?.backtest;
    if (!api) {
      setError('MSG_BACKTEST_API_UNAVAILABLE');
      return null;
    }

    setState('warmup');
    setProgress(prev => ({ ...prev, phase: 'warmup', message: 'MSG_CHECKPOINT_WARMING_UP' }));

    try {
      const result = await api.resumeBacktest({
        taskId: checkpoint.taskId,
        originalConfig,
      });

      if (!result.success) {
        throw new Error(result.error || 'MSG_CHECKPOINT_RESUME_FAILED');
      }

      setState('executing');
      setProgress(prev => ({ ...prev, phase: 'executing', message: 'MSG_CHECKPOINT_EXECUTING' }));

      return result.taskId;
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'MSG_CHECKPOINT_RESUME_FAILED');
      return null;
    }
  }, [checkpoint]);

  const discard = useCallback(async () => {
    if (!checkpoint) return;

    const api = (window as any).electronAPI?.backtest;
    if (!api) return;

    try {
      await api.deleteCheckpoint(checkpoint.taskId);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MSG_CHECKPOINT_DELETE_FAILED');
    }
  }, [checkpoint]);

  const reset = useCallback(() => {
    setState('idle');
    setCheckpoint(null);
    setError(null);
    setIntermediateResults(null);
    setProgress({
      percent: 0,
      currentBar: 0,
      totalBars: 0,
      phase: null,
      message: '',
    });
  }, []);

  // Compute display results
  const displayResults = useMemo((): DisplayResults | null => {
    if (state === 'idle' || !checkpoint) {
      return null;
    }

    if (state === 'checkpoint_preview' && intermediateResults) {
      return {
        ...intermediateResults,
        isPartial: true,
        checkpointBarIndex: checkpoint.barIndex,
      };
    }

    // TODO: Merge intermediate with live results when executing/complete
    return intermediateResults
      ? {
          ...intermediateResults,
          isPartial: state !== 'complete',
          checkpointBarIndex: state === 'complete' ? null : checkpoint.barIndex,
        }
      : null;
  }, [state, checkpoint, intermediateResults]);

  return {
    state,
    checkpoint,
    error,
    intermediateResults,
    displayResults,
    progress,
    loadCheckpoint,
    resume,
    discard,
    reset,
  };
}

// =============================================================================
// Export all hooks
// =============================================================================

export default {
  useCheckpoint,
  useCheckpointList,
  useBacktestResume,
};
