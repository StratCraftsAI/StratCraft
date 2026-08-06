import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CorrectiveStore, type SqliteDatabase, type CandidateIncrementRow, type OutcomeIncrementRow } from '../store.js';
import { CorrectiveTrainer, type TrainerDeps } from '../trainer.js';
import type { TrainerConfig } from '../trainer-types.js';
import { CorrectiveError } from '../contracts.js';
import { CORRECTIVE_ERROR_CODES } from '../constants.js';

const MIGRATION_SQL = `
  CREATE TABLE corrective_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'disabled',
    provider TEXT NOT NULL DEFAULT 'builtin_gbdt',
    mode TEXT NOT NULL DEFAULT 'gate',
    threshold REAL NOT NULL DEFAULT 0.5,
    sizing_exponent REAL NOT NULL DEFAULT 1.0,
    sizing_policy_id TEXT NOT NULL DEFAULT 'gate',
    model_artifact_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  INSERT INTO corrective_config (id) VALUES (1);

  CREATE TABLE corrective_candidates (
    run_id TEXT NOT NULL, candidate_id INTEGER NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1, strategy_artifact_id TEXT NOT NULL,
    model_artifact_id TEXT, as_of_timestamp_ns INTEGER NOT NULL,
    knowledge_cutoff_timestamp_ns INTEGER NOT NULL, symbol_id TEXT NOT NULL,
    side TEXT NOT NULL, proposed_size REAL NOT NULL, final_size REAL NOT NULL,
    size_unit TEXT NOT NULL DEFAULT 'shares',
    feature_vector TEXT NOT NULL CHECK (json_valid(feature_vector)),
    feature_schema_hash TEXT NOT NULL, feature_schema_version INTEGER NOT NULL DEFAULT 1,
    gate_verdict TEXT NOT NULL, calibrated_probability REAL, sizing_policy_id TEXT,
    reason_code TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (run_id, candidate_id)
  );

  CREATE TABLE corrective_outcomes (
    run_id TEXT NOT NULL, candidate_id INTEGER NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    outcome_type TEXT NOT NULL,
    entry_timestamp_ns INTEGER NOT NULL, exit_timestamp_ns INTEGER,
    holding_interval_bars INTEGER NOT NULL DEFAULT 0,
    gross_pnl REAL NOT NULL DEFAULT 0, commission REAL NOT NULL DEFAULT 0,
    slippage REAL NOT NULL DEFAULT 0, net_pnl REAL NOT NULL DEFAULT 0,
    completion_status TEXT NOT NULL DEFAULT 'complete',
    label_policy_version INTEGER NOT NULL DEFAULT 1, profit_label INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (run_id, candidate_id),
    FOREIGN KEY (run_id, candidate_id) REFERENCES corrective_candidates (run_id, candidate_id)
  );

  CREATE TABLE corrective_training_jobs (
    job_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'queued',
    provider TEXT NOT NULL DEFAULT 'builtin_gbdt',
    config TEXT NOT NULL CHECK (json_valid(config)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at TEXT, completed_at TEXT, artifact_id TEXT, error_code TEXT, error_message TEXT
  );

  CREATE TABLE corrective_artifacts (
    artifact_id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL DEFAULT 1,
    model_format TEXT NOT NULL DEFAULT 'onnx',
    model_filename TEXT NOT NULL,
    calibration_params TEXT NOT NULL CHECK (json_valid(calibration_params)),
    feature_manifest TEXT NOT NULL CHECK (json_valid(feature_manifest)),
    feature_schema_hash TEXT NOT NULL, feature_schema_version INTEGER NOT NULL DEFAULT 1,
    schema_version_str TEXT NOT NULL, trainer_version TEXT NOT NULL,
    label_policy_version INTEGER NOT NULL DEFAULT 1, sizing_policy_version INTEGER NOT NULL DEFAULT 1,
    training_window TEXT NOT NULL CHECK (json_valid(training_window)),
    validation_window TEXT NOT NULL CHECK (json_valid(validation_window)),
    metrics TEXT NOT NULL CHECK (json_valid(metrics)),
    minimum_sample_evidence TEXT NOT NULL CHECK (json_valid(minimum_sample_evidence)),
    golden_vector TEXT NOT NULL CHECK (json_valid(golden_vector)),
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE corrective_comparisons (
    comparison_id TEXT PRIMARY KEY, baseline_run_id TEXT NOT NULL,
    corrective_run_id TEXT NOT NULL, strategy_artifact_id TEXT NOT NULL,
    model_artifact_id TEXT NOT NULL,
    mode TEXT NOT NULL, threshold REAL NOT NULL,
    baseline_metrics TEXT NOT NULL CHECK (json_valid(baseline_metrics)),
    corrective_metrics TEXT NOT NULL CHECK (json_valid(corrective_metrics)),
    holdout_metrics TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`;

const FEATURE_VECTOR = [0.5, 1.1, 0.0, 0.3, -0.2, 55, 0.6, 0.001, 1.2, 0.0, 0, 5, -2.3, 1.0];

function makeCandidate(id: number, runId = 'run-1'): CandidateIncrementRow {
  return {
    runId, candidateId: id, strategyArtifactId: 'strat-1',
    modelArtifactId: null, asOfTimestampNs: 1_000_000_000 + id * 1_000_000,
    knowledgeCutoffTimestampNs: 1_000_000_000 + id * 1_000_000 - 500,
    symbolId: 'EURUSD', side: id % 3 === 0 ? 'short' : 'long',
    proposedSize: 100, finalSize: 100, sizeUnit: 'shares',
    featureVector: FEATURE_VECTOR.map((v, fi) => v + id * 0.01 * (fi + 1)),
    featureSchemaHash: 'b58a76c9', featureSchemaVersion: 1,
    gateVerdict: 'collect_only', calibratedProbability: null,
    sizingPolicyId: null, reasonCode: '',
  };
}

function makeOutcome(id: number, profit: boolean, runId = 'run-1'): OutcomeIncrementRow {
  return {
    runId, candidateId: id, outcomeType: 'actual',
    entryTimestampNs: 1_000_000_000 + id * 1_000_000,
    exitTimestampNs: 1_000_000_000 + (id + 5) * 1_000_000,
    holdingIntervalBars: 5,
    grossPnl: profit ? 50 : -50, commission: 2, slippage: 1,
    netPnl: profit ? 47 : -53,
    completionStatus: 'complete', labelPolicyVersion: 1, profitLabel: profit,
  };
}

let testDir: string;
let mockWorkerPath: string;

function setupMockWorker(): void {
  testDir = join(tmpdir(), `pop-trainer-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });

  mockWorkerPath = join(testDir, 'mock_worker.js');
  writeFileSync(mockWorkerPath, `
    const fs = require('fs');
    let input = '';
    process.stdin.on('data', d => input += d);
    process.stdin.on('end', () => {
      const data = JSON.parse(input);
      const valPreds = data.valFeatures.map((f, i) => {
        const label = data.valLabels[i];
        return label ? 0.7 + Math.random() * 0.1 : 0.3 + Math.random() * 0.1;
      });

      const modelPath = require('path').join(require('os').tmpdir(), 'mock_model_' + data.foldIndex + '.onnx');
      fs.writeFileSync(modelPath, Buffer.from([0x4f, 0x4e, 0x4e, 0x58]));

      console.log(JSON.stringify({
        foldIndex: data.foldIndex,
        valPredictions: valPreds,
        modelPath: modelPath,
        trainMetrics: { rocAuc: 0.85, logLoss: 0.4 },
      }));
    });
  `);
}

function seedDataset(store: CorrectiveStore, n: number): void {
  for (let i = 1; i <= n; i++) {
    store.insertCandidate(makeCandidate(i));
    store.insertOutcome(makeOutcome(i, i % 2 === 0));
  }
}

describe('CorrectiveTrainer', () => {
  let store: CorrectiveStore;

  beforeEach(() => {
    const db = new Database(':memory:');
    db.exec(MIGRATION_SQL);
    store = new CorrectiveStore(db);
    setupMockWorker();
  });

  afterEach(() => {
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function makeTrainerConfig(overrides?: Partial<TrainerConfig>): TrainerConfig {
    return {
      nFolds: 3,
      purgeEmbargoBars: 0,
      bootstrapSamples: 50,
      bootstrapBlockSize: 5,
      trainingWindowStartNs: null,
      trainingWindowEndNs: null,
      holdoutFraction: 0.15,
      pythonExecutable: process.execPath,
      workerScriptPath: mockWorkerPath,
      artifactOutputDir: join(testDir, 'artifacts'),
      ...overrides,
    };
  }

  it('runs full pipeline and produces an artifact manifest', async () => {
    seedDataset(store, 300);

    const config = makeTrainerConfig();
    const progressMessages: string[] = [];

    store.insertTrainingJob({
      jobId: 'test-job-1', state: 'queued', provider: 'builtin_gbdt',
      config: { nFolds: 3, purgeEmbargoBars: 0, bootstrapSamples: 50, bootstrapBlockSize: 5, trainingWindow: null },
      createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
      artifactId: null, errorCode: null, errorMessage: null,
    });

    const trainer = new CorrectiveTrainer({
      store,
      config,
      onProgress: (msg) => progressMessages.push(msg),
    });

    const manifest = await trainer.runFullPipeline('test-job-1');

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.modelFormat).toBe('onnx');
    expect(manifest.artifactId).toBeTruthy();
    expect(manifest.contentHash).toBeTruthy();
    expect(manifest.featureSchemaHash).toBe('b58a76c9');
    expect(manifest.featureSchemaVersion).toBe(1);
    expect(manifest.calibrationParams.method).toBe('isotonic');
    expect(manifest.calibrationParams.fittedOn).toBe('validation_only');
    expect(manifest.metrics.brierScore).toBeGreaterThanOrEqual(0);
    expect(manifest.metrics.rocAuc).toBeGreaterThanOrEqual(0);
    expect(manifest.goldenVector.inputFeatures).toHaveLength(14);
    expect(manifest.goldenVector.tolerance).toBe(1e-6);
    expect(manifest.minimumSampleEvidence.totalCandidates).toBeGreaterThan(0);

    expect(progressMessages.length).toBeGreaterThan(0);
    expect(progressMessages).toContain('Extracting training dataset');
    expect(progressMessages.some(m => m.includes('Artifact'))).toBe(true);

    const job = store.getTrainingJob('test-job-1');
    expect(job?.state).toBe('completed');
    expect(job?.artifactId).toBe(manifest.artifactId);

    const stored = store.getArtifact(manifest.artifactId);
    expect(stored).not.toBeNull();
    expect(stored!.artifactId).toBe(manifest.artifactId);
  }, 30_000);

  it('marks job as failed on worker crash', async () => {
    seedDataset(store, 300);

    const crashingWorker = join(testDir, 'crash_worker.js');
    writeFileSync(crashingWorker, `process.exit(1);`);

    store.insertTrainingJob({
      jobId: 'crash-job', state: 'queued', provider: 'builtin_gbdt',
      config: { nFolds: 3, purgeEmbargoBars: 0, bootstrapSamples: 50, bootstrapBlockSize: 5, trainingWindow: null },
      createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
      artifactId: null, errorCode: null, errorMessage: null,
    });

    const trainer = new CorrectiveTrainer({
      store,
      config: makeTrainerConfig({ workerScriptPath: crashingWorker }),
    });

    await expect(trainer.runFullPipeline('crash-job')).rejects.toThrow(CorrectiveError);

    const job = store.getTrainingJob('crash-job');
    expect(job?.state).toBe('failed');
    expect(job?.errorCode).toBeTruthy();
  }, 15_000);

  it('rejects empty dataset', async () => {
    store.insertTrainingJob({
      jobId: 'empty-job', state: 'queued', provider: 'builtin_gbdt',
      config: { nFolds: 3, purgeEmbargoBars: 0, bootstrapSamples: 50, bootstrapBlockSize: 5, trainingWindow: null },
      createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
      artifactId: null, errorCode: null, errorMessage: null,
    });

    const trainer = new CorrectiveTrainer({
      store,
      config: makeTrainerConfig(),
    });

    await expect(trainer.runFullPipeline('empty-job')).rejects.toThrow(CorrectiveError);

    const job = store.getTrainingJob('empty-job');
    expect(job?.state).toBe('failed');
  });

  it('uses window pushdown when training window is set', async () => {
    seedDataset(store, 300);

    const startNs = 1_000_000_000 + 100 * 1_000_000;
    const endNs = 1_000_000_000 + 250 * 1_000_000;

    store.insertTrainingJob({
      jobId: 'window-job', state: 'queued', provider: 'builtin_gbdt',
      config: { nFolds: 3, purgeEmbargoBars: 0, bootstrapSamples: 50, bootstrapBlockSize: 5, trainingWindow: null },
      createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
      artifactId: null, errorCode: null, errorMessage: null,
    });

    const trainer = new CorrectiveTrainer({
      store,
      config: makeTrainerConfig({
        trainingWindowStartNs: startNs,
        trainingWindowEndNs: endNs,
      }),
    });

    const manifest = await trainer.runFullPipeline('window-job');

    const windowStart = BigInt(manifest.trainingWindow.startTimestampNs);
    const windowEnd = BigInt(manifest.trainingWindow.endTimestampNs);
    expect(windowStart).toBeGreaterThanOrEqual(BigInt(startNs));
    expect(windowEnd).toBeLessThanOrEqual(BigInt(endNs + 100 * 1_000_000));
  }, 30_000);

  it('model file is written to artifact output directory', async () => {
    seedDataset(store, 300);

    store.insertTrainingJob({
      jobId: 'file-job', state: 'queued', provider: 'builtin_gbdt',
      config: { nFolds: 3, purgeEmbargoBars: 0, bootstrapSamples: 50, bootstrapBlockSize: 5, trainingWindow: null },
      createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
      artifactId: null, errorCode: null, errorMessage: null,
    });

    const artifactDir = join(testDir, 'artifacts');
    const trainer = new CorrectiveTrainer({
      store,
      config: makeTrainerConfig({ artifactOutputDir: artifactDir }),
    });

    const manifest = await trainer.runFullPipeline('file-job');

    const modelPath = join(artifactDir, manifest.modelFilename);
    expect(existsSync(modelPath)).toBe(true);
  }, 30_000);

  it('holdout metrics are based on untouched holdout data', async () => {
    seedDataset(store, 300);

    store.insertTrainingJob({
      jobId: 'holdout-job', state: 'queued', provider: 'builtin_gbdt',
      config: { nFolds: 3, purgeEmbargoBars: 0, bootstrapSamples: 50, bootstrapBlockSize: 5, trainingWindow: null },
      createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
      artifactId: null, errorCode: null, errorMessage: null,
    });

    const trainer = new CorrectiveTrainer({
      store,
      config: makeTrainerConfig({ holdoutFraction: 0.2 }),
    });

    const manifest = await trainer.runFullPipeline('holdout-job');

    expect(manifest.metrics.brierScore).toBeGreaterThanOrEqual(0);
    expect(manifest.metrics.brierScore).toBeLessThanOrEqual(1);
    expect(Number.isFinite(manifest.metrics.rocAuc)).toBe(true);
  }, 30_000);

  it('handles worker that returns invalid JSON', async () => {
    seedDataset(store, 300);

    const badWorker = join(testDir, 'bad_json_worker.js');
    writeFileSync(badWorker, `
      let input = '';
      process.stdin.on('data', d => input += d);
      process.stdin.on('end', () => {
        console.log('NOT VALID JSON');
      });
    `);

    store.insertTrainingJob({
      jobId: 'bad-json-job', state: 'queued', provider: 'builtin_gbdt',
      config: { nFolds: 3, purgeEmbargoBars: 0, bootstrapSamples: 50, bootstrapBlockSize: 5, trainingWindow: null },
      createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
      artifactId: null, errorCode: null, errorMessage: null,
    });

    const trainer = new CorrectiveTrainer({
      store,
      config: makeTrainerConfig({ workerScriptPath: badWorker }),
    });

    await expect(trainer.runFullPipeline('bad-json-job')).rejects.toThrow(CorrectiveError);

    const job = store.getTrainingJob('bad-json-job');
    expect(job?.state).toBe('failed');
  }, 15_000);

  it('handles nonexistent executable (spawn error path)', async () => {
    seedDataset(store, 300);

    store.insertTrainingJob({
      jobId: 'noexist-job', state: 'queued', provider: 'builtin_gbdt',
      config: { nFolds: 3, purgeEmbargoBars: 0, bootstrapSamples: 50, bootstrapBlockSize: 5, trainingWindow: null },
      createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
      artifactId: null, errorCode: null, errorMessage: null,
    });

    const trainer = new CorrectiveTrainer({
      store,
      config: makeTrainerConfig({
        pythonExecutable: '/nonexistent/python3',
        workerScriptPath: mockWorkerPath,
      }),
    });

    await expect(trainer.runFullPipeline('noexist-job')).rejects.toThrow(CorrectiveError);

    const job = store.getTrainingJob('noexist-job');
    expect(job?.state).toBe('failed');
  }, 15_000);

  it('handles non-CorrectiveError exceptions in pipeline', async () => {
    seedDataset(store, 300);

    const throwWorker = join(testDir, 'throw_worker.js');
    writeFileSync(throwWorker, `throw new Error('unexpected');`);

    store.insertTrainingJob({
      jobId: 'throw-job', state: 'queued', provider: 'builtin_gbdt',
      config: { nFolds: 3, purgeEmbargoBars: 0, bootstrapSamples: 50, bootstrapBlockSize: 5, trainingWindow: null },
      createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
      artifactId: null, errorCode: null, errorMessage: null,
    });

    const trainer = new CorrectiveTrainer({
      store,
      config: makeTrainerConfig({ workerScriptPath: throwWorker }),
    });

    await expect(trainer.runFullPipeline('throw-job')).rejects.toThrow();

    const job = store.getTrainingJob('throw-job');
    expect(job?.state).toBe('failed');
    expect(job?.errorCode).toBe(CORRECTIVE_ERROR_CODES.TRAINING_WORKER_CRASHED);
  }, 15_000);

  it('AC9: golden vector is present and has correct feature count', async () => {
    seedDataset(store, 300);

    store.insertTrainingJob({
      jobId: 'golden-job', state: 'queued', provider: 'builtin_gbdt',
      config: { nFolds: 3, purgeEmbargoBars: 0, bootstrapSamples: 50, bootstrapBlockSize: 5, trainingWindow: null },
      createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
      artifactId: null, errorCode: null, errorMessage: null,
    });

    const trainer = new CorrectiveTrainer({
      store,
      config: makeTrainerConfig(),
    });

    const manifest = await trainer.runFullPipeline('golden-job');

    expect(manifest.goldenVector.inputFeatures).toHaveLength(14);
    expect(manifest.goldenVector.expectedProbability).toBeGreaterThanOrEqual(0);
    expect(manifest.goldenVector.expectedProbability).toBeLessThanOrEqual(1);
    expect(['pass', 'reject']).toContain(manifest.goldenVector.expectedVerdict);
    expect(manifest.goldenVector.tolerance).toBe(1e-6);
  }, 30_000);
});
