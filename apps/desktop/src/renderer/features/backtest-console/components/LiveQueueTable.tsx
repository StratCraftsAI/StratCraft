/**
 * Live Queue Table Component
 *
 * Displays all backtest tasks (running, queued, completed, failed) in a compact table.
 *
 * @see TICKET_353 - Backtest Console Modal
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Square, Eye, Trash2 } from 'lucide-react';
import { useBacktestStatusStore, BacktestTask, BacktestTaskStatus } from '@/stores/useBacktestStatusStore';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const TOTAL_BLOCKS = 10;
const FILLED_CHAR = '\u2588';
const EMPTY_CHAR = '\u2591';

const STATUS_ORDER = {
  preparing: 0,
  running: 1,
  pending: 2,
  completed: 3,
  failed: 4,
  cancelled: 5,
} satisfies Record<BacktestTaskStatus, number>;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface LiveQueueTableProps {
  onCancelBacktest?: (taskId: string) => Promise<void>;
  onViewResult?: (taskId: string) => void;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function LiveQueueTable({ onCancelBacktest, onViewResult }: LiveQueueTableProps) {
  const { t } = useTranslation('ui');
  const runningTasks = useBacktestStatusStore((state) => state.runningTasks);
  const pendingTasks = useBacktestStatusStore((state) => state.pendingTasks);
  const removeFromQueue = useBacktestStatusStore((state) => state.removeFromQueue);
  const closeTab = useBacktestStatusStore((state) => state.closeTab);
  const closeQueueDialog = useBacktestStatusStore((state) => state.closeQueueDialog);

  // Merge and sort: running first, then queued (by position), then completed/failed (by createdAt desc)
  const allTasks = useMemo(() => {
    const pending: BacktestTask[] = pendingTasks.map((t) => ({ ...t, status: 'pending' as const }));
    const merged = [...runningTasks, ...pending];
    return merged.sort((a, b) => {
      const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (orderDiff !== 0) return orderDiff;
      // Within same status, sort by createdAt (oldest first for running/pending, newest first for done/failed)
      if (a.status === 'completed' || a.status === 'failed' || a.status === 'cancelled') {
        return b.createdAt - a.createdAt;
      }
      return a.createdAt - b.createdAt;
    });
  }, [runningTasks, pendingTasks]);

  if (allTasks.length === 0) {
    return (
      <div className="p-6 text-center">
        <span className="font-mono text-xs text-color-terminal-text-muted">
          {t('backtestConsole.noTasks')}
        </span>
      </div>
    );
  }

  return (
    <div className="divide-y divide-color-terminal-border">
      {allTasks.map((task, index) => (
        <TaskRow
          key={task.taskId}
          task={task}
          queuePosition={task.status === 'pending' ? pendingTasks.findIndex((t) => t.taskId === task.taskId) + 1 : undefined}
          onCancel={async () => {
            if (task.status === 'running' && onCancelBacktest) {
              await onCancelBacktest(task.taskId);
            }
          }}
          onDelete={async () => {
            if (task.status === 'running' && onCancelBacktest) {
              // Stop + remove from list
              await onCancelBacktest(task.taskId);
              closeTab(task.taskId);
            } else if (task.status === 'pending') {
              removeFromQueue(task.taskId);
            } else {
              // completed/failed/cancelled - remove from list
              closeTab(task.taskId);
            }
          }}
          onView={() => {
            closeQueueDialog();
            onViewResult?.(task.taskId);
          }}
        />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// TaskRow
// -----------------------------------------------------------------------------

interface TaskRowProps {
  task: BacktestTask;
  queuePosition?: number;
  onCancel: () => void;
  onDelete: () => void;
  onView: () => void;
}

function TaskRow({ task, queuePosition, onCancel, onDelete, onView }: TaskRowProps) {
  const { t } = useTranslation('ui');
  const isRunning = task.status === 'running';
  const isPending = task.status === 'pending';
  const isCompleted = task.status === 'completed';
  const isCancelled = task.status === 'cancelled';

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-color-terminal-surface/30 transition-colors"
      onDoubleClick={(isRunning || isCompleted || isCancelled) ? onView : undefined}
      style={(isRunning || isCompleted || isCancelled) ? { cursor: 'pointer' } : undefined}
    >
      {/* Status Badge */}
      <StatusBadge status={task.status} queuePosition={queuePosition} />

      {/* Strategy Name */}
      <span className="flex-1 font-mono text-xs text-color-terminal-text truncate min-w-0">
        {task.strategyName}
      </span>

      {/* Progress Bar (running only) */}
      {isRunning && (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="font-mono text-xs tracking-tight">
            <span className="text-color-terminal-accent-teal">
              {FILLED_CHAR.repeat(Math.round((task.progress / 100) * TOTAL_BLOCKS))}
            </span>
            <span className="text-color-terminal-text-muted">
              {EMPTY_CHAR.repeat(TOTAL_BLOCKS - Math.round((task.progress / 100) * TOTAL_BLOCKS))}
            </span>
          </span>
          <span className="font-mono text-[10px] text-color-terminal-text-secondary w-7 text-right">
            {task.progress}%
          </span>
        </div>
      )}

      {/* Actions - fixed width slots: [STOP?] [VIEW?] [TRASH] for vertical alignment */}
      <div className="flex items-center gap-1 shrink-0 w-[76px] justify-end">
        {isRunning && (
          <button
            onClick={onCancel}
            className="w-6 h-6 flex items-center justify-center rounded text-red-400 hover:bg-red-500/10 transition-colors"
            title={t('backtestConsole.stopBacktest')}
          >
            <Square size={12} fill="currentColor" />
          </button>
        )}
        {(isRunning || isCompleted || isCancelled) && (
          <button
            onClick={onView}
            className="w-6 h-6 flex items-center justify-center rounded text-color-terminal-accent-teal hover:bg-color-terminal-accent-teal/10 transition-colors"
            title={t('backtestConsole.viewResult')}
          >
            <Eye size={14} />
          </button>
        )}
        <button
          onClick={onDelete}
          className="w-6 h-6 flex items-center justify-center rounded text-color-terminal-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title={isPending ? t('backtestConsole.removeFromQueue') : t('backtestConsole.removeFromList')}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// StatusBadge
// -----------------------------------------------------------------------------

interface StatusBadgeProps {
  status: BacktestTaskStatus;
  queuePosition?: number;
}

function StatusBadge({ status, queuePosition }: StatusBadgeProps) {
  const { t } = useTranslation('ui');
  const config = STATUS_CONFIG[status];
  const statusKey = status === 'pending' ? 'queued' : status;
  const label = status === 'pending' && queuePosition !== undefined
    ? t('backtestConsole.status.queuedPosition', { position: queuePosition })
    : t(`backtestConsole.status.${statusKey}`);

  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[10px] font-medium w-20 shrink-0 ${config.textClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dotClass}`} />
      {label}
    </span>
  );
}

const STATUS_CONFIG = {
  preparing: { dotClass: 'bg-color-terminal-accent-gold animate-pulse', textClass: 'text-color-terminal-accent-gold' },
  running: { dotClass: 'bg-color-terminal-accent-teal animate-pulse', textClass: 'text-color-terminal-accent-teal' },
  pending: { dotClass: 'bg-color-terminal-accent-gold', textClass: 'text-color-terminal-accent-gold' },
  completed: { dotClass: 'bg-green-400', textClass: 'text-green-400' },
  failed: { dotClass: 'bg-red-400', textClass: 'text-red-400' },
  cancelled: { dotClass: 'bg-gray-400', textClass: 'text-gray-400' },
} satisfies Record<BacktestTaskStatus, { dotClass: string; textClass: string }>;
