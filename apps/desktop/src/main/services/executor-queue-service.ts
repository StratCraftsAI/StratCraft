/**
 * Executor Queue Service
 *
 * TICKET_352: Executor Queue Service
 *
 * Phase 1: FIFO queue wrapper around ExecutorService.
 * Phase 2: Config-driven concurrency (reads performance.maxBacktestTasks),
 *          hardware-capped to (cpuCount - 1).
 *
 * Multiple callers (Backtest Plugin, Alpha Factory) enqueue tasks;
 * the queue processes them FIFO, forwarding executor events to renderer.
 *
 * Two-phase singleton pattern (same as data-download-queue.ts).
 */

import os from 'os';
import { randomUUID } from 'crypto';
import { sendToRenderer } from '../window';
import { createLogger } from '../utils/logger';
import { getExecutorService, type ExecutorConfig } from './executor-service';
export type { ExecutorConfig } from './executor-service';
import { getConfigService } from './config-service';
import { getDatabaseManager } from '../database/db-manager';
import { BacktestTaskHistoryService } from '../database/services/backtest-task-history-service';
import { FINISHED_TASK_RETENTION_MS } from '../../shared/constants/timing';
import { MIN_EXECUTOR_HARDWARE_CAP, MAX_QUEUE_DEPTH, QUEUE_WARNING_THRESHOLD_RATIO } from '../../shared/constants/hardware';

const queueLog = createLogger('EXECUTOR-QUEUE');

// =============================================================================
// Types
// =============================================================================

export interface QueuedTask {
  taskId: string;
  config: ExecutorConfig | null;
  status: 'preparing' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** taskId returned by ExecutorService.runBacktest() */
  executorTaskId?: string;
  createdAt: number;
  strategyName?: string;
  /** TICKET_371: Error message captured on failure for persistence */
  errorMessage?: string;
}

export interface QueueStatus {
  tasks: QueuedTask[];
  activeCount: number;
  queuedCount: number;
}

// FINISHED_TASK_RETENTION_MS imported from @shared/constants/timing

// =============================================================================
// Executor Queue Service
// =============================================================================

export interface ExecutorQueueOptions {
  /** IPC channel name for queue-status events (default: 'executor:queue-status') */
  queueStatusChannel?: string;
  /** Override hardware cap for testing (default: Math.max(MIN_EXECUTOR_HARDWARE_CAP, os.cpus().length)) */
  hardwareCap?: number;
}

export class ExecutorQueueService {
  private tasks: Map<string, QueuedTask> = new Map();
  private activeCount = 0;
  private maxConcurrent = 3;
  private hardwareCap: number;
  private queueStatusChannel: string;

  constructor(options?: ExecutorQueueOptions) {
    this.queueStatusChannel = options?.queueStatusChannel || 'executor:queue-status';
    this.hardwareCap = options?.hardwareCap ?? Math.max(MIN_EXECUTOR_HARDWARE_CAP, os.cpus().length);
  }

  /**
   * TICKET_366: Register a task in 'preparing' state before data download.
   * This allows cancel() to find the task during the download phase.
   * Idempotent -- calling twice with the same taskId is safe.
   * TICKET_641_2: Returns error if queue is at capacity.
   */
  registerPreparing(taskId: string, strategyName: string): { success: boolean; error?: string } {
    if (this.tasks.has(taskId)) {
      queueLog.debug(`[registerPreparing] taskId=${taskId} already exists, skipping`);
      return { success: true };
    }

    // TICKET_641_2: Reject if queue is at capacity
    const depthError = this.checkQueueDepth();
    if (depthError) {
      return { success: false, error: depthError };
    }

    const task: QueuedTask = {
      taskId,
      config: null,
      status: 'preparing',
      createdAt: Date.now(),
      strategyName,
    };
    this.tasks.set(taskId, task);
    queueLog.info(`[registerPreparing] taskId=${taskId} strategyName=${strategyName}`);
    return { success: true };
  }

  /**
   * Enqueue a backtest config. Returns taskId and whether it was already cancelled.
   * If the queue is idle, execution starts immediately.
   * TICKET_641_2: Returns error if queue is at capacity.
   */
  enqueue(config: ExecutorConfig): { taskId: string; cancelled: boolean; error?: string } {
    // TICKET_352_5: Use caller-provided taskId if available (caller-generated ID pattern)
    const taskId = config.taskId || randomUUID();

    // TICKET_366: Check if task was cancelled during preparation phase
    // TICKET_368: Return cancelled flag so caller can propagate to renderer
    const existing = this.tasks.get(taskId);
    if (existing?.status === 'cancelled') {
      queueLog.info(`[enqueue] taskId=${taskId} already cancelled during preparation, skipping`);
      return { taskId, cancelled: true };
    }

    // TICKET_641_2: Reject if queue is at capacity (skip check for tasks already registered via registerPreparing)
    if (!existing) {
      const depthError = this.checkQueueDepth();
      if (depthError) {
        return { taskId, cancelled: false, error: depthError };
      }
    }

    const task: QueuedTask = {
      taskId,
      config,
      status: 'queued',
      createdAt: existing?.createdAt ?? Date.now(),
      strategyName: existing?.strategyName,
    };

    this.tasks.set(taskId, task);
    queueLog.info(`[enqueue] taskId=${taskId}, queueSize=${this.tasks.size}`);

    this.processNext();
    return { taskId, cancelled: false };
  }

  /**
   * Cancel a queued or running task.
   * - Queued: remove from queue immediately.
   * - Running: delegate to ExecutorService.cancelTask().
   */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      queueLog.warn(`[cancel] taskId=${taskId} not found`);
      return false;
    }

    // TICKET_366: Cancel during preparation phase (before data download completes)
    if (task.status === 'preparing') {
      task.status = 'cancelled';
      queueLog.info(`[cancel] Cancelled preparing task ${taskId}`);
      sendToRenderer('executor:cancelled', { taskId });
      // TICKET_371: Persist cancelled task to DB (preparing tasks don't go through onTaskFinished)
      this.persistTerminalTask(task);
      return true;
    }

    if (task.status === 'queued') {
      task.status = 'cancelled';
      this.tasks.delete(taskId);
      queueLog.info(`[cancel] Removed queued task ${taskId}`);
      sendToRenderer('executor:cancelled', { taskId });
      // TICKET_371: Persist cancelled task to DB (queued tasks don't go through onTaskFinished)
      this.persistTerminalTask(task);
      return true;
    }

    if (task.status === 'running' && task.executorTaskId) {
      queueLog.info(`[cancel] Cancelling running task ${taskId} (executor: ${task.executorTaskId})`);
      return getExecutorService().cancelTask(task.executorTaskId);
    }

    return false;
  }

  /**
   * Cancel all queued and running tasks (for app shutdown).
   */
  cancelAll(): void {
    queueLog.info(`[cancelAll] Cancelling ${this.tasks.size} tasks`);
    for (const [taskId, task] of this.tasks) {
      if (task.status === 'queued') {
        task.status = 'cancelled';
        sendToRenderer('executor:cancelled', { taskId });
      } else if (task.status === 'running' && task.executorTaskId) {
        getExecutorService().cancelTask(task.executorTaskId);
      }
    }
    this.tasks.clear();
    this.activeCount = 0;
  }

  /**
   * Get overall queue status.
   */
  getStatus(): QueueStatus {
    const tasks = Array.from(this.tasks.values());
    return {
      tasks,
      activeCount: this.activeCount,
      queuedCount: tasks.filter(t => t.status === 'queued').length,
    };
  }

  /**
   * Get status of a single task.
   */
  getTaskStatus(taskId: string): QueuedTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Update the concurrency limit, floored to 1.
   * Logs a warning if value exceeds the hardware cap but proceeds.
   */
  setMaxConcurrent(value: number): void {
    this.maxConcurrent = Math.max(1, value);
    if (this.maxConcurrent > this.hardwareCap) {
      queueLog.warn(`[setMaxConcurrent] maxConcurrent=${this.maxConcurrent} exceeds hardwareCap=${this.hardwareCap}`);
    }
    queueLog.info(`[setMaxConcurrent] maxConcurrent=${this.maxConcurrent} (requested=${value}, hardwareCap=${this.hardwareCap})`);
    // Attempt to start more tasks if limit increased
    this.processNext();
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  /**
   * TICKET_641_2: Check queue depth and return error message if at capacity.
   * Returns undefined if queue has room, or an error string if full.
   * Logs a warning when approaching capacity (80% threshold).
   */
  private checkQueueDepth(): string | undefined {
    const pendingCount = this.getPendingTaskCount();
    const warningThreshold = Math.floor(MAX_QUEUE_DEPTH * QUEUE_WARNING_THRESHOLD_RATIO);

    if (pendingCount >= MAX_QUEUE_DEPTH) {
      const error = `Queue full (${pendingCount} pending tasks, max ${MAX_QUEUE_DEPTH}). Wait for tasks to complete.`;
      queueLog.error(`[checkQueueDepth] ${error}`);
      return error;
    }

    if (pendingCount >= warningThreshold) {
      queueLog.warn(`[checkQueueDepth] Queue approaching capacity: ${pendingCount}/${MAX_QUEUE_DEPTH} (${Math.round(pendingCount / MAX_QUEUE_DEPTH * 100)}%)`);
    }

    return undefined;
  }

  /**
   * Count tasks in non-terminal states (preparing, queued, running).
   */
  private getPendingTaskCount(): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'preparing' || task.status === 'queued' || task.status === 'running') {
        count++;
      }
    }
    return count;
  }

  /**
   * Attempt to start the next queued task if concurrency allows.
   */
  private processNext(): void {
    // Start as many queued tasks as concurrency allows
    while (this.activeCount < this.maxConcurrent) {
      // Find the first queued task (FIFO by insertion order in Map)
      let nextTask: QueuedTask | undefined;
      for (const task of this.tasks.values()) {
        if (task.status === 'queued') {
          nextTask = task;
          break;
        }
      }

      if (!nextTask) return;

      this.activeCount++;
      nextTask.status = 'running';
      queueLog.info(`[processNext] Starting task ${nextTask.taskId}, activeCount=${this.activeCount}`);

      this.runTask(nextTask);
    }
  }

  /**
   * Run a single task via ExecutorService, subscribing to completion events.
   */
  private async runTask(queuedTask: QueuedTask): Promise<void> {
    const executorService = getExecutorService();

    try {
      // TICKET_352: Pre-assign queue taskId so executor uses the same ID
      // This ensures all sendToRenderer events carry the ID the renderer knows
      // config is guaranteed non-null here: runTask is only called from processNext
      // which only picks tasks with status='queued' (set by enqueue, which always provides config)
      queuedTask.config!.taskId = queuedTask.taskId;

      const executorTaskId = await executorService.runBacktest(queuedTask.config!);
      queuedTask.executorTaskId = executorTaskId;
      queueLog.info(`[runTask] queue=${queuedTask.taskId} -> executor=${executorTaskId}`);

      // Subscribe to executor completion events for this task
      const onCompleted = (taskId: string) => {
        if (taskId !== executorTaskId) return;
        cleanup();
        queuedTask.status = 'completed';
        this.onTaskFinished(queuedTask);
      };

      const onFailed = (taskId: string) => {
        if (taskId !== executorTaskId) return;
        cleanup();
        queuedTask.status = 'failed';
        this.onTaskFinished(queuedTask);
      };

      const onCancelled = (taskId: string) => {
        if (taskId !== executorTaskId) return;
        cleanup();
        queuedTask.status = 'cancelled';
        this.onTaskFinished(queuedTask);
      };

      const cleanup = () => {
        executorService.removeListener('task:completed', onCompleted);
        executorService.removeListener('task:failed', onFailed);
        executorService.removeListener('task:cancelled', onCancelled);
      };

      executorService.on('task:completed', onCompleted);
      executorService.on('task:failed', onFailed);
      executorService.on('task:cancelled', onCancelled);

    } catch (error) {
      queueLog.error(`[runTask] Failed to start task ${queuedTask.taskId}:`, error);
      queuedTask.status = 'failed';
      queuedTask.errorMessage = error instanceof Error ? error.message : String(error);
      sendToRenderer('executor:error', {
        taskId: queuedTask.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.onTaskFinished(queuedTask);
    }
  }

  /**
   * TICKET_371: Persist a terminal-state task to the history DB.
   */
  private persistTerminalTask(task: QueuedTask): void {
    try {
      const db = getDatabaseManager();
      const historyService = new BacktestTaskHistoryService(db);
      historyService.saveTask({
        task_id: task.taskId,
        strategy_name: task.strategyName || 'Unknown',
        status: task.status as 'completed' | 'failed' | 'cancelled',
        error_message: task.errorMessage || null,
        created_at: task.createdAt,
      });
    } catch (err) {
      queueLog.error(`[persistTerminalTask] Failed to persist task history: ${err}`);
    }
  }

  /**
   * Called when a task finishes (completed, failed, or cancelled).
   * Decrements activeCount and triggers processNext().
   */
  private onTaskFinished(task: QueuedTask): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    queueLog.info(`[onTaskFinished] task=${task.taskId} status=${task.status}, activeCount=${this.activeCount}`);

    // TICKET_371: Persist terminal-state task to DB
    this.persistTerminalTask(task);

    // TICKET_352_1: Deferred cleanup - remove finished task after retention window
    setTimeout(() => {
      if (this.tasks.has(task.taskId)) {
        this.tasks.delete(task.taskId);
        queueLog.debug(`[cleanup] Removed finished task ${task.taskId}`);
      }
    }, FINISHED_TASK_RETENTION_MS);

    // Emit queue status update to renderer
    sendToRenderer(this.queueStatusChannel, this.getStatus());

    // Start next queued task
    this.processNext();
  }
}

// =============================================================================
// Two-phase Singleton
// =============================================================================

let instance: ExecutorQueueService | null = null;

/** @deprecated Use initializeBacktestQueue() instead */
export function initializeExecutorQueue(): void {
  initializeBacktestQueue();
}

/** @deprecated Use getBacktestQueue() instead */
export function getExecutorQueue(): ExecutorQueueService {
  return getBacktestQueue();
}

export function initializeBacktestQueue(): void {
  if (instance) {
    queueLog.warn('[BacktestQueue] Already initialized, skipping');
    return;
  }
  instance = new ExecutorQueueService();

  // Read initial config value
  const configService = getConfigService();
  const initialValue = configService.get<number>('performance.maxBacktestTasks');
  if (initialValue !== undefined) {
    instance.setMaxConcurrent(initialValue);
  }

  // Subscribe to config changes
  configService.on('changed', (event: { path: string; newValue: unknown }) => {
    if (event.path === 'performance.maxBacktestTasks' && typeof event.newValue === 'number') {
      instance!.setMaxConcurrent(event.newValue);
    }
  });

  queueLog.info('[BacktestQueue] Initialized');
}

export function getBacktestQueue(): ExecutorQueueService {
  if (!instance) {
    throw new Error('ExecutorQueueService not initialized. Call initializeBacktestQueue() first.');
  }
  return instance;
}
