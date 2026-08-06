/**
 * Renderer Telemetry Helper (TICKET_196_6 Phase 6).
 *
 * Emits anonymous, aggregate-only telemetry events as Sentry breadcrumbs so
 * future layer-B decisions (auto-cut, TICKET_196_8) have evidence to ground
 * in. Strictly:
 *
 *   - Gated on the GDPR `consent.analytics` flag (read once at module init,
 *     refreshed when the user changes consent via `setConsent`).
 *   - No PII. No algorithm IDs. No score values. Aggregate counts only.
 *   - Breadcrumbs ride along with the next Sentry event; they are NOT a
 *     replacement for a real analytics pipeline. When one lands, swap the
 *     implementation here; call sites do not change.
 *
 * Sink choice rationale (locked 2026-05-21): the repo has Sentry but no
 * dedicated analytics SDK. Sentry breadcrumbs reuse installed infra with
 * zero new dependencies and stay invisible to non-error sessions.
 */

import * as Sentry from '@sentry/electron/renderer';

export type TelemetryPayloadValue = string | number | boolean | null;
export interface TelemetryPayload {
  [key: string]: TelemetryPayloadValue;
}

interface ConsentSnapshot {
  analytics: boolean;
}

let analyticsConsent = false;
let consentLoaded = false;

async function loadConsent(): Promise<void> {
  try {
    const result = await window.electronAPI.consent.getStatus();
    if (result.success && result.consent) {
      analyticsConsent = result.consent.analytics === true;
    } else {
      analyticsConsent = false;
    }
  } catch {
    analyticsConsent = false;
  } finally {
    consentLoaded = true;
  }
}

/**
 * Initialize the telemetry helper. Reads consent once. Safe to call multiple
 * times; subsequent calls refresh the cached consent state (e.g., after the
 * user toggles analytics in Advanced Settings).
 */
export async function initTelemetry(): Promise<void> {
  await loadConsent();
}

/**
 * Emit a single telemetry event. No-op if analytics consent is not granted
 * or consent has not yet loaded.
 *
 * @param name   Stable event identifier in `<surface>.<verb>` form.
 *               Examples: `scoreboard.viewed`, `scoreboard.column_toggled`.
 * @param data   Aggregate-only payload. Strings must NOT contain user data
 *               (algo IDs, symbols, free-text). Numbers/booleans preferred.
 */
export function emitTelemetry(name: string, data: TelemetryPayload = {}): void {
  if (!consentLoaded || !analyticsConsent) return;

  Sentry.addBreadcrumb({
    category: 'telemetry',
    type: 'info',
    level: 'info',
    message: name,
    data,
  });
}

/**
 * Test-only: reset module state so unit tests start from a clean slate.
 * Never call from production code.
 */
export function __resetTelemetryForTest(snapshot?: ConsentSnapshot): void {
  if (snapshot) {
    analyticsConsent = snapshot.analytics;
    consentLoaded = true;
  } else {
    analyticsConsent = false;
    consentLoaded = false;
  }
}
