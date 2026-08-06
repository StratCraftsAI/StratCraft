import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getIntlLocale, formatDate as sharedFormatDate } from '@shared/utils/format-locale';
import { PERCENTAGE_MULTIPLIER } from '@shared/constants/formatting';

/**
 * Merge classNames, supporting conditional classNames and Tailwind class deduplication
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format number as percentage
 */
export function formatPercent(value: number, decimals = 2): string {
  return `${(value * PERCENTAGE_MULTIPLIER).toFixed(decimals)}%`;
}

/**
 * Format number as currency
 */
export function formatCurrency(value: number, currency = 'CNY'): string {
  return new Intl.NumberFormat(getIntlLocale(), {
    style: 'currency',
    currency,
  }).format(value);
}

/**
 * Format date
 */
export function formatDate(date: Date | string | number): string {
  return sharedFormatDate(date);
}

/**
 * Delay function
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
