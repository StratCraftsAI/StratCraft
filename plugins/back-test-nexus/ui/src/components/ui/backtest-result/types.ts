/**
 * TICKET_358: Shared types for backtest result components
 * TICKET_383: Canonical types moved to Tier 0 (data-plugin), re-exported here.
 */

export type {
  ExecutorMetrics,
  ExecutorTrade,
  EquityPoint,
  Candle,
  ExecutorResult,
  FeedBarCountEntry,
} from '@plugins/data-plugin/types/executor';

/** TICKET_378: Backtest configuration summary for result page display */
export interface BacktestConfigSummary {
  dataSource: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  orderSize: number;
  orderSizeUnit: string;
  confidenceWeightedSizing?: boolean;
}

/** TICKET_257: Workflow timeframe configuration */
export interface WorkflowTimeframes {
  analysis?: string | null;
  entryFilter?: string | null;
  entrySignal?: string | null;
  exitStrategy?: string | null;
}
