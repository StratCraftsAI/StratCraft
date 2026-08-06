/**
 * TICKET_998 UI adapter for the shared pure fit-quality contract.
 *
 * Decision logic lives in @StratCraft/types so Electron and every plugin use
 * the same implementation. This adapter owns only visual config and colors.
 */

import { FALLBACK_ZONE_COLOR } from '@shared/constants/colors';
import {
  assessFitQuality,
  DEFAULT_LSTM_FIT_QUALITY_CONFIG,
  type DataSufficiency,
  type FitQuality,
  type FitQualityConfig as SharedFitQualityConfig,
  type FitQualityThresholds,
} from '@StratCraft/types';

export interface ZoneColor {
  bar: string;
  border: string;
  text: string;
  marker: string;
  glow: string;
}

export interface FitZoneConfig {
  id: string;
  label: string;
  color: ZoneColor;
  barWidthPercent: number;
}

export interface FitQualityConfig extends SharedFitQualityConfig {
  zones: FitZoneConfig[];
}

export type { DataSufficiency, FitQuality, FitQualityThresholds };
export { assessFitQuality };

export const DEFAULT_CONFIG = DEFAULT_LSTM_FIT_QUALITY_CONFIG as FitQualityConfig;

export function validateConfig(json: unknown): FitQualityConfig {
  const obj = json as Record<string, unknown>;
  if (!obj || typeof obj !== 'object') {
    throw new Error('Config must be an object');
  }
  const zones = obj.zones;
  if (!Array.isArray(zones) || zones.length < 2) {
    throw new Error('Config must have at least 2 zones');
  }
  for (const entry of zones) {
    const zone = entry as Record<string, unknown>;
    if (!zone.id || !zone.label || !zone.color || typeof zone.barWidthPercent !== 'number') {
      throw new Error(`Invalid zone: ${JSON.stringify(entry)}`);
    }
  }
  const thresholds = obj.thresholds as Record<string, unknown> | undefined;
  if (!thresholds || typeof thresholds !== 'object') {
    throw new Error('Config must have thresholds');
  }
  for (const key of [
    'sharpe_underfit_ceil',
    'sharpe_marginal_ceil',
    'cv_marginal_floor',
    'cv_overfit_floor',
    'min_sample_param_ratio',
  ]) {
    if (typeof thresholds[key] !== 'number') {
      throw new Error(`Threshold ${key} must be a number`);
    }
  }
  if (!obj.positionMapping || typeof obj.positionMapping !== 'object') {
    throw new Error('Config must have positionMapping');
  }
  return json as FitQualityConfig;
}

export function getZoneConfig(config: FitQualityConfig, zoneId: string): FitZoneConfig | undefined {
  return config.zones.find((zone) => zone.id === zoneId);
}

export function getZoneColor(config: FitQualityConfig, zoneId: string): ZoneColor {
  return getZoneConfig(config, zoneId)?.color ?? { ...FALLBACK_ZONE_COLOR };
}
