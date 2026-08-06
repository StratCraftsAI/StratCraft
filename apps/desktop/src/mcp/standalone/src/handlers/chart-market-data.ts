/**
 * Chart / Market Data MCP tool handlers.
 *
 * TICKET_1235_9: 5 typed tools covering the Chart page surface.
 * CH1 -- OHLCV reads (get_market_data, get_market_symbols).
 * CH3 -- Kronos prediction (run_kronos_prediction, cancel_kronos_prediction,
 *         list_kronos_models).
 * CH2 -- Live ticks out of MCP scope v1 (agents poll get_market_data).
 *
 * All operations delegate to the Electron Service API bridge -- the same
 * data-provider and Kronos services that back the IPC handlers.
 */
import type { McpToolResult } from './tool-result';
import { discoverServiceApi } from '../bridge/discovery';
import * as apiClient from '../bridge/api-client';
import { electronNotRunning } from './electron-guard';

function bridgeResult(response: apiClient.ApiResponse): McpToolResult {
  if (response.success && response.data) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }] };
  }
  if (response.success) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: response.error ?? 'Unknown error' }) }],
    isError: true,
  };
}

// =============================================================================
// CH1: Market Data Reads (T0)
// =============================================================================

export async function handleGetMarketData(
  params: { symbol: string; interval: string; start_date: string; end_date: string; provider?: string },
): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Get market data');
  try { return bridgeResult(await apiClient.marketGetData(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleGetMarketSymbols(
  params: { query?: string; provider?: string; limit?: number },
): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Get market symbols');
  try { return bridgeResult(await apiClient.marketGetSymbols(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

// =============================================================================
// CH3: Kronos Prediction (T1/T0)
// =============================================================================

export async function handleRunKronosPrediction(
  params: {
    symbol: string;
    timeframe: string;
    prediction_settings?: { lookback?: number; pred_len?: number; model_version?: string };
    advanced_settings?: { temperature?: number; top_p?: number; top_k?: number; sample_count?: number };
  },
): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Run Kronos prediction');
  try { return bridgeResult(await apiClient.kronosRunPrediction(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleCancelKronosPrediction(
  params: { task_id: string },
): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Cancel Kronos prediction');
  try { return bridgeResult(await apiClient.kronosCancelPrediction(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleListKronosModels(): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('List Kronos models');
  try { return bridgeResult(await apiClient.kronosListModels(config)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}
