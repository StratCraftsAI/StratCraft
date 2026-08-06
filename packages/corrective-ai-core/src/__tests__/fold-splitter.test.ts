import { describe, it, expect } from 'vitest';

import { buildPurgedWalkForwardFolds, buildHoldoutSplit } from '../fold-splitter.js';
import { CorrectiveError } from '../contracts.js';
import type { TrainingRow } from '../trainer-types.js';

function makeRow(index: number, overrides?: Partial<TrainingRow>): TrainingRow {
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
    outcomeType: 'actual',
    entryTimestampNs: 1_000_000_000 + index * 1_000_000,
    exitTimestampNs: 1_000_000_000 + (index + 5) * 1_000_000,
    holdingIntervalBars: 5,
    netPnl: index % 2 === 0 ? 10 : -10,
    completionStatus: 'complete',
    profitLabel: index % 2 === 0,
    labelPolicyVersion: 1,
    ...overrides,
  };
}

describe('buildPurgedWalkForwardFolds', () => {
  it('creates the requested number of folds', () => {
    const rows = Array.from({ length: 100 }, (_, i) => makeRow(i));
    const folds = buildPurgedWalkForwardFolds(rows, 5, 0);
    expect(folds).toHaveLength(5);
  });

  it('train indices are strictly before validation indices', () => {
    const rows = Array.from({ length: 100 }, (_, i) => makeRow(i));
    const folds = buildPurgedWalkForwardFolds(rows, 5, 0);

    for (const fold of folds) {
      const maxTrain = Math.max(...fold.trainIndices);
      const minVal = Math.min(...fold.valIndices);
      expect(maxTrain).toBeLessThan(minVal);
    }
  });

  it('purges training rows whose exit overlaps validation start', () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      makeRow(i, {
        exitTimestampNs: 1_000_000_000 + (i + 20) * 1_000_000,
        holdingIntervalBars: 20,
      }),
    );

    const foldsNoPurge = buildPurgedWalkForwardFolds(rows, 3, 0);
    const totalTrainNoPurge = foldsNoPurge.reduce(
      (s, f) => s + f.trainIndices.length, 0,
    );

    let totalPurged = 0;
    for (const f of foldsNoPurge) {
      totalPurged += f.purgedCount;
    }

    expect(totalPurged).toBeGreaterThan(0);
  });

  it('embargo further excludes rows near the validation boundary', () => {
    const rows = Array.from({ length: 60 }, (_, i) => makeRow(i));
    const foldsNoEmbargo = buildPurgedWalkForwardFolds(rows, 3, 0);
    const foldsWithEmbargo = buildPurgedWalkForwardFolds(rows, 3, 10_000_000);

    const trainCountNoEmbargo = foldsNoEmbargo.reduce(
      (s, f) => s + f.trainIndices.length, 0,
    );
    const trainCountWithEmbargo = foldsWithEmbargo.reduce(
      (s, f) => s + f.trainIndices.length, 0,
    );

    expect(trainCountWithEmbargo).toBeLessThanOrEqual(trainCountNoEmbargo);
  });

  it('train and val indices do not overlap', () => {
    const rows = Array.from({ length: 100 }, (_, i) => makeRow(i));
    const folds = buildPurgedWalkForwardFolds(rows, 5, 0);

    for (const fold of folds) {
      const trainSet = new Set(fold.trainIndices);
      for (const v of fold.valIndices) {
        expect(trainSet.has(v)).toBe(false);
      }
    }
  });

  it('rejects nFolds below minimum', () => {
    const rows = Array.from({ length: 100 }, (_, i) => makeRow(i));
    expect(() => buildPurgedWalkForwardFolds(rows, 2, 0)).toThrow(CorrectiveError);
  });

  it('rejects nFolds above maximum', () => {
    const rows = Array.from({ length: 100 }, (_, i) => makeRow(i));
    expect(() => buildPurgedWalkForwardFolds(rows, 21, 0)).toThrow(CorrectiveError);
  });

  it('rejects too few rows', () => {
    const rows = [makeRow(0), makeRow(1)];
    expect(() => buildPurgedWalkForwardFolds(rows, 3, 0)).toThrow(CorrectiveError);
  });

  it('throws when all rows are purged (no viable folds)', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow(i, {
        exitTimestampNs: 1_000_000_000 + 999 * 1_000_000,
        holdingIntervalBars: 999,
      }),
    );
    expect(() => buildPurgedWalkForwardFolds(rows, 3, 0)).toThrow(
      'No viable folds after purge/embargo',
    );
  });

  it('later folds have more training data (walk-forward property)', () => {
    const rows = Array.from({ length: 200 }, (_, i) => makeRow(i));
    const folds = buildPurgedWalkForwardFolds(rows, 5, 0);

    for (let k = 1; k < folds.length; k++) {
      expect(folds[k].trainIndices.length).toBeGreaterThanOrEqual(
        folds[k - 1].trainIndices.length,
      );
    }
  });
});

describe('buildHoldoutSplit', () => {
  it('splits into train/val and holdout partitions', () => {
    const rows = Array.from({ length: 100 }, (_, i) => makeRow(i));
    const spec = buildHoldoutSplit(rows, 0.15);

    expect(spec.trainValIndices.length + spec.holdoutIndices.length).toBe(100);
    expect(spec.holdoutIndices.length).toBeGreaterThan(0);
    expect(spec.trainValIndices.length).toBeGreaterThan(0);
  });

  it('holdout is the chronological tail', () => {
    const rows = Array.from({ length: 100 }, (_, i) => makeRow(i));
    const spec = buildHoldoutSplit(rows, 0.2);

    const maxTrainVal = Math.max(...spec.trainValIndices);
    const minHoldout = Math.min(...spec.holdoutIndices);
    expect(maxTrainVal).toBeLessThan(minHoldout);
  });

  it('rejects fraction <= 0', () => {
    const rows = Array.from({ length: 100 }, (_, i) => makeRow(i));
    expect(() => buildHoldoutSplit(rows, 0)).toThrow(CorrectiveError);
  });

  it('rejects fraction >= 1', () => {
    const rows = Array.from({ length: 100 }, (_, i) => makeRow(i));
    expect(() => buildHoldoutSplit(rows, 1)).toThrow(CorrectiveError);
  });

  it('throws when single row produces empty partition', () => {
    const rows = [makeRow(0)];
    expect(() => buildHoldoutSplit(rows, 0.99)).toThrow(CorrectiveError);
  });

  it('approximate holdout fraction matches', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => makeRow(i));
    const spec = buildHoldoutSplit(rows, 0.2);
    const actualFraction = spec.holdoutIndices.length / 1000;
    expect(actualFraction).toBeCloseTo(0.2, 1);
  });
});
