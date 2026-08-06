/**
 * Backtest Console Modal
 *
 * Replaces BacktestQueueDialog with a full console showing all task states:
 * running, queued, completed, failed, cancelled.
 *
 * @see TICKET_353 - Backtest Console Modal
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useBacktestStatusStore } from '@/stores/useBacktestStatusStore';
import { useAppStore } from '@/stores';
import { QueueSummaryHeader } from './components/QueueSummaryHeader';
import { LiveQueueTable } from './components/LiveQueueTable';

// -----------------------------------------------------------------------------
// Icons
// -----------------------------------------------------------------------------

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface BacktestConsoleModalProps {
  onNavigateToResult?: () => void;
  onCancelBacktest?: (taskId: string) => Promise<void>;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function BacktestConsoleModal({
  onNavigateToResult,
  onCancelBacktest,
}: BacktestConsoleModalProps) {
  const { t } = useTranslation('ui');
  const isOpen = useBacktestStatusStore((state) => state.isQueueDialogOpen);
  const runningTasks = useBacktestStatusStore((state) => state.runningTasks);
  const pendingTasks = useBacktestStatusStore((state) => state.pendingTasks);
  const closeQueueDialog = useBacktestStatusStore((state) => state.closeQueueDialog);
  const cancelAll = useBacktestStatusStore((state) => state.cancelAll);
  const setActiveView = useAppStore((state) => state.setActiveView);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeQueueDialog();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeQueueDialog]);

  // Handle view result navigation -- TICKET_373: switch to clicked task before navigating
  const handleViewResult = useCallback((taskId: string) => {
    useBacktestStatusStore.getState().switchTab(taskId);
    closeQueueDialog();
    if (onNavigateToResult) {
      onNavigateToResult();
    } else {
      setActiveView('backtest');
    }
  }, [closeQueueDialog, onNavigateToResult, setActiveView]);

  // Handle cancel all queued (pending only, not running)
  // TICKET_352 Phase 3: Also cancel on backend queue
  const handleCancelAllQueued = useCallback(async () => {
    const { pendingTasks: pending, removeFromQueue } = useBacktestStatusStore.getState();
    // Clear frontend queue
    pending.forEach((t) => removeFromQueue(t.taskId));
    // Cancel backend queue pending tasks
    const api = (window as any).electronAPI?.executor;
    if (api?.cancelAllBacktests) {
      try {
        await api.cancelAllBacktests();
      } catch (error) {
        console.error('[E:BACKTEST_CONSOLE:CANCEL_ALL_FAILED] Failed to cancel all on backend:', error);
      }
    }
  }, []);

  // Handle clear finished (remove completed/failed/cancelled from runningTasks)
  const handleClearFinished = useCallback(() => {
    const { runningTasks: tasks, closeTab } = useBacktestStatusStore.getState();
    tasks
      .filter((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
      .forEach((t) => closeTab(t.taskId));
  }, []);

  const mouseDownOnBackdrop = useRef(false);

  if (!isOpen) {
    return null;
  }

  const hasQueuedTasks = pendingTasks.length > 0;
  const hasFinishedTasks = runningTasks.some(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
  );
  const hasAnyTasks = runningTasks.length > 0 || pendingTasks.length > 0;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      style={{ zIndex: Z_INDEX_MODAL }}
      onMouseDown={() => { mouseDownOnBackdrop.current = true; }}
      onMouseUp={() => {
        if (mouseDownOnBackdrop.current) closeQueueDialog();
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div
        className="w-[560px] max-h-[500px] rounded-lg border border-color-terminal-border bg-color-terminal-surface shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-color-terminal-border bg-color-terminal-panel shrink-0">
          <div className="flex items-center gap-4">
            <span className="font-mono text-[12px] font-semibold text-color-terminal-text uppercase tracking-wider">
              {t('backtestConsole.title')}
            </span>
            <QueueSummaryHeader />
          </div>
          <button
            onClick={closeQueueDialog}
            className="flex items-center justify-center w-5 h-5 rounded hover:bg-color-terminal-surface transition-colors"
          >
            <CloseIcon className="w-3.5 h-3.5 text-color-terminal-text-muted hover:text-color-terminal-text" />
          </button>
        </div>

        {/* Body - Scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <LiveQueueTable
            onCancelBacktest={onCancelBacktest}
            onViewResult={handleViewResult}
          />
        </div>

        {/* Footer */}
        {hasAnyTasks && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-color-terminal-border bg-color-terminal-panel shrink-0">
            {hasQueuedTasks && (
              <button
                onClick={handleCancelAllQueued}
                className="px-3 py-1.5 font-mono text-[12px] font-medium uppercase tracking-wider rounded border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                {t('backtestConsole.cancelAllQueued')}
              </button>
            )}
            {hasFinishedTasks && (
              <button
                onClick={handleClearFinished}
                className="px-3 py-1.5 font-mono text-[12px] font-medium uppercase tracking-wider rounded border border-color-terminal-border text-color-terminal-text-muted hover:text-color-terminal-text hover:border-color-terminal-text-muted transition-colors"
              >
                {t('backtestConsole.clearFinished')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default BacktestConsoleModal;
