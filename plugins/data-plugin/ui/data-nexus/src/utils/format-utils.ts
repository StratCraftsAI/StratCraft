/**
 * TICKET_383: Shared format utilities (Tier 0)
 *
 * Canonical definitions consumed by both back-test-nexus and quant-lab-nexus.
 * TICKET_315: Locale-aware formatting via shared utility.
 */

import { formatDateTime, formatNumber } from '@shared/utils/format-locale';

export const formatCurrency = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '$0.00';
  const capped = Math.max(-1e12, Math.min(1e12, value));
  const sign = capped >= 0 ? '+' : '';
  return `${sign}$${formatNumber(Math.abs(capped), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatPercent = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '0.00%';
  const capped = Math.max(-9999, Math.min(9999, value));
  const sign = capped >= 0 ? '+' : '';
  return `${sign}${capped.toFixed(2)}%`;
};

export const formatRatio = (value: number | null | undefined): string => {
  if (value == null) return '0.00';
  return value.toFixed(2);
};

export const formatDate = (timestamp: number): string => {
  return formatDateTime(timestamp);
};

export const getColorClass = (value: number | null | undefined): string => {
  if (value == null) return 'text-color-terminal-text';
  if (value > 0) return 'text-green-400';
  if (value < 0) return 'text-red-400';
  return 'text-color-terminal-text';
};

export const safeNum = (value: number | null | undefined, defaultVal = 0): number => {
  return value ?? defaultVal;
};
