import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  CORRECTIVE_SCHEMA_VERSION,
  CORRECTIVE_ERROR_CODES,
  ARTIFACT_FORMAT_ONNX,
  POP_FEATURE_SCHEMA_VERSION,
  POP_FEATURE_COUNT_V1,
} from './constants.js';

import {
  type PopArtifactManifestV1,
  type CalibrationParamsV1,
  type WindowBoundary,
  type MinimumSampleEvidence,
  type GoldenVectorV1,
  type TrainingJobV1,
  POP_FEATURE_SCHEMA_V1,
  CorrectiveError,
} from './contracts.js';

import type {
  TrainingRow,
  FoldResult,
  WorkerFoldInput,
  WorkerFoldOutput,
  TrainerConfig,
  ThresholdSelectionResult,
} from './trainer-types.js';

import { DEFAULT_HOLDOUT_FRACTION, DEFAULT_TRAINER_VERSION } from './trainer-types.js';

import type { CorrectiveStore } from './store.js';

import { buildPurgedWalkForwardFolds, buildHoldoutSplit } from './fold-splitter.js';
import { fitIsotonicCalibration, applyIsotonicCalibration } from './calibration.js';
import { computeFeatureSchemaHash } from './validation.js';
import { computeFullMetrics } from './metrics.js';

export interface TrainerDeps {
  readonly store: CorrectiveStore;
  readonly config: TrainerConfig;
  onProgress?: (message: string) => void;
}

export class CorrectiveTrainer {
  private readonly store: CorrectiveStore;
  private readonly config: TrainerConfig;
  private readonly onProgress: (message: string) => void;

  constructor(deps: TrainerDeps) {
    this.store = deps.store;
    this.config = deps.config;
    this.onProgress = deps.onProgress ?? (() => {});
  }

  async runFullPipeline(jobId: string): Promise<PopArtifactManifestV1> {
    this.store.updateTrainingJobState(jobId, 'running', {
      startedAt: new Date().toISOString(),
    });

    try {
      const manifest = await this.executeTraining(jobId);

      this.store.updateTrainingJobState(jobId, 'completed', {
        completedAt: new Date().toISOString(),
        artifactId: manifest.artifactId,
      });

      return manifest;
    } catch (err) {
      const errorCode = err instanceof CorrectiveError
        ? err.code
        : CORRECTIVE_ERROR_CODES.TRAINING_WORKER_CRASHED;
      const errorMessage = err instanceof Error ? err.message : String(err);

      this.store.updateTrainingJobState(jobId, 'failed', {
        completedAt: new Date().toISOString(),
        errorCode,
        errorMessage,
      });

      throw err;
    }
  }

  private async executeTraining(jobId: string): Promise<PopArtifactManifestV1> {
    const artifactDir = this.config.artifactOutputDir;
    if (!existsSync(artifactDir)) {
      mkdirSync(artifactDir, { recursive: true });
    }

    this.onProgress('Extracting training dataset');

    const allRows = this.store.getTrainingDataset(
      this.config.trainingWindowStartNs ?? undefined,
      this.config.trainingWindowEndNs ?? undefined,
    );

    const completeRows = allRows.filter(
      r => r.completionStatus === 'complete' && r.profitLabel !== null,
    );

    if (completeRows.length === 0) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.DATASET_INSUFFICIENT_SAMPLES,
        'No complete rows with labels in training dataset',
      );
    }

    this.onProgress('Splitting holdout');
    const holdoutSpec = buildHoldoutSplit(
      completeRows,
      this.config.holdoutFraction ?? DEFAULT_HOLDOUT_FRACTION,
    );

    const trainValRows = holdoutSpec.trainValIndices.map(i => completeRows[i]);
    const holdoutRows = holdoutSpec.holdoutIndices.map(i => completeRows[i]);

    this.onProgress(`Building ${this.config.nFolds} purged walk-forward folds`);
    const folds = buildPurgedWalkForwardFolds(
      trainValRows,
      this.config.nFolds,
      this.config.purgeEmbargoBars,
    );

    this.onProgress('Training folds');
    const foldResults: FoldResult[] = [];
    for (const fold of folds) {
      const result = await this.trainFold(trainValRows, fold.trainIndices, fold.valIndices, fold.foldIndex);
      foldResults.push(result);
    }

    this.onProgress('Collecting OOF predictions');
    const allOofPreds: number[] = [];
    const allOofLabels: boolean[] = [];
    const allOofIndices: number[] = [];
    const allOofRows: TrainingRow[] = [];

    for (const fr of foldResults) {
      allOofPreds.push(...fr.oofPredictions);
      allOofLabels.push(...fr.oofLabels);
      allOofIndices.push(...fr.oofIndices);
      for (const idx of fr.oofIndices) {
        allOofRows.push(trainValRows[idx]);
      }
    }

    this.onProgress('Fitting isotonic calibration on validation predictions');
    const calibrationResult = fitIsotonicCalibration(allOofPreds, allOofLabels);

    const calibratedOofPreds = allOofPreds.map(
      p => applyIsotonicCalibration(p, calibrationResult.breakpoints),
    );

    this.onProgress('Selecting threshold on validation set');
    const thresholdResult = this.selectThreshold(calibratedOofPreds, allOofLabels, allOofRows);

    this.onProgress('Training final model on all train/val data');
    const finalModelResult = await this.trainFold(
      trainValRows,
      Array.from({ length: trainValRows.length }, (_, i) => i),
      [],
      -1,
    );

    this.onProgress('Evaluating holdout');
    const holdoutPreds = await this.predictWithModel(
      finalModelResult.modelBytes,
      holdoutRows,
    );
    const calibratedHoldoutPreds = holdoutPreds.map(
      p => applyIsotonicCalibration(p, calibrationResult.breakpoints),
    );
    const holdoutLabels = holdoutRows.map(r => r.profitLabel!);

    const holdoutMetrics = computeFullMetrics(
      holdoutRows,
      calibratedHoldoutPreds,
      holdoutLabels,
      thresholdResult.threshold,
      100,
      this.config.bootstrapBlockSize ?? 10,
      42,
    );

    const validationMetrics = computeFullMetrics(
      allOofRows,
      calibratedOofPreds,
      allOofLabels,
      thresholdResult.threshold,
      this.config.bootstrapSamples ?? 1000,
      this.config.bootstrapBlockSize ?? 10,
      42,
    );

    this.onProgress('Assembling artifact');
    const featureNames = POP_FEATURE_SCHEMA_V1.map(f => f.name);
    const featureSchemaHash = computeFeatureSchemaHash(featureNames);

    const goldenVector = this.buildGoldenVector(
      calibratedOofPreds,
      allOofLabels,
      allOofRows,
      thresholdResult.threshold,
    );

    const modelFilename = `pop_model_${jobId}.onnx`;
    const modelPath = join(artifactDir, modelFilename);
    writeFileSync(modelPath, finalModelResult.modelBytes);

    const contentHash = createHash('sha256')
      .update(finalModelResult.modelBytes)
      .digest('hex');

    const trainingWindow = this.buildWindowBoundary(trainValRows);
    const validationWindow = this.buildWindowBoundary(holdoutRows);

    const minimumSampleEvidence = this.buildMinimumSampleEvidence(completeRows);

    const calibrationParams: CalibrationParamsV1 = {
      method: calibrationResult.method,
      fittedOn: 'validation_only',
      parameters: calibrationResult.parameters,
    };

    const artifactId = randomUUID();

    const manifest: PopArtifactManifestV1 = {
      schemaVersion: CORRECTIVE_SCHEMA_VERSION,
      artifactId,
      modelFormat: ARTIFACT_FORMAT_ONNX,
      modelFilename,
      calibrationParams,
      featureManifest: POP_FEATURE_SCHEMA_V1 as unknown as PopArtifactManifestV1['featureManifest'],
      featureSchemaHash,
      featureSchemaVersion: POP_FEATURE_SCHEMA_VERSION,
      schemaVersionStr: `${CORRECTIVE_SCHEMA_VERSION}.0.0`,
      trainerVersion: DEFAULT_TRAINER_VERSION,
      labelPolicyVersion: 1,
      sizingPolicyVersion: 1,
      trainingWindow,
      validationWindow,
      metrics: holdoutMetrics,
      minimumSampleEvidence,
      goldenVector,
      contentHash,
      createdAt: new Date().toISOString(),
    };

    this.store.insertArtifact(manifest);

    this.onProgress(`Artifact ${artifactId} published`);
    return manifest;
  }

  private async trainFold(
    rows: readonly TrainingRow[],
    trainIndices: readonly number[],
    valIndices: readonly number[],
    foldIndex: number,
  ): Promise<FoldResult> {
    const trainFeatures = trainIndices.map(i => rows[i].featureVector as number[]);
    const trainLabels = trainIndices.map(i => rows[i].profitLabel!);
    const valFeatures = valIndices.map(i => rows[i].featureVector as number[]);
    const valLabels = valIndices.map(i => rows[i].profitLabel!);

    const foldInput: WorkerFoldInput = {
      foldIndex,
      trainFeatures,
      trainLabels,
      valFeatures,
      valLabels,
    };

    const workerOutput = await this.spawnWorker(foldInput);

    let modelBytes: Uint8Array;
    if (workerOutput.modelPath && existsSync(workerOutput.modelPath)) {
      modelBytes = readFileSync(workerOutput.modelPath);
    } else {
      modelBytes = new Uint8Array(0);
    }

    return {
      foldIndex,
      oofPredictions: workerOutput.valPredictions as number[],
      oofLabels: valLabels,
      oofIndices: valIndices as number[],
      modelBytes,
    };
  }

  private async predictWithModel(
    modelBytes: Uint8Array,
    rows: readonly TrainingRow[],
  ): Promise<number[]> {
    const features = rows.map(r => r.featureVector as number[]);
    const labels = rows.map(r => r.profitLabel!);

    const foldInput: WorkerFoldInput = {
      foldIndex: -99,
      trainFeatures: [],
      trainLabels: [],
      valFeatures: features,
      valLabels: labels,
    };

    const tmpModelPath = join(
      this.config.artifactOutputDir,
      `tmp_predict_${Date.now()}.onnx`,
    );
    writeFileSync(tmpModelPath, modelBytes);

    const workerOutput = await this.spawnWorker(foldInput, tmpModelPath);
    return workerOutput.valPredictions as number[];
  }

  private spawnWorker(
    input: WorkerFoldInput,
    existingModelPath?: string,
  ): Promise<WorkerFoldOutput> {
    return new Promise((resolve, reject) => {
      const inputJson = JSON.stringify({
        ...input,
        existingModelPath: existingModelPath ?? null,
      });

      const child = spawn(
        this.config.pythonExecutable,
        [this.config.workerScriptPath],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        },
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new CorrectiveError(
            CORRECTIVE_ERROR_CODES.TRAINING_WORKER_CRASHED,
            `Worker exited with code ${code}: ${stderr}`,
          ));
          return;
        }

        try {
          const result = JSON.parse(stdout) as WorkerFoldOutput;
          resolve(result);
        } catch {
          reject(new CorrectiveError(
            CORRECTIVE_ERROR_CODES.TRAINING_WORKER_CRASHED,
            `Failed to parse worker output: ${stdout.slice(0, 500)}`,
          ));
        }
      });

      child.on('error', (err) => {
        reject(new CorrectiveError(
          CORRECTIVE_ERROR_CODES.TRAINING_WORKER_CRASHED,
          `Worker spawn failed: ${err.message}`,
        ));
      });

      child.stdin.write(inputJson);
      child.stdin.end();
    });
  }

  private selectThreshold(
    predictions: readonly number[],
    labels: readonly boolean[],
    rows: readonly TrainingRow[],
  ): ThresholdSelectionResult {
    let bestThreshold = 0.5;
    let bestNetReturn = -Infinity;

    const thresholds = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);

    for (const t of thresholds) {
      let netReturn = 0;
      for (let i = 0; i < predictions.length; i++) {
        if (predictions[i] >= t) {
          netReturn += rows[i].netPnl;
        }
      }
      if (netReturn > bestNetReturn) {
        bestNetReturn = netReturn;
        bestThreshold = t;
      }
    }

    return {
      threshold: bestThreshold,
      criterion: 'max_net_return',
      metricAtThreshold: bestNetReturn,
      candidatesEvaluated: predictions.length,
    };
  }

  private buildGoldenVector(
    predictions: readonly number[],
    labels: readonly boolean[],
    rows: readonly TrainingRow[],
    threshold: number,
  ): GoldenVectorV1 {
    const midIdx = Math.floor(rows.length / 2);
    const goldenRow = rows[midIdx];
    const goldenPred = predictions[midIdx];

    return {
      inputFeatures: goldenRow.featureVector as number[],
      expectedProbability: goldenPred,
      expectedVerdict: goldenPred >= threshold ? 'pass' : 'reject',
      tolerance: 1e-6,
    };
  }

  private buildWindowBoundary(rows: readonly TrainingRow[]): WindowBoundary {
    if (rows.length === 0) {
      return {
        startTimestampNs: '0',
        endTimestampNs: '0',
        barCount: 0,
        candidateCount: 0,
      };
    }
    return {
      startTimestampNs: String(rows[0].asOfTimestampNs),
      endTimestampNs: String(rows[rows.length - 1].asOfTimestampNs),
      barCount: rows.length,
      candidateCount: rows.length,
    };
  }

  private buildMinimumSampleEvidence(rows: readonly TrainingRow[]): MinimumSampleEvidence {
    const positiveSupport = rows.filter(r => r.profitLabel === true).length;
    const negativeSupport = rows.filter(r => r.profitLabel === false).length;
    const calibrationBinMinSupport = Math.min(positiveSupport, negativeSupport);

    let bindingReason = 'sufficient';
    if (rows.length < 200) bindingReason = 'insufficient total candidates';
    else if (positiveSupport < 30) bindingReason = 'insufficient positive support';
    else if (negativeSupport < 30) bindingReason = 'insufficient negative support';

    return {
      totalCandidates: rows.length,
      positiveSupport,
      negativeSupport,
      calibrationBinMinSupport,
      foldViability: this.config.nFolds,
      bindingReason,
    };
  }
}
