/**
 * API Types (DESKTOP_CLIENT_INTEGRATION_GUIDE v1.1)
 */

import type { BarInterval } from '@StratCraft/types';

// Task status
export type TaskStatus = 'processing' | 'completed' | 'failed';

// API Error (in response.data.result.error)
export interface ApiError {
  code: string;
  message: string;
  type?: string;
  details?: Record<string, unknown>;
  retry_suggested?: boolean;
  retry_after_seconds?: number;
  suggested_action?: string;
}

// API Response Data (response.data)
export interface ApiResponseData<T = unknown> {
  task_id?: string;
  status: TaskStatus;
  result?: T;
  error?: string;
  created_at?: string;
  updated_at?: string;
}

// API Response (DESKTOP_CLIENT_INTEGRATION_GUIDE v1.1)
// Server returns: { success, data: { task_id, status, result, ... } }
export interface ApiResponse<T = unknown> {
  success: boolean;
  data: ApiResponseData<T>;
}

// Market data
export interface MarketData {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Kline data
export interface KlineData extends MarketData {
  interval: KlineInterval;
}

// Kline interval
export type KlineInterval = BarInterval;

// Data source
export interface DataSource {
  id: string;
  name: string;
  type: 'csv' | 'database' | 'api';
  config: Record<string, unknown>;
}

// Backtest task
export interface BacktestTask {
  id: string;
  strategyId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  createdAt: string;
  completedAt?: string;
}

// AI chat message
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

// MCP tool call
export interface McpToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

// MCP tool result
export interface McpToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

// ============================================
// Long-running Task Types (TICKET_082)
// ============================================

// Task start response (extends ApiResponse)
export interface TaskStartResponse extends ApiResponse {
  task_id: string;
  status: 'processing';
}

// Task status response (extends ApiResponse)
export interface TaskStatusResponse extends ApiResponse {
  task_id: string;
  strategy_code?: string;
}

// Task error (same as ApiError, kept for compatibility)
export type TaskError = ApiError;

// Poll options for executeWithPolling
export interface PollOptions<T> {
  initialData: unknown;
  startEndpoint: string;
  pollEndpoint: string;
  pollInterval?: number;
  timeout?: number;
  handlePollResponse: (response: unknown) => PollResult<T>;
}

// Poll result
export interface PollResult<T> {
  isComplete: boolean;
  result?: T;
  rawResponse: unknown;
}

// ============================================
// Market Regime Types (TICKET_082)
// ============================================

// Indicator configuration
export interface IndicatorConfig {
  slug: string;
  name: string;
  params?: Record<string, unknown>;
}

// Strategy configuration
export interface StrategyConfig {
  logic: Record<string, unknown>;
  params?: Record<string, unknown>;
}

// Market regime rule
export interface MarketRegimeRule {
  rule_type: 'template_based' | 'custom_expression';
  indicator?: IndicatorConfig;
  strategy?: StrategyConfig;
  expression?: string;
}

// Market regime analysis configuration
export interface MarketRegimeConfig {
  regime: string;
  rules: MarketRegimeRule[];
  strategy_id?: string;
  strategy_name?: string;
  locale?: string;
  llm_provider?: string;
  llm_model?: string;
  bespoke_notes?: string;
}

// Market regime analysis result
export interface MarketRegimeResult {
  status: TaskStatus;
  strategy_code?: string;
  error?: TaskError;
  detection_result?: {
    cases: unknown[];
    error?: string;
  };
}
