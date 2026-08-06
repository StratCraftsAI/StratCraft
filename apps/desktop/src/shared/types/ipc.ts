/**
 * IPC communication type definitions
 */

// Server status
export interface ServerStatus {
  api: boolean;
  engine: boolean;
  mcp: boolean;
  version?: string;
}

// Backtest configuration
export interface BacktestConfig {
  strategyId: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  commission?: number;
  slippage?: number;
}

// Backtest result
export interface BacktestResult {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  metrics?: BacktestMetrics;
  trades?: Trade[];
  equity?: EquityPoint[];
  error?: string;
}

// Backtest metrics
export interface BacktestMetrics {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
}

// Trade record
export interface Trade {
  id: string;
  timestamp: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  pnl?: number;
}

// Equity curve point
export interface EquityPoint {
  timestamp: string;
  equity: number;
  drawdown: number;
}

// Strategy definition
export interface Strategy {
  id: string;
  name: string;
  description?: string;
  code: string;
  language: 'python' | 'javascript';
  createdAt: string;
  updatedAt: string;
}

// File dialog options
export interface FileDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{
    name: string;
    extensions: string[];
  }>;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
}
