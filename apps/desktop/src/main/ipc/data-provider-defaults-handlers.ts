/**
 * Data Provider Defaults IPC Handlers
 * TICKET_811: Tool Sweep BYOK provider gate + default-provider picker.
 *
 * Two channels, mirror locale-handlers.ts shape:
 *   - `dataProviderDefaults:get`   -> DataProviderDefaults
 *   - `dataProviderDefaults:set`   -> { ok: true } | { ok: false, error }
 *
 * Renderer flow: the System Settings radio writes via :set; the Tool
 * Sweep picker reads via :get and writes via :set when the user ticks
 * "Use this provider by default." All allowlisting + validation lives
 * in the service -- handlers are thin pass-throughs.
 */

import { ipcMain } from 'electron';
import {
  getDataProviderDefaults,
  setDataProviderDefault,
} from '../services/data-provider-defaults-service';
import { ipcLog } from '../utils/logger';

export function registerDataProviderDefaultsHandlers(): void {
  ipcMain.handle('dataProviderDefaults:get', () => {
    return getDataProviderDefaults();
  });

  ipcMain.handle(
    'dataProviderDefaults:set',
    (_event, domain: string, providerId: string | null) => {
      const result = setDataProviderDefault(domain, providerId);
      if (!result.ok) {
        // Defensive log: a renderer reaching this branch is either
        // stale (older UI sending an unknown domain after a downgrade)
        // or buggy (radio surfaced a non-allowlisted providerId).
        // Either way, the handler reports the error transparently so
        // the renderer can surface it via the message system.
        ipcLog.warn(`[DATA_PROVIDER_DEFAULTS] rejected set: ${result.error}`);
      }
      return result;
    },
  );

  ipcLog.info('[DATA_PROVIDER_DEFAULTS] IPC handlers registered');
}
