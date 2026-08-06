/**
 * TICKET_882_1: Auto-Update Service
 *
 * Uses electron-updater to check for updates on GitHub Releases,
 * download them on user request, and install on quit.
 */

import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { BrowserWindow } from 'electron';
import { appLog } from '../utils/logger';
import type { UpdateStatus, UpdateState } from '../../shared/types/update';

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const STARTUP_DELAY_MS = 10_000;
const UPDATE_CHANNEL = 'update:status-changed';

let currentStatus: UpdateStatus = { state: 'idle' };
let checkTimer: ReturnType<typeof setInterval> | null = null;

function broadcastStatus(status: UpdateStatus): void {
  currentStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(UPDATE_CHANNEL, status);
    }
  }
}

function setState(state: UpdateState, extra?: Partial<UpdateStatus>): void {
  broadcastStatus({ state, ...extra });
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus;
}

export async function checkForUpdates(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appLog.warn('[UpdateService] Check failed:', msg);
    setState('error', { error: msg });
  }
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch(err => {
    const msg = err instanceof Error ? err.message : String(err);
    appLog.error('[UpdateService] Download failed:', msg);
    setState('error', { error: msg });
  });
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall(false, true);
}

export function initUpdateService(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = appLog;

  autoUpdater.on('checking-for-update', () => {
    appLog.info('[UpdateService] Checking for updates...');
    setState('checking');
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    appLog.info(`[UpdateService] Update available: v${info.version}`);
    setState('available', {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : undefined,
    });
  });

  autoUpdater.on('update-not-available', () => {
    appLog.info('[UpdateService] No updates available');
    setState('not-available');
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    setState('downloading', {
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    appLog.info(`[UpdateService] Update downloaded: v${info.version}`);
    setState('downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err: Error) => {
    appLog.error('[UpdateService] Error:', err.message);
    setState('error', { error: err.message });
  });

  // Initial check after startup delay
  setTimeout(() => {
    checkForUpdates();
  }, STARTUP_DELAY_MS);

  // Periodic check
  checkTimer = setInterval(() => {
    checkForUpdates();
  }, UPDATE_CHECK_INTERVAL_MS);

  appLog.info('[UpdateService] Initialized');
}

export function shutdownUpdateService(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}
