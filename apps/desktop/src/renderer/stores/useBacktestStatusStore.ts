/**
 * Global Backtest Status Store
 *
 * Manages global backtest execution state for status bar display.
 * Supports task queue for multiple backtest requests.
 *
 * @see TICKET_233 - Global Backtest Status and Notification System
 * @see TICKET_234 - Independent Backtest Result Page
 */

import { create } from 'zustand';
import i18n from 'i18next';
import { PERSIST_DEBOUNCE_MS } from '@shared/constants/timing';
import { INTERVAL_1d } from '@shared/constants/intervals';
import { DEFAULT_INITIAL_CAPITAL } from '@shared/constants/trading';
import { PROVIDER_YFINANCE } from '@StratCraft/types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

// TICKET_352_5: 'preparing' = tab created with caller-generated ID, awaiting data download + executor start
export type BacktestTaskStatus = 'preparing' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** TICKET_257: Workflow stage timeframe configuration for result page display */
export interface WorkflowTimeframes {
  /** Market Analysis stage timeframe (null if disabled) */
  analysis: string | null;
  /** Entry Filter stage timeframe (null if disabled) */
  entryFilter: string | null;
  /** Entry Signal stage timeframe (null if disabled) */
  entrySignal: string | null;
  /** Exit Strategy stage timeframe (null if disabled) */
  exitStrategy: string | null;
}

/** TICKET_268: Component export data for Quant Lab signal source */
export interface ComponentExportData {
  algorithmId: string;
  algorithmName: string;
  algorithmCode: string;
  baseClass: string;
  timeframe: string;
  parameters: Record<string, unknown>;
}

/** TICKET_378: Backtest configuration summary for result page display */
export interface BacktestConfigSummary {
  dataSource: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  orderSize: number;
  orderSizeUnit: string;
}

/** TICKET_268: Workflow export data for Quant Lab signal source */
export interface WorkflowExportData {
  analysis: ComponentExportData;
  entry: ComponentExportData;
  exit?: ComponentExportData | null;
  symbol: string;
  dateRange: { start: string; end: string };
}

/** TICKET_410: Pipeline artifacts from dry run for actual run reuse */
export interface PipelineArtifacts {
  strategyPath: string;
  dataPath: string;
  dataFeeds?: Array<{ interval: string; dataPath: string }>;
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
  initialCapital: number;
  orderSize: number;
  orderSizeUnit: string;
  strategyName: string;
  strategyParams?: Record<string, unknown>;
}

/** TICKET_398: Dry run LLM call info */
export interface DryRunLlmCall {
  label: string;
  count: number;
}

/** TICKET_398: Dry run result containing LLM call estimates */
export interface DryRunResult {
  totalBars: number;
  llmCalls: DryRunLlmCall[];
  totalLlmCalls: number;
}

export interface BacktestTask {
  taskId: string;
  strategyName: string;
  progress: number; // 0-100
  status: BacktestTaskStatus;
  createdAt: number;
  /** TICKET_358: Timestamp of last tab access for LRU eviction */
  lastAccessedAt: number;
  /** TICKET_257: Workflow timeframes for result page display */
  workflowTimeframes?: WorkflowTimeframes;
  /** TICKET_268: Workflow export data for Quant Lab export */
  workflowExportData?: WorkflowExportData;
  /** TICKET_378: Backtest configuration summary for result page display */
  backtestConfig?: BacktestConfigSummary;
  /** TICKET_398: Whether this task is a dry run */
  isDryRun?: boolean;
  /** TICKET_398: Dry run LLM call estimation result */
  dryRunResult?: DryRunResult;
  /** TICKET_410: Pipeline artifacts for GO button reuse */
  pipelineArtifacts?: PipelineArtifacts;
  /** TICKET_886_7: nona_signal.id from auto-persist, for confirm button */
  autoPersistedSignalId?: number;
}

/** TICKET_358: Maximum number of result tabs before LRU eviction */
const MAX_RESULT_TABS = 10;

// TICKET_234: ExecutorResult types for global state
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

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** TICKET_398: Dry run info from C++ executor result */
export interface ExecutorDryRunInfo {
  isDryRun: boolean;
  totalBars: number;
  totalLlmCalls: number;
  llmCalls: DryRunLlmCall[];
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
  candles: Candle[];
  /** TICKET_398: Dry run info from executor */
  dryRunInfo?: ExecutorDryRunInfo;
}

// TICKET_234: Execution state for result page
export interface ExecutionState {
  isExecuting: boolean;
  currentCaseIndex: number;
  totalCases: number;
  executorProgress: number;
  processedBars: number;
  totalBars: number;
}

// TICKET_239: Per-task result storage
// TICKET_296: Added errorMessage for error propagation to UI
export interface TaskResultEntry {
  result: ExecutorResult | null;
  executionState: ExecutionState;
  errorMessage?: string;
  pipelineProgress: PipelineProgressState;
}

// TICKET_077_P1: Data download progress state
export type DownloadPhase = 'idle' | 'downloading' | 'caching' | 'multi_timeframe_loading' | 'complete' | 'error';

export interface DataDownloadState {
  phase: DownloadPhase;
  progress: number;
  message: string;
  symbol: string;
  currentChunk?: number;
  totalChunks?: number;
}

// TICKET_321: Pipeline progress state for full backtest lifecycle
// TICKET_384: Added 'generating' phase for Alpha Factory strategy code generation
export type PipelinePhase =
  | 'idle'
  | 'downloading'
  | 'generating'
  | 'spawning'
  | 'initializing'
  | 'loading_data'
  | 'backtesting'
  | 'finalizing'
  | 'complete'
  | 'error';

export interface PipelineProgressState {
  phase: PipelinePhase;
  progress: number;  // 0.0 ~ 1.0 (current phase progress)
  message: string;
}

interface BacktestStatusState {
  // State
  currentTask: BacktestTask | null; // Deprecated: use runningTasks[0] for compatibility
  pendingTasks: BacktestTask[];
  isQueueDialogOpen: boolean;

  // TICKET_239: Multi-backtest support
  runningTasks: BacktestTask[];
  taskResults: Record<string, TaskResultEntry>;
  activeTabId: string | null;
  maxParallelTasks: number;

  // TICKET_077_P1: Data download progress state
  dataDownload: DataDownloadState;

  // TICKET_359: Cache-aside loading state
  loadingTabIds: string[];

  // Actions
  // TICKET_238: Returns true if task started immediately, false if queued
  // TICKET_257: Include workflowTimeframes for result page display
  enqueue: (task: Omit<BacktestTask, 'status' | 'progress' | 'createdAt'>) => boolean;
  // TICKET_352_5: Optional metadata to merge when transitioning preparing -> running
  startTask: (taskId: string, metadata?: Partial<Pick<BacktestTask, 'workflowTimeframes' | 'workflowExportData' | 'backtestConfig'>>) => void;
  updateProgress: (taskId: string, progress: number) => void;
  completeTask: (taskId: string, status: 'completed' | 'failed' | 'cancelled') => void;
  cancelTask: (taskId: string) => void;
  cancelAll: () => void;
  removeFromQueue: (taskId: string) => void;
  startNext: () => void;
  clear: () => void;

  // TICKET_239: Tab management actions
  closeTab: (taskId: string) => void;
  switchTab: (taskId: string) => void;
  // TICKET_352_5: Create tab immediately with 'preparing' status (before async chain)
  // TICKET_398: Optional isDryRun flag
  createPreparingTab: (task: Pick<BacktestTask, 'taskId' | 'strategyName'> & { isDryRun?: boolean }) => void;
  // TICKET_352_5: Clear active tab to prevent stale flash on new backtest
  clearActiveTab: () => void;
  setMaxParallelTasks: (count: number) => void;
  setTaskResult: (taskId: string, resultOrUpdater: ExecutorResult | null | ((prev: ExecutorResult | null) => ExecutorResult | null)) => void;
  setTaskExecutionState: (taskId: string, state: Partial<ExecutionState>) => void;
  // TICKET_296: Store error message for failed tasks
  setTaskError: (taskId: string, errorMessage: string) => void;

  // TICKET_359: Cache-aside actions
  setTabLoading: (taskId: string, loading: boolean) => void;
  loadTaskResultFromDb: (taskId: string) => void;

  // TICKET_410: Save pipeline artifacts for dry run reuse
  setTaskPipelineArtifacts: (taskId: string, artifacts: PipelineArtifacts) => void;

  // TICKET_403: Atomic progress update (single set() instead of 3)
  batchProgressUpdate: (taskId: string, percent: number) => void;

  // TICKET_077_P1: Data download progress actions
  setDataDownload: (data: Partial<DataDownloadState>) => void;
  resetDataDownload: () => void;

  // TICKET_356: Per-task pipeline progress actions
  setTaskPipelinePhase: (taskId: string, phase: PipelinePhase, message?: string) => void;
  setTaskPipelineProgress: (taskId: string, progress: number) => void;
  // TICKET_387_P2: Update message within current phase (no phase transition)
  setTaskPipelineMessage: (taskId: string, message: string) => void;

  // TICKET_357_1: Notification fields for store-level event handling
  cancelledTaskId: string | null;
  completedTaskId: string | null;
  clearNotification: () => void;

  // TICKET_360 GAP-3: Tab persistence across app restart
  persistOpenTabs: () => void;
  restoreOpenTabs: () => Promise<void>;

  // TICKET_371: Cancelled/failed task persistence
  restoreTaskHistory: () => Promise<void>;

  // UI Actions
  openQueueDialog: () => void;
  closeQueueDialog: () => void;
}

// -----------------------------------------------------------------------------
// Store
// -----------------------------------------------------------------------------

// TICKET_234: Initial execution state
export const initialExecutionState: ExecutionState = {
  isExecuting: false,
  currentCaseIndex: 0,
  totalCases: 0,
  executorProgress: 0,
  processedBars: 0,
  totalBars: 0,
};

// TICKET_077_P1: Initial data download state
const initialDataDownload: DataDownloadState = {
  phase: 'idle',
  progress: 0,
  message: '',
  symbol: '',
};

// TICKET_321: Initial pipeline progress state
export const initialPipelineProgress: PipelineProgressState = {
  phase: 'idle',
  progress: 0,
  message: '',
};

// TICKET_352 Phase 3: Default matches config.performance.maxBacktestTasks default (3)
const DEFAULT_MAX_PARALLEL_TASKS = 3;

/**
 * TICKET_358: LRU eviction helper.
 * If runningTasks.length >= MAX_RESULT_TABS, evicts the oldest completed/failed tab
 * by lastAccessedAt. Returns partial state with updated runningTasks and taskResults.
 * Never evicts running/preparing/pending tabs.
 */
function evictOldestIfNeeded(state: Pick<BacktestStatusState, 'runningTasks' | 'taskResults' | 'maxParallelTasks'>): Pick<BacktestStatusState, 'runningTasks' | 'taskResults' | 'maxParallelTasks'> {
  if (state.runningTasks.length < MAX_RESULT_TABS) return state;

  // Find evictable tasks (completed or failed only)
  const evictable = state.runningTasks.filter(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
  );
  if (evictable.length === 0) return state; // All active, allow temporary overflow

  // Find oldest by lastAccessedAt
  let oldest = evictable[0];
  for (let i = 1; i < evictable.length; i++) {
    if (evictable[i].lastAccessedAt < oldest.lastAccessedAt) {
      oldest = evictable[i];
    }
  }

  const newRunningTasks = state.runningTasks.filter((t) => t.taskId !== oldest.taskId);
  const newTaskResults = { ...state.taskResults };
  delete newTaskResults[oldest.taskId];

  return { runningTasks: newRunningTasks, taskResults: newTaskResults, maxParallelTasks: state.maxParallelTasks };
}

export const useBacktestStatusStore = create<BacktestStatusState>((set, get) => ({
  // Initial state
  currentTask: null, // Deprecated: maintained for compatibility
  pendingTasks: [],
  isQueueDialogOpen: false,

  // TICKET_239: Multi-backtest state
  runningTasks: [],
  taskResults: {},
  activeTabId: null,
  maxParallelTasks: DEFAULT_MAX_PARALLEL_TASKS,

  // TICKET_077_P1: Initial data download state
  dataDownload: initialDataDownload,

  // TICKET_359: Cache-aside loading state
  loadingTabIds: [],

  // TICKET_357_1: Notification fields
  cancelledTaskId: null,
  completedTaskId: null,
  clearNotification: () => set({ cancelledTaskId: null, completedTaskId: null }),

  // Add task to queue
  // TICKET_238: Returns true if task started immediately, false if queued
  // TICKET_239: Support parallel execution with configurable limit
  enqueue: (task) => {
    const now = Date.now();
    const newTask: BacktestTask = {
      ...task,
      status: 'pending',
      progress: 0,
      createdAt: now,
      lastAccessedAt: now,
    };

    // TICKET_238: Track whether task starts immediately (atomic with state check)
    let startedImmediately = false;

    set((state) => {
      // TICKET_358: Evict oldest completed/failed tab if at capacity
      const evicted = evictOldestIfNeeded(state);

      // TICKET_239: Check against parallel limit
      // TICKET_352_5: Only count actively running tasks (not completed/failed ones kept for tab display)
      const activeRunningCount = evicted.runningTasks.filter((t) => t.status === 'running').length;
      if (activeRunningCount < evicted.maxParallelTasks) {
        startedImmediately = true;
        const runningTask: BacktestTask = { ...newTask, status: 'running' };
        // Initialize task result entry
        const newTaskResults = {
          ...evicted.taskResults,
          [newTask.taskId]: {
            result: null,
            executionState: { ...initialExecutionState, isExecuting: true },
            pipelineProgress: initialPipelineProgress,
          },
        };
        return {
          runningTasks: [...evicted.runningTasks, runningTask],
          currentTask: evicted.runningTasks.length === 0 ? runningTask : state.currentTask, // Compatibility
          taskResults: newTaskResults,
          activeTabId: newTask.taskId, // Auto-focus new tab
        };
      }
      // Otherwise add to queue
      return {
        ...evicted,
        pendingTasks: [...state.pendingTasks, newTask],
      };
    });

    return startedImmediately;
  },

  // Start a specific task (set to running)
  // TICKET_352_5: Transition task from 'preparing' to 'running', merge optional metadata
  startTask: (taskId, metadata) => {
    set((state) => {
      const updatedRunningTasks = state.runningTasks.map((t) =>
        t.taskId === taskId ? { ...t, ...metadata, status: 'running' as const } : t
      );
      const updatedCurrentTask = state.currentTask?.taskId === taskId
        ? { ...state.currentTask, ...metadata, status: 'running' as const }
        : state.currentTask;
      return {
        runningTasks: updatedRunningTasks,
        currentTask: updatedCurrentTask,
      };
    });
  },

  // Update progress for a running task
  // TICKET_239: Support multiple running tasks
  updateProgress: (taskId, progress) => {
    set((state) => {
      const taskIndex = state.runningTasks.findIndex((t) => t.taskId === taskId);
      if (taskIndex >= 0) {
        const updatedTasks = [...state.runningTasks];
        updatedTasks[taskIndex] = { ...updatedTasks[taskIndex], progress };
        return {
          runningTasks: updatedTasks,
          currentTask: taskIndex === 0 ? updatedTasks[0] : state.currentTask, // Compatibility
        };
      }
      // Fallback for legacy currentTask
      if (state.currentTask?.taskId === taskId) {
        return {
          currentTask: { ...state.currentTask, progress },
        };
      }
      return state;
    });
  },

  // Complete a running task and optionally start next from queue
  // TICKET_239: Support multiple running tasks
  completeTask: (taskId, status) => {
    set((state) => {
      const taskIndex = state.runningTasks.findIndex((t) => t.taskId === taskId);
      if (taskIndex >= 0) {
        const completedTask = {
          ...state.runningTasks[taskIndex],
          status,
          progress: status === 'completed' ? 100 : state.runningTasks[taskIndex].progress,
        };

        // Update task in runningTasks (keep for tab display)
        const updatedRunningTasks = [...state.runningTasks];
        updatedRunningTasks[taskIndex] = completedTask;

        // Update task result execution state
        const taskResult = state.taskResults[taskId] || { result: null, executionState: initialExecutionState, pipelineProgress: initialPipelineProgress };
        const updatedTaskResults = {
          ...state.taskResults,
          [taskId]: {
            ...taskResult,
            executionState: { ...taskResult.executionState, isExecuting: false },
          },
        };

        // Check if we can start a pending task
        const runningCount = updatedRunningTasks.filter((t) => t.status === 'running').length;
        let newPendingTasks = state.pendingTasks;
        let newActiveTabId = state.activeTabId;

        if (runningCount < state.maxParallelTasks && state.pendingTasks.length > 0) {
          const [nextTask, ...remainingTasks] = state.pendingTasks;
          const startedTask: BacktestTask = { ...nextTask, status: 'running', lastAccessedAt: Date.now() };
          updatedRunningTasks.push(startedTask);
          newPendingTasks = remainingTasks;
          newActiveTabId = nextTask.taskId; // Auto-focus new tab
          // Initialize task result for new task
          updatedTaskResults[nextTask.taskId] = {
            result: null,
            executionState: { ...initialExecutionState, isExecuting: true },
            pipelineProgress: initialPipelineProgress,
          };
        }

        return {
          runningTasks: updatedRunningTasks,
          taskResults: updatedTaskResults,
          pendingTasks: newPendingTasks,
          activeTabId: newActiveTabId,
          currentTask: updatedRunningTasks[0] || null, // Compatibility
        };
      }

      // Fallback for legacy currentTask
      if (state.currentTask?.taskId === taskId) {
        const completedTask = { ...state.currentTask, status, progress: status === 'completed' ? 100 : state.currentTask.progress };

        if (state.pendingTasks.length > 0) {
          const [nextTask, ...remainingTasks] = state.pendingTasks;
          return {
            currentTask: { ...nextTask, status: 'running' },
            pendingTasks: remainingTasks,
          };
        }

        return {
          currentTask: null,
          pendingTasks: [],
        };
      }
      return state;
    });
  },

  // Cancel specific task
  // TICKET_239: Support multiple running tasks
  cancelTask: (taskId) => {
    const { runningTasks, completeTask, removeFromQueue } = get();

    const isRunning = runningTasks.some((t) => t.taskId === taskId);
    if (isRunning) {
      // Cancel running task
      completeTask(taskId, 'cancelled');
    } else {
      // Remove from pending queue
      removeFromQueue(taskId);
    }
  },

  // Cancel all tasks
  // TICKET_239: Support multiple running tasks
  cancelAll: () => {
    set((state) => ({
      currentTask: null,
      pendingTasks: [],
      runningTasks: state.runningTasks.map((t) => ({ ...t, status: 'cancelled' as const })),
    }));
  },

  // Remove task from pending queue
  removeFromQueue: (taskId) => {
    set((state) => ({
      pendingTasks: state.pendingTasks.filter((t) => t.taskId !== taskId),
    }));
  },

  // Start next task in queue
  startNext: () => {
    set((state) => {
      if (state.currentTask || state.pendingTasks.length === 0) {
        return state;
      }
      const [nextTask, ...remainingTasks] = state.pendingTasks;
      return {
        currentTask: { ...nextTask, status: 'running' },
        pendingTasks: remainingTasks,
      };
    });
  },

  // Clear all state
  clear: () => {
    set({
      currentTask: null,
      pendingTasks: [],
      isQueueDialogOpen: false,
    });
  },

  // TICKET_239: Tab management actions
  // TICKET_361: Unified close -- remove tab from runningTasks (results persisted in SQLite)
  closeTab: (taskId) => {
    // TICKET_400: Clean up Worker state for this task
    _accumulatorWorker?.postMessage({ type: 'DESTROY_TASK', taskId });

    // TICKET_371: Delete cancelled/failed task from history DB on tab close
    const closingTask = get().runningTasks.find((t) => t.taskId === taskId);
    if (closingTask && (closingTask.status === 'cancelled' || closingTask.status === 'failed')) {
      const api = (window as any).electronAPI?.executor;
      if (api?.deleteTaskHistory) {
        api.deleteTaskHistory(taskId).catch((err: unknown) => {
        console.error('[E:BACKTEST:HISTORY_DELETE_FAILED] Failed to delete task history:', err);
        });
      }
    }

    set((state) => {
      const newRunningTasks = state.runningTasks.filter((t) => t.taskId !== taskId);
      const newTaskResults = { ...state.taskResults };
      delete newTaskResults[taskId];
      let newActiveTabId = state.activeTabId;
      if (state.activeTabId === taskId) {
        const closedIndex = state.runningTasks.findIndex((t) => t.taskId === taskId);
        if (newRunningTasks.length > 0) {
          const newIndex = Math.min(closedIndex, newRunningTasks.length - 1);
          newActiveTabId = newRunningTasks[newIndex]?.taskId || null;
        } else {
          newActiveTabId = null;
        }
      }
      return {
        runningTasks: newRunningTasks,
        taskResults: newTaskResults,
        activeTabId: newActiveTabId,
        currentTask: newRunningTasks[0] || null,
      };
    });
  },

  // TICKET_359: Cache-aside -- detect cache miss and trigger async DB load
  switchTab: (taskId) => {
    const state = get();
    const task = state.runningTasks.find((t) => t.taskId === taskId);
    const hasCachedResult = !!state.taskResults[taskId];
    const isCompletedLike = task && ['completed', 'failed', 'cancelled'].includes(task.status);

    // Synchronous: set activeTabId + lastAccessedAt
    set((s) => ({
      activeTabId: taskId,
      // TICKET_358: Update lastAccessedAt for LRU eviction
      runningTasks: s.runningTasks.map((t) =>
        t.taskId === taskId ? { ...t, lastAccessedAt: Date.now() } : t
      ),
    }));

    // Async: cache miss on completed task -> load from DB
    if (!hasCachedResult && isCompletedLike && !state.loadingTabIds.includes(taskId)) {
      get().loadTaskResultFromDb(taskId);
    }
  },

  // TICKET_352_5: Clear active tab AND legacy fallback fields to prevent stale result flash.
  // When activeTabId is null, BacktestResultPage falls back to legacy currentResult/executionState.
  // These must also be cleared to avoid displaying the previous backtest's data.
  // TICKET_352_5: Create tab immediately with 'preparing' status (caller-generated ID)
  createPreparingTab: (task) => {
    const now = Date.now();
    const preparingTask: BacktestTask = {
      taskId: task.taskId,
      strategyName: task.strategyName,
      status: 'preparing',
      progress: 0,
      createdAt: now,
      lastAccessedAt: now,
      isDryRun: task.isDryRun,
    };
    set((state) => {
      // TICKET_358: Evict oldest completed/failed tab if at capacity
      const evicted = evictOldestIfNeeded(state);
      return {
        runningTasks: [...evicted.runningTasks, preparingTask],
        activeTabId: task.taskId,
        // Initialize task result entry
        taskResults: {
          ...evicted.taskResults,
          [task.taskId]: {
            result: null,
            executionState: { ...initialExecutionState, isExecuting: true },
            // i18n key; BacktestResultPage translates via tErrors() before render
            pipelineProgress: { phase: 'downloading', progress: 0, message: 'MSG_BACKTEST_PREPARING_DATA_DOWNLOAD' },
          },
        },
      };
    });
  },

  clearActiveTab: () => {
    set({
      activeTabId: null,
    });
  },

  setMaxParallelTasks: (count) => {
    set({ maxParallelTasks: Math.max(1, Math.min(32, count)) }); // Clamp 1-32 (matches Settings UI range)
  },

  setTaskResult: (taskId, resultOrUpdater) => {
    set((state) => {
      const existing = state.taskResults[taskId] || { result: null, executionState: initialExecutionState, pipelineProgress: initialPipelineProgress };
      const newResult = typeof resultOrUpdater === 'function'
        ? resultOrUpdater(existing.result)
        : resultOrUpdater;
      return {
        taskResults: {
          ...state.taskResults,
          [taskId]: { ...existing, result: newResult },
        },
      };
    });
  },

  setTaskExecutionState: (taskId, newState) => {
    set((state) => {
      const existing = state.taskResults[taskId] || { result: null, executionState: initialExecutionState, pipelineProgress: initialPipelineProgress };
      return {
        taskResults: {
          ...state.taskResults,
          [taskId]: {
            ...existing,
            executionState: { ...existing.executionState, ...newState },
          },
        },
      };
    });
  },

  // TICKET_403: Atomic progress update - single set() for executorProgress + runningTasks + pipelineProgress
  batchProgressUpdate: (taskId, percent) => {
    set((state) => {
      const existing = state.taskResults[taskId] || { result: null, executionState: initialExecutionState, pipelineProgress: initialPipelineProgress };
      const updatedTaskResults = {
        ...state.taskResults,
        [taskId]: {
          ...existing,
          executionState: { ...existing.executionState, executorProgress: percent },
          pipelineProgress: { ...existing.pipelineProgress, progress: percent / 100 },
        },
      };

      const taskIndex = state.runningTasks.findIndex((t) => t.taskId === taskId);
      let updatedRunningTasks = state.runningTasks;
      let updatedCurrentTask = state.currentTask;
      if (taskIndex >= 0) {
        updatedRunningTasks = [...state.runningTasks];
        updatedRunningTasks[taskIndex] = { ...updatedRunningTasks[taskIndex], progress: percent };
        if (taskIndex === 0) updatedCurrentTask = updatedRunningTasks[0];
      } else if (state.currentTask?.taskId === taskId) {
        updatedCurrentTask = { ...state.currentTask, progress: percent };
      }

      return {
        taskResults: updatedTaskResults,
        runningTasks: updatedRunningTasks,
        currentTask: updatedCurrentTask,
      };
    });
  },

  // TICKET_296: Store error message for failed tasks
  setTaskError: (taskId, errorMessage) => {
    set((state) => {
      const existing = state.taskResults[taskId] || { result: null, executionState: initialExecutionState, pipelineProgress: initialPipelineProgress };
      return {
        taskResults: {
          ...state.taskResults,
          [taskId]: {
            ...existing,
            errorMessage,
            executionState: { ...existing.executionState, isExecuting: false },
          },
        },
      };
    });
  },

  // TICKET_410: Save pipeline artifacts for dry run reuse
  setTaskPipelineArtifacts: (taskId, artifacts) => {
    set((state) => ({
      runningTasks: state.runningTasks.map((t) =>
        t.taskId === taskId ? { ...t, pipelineArtifacts: artifacts } : t
      ),
    }));
  },

  // TICKET_359: Cache-aside loading helpers
  setTabLoading: (taskId, loading) => {
    set((state) => ({
      loadingTabIds: loading
        ? [...state.loadingTabIds, taskId]
        : state.loadingTabIds.filter((id) => id !== taskId),
    }));
  },

  loadTaskResultFromDb: async (taskId) => {
    const { setTabLoading } = get();
    setTabLoading(taskId, true);

    try {
      const api = (window as any).electronAPI?.executor;
      if (!api?.getHistoryResult) {
        console.warn('[W:BACKTEST:API_NOT_AVAILABLE] getHistoryResult API not available');
        return;
      }

      const response = await api.getHistoryResult(taskId);
      if (response.success && response.data) {
        const record = response.data;
        // Transform BacktestResultRecord -> TaskResultEntry (same mapping as BacktestPage.tsx:416-435)
        const result: ExecutorResult = {
          success: true,
          startTime: record.start_date ? new Date(record.start_date).getTime() : 0,
          endTime: record.end_date ? new Date(record.end_date).getTime() : 0,
          executionTimeMs: record.execution_time_ms ?? 0,
          metrics: {
            totalPnl: record.total_pnl ?? 0,
            totalReturn: record.total_return ?? 0,
            sharpeRatio: record.sharpe_ratio ?? 0,
            maxDrawdown: record.max_drawdown ?? 0,
            winRate: record.win_rate ?? 0,
            profitFactor: record.profit_factor ?? 0,
            totalTrades: record.total_trades ?? 0,
            winningTrades: record.winning_trades ?? 0,
            losingTrades: record.losing_trades ?? 0,
          },
          trades: record.trades_json ? JSON.parse(record.trades_json) : [],
          equityCurve: record.equity_curve_json ? JSON.parse(record.equity_curve_json) : [],
          candles: [],
        };

        // Populate taskResults cache (candles empty initially, re-fetched below)
        set((state) => ({
          taskResults: {
            ...state.taskResults,
            [taskId]: {
              result,
              executionState: { ...initialExecutionState, isExecuting: false },
              pipelineProgress: { phase: 'complete' as const, progress: 1.0, message: '' },
            },
          },
        }));

        // TICKET_360_1: Re-fetch candles from parquet cache
        if (record.symbol && record.timeframe && record.start_date && record.end_date) {
          try {
            const candleResponse = await api.fetchCandles({
              symbol: record.symbol,
              interval: record.timeframe,
              startDate: record.start_date.split('T')[0],
              endDate: record.end_date.split('T')[0],
              dataPath: (record as Record<string, unknown>).data_path as string | undefined,
            });
            if (candleResponse.success && candleResponse.candles.length > 0) {
              const candles = candleResponse.candles as Candle[];
              const currentEntry = get().taskResults[taskId];
              if (currentEntry?.result) {
                const updatedResult: ExecutorResult = { ...currentEntry.result, candles };
                set({
                  taskResults: {
                    ...get().taskResults,
                    [taskId]: {
                      ...currentEntry,
                      result: updatedResult,
                    },
                  },
                });
              }
            }
          } catch (err) {
            console.warn('[W:BACKTEST:CANDLE_REFETCH_FAILED] Failed to re-fetch candles:', err);
          }
        }
      } else {
        console.warn('[W:BACKTEST:HISTORY_LOAD_FAILED] Failed to load result from DB:', response.error);
      }
    } catch (error) {
      console.error('[E:BACKTEST:HISTORY_LOAD_ERROR] Error loading result from DB:', error);
    } finally {
      get().setTabLoading(taskId, false);
    }
  },

  // TICKET_077_P1: Data download progress actions
  setDataDownload: (data) => set((state) => ({
    dataDownload: { ...state.dataDownload, ...data },
  })),

  resetDataDownload: () => set({ dataDownload: initialDataDownload }),

  // TICKET_356: Per-task pipeline progress actions
  // TICKET_384: Auto-create entry if missing (AF tasks arrive via executor events before explicit registration)
  setTaskPipelinePhase: (taskId, phase, message) => {
    set((state) => {
      const existing = state.taskResults[taskId] || { result: null, executionState: initialExecutionState, pipelineProgress: initialPipelineProgress };
      return {
        taskResults: {
          ...state.taskResults,
          [taskId]: {
            ...existing,
            pipelineProgress: { phase, progress: 0, message: message || '' },
          },
        },
      };
    });
  },

  // TICKET_384: Auto-create entry if missing
  setTaskPipelineProgress: (taskId, progress) => {
    set((state) => {
      const existing = state.taskResults[taskId] || { result: null, executionState: initialExecutionState, pipelineProgress: initialPipelineProgress };
      return {
        taskResults: {
          ...state.taskResults,
          [taskId]: {
            ...existing,
            pipelineProgress: { ...existing.pipelineProgress, progress },
          },
        },
      };
    });
  },

  // TICKET_387_P2: Update message within current phase (no phase transition)
  setTaskPipelineMessage: (taskId, message) => {
    set((state) => {
      const existing = state.taskResults[taskId] || { result: null, executionState: initialExecutionState, pipelineProgress: initialPipelineProgress };
      return {
        taskResults: {
          ...state.taskResults,
          [taskId]: {
            ...existing,
            pipelineProgress: { ...existing.pipelineProgress, message },
          },
        },
      };
    });
  },

  // TICKET_360 GAP-3: Persist open tabs to DB (debounced call from tab mutation actions)
  persistOpenTabs: () => {
    const { runningTasks, activeTabId } = get();
    // TICKET_360_3: Only persist completed tabs (only completed tasks have desktop_backtest_results rows for FK)
    const completedTabs = runningTasks.filter(
      (t) => t.status === 'completed'
    );
    const payload = completedTabs.map((t) => ({
      taskId: t.taskId,
      strategyName: t.strategyName,
      isActive: t.taskId === activeTabId,
      lastAccessedAt: t.lastAccessedAt,
    }));
    const api = (window as any).electronAPI?.executor;
    if (api?.saveOpenTabs) {
      api.saveOpenTabs(payload).catch((err: unknown) => {
        console.error('[E:BACKTEST:TABS_PERSIST_FAILED] Failed to persist open tabs:', err);
      });
    }
  },

  // TICKET_360 GAP-3: Restore open tabs from DB on app startup
  restoreOpenTabs: async () => {
    const api = (window as any).electronAPI?.executor;
    if (!api?.loadOpenTabs) return;

    try {
      const response = await api.loadOpenTabs();
      if (!response.success || !response.data || response.data.length === 0) return;

      const tabs = response.data;
      const activeTab = tabs.find((t: { is_active: number }) => t.is_active === 1);
      const now = Date.now();

      const restoredTasks: BacktestTask[] = tabs.map((t: { task_id: string; strategy_name: string; last_accessed_at: number }) => ({
        taskId: t.task_id,
        strategyName: t.strategy_name,
        status: 'completed' as const,
        progress: 100,
        createdAt: t.last_accessed_at,
        lastAccessedAt: t.last_accessed_at || now,
      }));

      set({
        runningTasks: restoredTasks,
        activeTabId: activeTab?.task_id || restoredTasks[restoredTasks.length - 1]?.taskId || null,
      });

      // Trigger cache-aside load for active tab
      if (activeTab) {
        get().loadTaskResultFromDb(activeTab.task_id);
      }
    } catch (error) {
      console.error('[E:BACKTEST:TABS_RESTORE_FAILED] Failed to restore open tabs:', error);
    }
  },

  // TICKET_371: Restore cancelled/failed tasks from DB on app startup
  restoreTaskHistory: async () => {
    const api = (window as any).electronAPI?.executor;
    if (!api?.loadTaskHistory) return;

    try {
      const response = await api.loadTaskHistory();
      if (!response.success || !response.data || response.data.length === 0) return;

      const existing = get().runningTasks;
      const existingIds = new Set(existing.map((t: BacktestTask) => t.taskId));
      const now = Date.now();

      // Filter out tasks already restored by restoreOpenTabs
      const newTasks: BacktestTask[] = response.data
        .filter((t: { task_id: string }) => !existingIds.has(t.task_id))
        .map((t: { task_id: string; strategy_name: string; status: string; error_message: string | null; created_at: number; finished_at: number }) => ({
          taskId: t.task_id,
          strategyName: t.strategy_name,
          status: t.status as BacktestTaskStatus,
          progress: 0,
          createdAt: t.created_at,
          lastAccessedAt: t.finished_at || now,
          errorMessage: t.error_message || undefined,
        }));

      if (newTasks.length === 0) return;

      set((state) => ({
        runningTasks: [...state.runningTasks, ...newTasks],
      }));
    } catch (error) {
      console.error('[E:BACKTEST:HISTORY_RESTORE_FAILED] Failed to restore task history:', error);
    }
  },

  // UI Actions
  openQueueDialog: () => set({ isQueueDialogOpen: true }),
  closeQueueDialog: () => set({ isQueueDialogOpen: false }),
}));

// -----------------------------------------------------------------------------
// TICKET_357_1: Module-scope executor event subscriptions
// Persists across component mount/unmount cycles.
// Uses init() pattern (like useDownloadQueueStore) because window.electronAPI
// must be available at call time.
// -----------------------------------------------------------------------------

type IncrementData = {
  taskId?: string;
  newCandles?: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>;
  newEquityPoints?: Array<{ timestamp: number; equity: number; drawdown: number }>;
  newTrades?: Array<Record<string, unknown>>;
  currentMetrics?: Record<string, number>;
  processedBars?: number;
  totalBars?: number;
};

let _subscriptionsInitialized = false;
const _completedTasks = new Set<string>();
const _pendingAutoPersist = new Set<string>();
// TICKET_400: Module-scope worker reference for tab close cleanup
let _accumulatorWorker: Worker | null = null;

export function initExecutorSubscriptions(): void {
  if (_subscriptionsInitialized) return;
  _subscriptionsInitialized = true;

  const executorApi = (window as any).electronAPI?.executor;
  const dataApi = (window as any).electronAPI?.data;
  if (!executorApi) return;

  const store = useBacktestStatusStore;

  // TICKET_360 GAP-3: Restore open tabs from previous session
  // TICKET_371: Chain restoreTaskHistory AFTER restoreOpenTabs to avoid race condition
  // (restoreOpenTabs overwrites runningTasks; restoreTaskHistory appends to it)
  store.getState().restoreOpenTabs().then(() => {
    store.getState().restoreTaskHistory();
  });

  // TICKET_400: Web Worker for offloaded data accumulation + downsampling
  const worker = new Worker(
    new URL('../workers/backtest-accumulator.worker.ts', import.meta.url),
    { type: 'module' }
  );
  _accumulatorWorker = worker;

  // TICKET_400: Worker -> Main message handler
  worker.onmessage = (e: MessageEvent<import('../workers/backtest-accumulator.protocol').WorkerToMainMessage>) => {
    const msg = e.data;
    const { setTaskResult, setTaskExecutionState } = store.getState();

    switch (msg.type) {
      case 'RENDER_UPDATE': {
        const { taskId, payload } = msg;
        if (_completedTasks.has(taskId)) break;

        // Direct set (not updater) - Worker already produced render-ready data
        setTaskResult(taskId, {
          success: true,
          startTime: 0,
          endTime: 0,
          executionTimeMs: 0,
          metrics: payload.metrics || {
            totalPnl: 0, totalReturn: 0, sharpeRatio: 0, maxDrawdown: 0,
            totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, profitFactor: 0,
          },
          equityCurve: payload.equityCurve,
          trades: payload.trades,
          candles: payload.candles,
        } as ExecutorResult);

        setTaskExecutionState(taskId, {
          processedBars: payload.processedBars,
          totalBars: payload.totalBars,
        });
        break;
      }

      case 'FULL_DATA': {
        const { taskId, payload } = msg;
        // Replace store arrays with full-resolution data for DB persistence
        setTaskResult(taskId, (prev: ExecutorResult | null) => {
          if (!prev) return prev;
          return {
            ...prev,
            equityCurve: payload.equityCurve,
            candles: payload.candles,
            trades: payload.trades,
          };
        });

        // TICKET_886_6: Worker has flushed full-resolution data; fire auto-persist now.
        if (_pendingAutoPersist.delete(taskId)) {
          const fullResult = store.getState().taskResults[taskId]?.result;
          const task = store.getState().runningTasks.find(t => t.taskId === taskId);
          const exportData = task?.workflowExportData;
          const backtestConfig = task?.backtestConfig;
          if (fullResult?.equityCurve?.length && fullResult?.candles?.length && fullResult?.metrics && exportData) {
            console.log(
              `[886_6] Sending auto-persist: trades=${fullResult.trades?.length ?? 0} equity=${fullResult.equityCurve.length} candles=${fullResult.candles.length}`,
            );
            const api = (window as any).electronAPI;
            api?.executor?.autoPersist?.({
              strategyName: task!.strategyName,
              components: {
                analysis: { code: exportData.analysis!.algorithmCode, algorithmName: exportData.analysis!.algorithmName },
                entry:    { code: exportData.entry!.algorithmCode, algorithmName: exportData.entry!.algorithmName },
                exit: exportData.exit ? { code: exportData.exit.algorithmCode, algorithmName: exportData.exit.algorithmName } : null,
              },
              builderMode: 'indicators',
              symbol: backtestConfig?.symbol ?? exportData.symbol,
              interval: INTERVAL_1d,
              dataProvider: backtestConfig?.dataSource ?? PROVIDER_YFINANCE,
              dateRangeStart: backtestConfig?.startDate ?? exportData.dateRange.start,
              dateRangeEnd: backtestConfig?.endDate ?? exportData.dateRange.end,
              initialCapital: backtestConfig?.initialCapital ?? DEFAULT_INITIAL_CAPITAL,
              trades: fullResult.trades ?? [],
              equityCurve: fullResult.equityCurve,
              candles: fullResult.candles,
              metrics: {
                sharpe: fullResult.metrics.sharpeRatio,
                maxDrawdown: fullResult.metrics.maxDrawdown,
                winRate: fullResult.metrics.winRate,
                totalTrades: fullResult.metrics.totalTrades,
                profitFactor: fullResult.metrics.profitFactor,
                totalReturn: fullResult.metrics.totalReturn,
              },
            }).then((res: { success: boolean; signalId?: number }) => {
              if (res?.success && res.signalId != null) {
                store.setState((prev) => ({
                  runningTasks: prev.runningTasks.map((rt) =>
                    rt.taskId === taskId
                      ? { ...rt, autoPersistedSignalId: res.signalId }
                      : rt,
                  ),
                }));
              }
            }).catch((err: unknown) => {
              console.warn('[W:BACKTEST:AUTO_PERSIST_FAILED] Auto-persist failed (non-fatal):', err);
            });
          }
        }
        break;
      }
    }
  };

  // --- onIncrement ---
  // TICKET_400: Forward to Worker for off-main-thread accumulation
  executorApi.onIncrement((data: { taskId?: string; increment: IncrementData }) => {
    const taskId = data.taskId || data.increment?.taskId || store.getState().activeTabId;
    if (!taskId || _completedTasks.has(taskId)) return;
    // TICKET_394: AF hook handles its own result accumulation via direct subscription;
    // backtest store must not duplicate candle/equity/trade data for AF tasks.
    if (taskId.startsWith('af_')) return;

    worker.postMessage({ type: 'INCREMENT', taskId, increment: data.increment });
  });

  // --- TICKET_398_2: onDryRunLlm (real-time LLM call counts from Python stdout) ---
  executorApi.onDryRunLlm?.((data: { taskId: string; dryRunLlm: { processedBars: number; totalBars: number; llmCalls: Array<{ label: string; count: number }>; totalLlmCalls: number } }) => {
    const { taskId, dryRunLlm } = data;
    if (!taskId || _completedTasks.has(taskId)) return;
    store.setState((state) => ({
      runningTasks: state.runningTasks.map((t) =>
        t.taskId === taskId
          ? {
              ...t,
              dryRunResult: {
                totalBars: dryRunLlm.processedBars,
                llmCalls: dryRunLlm.llmCalls,
                totalLlmCalls: dryRunLlm.totalLlmCalls,
              },
            }
          : t
      ),
    }));
  });

  // --- onCompleted (consolidated: result handling + pipeline) ---
  executorApi.onCompleted((data: { taskId?: string; result: unknown }) => {
    const taskId = data.taskId || store.getState().activeTabId;
    if (!taskId) return;
    // TICKET_394: AF hook handles its own completion; skip backtest store accumulation for AF tasks.
    if (taskId.startsWith('af_')) return;

    // TICKET_385: Trace timing - when renderer receives completed event
    const tReceived = Date.now();
    console.log('[TICKET_385_TRACE] renderer onCompleted received at', tReceived, 'taskId:', taskId);

    // TICKET_400: Tell Worker to flush remaining data and send FULL_DATA
    worker.postMessage({ type: 'COMPLETE', taskId });

    _completedTasks.add(taskId);

    const { setTaskResult, setTaskExecutionState, completeTask, setTaskPipelineProgress } = store.getState();

    // TICKET_338: C++ executor result is already camelCase matching ExecutorResult
    const convertedResult = data.result as ExecutorResult;

    // TICKET_398_DIAG: Log IPC payload dryRunInfo
    console.log('[TICKET_398_DIAG] onCompleted dryRunInfo:', JSON.stringify(convertedResult.dryRunInfo));

    // TICKET_398: If dry run, merge dryRunResult into the task
    if (convertedResult.dryRunInfo?.isDryRun) {
      store.setState((state) => ({
        runningTasks: state.runningTasks.map((t) =>
          t.taskId === taskId
            ? {
                ...t,
                isDryRun: true,
                dryRunResult: {
                  totalBars: convertedResult.dryRunInfo!.totalBars,
                  llmCalls: convertedResult.dryRunInfo!.llmCalls,
                  totalLlmCalls: convertedResult.dryRunInfo!.totalLlmCalls,
                },
              }
            : t
        ),
      }));
    }

    // TICKET_398_1: Lightweight payload -- merge metadata into existing incremental data
    setTaskResult(taskId, (prev: ExecutorResult | null) => {
      if (!prev) {
        // Edge case: no increments received (fast backtest or dry run)
        return {
          ...convertedResult,
          candles: convertedResult.candles || [],
          equityCurve: convertedResult.equityCurve || [],
          trades: convertedResult.trades || [],
        };
      }
      // Normal: keep incremental data, merge final metrics
      return {
        ...prev,
        success: convertedResult.success,
        errorMessage: convertedResult.errorMessage,
        startTime: convertedResult.startTime,
        endTime: convertedResult.endTime,
        executionTimeMs: convertedResult.executionTimeMs,
        metrics: convertedResult.metrics,
      };
    });

    // TICKET_398_1: Use stored result for totalBars since lightweight payload omits arrays
    const storedResult = store.getState().taskResults[taskId]?.result;
    const totalBars = storedResult?.equityCurve?.length || storedResult?.candles?.length || 0;
    setTaskExecutionState(taskId, { isExecuting: false, processedBars: totalBars, totalBars });

    // TICKET_354: Update task status in runningTasks so StatusBar indicator stops spinning
    completeTask(taskId, 'completed');

    // TICKET_886_6: Mark task for auto-persist; actual IPC fires from FULL_DATA
    // handler after Worker flushes full-resolution arrays into the store.
    // Firing here would race the Worker -- equityCurve/candles may still be empty.
    {
      const task = store.getState().runningTasks.find(t => t.taskId === taskId);
      const exportData = task?.workflowExportData;
      if (
        exportData?.analysis?.algorithmCode &&
        exportData?.entry?.algorithmCode &&
        !task?.isDryRun
      ) {
        _pendingAutoPersist.add(taskId);
      }
    }

    // TICKET_385: Pipeline completion - reduced delay to avoid lag after equity curve renders
    setTaskPipelineProgress(taskId, 1.0);
    store.getState().setTaskPipelinePhase(taskId, 'finalizing');
    setTimeout(() => {
      store.getState().setTaskPipelinePhase(taskId, 'complete');
    }, 500);

    // TICKET_357_1: Notification for UI reaction
    store.setState({ completedTaskId: taskId });
  });

  // --- onError (consolidated: error handling + pipeline) ---
  executorApi.onError((data: { taskId?: string; error: string }) => {
    const taskId = data.taskId || store.getState().activeTabId;
    // TICKET_384: Removed af_ skip - AF tasks now share pipeline
    console.error('[E:BACKTEST:EXECUTION_ERROR] Backtest error:', { taskId, error: data.error });

    if (taskId) {
      worker.postMessage({ type: 'DESTROY_TASK', taskId });
      const { setTaskError, completeTask, setTaskPipelinePhase } = store.getState();
      setTaskError(taskId, data.error || i18n.t('errors:MSG_UNKNOWN_ERROR'));
      // TICKET_354: Update task status in runningTasks so StatusBar indicator reflects failure
      completeTask(taskId, 'failed');
      setTaskPipelinePhase(taskId, 'error');
    }
  });

  // --- onCancelled ---
  executorApi.onCancelled((data: { taskId: string }) => {
    const taskId = data.taskId;
    // TICKET_384: Removed af_ skip - AF tasks now share pipeline
    console.info('[BacktestResultPage] Backtest cancelled:', { taskId });

    worker.postMessage({ type: 'DESTROY_TASK', taskId });
    const { setTaskExecutionState, completeTask, setTaskPipelinePhase } = store.getState();
    setTaskExecutionState(taskId, { isExecuting: false });
    // TICKET_368: Update task status in runningTasks so StatusBar reflects cancellation
    completeTask(taskId, 'cancelled');
    // TICKET_374: Keep pipeline at interrupted phase (do NOT set to 'complete')
    // so PipelineProgress can show which phase was cancelled in red

    // TICKET_357_1: Notification for UI reaction
    store.setState({ cancelledTaskId: taskId });
  });

  // --- onProgress (consolidated: execution state + pipeline) ---
  executorApi.onProgress((data: { taskId?: string; percent?: number }) => {
    const taskId = data.taskId || store.getState().activeTabId;
    // TICKET_384: Removed af_ skip - AF tasks now share pipeline
    if (typeof data?.percent === 'number' && taskId) {
      // TICKET_385: Trace when progress hits 100%
      if (data.percent >= 100) {
        console.log('[TICKET_385_TRACE] renderer onProgress 100% at', Date.now(), 'taskId:', taskId);
      }
      // TICKET_403: Single atomic set() to prevent re-render storm starving setInterval
      store.getState().batchProgressUpdate(taskId, data.percent);
    }
  });

  // --- onStarted ---
  executorApi.onStarted((data: { taskId?: string }) => {
    const taskId = data?.taskId || store.getState().activeTabId;
    // TICKET_384: Removed af_ skip - AF tasks now share pipeline
    if (taskId) store.getState().setTaskPipelinePhase(taskId, 'spawning');
  });

  // --- onPhase ---
  // TICKET_387_P2: Forward optional message for loading sub-step tooltip
  executorApi.onPhase?.((data: { taskId: string; phase: string; message?: string }) => {
    // TICKET_384: Removed af_ skip - AF tasks now share pipeline
    const phase = data.phase as 'initializing' | 'loading_data' | 'backtesting';
    if (data.message) {
      // Sub-step status update within current phase (no phase transition)
      store.getState().setTaskPipelineMessage(data.taskId, data.message);
    } else {
      // Phase transition
      store.getState().setTaskPipelinePhase(data.taskId, phase);
    }
  });

  // --- data.onProgress (download phase -> pipeline) ---
  if (dataApi?.onProgress) {
    dataApi.onProgress((_: unknown, data: {
      phase?: string;
      progress?: number;
      message?: string;
    }) => {
      if (!data) return;
      const taskId = store.getState().activeTabId;
      if (!taskId) return;

      if (data.phase === 'downloading' || data.phase === 'multi_timeframe_loading') {
        store.getState().setTaskPipelinePhase(taskId, 'downloading', data.message);
        if (typeof data.progress === 'number') {
          store.getState().setTaskPipelineProgress(taskId, data.progress);
        }
      } else if (data.phase === 'complete') {
        store.getState().setTaskPipelineProgress(taskId, 1.0);
      }
    });
  }
}

// -----------------------------------------------------------------------------
// TICKET_360 GAP-3: Auto-persist open tabs on state changes (debounced)
// -----------------------------------------------------------------------------

let _persistTimer: ReturnType<typeof setTimeout> | null = null;

let _prevRunningTasks: BacktestTask[] = [];
let _prevActiveTabId: string | null = null;

useBacktestStatusStore.subscribe((state) => {
  if (state.runningTasks === _prevRunningTasks && state.activeTabId === _prevActiveTabId) return;
  _prevRunningTasks = state.runningTasks;
  _prevActiveTabId = state.activeTabId;
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    useBacktestStatusStore.getState().persistOpenTabs();
  }, PERSIST_DEBOUNCE_MS);
});

// -----------------------------------------------------------------------------
// Selectors
// -----------------------------------------------------------------------------

export const selectQueueCount = (state: BacktestStatusState) => state.pendingTasks.length;
export const selectHasActiveTask = (state: BacktestStatusState) => state.currentTask !== null;
export const selectIsRunning = (state: BacktestStatusState) => state.currentTask?.status === 'running';

// TICKET_239: Multi-backtest selectors
export const selectRunningTasks = (state: BacktestStatusState) => state.runningTasks;
export const selectRunningCount = (state: BacktestStatusState) => state.runningTasks.filter((t) => t.status === 'running').length;
export const selectActiveTabId = (state: BacktestStatusState) => state.activeTabId;
export const selectMaxParallelTasks = (state: BacktestStatusState) => state.maxParallelTasks;
export const selectTaskResults = (state: BacktestStatusState) => state.taskResults;
export const selectActiveTaskResult = (state: BacktestStatusState) => {
  if (!state.activeTabId) return null;
  return state.taskResults[state.activeTabId] || null;
};
export const selectActiveTask = (state: BacktestStatusState) => {
  if (!state.activeTabId) return null;
  return state.runningTasks.find((t) => t.taskId === state.activeTabId) || null;
};

// TICKET_359: Cache-aside loading selector
export const selectLoadingTabIds = (state: BacktestStatusState) => state.loadingTabIds;

// TICKET_077_P1: Data download selector
export const selectDataDownload = (state: BacktestStatusState) => state.dataDownload;

