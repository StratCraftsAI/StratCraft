import { describe, it, expect } from 'vitest';

import {
  fitIsotonicCalibration,
  applyIsotonicCalibration,
  fitPlattCalibration,
  applyPlattCalibration,
} from '../calibration.js';
import { CorrectiveError } from '../contracts.js';

describe('fitIsotonicCalibration', () => {
  it('produces monotonically non-decreasing breakpoints', () => {
    const predictions = [0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4, 0.6, 0.8, 0.15];
    const labels = [false, false, true, true, true, false, false, true, true, false];

    const result = fitIsotonicCalibration(predictions, labels);

    expect(result.method).toBe('isotonic');
    expect(result.fittedOn).toBe('validation_only');
    expect(result.breakpoints.length).toBeGreaterThan(0);

    for (let i = 1; i < result.breakpoints.length; i++) {
      expect(result.breakpoints[i].y).toBeGreaterThanOrEqual(
        result.breakpoints[i - 1].y,
      );
    }
  });

  it('rejects mismatched array lengths', () => {
    expect(() => fitIsotonicCalibration([0.5], [true, false])).toThrow(CorrectiveError);
  });

  it('rejects empty arrays', () => {
    expect(() => fitIsotonicCalibration([], [])).toThrow(CorrectiveError);
  });

  it('handles perfectly separated predictions', () => {
    const predictions = [0.1, 0.2, 0.3, 0.8, 0.9, 1.0];
    const labels = [false, false, false, true, true, true];

    const result = fitIsotonicCalibration(predictions, labels);

    const calLow = applyIsotonicCalibration(0.15, result.breakpoints);
    const calHigh = applyIsotonicCalibration(0.85, result.breakpoints);

    expect(calLow).toBeLessThan(0.5);
    expect(calHigh).toBeGreaterThan(0.5);
  });

  it('produces calibrated outputs for constant predictions', () => {
    const predictions = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const labels = [true, false, true, false, true, false];

    const result = fitIsotonicCalibration(predictions, labels);
    const calibrated = applyIsotonicCalibration(0.5, result.breakpoints);
    expect(calibrated).toBeCloseTo(0.5, 1);
  });
});

describe('applyIsotonicCalibration', () => {
  it('returns first breakpoint y for values below range', () => {
    const breakpoints = [
      { x: 0.2, y: 0.1 },
      { x: 0.8, y: 0.9 },
    ];
    expect(applyIsotonicCalibration(0.0, breakpoints)).toBe(0.1);
  });

  it('returns last breakpoint y for values above range', () => {
    const breakpoints = [
      { x: 0.2, y: 0.1 },
      { x: 0.8, y: 0.9 },
    ];
    expect(applyIsotonicCalibration(1.0, breakpoints)).toBe(0.9);
  });

  it('interpolates linearly between breakpoints', () => {
    const breakpoints = [
      { x: 0.0, y: 0.0 },
      { x: 1.0, y: 1.0 },
    ];
    expect(applyIsotonicCalibration(0.5, breakpoints)).toBeCloseTo(0.5, 5);
  });

  it('returns raw prediction for empty breakpoints', () => {
    expect(applyIsotonicCalibration(0.7, [])).toBe(0.7);
  });
});

describe('fitPlattCalibration', () => {
  it('produces sigmoid parameters', () => {
    const predictions = [0.1, 0.2, 0.3, 0.7, 0.8, 0.9];
    const labels = [false, false, false, true, true, true];

    const result = fitPlattCalibration(predictions, labels);

    expect(result.method).toBe('platt');
    expect(result.fittedOn).toBe('validation_only');
    expect(result.parameters).toHaveProperty('a');
    expect(result.parameters).toHaveProperty('b');
    expect(Number.isFinite(result.parameters.a)).toBe(true);
    expect(Number.isFinite(result.parameters.b)).toBe(true);
  });

  it('rejects mismatched arrays', () => {
    expect(() => fitPlattCalibration([0.5], [true, false])).toThrow(CorrectiveError);
  });

  it('rejects empty arrays', () => {
    expect(() => fitPlattCalibration([], [])).toThrow(CorrectiveError);
  });
});

describe('applyPlattCalibration', () => {
  it('produces outputs in [0, 1]', () => {
    for (const x of [-10, -1, 0, 0.5, 1, 10]) {
      const result = applyPlattCalibration(x, -2, 1);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });

  it('higher predictions produce higher calibrated values with negative a', () => {
    const cal1 = applyPlattCalibration(0.3, -5, 2);
    const cal2 = applyPlattCalibration(0.7, -5, 2);
    expect(cal2).toBeGreaterThan(cal1);
  });
});

describe('AC8: calibration validation-only mutation test', () => {
  it('detects training data leakage into calibration', () => {
    const trainPreds = Array.from({ length: 100 }, (_, i) => i / 100);
    const trainLabels = Array.from({ length: 100 }, (_, i) => i >= 50);

    const valPreds = Array.from({ length: 50 }, (_, i) => (i + 25) / 100);
    const valLabels = Array.from({ length: 50 }, (_, i) => i >= 25);

    const calValidOnly = fitIsotonicCalibration(valPreds, valLabels);

    const leakedPreds = [...trainPreds, ...valPreds];
    const leakedLabels = [...trainLabels, ...valLabels];
    const calWithLeak = fitIsotonicCalibration(leakedPreds, leakedLabels);

    expect(calWithLeak.parameters.nPoints).toBeGreaterThan(
      calValidOnly.parameters.nPoints,
    );

    const testPoint = 0.45;
    const calClean = applyIsotonicCalibration(testPoint, calValidOnly.breakpoints);
    const calLeaked = applyIsotonicCalibration(testPoint, calWithLeak.breakpoints);
    expect(calClean).not.toBeCloseTo(calLeaked, 2);
  });
});
