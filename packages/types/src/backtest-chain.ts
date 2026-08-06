/**
 * Durable per-entry outcome shared by the public backtest persistence layer
 * and the optional commercial research-chain orchestrator.
 */
export interface ChainEntrySummary {
  signalId: number;
  signalName: string;
  status: 'completed' | 'failed' | 'skipped' | 'running' | 'pending';
  runId?: number;
  error?: string;
  netSharpe?: number;
  grossSharpe?: number;
  maxDrawdown?: number;
  finalEquity?: number;
  tradeCount?: number;
}
