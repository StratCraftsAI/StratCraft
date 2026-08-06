/**
 * I18N Initialization
 * TICKET_084: Internationalization System Design
 *
 * This module initializes i18next for the renderer process.
 * Locale detection happens in the main process via locale-service.ts
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  CORE_NAMESPACES,
  isLocaleSupported
} from './config';
import type { I18nInitOptions } from './types';

/**
 * Track loaded locales
 */
const loadedLocales = new Set<string>();

/**
 * Dynamically load locale resources
 */
async function loadLocaleResources(locale: string): Promise<void> {
  if (loadedLocales.has(locale)) {
    return;
  }

  try {
    console.info(`[I18N] Loading resources for locale: ${locale}`);

    // Dynamic import based on locale
    const [ui, trading, settings, marketplace, errors] = await Promise.all([
      import(`./locales/${locale}/ui.json`).catch(() => ({ default: {} })),
      import(`./locales/${locale}/trading.json`).catch(() => ({ default: {} })),
      import(`./locales/${locale}/settings.json`).catch(() => ({ default: {} })),
      import(`./locales/${locale}/marketplace.json`).catch(() => ({ default: {} })),
      import(`./locales/${locale}/errors.json`).catch(() => ({ default: {} }))
    ]);

    // Add to i18next
    i18n.addResourceBundle(locale, 'ui', ui.default || ui, true, true);
    i18n.addResourceBundle(locale, 'trading', trading.default || trading, true, true);
    i18n.addResourceBundle(locale, 'settings', settings.default || settings, true, true);
    i18n.addResourceBundle(locale, 'marketplace', marketplace.default || marketplace, true, true);
    i18n.addResourceBundle(locale, 'errors', errors.default || errors, true, true);

    loadedLocales.add(locale);
    console.info(`[I18N] Resources loaded for locale: ${locale}`);
  } catch (error) {
    console.error(`[I18N] Failed to load resources for locale: ${locale}`, error);
  }
}

/**
 * Initialize i18next
 */
export async function initI18n(options: I18nInitOptions = {}): Promise<typeof i18n> {
  const {
    locale = DEFAULT_LOCALE,
    namespaces = [],
    debug = false
  } = options;

  // Validate locale
  const validLocale = isLocaleSupported(locale) ? locale : DEFAULT_LOCALE;

  console.info(`[I18N] Initializing with locale: ${validLocale}`);

  await i18n
    .use(initReactI18next)
    .init({
      lng: validLocale,
      fallbackLng: FALLBACK_LOCALE,
      ns: [...CORE_NAMESPACES, ...namespaces],
      defaultNS: 'ui',

      interpolation: {
        escapeValue: false // React already escapes
      },

      react: {
        useSuspense: false // Disable suspense for initial load
      },

      debug,

      // Return key if translation missing
      returnEmptyString: false,

      // Key separator for nested keys (e.g., 'common.loading')
      keySeparator: '.',

      // Namespace separator (e.g., 'trading:position.long')
      nsSeparator: ':'
    });

  // Load initial locale resources
  await loadLocaleResources(validLocale);

  // Also load fallback if different
  if (validLocale !== FALLBACK_LOCALE) {
    await loadLocaleResources(FALLBACK_LOCALE);
  }

  console.info('[I18N] Initialization complete');
  return i18n;
}

/**
 * Add plugin translations dynamically
 */
export function addPluginTranslations(
  locale: string,
  namespace: string,
  translations: Record<string, unknown>
): void {
  i18n.addResourceBundle(locale, namespace, translations, true, true);
}

/**
 * Change current language
 */
export async function changeLanguage(locale: string): Promise<void> {
  if (!isLocaleSupported(locale)) {
    console.warn(`[I18N] Unsupported locale: ${locale}, falling back to ${DEFAULT_LOCALE}`);
    locale = DEFAULT_LOCALE;
  }

  // Load locale resources if not already loaded
  await loadLocaleResources(locale);

  await i18n.changeLanguage(locale);
  console.info(`[I18N] Language changed to: ${locale}`);
}

/**
 * Get current locale
 */
export function getCurrentLocale(): string {
  return i18n.language || DEFAULT_LOCALE;
}

/**
 * Check if a namespace is loaded
 */
export function isNamespaceLoaded(namespace: string, locale?: string): boolean {
  return i18n.hasResourceBundle(locale || i18n.language, namespace);
}

export { i18n };
export default i18n;
