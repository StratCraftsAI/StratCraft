/**
 * TICKET_882_1: Auto-Update IPC Handlers
 */

import { ipcMain } from 'electron';
import { ipcLog } from '../utils/logger';
import {
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getUpdateStatus,
} from '../services/update-service';

const UPDATE_CHANNELS = {
  CHECK: 'update:check',
  DOWNLOAD: 'update:download',
  INSTALL: 'update:install',
  GET_STATUS: 'update:get-status',
} as const;

export function registerUpdateHandlers(): void {
  ipcMain.handle(UPDATE_CHANNELS.CHECK, async () => {
    try {
      await checkForUpdates();
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('[UpdateHandlers] Check failed:', msg);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle(UPDATE_CHANNELS.DOWNLOAD, async () => {
    try {
      downloadUpdate();
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('[UpdateHandlers] Download failed:', msg);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle(UPDATE_CHANNELS.INSTALL, async () => {
    try {
      quitAndInstall();
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('[UpdateHandlers] Install failed:', msg);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle(UPDATE_CHANNELS.GET_STATUS, async () => {
    return getUpdateStatus();
  });

  ipcLog.info('[UpdateHandlers] Update handlers registered');
}
