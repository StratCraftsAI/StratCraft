/**
 * Diagnostic & Consent IPC Handlers (TICKET_573)
 *
 * Handles:
 * - Open log folder in system file manager
 * - Consent status retrieval and updates (Phase 4A)
 */

import { ipcMain, shell } from 'electron';
import { DIAGNOSTIC_CHANNELS, CONSENT_CHANNELS } from '../../shared/constants/channels';
import { getLogDirectory, ipcLog } from '../utils/logger';
import { getConsent, setConsent, isFirstLaunch } from '../services/consent-service';
import { initializeCrashReporter, isCrashReporterActive } from '../services/crash-reporter';

export function registerDiagnosticHandlers(): void {
  // Open log folder in system file manager
  ipcMain.handle(DIAGNOSTIC_CHANNELS.OPEN_LOG_FOLDER, async () => {
    try {
      const logDir = getLogDirectory();
      const result = await shell.openPath(logDir);
      if (result) {
        // shell.openPath returns empty string on success, error message on failure
        ipcLog.error('Failed to open log folder:', result);
        return { success: false, error: result };
      }
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('Failed to open log folder:', msg);
      return { success: false, error: msg };
    }
  });

  // Get consent status (TICKET_573 Phase 4A)
  ipcMain.handle(CONSENT_CHANNELS.GET_STATUS, () => {
    try {
      const consent = getConsent();
      const firstLaunch = isFirstLaunch();
      return { success: true, consent, isFirstLaunch: firstLaunch };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('Failed to get consent status:', msg);
      return { success: false, error: msg };
    }
  });

  // Set consent preferences (TICKET_573 Phase 4A)
  ipcMain.handle(CONSENT_CHANNELS.SET_CONSENT, async (_event: Electron.IpcMainInvokeEvent, crashes: boolean, analytics: boolean) => {
    try {
      const consent = await setConsent(crashes, analytics);

      // Crash reports are always-on: ensure Sentry is initialized
      if (!isCrashReporterActive()) {
        initializeCrashReporter();
      }

      return { success: true, consent };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('Failed to set consent:', msg);
      return { success: false, error: msg };
    }
  });

  ipcLog.info('[TICKET_573] Diagnostic & consent handlers registered');
}
