/**
 * BacktestResultPanel Component (component9)
 *
 * TICKET_152: Backtest Result Display
 * TICKET_358: Refactored to slim orchestrator using tab registry
 *
 * Displays backtest results with Charts/Trades/Compare tabs.
 * Uses ExecutorResult from V3 architecture.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@shared/utils/format-locale';
import { useElapsedTimer } from '@shared/hooks/useElapsedTimer';
import { formatElapsedFixed as formatElapsed } from '@shared/utils/formatElapsedMs';
import { cn } from '../../../lib/utils';
import type { ExecutorResult, WorkflowTimeframes, BacktestConfigSummary, FeedBarCountEntry } from './types';
import { getVisibleTabs, isTabDisabled } from './tab-registry';
import { ConfigSummaryTable } from './ConfigSummaryTable';

// -----------------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------------

export interface BacktestResultPanelProps {
  /** TICKET_151: Support single result (legacy) or array of results for comparison */
  result?: ExecutorResult;
  results?: ExecutorResult[];
  className?: string;
  /** TICKET_151_1: Execution state for Charts stacking and Compare tab behavior */
  isExecuting?: boolean;
  currentCaseIndex?: number;
  totalCases?: number;
  onCaseSelect?: (index: number) => void;
  /** TICKET_151_1: Index to scroll to when user clicks case in History panel */
  scrollToCase?: number;
  /** TICKET_231: Number of bars processed so far (for gray-to-color transition) */
  processedBars?: number;
  /** TICKET_231: Total bars in backtest (for gray-to-color transition) */
  backtestTotalBars?: number;
  /** TICKET_374: Whether backtest was cancelled */
  isCancelled?: boolean;
  /** TICKET_401: Executor progress (0-100) for progressive chart rendering */
  executorProgress?: number;
  /** TICKET_257: Workflow timeframes for display in tab header */
  workflowTimeframes?: WorkflowTimeframes;
  /** TICKET_378: Backtest configuration summary for result page display */
  backtestConfig?: BacktestConfigSummary;
  /** TICKET_267: Export to Quant Lab */
  isQuantLabAvailable?: boolean;
  isQuantLabLoading?: boolean;
  isExporting?: boolean;
  onExportToQuantLab?: () => void;
  /** TICKET_398_2: Real-time dry run LLM call estimation */
  dryRunResult?: {
    totalBars: number;
    llmCalls: Array<{ label: string; count: number }>;
    totalLlmCalls: number;
  };
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const BacktestResultPanel: React.FC<BacktestResultPanelProps> = ({
  result,
  results = [],
  className,
  isExecuting = false,
  isCancelled = false,
  currentCaseIndex = 0,
  totalCases = 0,
  scrollToCase,
  processedBars = 0,
  backtestTotalBars = 0,
  executorProgress = 0,
  workflowTimeframes,
  backtestConfig,
  dryRunResult,
}) => {
  const { t } = useTranslation('backtest');
  const [activeTab, setActiveTab] = useState('charts');

  // TICKET_151_2: Refs for scrolling in both Charts and Trades tabs
  const scrollToChartsCaseRef = React.useRef<((index: number) => void) | null>(null);
  const scrollToTradesCaseRef = React.useRef<((index: number) => void) | null>(null);
  const lastScrollToCaseRef = useRef<number | undefined>(undefined);

  // TICKET_151_2: Scroll to case in active tab when scrollToCase prop changes
  useEffect(() => {
    if (scrollToCase !== undefined && scrollToCase >= 0 && scrollToCase !== lastScrollToCaseRef.current) {
      lastScrollToCaseRef.current = scrollToCase;
      setTimeout(() => {
        if (activeTab === 'charts') {
          scrollToChartsCaseRef.current?.(scrollToCase);
        } else if (activeTab === 'trades') {
          scrollToTradesCaseRef.current?.(scrollToCase);
        }
      }, 100);
    }
  }, [scrollToCase, activeTab]);

  // TICKET_151: Support both single result and results array
  const allResults: ExecutorResult[] = results.length > 0
    ? results
    : (result ? [result] : []);

  // TICKET_302: Empty Structure pattern
  // TICKET_374: Show cancelled state in chart area instead of "no results"
  if (allResults.length === 0 && !isExecuting && !isCancelled) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <div className="text-color-terminal-text-muted">{t('resultPanel.status.noResults')}</div>
      </div>
    );
  }

  // TICKET_302: When executing but no data yet, use empty result for chart structure
  const effectiveResults: ExecutorResult[] = allResults.length > 0
    ? allResults
    : [{
        success: true,
        startTime: 0,
        endTime: 0,
        executionTimeMs: 0,
        metrics: {
          totalPnl: 0,
          totalReturn: 0,
          sharpeRatio: 0,
          maxDrawdown: 0,
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          profitFactor: 0,
        },
        equityCurve: [],
        trades: [],
        candles: [],
      }];

  const hasMultipleResults = effectiveResults.length > 1;

  // Elapsed timer: ticks while executing, freezes on completion (TICKET_404)
  const elapsedMs = useElapsedTimer(isExecuting);
  const displayTimeMs = elapsedMs;
  // TICKET_358: Registry-driven tabs
  const tabs = getVisibleTabs({ hasMultipleResults });
  const disabledCtx = { isExecuting, hasMultipleResults };

  // Find active tab definition
  const activeTabDef = tabs.find((tab) => tab.id === activeTab) || tabs[0];

  // Resolve scrollToCaseRef based on active tab
  const activeScrollRef = activeTab === 'charts'
    ? scrollToChartsCaseRef
    : activeTab === 'trades'
      ? scrollToTradesCaseRef
      : undefined;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* TICKET_378: Config Summary Table - outside bordered container */}
      {backtestConfig && (
        <ConfigSummaryTable
          config={backtestConfig}
          workflowTimeframes={workflowTimeframes}
          feedBarCounts={effectiveResults[0]?.feedBarCounts}
          warmupEndTimestamp={effectiveResults[0]?.warmupEndTimestamp}
          className="mb-2"
        />
      )}

      <div className="flex flex-col border border-color-terminal-border rounded-lg bg-color-terminal-panel/30">
      {/* TICKET_398_2: Real-time LLM Call Estimate (shown during execution and after completion) */}
      {dryRunResult && (
        <div className="mx-3 mt-2 rounded border border-color-terminal-accent-primary/30 bg-color-terminal-accent-primary/5 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-color-terminal-accent-primary mb-2">
            {t('resultPanel.llmEstimate')}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <div className="text-color-terminal-text-muted">{t('resultPanel.barsProcessed')}</div>
            <div className="text-color-terminal-text font-mono">{dryRunResult.totalBars.toLocaleString(getIntlLocale())}</div>
            {dryRunResult.llmCalls.map((call, idx) => (
              <React.Fragment key={idx}>
                <div className="text-color-terminal-text-muted">{call.label}</div>
                <div className="text-color-terminal-text font-mono">{call.count.toLocaleString(getIntlLocale())} {t('resultPanel.calls')}</div>
              </React.Fragment>
            ))}
            <div className="col-span-2 border-t border-color-terminal-border/30 my-1" />
            <div className="text-color-terminal-text font-bold">{t('resultPanel.totalLlmCalls')}</div>
            <div className="text-color-terminal-accent-primary font-mono font-bold">
              {dryRunResult.totalLlmCalls.toLocaleString(getIntlLocale())}
            </div>
          </div>
        </div>
      )}

      {/* Tab Header */}
      <div className="flex items-center justify-between border-b border-color-terminal-border">
        {/* Left: Tab Buttons */}
        <div className="flex">
          {tabs.map((tab) => {
            const disabled = isTabDisabled(tab, disabledCtx);
            return (
              <button
                key={tab.id}
                onClick={() => !disabled && setActiveTab(tab.id)}
                disabled={disabled}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors border-b-2',
                  activeTabDef.id === tab.id
                    ? 'border-color-terminal-accent-gold text-color-terminal-accent-gold'
                    : 'border-transparent text-color-terminal-text-muted hover:text-color-terminal-text',
                  disabled && 'opacity-50 cursor-not-allowed hover:text-color-terminal-text-muted'
                )}
              >
                {tab.icon}
                {t(tab.label)}
              </button>
            );
          })}
        </div>

        {/* Center: Elapsed Timer */}
        {displayTimeMs > 0 && (
          <div className="flex items-center gap-1.5 font-mono text-xs text-color-terminal-text-muted">
            <span className="text-[10px] uppercase tracking-wider">{t('resultPanel.elapsed')}</span>
            <span className={cn(
              'tabular-nums',
              isExecuting ? 'text-color-terminal-accent-primary' : 'text-color-terminal-text'
            )}>
              {formatElapsed(displayTimeMs)}
            </span>
          </div>
        )}

        {/* Right: TICKET_1225 P5 — Timeframe chips from engine result (ground truth) */}
        {/* When feedBarCounts is available from the result, render from it (truth from engine).
            Fall back to workflowTimeframes (UI state) for older runner builds. */}
        {effectiveResults[0]?.feedBarCounts && effectiveResults[0].feedBarCounts.length > 0 ? (
          <div className="flex items-center gap-1.5 pr-4">
            {effectiveResults[0].feedBarCounts.map((entry, idx) => (
              <React.Fragment key={entry.index}>
                {idx > 0 && <span className="mx-1 text-color-terminal-border">|</span>}
                <span className={cn(
                  'px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border',
                  entry.index === 0
                    ? 'border-color-terminal-accent-teal bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal'
                    : 'border-color-workflow-purple bg-color-workflow-purple/10 text-color-workflow-purple'
                )}>
                  {entry.interval || `feed${entry.index}`}
                </span>
                <span className="text-[10px] text-color-terminal-text-muted tabular-nums">
                  {entry.bars.toLocaleString(getIntlLocale())} {t('resultPanel.bars', 'bars')}
                </span>
              </React.Fragment>
            ))}
          </div>
        ) : workflowTimeframes ? (
          <div className="flex items-center gap-1.5 pr-4">
            {/* Market Analysis */}
            <button
              disabled={!workflowTimeframes.analysis}
              className={cn(
                'px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border transition-all',
                workflowTimeframes.analysis
                  ? 'border-color-terminal-accent-teal bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal'
                  : 'border-color-terminal-border bg-color-terminal-surface/50 text-color-terminal-text-muted cursor-not-allowed opacity-50'
              )}
            >
              {workflowTimeframes.analysis || '-'}
            </button>
            <span className="text-[12px] text-color-terminal-text-muted uppercase tracking-wider">
              {t('workflowSteps.marketAnalysis')}
            </span>

            <span className="mx-1 text-color-terminal-border">|</span>

            {/* Entry Filter */}
            <button
              disabled={!workflowTimeframes.entryFilter}
              className={cn(
                'px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border transition-all',
                workflowTimeframes.entryFilter
                  ? 'border-color-workflow-purple bg-color-workflow-purple/10 text-color-workflow-purple'
                  : 'border-color-terminal-border bg-color-terminal-surface/50 text-color-terminal-text-muted cursor-not-allowed opacity-50'
              )}
            >
              {workflowTimeframes.entryFilter || '-'}
            </button>
            <span className="text-[12px] text-color-terminal-text-muted uppercase tracking-wider">
              {t('workflowSteps.entryFilter')}
            </span>

            <span className="mx-1 text-color-terminal-border">|</span>

            {/* Entry Signal */}
            <button
              disabled={!workflowTimeframes.entrySignal}
              className={cn(
                'px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border transition-all',
                workflowTimeframes.entrySignal
                  ? 'border-color-workflow-blue bg-color-workflow-blue/10 text-color-workflow-blue'
                  : 'border-color-terminal-border bg-color-terminal-surface/50 text-color-terminal-text-muted cursor-not-allowed opacity-50'
              )}
            >
              {workflowTimeframes.entrySignal || '-'}
            </button>
            <span className="text-[12px] text-color-terminal-text-muted uppercase tracking-wider">
              {t('workflowSteps.entrySignal')}
            </span>

            <span className="mx-1 text-color-terminal-border">|</span>

            {/* Exit Strategy */}
            <button
              disabled={!workflowTimeframes.exitStrategy}
              className={cn(
                'px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border transition-all',
                workflowTimeframes.exitStrategy
                  ? 'border-color-workflow-gold bg-color-workflow-gold/10 text-color-workflow-gold'
                  : 'border-color-terminal-border bg-color-terminal-surface/50 text-color-terminal-text-muted cursor-not-allowed opacity-50'
              )}
            >
              {workflowTimeframes.exitStrategy || '-'}
            </button>
            <span className="text-[12px] text-color-terminal-text-muted uppercase tracking-wider">
              {t('workflowSteps.exitStrategy')}
            </span>

          </div>
        ) : null}

        {/* TICKET_267: Export button moved to BacktestResultPage footer */}
      </div>

      {/* Tab Content - TICKET_358: Registry-driven rendering */}
      <div>
        {activeTabDef && (
          <activeTabDef.component
            results={effectiveResults}
            currentCaseIndex={currentCaseIndex}
            isExecuting={isExecuting}
            isCancelled={isCancelled}
            totalCases={totalCases}
            scrollToCaseRef={activeScrollRef}
            processedBars={processedBars}
            backtestTotalBars={backtestTotalBars}
            executorProgress={executorProgress}
          />
        )}
      </div>
      </div>
    </div>
  );
};

export default BacktestResultPanel;
