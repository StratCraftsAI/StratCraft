/**
 * Locale-Aware Format Utilities
 *
 * TICKET_315: Centralized date/number formatting that respects the user's
 * i18n locale selection. All Intl.DateTimeFormat / Intl.NumberFormat calls
 * should use getIntlLocale() instead of hardcoded locale strings.
 *
 * i18next uses underscore locales (en_US), Intl API uses hyphen (en-US).
 */
/**
 * Get Intl-compatible locale string from current i18n language.
 */
export declare function getIntlLocale(): string;
/**
 * Format a date as short date display (e.g. "01/15/2024" or "2024/01/15").
 */
export declare function formatDate(date: Date | string | number): string;
/**
 * Format a date/time for display (e.g. "Jan 15, 2024, 01:30 PM").
 * When value is a number, it is treated as a Unix timestamp in seconds.
 */
export declare function formatDateTime(date: Date | string | number): string;
/**
 * Smart timestamp display: today shows time, yesterday shows "Yesterday",
 * recent days show weekday, older shows month+day.
 */
export declare function formatTimestamp(date: Date | string): string;
/**
 * Locale-aware number formatting.
 */
export declare function formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
export declare function getDateFormatHint(): string;
//# sourceMappingURL=format-locale.d.ts.map