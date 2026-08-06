import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

import {
  CorrectiveStore,
  type CandidateIncrementRow,
  type OutcomeIncrementRow,
  type SqliteDatabase,
} from '../store.js';

import type {
  PopArtifactManifestV1,
  TrainingJobV1,
  ComparisonReportV1,
} from '../contracts.js';

const MIGRATION_SQL = `
  CREATE TABLE corrective_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'disabled' CHECK (
      state IN ('disabled', 'collect_only', 'enabled')
    ),
    provider TEXT NOT NULL DEFAULT 'builtin_gbdt' CHECK (provider = 'builtin_gbdt'),
    mode TEXT NOT NULL DEFAULT 'gate' CHECK (
      mode IN ('gate', 'sizing', 'hybrid')
    ),
    threshold REAL NOT NULL DEFAULT 0.5 CHECK (
      threshold >= 0.0 AND threshold <= 1.0
    ),
    sizing_exponent REAL NOT NULL DEFAULT 1.0 CHECK (
      sizing_exponent >= 0.1 AND sizing_exponent <= 5.0
    ),
    sizing_policy_id TEXT NOT NULL DEFAULT 'gate' CHECK (
      sizing_policy_id IN ('gate', 'sizing', 'hybrid')
    ),
    model_artifact_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  INSERT INTO corrective_config (id) VALUES (1);

  CREATE TABLE corrective_candidates (
    run_id TEXT NOT NULL,
    candidate_id INTEGER NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    strategy_artifact_id TEXT NOT NULL,
    model_artifact_id TEXT,
    as_of_timestamp_ns INTEGER NOT NULL,
    knowledge_cutoff_timestamp_ns INTEGER NOT NULL,
    symbol_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('long', 'short')),
    proposed_size REAL NOT NULL CHECK (proposed_size >= 0),
    final_size REAL NOT NULL CHECK (final_size >= 0),
    size_unit TEXT NOT NULL DEFAULT 'shares',
    feature_vector TEXT NOT NULL CHECK (json_valid(feature_vector)),
    feature_schema_hash TEXT NOT NULL,
    feature_schema_version INTEGER NOT NULL DEFAULT 1,
    gate_verdict TEXT NOT NULL CHECK (
      gate_verdict IN ('pass', 'reject', 'collect_only', 'disabled')
    ),
    calibrated_probability REAL,
    sizing_policy_id TEXT,
    reason_code TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (run_id, candidate_id)
  );

  CREATE TABLE corrective_outcomes (
    run_id TEXT NOT NULL,
    candidate_id INTEGER NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    outcome_type TEXT NOT NULL CHECK (
      outcome_type IN ('actual', 'shadow', 'censored')
    ),
    entry_timestamp_ns INTEGER NOT NULL,
    exit_timestamp_ns INTEGER,
    holding_interval_bars INTEGER NOT NULL DEFAULT 0,
    gross_pnl REAL NOT NULL DEFAULT 0,
    commission REAL NOT NULL DEFAULT 0,
    slippage REAL NOT NULL DEFAULT 0,
    net_pnl REAL NOT NULL DEFAULT 0,
    completion_status TEXT NOT NULL DEFAULT 'complete' CHECK (
      completion_status IN ('complete', 'censored')
    ),
    label_policy_version INTEGER NOT NULL DEFAULT 1,
    profit_label INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (run_id, candidate_id),
    FOREIGN KEY (run_id, candidate_id) REFERENCES corrective_candidates (run_id, candidate_id)
  );

  CREATE TABLE corrective_training_jobs (
    job_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'queued' CHECK (
      state IN ('queued', 'running', 'completed', 'failed', 'cancelled')
    ),
    provider TEXT NOT NULL DEFAULT 'builtin_gbdt',
    config TEXT NOT NULL CHECK (json_valid(config)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at TEXT,
    completed_at TEXT,
    artifact_id TEXT,
    error_code TEXT,
    error_message TEXT
  );

  CREATE TABLE corrective_artifacts (
    artifact_id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL DEFAULT 1,
    model_format TEXT NOT NULL DEFAULT 'onnx' CHECK (model_format = 'onnx'),
    model_filename TEXT NOT NULL,
    calibration_params TEXT NOT NULL CHECK (json_valid(calibration_params)),
    feature_manifest TEXT NOT NULL CHECK (json_valid(feature_manifest)),
    feature_schema_hash TEXT NOT NULL,
    feature_schema_version INTEGER NOT NULL DEFAULT 1,
    schema_version_str TEXT NOT NULL,
    trainer_version TEXT NOT NULL,
    label_policy_version INTEGER NOT NULL DEFAULT 1,
    sizing_policy_version INTEGER NOT NULL DEFAULT 1,
    training_window TEXT NOT NULL CHECK (json_valid(training_window)),
    validation_window TEXT NOT NULL CHECK (json_valid(validation_window)),
    metrics TEXT NOT NULL CHECK (json_valid(metrics)),
    minimum_sample_evidence TEXT NOT NULL CHECK (json_valid(minimum_sample_evidence)),
    golden_vector TEXT NOT NULL CHECK (json_valid(golden_vector)),
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE corrective_comparisons (
    comparison_id TEXT PRIMARY KEY,
    baseline_run_id TEXT NOT NULL,
    corrective_run_id TEXT NOT NULL,
    strategy_artifact_id TEXT NOT NULL,
    model_artifact_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('gate', 'sizing', 'hybrid')),
    threshold REAL NOT NULL,
    baseline_metrics TEXT NOT NULL CHECK (json_valid(baseline_metrics)),
    corrective_metrics TEXT NOT NULL CHECK (json_valid(corrective_metrics)),
    holdout_metrics TEXT CHECK (holdout_metrics IS NULL OR json_valid(holdout_metrics)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`;

function createTestDb(): SqliteDatabase {
  const db = new Database(':memory:');
  db.exec(MIGRATION_SQL);
  return db;
}

function makeCandidate(overrides?: Partial<CandidateIncrementRow>): CandidateIncrementRow {
  return {
    runId: 'run-1',
    candidateId: 1,
    strategyArtifactId: 'strat-1',
    modelArtifactId: null,
    asOfTimestampNs: 1000000000,
    knowledgeCutoffTimestampNs: 999999000,
    symbolId: 'EURUSD',
    side: 'long',
    proposedSize: 100,
    finalSize: 100,
    sizeUnit: 'shares',
    featureVector: [0.5, 1.1, 0.0, 0.3, -0.2, 55, 0.6, 0.001, 1.2, 0.0, 0, 5, -2.3, 1.0],
    featureSchemaHash: 'b58a76c9',
    featureSchemaVersion: 1,
    gateVerdict: 'collect_only',
    calibratedProbability: null,
    sizingPolicyId: null,
    reasonCode: '',
    ...overrides,
  };
}

function makeOutcome(overrides?: Partial<OutcomeIncrementRow>): OutcomeIncrementRow {
  return {
    runId: 'run-1',
    candidateId: 1,
    outcomeType: 'actual',
    entryTimestampNs: 1000000000,
    exitTimestampNs: 2000000000,
    holdingIntervalBars: 10,
    grossPnl: 50.0,
    commission: 2.0,
    slippage: 1.0,
    netPnl: 47.0,
    completionStatus: 'complete',
    labelPolicyVersion: 1,
    profitLabel: true,
    ...overrides,
  };
}

function makeArtifactManifest(id: string): PopArtifactManifestV1 {
  return {
    schemaVersion: 1,
    artifactId: id,
    modelFormat: 'onnx',
    modelFilename: `${id}.onnx`,
    calibrationParams: { method: 'isotonic', fittedOn: 'validation_only', parameters: { a: 1 } },
    featureManifest: [],
    featureSchemaHash: 'b58a76c9',
    featureSchemaVersion: 1,
    schemaVersionStr: '1.0.0',
    trainerVersion: '0.1.0',
    labelPolicyVersion: 1,
    sizingPolicyVersion: 1,
    trainingWindow: { startTimestampNs: '0', endTimestampNs: '1000', barCount: 100, candidateCount: 50 },
    validationWindow: { startTimestampNs: '1000', endTimestampNs: '2000', barCount: 50, candidateCount: 25 },
    metrics: {
      brierScore: 0.2, logLoss: 0.5, rocAuc: 0.75, prAuc: 0.7,
      calibrationError: 0.05, coverage: 0.9, netReturnAfterCosts: 0.1,
      sharpe: 1.5, maxDrawdown: -0.1, hitRate: 0.55, turnover: 0.3,
      actualShadowSensitivity: {
        actualCount: 40, shadowCount: 10, censoredCount: 0,
        metricsActualOnly: { brierScore: 0.2, rocAuc: 0.75, hitRate: 0.55 },
        metricsShadowOnly: { brierScore: 0.25, rocAuc: 0.7, hitRate: 0.5 },
      },
      binnedReliability: [{ binLower: 0, binUpper: 0.5, meanPredicted: 0.3, meanObserved: 0.35, count: 20 }],
      bootstrapIntervals: {
        nSamples: 1000, blockSize: 10,
        brierScoreCi95: [0.15, 0.25], rocAucCi95: [0.7, 0.8],
        sharpeCi95: [1.0, 2.0], hitRateCi95: [0.5, 0.6],
      },
    },
    minimumSampleEvidence: {
      totalCandidates: 200, positiveSupport: 90, negativeSupport: 110,
      calibrationBinMinSupport: 15, foldViability: 5, bindingReason: 'sufficient',
    },
    goldenVector: {
      inputFeatures: [0.5, 1.1, 0.0, 0.3, -0.2, 55, 0.6, 0.001, 1.2, 0.0, 0, 5, -2.3, 1.0],
      expectedProbability: 0.65,
      expectedVerdict: 'pass',
      tolerance: 1e-6,
    },
    contentHash: 'abc123',
    createdAt: '2026-08-04T10:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CorrectiveStore', () => {
  let store: CorrectiveStore;

  beforeEach(() => {
    store = new CorrectiveStore(createTestDb());
  });

  // -- Config ---------------------------------------------------------------

  describe('config', () => {
    it('reads default config after migration', () => {
      const config = store.readConfig();
      expect(config.state).toBe('disabled');
      expect(config.provider).toBe('builtin_gbdt');
      expect(config.threshold).toBe(0.5);
      expect(config.sizingExponent).toBe(1.0);
      expect(config.modelArtifactId).toBeNull();
    });

    it('writes and reads back config', () => {
      store.writeConfig({
        schemaVersion: 1,
        state: 'collect_only',
        provider: 'builtin_gbdt',
        mode: 'hybrid',
        threshold: 0.6,
        sizingExponent: 2.0,
        sizingPolicyId: 'hybrid',
        modelArtifactId: null,
      });

      const config = store.readConfig();
      expect(config.state).toBe('collect_only');
      expect(config.mode).toBe('hybrid');
      expect(config.threshold).toBe(0.6);
      expect(config.sizingExponent).toBe(2.0);
      expect(config.sizingPolicyId).toBe('hybrid');
    });

    it('rejects invalid state via CHECK constraint', () => {
      expect(() => store.writeConfig({
        schemaVersion: 1,
        state: 'bogus' as 'disabled',
        provider: 'builtin_gbdt',
        mode: 'gate',
        threshold: 0.5,
        sizingExponent: 1.0,
        sizingPolicyId: 'gate',
        modelArtifactId: null,
      })).toThrow();
    });

    it('rejects threshold out of range via CHECK constraint', () => {
      expect(() => store.writeConfig({
        schemaVersion: 1,
        state: 'disabled',
        provider: 'builtin_gbdt',
        mode: 'gate',
        threshold: 1.5,
        sizingExponent: 1.0,
        sizingPolicyId: 'gate',
        modelArtifactId: null,
      })).toThrow();
    });
  });

  // -- Candidates -----------------------------------------------------------

  describe('candidates', () => {
    it('inserts and retrieves a candidate', () => {
      store.insertCandidate(makeCandidate());
      const candidates = store.getCandidatesByRun('run-1');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].runId).toBe('run-1');
      expect(candidates[0].candidateId).toBe('1');
      expect(candidates[0].side).toBe('long');
      expect(candidates[0].featureVector).toHaveLength(14);
      expect(candidates[0].gateVerdict).toBe('collect_only');
      expect(candidates[0].calibratedProbability).toBeNull();
    });

    it('inserts a batch of candidates', () => {
      store.insertCandidateBatch([
        makeCandidate({ candidateId: 1 }),
        makeCandidate({ candidateId: 2 }),
        makeCandidate({ candidateId: 3 }),
      ]);
      expect(store.countCandidates('run-1')).toBe(3);
      expect(store.countCandidates()).toBe(3);
    });

    it('retrieves candidates by time window', () => {
      store.insertCandidateBatch([
        makeCandidate({ candidateId: 1, asOfTimestampNs: 100 }),
        makeCandidate({ candidateId: 2, asOfTimestampNs: 200 }),
        makeCandidate({ candidateId: 3, asOfTimestampNs: 300 }),
      ]);
      const window = store.getCandidatesByWindow(150, 250);
      expect(window).toHaveLength(1);
      expect(window[0].candidateId).toBe('2');
    });

    it('rejects invalid side via CHECK constraint', () => {
      expect(() => store.insertCandidate(
        makeCandidate({ side: 'invalid' as 'long' }),
      )).toThrow();
    });

    it('rejects duplicate (run_id, candidate_id)', () => {
      store.insertCandidate(makeCandidate());
      expect(() => store.insertCandidate(makeCandidate())).toThrow();
    });
  });

  // -- Outcomes -------------------------------------------------------------

  describe('outcomes', () => {
    it('inserts and retrieves an outcome', () => {
      store.insertCandidate(makeCandidate());
      store.insertOutcome(makeOutcome());
      const outcomes = store.getOutcomesByRun('run-1');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].outcomeType).toBe('actual');
      expect(outcomes[0].netPnl).toBe(47.0);
      expect(outcomes[0].profitLabel).toBe(true);
    });

    it('handles censored outcome with null profitLabel', () => {
      store.insertCandidate(makeCandidate());
      store.insertOutcome(makeOutcome({
        outcomeType: 'censored',
        completionStatus: 'censored',
        profitLabel: null,
        exitTimestampNs: null,
      }));
      const outcomes = store.getOutcomesByRun('run-1');
      expect(outcomes[0].completionStatus).toBe('censored');
      expect(outcomes[0].profitLabel).toBeNull();
      expect(outcomes[0].exitTimestampNs).toBeNull();
    });

    it('handles false profitLabel (0) correctly', () => {
      store.insertCandidate(makeCandidate());
      store.insertOutcome(makeOutcome({ profitLabel: false }));
      const outcomes = store.getOutcomesByRun('run-1');
      expect(outcomes[0].profitLabel).toBe(false);
    });

    it('inserts a batch of outcomes', () => {
      store.insertCandidateBatch([
        makeCandidate({ candidateId: 1 }),
        makeCandidate({ candidateId: 2 }),
      ]);
      store.insertOutcomeBatch([
        makeOutcome({ candidateId: 1 }),
        makeOutcome({ candidateId: 2 }),
      ]);
      expect(store.countOutcomes('run-1')).toBe(2);
      expect(store.countOutcomes()).toBe(2);
    });
  });

  // -- Dataset stats --------------------------------------------------------

  describe('getDatasetStats', () => {
    it('returns zeros for empty DB', () => {
      const stats = store.getDatasetStats();
      expect(stats.totalCandidates).toBe(0);
      expect(stats.totalOutcomes).toBe(0);
      expect(stats.orphanCandidates).toBe(0);
      expect(stats.duplicateOutcomes).toBe(0);
    });

    it('detects orphan candidates', () => {
      store.insertCandidate(makeCandidate());
      const stats = store.getDatasetStats();
      expect(stats.totalCandidates).toBe(1);
      expect(stats.orphanCandidates).toBe(1);
    });

    it('counts positive and negative support', () => {
      store.insertCandidateBatch([
        makeCandidate({ candidateId: 1 }),
        makeCandidate({ candidateId: 2 }),
        makeCandidate({ candidateId: 3 }),
      ]);
      store.insertOutcomeBatch([
        makeOutcome({ candidateId: 1, profitLabel: true }),
        makeOutcome({ candidateId: 2, profitLabel: false }),
        makeOutcome({ candidateId: 3, profitLabel: null, completionStatus: 'censored' }),
      ]);
      const stats = store.getDatasetStats();
      expect(stats.positiveSupport).toBe(1);
      expect(stats.negativeSupport).toBe(1);
      expect(stats.censoredCount).toBe(1);
      expect(stats.orphanCandidates).toBe(0);
    });

    it('filters by runId', () => {
      store.insertCandidateBatch([
        makeCandidate({ runId: 'run-1', candidateId: 1 }),
        makeCandidate({ runId: 'run-2', candidateId: 1 }),
      ]);
      store.insertOutcomeBatch([
        makeOutcome({ runId: 'run-1', candidateId: 1 }),
      ]);
      const statsAll = store.getDatasetStats();
      expect(statsAll.totalCandidates).toBe(2);
      expect(statsAll.orphanCandidates).toBe(1);

      const statsRun1 = store.getDatasetStats('run-1');
      expect(statsRun1.totalCandidates).toBe(1);
      expect(statsRun1.orphanCandidates).toBe(0);

      const statsRun2 = store.getDatasetStats('run-2');
      expect(statsRun2.totalCandidates).toBe(1);
      expect(statsRun2.orphanCandidates).toBe(1);
    });
  });

  // -- Training jobs --------------------------------------------------------

  describe('training jobs', () => {
    const job: TrainingJobV1 = {
      jobId: 'job-1',
      state: 'queued',
      provider: 'builtin_gbdt',
      config: {
        nFolds: 5,
        purgeEmbargoBars: 0,
        bootstrapSamples: 1000,
        bootstrapBlockSize: 10,
        trainingWindow: null,
      },
      createdAt: '2026-08-04T10:00:00.000Z',
      startedAt: null,
      completedAt: null,
      artifactId: null,
      errorCode: null,
      errorMessage: null,
    };

    it('inserts and retrieves a training job', () => {
      store.insertTrainingJob(job);
      const retrieved = store.getTrainingJob('job-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.state).toBe('queued');
      expect(retrieved!.config.nFolds).toBe(5);
    });

    it('returns null for unknown job', () => {
      expect(store.getTrainingJob('nonexistent')).toBeNull();
    });

    it('updates training job state', () => {
      store.insertTrainingJob(job);
      store.updateTrainingJobState('job-1', 'running', {
        startedAt: '2026-08-04T10:01:00.000Z',
      });
      const updated = store.getTrainingJob('job-1');
      expect(updated!.state).toBe('running');
      expect(updated!.startedAt).toBe('2026-08-04T10:01:00.000Z');
    });

    it('finds active training job', () => {
      store.insertTrainingJob(job);
      const active = store.getActiveTrainingJob();
      expect(active).not.toBeNull();
      expect(active!.jobId).toBe('job-1');
    });

    it('returns null when no active job', () => {
      store.insertTrainingJob({ ...job, state: 'completed' });
      expect(store.getActiveTrainingJob()).toBeNull();
    });
  });

  // -- Artifacts ------------------------------------------------------------

  describe('artifacts', () => {
    it('inserts and retrieves an artifact', () => {
      const manifest = makeArtifactManifest('art-1');
      store.insertArtifact(manifest);
      const retrieved = store.getArtifact('art-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.artifactId).toBe('art-1');
      expect(retrieved!.modelFormat).toBe('onnx');
      expect(retrieved!.contentHash).toBe('abc123');
    });

    it('returns null for unknown artifact', () => {
      expect(store.getArtifact('nonexistent')).toBeNull();
    });

    it('lists artifacts in descending created_at order', () => {
      store.insertArtifact(makeArtifactManifest('art-1'));
      store.insertArtifact({ ...makeArtifactManifest('art-2'), createdAt: '2026-08-05T10:00:00.000Z' });
      const list = store.listArtifacts();
      expect(list).toHaveLength(2);
      expect(list[0].artifactId).toBe('art-2');
      expect(list[1].artifactId).toBe('art-1');
    });
  });

  // -- Comparisons ----------------------------------------------------------

  describe('comparisons', () => {
    const comparison: ComparisonReportV1 = {
      comparisonId: 'cmp-1',
      baselineRunId: 'base-run',
      correctiveRunId: 'corr-run',
      strategyArtifactId: 'strat-1',
      modelArtifactId: 'art-1',
      mode: 'gate',
      threshold: 0.5,
      baselineMetrics: {
        netReturn: 0.1, sharpe: 1.0, maxDrawdown: -0.05, hitRate: 0.55,
        turnover: 0.3, tradeCount: 100, gatedCount: 0, resizedCount: 0,
      },
      correctiveMetrics: {
        netReturn: 0.12, sharpe: 1.2, maxDrawdown: -0.04, hitRate: 0.58,
        turnover: 0.25, tradeCount: 80, gatedCount: 20, resizedCount: 0,
      },
      holdoutMetrics: null,
      createdAt: '2026-08-04T10:00:00.000Z',
    };

    it('inserts and retrieves a comparison', () => {
      store.insertComparison(comparison);
      const retrieved = store.getComparison('cmp-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.baselineMetrics.tradeCount).toBe(100);
      expect(retrieved!.correctiveMetrics.gatedCount).toBe(20);
      expect(retrieved!.holdoutMetrics).toBeNull();
    });

    it('returns null for unknown comparison', () => {
      expect(store.getComparison('nonexistent')).toBeNull();
    });

    it('handles non-null holdout metrics', () => {
      store.insertComparison({
        ...comparison,
        holdoutMetrics: comparison.baselineMetrics,
      });
      const retrieved = store.getComparison('cmp-1');
      expect(retrieved!.holdoutMetrics).not.toBeNull();
      expect(retrieved!.holdoutMetrics!.tradeCount).toBe(100);
    });
  });
});
