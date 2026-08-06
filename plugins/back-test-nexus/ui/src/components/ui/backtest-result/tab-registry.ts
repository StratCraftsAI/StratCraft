/**
 * TICKET_358: Declarative tab registry for backtest result panel
 */

import React from 'react';
import type { ExecutorResult } from './types';
import { CandleChartIcon, ListIcon, CompareIcon } from './icons';
import { ChartsTab } from './ChartsTab';
import { TradesTab } from './TradesTab';
import { ComparisonTab } from './ComparisonTab';

// -----------------------------------------------------------------------------
// Props interface shared by all tab content components
// -----------------------------------------------------------------------------

export interface ResultTabComponentProps {
  results: ExecutorResult[];
  currentCaseIndex?: number;
  isExecuting?: boolean;
  /** TICKET_374: Whether backtest was cancelled */
  isCancelled?: boolean;
  totalCases?: number;
  scrollToCaseRef?: React.MutableRefObject<((index: number) => void) | null>;
  processedBars?: number;
  backtestTotalBars?: number;
  /** TICKET_401: Executor progress (0-100) for progressive chart rendering */
  executorProgress?: number;
}

// -----------------------------------------------------------------------------
// Tab definition types
// -----------------------------------------------------------------------------

export interface TabVisibilityContext {
  hasMultipleResults: boolean;
}

export interface TabDisabledContext {
  isExecuting: boolean;
  hasMultipleResults: boolean;
}

export interface ResultTabDefinition {
  id: string;
  label: string;
  icon: React.ReactNode;
  component: React.ComponentType<ResultTabComponentProps>;
  order: number;
  visible?: (ctx: TabVisibilityContext) => boolean;
  disabled?: (ctx: TabDisabledContext) => boolean;
}

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

export const RESULT_TAB_REGISTRY: ResultTabDefinition[] = [
  {
    id: 'comparison',
    label: 'resultPanel.tabs.compare',
    icon: React.createElement(CompareIcon, { className: 'w-4 h-4' }),
    component: ComparisonTab,
    order: 0,
    visible: (ctx) => ctx.hasMultipleResults,
    disabled: (ctx) => ctx.isExecuting,
  },
  {
    id: 'charts',
    label: 'resultPanel.tabs.charts',
    icon: React.createElement(CandleChartIcon, { className: 'w-4 h-4' }),
    component: ChartsTab,
    order: 10,
  },
  {
    id: 'trades',
    label: 'resultPanel.tabs.trades',
    icon: React.createElement(ListIcon, { className: 'w-4 h-4' }),
    component: TradesTab,
    order: 20,
  },
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

export function getVisibleTabs(ctx: TabVisibilityContext): ResultTabDefinition[] {
  return RESULT_TAB_REGISTRY
    .filter((tab) => !tab.visible || tab.visible(ctx))
    .sort((a, b) => a.order - b.order);
}

export function isTabDisabled(tab: ResultTabDefinition, ctx: TabDisabledContext): boolean {
  return tab.disabled ? tab.disabled(ctx) : false;
}
