/**
 * System-related IPC handlers
 */

import { ipcMain, app, dialog, BrowserWindow } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import {
  WINDOW_CHANNELS,
  APP_CHANNELS,
  FILE_CHANNELS,
} from '@shared/constants';
import { getAppInfo } from '@StratCraft/app-state-core';
import { getMainWindow } from '../window';
import { ipcLog } from '../utils/logger';

export function registerSystemHandlers(): void {
  // Window controls
  ipcMain.handle(WINDOW_CHANNELS.MINIMIZE, async () => {
    const win = BrowserWindow.getFocusedWindow();
    win?.minimize();
  });

  ipcMain.handle(WINDOW_CHANNELS.MAXIMIZE, async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on(WINDOW_CHANNELS.CLOSE, () => {
    ipcLog.info('CLOSE handler triggered');
    const win = getMainWindow();
    ipcLog.debug('getMainWindow() returned:', win ? 'BrowserWindow' : 'null');
    if (!win) {
      ipcLog.error('Main window not found!');
      return;
    }
    ipcLog.info('Calling win.close()...');
    win.close();
    ipcLog.info('win.close() called');
  });

  ipcMain.handle(WINDOW_CHANNELS.IS_MAXIMIZED, async () => {
    const win = BrowserWindow.getFocusedWindow();
    return win?.isMaximized() ?? false;
  });

  // Application info
  ipcMain.handle(APP_CHANNELS.VERSION, async () => {
    return getAppInfo({
      packageJsonPath: `${app.getAppPath()}/package.json`,
      userDataPath: app.getPath('userData'),
      researchMode: process.env.STRATCRAFT_RESEARCH_MODE === '1',
    }).version;
  });

  ipcMain.handle(APP_CHANNELS.PATH, async () => {
    return getAppInfo({
      packageJsonPath: `${app.getAppPath()}/package.json`,
      userDataPath: app.getPath('userData'),
      researchMode: process.env.STRATCRAFT_RESEARCH_MODE === '1',
    }).path;
  });

  // TICKET_958_5 follow-up: mirror STRATCRAFT_RESEARCH_MODE to the
  // renderer. Reads `process.env` AT INVOCATION TIME so a test that
  // mutates the env between renders sees the new value (the main
  // process module load is too early to snapshot). Pure read, no side
  // effects.
  ipcMain.handle(APP_CHANNELS.RESEARCH_MODE, async () => {
    return getAppInfo({
      packageJsonPath: `${app.getAppPath()}/package.json`,
      userDataPath: app.getPath('userData'),
      researchMode: process.env.STRATCRAFT_RESEARCH_MODE === '1',
    }).researchMode;
  });

  // File dialogs
  ipcMain.handle(FILE_CHANNELS.OPEN_DIALOG, async (_, options) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters,
      properties: options.properties ?? ['openFile'],
    });

    return result;
  });

  ipcMain.handle(FILE_CHANNELS.SAVE_DIALOG, async (_, options) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const result = await dialog.showSaveDialog(win, {
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters,
    });

    return result.canceled ? null : result.filePath;
  });

  // File read/write
  ipcMain.handle(FILE_CHANNELS.READ, async (_, path: string) => {
    const content = await readFile(path);
    return content.toString('utf-8');
  });

  ipcMain.handle(FILE_CHANNELS.WRITE, async (_, path: string, data: string) => {
    await writeFile(path, data, 'utf-8');
    return { success: true };
  });
}
