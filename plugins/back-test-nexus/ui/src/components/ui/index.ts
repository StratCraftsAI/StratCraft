export {
  WorkflowDropdown,
  type AlgorithmOption,
  type ColorTheme,
  type WorkflowDropdownProps,
} from './WorkflowDropdown';

export {
  WorkflowRowSelector,
  type AlgorithmSelection,
  type WorkflowRow,
  type WorkflowRowSelectorProps,
} from './WorkflowRowSelector';

// TICKET_248: Stage-Level Timeframe Selector
export {
  TimeframeDropdown,
  type TimeframeValue,
  type TimeframeDropdownProps,
} from './TimeframeDropdown';

export {
  BacktestDataConfigPanel,
  type BacktestDataConfig,
  type DataSourceOption,
  type SymbolSearchResult,
  type TimeframeOption,
  type OrderSizeUnit,
  type BacktestDataConfigPanelProps,
} from './BacktestDataConfigPanel';

export {
  BacktestResultPanel,
  type BacktestResultPanelProps,
  type ExecutorResult,
  type ExecutorMetrics,
  type ExecutorTrade,
  type EquityPoint,
} from './backtest-result';

export {
  ExecutorStatusPanel,
  type ExecutorStatusPanelProps,
  type ExecutorStatus,
} from './ExecutorStatusPanel';

export {
  NamingDialog,
  generateSuggestedName,
  generateFinalName,
  type NamingDialogProps,
  type NamingDialogContext,
  type NamingDialogContextData,
} from './NamingDialog';

// TICKET_176_1: Checkpoint Resume UI
export { CheckpointBadge } from './CheckpointBadge';
export { CheckpointResumePanel } from './CheckpointResumePanel';

// TICKET_077_18: Backtest History Sidebar
export {
  BacktestHistorySidebar,
  type BacktestHistoryItem,
  type CheckpointBadgeInfo,
  type BacktestHistorySidebarProps,
} from './BacktestHistorySidebar';

// TICKET_308: PageHeader for Zone A (title + settings gear)
export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';

// TICKET_398: Dry Run Execute Button
export { DryRunExecuteButton } from './DryRunExecuteButton';
export type { DryRunExecuteButtonProps } from './DryRunExecuteButton';
