/**
 * BacktestResultPage Component - Independent Result Page
 *
 * TICKET_234: Independent Backtest Result Page
 * TICKET_234_2: Independent Executor Event Subscription
 * TICKET_237: Control buttons (Run in Background, Cancel)
 * TICKET_239: Multi-Backtest Tab and Queue Control
 *
 * Host Shell for displaying backtest results independently from the config page.
 * Users can navigate here from Status Bar during execution and view real-time results.
 *
 * Features:
 * - Independent Executor event subscriptions (TICKET_234_2)
 * - Real-time updates during execution
 * - Independent breadcrumb: Nexus Hub > Backtest Result
 * - Run in Background: returns to previous view (TICKET_237)
 * - Cancel: stops backtest with confirmation (TICKET_237)
 * - Multi-tab support for parallel backtests (TICKET_239)
 */

import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore, useBacktestStatusStore } from '@/stores';
import { initialExecutionState, initialPipelineProgress } from '@/stores/useBacktestStatusStore';
import { BreadcrumbBar } from '@/components/host';
import { CancelConfirmDialog } from '@/components/dialogs';
import { StatusPlate } from '@/components/common';
import { BacktestTabBar } from '@/components/backtest';
// TICKET_321: Pipeline progress visualization
import { PipelineProgress } from '@/components/ui/PipelineProgress';
import type { PipelinePhaseConfig } from '@/components/ui/PipelineProgress';
// TICKET_300: windowApi breadcrumb removed - breadcrumbs derived from VIEW_REGISTRY
import { useMessage } from '@/hooks/useMessage';

// Plugin layer component
import { BacktestResultPanel } from '@plugins/back-test-nexus/ui/components/ui';
// TICKET_886_7: useQuantLabAvailable + useExportToQuantLab removed (saved_strategies dead).
// TICKET_398: Dry run LLM call estimate panel

// TICKET_321: Pipeline phase definitions for backtest execution
// TICKET_786_4: Labels translated via `t()` at the component boundary (see BACKTEST_PIPELINE_PHASES memo below)
const BACKTEST_PIPELINE_PHASE_KEYS: { key: string; labelKey: string }[] = [
  { key: 'downloading', labelKey: 'pipeline.download' },
  { key: 'spawning', labelKey: 'pipeline.spawn' },
  { key: 'initializing', labelKey: 'pipeline.initialize' },
  { key: 'loading_data', labelKey: 'pipeline.loadData' },
  { key: 'backtesting', labelKey: 'pipeline.backtest' },
  { key: 'finalizing', labelKey: 'pipeline.finalize' },
];

// -----------------------------------------------------------------------------
// BacktestResultPage Component
// -----------------------------------------------------------------------------

export const BacktestResultPage: React.FC = () => {
  const { t } = useTranslation(['backtest', 'errors']);
  const message = useMessage();

  // TICKET_786_4: Translate pipeline phase labels at render boundary
  const BACKTEST_PIPELINE_PHASES = useMemo<PipelinePhaseConfig[]>(
    () => BACKTEST_PIPELINE_PHASE_KEYS.map(({ key, labelKey }) => ({ key, label: t(labelKey) })),
    [t],
  );
  const { setActiveView, previousView } = useAppStore();

  // TICKET_376: Safe navigation target -- prevent self-navigation when previousView is 'backtestResult'
  const returnView = previousView && previousView !== 'backtestResult' ? previousView : 'backtest';

  // TICKET_239: Read from global store with multi-tab support
  const runningTasks = useBacktestStatusStore((state) => state.runningTasks);
  const activeTabId = useBacktestStatusStore((state) => state.activeTabId);
  const taskResults = useBacktestStatusStore((state) => state.taskResults);
  const pendingTasks = useBacktestStatusStore((state) => state.pendingTasks);
  const cancelTask = useBacktestStatusStore((state) => state.cancelTask);
  const closeTab = useBacktestStatusStore((state) => state.closeTab);
  const switchTab = useBacktestStatusStore((state) => state.switchTab);
  // TICKET_239: Get active task and its result
  const activeTask = runningTasks.find((t) => t.taskId === activeTabId) || null;
  const activeTaskResult = activeTabId ? taskResults[activeTabId] : null;

  // TICKET_356: Per-task only - no legacy fallback
  const currentResult = activeTaskResult?.result ?? null;
  const executionState = activeTaskResult?.executionState ?? initialExecutionState;
  // TICKET_296: Error message for failed tasks
  const errorMessage = activeTaskResult?.errorMessage ?? null;
  // TICKET_359: Cache-aside loading state
  const loadingTabIds = useBacktestStatusStore((state) => state.loadingTabIds);
  const isLoadingFromDb = activeTabId ? loadingTabIds.includes(activeTabId) : false;

  // TICKET_359: Cache-aside -- trigger DB load when activeTabId changes to a cache-miss completed tab.
  // Covers: closeTab redirect to adjacent tab, page mount with evicted cache.
  const loadTaskResultFromDb = useBacktestStatusStore((state) => state.loadTaskResultFromDb);
  useEffect(() => {
    if (!activeTabId) return;
    const task = runningTasks.find((t) => t.taskId === activeTabId);
    const hasCachedResult = !!taskResults[activeTabId];
    const isCompletedLike = task && ['completed', 'failed', 'cancelled'].includes(task.status);
    if (!hasCachedResult && isCompletedLike && !loadingTabIds.includes(activeTabId)) {
      loadTaskResultFromDb(activeTabId);
    }
  }, [activeTabId, runningTasks, taskResults, loadingTabIds, loadTaskResultFromDb]);

  // TICKET_357_1: Store-level notification fields for event reaction
  const cancelledTaskId = useBacktestStatusStore((state) => state.cancelledTaskId);
  const completedTaskId = useBacktestStatusStore((state) => state.completedTaskId);
  const clearNotification = useBacktestStatusStore((state) => state.clearNotification);


  const { isExecuting, currentCaseIndex, totalCases, executorProgress, processedBars, totalBars } = executionState;

  // TICKET_356: Pipeline progress from per-task state
  const pipelineProgress = useBacktestStatusStore((state) => {
    const tabId = state.activeTabId;
    return tabId ? state.taskResults[tabId]?.pipelineProgress ?? initialPipelineProgress : initialPipelineProgress;
  });
  // TICKET_321: Show pipeline for any phase except idle (including 'complete' to persist after finish)
  const isPipelineVisible = pipelineProgress.phase !== 'idle';
  // TICKET_357_1: Derive cancelled state from store instead of local state
  const isCancelled = activeTask?.status === 'cancelled';
  // TICKET_327: Pipeline is actively executing (downloading through backtesting, not yet complete)
  // TICKET_374: Cancelled tasks are not actively executing even if pipeline phase is not 'complete'
  const isPipelineActive = isPipelineVisible && pipelineProgress.phase !== 'complete' && pipelineProgress.phase !== 'error' && !isCancelled;

  // TICKET_237: Cancel confirmation dialog state
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  // -------------------------------------------------------------------------
  // TICKET_357_1: Event subscriptions moved to store-level (initExecutorSubscriptions).
  // Only the getCurrentPhase query remains here (needs to run on component mount).
  // -------------------------------------------------------------------------
  useEffect(() => {
    const api = (window as any).electronAPI?.executor;
    if (!api?.getCurrentPhase) return;

    // TICKET_327: On mount, query actual current phase from Main Process.
    const currentTask = useBacktestStatusStore.getState().currentTask;
    if (currentTask?.taskId) {
      const PHASE_ORDER = ['idle', 'downloading', 'spawning', 'initializing', 'loading_data', 'backtesting'];
      api.getCurrentPhase(currentTask.taskId).then((phase: string | null) => {
        if (phase) {
          const tabId = currentTask.taskId;
          const taskEntry = useBacktestStatusStore.getState().taskResults[tabId];
          const storedIdx = PHASE_ORDER.indexOf(taskEntry?.pipelineProgress?.phase || 'idle');
          const actualIdx = PHASE_ORDER.indexOf(phase);
          if (actualIdx > storedIdx) {
            useBacktestStatusStore.getState().setTaskPipelinePhase(tabId, phase as any);
          }
        }
      });
    }
  }, []);

  // TICKET_357_1: React to store-level cancelled notification
  // TICKET_369: Directly go back after cancel - no second dialog
  useEffect(() => {
    if (cancelledTaskId && cancelledTaskId === activeTabId) {
      clearNotification();
      setActiveView(returnView);
    }
  }, [cancelledTaskId, activeTabId, clearNotification, setActiveView, returnView]);

  // TICKET_357_1: React to store-level completed notification
  useEffect(() => {
    if (completedTaskId && completedTaskId === activeTabId) {
      message.success(t('notification.backtestCompleted'));
      clearNotification();
    }
  }, [completedTaskId, activeTabId, message, t, clearNotification]);

  // TICKET_376: Auto-navigate away when all tabs are closed
  const hasHadTabsRef = useRef(runningTasks.length > 0);

  useEffect(() => {
    if (runningTasks.length > 0) {
      hasHadTabsRef.current = true;
    } else if (hasHadTabsRef.current) {
      setActiveView(returnView);
    }
  }, [runningTasks.length, setActiveView, returnView]);

  // TICKET_239: Determine what to display for active tab
  // TICKET_296: Track error state for UI display
  const isFailed = !!errorMessage;
  const hasResults = currentResult !== null;
  const resultsToShow = currentResult ? [currentResult] : [];
  const hasAnyTabs = runningTasks.length > 0;

  // TICKET_357: Render-side diagnostic (only log when result state changes)
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevCandleCountRef = useRef<number | null>(null);
  const candleCount = currentResult?.candles?.length ?? null;
  if (candleCount !== prevCandleCountRef.current) {
    console.log('[DIAG_357] render:', {
      activeTabId,
      hasCurrentResult: hasResults,
      candlesCount: candleCount,
      equityCount: currentResult?.equityCurve?.length ?? null,
      isExecuting,
      isPipelineActive,
    });
    prevCandleCountRef.current = candleCount;
  }

  // Auto-scroll to bottom so charts and pipeline are fully visible
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el && (isExecuting || hasResults || isPipelineActive)) {
      el.scrollTop = el.scrollHeight;
    }
  }, [isExecuting, hasResults, isPipelineActive, candleCount]);

  // -------------------------------------------------------------------------
  // TICKET_237: Control Button Handlers
  // -------------------------------------------------------------------------

  // Handle "Run in Background" - navigate to previous view (keep tab open)
  const handleRunInBackground = useCallback(() => {
    setActiveView(returnView);
  }, [setActiveView, returnView]);

  // Handle "Return" - close current tab; navigate back only when it was the last tab
  const handleReturn = useCallback(() => {
    if (!activeTabId) return;
    const isLastTab = runningTasks.length <= 1;
    closeTab(activeTabId);
    if (isLastTab) {
      setActiveView(returnView);
    }
  }, [activeTabId, runningTasks.length, closeTab, setActiveView, returnView]);

  // TICKET_370: Tab X button - cancel flow for executing tasks, direct close for terminal tasks
  const handleTabClose = useCallback((taskId: string) => {
    const task = runningTasks.find((t) => t.taskId === taskId);
    if (!task) return;

    const isTaskExecuting = ['preparing', 'running', 'pending'].includes(task.status);

    if (isTaskExecuting) {
      // Switch to target tab first so handleCancelConfirm targets the right task
      if (taskId !== activeTabId) {
        switchTab(taskId);
      }
      // Trigger cancel flow (same as Cancel button)
      setShowCancelDialog(true);
    } else {
      // Terminal state - close directly
      const isLastTab = runningTasks.length <= 1;
      closeTab(taskId);
      if (isLastTab) {
        setActiveView(returnView);
      }
    }
  }, [runningTasks, activeTabId, switchTab, closeTab, setActiveView, returnView]);

  // Close other tabs: close all tabs except the specified one
  const handleTabCloseOthers = useCallback((keepTaskId: string) => {
    const tasks = [...runningTasks].filter((t) => t.taskId !== keepTaskId);
    const executingTasks = tasks.filter((t) => ['preparing', 'running', 'pending'].includes(t.status));
    const terminalTasks = tasks.filter((t) => !['preparing', 'running', 'pending'].includes(t.status));

    // Close all terminal-state tabs directly
    for (const task of terminalTasks) {
      closeTab(task.taskId);
    }

    // For executing tasks, trigger cancel flow on the first one
    if (executingTasks.length > 0) {
      const firstExecuting = executingTasks[0];
      if (firstExecuting.taskId !== activeTabId) {
        switchTab(firstExecuting.taskId);
      }
      setShowCancelDialog(true);
    } else {
      // Ensure the kept tab is active
      if (keepTaskId !== activeTabId) {
        switchTab(keepTaskId);
      }
    }
  }, [runningTasks, activeTabId, closeTab, switchTab]);

  // Close all tabs: direct close for terminal-state tabs, cancel flow for executing tabs
  const handleTabCloseAll = useCallback(() => {
    // Snapshot current tasks to avoid mutation during iteration
    const tasks = [...runningTasks];
    const executingTasks = tasks.filter((t) => ['preparing', 'running', 'pending'].includes(t.status));
    const terminalTasks = tasks.filter((t) => !['preparing', 'running', 'pending'].includes(t.status));

    // Close all terminal-state tabs directly
    for (const task of terminalTasks) {
      closeTab(task.taskId);
    }

    // For executing tasks, trigger cancel flow on the first one (user confirms via dialog)
    if (executingTasks.length > 0) {
      const firstExecuting = executingTasks[0];
      if (firstExecuting.taskId !== activeTabId) {
        switchTab(firstExecuting.taskId);
      }
      setShowCancelDialog(true);
    } else {
      // All tabs were terminal, navigate back
      setActiveView(returnView);
    }
  }, [runningTasks, activeTabId, closeTab, switchTab, setActiveView, returnView]);

  // Handle "Cancel" button click - show confirmation dialog
  const handleCancelClick = useCallback(() => {
    setShowCancelDialog(true);
  }, []);

  // Handle cancel confirmation
  // TICKET_239: Use activeTask instead of currentTask
  const handleCancelConfirm = useCallback(async () => {
    setShowCancelDialog(false);

    const taskId = activeTask?.taskId;
    if (!taskId) return;

    // Call executor cancel API
    const api = (window as any).electronAPI?.executor;
    if (api?.cancelBacktest) {
      try {
        await api.cancelBacktest(taskId);
      } catch (error) {
        console.error('[E:BACKTEST:CANCEL_FAILED] [BacktestResultPage] Failed to cancel backtest:', error);
      }
    }

    // Update queue state (this will also auto-start next pending task)
    cancelTask(taskId);
  }, [activeTask, cancelTask]);

  // Handle cancel dialog dismiss
  const handleCancelDismiss = useCallback(() => {
    setShowCancelDialog(false);
  }, []);

  // TICKET_410: GO button -- execute actual run in-place, reuse dry run artifacts
  const createPreparingTab = useBacktestStatusStore((state) => state.createPreparingTab);
  const startTask = useBacktestStatusStore((state) => state.startTask);

  const handleGoActualRun = useCallback(async () => {
    if (!activeTask?.pipelineArtifacts) {
      message.error(t('errors:MSG_BACKTEST_PIPELINE_ARTIFACTS_UNAVAILABLE'));
      return;
    }
    const artifacts = activeTask.pipelineArtifacts;
    const executorAPI = (window as any).electronAPI?.executor;
    if (!executorAPI) {
      message.error(t('errors:MSG_BACKTEST_EXECUTOR_UNAVAILABLE'));
      return;
    }

    // 1. Generate new taskId
    const newTaskId = crypto.randomUUID();

    // 2. Register task in queue
    await executorAPI.registerTask(newTaskId, artifacts.strategyName);

    // 3. Create new tab (non-dry-run), switch to it
    createPreparingTab({ taskId: newTaskId, strategyName: artifacts.strategyName });

    // 4. Call runBacktest with reused artifacts, dryRun: false
    const executorRequest: Record<string, unknown> = {
      taskId: newTaskId,
      strategyPath: artifacts.strategyPath,
      strategyName: artifacts.strategyName,
      symbol: artifacts.symbol,
      interval: artifacts.interval,
      startTime: artifacts.startTime,
      endTime: artifacts.endTime,
      dataPath: artifacts.dataPath,
      dataSourceType: 'parquet',
      initialCapital: artifacts.initialCapital,
      orderSize: artifacts.orderSize,
      orderSizeUnit: artifacts.orderSizeUnit,
      // TICKET_414_4: Propagate strategyParams (e.g. strategy_id) from dry run
      ...(artifacts.strategyParams ? { strategyParams: artifacts.strategyParams } : {}),
    };
    if (artifacts.dataFeeds) {
      executorRequest.dataFeeds = artifacts.dataFeeds;
    }

    const result = await executorAPI.runBacktest(executorRequest);
    if (!result?.success) {
      message.error(t('errors:MSG_BACKTEST_ACTUAL_RUN_FAILED', { error: result?.error || t('errors:MSG_GENERIC_ERROR') }));
      return;
    }

    // 5. Transition tab to running with metadata from dry run task
    if (result.taskId) {
      startTask(result.taskId, {
        workflowTimeframes: activeTask.workflowTimeframes,
        workflowExportData: activeTask.workflowExportData,
        backtestConfig: activeTask.backtestConfig,
      });
    }
  }, [activeTask, message, createPreparingTab, startTask]);

  // TICKET_300: Breadcrumbs auto-derived from VIEW_REGISTRY['backtestResult'].shortLabel = 'RESULT'

  return (
    <div className="flex flex-col h-full overflow-hidden terminal-theme bg-color-terminal-bg">
      {/* Header: Breadcrumb Bar with Status Plate and Timeframe Buttons */}
      <BreadcrumbBar
        showHome={true}
        homeLabel={t('breadcrumb.home')}
        onHomeClick={() => setActiveView('nexus')}
        rightContent={
          <div className="flex items-center gap-4">
            {/* TICKET_398: DRY RUN badge */}
            {activeTask?.isDryRun && !isExecuting && activeTask.status === 'completed' && (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border border-color-terminal-accent-primary/50 bg-color-terminal-accent-primary/15 text-color-terminal-accent-primary">
                {t('result.dryRunBadge')}
              </span>
            )}
            {/* Status Plate */}
            {/* TICKET_296: Show FAILED status when executor errors */}
            {/* TICKET_359: Show LOADING status during DB cache load */}
            {isLoadingFromDb ? (
              <StatusPlate text={t('status.loading', 'LOADING')} variant="testing" />
            ) : isCancelled ? (
              <StatusPlate text={t('status.cancelled', 'CANCELLED')} variant="cancelled" />
            ) : isFailed ? (
              <StatusPlate text={t('executorStatus.failed', 'FAILED')} variant="error" />
            ) : isExecuting || isPipelineActive ? (
              <StatusPlate text={t('status.running', 'TESTING')} variant="testing" />
            ) : hasResults ? (
              <StatusPlate text={t('status.completed', 'COMPLETED')} variant="completed" />
            ) : null}
          </div>
        }
      />

      {/* TICKET_239: Tab Bar for multiple backtests */}
      {hasAnyTabs && <BacktestTabBar onTabClose={handleTabClose} onTabCloseOthers={handleTabCloseOthers} onTabCloseAll={handleTabCloseAll} />}

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Main content area - shrinks when pipeline visible to give pipeline space */}
        <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto p-6">
          {isLoadingFromDb ? (
            // TICKET_359: Cache miss -- loading result from DB
            <div className="h-full flex flex-col items-center justify-center">
              <div className="text-color-terminal-text-muted text-center">
                <div className="mb-4 animate-spin w-6 h-6 mx-auto border-2 border-color-terminal-accent-primary border-t-transparent rounded-full" />
                <p className="text-sm">{t('page.loadingResult', 'Loading result...')}</p>
              </div>
            </div>
          ) : isExecuting || hasResults || isPipelineActive || isCancelled ? (
            // TICKET_302: Empty Structure pattern - show BacktestResultPanel immediately
            // when executing (even before first INCREMENT), with empty results if needed
            // TICKET_327: isPipelineActive covers the download phase before enqueueTask
            // TICKET_374: Show cancelled state in chart area
            <BacktestResultPanel
              results={resultsToShow}
              isExecuting={isExecuting || isPipelineActive}
              isCancelled={isCancelled}
              currentCaseIndex={currentCaseIndex}
              totalCases={totalCases}
              processedBars={processedBars}
              backtestTotalBars={totalBars}
              executorProgress={executorProgress}
              workflowTimeframes={activeTask?.workflowTimeframes}
              backtestConfig={activeTask?.backtestConfig}
              dryRunResult={activeTask?.isDryRun ? activeTask.dryRunResult : undefined}
            />
          ) : isFailed ? (
            // TICKET_296: Error state - show error message
            <div className="h-full flex flex-col items-center justify-center">
              <div className="text-center max-w-lg">
                <div className="mb-4 text-red-400">
                  <svg className="w-10 h-10 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-red-400 mb-3">
                  {t('executorStatus.failed', 'Failed')}
                </p>
                <div className="px-4 py-3 rounded border border-red-500/30 bg-red-500/5 text-left">
                  <p className="text-xs text-red-300 font-mono break-all whitespace-pre-wrap">
                    {errorMessage}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            // No results - empty state
            <div className="h-full flex flex-col items-center justify-center">
              <div className="text-color-terminal-text-muted text-center">
                <p className="text-sm mb-4">
                  {t('page.noResults')}
                </p>
                <p className="text-xs">
                  {t('page.startBacktest')}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* TICKET_321: Pipeline Progress section - shrink-0 to use only intrinsic height */}
        {isPipelineVisible && (
          <div className="flex-shrink-0 border-t border-color-terminal-border flex flex-col justify-end">
            <PipelineProgress
              phases={BACKTEST_PIPELINE_PHASES}
              currentPhase={pipelineProgress.phase}
              progress={pipelineProgress.progress}
              visible={isPipelineVisible}
              message={pipelineProgress.message && pipelineProgress.message.startsWith('MSG_')
                ? t(pipelineProgress.message, { ns: 'errors' })
                : pipelineProgress.message}
              isCancelled={isCancelled}
            />
          </div>
        )}

        {/* Footer: Action Bar - TICKET_237, TICKET_267 */}
        <div className="flex-shrink-0 border-t border-color-terminal-border bg-color-terminal-surface/50 p-4">
          <div className="flex justify-between items-center">
            {/* Left: Return button + Cancel button (during execution) */}
            <div className="flex items-center gap-2">
              <button
                onClick={isExecuting ? handleRunInBackground : handleReturn}
                className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider border rounded transition-all border-color-terminal-accent-teal bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal hover:bg-color-terminal-accent-teal/20"
              >
                {isExecuting
                  ? t('buttons.runInBackground', 'Run in Background')
                  : t('buttons.return', 'Return')
                }
              </button>
              {isExecuting && !activeTask?.isDryRun && (
                <button
                  onClick={handleCancelClick}
                  className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider border rounded transition-all border-red-500 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                >
                  {t('buttons.cancel', 'Cancel')}
                </button>
              )}
            </div>

            {/* Right: GO button (dry run) + Export to Quant Lab button - TICKET_267, TICKET_398 */}
            <div className="flex items-center gap-2">
              {/* TICKET_398: GO button - visible after dry run completion */}
              {activeTask?.isDryRun && !isExecuting && activeTask.status === 'completed' && (
                <button
                  onClick={handleGoActualRun}
                  className="flex items-center justify-center gap-2 px-6 py-2 text-xs font-bold uppercase tracking-wider border rounded transition-all border-color-terminal-accent-gold bg-color-terminal-accent-gold/10 text-color-terminal-accent-gold hover:bg-color-terminal-accent-gold/20"
                >
                  GO
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* TICKET_237: Cancel Confirmation Dialog */}
      <CancelConfirmDialog
        visible={showCancelDialog}
        onConfirm={handleCancelConfirm}
        onCancel={handleCancelDismiss}
      />

    </div>
  );
};

export default BacktestResultPage;
