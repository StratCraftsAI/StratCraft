/**
 * Public seconds-per-bar contract shared by data-window estimators.
 */
import {
  INTERVAL_1m,
  INTERVAL_5m,
  INTERVAL_15m,
  INTERVAL_30m,
  INTERVAL_1h,
  INTERVAL_4h,
  INTERVAL_1d,
  INTERVAL_1w,
} from './intervals';

export const BAR_SECONDS: Readonly<Record<string, number>> = {
  [INTERVAL_1m]: 60,
  [INTERVAL_5m]: 300,
  [INTERVAL_15m]: 900,
  [INTERVAL_30m]: 1800,
  [INTERVAL_1h]: 3600,
  [INTERVAL_4h]: 4 * 3600,
  [INTERVAL_1d]: 86400,
  [INTERVAL_1w]: 7 * 86400,
} as const;
