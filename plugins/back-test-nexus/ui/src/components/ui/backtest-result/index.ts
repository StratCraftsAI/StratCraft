/**
 * TICKET_358: Barrel export for backtest result module
 */

export { BacktestResultPanel, default } from './BacktestResultPanel';
export type { BacktestResultPanelProps } from './BacktestResultPanel';

export type {
  ExecutorResult,
  ExecutorMetrics,
  ExecutorTrade,
  EquityPoint,
  Candle,
  WorkflowTimeframes,
  BacktestConfigSummary,
} from './types';

export { ConfigSummaryTable } from './ConfigSummaryTable';
export type { ConfigSummaryTableProps } from './ConfigSummaryTable';

export {
  RESULT_TAB_REGISTRY,
  getVisibleTabs,
  isTabDisabled,
} from './tab-registry';
export type {
  ResultTabDefinition,
  ResultTabComponentProps,
  TabVisibilityContext,
  TabDisabledContext,
} from './tab-registry';

export { STRATEGY_COLORS } from './ComparisonTab';
