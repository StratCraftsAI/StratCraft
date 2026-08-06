/**
 * Global Download Queue Store
 *
 * Zustand store that subscribes to IPC download queue progress events globally,
 * making download state available from any page (e.g., StatusBar indicator).
 *
 * @see TICKET_348 - Download Status Bar Indicator
 * @see TICKET_340 - Data Management Center
 */

import { create } from 'zustand';

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

interface DownloadQueueState {
  tasks: QueueTask[];
  initialized: boolean;

  // Actions
  init: () => void;
  enqueue: (config: {
    symbol: string;
    interval: string;
    startDate: string;
    endDate: string;
    provider: string;
  }) => Promise<string>;
  cancel: (taskId: string) => Promise<void>;
}

// =============================================================================
// Selectors
// =============================================================================

export const selectActiveTasks = (state: DownloadQueueState) =>
  state.tasks.filter(t => t.status === 'queued' || t.status === 'downloading');

export const selectActiveCount = (state: DownloadQueueState) =>
  selectActiveTasks(state).length;

export const selectHasActiveDownloads = (state: DownloadQueueState) =>
  selectActiveCount(state) > 0;

// =============================================================================
// Store
// =============================================================================

export const useDownloadQueueStore = create<DownloadQueueState>((set, get) => ({
  tasks: [],
  initialized: false,

  init: () => {
    if (get().initialized) return;
    set({ initialized: true });

    // Subscribe to IPC download queue progress events
    window.electronAPI.data.onDownloadQueueProgress((data: unknown) => {
      const event = data as {
        type?: string;
        tasks?: QueueTask[];
        taskId?: string;
        status?: string;
      } & Partial<QueueTask>;

      // Full status update
      if (event.type === 'full-status' && event.tasks) {
        set({ tasks: event.tasks });
        return;
      }

      // Single task update
      if (event.taskId) {
        set(state => {
          const existing = state.tasks.findIndex(t => t.taskId === event.taskId);
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
            const next = [...state.tasks];
            next[existing] = updated;
            return { tasks: next };
          }
          return { tasks: [...state.tasks, updated] };
        });
      }
    });

    // Load initial queue status
    window.electronAPI.data.getQueueStatus()
      .then((status: { tasks: QueueTask[] }) => {
        set({ tasks: status.tasks });
      })
      .catch(() => {
        // Queue may not have tasks yet
      });
  },

  enqueue: async (config) => {
    const result = await window.electronAPI.data.enqueueDownload(config);
    return result.taskId;
  },

  cancel: async (taskId: string) => {
    await window.electronAPI.data.cancelQueueTask(taskId);
  },
}));
