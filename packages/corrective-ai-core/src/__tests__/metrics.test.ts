import { describe, it, expect } from 'vitest';

import {
  computeBrierScore,
  computeLogLoss,
  computeRocAuc,
  computePrAuc,
  computeCalibrationError,
  computeBinnedReliability,
  computeHitRate,
  computeNetReturnAfterCosts,
  computeSharpe,
  computeMaxDrawdown,
  computeTurnover,
  computeBlockBootstrapIntervals,
  computeActualShadowSensitivity,
  computeFullMetrics,
} from '../metrics.js';

import type { TrainingRow } from '../trainer-types.js';

function makeRow(index: number, outcomeType: 'actual' | 'shadow' = 'actual'): TrainingRow {
  return {
    runId: 'run-1',
    candidateId: index,
    asOfTimestampNs: 1_000_000_000 + index * 1_000_000,
    knowledgeCutoffTimestampNs: 1_000_000_000 + index * 1_000_000 - 500,
    symbolId: 'EURUSD',
    side: 'long',
    proposedSize: 100,
    finalSize: 100,
    featureVector: Array(14).fill(0.5),
    featureSchemaHash: 'b58a76c9',
    gateVerdict: 'collect_only',
    outcomeType,
    entryTimestampNs: 1_000_000_000 + index * 1_000_000,
    exitTimestampNs: 1_000_000_000 + (index + 5) * 1_000_000,
    holdingIntervalBars: 5,
    netPnl: index % 2 === 0 ? 10 : -10,
    completionStatus: 'complete',
    profitLabel: index % 2 === 0,
    labelPolicyVersion: 1,
  };
}

describe('computeBrierScore', () => {
  it('throws for mismatched arrays', () => {
    expect(() => computeBrierScore([0.5], [true, false])).toThrow();
  });

  it('throws for empty arrays', () => {
    expect(() => computeBrierScore([], [])).toThrow();
  });

  it('returns 0 for perfect predictions', () => {
    const preds = [1, 0, 1, 0];
    const labels = [true, false, true, false];
    expect(computeBrierScore(preds, labels)).toBe(0);
  });

  it('returns 1 for perfectly wrong predictions', () => {
    const preds = [0, 1, 0, 1];
    const labels = [true, false, true, false];
    expect(computeBrierScore(preds, labels)).toBe(1);
  });

  it('returns 0.25 for constant 0.5 predictions', () => {
    const preds = [0.5, 0.5, 0.5, 0.5];
    const labels = [true, false, true, false];
    expect(computeBrierScore(preds, labels)).toBe(0.25);
  });
});

describe('computeLogLoss', () => {
  it('throws for mismatched arrays', () => {
    expect(() => computeLogLoss([0.5], [true, false])).toThrow();
  });

  it('throws for empty arrays', () => {
    expect(() => computeLogLoss([], [])).toThrow();
  });

  it('lower for better predictions', () => {
    const goodPreds = [0.9, 0.1, 0.8, 0.2];
    const badPreds = [0.1, 0.9, 0.2, 0.8];
    const labels = [true, false, true, false];

    expect(computeLogLoss(goodPreds, labels)).toBeLessThan(
      computeLogLoss(badPreds, labels),
    );
  });

  it('handles edge case predictions', () => {
    const preds = [0.999, 0.001];
    const labels = [true, false];
    expect(Number.isFinite(computeLogLoss(preds, labels))).toBe(true);
  });
});

describe('computeRocAuc', () => {
  it('throws for mismatched arrays', () => {
    expect(() => computeRocAuc([0.5], [true, false])).toThrow();
  });

  it('throws for empty arrays', () => {
    expect(() => computeRocAuc([], [])).toThrow();
  });

  it('returns 1.0 for perfectly separated classes', () => {
    const preds = [0.1, 0.2, 0.3, 0.8, 0.9, 1.0];
    const labels = [false, false, false, true, true, true];
    expect(computeRocAuc(preds, labels)).toBeCloseTo(1.0, 2);
  });

  it('returns ~0.5 for uninformative predictions', () => {
    const preds = [0.6, 0.4, 0.6, 0.4];
    const labels = [true, false, false, true];
    expect(computeRocAuc(preds, labels)).toBeCloseTo(0.5, 1);
  });

  it('returns 0.5 for single-class labels', () => {
    const preds = [0.3, 0.7];
    const labels = [true, true];
    expect(computeRocAuc(preds, labels)).toBe(0.5);
  });
});

describe('computePrAuc', () => {
  it('returns near 1 for perfect separation', () => {
    const preds = [0.1, 0.2, 0.8, 0.9];
    const labels = [false, false, true, true];
    expect(computePrAuc(preds, labels)).toBeGreaterThan(0.9);
  });

  it('returns 0 for no positive labels', () => {
    const preds = [0.3, 0.7];
    const labels = [false, false];
    expect(computePrAuc(preds, labels)).toBe(0);
  });
});

describe('computeCalibrationError', () => {
  it('returns 0 for perfectly calibrated predictions', () => {
    const preds: number[] = [];
    const labels: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      preds.push(0.25);
      labels.push(i < 25);
    }
    expect(computeCalibrationError(preds, labels, 10)).toBeLessThan(0.05);
  });
});

describe('computeBinnedReliability', () => {
  it('produces bins with counts', () => {
    const preds = [0.1, 0.3, 0.5, 0.7, 0.9];
    const labels = [false, false, true, true, true];

    const bins = computeBinnedReliability(preds, labels, 5);
    expect(bins.length).toBeGreaterThan(0);

    const totalCount = bins.reduce((s, b) => s + b.count, 0);
    expect(totalCount).toBe(5);
  });
});

describe('computeHitRate', () => {
  it('returns correct hit rate', () => {
    const preds = [0.8, 0.2, 0.7, 0.3];
    const labels = [true, false, true, false];
    expect(computeHitRate(preds, labels, 0.5)).toBe(1.0);
  });

  it('returns 0 when nothing passes threshold', () => {
    const preds = [0.1, 0.2, 0.3, 0.4];
    const labels = [true, false, true, false];
    expect(computeHitRate(preds, labels, 0.5)).toBe(0);
  });
});

describe('computeSharpe', () => {
  it('returns 0 for single return', () => {
    expect(computeSharpe([5])).toBe(0);
  });

  it('positive for returns with nonzero mean and variance', () => {
    const returns = Array.from({ length: 100 }, (_, i) => 1 + (i % 3) * 0.1);
    expect(computeSharpe(returns)).toBeGreaterThan(0);
  });

  it('handles zero std', () => {
    const returns = [5, 5, 5, 5];
    expect(Number.isFinite(computeSharpe(returns))).toBe(true);
  });
});

describe('computeMaxDrawdown', () => {
  it('returns 0 for monotonically increasing equity', () => {
    expect(computeMaxDrawdown([1, 2, 3, 4, 5])).toBe(0);
  });

  it('returns correct drawdown', () => {
    expect(computeMaxDrawdown([10, 8, 6, 9, 4])).toBe(-6);
  });
});

describe('computeNetReturnAfterCosts', () => {
  it('sums netPnl for predictions above threshold', () => {
    const rows = [makeRow(0), makeRow(1), makeRow(2), makeRow(3)];
    const preds = [0.8, 0.3, 0.7, 0.2];
    expect(computeNetReturnAfterCosts(rows, preds, 0.5)).toBe(
      rows[0].netPnl + rows[2].netPnl,
    );
  });

  it('returns 0 when nothing passes threshold', () => {
    const rows = [makeRow(0)];
    expect(computeNetReturnAfterCosts(rows, [0.1], 0.5)).toBe(0);
  });
});

describe('computePrAuc edge cases', () => {
  it('throws for mismatched arrays', () => {
    expect(() => computePrAuc([0.5], [true, false])).toThrow();
  });

  it('throws for empty arrays', () => {
    expect(() => computePrAuc([], [])).toThrow();
  });
});

describe('computeTurnover', () => {
  it('returns fraction passing threshold', () => {
    expect(computeTurnover([0.3, 0.6, 0.8, 0.2], 0.5)).toBe(0.5);
  });
});

describe('computeBlockBootstrapIntervals', () => {
  it('produces finite CIs', () => {
    const preds = Array.from({ length: 50 }, (_, i) => i / 50);
    const labels = Array.from({ length: 50 }, (_, i) => i >= 25);

    const result = computeBlockBootstrapIntervals(preds, labels, 100, 5, 42);

    expect(result.nSamples).toBe(100);
    expect(result.blockSize).toBe(5);
    expect(result.brierScoreCi95[0]).toBeLessThanOrEqual(result.brierScoreCi95[1]);
    expect(result.rocAucCi95[0]).toBeLessThanOrEqual(result.rocAucCi95[1]);
  });
});

describe('computeActualShadowSensitivity', () => {
  it('separates actual and shadow metrics', () => {
    const rows = [
      makeRow(0, 'actual'),
      makeRow(1, 'actual'),
      makeRow(2, 'shadow'),
      makeRow(3, 'shadow'),
    ];
    const preds = [0.8, 0.2, 0.7, 0.3];
    const labels = [true, false, true, false];

    const result = computeActualShadowSensitivity(rows, preds, labels);
    expect(result.actualCount).toBe(2);
    expect(result.shadowCount).toBe(2);
    expect(result.censoredCount).toBe(0);
  });
});

describe('computeBlockBootstrapIntervals edge cases', () => {
  it('returns zeros for empty input', () => {
    const result = computeBlockBootstrapIntervals([], [], 100, 5, 42);
    expect(result.brierScoreCi95).toEqual([0, 0]);
  });

  it('returns zeros for zero blockSize', () => {
    const result = computeBlockBootstrapIntervals([0.5], [true], 100, 0, 42);
    expect(result.brierScoreCi95).toEqual([0, 0]);
  });
});

describe('computeActualShadowSensitivity edge cases', () => {
  it('handles all censored rows', () => {
    const rows = [
      makeRow(0, 'actual'),
      makeRow(1, 'actual'),
    ];
    rows[0] = { ...rows[0], outcomeType: 'censored' as const };
    rows[1] = { ...rows[1], outcomeType: 'censored' as const };

    const result = computeActualShadowSensitivity(rows, [0.5, 0.5], [true, false]);
    expect(result.censoredCount).toBe(2);
    expect(result.actualCount).toBe(0);
    expect(result.shadowCount).toBe(0);
  });

  it('handles single-class actual subset', () => {
    const rows = [makeRow(0, 'actual'), makeRow(1, 'actual')];
    const result = computeActualShadowSensitivity(rows, [0.5, 0.5], [true, true]);
    expect(result.metricsActualOnly.rocAuc).toBe(0.5);
  });
});

describe('computeFullMetrics', () => {
  it('produces all required fields', () => {
    const rows = Array.from({ length: 50 }, (_, i) => makeRow(i));
    const preds = Array.from({ length: 50 }, (_, i) => i / 50);
    const labels = rows.map(r => r.profitLabel!);

    const metrics = computeFullMetrics(rows, preds, labels, 0.5, 50, 5, 42);

    expect(metrics.brierScore).toBeGreaterThanOrEqual(0);
    expect(metrics.logLoss).toBeGreaterThan(0);
    expect(metrics.rocAuc).toBeGreaterThanOrEqual(0);
    expect(metrics.prAuc).toBeGreaterThanOrEqual(0);
    expect(metrics.calibrationError).toBeGreaterThanOrEqual(0);
    expect(metrics.coverage).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(metrics.sharpe)).toBe(true);
    expect(metrics.maxDrawdown).toBeLessThanOrEqual(0);
    expect(metrics.hitRate).toBeGreaterThanOrEqual(0);
    expect(metrics.turnover).toBeGreaterThanOrEqual(0);
    expect(metrics.binnedReliability.length).toBeGreaterThan(0);
    expect(metrics.bootstrapIntervals.nSamples).toBe(50);
    expect(metrics.actualShadowSensitivity.actualCount).toBe(50);
  });
});
