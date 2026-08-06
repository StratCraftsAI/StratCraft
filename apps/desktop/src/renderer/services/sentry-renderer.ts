/**
 * Renderer Sentry Init (TICKET_573 Phase 4A, TICKET_881 GlitchTip migration)
 *
 * Initializes Sentry in the renderer process.
 * Reports to self-hosted GlitchTip (Sentry-protocol-compatible).
 */

import * as Sentry from '@sentry/electron/renderer';
import { resolveErrorReportingDsn } from '../../shared/constants/error-reporting';

// TICKET_573_2 Phase 2: Build-time version injection for release tracking
declare const __APP_VERSION__: string;

let initialized = false;

/**
 * Initialize Sentry in the renderer process.
 * Should only be called when user has consented to crash reporting.
 */
export function initRendererSentry(): void {
  if (initialized) return;

  // TICKET_1304_6R_I10: DSN is injected at build time and absent in source
  // builds/forks. Without one there is no telemetry project to report to, so
  // stay uninitialized rather than initializing with an empty DSN.
  const dsn = resolveErrorReportingDsn();
  if (dsn === null) return;

  Sentry.init({
    dsn,
    release: `stratcraft@${__APP_VERSION__}`,
    environment: import.meta.env.DEV ? 'development' : 'production',
  });

  initialized = true;

  if (typeof window !== 'undefined' && window.electronAPI?.auth?.onStateChanged) {
    window.electronAPI.auth.onStateChanged((data) => {
      if (data.isAuthenticated && data.user) {
        Sentry.setUser({ id: data.user.id, email: data.user.email });
      } else {
        Sentry.setUser(null);
      }
    });
  }
}
