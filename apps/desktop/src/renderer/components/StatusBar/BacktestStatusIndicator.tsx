/**
 * Backtest Status Indicator Component
 *
 * TICKET_354: Simplified to match DownloadStatusIndicator pattern.
 * - Active (running/pending): spinning teal icon + gold count
 * - Finished (all completed/failed/cancelled): static gray icon + gray count
 * - No tasks in runningTasks: hidden
 *
 * Click always opens Backtest Console Modal.
 *
 * @see TICKET_233 - Global Backtest Status and Notification System
 * @see TICKET_348 - Download Status Bar Indicator (reference pattern)
 * @see TICKET_354 - StatusBar Backtest Console Navigation Fix
 */

import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useBacktestStatusStore, selectQueueCount, selectRunningCount } from '@/stores/useBacktestStatusStore';

// -----------------------------------------------------------------------------
// Icons
// -----------------------------------------------------------------------------

const SpinnerIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
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

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function BacktestStatusIndicator() {
  const { t } = useTranslation('ui');
  const runningTasks = useBacktestStatusStore((state) => state.runningTasks);
  const queueCount = useBacktestStatusStore(selectQueueCount);
  const runningCount = useBacktestStatusStore(selectRunningCount);
  const openQueueDialog = useBacktestStatusStore((state) => state.openQueueDialog);
  const setMaxParallelTasks = useBacktestStatusStore((state) => state.setMaxParallelTasks);

  // TICKET_352 Phase 3: Sync maxParallelTasks from backend config on mount
  useEffect(() => {
    const api = window.electronAPI;

    // Read initial value
    api.config.get<number>('performance.maxBacktestTasks').then((result) => {
      if (result.success && result.value !== undefined) {
        setMaxParallelTasks(result.value);
      }
    });

    // Subscribe to config changes
    const unsubscribeConfig = api.config.onChanged((event) => {
      if (event.path === 'performance.maxBacktestTasks' && typeof event.newValue === 'number') {
        setMaxParallelTasks(event.newValue);
      }
    });

    // TICKET_352 Phase 3: Subscribe to backend queue status events
    const unsubscribeQueue = api.executor.onQueueStatus((data) => {
      const store = useBacktestStatusStore.getState();
      const frontendQueuedCount = store.pendingTasks.length;

      // Reconcile: if backend has queued tasks but frontend does not, log the discrepancy
      if (data.queuedCount !== frontendQueuedCount) {
        console.warn(
          `[W:BACKTEST:QUEUE_MISMATCH] Queue count mismatch: backend=${data.queuedCount}, frontend=${frontendQueuedCount}`
        );
      }
    });

    return () => {
      unsubscribeConfig();
      unsubscribeQueue();
    };
  }, [setMaxParallelTasks]);

  const activeCount = runningCount + queueCount;
  const totalTasks = runningTasks.length + queueCount;
  const isActive = activeCount > 0;

  const handleClick = useCallback(() => {
    openQueueDialog();
  }, [openQueueDialog]);

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-color-terminal-surface/50 transition-colors cursor-pointer"
      title={t('backtestConsole.openConsole')}
    >
      <SpinnerIcon
        className={
          isActive
            ? 'w-3 h-3 text-color-terminal-accent-teal animate-spin'
            : 'w-3 h-3 text-color-terminal-text-muted'
        }
      />
      {totalTasks > 0 && (
        <span className="text-[10px] font-mono">
          <span className="text-color-terminal-text-muted">{t('backtestConsole.taskLabel')}</span>
          <span className={`ml-0.5 ${isActive ? 'text-color-terminal-accent-gold' : 'text-color-terminal-text-muted'}`}>
            {totalTasks}
          </span>
        </span>
      )}
    </button>
  );
}

export default BacktestStatusIndicator;
