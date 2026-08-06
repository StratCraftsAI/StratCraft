/**
 * Crash Reporter Service (TICKET_573 Phase 4A, TICKET_881 GlitchTip migration)
 *
 * Integrates @sentry/electron for JavaScript crash reporting.
 * Reports to self-hosted GlitchTip (Sentry-protocol-compatible).
 * Uses log-sanitizer.ts beforeSend hook for PII stripping.
 */

import * as Sentry from '@sentry/electron/main';
import { app } from 'electron';
import { sanitizeLogLine } from '../utils/log-sanitizer';
import { appLog } from '../utils/logger';
import type { ConsentState } from '@StratCraft/app-state-core';
import { resolveErrorReportingDsn } from '../../shared/constants/error-reporting';

// ============================================================================
// State
// ============================================================================

let initialized = false;

// ============================================================================
// PII Sanitization Hook
// ============================================================================

/**
 * Sentry beforeSend hook: strip PII from error events using log-sanitizer.
 */
function beforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // Sanitize event message
  if (event.message) {
    event.message = sanitizeLogLine(event.message).sanitized;
  }

  // Sanitize exception values
  if (event.exception?.values) {
    for (const exc of event.exception.values) {
      if (exc.value) {
        exc.value = sanitizeLogLine(exc.value).sanitized;
      }
    }
  }

  // Sanitize breadcrumb messages
  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      if (breadcrumb.message) {
        breadcrumb.message = sanitizeLogLine(breadcrumb.message).sanitized;
      }
    }
  }

  return event;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize Sentry crash reporting.
 * Crash reports are always-on -- consent param is accepted for API compat
 * but the crashes field is ignored.
 */
export function initializeCrashReporter(_consent?: ConsentState): void {
  if (initialized) {
    appLog.info('[CrashReporter] Already initialized');
    return;
  }

  // TICKET_1304_6R_I10: No build-time DSN (source build, fork, self-hosted
  // deployment) means there is no telemetry project to report to. Skip init
  // and say so -- initializing with an empty DSN would swallow every event.
  const dsn = resolveErrorReportingDsn();
  if (dsn === null) {
    appLog.info(
      '[CrashReporter] No GlitchTip DSN configured at build time -- crash reporting disabled. '
      + 'Set StratCraft_GLITCHTIP_DSN before building to enable it.'
    );
    return;
  }

  Sentry.init({
    dsn,
    release: `stratcraft@${app.getVersion()}`,
    environment: app.isPackaged ? 'production' : 'development',
    beforeSend,
  });

  initialized = true;
  appLog.info('[CrashReporter] Sentry initialized (consent: crashes=true)');
}

/**
 * Shutdown Sentry gracefully (flush pending events).
 */
export async function shutdownCrashReporter(): Promise<void> {
  if (!initialized) return;

  await Sentry.close(2000);
  initialized = false;
  appLog.info('[CrashReporter] Sentry shut down');
}

/**
 * Set user context on Sentry events (call after login).
 */
export function setCrashReporterUser(id: string, email: string): void {
  Sentry.setUser({ id, email });
}

/**
 * Clear user context from Sentry events (call after logout).
 */
export function clearCrashReporterUser(): void {
  Sentry.setUser(null);
}

/**
 * Check if crash reporter is currently active.
 */
export function isCrashReporterActive(): boolean {
  return initialized;
}
