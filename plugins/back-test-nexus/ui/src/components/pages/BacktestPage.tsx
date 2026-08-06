/**
 * BacktestPage Component - Plugin Layer
 *
 * Backtest Nexus page following TICKET_077 layout specification.
 * Zones: B (Sidebar - History), C (BacktestDataConfigPanel + WorkflowRowSelector), D (Action Bar - Execute)
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_077_COMPONENT8 - BacktestDataConfigPanel Design
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import {
  WorkflowRowSelector,
  type WorkflowRow,
  type AlgorithmOption,
  BacktestDataConfigPanel,
  type BacktestDataConfig,
  type DataSourceOption,
  type SymbolSearchResult,
  BacktestResultPanel,
  type ExecutorResult,
  NamingDialog,
  CheckpointResumePanel,
  BacktestHistorySidebar,
  type BacktestHistoryItem,
  DryRunExecuteButton,
} from '../ui';
import { algorithmService, toAlgorithmOption, type Algorithm } from '../../services/algorithmService';
import { INTERVAL_1d, PROVIDER_YFINANCE } from '@StratCraft/types';
import { extractUniqueTimeframes } from '../../utils/timeframe-utils';
import { formatDateTime } from '@shared/utils/format-locale';
import { DEFAULT_INITIAL_CAPITAL } from '@shared/constants/trading';
import { computeMinStartDate } from '@shared/utils/lookback-constraints';
import { usePluginAuth } from '@/hooks/usePluginAuth';
import { useProviderList } from '@/hooks/useProviderList';
import { PROVIDER_REGION_MAP } from '@plugins/data-plugin/index';
import type { TimeframeValue } from '../ui/TimeframeDropdown';
// TICKET_264: Export to Quant Lab hooks
import { useQuantLabAvailable, useExportToQuantLab } from '../../hooks';

// -----------------------------------------------------------------------------
// Inline SVG Icons (Zone D Action Bar only)
// Zone B icons moved to BacktestHistorySidebar component (TICKET_077_18)
// -----------------------------------------------------------------------------

const PlayIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="6 3 20 12 6 21 6 3" />
  </svg>
);

const LoaderIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

// TICKET_171: Reset icon for config page
const RotateCcwIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

// HistoryItem type imported from BacktestHistorySidebar (TICKET_077_18)
// Use BacktestHistoryItem for history records

// TICKET_176_1: Checkpoint types
interface CheckpointMetrics {
  totalPnl?: number;
  totalReturn?: number;
  totalTrades?: number;
  winRate?: number;
}

interface OpenPosition {
  symbol: string;
  size: number;
  price: number;
}

interface CheckpointInfo {
  taskId: string;
  barIndex: number;
  totalBars: number;
  createdAt: string;
  progressPercent: number;
  intermediateResults?: {
    metrics?: CheckpointMetrics;
    openPositions?: OpenPosition[];
  };
  dataValidation: 'valid' | 'file_missing' | 'hash_mismatch' | 'pending';
}

// TICKET_173: Message API type for notifications
interface MessageAPI {
  info: (msg: string) => void;
  success: (msg: string) => void;
  error: (msg: string) => void;
  confirm: (msg: string, options?: { title?: string; okText?: string; cancelText?: string }) => Promise<boolean>;
}

/** Cockpit mode determines algorithm filtering */
export type CockpitMode = 'indicators' | 'kronos' | 'trader' | 'aiLibero' | 'aiStudio' | 'catalog';

/** TICKET_499: Cockpits that support dry-run mode (LLM-based strategies needing API cost estimation) */
const COCKPITS_WITH_DRY_RUN = new Set<CockpitMode>(['kronos', 'trader', 'aiLibero', 'aiStudio']);

/** TICKET_499: Cockpits where Market Analysis column is disabled (standalone execution strategies) */
const COCKPITS_WITH_DISABLED_ANALYSIS = new Set<CockpitMode>(['trader', 'aiLibero', 'aiStudio', 'catalog']);

/** TICKET_499: Cockpits where Entry Filter (Pre-condition) column is disabled (single-algorithm agents) */
const COCKPITS_WITH_DISABLED_FILTER = new Set<CockpitMode>(['aiLibero', 'aiStudio', 'catalog']);

/** TICKET_586: Cockpits that require BOTH Market Analysis AND Entry Signal (regime-based strategies) */
const COCKPITS_WITH_MANDATORY_BOTH = new Set<CockpitMode>(['indicators', 'kronos']);

// TICKET_173: API types from Host (use any to avoid type dependency on Host types)
export interface BacktestPageProps {
  /** TICKET_173: Executor API from Host */
  executorAPI?: any;
  /** TICKET_173: Data API from Host */
  dataAPI?: any;
  /** TICKET_173: Message API from Host */
  messageAPI?: MessageAPI;
  /** TICKET_173: Notify Host when result view state changes (for breadcrumb) */
  onResultViewChange?: (isResultView: boolean) => void;
  /** TICKET_164: Reset key - when changed, clear all result states */
  resetKey?: number;
  /** Cockpit mode: 'indicators' (default) or 'kronos' for different algorithm filtering */
  cockpitMode?: CockpitMode;
  /** TICKET_233: Notify Host when backtest starts (for global status bar) */
  /** TICKET_257: Include workflowTimeframes for result page display */
  /** TICKET_268: Include workflowExportData for Quant Lab export */
  onBacktestStart?: (
    taskId: string,
    strategyName: string,
    workflowTimeframes?: {
      analysis: string | null;
      entryFilter: string | null;
      entrySignal: string | null;
      exitStrategy: string | null;
    },
    workflowExportData?: {
      analysis: { algorithmId: string; algorithmName: string; algorithmCode: string; baseClass: string; timeframe: string; parameters: Record<string, unknown> };
      entry: { algorithmId: string; algorithmName: string; algorithmCode: string; baseClass: string; timeframe: string; parameters: Record<string, unknown> };
      exit?: { algorithmId: string; algorithmName: string; algorithmCode: string; baseClass: string; timeframe: string; parameters: Record<string, unknown> } | null;
      symbol: string;
      dateRange: { start: string; end: string };
    },
    /** TICKET_378: Backtest configuration summary for result page display */
    backtestConfig?: {
      dataSource: string;
      symbol: string;
      startDate: string;
      endDate: string;
      initialCapital: number;
      orderSize: number;
      orderSizeUnit: string;
    }
  ) => void;
  /** TICKET_327: Notify Host when execution begins (before data download)
   *  TICKET_352_5: Includes caller-generated taskId for immediate tab creation
   *  TICKET_365: 3rd arg is config snapshot for cancel -> go back preservation
   *  TICKET_398: 4th arg isDryRun flag */
  onExecutionBegin?: (strategyName: string, taskId: string, configSnapshot?: {
    cockpit: string;
    dataConfig: { symbol: string; dataSource: string; startDate: string; endDate: string; initialCapital: number; orderSize: number; orderSizeUnit: string };
    workflowRows: unknown[];
  }, isDryRun?: boolean) => void;
  /** TICKET_365: Restored config from cancel -> go back flow */
  initialConfig?: {
    dataConfig: { symbol: string; dataSource: string; startDate: string; endDate: string; initialCapital: number; orderSize: number; orderSizeUnit: string };
    workflowRows: unknown[];
  };
  /** TICKET_410: Save pipeline artifacts for dry run GO reuse */
  onSavePipelineArtifacts?: (taskId: string, artifacts: {
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
  }) => void;
}

// -----------------------------------------------------------------------------
// Algorithm Data (loaded from SQLite nona_algorithms table)
// -----------------------------------------------------------------------------

const EMPTY_ALGORITHMS: {
  trendRange: AlgorithmOption[];
  preCondition: AlgorithmOption[];
  selectSteps: AlgorithmOption[];
  postCondition: AlgorithmOption[];
} = {
  trendRange: [],
  preCondition: [],
  selectSteps: [],
  postCondition: [],
};

// Initial empty row
const createInitialRow = (): WorkflowRow => ({
  id: `row-${Date.now()}`,
  rowNumber: 1,
  analysisSelections: [],
  preConditionSelections: [],
  stepSelections: [],
  postConditionSelections: [],
});

// Default data configuration
// TICKET_248: timeframe removed - now set at stage-level in WorkflowRowSelector
const createDefaultDataConfig = (): BacktestDataConfig => ({
  symbol: '',
  dataSource: PROVIDER_YFINANCE,
  startDate: '',
  endDate: '',
  initialCapital: DEFAULT_INITIAL_CAPITAL,
  orderSize: 100,
  orderSizeUnit: 'percent',
});

// -----------------------------------------------------------------------------
// BacktestPage Component
// -----------------------------------------------------------------------------

export const BacktestPage: React.FC<BacktestPageProps> = ({
  executorAPI,
  dataAPI,
  messageAPI,
  onResultViewChange,
  resetKey = 0,
  cockpitMode = 'indicators',
  onBacktestStart,
  onExecutionBegin,
  initialConfig,
  onSavePipelineArtifacts,
}) => {
  const { t } = useTranslation('backtest');

  // TICKET_173: State moved from Host Shell
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  // TICKET_398: Dry run toggle state (default ON for kronos/trader)
  const [dryRunEnabled, setDryRunEnabled] = useState(true);
  // TICKET_153_1: History from SQLite
  const [historyItems, setHistoryItems] = useState<BacktestHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // TICKET_365: Restore workflowRows from initialConfig if available (cancel -> go back)
  const [workflowRows, setWorkflowRows] = useState<WorkflowRow[]>(
    () => (initialConfig?.workflowRows as WorkflowRow[]) || [createInitialRow()]
  );
  const [algorithms, setAlgorithms] = useState(EMPTY_ALGORITHMS);
  const [loading, setLoading] = useState(true);

  // Component 8: Data configuration state
  // TICKET_365: Restore dataConfig from initialConfig if available (cancel -> go back)
  const [dataConfig, setDataConfig] = useState<BacktestDataConfig>(
    () => (initialConfig?.dataConfig as BacktestDataConfig) || createDefaultDataConfig()
  );
  // TICKET_883 Phase 2: unified provider hook (replaces two-phase loading)
  const { providers: hookProviders } = useProviderList();

  // TICKET_909: imported packages as selectable data sources
  const [importedSources, setImportedSources] = useState<DataSourceOption[]>([]);
  useEffect(() => {
    window.electronAPI.data.listImportedPackages().then((packages: Array<{
      packageName: string;
      adjustMode: string;
      sourceDialect: string;
    }>) => {
      if (packages.length === 0) return;
      setImportedSources(packages.map((pkg) => ({
        id: pkg.packageName,
        name: pkg.packageName,
        status: 'connected' as const,
        requiresAuth: false,
        kind: 'imported' as const,
        region: 'imported' as const,
      })));
    }).catch(() => { /* silent - imported packages are optional */ });
  }, []);

  const dataSources = useMemo<DataSourceOption[]>(() => {
    const providerSources: DataSourceOption[] = hookProviders.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status as DataSourceOption['status'],
      requiresAuth: (p.capabilities as { requiresAuth?: boolean })?.requiresAuth ?? false,
      intervals: (p.capabilities as { intervals?: string[] })?.intervals,
      maxLookback: (p.capabilities as { maxLookback?: Record<string, string> })?.maxLookback,
      kind: 'provider' as const,
      region: PROVIDER_REGION_MAP[p.id],
    }));
    const existingIds = new Set(providerSources.map((ds) => ds.id));
    const fresh = importedSources.filter((ds) => !existingIds.has(ds.id));
    return [...providerSources, ...fresh];
  }, [hookProviders, importedSources]);
  const [dataConfigErrors, setDataConfigErrors] = useState<Partial<Record<keyof BacktestDataConfig, string>>>({});
  // TICKET_143: Separate execution error from field errors
  const [executeError, setExecuteError] = useState<string | null>(null);

  // TICKET_571: Auth state via unified hook
  const { isAuthenticated } = usePluginAuth();

  // TICKET_151_1: Track which case to scroll to in Charts tab

  // TICKET_770: Delete confirmation now flows through the host ModalProvider
  // via globalThis.nexus.window.showConfirm() (see handleDeleteClick below);
  // the inline dialog and its visibility state were removed in TICKET_770.

  // TICKET_162: Selected history result for page41 display
  const [selectedHistoryResult, setSelectedHistoryResult] = useState<ExecutorResult | null>(null);
  // TICKET_162: Selected history item metadata for title display
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<BacktestHistoryItem | null>(null);

  // TICKET_264: Export to Quant Lab
  const { isAvailable: isQuantLabAvailable, isLoading: isQuantLabLoading, error: quantLabError } = useQuantLabAvailable();
  const { exportWorkflow, isExporting } = useExportToQuantLab();
  const [exportDialogVisible, setExportDialogVisible] = useState(false);

  // TICKET_267: Log QuantLab availability state
  useEffect(() => {
    console.log('[TICKET_267] BacktestPage: QuantLab state - isAvailable:', isQuantLabAvailable, 'isLoading:', isQuantLabLoading, 'error:', quantLabError);
  }, [isQuantLabAvailable, isQuantLabLoading, quantLabError]);

  // TICKET_267: Log render branch state
  useEffect(() => {
    const renderBranch = selectedHistoryResult ? 'PAGE41_HISTORY' : isExecuting ? 'EXECUTING' : 'CONFIG_VIEW';
    console.log('[TICKET_267] BacktestPage: Render branch=' + renderBranch + ', selectedHistoryResult=' + !!selectedHistoryResult + ', isExecuting=' + isExecuting);
  }, [selectedHistoryResult, isExecuting]);

  // TICKET_163: Naming dialog state
  const [namingDialogVisible, setNamingDialogVisible] = useState(false);

  // TICKET_176_1: Checkpoint state
  const [checkpointInfo, setCheckpointInfo] = useState<CheckpointInfo | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [showCheckpointPanel, setShowCheckpointPanel] = useState(false);

  // TICKET_173: Track if viewing history result (for breadcrumb)
  const [hasHistoryResult, setHasHistoryResult] = useState(false);

  // TICKET_173: Determine if viewing results (execution or history)
  // TICKET_227: Switch to result view when backtest starts (real-time display)
  const isResultView = isExecuting || hasHistoryResult;

  // TICKET_173: Centralized state reset helper
  const clearResultState = useCallback(() => {
    setHasHistoryResult(false);
    setCurrentTaskId(null);
  }, []);

  // TICKET_173: Notify Host when result view state changes
  // TICKET_227: Debug logging for page switch
  useEffect(() => {
    console.debug('[TICKET_227] isResultView changed:', {
      isResultView,
      isExecuting,
      hasHistoryResult,
    });
    onResultViewChange?.(isResultView);
  }, [isResultView, onResultViewChange, isExecuting, hasHistoryResult]);


  // TICKET_153_1: Load history from SQLite
  const loadHistory = useCallback(async () => {
    const api = (window as any).electronAPI;
    if (!api?.executor?.getHistory) {
      console.warn('[W:BACKTEST:HISTORY_API_UNAVAILABLE] [BacktestPage] History API not available');
      return;
    }

    setHistoryLoading(true);
    try {
      const result = await api.executor.getHistory({ limit: 20 });
      if (result.success && result.data) {
        const items: BacktestHistoryItem[] = result.data.map((record: any) => ({
          id: record.task_id,
          name: record.strategy_name,
          symbol: record.symbol,
          timeframe: record.timeframe,
          totalReturn: record.total_return,
          // Backtest parameters
          startDate: record.start_date?.split('T')[0] || '',
          endDate: record.end_date?.split('T')[0] || '',
          initialCapital: record.initial_capital || 0,
          orderSize: record.order_size,
          orderSizeUnit: record.order_size_unit,
          // Timestamp with time
          createdAt: formatDateTime(record.created_at),
          status: 'completed' as const,
        }));
        setHistoryItems(items);
      }
    } catch (error) {
      console.error('[E:BACKTEST:LOAD_HISTORY_FAILED] [BacktestPage] Failed to load history:', error);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // TICKET_160: Delete history record
  const handleDeleteHistory = useCallback(async (itemId: string) => {
    const api = (window as any).electronAPI;
    if (!api?.executor?.deleteHistoryResult) {
      console.warn('[W:BACKTEST:DELETE_API_UNAVAILABLE] [BacktestPage] Delete API not available');
      return;
    }

    try {
      const result = await api.executor.deleteHistoryResult(itemId);
      if (result.success) {
        // Remove from local state
        setHistoryItems((prev) => prev.filter((item) => item.id !== itemId));
      } else {
        console.error('[E:BACKTEST:DELETE_HISTORY_FAILED] [BacktestPage] Failed to delete history:', result.error);
      }
    } catch (error) {
      console.error('[E:BACKTEST:DELETE_HISTORY_EXCEPTION] [BacktestPage] Delete error:', error);
    }
  }, []);

  // TICKET_160 / TICKET_770: Delete a history record. The destructive
  // confirmation is rendered by the host ModalProvider via the shared
  // globalThis.nexus.window.showConfirm() API; this replaces the inline
  // 30-line dialog that previously lived at the bottom of the JSX tree.
  // If the host injection is missing the optional chain returns undefined,
  // the strict equality below is false, and no deletion occurs -- the
  // correct fail-closed behavior for a destructive action.
  const handleDeleteClick = useCallback(
    async (e: React.MouseEvent, itemId: string) => {
      e.stopPropagation();
      const confirmed = await globalThis.nexus?.window?.showConfirm(
        t('dialog.deleteMessage'),
        {
          title: t('dialog.deleteTitle'),
          variant: 'destructive',
          okText: t('buttons.delete'),
          cancelText: t('buttons.cancel'),
        },
      );
      if (confirmed === true) {
        await handleDeleteHistory(itemId);
      }
    },
    [t, handleDeleteHistory],
  );

  // TICKET_162: Handle history item click - load full result and switch to page41
  // TICKET_164: Notify Host for breadcrumb update
  const handleHistoryItemClick = useCallback(async (taskId: string) => {
    const api = (window as any).electronAPI;
    if (!api?.executor?.getHistoryResult) {
      console.warn('[W:BACKTEST:HISTORY_RESULT_API_UNAVAILABLE] [BacktestPage] getHistoryResult API not available');
      return;
    }

    // Find the history item to get metadata
    const historyItem = historyItems.find(item => item.id === taskId);
    if (historyItem) {
      setSelectedHistoryItem(historyItem);
    }

    try {
      const response = await api.executor.getHistoryResult(taskId);
      if (response.success && response.data) {
        const record = response.data;
        // Transform database record to ExecutorResult format
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
          candles: [], // Candles not stored in database, use empty array
        };
        setSelectedHistoryResult(result);
        // TICKET_173: Update local state (Host notified via isResultView effect)
        setHasHistoryResult(true);
        console.log('[BacktestPage] Loaded history result for:', taskId);
      } else {
        console.error('[E:BACKTEST:LOAD_HISTORY_RESULT_FAILED] [BacktestPage] Failed to load history result:', response.error);
      }
    } catch (error) {
      console.error('[E:BACKTEST:LOAD_HISTORY_RESULT_EXCEPTION] [BacktestPage] Error loading history result:', error);
    }
  }, [historyItems]);

  // TICKET_162: Clear selected history result and return to config page
  // TICKET_170: Reset config to initial state for true "New Backtest"
  // TICKET_173: Use clearResultState (Host notified via isResultView effect)
  const handleClearHistoryResult = useCallback(() => {
    setSelectedHistoryResult(null);
    setSelectedHistoryItem(null);
    setDataConfig(createDefaultDataConfig());
    setWorkflowRows([createInitialRow()]);
    clearResultState();
  }, [clearResultState]);

  // TICKET_171: Reset config on Page 4 (config page)
  const handleReset = useCallback(() => {
    setDataConfig(createDefaultDataConfig());
    setWorkflowRows([createInitialRow()]);
    setDataConfigErrors({});
    setExecuteError(null);
  }, []);

  // TICKET_176_1: Check for checkpoint on mount
  const checkForCheckpoint = useCallback(async () => {
    const api = (window as any).electronAPI;
    if (!api?.backtest?.listCheckpoints) {
      console.warn('[W:BACKTEST:CHECKPOINT_API_UNAVAILABLE] [BacktestPage] Checkpoint API not available');
      return;
    }

    try {
      const result = await api.backtest.listCheckpoints();
      if (result.success && result.data && result.data.length > 0) {
        // Get the most recent checkpoint
        const latestCheckpoint = result.data[0];
        const infoResult = await api.backtest.getCheckpointInfo(latestCheckpoint.task_id);
        if (infoResult.success && infoResult.data) {
          setCheckpointInfo(infoResult.data);
          setShowCheckpointPanel(true);
          console.log('[BacktestPage] Found checkpoint:', infoResult.data);
        }
      }
    } catch (error) {
      console.error('[E:BACKTEST:CHECKPOINT_CHECK_FAILED] [BacktestPage] Failed to check for checkpoint:', error);
    }
  }, []);

  // TICKET_176_1: Handle checkpoint resume
  const handleCheckpointResume = useCallback(async () => {
    if (!checkpointInfo) return;

    const api = (window as any).electronAPI;
    if (!api?.backtest?.resumeBacktest) {
      messageAPI?.error(t('messages.resumeApiNotAvailable'));
      return;
    }

    setIsResuming(true);
    setShowCheckpointPanel(false);
    setIsExecuting(true);


    try {
      messageAPI?.info(t('messages.resumingFromCheckpoint'));
      const result = await api.backtest.resumeBacktest({
        taskId: checkpointInfo.taskId,
        originalConfig: dataConfig,
      });

      if (!result.success) {
        throw new Error(result.error || t('errors.resumeFailed'));
      }

      console.log('[BacktestPage] Resume started, taskId:', result.taskId);
      setCurrentTaskId(result.taskId);
      setCheckpointInfo(null);
    } catch (error) {
      console.error('[E:BACKTEST:RESUME_FAILED] [BacktestPage] Resume failed:', error);
      messageAPI?.error(t('messages.resumeFailed', { message: error instanceof Error ? error.message : 'Unknown error' }));
      setIsExecuting(false);
      setShowCheckpointPanel(true);
    } finally {
      setIsResuming(false);
    }
  }, [checkpointInfo, dataConfig, messageAPI]);

  // TICKET_176_1: Handle checkpoint discard
  const handleCheckpointDiscard = useCallback(async () => {
    if (!checkpointInfo) return;

    const api = (window as any).electronAPI;
    if (!api?.backtest?.deleteCheckpoint) {
      console.warn('[W:BACKTEST:DELETE_CHECKPOINT_API_UNAVAILABLE] [BacktestPage] Delete checkpoint API not available');
      setCheckpointInfo(null);
      setShowCheckpointPanel(false);
      return;
    }

    try {
      await api.backtest.deleteCheckpoint(checkpointInfo.taskId);
      console.log('[BacktestPage] Checkpoint discarded');
      setCheckpointInfo(null);
      setShowCheckpointPanel(false);
    } catch (error) {
      console.error('[E:BACKTEST:DELETE_CHECKPOINT_FAILED] [BacktestPage] Failed to delete checkpoint:', error);
      messageAPI?.error(t('messages.deleteCheckpointFailed'));
    }
  }, [checkpointInfo, messageAPI]);

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // TICKET_176_1: Check for checkpoint on mount
  useEffect(() => {
    checkForCheckpoint();
  }, [checkForCheckpoint]);

  // TICKET_164: Clear history result when resetKey changes (breadcrumb back navigation)
  // TICKET_170: Also reset config to initial state for true "New Backtest"
  useEffect(() => {
    if (resetKey > 0) {
      console.debug('[BacktestPage] Reset triggered, clearing history result and config');
      setSelectedHistoryResult(null);
      setSelectedHistoryItem(null);
      setDataConfig(createDefaultDataConfig());
      setWorkflowRows([createInitialRow()]);
      clearResultState();
    }
  }, [resetKey, clearResultState]);

  // TICKET_173: Action button handlers (moved from Host Shell)
  const handleNewBacktest = useCallback(() => {
    clearResultState();
    setSelectedHistoryResult(null);
    setSelectedHistoryItem(null);
    setDataConfig(createDefaultDataConfig());
    setWorkflowRows([createInitialRow()]);
    // TICKET_176_1: Show checkpoint panel if checkpoint exists
    if (checkpointInfo) {
      setShowCheckpointPanel(true);
    }
  }, [clearResultState, checkpointInfo]);

  // TICKET_264: Export to Quant Lab handlers
  const handleExportClick = useCallback(() => {
    setExportDialogVisible(true);
  }, []);

  const handleExportCancel = useCallback(() => {
    setExportDialogVisible(false);
  }, []);

  const handleExportConfirm = useCallback(async (finalName: string) => {
    setExportDialogVisible(false);

    // Build workflow config from current state
    // WorkflowRow has: analysisSelections, preConditionSelections, stepSelections, postConditionSelections
    const firstRow = workflowRows[0];
    if (!firstRow) {
      messageAPI?.error(t('messages.noWorkflowConfig'));
      return;
    }

    const analysisSelection = firstRow.analysisSelections[0];
    const entrySelection = firstRow.stepSelections[0];
    const exitSelection = firstRow.postConditionSelections[0];

    if (!analysisSelection || !entrySelection) {
      messageAPI?.error(t('messages.missingAlgorithm'));
      return;
    }

    try {
      await exportWorkflow({
        name: finalName,
        workflow: {
          analysis: {
            algorithmId: String(analysisSelection.id),
            algorithmName: analysisSelection.strategyName,
            algorithmCode: analysisSelection.code || '',
            baseClass: 'RegimeStateBase',
            timeframe: analysisSelection.timeframe || dataConfig.timeframe || INTERVAL_1d,
            parameters: {},
          },
          entry: {
            algorithmId: String(entrySelection.id),
            algorithmName: entrySelection.strategyName,
            algorithmCode: entrySelection.code || '',
            baseClass: 'RegimeTrendEntryBase',
            timeframe: entrySelection.timeframe || dataConfig.timeframe || INTERVAL_1d,
            parameters: {},
          },
          exit: exitSelection ? {
            algorithmId: String(exitSelection.id),
            algorithmName: exitSelection.strategyName,
            algorithmCode: exitSelection.code || '',
            baseClass: 'ExitSignalBase',
            timeframe: exitSelection.timeframe || dataConfig.timeframe || INTERVAL_1d,
            parameters: {},
          } : undefined,
          symbol: dataConfig.symbol,
          interval: dataConfig.timeframe || INTERVAL_1d,
          dataProvider: dataConfig.dataSource,
          dateRange: {
            start: dataConfig.startDate,
            end: dataConfig.endDate,
          },
          initialCapital: dataConfig.initialCapital,
        },
        backtestMetrics: {
          sharpe: selectedHistoryResult?.metrics?.sharpeRatio || 0,
          maxDrawdown: selectedHistoryResult?.metrics?.maxDrawdown || 0,
          winRate: selectedHistoryResult?.metrics?.winRate || 0,
          totalTrades: selectedHistoryResult?.metrics?.totalTrades || 0,
          profitFactor: selectedHistoryResult?.metrics?.profitFactor,
        },
      });

      messageAPI?.success(t('messages.exportedToQuantLab', { name: finalName }));
    } catch (error) {
      console.error('[E:BACKTEST:EXPORT_EXCEPTION] [BacktestPage] Export error:', error);
      messageAPI?.error(t('messages.exportToQuantLabFailed'));
    }
  }, [workflowRows, dataConfig, selectedHistoryResult, exportWorkflow, messageAPI]);

  // Load algorithms from database on mount
  // TICKET_210: Use combined strategy_type + signal_source filtering
  // cockpitMode determines which algorithms to load (indicators vs kronos)
  useEffect(() => {
    async function loadAlgorithms() {
      try {
        setLoading(true);

        let trendRange: Algorithm[];
        let preCondition: Algorithm[];
        let selectSteps: Algorithm[];
        let postCondition: Algorithm[];

        if (cockpitMode === 'kronos') {
          // Kronos cockpit: load Kronos Predictor + all Kronos Entry algorithms
          // TICKET_210: Merge kronosIndicatorEntry + kronos_llm_entry
          const [kronosDetector, preCond, kronosIndicatorEntry, kronosAIEntry, postCond] = await Promise.all([
            algorithmService.getKronosDetectorAlgorithms(),  // strategy_type=9 + kronos_prediction
            algorithmService.getPreConditionAlgorithms(),
            algorithmService.getKronosEntryAlgorithms(),     // strategy_type=1 + kronosIndicatorEntry
            algorithmService.getKronosAIEntryAlgorithms(),   // strategy_type=1 + kronos_llm_entry
            algorithmService.getPostConditionAlgorithms(),
          ]);
          trendRange = kronosDetector;
          preCondition = preCond;
          selectSteps = [...kronosIndicatorEntry, ...kronosAIEntry];
          postCondition = postCond;
        } else if (cockpitMode === 'trader') {
          // TICKET_077_20: Trader cockpit - Market Analysis disabled, Entry Filter shows watchlist
          // Market Analysis: disabled (no algorithms)
          // Entry Filter: watchlist (strategy_type=7, signal_source='watchlist') - Market Observer
          // Entry Signal: llmtrader (strategy_type=1, signal_source='llmtrader') - AI Entry
          const [watchlist, llmTrader, postCond] = await Promise.all([
            algorithmService.getWatchlistAlgorithms(),       // strategy_type=7 + watchlist
            algorithmService.getLLMTraderAlgorithms(),       // strategy_type=1 + llmtrader
            algorithmService.getPostConditionAlgorithms(),
          ]);
          trendRange = [];  // Market Analysis disabled
          preCondition = watchlist;  // Entry Filter shows Market Observer algorithms
          selectSteps = llmTrader;
          postCondition = postCond;
        } else if (cockpitMode === 'aiLibero') {
          // TICKET_499: AI Libero cockpit - standalone execution strategy
          // Market Analysis: disabled (AI Libero handles analysis internally)
          // Pre-condition: disabled (standalone agent)
          // Entry Signal: aiLibero (strategy_type=1, signal_source='aiLibero')
          const [aiLibero, postCond] = await Promise.all([
            algorithmService.getAILiberoAlgorithms(),        // strategy_type=1 + aiLibero
            algorithmService.getPostConditionAlgorithms(),
          ]);
          trendRange = [];
          preCondition = [];
          selectSteps = aiLibero;
          postCondition = postCond;
        } else if (cockpitMode === 'aiStudio') {
          // TICKET_508: AI Studio cockpit - standalone execution strategy
          // Market Analysis: disabled (AI Studio handles analysis internally)
          // Pre-condition: disabled (standalone agent)
          // Entry Signal: aiStudio (strategy_type=1, signal_source='aiStudio')
          const [aiStudio, postCond] = await Promise.all([
            algorithmService.getAIStudioAlgorithms(),        // strategy_type=1 + aiStudio
            algorithmService.getPostConditionAlgorithms(),
          ]);
          trendRange = [];
          preCondition = [];
          selectSteps = aiStudio;
          postCondition = postCond;
        } else if (cockpitMode === 'catalog') {
          const [catalogAlgos, postCond] = await Promise.all([
            algorithmService.getCatalogAlgorithms(),
            algorithmService.getPostConditionAlgorithms(),
          ]);
          trendRange = [];
          preCondition = [];
          selectSteps = catalogAlgos;
          postCondition = postCond;
        } else {
          // Indicators cockpit (default): load indicator-prefixed algorithms
          [trendRange, preCondition, selectSteps, postCondition] = await Promise.all([
            algorithmService.getIndicatorDetectorAlgorithms(),  // strategy_type=9 + indicator_detector%
            algorithmService.getPreConditionAlgorithms(),
            algorithmService.getIndicatorEntryAlgorithms(),     // strategy_type=3 + indicator_entry%
            algorithmService.getPostConditionAlgorithms(),
          ]);
        }

        setAlgorithms({
          trendRange: trendRange.map(toAlgorithmOption),
          preCondition: preCondition.map(toAlgorithmOption),
          selectSteps: selectSteps.map(toAlgorithmOption),
          postCondition: postCondition.map(toAlgorithmOption),
        });

        console.log(`[BacktestPage] Loaded algorithms (cockpitMode=${cockpitMode}):`, {
          trendRange: trendRange.length,
          preCondition: preCondition.length,
          selectSteps: selectSteps.length,
          postCondition: postCondition.length,
        });
      } catch (error) {
        console.error('[E:BACKTEST:LOAD_ALGORITHMS_FAILED] [BacktestPage] Failed to load algorithms:', error);
      } finally {
        setLoading(false);
      }
    }

    loadAlgorithms();
  }, [cockpitMode, isAuthenticated]);

  // TICKET_077_COMPONENT8: Two-phase provider loading
  // NOTE: TICKET_293 auto-switch logic was a no-op (both branches returned prev
  // unchanged). Removed with the two-phase loading during TICKET_883 migration.

  // TICKET_305: Derive provider capability constraints for current data source
  const currentProvider = useMemo(
    () => dataSources.find(s => s.id === dataConfig.dataSource),
    [dataSources, dataConfig.dataSource]
  );
  const allowedIntervals = currentProvider?.intervals as TimeframeValue[] | undefined;
  const maxLookback = currentProvider?.maxLookback;

  // TICKET_305 Phase 3: Derive most restrictive lookback (in days) across selected timeframes
  const mostRestrictivelookbackBars = useMemo(() => {
    if (!maxLookback) return undefined;

    const timeframes = extractUniqueTimeframes(workflowRows);
    if (timeframes.length === 0) return undefined;

    let minDays: number | undefined;
    for (const tf of timeframes) {
      const lb = maxLookback[tf];
      if (!lb) continue;
      // Parse lookback string: '7d' -> 7, '60d' -> 60, '730d' -> 730
      const match = lb.match(/^(\d+)d$/);
      if (match) {
        const days = parseInt(match[1], 10);
        if (minDays === undefined || days < minDays) {
          minDays = days;
        }
      }
    }
    return minDays;
  }, [maxLookback, workflowRows]);

  // TICKET_364: Auto-adjust startDate when maxLookback is exceeded
  const constrainStartDate = useCallback((config: BacktestDataConfig): BacktestDataConfig => {
    if (!maxLookback || !config.startDate || !config.endDate) return config;

    const timeframes = extractUniqueTimeframes(workflowRows);
    if (timeframes.length === 0) return config;

    // Find most restrictive minStartDate across all timeframes
    let latestMin: string | null = null;
    for (const tf of timeframes) {
      const min = computeMinStartDate(tf, maxLookback, config.endDate);
      if (min && (!latestMin || min > latestMin)) {
        latestMin = min;
      }
    }

    if (latestMin && config.startDate < latestMin) {
      return { ...config, startDate: latestMin };
    }
    return config;
  }, [maxLookback, workflowRows]);

  const handleDataConfigChange = useCallback((newConfig: BacktestDataConfig) => {
    const adjusted = constrainStartDate(newConfig);
    if (adjusted.startDate !== newConfig.startDate) {
      messageAPI?.info(t('messages.startDateAdjustedLookback', { date: adjusted.startDate }));
    }
    setDataConfig(adjusted);
  }, [constrainStartDate, messageAPI]);

  // TICKET_364: Re-constrain startDate when workflowRows timeframes change
  useEffect(() => {
    const adjusted = constrainStartDate(dataConfig);
    if (adjusted.startDate !== dataConfig.startDate) {
      messageAPI?.info(t('messages.startDateAdjustedTimeframe', { date: adjusted.startDate }));
      setDataConfig(adjusted);
    }
  }, [workflowRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Symbol search handler
  // TICKET_121 + TICKET_045: Use real backend API instead of mock data
  const handleSymbolSearch = useCallback(async (query: string): Promise<{
    results: SymbolSearchResult[];
    totalCount: number;
    truncated: boolean;
  }> => {
    try {
      // Call real IPC handler (TICKET_045 implementation)
      const api = (window as any).electronAPI;
      if (!api?.data?.searchSymbols) {
        console.warn('[W:BACKTEST:DATA_API_UNAVAILABLE] [BacktestPage] Data API not available, using fallback');
        return { results: [], totalCount: 0, truncated: false };
      }

      // TICKET_641_10: IPC now returns { results, totalCount, truncated }
      const response = await api.data.searchSymbols(query, dataConfig.dataSource);

      // Transform backend response to SymbolSearchResult format
      const results = (response.results || []).map((r: any) => ({
        symbol: r.symbol || query,
        name: r.name || r.symbol || query,
        exchange: r.exchange || 'Unknown',
        type: r.type || 'Unknown',
        startTime: r.startTime,
        endTime: r.endTime,
      }));
      return {
        results,
        totalCount: response.totalCount ?? results.length,
        truncated: response.truncated ?? false,
      };
    } catch (error) {
      console.error('[E:BACKTEST:SYMBOL_SEARCH_FAILED] [BacktestPage] Symbol search failed:', error);
      return { results: [], totalCount: 0, truncated: false };
    }
  }, [dataConfig.dataSource]);

  // TICKET_173: Helper to check if a workflow has content (moved from Host Shell)
  const hasWorkflowContent = useCallback((workflow: WorkflowRow): boolean => {
    return (
      (workflow.analysisSelections?.length > 0) ||
      (workflow.stepSelections?.length > 0)
    );
  }, []);


  // TICKET_173: Helper to run a single backtest (moved from Host Shell)
  // TICKET_1225 P4: Plan-based flow. Accepts pre-generated strategy and
  // feedPlan via dataResult.genResult / dataResult.feedPlan so that the
  // caller (handleConfirmNaming) can generate first, download data for
  // native feeds, and then invoke this without double-generating.
  const runSingleBacktest = useCallback(async (
    workflow: WorkflowRow,
    config: BacktestDataConfig,
    dataResult: any,
    strategyName?: string,
    taskId?: string,
  ): Promise<void> => {
    const api = executorAPI || (window as any).electronAPI?.executor;
    const startTime = Math.floor(new Date(config.startDate).getTime() / 1000);
    const endTime = Math.floor(new Date(config.endDate).getTime() / 1000) + 86400 - 1;

    // TICKET_1225 P4: Use pre-generated result if available (from handleConfirmNaming).
    let genResult = dataResult.genResult;
    if (!genResult) {
      // Fallback: generate inline (legacy callers that don't pre-generate)
      messageAPI?.info(t('messages.generatingStrategy'));
      genResult = await api?.generateWorkflowStrategy({
        workflows: [workflow],
        symbol: config.symbol,
        interval: extractUniqueTimeframes([workflow])[0] || INTERVAL_1d,
        startTime,
        endTime,
        initialCapital: config.initialCapital,
        confidenceWeightedSizing: config.confidenceWeightedSizing ?? false,
      });
    }

    if (!genResult?.success || !genResult?.strategyPath) {
      throw new Error(`Failed to generate strategy: ${genResult?.error}`);
    }

    // TICKET_1225 P4: The plan from codegen is authoritative. The
    // execution interval comes from the plan (finest TF); we no longer
    // derive it from the first selection's timeframe (G3 fix).
    const rawPlan = genResult.feedPlan || dataResult.feedPlan;

    // TICKET_1228: Populate feedPlan dataPaths from the data download result.
    // buildFeedPlan (codegen time) has no file paths — dataResult.dataFeeds
    // (keyed by interval) has the resolved parquet paths after download.
    // Single-TF ensure() returns dataPath but no dataFeeds map; synthesize one.
    let plan = rawPlan;
    if (rawPlan) {
      const dfMap: Record<string, { dataPath: string }> = dataResult.dataFeeds
        ? dataResult.dataFeeds as Record<string, { dataPath: string }>
        : {};
      if (!dataResult.dataFeeds && dataResult.dataPath) {
        const singleInterval = rawPlan.feeds.find((f: any) => f.source?.kind === 'parquet')?.interval;
        if (singleInterval) dfMap[singleInterval] = { dataPath: dataResult.dataPath };
      }
      plan = {
        ...rawPlan,
        feeds: rawPlan.feeds.map((f: any) => {
          if (f.source?.kind === 'parquet' && dfMap[f.interval]) {
            return { ...f, source: { kind: 'parquet', dataPath: dfMap[f.interval].dataPath } };
          }
          return f;
        }),
      };
    }

    const planInterval = plan?.executionInterval || extractUniqueTimeframes([workflow])[0] || INTERVAL_1d;

    console.debug('[BacktestPage] Strategy at:', genResult.strategyPath,
      'feedPlan:', plan ? `${plan.feeds.length} feeds, exec=${planInterval}` : 'none');

    // Run backtest
    messageAPI?.info(t('messages.runningBacktest'));

    // TICKET_414_4: Extract server_strategy_id from entry algorithm's classification_metadata
    const entrySelection = workflow.stepSelections[0];
    let serverStrategyId: number | undefined;
    if (entrySelection?.classificationMetadata) {
      try {
        const meta = JSON.parse(entrySelection.classificationMetadata);
        serverStrategyId = meta.server_strategy_id;
      } catch { /* classification_metadata parse error - skip */ }
    }

    // Build executor request inline (TICKET_173: replaces toExecutorRequest import)
    // TICKET_1225 P4: feedPlan replaces the TICKET_248 Phase 2 dataFeeds passthrough.
    // TICKET_685: Workflow backtests must NOT pass algorithmId -- the workflow generates
    // its own main.cpp that must be JIT-compiled by the runner. Passing the standalone
    // entry algorithm's ID causes ensureCppArtifact() to override strategyPath with
    // the standalone .so, skipping the composed workflow entirely.
    const isComposedWorkflow = workflow.analysisSelections.length > 0;
    const executorRequest: any = {
      taskId,  // TICKET_352_5: Caller-generated task ID
      ...(!isComposedWorkflow && entrySelection?.id ? { algorithmId: entrySelection.id } : {}),  // TICKET_650 Phase 2: Pre-compilation gate (standalone only)
      language: genResult.language,  // TICKET_660: C++ workflow support
      strategyPath: genResult.strategyPath,
      strategyName,
      symbol: config.symbol,
      interval: planInterval,
      startTime,
      endTime,
      dataPath: dataResult.dataPath || '',
      dataSourceType: 'parquet',
      initialCapital: config.initialCapital,
      orderSize: config.orderSize,
      orderSizeUnit: config.orderSizeUnit,
      // TICKET_1130 Phase 3: confidence-weighted sizing
      confidenceWeightedSizing: config.confidenceWeightedSizing ?? false,
      // TICKET_414_4: Pass server_strategy_id as strategy_id for LLM API
      ...(serverStrategyId ? { strategyParams: { strategy_id: serverStrategyId } } : {}),
      // TICKET_398: Pass dry run flag
      ...(dryRunEnabled && COCKPITS_WITH_DRY_RUN.has(cockpitMode) ? { dryRun: true } : {}),
      // TICKET_1225 P4: pass the plan opaquely to the executor
      ...(plan ? { feedPlan: plan } : {}),
    };

    const result = await api?.runBacktest(executorRequest);

    if (!result?.success) {
      // TICKET_368: Silently skip if task was cancelled during preparation
      if (result?.error?.includes('cancelled during preparation')) {
        console.info('[BacktestPage] Backtest skipped: cancelled during preparation');
        return;
      }
      throw new Error(result?.error || t('errors.startBacktestFailed'));
    }

    console.debug('[BacktestPage] Backtest started with taskId:', result.taskId);

    if (result.taskId) {
      setCurrentTaskId(result.taskId);
      // TICKET_257: Build workflowTimeframes from workflow selections
      const workflowTimeframes = {
        analysis: workflow.analysisSelections.length > 0 ? workflow.analysisSelections[0].timeframe : null,
        entryFilter: workflow.preConditionSelections.length > 0 ? workflow.preConditionSelections[0].timeframe : null,
        entrySignal: workflow.stepSelections.length > 0 ? workflow.stepSelections[0].timeframe : null,
        exitStrategy: workflow.postConditionSelections.length > 0 ? workflow.postConditionSelections[0].timeframe : null,
      };

      // TICKET_268: Build workflowExportData for Quant Lab export
      const analysisSelection = workflow.analysisSelections[0];
      const entrySelection = workflow.stepSelections[0];
      const exitSelection = workflow.postConditionSelections[0];

      // TICKET_264_1: Use config parameter instead of dataConfig to avoid stale closure
      const workflowExportData = analysisSelection && entrySelection ? {
        analysis: {
          algorithmId: String(analysisSelection.id),
          algorithmName: analysisSelection.strategyName,
          algorithmCode: analysisSelection.code || '',
          baseClass: 'RegimeStateBase',
          timeframe: analysisSelection.timeframe || config.timeframe || INTERVAL_1d,
          parameters: {},
        },
        entry: {
          algorithmId: String(entrySelection.id),
          algorithmName: entrySelection.strategyName,
          algorithmCode: entrySelection.code || '',
          baseClass: 'EntrySignalBase',
          timeframe: entrySelection.timeframe || config.timeframe || INTERVAL_1d,
          parameters: {},
        },
        exit: exitSelection ? {
          algorithmId: String(exitSelection.id),
          algorithmName: exitSelection.strategyName,
          algorithmCode: exitSelection.code || '',
          baseClass: 'ExitStrategyBase',
          timeframe: exitSelection.timeframe || config.timeframe || INTERVAL_1d,
          parameters: {},
        } : null,
        // TICKET_264_1: Use config parameter instead of dataConfig to avoid stale closure
        symbol: config.symbol,
        dateRange: {
          start: config.startDate,
          end: config.endDate,
        },
      } : undefined;

      // TICKET_233: Notify global status
      // TICKET_257: Include workflowTimeframes for result page display
      // TICKET_268: Include workflowExportData for Quant Lab export
      // TICKET_378: Include backtestConfig for result page config summary
      const backtestConfig = {
        dataSource: config.dataSource,
        symbol: config.symbol,
        startDate: config.startDate,
        endDate: config.endDate,
        initialCapital: config.initialCapital,
        orderSize: config.orderSize,
        orderSizeUnit: config.orderSizeUnit,
        confidenceWeightedSizing: config.confidenceWeightedSizing ?? false,
      };
      onBacktestStart?.(result.taskId, strategyName || 'Backtest', workflowTimeframes, workflowExportData, backtestConfig);

      // TICKET_410: Save pipeline artifacts for GO button reuse
      if (dryRunEnabled && COCKPITS_WITH_DRY_RUN.has(cockpitMode)) {
        onSavePipelineArtifacts?.(result.taskId, {
          strategyPath: genResult.strategyPath,
          dataPath: dataResult.dataPath || '',
          symbol: config.symbol,
          interval: planInterval,
          startTime,
          endTime,
          initialCapital: config.initialCapital,
          orderSize: config.orderSize,
          orderSizeUnit: config.orderSizeUnit,
          strategyName: strategyName || 'Backtest',
          strategyParams: executorRequest.strategyParams,
        });
      }

      // TICKET_375_2: Wait for executor to finish this task before returning.
      // Without this, the sequential case loop fires all cases immediately because
      // runBacktest IPC only enqueues the task and returns without waiting for completion.
      const actualTaskId = result.taskId;
      await new Promise<void>((resolve, reject) => {
        const unsubCompleted = api.onCompleted?.((data: { taskId: string }) => {
          if (data.taskId === actualTaskId) {
            unsubCompleted?.();
            unsubError?.();
            resolve();
          }
        });
        const unsubError = api.onError?.((data: { taskId: string; error: string }) => {
          if (data.taskId === actualTaskId) {
            unsubCompleted?.();
            unsubError?.();
            reject(new Error(data.error));
          }
        });
      });
      console.debug('[BacktestPage] Backtest completed, taskId:', actualTaskId);
    }
  }, [executorAPI, messageAPI, onBacktestStart, onSavePipelineArtifacts, dryRunEnabled, cockpitMode]);


  // Validate data configuration
  const validateDataConfig = useCallback((config: BacktestDataConfig): boolean => {
    const errors: Partial<Record<keyof BacktestDataConfig, string>> = {};

    if (!config.symbol) {
      errors.symbol = t('validation.symbolRequired');
    }

    if (!config.dataSource) {
      errors.dataSource = t('validation.dataSourceRequired');
    }

    if (!config.startDate) {
      errors.startDate = t('validation.startDateRequired');
    }

    if (!config.endDate) {
      errors.endDate = t('validation.endDateRequired');
    }

    if (config.startDate && config.endDate && config.startDate >= config.endDate) {
      errors.endDate = t('validation.endDateAfterStart');
    }

    // TICKET_305 Phase 3: Validate date range against maxLookback for selected timeframes
    if (config.startDate && config.endDate && maxLookback) {
      const timeframes = extractUniqueTimeframes(workflowRows);
      const startMs = new Date(config.startDate).getTime();
      const endMs = new Date(config.endDate).getTime();
      const selectedDays = Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24));

      for (const tf of timeframes) {
        const lb = maxLookback[tf];
        if (!lb) continue;
        const match = lb.match(/^(\d+)d$/);
        if (match) {
          const maxDays = parseInt(match[1], 10);
          if (selectedDays > maxDays) {
            errors.startDate = t('validation.lookbackExceeded', { timeframe: tf, lookback: lb, selected: selectedDays });
            break;
          }
        }
      }
    }

    if (config.initialCapital <= 0) {
      errors.initialCapital = t('validation.initialCapitalPositive');
    }

    if (config.orderSize <= 0) {
      errors.orderSize = t('validation.orderSizePositive');
    }

    setDataConfigErrors(errors);
    return Object.keys(errors).length === 0;
  }, [maxLookback, workflowRows]);

  // TICKET_163: Show naming dialog instead of direct execute
  const handleShowNamingDialog = useCallback(() => {
    if (isExecuting) return;

    // Validate data configuration first
    if (!validateDataConfig(dataConfig)) {
      console.error('[E:BACKTEST:DATA_CONFIG_VALIDATION_FAILED] [BacktestPage] Data configuration validation failed');
      return;
    }

    // Validate workflow has content
    const workflow = workflowRows[0];
    if (!workflow || !hasWorkflowContent(workflow)) {
      messageAPI?.error(t('messages.noWorkflowsConfigured'));
      return;
    }

    // TICKET_586: Validate both Market Analysis and Entry Signal for regime-based cockpits
    if (COCKPITS_WITH_MANDATORY_BOTH.has(cockpitMode)) {
      if (!(workflow.analysisSelections?.length > 0) || !(workflow.stepSelections?.length > 0)) {
        const missingAnalysis = !(workflow.analysisSelections?.length > 0);
        messageAPI?.error(t(missingAnalysis
          ? 'messages.missingMarketAnalysis'
          : 'messages.missingEntrySignal'
        ));
        return;
      }
    }

    // Show naming dialog
    setNamingDialogVisible(true);
  }, [isExecuting, dataConfig, validateDataConfig, workflowRows, hasWorkflowContent, messageAPI, t, cockpitMode]);

  // TICKET_163: Handle naming dialog confirm - execute with strategy name
  // TICKET_173: Full execution logic moved from Host Shell
  // TICKET_1222: Single-workflow execution (multi-case batch removed)
  const handleConfirmNaming = useCallback(async (strategyName: string) => {
    setNamingDialogVisible(false);
    setExecuteError(null);

    const workflow = workflowRows[0];
    if (!workflow || !hasWorkflowContent(workflow)) return;

    console.log('[BacktestPage] Executing backtest with name:', strategyName);
    console.log('[BacktestPage] Config:', dataConfig);

    const taskId = crypto.randomUUID();

    // TICKET_366: Register task in main process queue before execution starts
    const executorApi = executorAPI || (window as any).electronAPI?.executor;
    await executorApi?.registerTask?.(taskId, strategyName);

    setIsExecuting(true);

    try {
      const isDryRun = dryRunEnabled && COCKPITS_WITH_DRY_RUN.has(cockpitMode);
      onExecutionBegin?.(strategyName, taskId, {
        cockpit: cockpitMode,
        dataConfig: { ...dataConfig },
        workflowRows: workflowRows.map(row => ({ ...row })),
      }, isDryRun);

      // TICKET_1225 P4: Generate strategy first to obtain the FeedPlan.
      // The plan is the single source of truth for which TFs to download
      // and how they map to data(N) indices in the generated C++.
      const startTime = Math.floor(new Date(dataConfig.startDate).getTime() / 1000);
      const endTime = Math.floor(new Date(dataConfig.endDate).getTime() / 1000) + 86400 - 1;

      messageAPI?.info(t('messages.generatingStrategy'));
      const genResult = await executorApi?.generateWorkflowStrategy({
        workflows: [workflow],
        symbol: dataConfig.symbol,
        interval: extractUniqueTimeframes([workflow])[0] || INTERVAL_1d,
        startTime,
        endTime,
        initialCapital: dataConfig.initialCapital,
        confidenceWeightedSizing: dataConfig.confidenceWeightedSizing ?? false,
      });

      if (!genResult?.success || !genResult?.strategyPath) {
        throw new Error(`Failed to generate strategy: ${genResult?.error}`);
      }

      const feedPlan = genResult.feedPlan;
      console.debug('[BacktestPage] Strategy generated, feedPlan:',
        feedPlan ? `${feedPlan.feeds.length} feeds, exec=${feedPlan.executionInterval}` : 'none');

      // TICKET_1225 P4: Download data for the plan's NATIVE feeds only.
      // Derived TFs (source.kind === 'resample') are engine-side and need
      // no download. This replaces the old extractUniqueTimeframes + raw
      // ensureMultiTimeframe flow and the TICKET_248 dataFeeds passthrough.
      messageAPI?.info(t('messages.loadingMarketData', { symbol: dataConfig.symbol }));
      const dataApi = dataAPI || (window as any).electronAPI?.data;

      const nativeIntervals = feedPlan
        ? feedPlan.feeds
            .filter((f: any) => f.source?.kind === 'parquet')
            .map((f: any) => f.interval as string)
        : extractUniqueTimeframes([workflow]);

      let dataResult: any;
      if (nativeIntervals.length > 1 && dataApi?.ensureMultiTimeframe) {
        dataResult = await dataApi.ensureMultiTimeframe({
          symbol: dataConfig.symbol,
          startDate: dataConfig.startDate,
          endDate: dataConfig.endDate,
          timeframes: nativeIntervals,
          provider: dataConfig.dataSource,
          forceDownload: false,
          callerId: 'backtest',
        });
      } else {
        dataResult = await dataApi?.ensure({
          symbol: dataConfig.symbol,
          startDate: dataConfig.startDate,
          endDate: dataConfig.endDate,
          interval: nativeIntervals[0] || INTERVAL_1d,
          provider: dataConfig.dataSource,
          forceDownload: false,
          callerId: 'backtest',
        });
      }

      if (!dataResult?.success) {
        throw new Error(`Failed to load data: ${dataResult?.error}`);
      }

      // Attach feedPlan and genResult to dataResult so runSingleBacktest
      // can skip redundant codegen and forward the plan opaquely.
      dataResult.feedPlan = feedPlan;
      dataResult.genResult = genResult;

      // Run single backtest
      await runSingleBacktest(workflow, dataConfig, dataResult, strategyName, taskId);

      setIsExecuting(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('messages.executionFailed');
      messageAPI?.error(msg);
      console.error('[E:BACKTEST:EXECUTE_EXCEPTION] [BacktestPage] Execute error:', error);
      setExecuteError(msg);
      setIsExecuting(false);
    }
  }, [dataConfig, workflowRows, hasWorkflowContent, runSingleBacktest, dataAPI, executorAPI, messageAPI, onExecutionBegin, cockpitMode, dryRunEnabled, t]);

  // TICKET_163: Handle naming dialog cancel
  const handleCancelNaming = useCallback(() => {
    setNamingDialogVisible(false);
  }, []);

  return (
    <div className="h-full flex flex-col bg-color-terminal-bg text-color-terminal-text">
      {/* TICKET_591: Zone A removed - title and settings icon merged into BreadcrumbBar */}

      {/* Zone B + C + D */}
      <div className="flex-1 flex overflow-hidden">
        {/* Zone B: History Sidebar - TICKET_077_18 Modularized */}
        <BacktestHistorySidebar
          isExecuting={isExecuting}
          resultsCount={0}
          historyItems={historyItems}
          historyLoading={historyLoading}
          checkpointInfo={checkpointInfo ? {
            taskId: checkpointInfo.taskId,
            progressPercent: checkpointInfo.progressPercent,
          } : null}
          showCheckpointPanel={showCheckpointPanel}
          onHistoryItemClick={handleHistoryItemClick}
          onDeleteClick={handleDeleteClick}
          onShowCheckpointPanel={() => setShowCheckpointPanel(true)}
        />

        {/* Zone C + Zone D */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Zone C: Config or Result based on state */}
          <div className="flex-1 overflow-y-auto p-6">
          {/* TICKET_162: Show selected history result (page41) */}
          {selectedHistoryResult ? (
            <div className="h-full flex flex-col">
              {/* TICKET_162: History result title header - two rows */}
              {selectedHistoryItem && (
                <div className="flex-shrink-0 mb-4 px-4 py-3 rounded border border-color-terminal-border bg-color-terminal-panel/50 space-y-2">
                  {/* Row 1: Strategy, Symbol, Timeframe, Data Range, Return */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-color-terminal-text">
                        {selectedHistoryItem.name}
                      </span>
                      <span className="text-xs text-color-terminal-text-muted">|</span>
                      <span className="text-sm font-bold text-color-terminal-accent-teal">
                        {selectedHistoryItem.symbol}
                      </span>
                      <span className="text-xs text-color-terminal-text-secondary">
                        {selectedHistoryItem.timeframe}
                      </span>
                      <span className="text-xs text-color-terminal-text-muted">
                        {selectedHistoryItem.startDate} ~ {selectedHistoryItem.endDate}
                      </span>
                    </div>
                    <span className={cn(
                      "text-sm font-bold",
                      (selectedHistoryItem.totalReturn ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                    )}>
                      {selectedHistoryItem.totalReturn !== null
                        ? `${(selectedHistoryItem.totalReturn >= 0 ? '+' : '')}${(selectedHistoryItem.totalReturn * 100).toFixed(2)}%`
                        : '-'}
                    </span>
                  </div>
                  {/* Row 2: Cap, Size, Test Time */}
                  <div className="flex items-center justify-between text-[11px] text-color-terminal-text-muted">
                    <div className="flex items-center gap-4">
                      <span>{t('sidebar.capLabel')} <span className="text-color-terminal-text-secondary">
                        ${selectedHistoryItem.initialCapital >= 1000
                          ? `${(selectedHistoryItem.initialCapital / 1000).toFixed(0)}K`
                          : selectedHistoryItem.initialCapital}
                      </span></span>
                      {selectedHistoryItem.orderSize !== null && selectedHistoryItem.orderSizeUnit && (
                        <span>{t('sidebar.sizeLabel')} <span className="text-color-terminal-text-secondary">
                          {selectedHistoryItem.orderSizeUnit === 'percent'
                            ? `${selectedHistoryItem.orderSize}%`
                            : selectedHistoryItem.orderSizeUnit === 'cash'
                              ? `$${selectedHistoryItem.orderSize}`
                              : `${selectedHistoryItem.orderSize}sh`}
                        </span></span>
                      )}
                    </div>
                    <span>{t('sidebar.testedLabel')} <span className="text-color-terminal-text-secondary">{selectedHistoryItem.createdAt}</span></span>
                  </div>
                </div>
              )}
              <BacktestResultPanel
                results={[selectedHistoryResult]}
                className="flex-1"
                isExecuting={false}
                isQuantLabAvailable={isQuantLabAvailable}
                isQuantLabLoading={isQuantLabLoading}
                isExporting={isExporting}
                onExportToQuantLab={handleExportClick}
              />
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-color-terminal-text-muted">
                {t('page.loadingAlgorithms')}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* TICKET_176_1: Checkpoint Resume Panel */}
              {showCheckpointPanel && checkpointInfo && (
                <CheckpointResumePanel
                  checkpoint={checkpointInfo}
                  onResume={handleCheckpointResume}
                  onDiscard={handleCheckpointDiscard}
                  isResuming={isResuming}
                />
              )}

              {/* Data Configuration Panel */}
              <BacktestDataConfigPanel
                value={dataConfig}
                onChange={handleDataConfigChange}
                dataSources={dataSources}
                onSymbolSearch={handleSymbolSearch}
                errors={dataConfigErrors}
                disabled={isExecuting}
                isAuthenticated={isAuthenticated}
                maxLookback={maxLookback}
                mostRestrictivelookbackBars={mostRestrictivelookbackBars}
              />

              {/* Component 7: Workflow Row Selector */}
              <WorkflowRowSelector
                title={t('page.workflowTitle')}
                rows={workflowRows}
                onChange={setWorkflowRows}
                algorithms={algorithms}
                disableConditions={true}
                disableAnalysis={COCKPITS_WITH_DISABLED_ANALYSIS.has(cockpitMode)}
                disablePreCondition={COCKPITS_WITH_DISABLED_FILTER.has(cockpitMode)}
                allowedIntervals={allowedIntervals}
              />
            </div>
          )}
        </div>

        {/* Zone D: Action Bar */}
        <div className="flex-shrink-0 border-t border-color-terminal-border bg-color-terminal-surface/50 p-4">
          {/* TICKET_143: Execute error display */}
          {executeError && (
            <div className="mb-3 p-3 rounded border border-red-500/50 bg-red-500/10 text-red-400 text-sm terminal-mono">
              {executeError}
            </div>
          )}
          {/* TICKET_162: Check selectedHistoryResult or results array */}
          {selectedHistoryResult ? (
            /* Show "New Backtest" button when history result is displayed - smaller, right-aligned */
            <div className="flex justify-end">
              <button
                onClick={handleClearHistoryResult}
                className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold border rounded transition-all border-color-terminal-accent-teal bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal hover:bg-color-terminal-accent-teal/20"
              >
                <PlayIcon className="w-3 h-3" />
                {t('buttons.newBacktest')}
              </button>
            </div>
          ) : (
            /* TICKET_171: Reset left, Execute right */
            <div className="flex justify-between items-center">
              {/* Reset button - left */}
              <button
                onClick={handleReset}
                disabled={isExecuting}
                className={cn(
                  "flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold border rounded transition-all",
                  isExecuting
                    ? "border-color-terminal-border bg-color-terminal-surface text-color-terminal-text-muted cursor-not-allowed"
                    : "border-color-terminal-text-muted bg-transparent text-color-terminal-text-secondary hover:border-color-terminal-text-secondary hover:text-color-terminal-text"
                )}
              >
                <RotateCcwIcon className="w-3 h-3" />
                {t('buttons.reset')}
              </button>
              {/* TICKET_398: Show DryRunExecuteButton for kronos/trader, plain button for indicators */}
              {COCKPITS_WITH_DRY_RUN.has(cockpitMode) ? (
                <DryRunExecuteButton
                  dryRunEnabled={dryRunEnabled}
                  onToggle={() => setDryRunEnabled(prev => !prev)}
                  onExecute={handleShowNamingDialog}
                  isExecuting={isExecuting}
                  executeLabel={t('buttons.execute')}
                  executingLabel={t('buttons.executing')}
                />
              ) : (
                <button
                  onClick={handleShowNamingDialog}
                  disabled={isExecuting}
                  className={cn(
                    "flex items-center justify-center gap-2 px-6 py-2 text-xs font-bold border rounded transition-all",
                    isExecuting
                      ? "border-color-terminal-border bg-color-terminal-surface text-color-terminal-text-muted cursor-not-allowed"
                      : "border-color-terminal-accent-gold bg-color-terminal-accent-gold/10 text-color-terminal-accent-gold hover:bg-color-terminal-accent-gold/20"
                  )}
                >
                  {isExecuting ? (
                    <>
                      <LoaderIcon className="w-3 h-3 animate-spin" />
                      {t('buttons.executing')}
                    </>
                  ) : (
                    <>
                      <PlayIcon className="w-3 h-3" />
                      {t('buttons.execute')}
                    </>
                  )}
                </button>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* TICKET_163: Naming dialog (component10) */}
      <NamingDialog
        visible={namingDialogVisible}
        context="backtest"
        contextData={{
          symbol: dataConfig.symbol,
          timeframe: dataConfig.timeframe,
        }}
        onConfirm={handleConfirmNaming}
        onCancel={handleCancelNaming}
      />

      {/* TICKET_264: Export to Quant Lab naming dialog */}
      <NamingDialog
        visible={exportDialogVisible}
        context="export"
        contextData={{
          workflowName: `${dataConfig.symbol}_${dataConfig.timeframe || ''}`,
          // Get first analysis algorithm name from workflowRows
          analysisName: workflowRows[0]?.analysisSelections[0]?.strategyName,
          // Get first entry signal algorithm name from workflowRows
          entryName: workflowRows[0]?.stepSelections[0]?.strategyName,
        }}
        onConfirm={handleExportConfirm}
        onCancel={handleExportCancel}
      />
    </div>
  );
};

export default BacktestPage;
