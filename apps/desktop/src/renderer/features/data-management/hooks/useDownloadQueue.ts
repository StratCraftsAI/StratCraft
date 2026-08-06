/**
 * useDownloadQueue - Download queue state and event subscription
 *
 * TICKET_340: Data Management Center - Queue state hook
 */

import { useState, useEffect, useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface QueueTask {
  taskId: string;
  symbol: string;
  interval: string;
  provider: string;
  status: 'queued' | 'downloading' | 'complete' | 'partial' | 'error';
  progress: number;
  message: string;
  error?: string;
  callerId?: string;
  /** TICKET_1070 AC3: chunk-level progress for tooltip */
  totalChunks?: number;
  completedChunks?: number;
  currentChunkStart?: string;
  currentChunkEnd?: string;
}

interface EnqueueConfig {
  symbol: string;
  interval: string;
  startDate: string;
  endDate: string;
  provider: string;
}

// =============================================================================
// Hook
// =============================================================================

export function useDownloadQueue() {
  const [tasks, setTasks] = useState<QueueTask[]>([]);

  // Subscribe to download queue progress events
  useEffect(() => {
    const unsub = window.electronAPI.data.onDownloadQueueProgress((data: unknown) => {
      const event = data as {
        type?: string;
        tasks?: QueueTask[];
        taskId?: string;
        status?: string;
      } & Partial<QueueTask>;

      // Full status update (after task removal)
      if (event.type === 'full-status' && event.tasks) {
        setTasks(event.tasks);
        return;
      }

      // Single task update
      if (event.taskId) {
        setTasks(prev => {
          const existing = prev.findIndex(t => t.taskId === event.taskId);
          const updated: QueueTask = {
            taskId: event.taskId!,
            symbol: event.symbol || '',
            interval: event.interval || '',
            provider: event.provider || '',
            status: (event.status as QueueTask['status']) || 'queued',
            progress: event.progress || 0,
            message: event.message || '',
            error: event.error,
            callerId: event.callerId,
            totalChunks: (event as Record<string, unknown>).totalChunks as number | undefined,
            completedChunks: (event as Record<string, unknown>).completedChunks as number | undefined,
            currentChunkStart: (event as Record<string, unknown>).currentChunkStart as string | undefined,
            currentChunkEnd: (event as Record<string, unknown>).currentChunkEnd as string | undefined,
          };

          if (existing >= 0) {
            const next = [...prev];
            next[existing] = updated;
            return next;
          }
          return [...prev, updated];
        });
      }
    });
    return unsub;
  }, []);

  // Load initial queue status
  useEffect(() => {
    window.electronAPI.data.getQueueStatus().then((status: { tasks: QueueTask[] }) => {
      setTasks(status.tasks);
    }).catch(() => {
      // Queue may not have tasks yet
    });
  }, []);

  const enqueue = useCallback(async (config: EnqueueConfig) => {
    const result = await window.electronAPI.data.enqueueDownload(config);
    return result.taskId;
  }, []);

  const cancel = useCallback(async (taskId: string) => {
    await window.electronAPI.data.cancelQueueTask(taskId);
  }, []);

  return { tasks, enqueue, cancel };
}
