/**
 * Locale Service - Main Process
 * TICKET_084: Internationalization System Design
 *
 * Handles locale detection and persistence in the main process.
 * Priority chain:
 * 1. User explicit selection (persisted)
 * 2. System locale detection (first launch)
 * 3. Default locale (en_US)
 */

import { app, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../../i18n/config';
import { appLog } from '../utils/logger';

const store = new Store();
const LOCALE_STORE_KEY = 'user.locale';

/**
 * Normalize system locale format
 * e.g., 'zh-CN' -> 'zh_CN', 'en-US' -> 'en_US'
 */
function normalizeLocale(locale: string): string {
  return locale.replace('-', '_');
}

/**
 * Find best matching locale from supported list
 * e.g., 'zh_CN' -> 'zh_CN', 'zh' -> 'zh_CN', 'fr_CA' -> null
 */
function findBestMatch(locale: string): string | null {
  const normalized = normalizeLocale(locale);

  // Exact match
  if (SUPPORTED_LOCALES[normalized]) {
    return normalized;
  }

  // Language-only match (e.g., 'zh' matches 'zh_CN')
  const langCode = normalized.split('_')[0];
  const match = Object.keys(SUPPORTED_LOCALES).find(
    (code) => code.startsWith(langCode + '_')
  );

  return match || null;
}

/**
 * Get initial locale with priority chain
 */
export function getInitialLocale(): string {
  // Priority 1: User explicit selection (persisted)
  const savedLocale = store.get(LOCALE_STORE_KEY) as string | undefined;
  if (savedLocale && SUPPORTED_LOCALES[savedLocale]) {
    appLog.debug(`[LOCALE] Using saved locale: ${savedLocale}`);
    return savedLocale;
  }

  // Priority 2: System locale detection
  const systemLocale = app.getLocale(); // e.g., 'zh-CN', 'en-US'
  const matchedLocale = findBestMatch(systemLocale);
  if (matchedLocale) {
    appLog.debug(`[LOCALE] Detected system locale: ${systemLocale} -> ${matchedLocale}`);
    return matchedLocale;
  }

  // Priority 3: Default fallback
  appLog.debug(`[LOCALE] Using default locale: ${DEFAULT_LOCALE}`);
  return DEFAULT_LOCALE;
}

/**
 * Save user locale preference
 */
export function setUserLocale(locale: string): boolean {
  if (SUPPORTED_LOCALES[locale]) {
    store.set(LOCALE_STORE_KEY, locale);
    appLog.info(`[LOCALE] User locale set to: ${locale}`);
    // TICKET_1235_8 AC2: locale can be set outside the renderer (MCP
    // set_locale). Broadcast so open windows re-render in the new locale
    // instead of waiting for an app restart. Renderer-initiated changes
    // receive their own locale back and no-op.
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('locale:changed', locale);
    }
    return true;
  }

  appLog.warn(`[LOCALE] Attempted to set unsupported locale: ${locale}`);
  return false;
}

/**
 * Get saved user locale (or undefined if not set)
 */
export function getSavedLocale(): string | undefined {
  return store.get(LOCALE_STORE_KEY) as string | undefined;
}

/**
 * Clear saved locale preference
 */
export function clearSavedLocale(): void {
  store.delete(LOCALE_STORE_KEY);
  appLog.info('[LOCALE] Saved locale cleared');
}

/**
 * Get current locale for main process
 * Returns the persisted user locale if set, else getInitialLocale()
 */
export function getCurrentMainLocale(): string {
  return store.get(LOCALE_STORE_KEY) as string || getInitialLocale();
}

/**
 * Get system locale (raw, not normalized)
 */
export function getSystemLocale(): string {
  return app.getLocale();
}

/**
 * Get all supported locales (sorted by sortOrder)
 */
export function getSupportedLocales(): Array<{
  code: string;
  shortCode: string;
  name: string;
  localName: string;
}> {
  return Object.values(SUPPORTED_LOCALES)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ code, shortCode, name, localName }) => ({
      code,
      shortCode,
      name,
      localName
    }));
}
