/**
 * Pure, cross-layer LSTM fit-quality contract.
 *
 * TICKET_998 originally placed this decision logic in a UI plugin. Keeping the
 * decision in the shared package lets Electron, plugins, and MCP consumers use
 * one implementation without reversing the Core -> component dependency.
 */

import defaultConfigJson from './data/lstm-fit-quality.json';

export interface FitQualityThresholds {
  sharpe_underfit_ceil: number;
  sharpe_marginal_ceil: number;
  cv_marginal_floor: number;
  cv_overfit_floor: number;
  min_sample_param_ratio: number;
}

export interface FitQualityConfig {
  zones: Array<{ id: string; label: string }>;
  thresholds: FitQualityThresholds;
  positionMapping: Record<string, [number, number]>;
}

export interface DataSufficiency {
  ratio: number;
  targetRatio: number;
  sampleCount: number;
  modelParamCount: number;
  sufficient: boolean;
}

export interface FitQuality {
  zone: string;
  position: number;
  label: string;
  detail: string;
  detailParams?: Record<string, string | number>;
  dataSufficiency: DataSufficiency | null;
}

export const DEFAULT_LSTM_FIT_QUALITY_CONFIG =
  defaultConfigJson as unknown as FitQualityConfig;

function zoneLabel(config: FitQualityConfig, zoneId: string): string {
  return config.zones.find((zone) => zone.id === zoneId)?.label ?? zoneId;
}

function formatParamCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function assessFitQuality(
  config: FitQualityConfig,
  perFoldSharpes: number[] | null,
  meanValSharpe: number | null,
  sampleCount?: number | null,
  modelParamCount?: number | null,
): FitQuality {
  const dataSufficiency = sampleCount != null && modelParamCount != null && modelParamCount > 0
    ? {
        ratio: sampleCount / modelParamCount,
        targetRatio: config.thresholds.min_sample_param_ratio,
        sampleCount,
        modelParamCount,
        sufficient: sampleCount / modelParamCount >= config.thresholds.min_sample_param_ratio,
      }
    : null;

  if (!perFoldSharpes || perFoldSharpes.length < 2 || meanValSharpe == null) {
    return {
      zone: 'unknown',
      position: 50,
      label: 'fitQuality.insufficientData',
      detail: 'fitQuality.needTwoFoldResults',
      dataSufficiency,
    };
  }

  const { thresholds, positionMapping } = config;
  const mean = meanValSharpe;
  if (dataSufficiency && !dataSufficiency.sufficient) {
    const range = positionMapping.underfit ?? [0, 20];
    const fraction = Math.min(1, dataSufficiency.ratio / dataSufficiency.targetRatio);
    return {
      zone: 'underfit',
      position: range[0] + fraction * (range[1] - range[0]),
      label: zoneLabel(config, 'underfit'),
      detail: 'fitQuality.dataStarved',
      detailParams: {
        sampleCount: dataSufficiency.sampleCount.toLocaleString(),
        paramCount: formatParamCount(dataSufficiency.modelParamCount),
        ratio: dataSufficiency.ratio.toFixed(2),
        targetRatio: String(dataSufficiency.targetRatio),
      },
      dataSufficiency,
    };
  }

  const variance = perFoldSharpes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / perFoldSharpes.length;
  const deviation = Math.sqrt(variance);
  const cv = Math.abs(mean) > 0.001 ? deviation / Math.abs(mean) : deviation * 100;

  if (cv >= thresholds.cv_overfit_floor) {
    const range = positionMapping.overfit ?? [70, 100];
    const fraction = Math.min(1, (cv - thresholds.cv_overfit_floor) / (thresholds.cv_overfit_floor * 0.5));
    return {
      zone: 'overfit',
      position: range[0] + fraction * (range[1] - range[0]),
      label: zoneLabel(config, 'overfit'),
      detail: `Sharpe ${mean.toFixed(3)}, CV ${cv.toFixed(1)} -- high fold variance`,
      dataSufficiency,
    };
  }

  if (mean < thresholds.sharpe_underfit_ceil) {
    const range = positionMapping.underfit ?? [0, 20];
    const fraction = Math.max(0, 1 - Math.abs(mean - thresholds.sharpe_underfit_ceil) / 0.1);
    return {
      zone: 'underfit',
      position: Math.max(range[0], Math.min(range[1], range[0] + fraction * (range[1] - range[0]))),
      label: zoneLabel(config, 'underfit'),
      detail: `Sharpe ${mean.toFixed(3)} -- model not learning`,
      dataSufficiency,
    };
  }

  if (mean < thresholds.sharpe_marginal_ceil || cv >= thresholds.cv_marginal_floor) {
    const range = positionMapping.marginal ?? [20, 40];
    const sharpeFraction = thresholds.sharpe_marginal_ceil > thresholds.sharpe_underfit_ceil
      ? (mean - thresholds.sharpe_underfit_ceil) / (thresholds.sharpe_marginal_ceil - thresholds.sharpe_underfit_ceil)
      : 0.5;
    const cvPenalty = cv >= thresholds.cv_marginal_floor
      ? 0.3 * Math.min(1, (cv - thresholds.cv_marginal_floor) / (thresholds.cv_overfit_floor - thresholds.cv_marginal_floor))
      : 0;
    const fraction = Math.max(0, Math.min(1, sharpeFraction - cvPenalty));
    return {
      zone: 'marginal',
      position: range[0] + fraction * (range[1] - range[0]),
      label: zoneLabel(config, 'marginal'),
      detail: `Sharpe ${mean.toFixed(3)}, CV ${cv.toFixed(1)} -- borderline signal`,
      dataSufficiency,
    };
  }

  const range = positionMapping.well_fitted ?? [40, 70];
  const sharpeScore = Math.min(1, (mean - thresholds.sharpe_marginal_ceil) / 0.3);
  const cvScore = 1 - Math.min(1, cv / thresholds.cv_marginal_floor);
  return {
    zone: 'well_fitted',
    position: range[0] + ((sharpeScore + cvScore) / 2) * (range[1] - range[0]),
    label: zoneLabel(config, 'well_fitted'),
    detail: `Sharpe ${mean.toFixed(3)}, CV ${cv.toFixed(1)} -- consistent validation-fold fit`,
    dataSufficiency,
  };
}
