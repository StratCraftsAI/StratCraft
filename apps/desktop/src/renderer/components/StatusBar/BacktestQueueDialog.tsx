/**
 * Backtest Queue Dialog Component
 *
 * Displays running task and pending queue with management actions.
 *
 * @see TICKET_233 - Global Backtest Status and Notification System
 */

import React, { useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';
import { useBacktestStatusStore } from '@/stores/useBacktestStatusStore';
import { useAppStore } from '@/stores';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const TOTAL_BLOCKS = 10;
const FILLED_CHAR = '\u2588';
const EMPTY_CHAR = '\u2591';

// -----------------------------------------------------------------------------
// Icons
// -----------------------------------------------------------------------------

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SpinnerIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2v4" />
    <path d="m16.2 7.8 2.9-2.9" />
    <path d="M18 12h4" />
    <path d="m16.2 16.2 2.9 2.9" />
    <path d="M12 18v4" />
    <path d="m4.9 19.1 2.9-2.9" />
    <path d="M2 12h4" />
    <path d="m4.9 4.9 2.9 2.9" />
  </svg>
);

const ClockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function renderProgressBlocks(percent: number): string {
  const filled = Math.round((percent / 100) * TOTAL_BLOCKS);
  const empty = TOTAL_BLOCKS - filled;
  return FILLED_CHAR.repeat(filled) + EMPTY_CHAR.repeat(empty);
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export interface BacktestQueueDialogProps {
  onNavigateToResult?: () => void;
  onCancelBacktest?: (taskId: string) => Promise<void>;
}

export function BacktestQueueDialog({
  onNavigateToResult,
  onCancelBacktest,
}: BacktestQueueDialogProps) {
  const { t } = useTranslation('ui');
  const isOpen = useBacktestStatusStore((state) => state.isQueueDialogOpen);
  const currentTask = useBacktestStatusStore((state) => state.currentTask);
  const pendingTasks = useBacktestStatusStore((state) => state.pendingTasks);
  const closeQueueDialog = useBacktestStatusStore((state) => state.closeQueueDialog);
  const removeFromQueue = useBacktestStatusStore((state) => state.removeFromQueue);
  const cancelAll = useBacktestStatusStore((state) => state.cancelAll);
  const setActiveView = useAppStore((state) => state.setActiveView);

  // Handle view result button
  const handleViewResult = useCallback(() => {
    closeQueueDialog();
    if (onNavigateToResult) {
      onNavigateToResult();
    } else {
      setActiveView('backtest');
    }
  }, [closeQueueDialog, onNavigateToResult, setActiveView]);

  // Handle cancel current task
  const handleCancelCurrent = useCallback(async () => {
    if (currentTask && onCancelBacktest) {
      await onCancelBacktest(currentTask.taskId);
    }
  }, [currentTask, onCancelBacktest]);

  // Handle remove from queue
  const handleRemoveFromQueue = useCallback(
    (taskId: string) => {
      removeFromQueue(taskId);
    },
    [removeFromQueue]
  );

  // Handle cancel all
  const handleCancelAll = useCallback(async () => {
    if (currentTask && onCancelBacktest) {
      await onCancelBacktest(currentTask.taskId);
    }
    cancelAll();
    closeQueueDialog();
  }, [currentTask, onCancelBacktest, cancelAll, closeQueueDialog]);

  const mouseDownOnBackdrop = useRef(false);

  if (!isOpen) {
    return null;
  }

  const progressBlocks = currentTask ? renderProgressBlocks(currentTask.progress) : '';

  return createPortal(
    <div
      className="fixed inset-0 flex items-end justify-end p-4 bg-black/40 backdrop-blur-[2px]"
      style={{ zIndex: Z_INDEX_MODAL }}
      onMouseDown={() => { mouseDownOnBackdrop.current = true; }}
      onMouseUp={() => {
        if (mouseDownOnBackdrop.current) closeQueueDialog();
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div
        className="w-[360px] max-h-[400px] rounded-lg border border-color-terminal-border bg-color-terminal-surface shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-color-terminal-border bg-color-terminal-panel">
          <span className="font-mono text-xs font-semibold text-color-terminal-text uppercase tracking-wider">
            {t('backtestQueue.title')}
          </span>
          <button
            onClick={closeQueueDialog}
            className="flex items-center justify-center w-5 h-5 rounded hover:bg-color-terminal-surface transition-colors"
          >
            <CloseIcon className="w-3.5 h-3.5 text-color-terminal-text-muted hover:text-color-terminal-text" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[300px] overflow-y-auto">
          {/* Running Task Section */}
          {currentTask && (
            <div className="p-3 border-b border-color-terminal-border">
              <div className="flex items-center gap-2 mb-2">
                <SpinnerIcon className="w-3.5 h-3.5 text-color-terminal-accent-teal animate-spin" />
                <span className="font-mono text-[10px] font-semibold text-color-terminal-accent-teal uppercase tracking-wider">
                  {t('backtestQueue.running')}
                </span>
              </div>
              <div className="p-3 rounded border border-color-terminal-border bg-color-terminal-bg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs text-color-terminal-text font-medium">
                    {currentTask.strategyName}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-mono text-xs tracking-tight">
                    <span className="text-color-terminal-accent-teal">
                      {progressBlocks.slice(0, Math.round((currentTask.progress / 100) * TOTAL_BLOCKS))}
                    </span>
                    <span className="text-color-terminal-text-muted">
                      {progressBlocks.slice(Math.round((currentTask.progress / 100) * TOTAL_BLOCKS))}
                    </span>
                  </span>
                  <span className="font-mono text-[10px] text-color-terminal-text-secondary">
                    {currentTask.progress}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleViewResult}
                    className="px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-wider rounded border border-color-terminal-accent-teal text-color-terminal-accent-teal hover:bg-color-terminal-accent-teal/10 transition-colors"
                  >
                    {t('backtestQueue.view')}
                  </button>
                  <button
                    onClick={handleCancelCurrent}
                    className="px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-wider rounded border border-red-500 text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    {t('backtestQueue.cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Pending Tasks Section */}
          {pendingTasks.length > 0 && (
            <div className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <ClockIcon className="w-3.5 h-3.5 text-color-terminal-accent-gold" />
                <span className="font-mono text-[10px] font-semibold text-color-terminal-accent-gold uppercase tracking-wider">
                  {t('backtestQueue.pending')} ({pendingTasks.length})
                </span>
              </div>
              <div className="space-y-2">
                {pendingTasks.map((task) => (
                  <div
                    key={task.taskId}
                    className="flex items-center justify-between p-2 rounded border border-color-terminal-border bg-color-terminal-bg"
                  >
                    <span className="font-mono text-xs text-color-terminal-text-secondary">
                      {task.strategyName}
                    </span>
                    <button
                      onClick={() => handleRemoveFromQueue(task.taskId)}
                      className="px-2 py-0.5 font-mono text-[12px] font-medium uppercase tracking-wider rounded border border-color-terminal-text-muted text-color-terminal-text-muted hover:border-red-500 hover:text-red-400 transition-colors"
                    >
                      {t('backtestQueue.remove')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!currentTask && pendingTasks.length === 0 && (
            <div className="p-6 text-center">
              <span className="font-mono text-xs text-color-terminal-text-muted">
                {t('backtestQueue.noTasks')}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        {(currentTask || pendingTasks.length > 0) && (
          <div className="px-4 py-3 border-t border-color-terminal-border bg-color-terminal-panel">
            <button
              onClick={handleCancelAll}
              className="w-full px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-wider rounded border border-red-500 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              {t('backtestQueue.cancelAll')}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default BacktestQueueDialog;
