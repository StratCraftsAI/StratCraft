/**
 * Locale-Aware Format Utilities
 *
 * TICKET_315: Centralized date/number formatting that respects the user's
 * i18n locale selection. All Intl.DateTimeFormat / Intl.NumberFormat calls
 * should use getIntlLocale() instead of hardcoded locale strings.
 *
 * i18next uses underscore locales (en_US), Intl API uses hyphen (en-US).
 */

import i18n from 'i18next';
import {
  formatWorkloadCalendarDate,
  resolveWorkloadFormattingLocale,
} from '@StratCraft/workload-prelaunch';

const LOCALE_MAP: Record<string, string> = {
  en_US: 'en-US',
  de_DE: 'de-DE',
  es_ES: 'es-ES',
  fr_FR: 'fr-FR',
  it_IT: 'it-IT',
  ja_JP: 'ja-JP',
  ko_KR: 'ko-KR',
  pt_PT: 'pt-PT',
  zh_CN: 'zh-CN',
  zh_TW: 'zh-TW',
};

/**
 * Get Intl-compatible locale string from current i18n language.
 */
export function getIntlLocale(): string {
  return resolveWorkloadFormattingLocale(
    LOCALE_MAP[i18n.language] ?? i18n.language,
    Intl.DateTimeFormat().resolvedOptions().locale,
  );
}

/**
 * Get API-compatible locale string (underscore format) for Python backend.
 * TICKET_677: Used by PluginApiClient to auto-inject locale into POST bodies.
 */
export function getApiLocale(): string {
  return LOCALE_MAP[i18n.language] ? i18n.language : 'en_US';
}

/**
 * Format a date as short date display (e.g. "01/15/2024" or "2024/01/15").
 */
export function formatDate(date: Date | string | number): string {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return formatWorkloadCalendarDate(date, getIntlLocale());
  }
  return new Intl.DateTimeFormat(getIntlLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
}

/**
 * Format a date/time for display (e.g. "Jan 15, 2024, 01:30 PM").
 * When value is a number, it is treated as a Unix timestamp in seconds.
 */
export function formatDateTime(date: Date | string | number): string {
  const d = typeof date === 'number' ? new Date(date * 1000) : new Date(date);
  return new Intl.DateTimeFormat(getIntlLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/**
 * Smart timestamp display: today shows time, yesterday shows "Yesterday",
 * recent days show weekday, older shows month+day.
 */
export function formatTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const locale = getIntlLocale();
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return i18n.t('time.yesterday', { defaultValue: 'Yesterday', ns: 'ui' });
  } else if (days < 7) {
    return d.toLocaleDateString(locale, { weekday: 'short' });
  }
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/**
 * Locale-aware number formatting.
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getIntlLocale(), options).format(value);
}

/**
 * Get locale-appropriate date format hint string for UI display.
 * e.g. "MM/DD/YYYY" (en-US), "YYYY/MM/DD" (zh-CN), "DD.MM.YYYY" (de-DE).
 */
const DATE_FORMAT_HINTS: Record<string, string> = {
  'en-US': 'MM/DD/YYYY',
  'de-DE': 'DD.MM.YYYY',
  'es-ES': 'DD/MM/YYYY',
  'fr-FR': 'DD/MM/YYYY',
  'it-IT': 'DD/MM/YYYY',
  'ja-JP': 'YYYY/MM/DD',
  'ko-KR': 'YYYY.MM.DD',
  'pt-PT': 'DD/MM/YYYY',
  'zh-CN': 'YYYY/MM/DD',
  'zh-TW': 'YYYY/MM/DD',
};

export function getDateFormatHint(): string {
  return DATE_FORMAT_HINTS[getIntlLocale()] || 'MM/DD/YYYY';
}
