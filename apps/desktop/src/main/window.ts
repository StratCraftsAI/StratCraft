/**
 * Window management module
 */

import electron from 'electron';
import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { windowLog } from './utils/logger';
import {
  MAIN_WINDOW_DEFAULT_WIDTH,
  MAIN_WINDOW_DEFAULT_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
  MAIN_WINDOW_MIN_HEIGHT,
} from '../shared/constants/window';
import { THEME_COLORS } from '../shared/constants/colors';
import { getDesktopWindowIconPath } from './utils/desktop-icon';

let mainWindow: ElectronBrowserWindow | null = null;
const { app, BrowserWindow, shell } = electron;

export function getMainWindow(): ElectronBrowserWindow | null {
  return mainWindow;
}

export function createWindow(): ElectronBrowserWindow {
  mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_DEFAULT_WIDTH,
    height: MAIN_WINDOW_DEFAULT_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    transparent: true,
    backgroundColor: THEME_COLORS.TRANSPARENT_BG,
    icon: getDesktopWindowIconPath({
      isPackaged: app.isPackaged,
      platform: process.platform,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    }),
    trafficLightPosition:
      process.platform === 'darwin' ? { x: 15, y: 15 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Show window when ready
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Load page
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('close', () => {
    windowLog.info('close event fired');
  });

  mainWindow.on('closed', () => {
    windowLog.info('closed event fired, setting mainWindow = null');
    mainWindow = null;
  });

  return mainWindow;
}

export function sendToRenderer(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args);
}
