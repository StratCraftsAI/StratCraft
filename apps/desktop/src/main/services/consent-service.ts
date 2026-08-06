/**
 * Consent Store Service (TICKET_573 Phase 4A)
 *
 * Manages GDPR-compliant user consent for crash reporting and analytics.
 * Default: all OFF (GDPR Article 7 - explicit opt-in required).
 *
 * Electron Main and standalone MCP use the same cross-process-safe JSON owner.
 */

import { app } from 'electron';
import { join } from 'path';
import {
  getConsentStatus,
  setConsentState,
  type ConsentState,
} from '@StratCraft/app-state-core';
import { appLog } from '../utils/logger';

function getConsentFilePath(): string {
  return join(app.getPath('userData'), 'consent.json');
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get current consent state.
 */
export function getConsent(): ConsentState {
  return getConsentStatus(getConsentFilePath()).consent;
}

/**
 * Update consent preferences.
 * Records timestamp and app version for audit trail.
 */
export async function setConsent(
  crashes: boolean,
  analytics: boolean,
): Promise<ConsentState> {
  const state = await setConsentState({
    consentFilePath: getConsentFilePath(),
    crashes,
    analytics,
    appVersion: app.getVersion(),
  });
  appLog.info(`[Consent] Updated: crashes=${crashes}, analytics=${analytics}`);
  return state;
}

/**
 * Check if this is the first launch (no consent record exists).
 * First launch = timestamp is empty (default state).
 */
export function isFirstLaunch(): boolean {
  return getConsentStatus(getConsentFilePath()).isFirstLaunch;
}
