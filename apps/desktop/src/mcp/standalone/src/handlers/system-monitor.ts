/**
 * System Monitor MCP tool handler -- TICKET_1281 + TICKET_1284.
 *
 * `get_system_monitor` returns the whole-system resource snapshot (per-core CPU,
 * memory, GPU) plus per-workload (sweep / mining / LSTM) CPU/mem/GPU attribution
 * for the web-dashboard sidebar panel. Prefers the Electron Service API bridge
 * when available; falls back to the in-process local collector
 * (local-system-monitor.ts) when Electron is not running, so the web dashboard
 * shows live data standalone.
 *
 * This also serves as the degraded-mode fallback poll target for the
 * `system:resource-stats` / `system:workload-stats` SSE events.
 */
import type { McpToolResult } from './tool-result';
import * as apiClient from '../bridge/api-client';
import { collectLocalSnapshot } from '../local-system-monitor';
import { discoverServiceApi } from '../bridge/discovery';

function bridgeResult(response: apiClient.ApiResponse): McpToolResult {
  if (response.success && response.data) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }] };
  }
  if (response.unreachable) {
    return localResult();
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: response.error ?? 'Unknown error' }) }],
    isError: true,
  };
}

function localResult(): McpToolResult {
  try {
    const snapshot = collectLocalSnapshot();
    return { content: [{ type: 'text' as const, text: JSON.stringify(snapshot, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true };
  }
}

export async function handleGetSystemMonitor(): Promise<McpToolResult> {
  const config = discoverServiceApi();
  // TICKET_1276 P2 Batch D: THIS is the single SANCTIONED Class-R fallback.
  // Unlike every other Class-R site (which must surface `electronNotRunning`
  // when Electron is absent), system telemetry has a REAL second owning layer --
  // the in-process local collector (TICKET_1281). Returning live local telemetry
  // here is a genuine alternate source, NOT a degraded / faked bridge answer, so
  // it is deliberately NOT converted to an error.
  if (!config) return localResult();
  try {
    return bridgeResult(await apiClient.getSystemMonitor(config));
  } catch (e) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true };
  }
}
