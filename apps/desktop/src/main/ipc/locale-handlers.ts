/**
 * Locale IPC Handlers
 * TICKET_084: Internationalization System Design
 */

import { ipcMain } from 'electron';
import {
  getInitialLocale,
  setUserLocale,
  getSupportedLocales,
  getSystemLocale
} from '../services/locale-service';
import { ipcLog } from '../utils/logger';

export function registerLocaleHandlers(): void {
  // Get initial locale (respects priority chain)
  ipcMain.handle('locale:getInitial', () => {
    const locale = getInitialLocale();
    ipcLog.debug(`[LOCALE] getInitial: ${locale}`);
    return locale;
  });

  // Set user locale preference
  ipcMain.handle('locale:setUser', (_, locale: string) => {
    const success = setUserLocale(locale);
    ipcLog.debug(`[LOCALE] setUser: ${locale}, success: ${success}`);
    return { success };
  });

  // Get all supported locales
  ipcMain.handle('locale:getSupported', () => {
    const locales = getSupportedLocales();
    return { success: true, locales };
  });

  // Get system locale (for debugging)
  ipcMain.handle('locale:getSystem', () => {
    const locale = getSystemLocale();
    return { success: true, locale };
  });

  ipcLog.info('[LOCALE] IPC handlers registered');
}
