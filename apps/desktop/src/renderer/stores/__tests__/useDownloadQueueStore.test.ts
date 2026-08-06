/**
 * TICKET_634_3: useDownloadQueueStore Tests
 *
 * Tests for download queue state management and selectors.
 * Note: init() requires window.electronAPI and is tested via integration tests.
 * This file tests state mutations and selector logic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useDownloadQueueStore,
  selectActiveTasks,
  selectActiveCount,
  selectHasActiveDownloads,
  type QueueTask,
} from '../useDownloadQueueStore';

function makeTask(overrides: Partial<QueueTask> = {}): QueueTask {
  return {
    taskId: 'task-1',
    symbol: 'AAPL',
    interval: '1d',
    provider: 'yfinance',
    status: 'queued',
    progress: 0,
    message: '',
    ...overrides,
  };
}

describe('useDownloadQueueStore', () => {
  beforeEach(() => {
    useDownloadQueueStore.setState({
      tasks: [],
      initialized: false,
    });
  });

  // =========================================================================
  // State Basics
  // =========================================================================

  describe('initial state', () => {
    it('should start with empty tasks', () => {
      expect(useDownloadQueueStore.getState().tasks).toEqual([]);
    });

    it('should start not initialized', () => {
      expect(useDownloadQueueStore.getState().initialized).toBe(false);
    });
  });

  // =========================================================================
  // Direct State Manipulation (for selector testing)
  // =========================================================================

  describe('task state management', () => {
    it('should accept task array via setState', () => {
      const tasks = [makeTask({ taskId: 't1' }), makeTask({ taskId: 't2' })];
      useDownloadQueueStore.setState({ tasks });
      expect(useDownloadQueueStore.getState().tasks).toHaveLength(2);
    });

    it('should track initialized flag', () => {
      useDownloadQueueStore.setState({ initialized: true });
      expect(useDownloadQueueStore.getState().initialized).toBe(true);
    });
  });

  // =========================================================================
  // Selectors
  // =========================================================================

  describe('selectActiveTasks', () => {
    it('should return queued and downloading tasks only', () => {
      const tasks = [
        makeTask({ taskId: 't1', status: 'queued' }),
        makeTask({ taskId: 't2', status: 'downloading' }),
        makeTask({ taskId: 't3', status: 'complete' }),
        makeTask({ taskId: 't4', status: 'error' }),
      ];
      useDownloadQueueStore.setState({ tasks });

      const active = selectActiveTasks(useDownloadQueueStore.getState());
      expect(active).toHaveLength(2);
      expect(active.map((t) => t.taskId).sort()).toEqual(['t1', 't2']);
    });

    it('should return empty array when no active tasks', () => {
      const tasks = [
        makeTask({ taskId: 't1', status: 'complete' }),
        makeTask({ taskId: 't2', status: 'error' }),
      ];
      useDownloadQueueStore.setState({ tasks });
      expect(selectActiveTasks(useDownloadQueueStore.getState())).toEqual([]);
    });
  });

  describe('selectActiveCount', () => {
    it('should return count of active tasks', () => {
      const tasks = [
        makeTask({ taskId: 't1', status: 'queued' }),
        makeTask({ taskId: 't2', status: 'downloading' }),
        makeTask({ taskId: 't3', status: 'complete' }),
      ];
      useDownloadQueueStore.setState({ tasks });
      expect(selectActiveCount(useDownloadQueueStore.getState())).toBe(2);
    });

    it('should return 0 when all complete', () => {
      useDownloadQueueStore.setState({
        tasks: [makeTask({ status: 'complete' })],
      });
      expect(selectActiveCount(useDownloadQueueStore.getState())).toBe(0);
    });
  });

  describe('selectHasActiveDownloads', () => {
    it('should return true when downloads are active', () => {
      useDownloadQueueStore.setState({
        tasks: [makeTask({ status: 'downloading' })],
      });
      expect(selectHasActiveDownloads(useDownloadQueueStore.getState())).toBe(true);
    });

    it('should return false when no active downloads', () => {
      useDownloadQueueStore.setState({
        tasks: [makeTask({ status: 'complete' })],
      });
      expect(selectHasActiveDownloads(useDownloadQueueStore.getState())).toBe(false);
    });

    it('should return false when no tasks', () => {
      expect(selectHasActiveDownloads(useDownloadQueueStore.getState())).toBe(false);
    });
  });
});
