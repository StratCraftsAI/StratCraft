import type { TrainingRow, FoldSpec, HoldoutSpec } from './trainer-types.js';

import {
  MIN_WALK_FORWARD_FOLDS,
  MAX_WALK_FORWARD_FOLDS,
  CORRECTIVE_ERROR_CODES,
} from './constants.js';

import { CorrectiveError } from './contracts.js';

export function buildPurgedWalkForwardFolds(
  rows: readonly TrainingRow[],
  nFolds: number,
  purgeEmbargoBars: number,
): readonly FoldSpec[] {
  if (nFolds < MIN_WALK_FORWARD_FOLDS || nFolds > MAX_WALK_FORWARD_FOLDS) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.TRAINING_DATASET_NOT_READY,
      `nFolds ${nFolds} outside [${MIN_WALK_FORWARD_FOLDS}, ${MAX_WALK_FORWARD_FOLDS}]`,
    );
  }

  if (rows.length < nFolds * 2) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.DATASET_INSUFFICIENT_SAMPLES,
      `${rows.length} rows insufficient for ${nFolds} folds`,
    );
  }

  const folds: FoldSpec[] = [];
  const n = rows.length;

  for (let k = 0; k < nFolds; k++) {
    const valStart = Math.floor((n * (k + 1)) / (nFolds + 1));
    const valEnd = Math.floor((n * (k + 2)) / (nFolds + 1));

    const valIndices: number[] = [];
    for (let i = valStart; i < valEnd; i++) {
      valIndices.push(i);
    }

    if (valIndices.length === 0) continue;

    const valStartTimestamp = rows[valIndices[0]].asOfTimestampNs;

    const trainIndices: number[] = [];
    let purgedCount = 0;
    let embargoedCount = 0;

    for (let i = 0; i < valStart; i++) {
      const row = rows[i];

      if (row.exitTimestampNs !== null && row.exitTimestampNs >= valStartTimestamp) {
        purgedCount++;
        continue;
      }

      if (purgeEmbargoBars > 0 && row.holdingIntervalBars > 0) {
        const exitTs = row.exitTimestampNs ?? row.entryTimestampNs;
        const embargoEnd = exitTs + purgeEmbargoBars;
        if (embargoEnd >= valStartTimestamp) {
          embargoedCount++;
          continue;
        }
      }

      trainIndices.push(i);
    }

    if (trainIndices.length === 0) continue;

    folds.push({
      foldIndex: k,
      trainIndices,
      valIndices,
      purgedCount,
      embargoedCount,
    });
  }

  if (folds.length === 0) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.DATASET_INSUFFICIENT_SAMPLES,
      'No viable folds after purge/embargo',
    );
  }

  return folds;
}

export function buildHoldoutSplit(
  rows: readonly TrainingRow[],
  holdoutFraction: number,
): HoldoutSpec {
  if (holdoutFraction <= 0 || holdoutFraction >= 1) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.TRAINING_DATASET_NOT_READY,
      `Holdout fraction ${holdoutFraction} must be in (0, 1)`,
    );
  }

  const n = rows.length;
  const holdoutStart = Math.floor(n * (1 - holdoutFraction));

  const trainValIndices: number[] = [];
  const holdoutIndices: number[] = [];

  for (let i = 0; i < holdoutStart; i++) {
    trainValIndices.push(i);
  }
  for (let i = holdoutStart; i < n; i++) {
    holdoutIndices.push(i);
  }

  if (holdoutIndices.length === 0 || trainValIndices.length === 0) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.DATASET_INSUFFICIENT_SAMPLES,
      `Holdout split produced empty partition: ${trainValIndices.length} train/val, ${holdoutIndices.length} holdout`,
    );
  }

  return { trainValIndices, holdoutIndices };
}
