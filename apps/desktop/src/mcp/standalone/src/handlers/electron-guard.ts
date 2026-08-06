/**
 * Canonical Electron-absent guard for Class-R MCP tool handlers.
 *
 * TICKET_1276 P2 Batch D / TICKET_1334. A Class-R tool delegates to a shared
 * operation hosted by a live Service API runtime. That runtime may be the
 * Electron desktop host or the headless serve host; neither host is the owning
 * layer. When service discovery returns no live runtime, the operation genuinely
 * cannot be performed from this standalone MCP process. This guard preserves the
 * historical error contract; it must not be interpreted as requiring an Electron
 * window when a headless Service API runtime is available.
 *
 * This module is the SINGLE source of the Electron-absent error shape. Every
 * Class-R site returns exactly this: an explicit, actionable error (TICKET_858)
 * that NAMES the operation and tells the user to start the desktop app. There is
 * NO degraded / smaller / fake-`success:true` payload -- an absent runtime
 * surfaces as an error, never as a silently-diminished answer.
 *
 * The one sanctioned exception is `system-monitor.ts`, which has a real second
 * owning layer (the in-process local collector, TICKET_1281) and therefore
 * returns live local telemetry rather than this error.
 */
import type { McpToolResult } from './tool-result';
import type { ServiceApiDiscoveryFailure } from '../bridge/discovery';
import { describeT } from '../i18n.js';

export type ServiceApiAvailabilityFailure = ServiceApiDiscoveryFailure | {
  status: 'unreachable_owner';
  code: 'service_api_owner_unreachable';
  endpoint: string;
  message: string;
};

/**
 * Owner-neutral Service API availability error. The role may be held by the
 * headless runtime or Electron Main, so absence must never be presented as an
 * Electron requirement.
 */
export function serviceApiUnavailable(
  operation: string,
  failure: ServiceApiAvailabilityFailure,
): McpToolResult {
  let error: string;
  if (failure.status === 'missing_evidence') {
    error =
      'Research Runtime Service is unavailable. Neither the headless Service API runtime '
      + 'nor Electron currently owns the Service API role. Start Guide WebUI with its '
      + 'supported launcher, or start StratCraft, and try again.';
  } else if (failure.status === 'invalid_evidence') {
    error =
      `Research Runtime Service discovery evidence is malformed or stale (${failure.reason}). `
      + 'Restart the supported Guide runtime or StratCraft so it can publish a valid api-port '
      + 'and api-token pair.';
  } else {
    error =
      `The discovered Research Runtime Service at ${failure.endpoint} is unreachable. `
      + 'Its stale discovery evidence was removed; restart the supported Guide runtime or '
      + 'StratCraft and try again.';
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        error,
        code: failure.code,
        operation,
        serviceRole: 'research-runtime-service',
        discoveryState: failure.status,
      }),
    }],
    isError: true,
    errorCategory: 'process',
  };
}

/**
 * The canonical Electron-absent error result.
 *
 * @param operation Human-readable name of the tool/operation (e.g.
 *   `'Queue data download'`, `'compile_strategy'`). Named in the message so the
 *   user knows exactly which action was refused.
 * @param remedy Optional operation-specific remedy sentence appended after the
 *   default "start the desktop app" guidance.
 *
 * The message always contains the substring
 * `"Electron desktop app is not running"` so callers and tests can match on it.
 */
export function electronNotRunning(operation: string, remedy?: string): McpToolResult {
  // The %s placeholder is interpolated AFTER localisation so the operation name
  // survives locale overrides (same pattern as the backtests handler messages).
  const base = describeT(
    'handlers.common.electronNotRunning',
    'Electron desktop app is not running. %s requires the running desktop app -- start StratCraft and try again.',
  ).replace('%s', operation);
  const text = remedy ? `${base} ${remedy}` : base;
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ error: text, operation, electronRequired: true }),
    }],
    isError: true,
    errorCategory: 'process',
  };
}
