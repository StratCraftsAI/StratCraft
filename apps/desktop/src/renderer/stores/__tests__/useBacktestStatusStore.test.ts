/**
 * TICKET_634_3: useBacktestStatusStore Tests
 *
 * Tests for the global backtest status store (TICKET_233, TICKET_234, TICKET_239).
 * Validates task lifecycle, queue management, tab management, and selectors.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock window.electronAPI for persistOpenTabs/restoreOpenTabs
vi.stubGlobal('window', {
  ...globalThis.window,
  electronAPI: {
    executor: {
      cancelBacktest: vi.fn(),
      getResults: vi.fn(),
      onProgress: vi.fn(() => vi.fn()),
      onCompleted: vi.fn(() => vi.fn()),
      onError: vi.fn(() => vi.fn()),
      onCancelled: vi.fn(() => vi.fn()),
    },
    store: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
});

import {
  useBacktestStatusStore,
  initialExecutionState,
  initialPipelineProgress,
  type BacktestTask,
} from '../useBacktestStatusStore';

function makeTask(
  taskId: string,
  strategyName = 'Test Strategy',
  extras: Partial<BacktestTask> = {}
): Omit<BacktestTask, 'status' | 'progress' | 'createdAt'> {
  return {
    taskId,
    strategyName,
    lastAccessedAt: Date.now(),
    ...extras,
  };
}

describe('useBacktestStatusStore', () => {
  beforeEach(() => {
    useBacktestStatusStore.setState({
      currentTask: null,
      pendingTasks: [],
      isQueueDialogOpen: false,
      runningTasks: [],
      taskResults: {},
      activeTabId: null,
      maxParallelTasks: 3,
      dataDownload: { phase: 'idle', progress: 0, message: '', symbol: '' },
      loadingTabIds: [],
      cancelledTaskId: null,
      completedTaskId: null,
    });
  });

  // =========================================================================
  // Enqueue
  // =========================================================================

  describe('enqueue', () => {
    it('should start task immediately when under parallel limit', () => {
      const started = useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      expect(started).toBe(true);

      const state = useBacktestStatusStore.getState();
      expect(state.runningTasks).toHaveLength(1);
      expect(state.runningTasks[0].status).toBe('running');
      expect(state.runningTasks[0].taskId).toBe('t1');
      expect(state.activeTabId).toBe('t1');
    });

    it('should queue task when at parallel limit', () => {
      useBacktestStatusStore.getState().setMaxParallelTasks(1);
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      const started = useBacktestStatusStore.getState().enqueue(makeTask('t2'));

      expect(started).toBe(false);
      expect(useBacktestStatusStore.getState().pendingTasks).toHaveLength(1);
      expect(useBacktestStatusStore.getState().pendingTasks[0].taskId).toBe('t2');
    });

    it('should initialize task result entry', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      const results = useBacktestStatusStore.getState().taskResults;
      expect(results['t1']).toBeDefined();
      expect(results['t1'].result).toBeNull();
      expect(results['t1'].executionState.isExecuting).toBe(true);
    });

    it('should auto-focus new tab', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      expect(useBacktestStatusStore.getState().activeTabId).toBe('t1');
    });
  });

  // =========================================================================
  // startTask
  // =========================================================================

  describe('startTask', () => {
    it('should transition task to running with metadata', () => {
      // Create a preparing tab first
      useBacktestStatusStore.getState().createPreparingTab({ taskId: 't1', strategyName: 'Test' });
      useBacktestStatusStore.getState().startTask('t1', {
        backtestConfig: {
          dataSource: 'yfinance',
          symbol: 'AAPL',
          startDate: '2023-01-01',
          endDate: '2024-01-01',
          initialCapital: 100000,
          orderSize: 100,
          orderSizeUnit: 'shares',
        },
      });

      const task = useBacktestStatusStore.getState().runningTasks.find((t) => t.taskId === 't1');
      expect(task?.status).toBe('running');
      expect(task?.backtestConfig?.symbol).toBe('AAPL');
    });
  });

  // =========================================================================
  // Progress Updates
  // =========================================================================

  describe('updateProgress', () => {
    it('should update progress for running task', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().updateProgress('t1', 50);

      const task = useBacktestStatusStore.getState().runningTasks[0];
      expect(task.progress).toBe(50);
    });

    it('should not affect other tasks', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().enqueue(makeTask('t2'));
      useBacktestStatusStore.getState().updateProgress('t1', 75);

      expect(useBacktestStatusStore.getState().runningTasks[0].progress).toBe(75);
      expect(useBacktestStatusStore.getState().runningTasks[1].progress).toBe(0);
    });
  });

  // =========================================================================
  // Complete Task
  // =========================================================================

  describe('completeTask', () => {
    it('should set task to completed with progress 100', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().completeTask('t1', 'completed');

      const task = useBacktestStatusStore.getState().runningTasks[0];
      expect(task.status).toBe('completed');
      expect(task.progress).toBe(100);
    });

    it('should set execution state to not executing', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().completeTask('t1', 'completed');

      const result = useBacktestStatusStore.getState().taskResults['t1'];
      expect(result.executionState.isExecuting).toBe(false);
    });

    it('should auto-start next pending task on completion', () => {
      useBacktestStatusStore.getState().setMaxParallelTasks(1);
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().enqueue(makeTask('t2'));

      // t2 should be pending
      expect(useBacktestStatusStore.getState().pendingTasks).toHaveLength(1);

      // Complete t1
      useBacktestStatusStore.getState().completeTask('t1', 'completed');

      // t2 should now be running
      const tasks = useBacktestStatusStore.getState().runningTasks;
      const t2 = tasks.find((t) => t.taskId === 't2');
      expect(t2?.status).toBe('running');
      expect(useBacktestStatusStore.getState().pendingTasks).toHaveLength(0);
    });

    it('should mark failed task without setting progress to 100', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().updateProgress('t1', 30);
      useBacktestStatusStore.getState().completeTask('t1', 'failed');

      const task = useBacktestStatusStore.getState().runningTasks[0];
      expect(task.status).toBe('failed');
      expect(task.progress).toBe(30);
    });
  });

  // =========================================================================
  // Cancel
  // =========================================================================

  describe('cancelTask', () => {
    it('should cancel a running task', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().cancelTask('t1');

      const task = useBacktestStatusStore.getState().runningTasks[0];
      expect(task.status).toBe('cancelled');
    });

    it('should remove pending task from queue', () => {
      useBacktestStatusStore.getState().setMaxParallelTasks(1);
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().enqueue(makeTask('t2'));

      useBacktestStatusStore.getState().cancelTask('t2');
      expect(useBacktestStatusStore.getState().pendingTasks).toHaveLength(0);
    });
  });

  describe('cancelAll', () => {
    it('should cancel all running and pending tasks', () => {
      useBacktestStatusStore.getState().setMaxParallelTasks(1);
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().enqueue(makeTask('t2'));
      useBacktestStatusStore.getState().enqueue(makeTask('t3'));

      useBacktestStatusStore.getState().cancelAll();

      const state = useBacktestStatusStore.getState();
      expect(state.pendingTasks).toHaveLength(0);
      // Running task should be cancelled
      const cancelled = state.runningTasks.filter((t) => t.status === 'cancelled');
      expect(cancelled.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Tab Management (TICKET_239)
  // =========================================================================

  describe('tab management', () => {
    it('should switch active tab', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().enqueue(makeTask('t2'));

      useBacktestStatusStore.getState().switchTab('t1');
      expect(useBacktestStatusStore.getState().activeTabId).toBe('t1');
    });

    it('should close tab and remove task/results', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().enqueue(makeTask('t2'));
      useBacktestStatusStore.getState().completeTask('t1', 'completed');

      useBacktestStatusStore.getState().closeTab('t1');
      const state = useBacktestStatusStore.getState();
      expect(state.runningTasks.find((t) => t.taskId === 't1')).toBeUndefined();
      expect(state.taskResults['t1']).toBeUndefined();
    });

    it('should create preparing tab (TICKET_352_5)', () => {
      useBacktestStatusStore.getState().createPreparingTab({ taskId: 't1', strategyName: 'Test' });

      const state = useBacktestStatusStore.getState();
      expect(state.runningTasks).toHaveLength(1);
      expect(state.runningTasks[0].status).toBe('preparing');
      expect(state.activeTabId).toBe('t1');
    });

    it('should clear active tab', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      expect(useBacktestStatusStore.getState().activeTabId).toBe('t1');

      useBacktestStatusStore.getState().clearActiveTab();
      expect(useBacktestStatusStore.getState().activeTabId).toBeNull();
    });
  });

  // =========================================================================
  // Task Results
  // =========================================================================

  describe('task results', () => {
    it('should set task result', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      const mockResult = {
        success: true,
        startTime: 0,
        endTime: 1,
        executionTimeMs: 1000,
        metrics: {} as any,
        equityCurve: [],
        trades: [],
        candles: [],
      };
      useBacktestStatusStore.getState().setTaskResult('t1', mockResult);
      expect(useBacktestStatusStore.getState().taskResults['t1'].result).toBe(mockResult);
    });

    it('should set task execution state', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().setTaskExecutionState('t1', { processedBars: 500, totalBars: 1000 });

      const execState = useBacktestStatusStore.getState().taskResults['t1'].executionState;
      expect(execState.processedBars).toBe(500);
      expect(execState.totalBars).toBe(1000);
    });

    it('should set task error (TICKET_296)', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().setTaskError('t1', 'Strategy crashed');

      expect(useBacktestStatusStore.getState().taskResults['t1'].errorMessage).toBe('Strategy crashed');
    });
  });

  // =========================================================================
  // Pipeline Progress (TICKET_321)
  // =========================================================================

  describe('pipeline progress', () => {
    it('should set pipeline phase', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().setTaskPipelinePhase('t1', 'downloading', 'Fetching data...');

      const pp = useBacktestStatusStore.getState().taskResults['t1'].pipelineProgress;
      expect(pp.phase).toBe('downloading');
      expect(pp.message).toBe('Fetching data...');
    });

    it('should set pipeline progress', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().setTaskPipelineProgress('t1', 0.75);

      expect(useBacktestStatusStore.getState().taskResults['t1'].pipelineProgress.progress).toBe(0.75);
    });

    it('should set pipeline message (TICKET_387_P2)', () => {
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().setTaskPipelineMessage('t1', 'Processing chunk 3/10');

      expect(useBacktestStatusStore.getState().taskResults['t1'].pipelineProgress.message).toBe(
        'Processing chunk 3/10'
      );
    });
  });

  // =========================================================================
  // Data Download (TICKET_077_P1)
  // =========================================================================

  describe('data download', () => {
    it('should set data download state', () => {
      useBacktestStatusStore.getState().setDataDownload({
        phase: 'downloading',
        progress: 50,
        symbol: 'AAPL',
      });

      const dl = useBacktestStatusStore.getState().dataDownload;
      expect(dl.phase).toBe('downloading');
      expect(dl.progress).toBe(50);
      expect(dl.symbol).toBe('AAPL');
    });

    it('should reset data download state', () => {
      useBacktestStatusStore.getState().setDataDownload({ phase: 'downloading', progress: 50 });
      useBacktestStatusStore.getState().resetDataDownload();

      const dl = useBacktestStatusStore.getState().dataDownload;
      expect(dl.phase).toBe('idle');
      expect(dl.progress).toBe(0);
    });
  });

  // =========================================================================
  // Queue Dialog
  // =========================================================================

  describe('queue dialog', () => {
    it('should open queue dialog', () => {
      useBacktestStatusStore.getState().openQueueDialog();
      expect(useBacktestStatusStore.getState().isQueueDialogOpen).toBe(true);
    });

    it('should close queue dialog', () => {
      useBacktestStatusStore.getState().openQueueDialog();
      useBacktestStatusStore.getState().closeQueueDialog();
      expect(useBacktestStatusStore.getState().isQueueDialogOpen).toBe(false);
    });
  });

  // =========================================================================
  // Notifications (TICKET_357_1)
  // =========================================================================

  describe('notifications', () => {
    it('should clear notifications', () => {
      useBacktestStatusStore.setState({ cancelledTaskId: 't1', completedTaskId: 't2' });
      useBacktestStatusStore.getState().clearNotification();

      const state = useBacktestStatusStore.getState();
      expect(state.cancelledTaskId).toBeNull();
      expect(state.completedTaskId).toBeNull();
    });
  });

  // =========================================================================
  // Clear
  // =========================================================================

  describe('clear', () => {
    it('should reset legacy state (currentTask, pendingTasks, queueDialog)', () => {
      useBacktestStatusStore.getState().setMaxParallelTasks(1);
      useBacktestStatusStore.getState().enqueue(makeTask('t1'));
      useBacktestStatusStore.getState().enqueue(makeTask('t2'));
      useBacktestStatusStore.getState().openQueueDialog();
      useBacktestStatusStore.getState().clear();

      const state = useBacktestStatusStore.getState();
      expect(state.pendingTasks).toHaveLength(0);
      expect(state.currentTask).toBeNull();
      expect(state.isQueueDialogOpen).toBe(false);
    });
  });
});
