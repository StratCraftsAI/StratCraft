/**
 * Export to Quant Lab Hook
 *
 * TICKET_264: Regime Algorithm to Signal Source Conversion
 *
 * Hook for exporting workflow configurations to Quant Lab as Signal Sources.
 */

import { useState, useCallback } from 'react';
import i18n from 'i18next';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ComponentExportConfig {
  algorithmId: string;
  algorithmName: string;
  algorithmCode: string;
  baseClass: string;
  timeframe: string;
  parameters: Record<string, unknown>;
}

export interface BacktestMetricsExport {
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  profitFactor?: number;
}

export interface WorkflowExportConfig {
  // Analysis component (required)
  analysis: ComponentExportConfig;
  // Entry component (required)
  entry: ComponentExportConfig;
  // Exit component (optional)
  exit?: ComponentExportConfig | null;
  // Original backtest config
  symbol: string;
  interval: string;
  dataProvider: string;
  dateRange: {
    start: string;
    end: string;
  };
  initialCapital?: number;
}

export interface ExportWorkflowParams {
  name: string;
  workflow: WorkflowExportConfig;
  backtestMetrics: BacktestMetricsExport;
}

export interface UseExportToQuantLabReturn {
  /** Export workflow to Quant Lab */
  exportWorkflow: (params: ExportWorkflowParams) => Promise<void>;
  /** Whether export is in progress */
  isExporting: boolean;
  /** Error message if export failed */
  error: string | null;
  /** Clear error state */
  clearError: () => void;
}

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

/**
 * Hook for exporting workflows to Quant Lab
 *
 * @example
 * ```tsx
 * const { exportWorkflow, isExporting, error } = useExportToQuantLab();
 *
 * const handleExport = async () => {
 *   await exportWorkflow({
 *     name: 'My Strategy',
 *     workflow: { ... },
 *     backtestMetrics: { ... },
 *   });
 * };
 * ```
 */
export function useExportToQuantLab(): UseExportToQuantLabReturn {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const exportWorkflow = useCallback(async (params: ExportWorkflowParams) => {
    setIsExporting(true);
    setError(null);

    try {
      // Access the preload API (electronAPI exposed by preload)
      const api = (window as any).electronAPI;
      if (!api?.executor?.exportToQuantLab) {
        throw new Error('Export API not available');
      }

      const exportData = {
        name: params.name,

        // Analysis component
        analysis: {
          algorithmId: params.workflow.analysis.algorithmId,
          algorithmName: params.workflow.analysis.algorithmName,
          algorithmCode: params.workflow.analysis.algorithmCode,
          baseClass: params.workflow.analysis.baseClass,
          timeframe: params.workflow.analysis.timeframe,
          parameters: params.workflow.analysis.parameters,
        },

        // Entry component
        entry: {
          algorithmId: params.workflow.entry.algorithmId,
          algorithmName: params.workflow.entry.algorithmName,
          algorithmCode: params.workflow.entry.algorithmCode,
          baseClass: params.workflow.entry.baseClass,
          timeframe: params.workflow.entry.timeframe,
          parameters: params.workflow.entry.parameters,
        },

        // Exit component (optional)
        exit: params.workflow.exit ? {
          algorithmId: params.workflow.exit.algorithmId,
          algorithmName: params.workflow.exit.algorithmName,
          algorithmCode: params.workflow.exit.algorithmCode,
          baseClass: params.workflow.exit.baseClass,
          timeframe: params.workflow.exit.timeframe,
          parameters: params.workflow.exit.parameters,
        } : null,

        // Backtest metrics
        backtestMetrics: {
          sharpe: params.backtestMetrics.sharpe,
          maxDrawdown: params.backtestMetrics.maxDrawdown,
          winRate: params.backtestMetrics.winRate,
          totalTrades: params.backtestMetrics.totalTrades,
          profitFactor: params.backtestMetrics.profitFactor,
        },

        // Original config
        symbol: params.workflow.symbol,
        interval: params.workflow.interval,
        dataProvider: params.workflow.dataProvider,
        dateRangeStart: params.workflow.dateRange.start,
        dateRangeEnd: params.workflow.dateRange.end,
        initialCapital: params.workflow.initialCapital,
      };

      const result = await api.executor.exportToQuantLab(exportData);

      if (!result.success) {
        throw new Error(result.error || i18n.t('errors.exportFallback', { ns: 'backtest' }));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : i18n.t('errors.exportFallback', { ns: 'backtest' });
      setError(errorMessage);
      throw err;
    } finally {
      setIsExporting(false);
    }
  }, []);

  return {
    exportWorkflow,
    isExporting,
    error,
    clearError,
  };
}
