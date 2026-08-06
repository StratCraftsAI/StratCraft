/**
 * Dialog Localization Helper - Main Process
 * TICKET_786_6 Phase 5: Localisation for native OS dialogs.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { appLog } from '../utils/logger';
import { DEFAULT_LOCALE } from '../../i18n/config';

// Cache for loaded dialog bundles
const dialogCache = new Map<string, any>();

/**
 * Clear dialog cache (Internal use for testing)
 */
export function clearDialogCache(): void {
  dialogCache.clear();
}

/**
 * Load dialog strings for a specific locale
 * Synchronously reads from disk and caches the result.
 */
export function loadDialogStrings(locale: string): any {
  if (dialogCache.has(locale)) {
    return dialogCache.get(locale);
  }

  const localesDir = path.join(app.getAppPath(), 'src/i18n/locales');
  const filePath = path.join(localesDir, locale, 'dialogs.json');

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const bundle = JSON.parse(content);
      dialogCache.set(locale, bundle);
      return bundle;
    } else {
      appLog.warn(`[I18N] Dialog locale file missing for ${locale}: ${filePath}. Falling back to ${DEFAULT_LOCALE}.`);
    }
  } catch (err) {
    appLog.error(`[I18N] Failed to load/parse dialog locale ${locale} from ${filePath}: ${err}. Falling back to ${DEFAULT_LOCALE}.`);
  }

  // Fallback to en_US if not already attempting it
  if (locale !== DEFAULT_LOCALE) {
    const fallback = loadDialogStrings(DEFAULT_LOCALE);
    // Don't cache the fallback under the failed locale key so we can retry if the file appears
    return fallback;
  }

  // Final emergency fallback if even en_US fails
  return {
    pluginInstall: {
      title: 'Select Plugin Package',
      filter: {
        nexusPackage: 'StratCraft Plugin'
      }
    }
  };
}
