import type {
  PopModelMetrics,
  ReliabilityBin,
  BootstrapIntervals,
  ActualShadowSensitivity,
} from './contracts.js';

import type { TrainingRow } from './trainer-types.js';

import { CORRECTIVE_ERROR_CODES } from './constants.js';
import { CorrectiveError } from './contracts.js';

export function computeBrierScore(
  predictions: readonly number[],
  labels: readonly boolean[],
): number {
  if (predictions.length !== labels.length || predictions.length === 0) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.TRAINING_CALIBRATION_FAILED,
      'Brier score requires matching non-empty arrays',
    );
  }
  let sum = 0;
  for (let i = 0; i < predictions.length; i++) {
    const diff = predictions[i] - (labels[i] ? 1 : 0);
    sum += diff * diff;
  }
  return sum / predictions.length;
}

export function computeLogLoss(
  predictions: readonly number[],
  labels: readonly boolean[],
): number {
  if (predictions.length !== labels.length || predictions.length === 0) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.TRAINING_CALIBRATION_FAILED,
      'Log loss requires matching non-empty arrays',
    );
  }
  const eps = 1e-15;
  let sum = 0;
  for (let i = 0; i < predictions.length; i++) {
    const p = Math.max(eps, Math.min(1 - eps, predictions[i]));
    const y = labels[i] ? 1 : 0;
    sum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return sum / predictions.length;
}

export function computeRocAuc(
  predictions: readonly number[],
  labels: readonly boolean[],
): number {
  if (predictions.length !== labels.length || predictions.length === 0) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.TRAINING_CALIBRATION_FAILED,
      'ROC-AUC requires matching non-empty arrays',
    );
  }

  const indices = Array.from({ length: predictions.length }, (_, i) => i);
  indices.sort((a, b) => predictions[b] - predictions[a]);

  let tp = 0;
  let fp = 0;
  const totalPos = labels.filter(Boolean).length;
  const totalNeg = labels.length - totalPos;

  if (totalPos === 0 || totalNeg === 0) return 0.5;

  let auc = 0;
  let prevTpr = 0;
  let prevFpr = 0;

  for (let i = 0; i < indices.length; i++) {
    if (labels[indices[i]]) {
      tp++;
    } else {
      fp++;
    }
    const tpr = tp / totalPos;
    const fpr = fp / totalNeg;
    auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;
    prevTpr = tpr;
    prevFpr = fpr;
  }

  return auc;
}

export function computePrAuc(
  predictions: readonly number[],
  labels: readonly boolean[],
): number {
  if (predictions.length !== labels.length || predictions.length === 0) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.TRAINING_CALIBRATION_FAILED,
      'PR-AUC requires matching non-empty arrays',
    );
  }

  const indices = Array.from({ length: predictions.length }, (_, i) => i);
  indices.sort((a, b) => predictions[b] - predictions[a]);

  const totalPos = labels.filter(Boolean).length;
  if (totalPos === 0) return 0;

  let tp = 0;
  let fp = 0;
  let auc = 0;
  let prevRecall = 0;

  for (let i = 0; i < indices.length; i++) {
    if (labels[indices[i]]) {
      tp++;
    } else {
      fp++;
    }
    const precision = tp / (tp + fp);
    const recall = tp / totalPos;
    auc += (recall - prevRecall) * precision;
    prevRecall = recall;
  }

  return auc;
}

export function computeCalibrationError(
  predictions: readonly number[],
  labels: readonly boolean[],
  nBins = 10,
): number {
  if (predictions.length === 0) return 0;

  let weightedError = 0;
  for (let b = 0; b < nBins; b++) {
    const lo = b / nBins;
    const hi = (b + 1) / nBins;
    let sumPred = 0;
    let sumLabel = 0;
    let count = 0;
    for (let i = 0; i < predictions.length; i++) {
      if (predictions[i] >= lo && predictions[i] < hi) {
        sumPred += predictions[i];
        sumLabel += labels[i] ? 1 : 0;
        count++;
      }
    }
    if (count > 0) {
      weightedError += (count / predictions.length) * Math.abs(sumPred / count - sumLabel / count);
    }
  }
  return weightedError;
}

export function computeBinnedReliability(
  predictions: readonly number[],
  labels: readonly boolean[],
  nBins = 10,
): ReliabilityBin[] {
  const bins: ReliabilityBin[] = [];
  for (let b = 0; b < nBins; b++) {
    const binLower = b / nBins;
    const binUpper = (b + 1) / nBins;
    let sumPred = 0;
    let sumLabel = 0;
    let count = 0;
    for (let i = 0; i < predictions.length; i++) {
      if (predictions[i] >= binLower && predictions[i] < binUpper) {
        sumPred += predictions[i];
        sumLabel += labels[i] ? 1 : 0;
        count++;
      }
    }
    if (count > 0) {
      bins.push({
        binLower,
        binUpper,
        meanPredicted: sumPred / count,
        meanObserved: sumLabel / count,
        count,
      });
    }
  }
  return bins;
}

export function computeHitRate(
  predictions: readonly number[],
  labels: readonly boolean[],
  threshold: number,
): number {
  let passed = 0;
  let correct = 0;
  for (let i = 0; i < predictions.length; i++) {
    if (predictions[i] >= threshold) {
      passed++;
      if (labels[i]) correct++;
    }
  }
  return passed > 0 ? correct / passed : 0;
}

export function computeNetReturnAfterCosts(
  rows: readonly TrainingRow[],
  predictions: readonly number[],
  threshold: number,
): number {
  let totalReturn = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (predictions[i] >= threshold) {
      totalReturn += rows[i].netPnl;
      count++;
    }
  }
  return count > 0 ? totalReturn : 0;
}

export function computeSharpe(returns: readonly number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  let variance = 0;
  for (const r of returns) {
    variance += (r - mean) * (r - mean);
  }
  variance /= returns.length - 1;
  const std = Math.sqrt(variance);
  return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
}

export function computeMaxDrawdown(cumulativePnl: readonly number[]): number {
  if (cumulativePnl.length === 0) return 0;
  let peak = cumulativePnl[0];
  let maxDD = 0;
  for (const val of cumulativePnl) {
    if (val > peak) peak = val;
    const dd = val - peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

export function computeTurnover(
  predictions: readonly number[],
  threshold: number,
): number {
  const total = predictions.length;
  if (total === 0) return 0;
  const passed = predictions.filter(p => p >= threshold).length;
  return passed / total;
}

export function computeBlockBootstrapIntervals(
  predictions: readonly number[],
  labels: readonly boolean[],
  nSamples: number,
  blockSize: number,
  seedBase: number,
): BootstrapIntervals {
  const n = predictions.length;
  if (n === 0 || blockSize <= 0) {
    return {
      nSamples,
      blockSize,
      brierScoreCi95: [0, 0],
      rocAucCi95: [0, 0],
      sharpeCi95: [0, 0],
      hitRateCi95: [0, 0],
    };
  }

  const nBlocks = Math.ceil(n / blockSize);
  const brierSamples: number[] = [];
  const rocAucSamples: number[] = [];
  const hitRateSamples: number[] = [];

  for (let s = 0; s < nSamples; s++) {
    const sampledPreds: number[] = [];
    const sampledLabels: boolean[] = [];

    for (let b = 0; b < nBlocks; b++) {
      const seed = hashSeed(seedBase, s, b);
      const blockStart = seed % n;
      for (let j = 0; j < blockSize && sampledPreds.length < n; j++) {
        const idx = (blockStart + j) % n;
        sampledPreds.push(predictions[idx]);
        sampledLabels.push(labels[idx]);
      }
    }

    const hasPos = sampledLabels.some(Boolean);
    const hasNeg = sampledLabels.some(l => !l);
    if (!hasPos || !hasNeg) continue;

    brierSamples.push(computeBrierScore(sampledPreds, sampledLabels));
    rocAucSamples.push(computeRocAuc(sampledPreds, sampledLabels));
    hitRateSamples.push(computeHitRate(sampledPreds, sampledLabels, 0.5));
  }

  return {
    nSamples,
    blockSize,
    brierScoreCi95: percentileInterval(brierSamples, 0.025, 0.975),
    rocAucCi95: percentileInterval(rocAucSamples, 0.025, 0.975),
    sharpeCi95: [0, 0],
    hitRateCi95: percentileInterval(hitRateSamples, 0.025, 0.975),
  };
}

function hashSeed(base: number, s: number, b: number): number {
  let h = (base ^ (s * 2654435761) ^ (b * 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

function percentileInterval(
  samples: readonly number[],
  lo: number,
  hi: number,
): [number, number] {
  if (samples.length === 0) return [0, 0];
  const sorted = samples.slice().sort((a, b) => a - b);
  const loIdx = Math.floor(lo * sorted.length);
  const hiIdx = Math.min(Math.floor(hi * sorted.length), sorted.length - 1);
  return [sorted[loIdx], sorted[hiIdx]];
}

export function computeActualShadowSensitivity(
  rows: readonly TrainingRow[],
  predictions: readonly number[],
  labels: readonly boolean[],
): ActualShadowSensitivity {
  const actualIdx: number[] = [];
  const shadowIdx: number[] = [];
  let censoredCount = 0;

  for (let i = 0; i < rows.length; i++) {
    if (rows[i].outcomeType === 'actual') actualIdx.push(i);
    else if (rows[i].outcomeType === 'shadow') shadowIdx.push(i);
    else censoredCount++;
  }

  const actualPreds = actualIdx.map(i => predictions[i]);
  const actualLabels = actualIdx.map(i => labels[i]);
  const shadowPreds = shadowIdx.map(i => predictions[i]);
  const shadowLabels = shadowIdx.map(i => labels[i]);

  const safeMetrics = (preds: readonly number[], labs: readonly boolean[]) => {
    const hasPos = labs.some(Boolean);
    const hasNeg = labs.some(l => !l);
    if (!hasPos || !hasNeg || preds.length === 0) {
      return { brierScore: 0, rocAuc: 0.5, hitRate: 0 };
    }
    return {
      brierScore: computeBrierScore(preds, labs),
      rocAuc: computeRocAuc(preds, labs),
      hitRate: computeHitRate(preds, labs, 0.5),
    };
  };

  return {
    actualCount: actualIdx.length,
    shadowCount: shadowIdx.length,
    censoredCount,
    metricsActualOnly: safeMetrics(actualPreds, actualLabels),
    metricsShadowOnly: safeMetrics(shadowPreds, shadowLabels),
  };
}

export function computeFullMetrics(
  rows: readonly TrainingRow[],
  predictions: readonly number[],
  labels: readonly boolean[],
  threshold: number,
  bootstrapSamples: number,
  bootstrapBlockSize: number,
  seedBase: number,
): PopModelMetrics {
  const brierScore = computeBrierScore(predictions, labels);
  const logLoss = computeLogLoss(predictions, labels);
  const rocAuc = computeRocAuc(predictions, labels);
  const prAuc = computePrAuc(predictions, labels);
  const calibrationError = computeCalibrationError(predictions, labels);
  const hitRate = computeHitRate(predictions, labels, threshold);
  const turnover = computeTurnover(predictions, threshold);
  const coverage = predictions.filter(p => p >= threshold).length / predictions.length;

  const passedReturns: number[] = [];
  const cumulativePnl: number[] = [];
  let cumPnl = 0;
  for (let i = 0; i < rows.length; i++) {
    if (predictions[i] >= threshold) {
      passedReturns.push(rows[i].netPnl);
      cumPnl += rows[i].netPnl;
      cumulativePnl.push(cumPnl);
    }
  }

  const netReturnAfterCosts = cumPnl;
  const sharpe = computeSharpe(passedReturns);
  const maxDrawdown = computeMaxDrawdown(cumulativePnl);

  const binnedReliability = computeBinnedReliability(predictions, labels);
  const bootstrapIntervals = computeBlockBootstrapIntervals(
    predictions, labels, bootstrapSamples, bootstrapBlockSize, seedBase,
  );
  const actualShadowSensitivity = computeActualShadowSensitivity(
    rows, predictions, labels,
  );

  return {
    brierScore,
    logLoss,
    rocAuc,
    prAuc,
    calibrationError,
    coverage,
    netReturnAfterCosts,
    sharpe,
    maxDrawdown,
    hitRate,
    turnover,
    binnedReliability,
    bootstrapIntervals,
    actualShadowSensitivity,
  };
}
