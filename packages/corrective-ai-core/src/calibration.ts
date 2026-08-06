import type { CalibrationResult, CalibrationBreakpoint } from './trainer-types.js';

import { CORRECTIVE_ERROR_CODES } from './constants.js';
import { CorrectiveError } from './contracts.js';

export function fitIsotonicCalibration(
  predictions: readonly number[],
  labels: readonly boolean[],
): CalibrationResult {
  if (predictions.length !== labels.length) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.TRAINING_CALIBRATION_FAILED,
      `Prediction count ${predictions.length} != label count ${labels.length}`,
    );
  }

  if (predictions.length === 0) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.TRAINING_CALIBRATION_FAILED,
      'Empty predictions for calibration',
    );
  }

  const indices = Array.from({ length: predictions.length }, (_, i) => i);
  indices.sort((a, b) => predictions[a] - predictions[b]);

  const sortedPred = indices.map(i => predictions[i]);
  const sortedLabels = indices.map(i => (labels[i] ? 1.0 : 0.0));

  const calibrated = poolAdjacentViolators(sortedLabels);

  const breakpoints: CalibrationBreakpoint[] = [];
  let prevY = -1;
  for (let i = 0; i < sortedPred.length; i++) {
    if (calibrated[i] !== prevY || i === 0 || i === sortedPred.length - 1) {
      breakpoints.push({ x: sortedPred[i], y: calibrated[i] });
      prevY = calibrated[i];
    }
  }

  return {
    method: 'isotonic',
    fittedOn: 'validation_only',
    breakpoints,
    parameters: {
      nPoints: predictions.length,
      nBreakpoints: breakpoints.length,
    },
  };
}

function poolAdjacentViolators(values: readonly number[]): number[] {
  const n = values.length;
  const result = values.slice();
  const weight = new Array<number>(n).fill(1);

  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n - 1 && result[j] >= result[j + 1]) {
      let sumVal = 0;
      let sumWeight = 0;
      for (let k = i; k <= j + 1; k++) {
        sumVal += result[k] * weight[k];
        sumWeight += weight[k];
      }
      const avg = sumVal / sumWeight;
      for (let k = i; k <= j + 1; k++) {
        result[k] = avg;
        weight[k] = sumWeight / (j + 1 - i + 1);
      }
      j++;
    }
    i = j + 1;
  }

  return result;
}

export function applyIsotonicCalibration(
  rawPrediction: number,
  breakpoints: readonly CalibrationBreakpoint[],
): number {
  if (breakpoints.length === 0) return rawPrediction;
  if (breakpoints.length === 1) return breakpoints[0].y;

  if (rawPrediction <= breakpoints[0].x) return breakpoints[0].y;
  if (rawPrediction >= breakpoints[breakpoints.length - 1].x) {
    return breakpoints[breakpoints.length - 1].y;
  }

  let lo = 0;
  let hi = breakpoints.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (breakpoints[mid].x <= rawPrediction) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const x0 = breakpoints[lo].x;
  const y0 = breakpoints[lo].y;
  const x1 = breakpoints[hi].x;
  const y1 = breakpoints[hi].y;

  if (x1 === x0) return y0;
  const t = (rawPrediction - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

export function fitPlattCalibration(
  predictions: readonly number[],
  labels: readonly boolean[],
): CalibrationResult {
  if (predictions.length !== labels.length) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.TRAINING_CALIBRATION_FAILED,
      `Prediction count ${predictions.length} != label count ${labels.length}`,
    );
  }

  if (predictions.length === 0) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.TRAINING_CALIBRATION_FAILED,
      'Empty predictions for calibration',
    );
  }

  const y = labels.map(l => (l ? 1.0 : 0.0));
  const nPos = y.filter(v => v === 1).length;
  const nNeg = y.length - nPos;

  const tPos = (nPos + 1) / (nPos + 2);
  const tNeg = 1 / (nNeg + 2);
  const target = y.map(v => (v === 1 ? tPos : tNeg));

  let a = 0;
  let b = Math.log((nNeg + 1) / (nPos + 1));

  const maxIter = 100;
  const eps = 1e-12;

  for (let iter = 0; iter < maxIter; iter++) {
    let h11 = eps;
    let h22 = eps;
    let h21 = 0;
    let g1 = 0;
    let g2 = 0;

    for (let i = 0; i < predictions.length; i++) {
      const fApB = predictions[i] * a + b;
      let p: number;
      if (fApB >= 0) {
        p = Math.exp(-fApB) / (1 + Math.exp(-fApB));
      } else {
        p = 1 / (1 + Math.exp(fApB));
      }
      const d1 = p * (1 - p);
      const d2 = target[i] - p;

      h11 += predictions[i] * predictions[i] * d1;
      h22 += d1;
      h21 += predictions[i] * d1;
      g1 += predictions[i] * d2;
      g2 += d2;
    }

    const det = h11 * h22 - h21 * h21;
    if (Math.abs(det) < eps) break;

    const da = -(h22 * g1 - h21 * g2) / det;
    const db = -(-h21 * g1 + h11 * g2) / det;

    if (Math.abs(da) < eps && Math.abs(db) < eps) break;

    a += da;
    b += db;
  }

  return {
    method: 'platt',
    fittedOn: 'validation_only',
    breakpoints: [],
    parameters: { a, b },
  };
}

export function applyPlattCalibration(
  rawPrediction: number,
  a: number,
  b: number,
): number {
  const fApB = rawPrediction * a + b;
  if (fApB >= 0) {
    return Math.exp(-fApB) / (1 + Math.exp(-fApB));
  }
  return 1 / (1 + Math.exp(fApB));
}
