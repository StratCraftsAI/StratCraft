/**
 * I18N Configuration - Single Source of Truth
 * TICKET_084: Internationalization System Design
 * TICKET_580: en_US Baseline Locale Completion
 *
 * Aligned with nonassa WordPress theme (inc/config/supported-languages.php)
 * 12 supported languages
 */

export interface LocaleConfig {
  code: string;
  shortCode: string;
  name: string;        // Native name (e.g., 'Deutsch')
  localName: string;   // English name (e.g., 'German')
  direction: 'ltr' | 'rtl';
  sortOrder: number;
}

/**
 * Supported Languages (12 Languages)
 * Sorted by sortOrder for consistent UI display
 */
import { SUPPORTED_LOCALE_RECORDS } from '@StratCraft/types';

export const SUPPORTED_LOCALES: Record<string, LocaleConfig> = Object.fromEntries(
  SUPPORTED_LOCALE_RECORDS.map((locale, index) => [locale.code, {
    code: locale.code,
    shortCode: locale.shortCode,
    name: locale.nativeLabel,
    localName: locale.englishLabel,
    direction: 'ltr' as const,
    sortOrder: index + 1,
  }]),
);

/* Legacy literal retained below only as historical source. */
const LEGACY_SUPPORTED_LOCALES: Record<string, LocaleConfig> = {
  en_US: {
    code: 'en_US',
    shortCode: 'en',
    name: 'English',
    localName: 'English',
    direction: 'ltr',
    sortOrder: 1
  },
  de_DE: {
    code: 'de_DE',
    shortCode: 'de',
    name: 'Deutsch',
    localName: 'German',
    direction: 'ltr',
    sortOrder: 2
  },
  es_ES: {
    code: 'es_ES',
    shortCode: 'es',
    name: 'Espanol',
    localName: 'Spanish',
    direction: 'ltr',
    sortOrder: 3
  },
  fr_FR: {
    code: 'fr_FR',
    shortCode: 'fr',
    name: 'Francais',
    localName: 'French',
    direction: 'ltr',
    sortOrder: 4
  },
  it_IT: {
    code: 'it_IT',
    shortCode: 'it',
    name: 'Italiano',
    localName: 'Italian',
    direction: 'ltr',
    sortOrder: 5
  },
  ja_JP: {
    code: 'ja_JP',
    shortCode: 'ja',
    name: '\u65E5\u672C\u8A9E',
    localName: 'Japanese',
    direction: 'ltr',
    sortOrder: 6
  },
  ko_KR: {
    code: 'ko_KR',
    shortCode: 'ko',
    name: '\uD55C\uAD6D\uC5B4',
    localName: 'Korean',
    direction: 'ltr',
    sortOrder: 7
  },
  pt_PT: {
    code: 'pt_PT',
    shortCode: 'pt',
    name: 'Portugues',
    localName: 'Portuguese',
    direction: 'ltr',
    sortOrder: 8
  },
  zh_CN: {
    code: 'zh_CN',
    shortCode: 'zh',
    name: '\u7B80\u4F53\u4E2D\u6587',
    localName: 'Simplified Chinese',
    direction: 'ltr',
    sortOrder: 9
  },
  zh_TW: {
    code: 'zh_TW',
    shortCode: 'zh-TW',
    name: '\u7E41\u9AD4\u4E2D\u6587',
    localName: 'Traditional Chinese',
    direction: 'ltr',
    sortOrder: 10
  },
  ru_RU: {
    code: 'ru_RU',
    shortCode: 'ru',
    name: 'Русский',
    localName: 'Russian',
    direction: 'ltr',
    sortOrder: 11
  },
  tr_TR: {
    code: 'tr_TR',
    shortCode: 'tr',
    name: 'Türkçe',
    localName: 'Turkish',
    direction: 'ltr',
    sortOrder: 12
  }
};

export const DEFAULT_LOCALE = 'en_US';
export const FALLBACK_LOCALE = 'en_US';

/**
 * Core namespaces provided by Host layer
 * Plugins should NOT override these
 */
export const CORE_NAMESPACES = ['ui', 'trading', 'settings', 'marketplace', 'errors'] as const;

export type CoreNamespace = typeof CORE_NAMESPACES[number];

/**
 * Check if a locale code is supported
 */
export function isLocaleSupported(locale: string): boolean {
  return locale in SUPPORTED_LOCALES;
}

/**
 * Get locale config or fallback
 */
export function getLocaleConfig(locale: string): LocaleConfig {
  return SUPPORTED_LOCALES[locale] || SUPPORTED_LOCALES[DEFAULT_LOCALE];
}

/**
 * Get sorted locales for UI display
 */
export function getSortedLocales(): LocaleConfig[] {
  return Object.values(SUPPORTED_LOCALES).sort((a, b) => a.sortOrder - b.sortOrder);
}
