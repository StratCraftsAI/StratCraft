import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

import { CorrectiveStore, type SqliteDatabase, type CandidateIncrementRow, type OutcomeIncrementRow } from '../store.js';
import { CorrectiveOperationsImpl } from '../operations-impl.js';
import { CorrectiveError } from '../contracts.js';
import type { BacktestExecutorAdapter, BacktestRunResult } from '../operations.js';
import type { CorrectiveConfigV1 } from '../contracts.js';
import { CORRECTIVE_ERROR_CODES, MIN_CANDIDATES_FOR_TRAINING, MIN_POSITIVE_CLASS_SUPPORT, MIN_NEGATIVE_CLASS_SUPPORT } from '../constants.js';

const MIGRATION_SQL = `
  CREATE TABLE corrective_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'disabled' CHECK (state IN ('disabled', 'collect_only', 'enabled')),
    provider TEXT NOT NULL DEFAULT 'builtin_gbdt' CHECK (provider = 'builtin_gbdt'),
    mode TEXT NOT NULL DEFAULT 'gate' CHECK (mode IN ('gate', 'sizing', 'hybrid')),
    threshold REAL NOT NULL DEFAULT 0.5 CHECK (threshold >= 0.0 AND threshold <= 1.0),
    sizing_exponent REAL NOT NULL DEFAULT 1.0 CHECK (sizing_exponent >= 0.1 AND sizing_exponent <= 5.0),
    sizing_policy_id TEXT NOT NULL DEFAULT 'gate' CHECK (sizing_policy_id IN ('gate', 'sizing', 'hybrid')),
    model_artifact_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  INSERT INTO corrective_config (id) VALUES (1);

  CREATE TABLE corrective_candidates (
    run_id TEXT NOT NULL, candidate_id INTEGER NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1, strategy_artifact_id TEXT NOT NULL,
    model_artifact_id TEXT, as_of_timestamp_ns INTEGER NOT NULL,
    knowledge_cutoff_timestamp_ns INTEGER NOT NULL, symbol_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('long', 'short')),
    proposed_size REAL NOT NULL CHECK (proposed_size >= 0),
    final_size REAL NOT NULL CHECK (final_size >= 0),
    size_unit TEXT NOT NULL DEFAULT 'shares',
    feature_vector TEXT NOT NULL CHECK (json_valid(feature_vector)),
    feature_schema_hash TEXT NOT NULL, feature_schema_version INTEGER NOT NULL DEFAULT 1,
    gate_verdict TEXT NOT NULL CHECK (gate_verdict IN ('pass', 'reject', 'collect_only', 'disabled')),
    calibrated_probability REAL, sizing_policy_id TEXT,
    reason_code TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (run_id, candidate_id)
  );

  CREATE TABLE corrective_outcomes (
    run_id TEXT NOT NULL, candidate_id INTEGER NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    outcome_type TEXT NOT NULL CHECK (outcome_type IN ('actual', 'shadow', 'censored')),
    entry_timestamp_ns INTEGER NOT NULL, exit_timestamp_ns INTEGER,
    holding_interval_bars INTEGER NOT NULL DEFAULT 0,
    gross_pnl REAL NOT NULL DEFAULT 0, commission REAL NOT NULL DEFAULT 0,
    slippage REAL NOT NULL DEFAULT 0, net_pnl REAL NOT NULL DEFAULT 0,
    completion_status TEXT NOT NULL DEFAULT 'complete' CHECK (completion_status IN ('complete', 'censored')),
    label_policy_version INTEGER NOT NULL DEFAULT 1, profit_label INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (run_id, candidate_id),
    FOREIGN KEY (run_id, candidate_id) REFERENCES corrective_candidates (run_id, candidate_id)
  );

  CREATE TABLE corrective_training_jobs (
    job_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    provider TEXT NOT NULL DEFAULT 'builtin_gbdt',
    config TEXT NOT NULL CHECK (json_valid(config)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at TEXT, completed_at TEXT, artifact_id TEXT, error_code TEXT, error_message TEXT
  );

  CREATE TABLE corrective_artifacts (
    artifact_id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL DEFAULT 1,
    model_format TEXT NOT NULL DEFAULT 'onnx' CHECK (model_format = 'onnx'),
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

import type { PopArtifactManifestV1, ComparisonReportV1 } from '../contracts.js';

const FEATURE_VECTOR = [0.5, 1.1, 0.0, 0.3, -0.2, 55, 0.6, 0.001, 1.2, 0.0, 0, 5, -2.3, 1.0];

const ARTIFACT_MANIFEST: PopArtifactManifestV1 = {
  schemaVersion: 1, artifactId: 'art-test', modelFormat: 'onnx',
  modelFilename: 'art-test.onnx',
  calibrationParams: { method: 'isotonic', fittedOn: 'validation_only', parameters: { a: 1 } },
  featureManifest: [], featureSchemaHash: 'b58a76c9', featureSchemaVersion: 1,
  schemaVersionStr: '1.0.0', trainerVersion: '0.1.0',
  labelPolicyVersion: 1, sizingPolicyVersion: 1,
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
    inputFeatures: FEATURE_VECTOR, expectedProbability: 0.65,
    expectedVerdict: 'pass', tolerance: 1e-6,
  },
  contentHash: 'abc123', createdAt: '2026-08-04T10:00:00.000Z',
};

const TEST_COMPARISON: ComparisonReportV1 = {
  comparisonId: 'cmp-1', baselineRunId: 'base-run', correctiveRunId: 'corr-run',
  strategyArtifactId: 'strat-1', modelArtifactId: 'art-test', mode: 'gate', threshold: 0.5,
  baselineMetrics: { netReturn: 0.1, sharpe: 1.0, maxDrawdown: -0.05, hitRate: 0.55, turnover: 0.3, tradeCount: 100, gatedCount: 0, resizedCount: 0 },
  correctiveMetrics: { netReturn: 0.12, sharpe: 1.2, maxDrawdown: -0.04, hitRate: 0.58, turnover: 0.25, tradeCount: 80, gatedCount: 20, resizedCount: 0 },
  holdoutMetrics: null, createdAt: '2026-08-04T10:00:00.000Z',
};

function makeCandidate(id: number, runId = 'run-1'): CandidateIncrementRow {
  return {
    runId, candidateId: id, strategyArtifactId: 'strat-1', modelArtifactId: null,
    asOfTimestampNs: 1000000000 + id, knowledgeCutoffTimestampNs: 999999000 + id,
    symbolId: 'EURUSD', side: 'long', proposedSize: 100, finalSize: 100,
    sizeUnit: 'shares', featureVector: FEATURE_VECTOR, featureSchemaHash: 'b58a76c9',
    featureSchemaVersion: 1, gateVerdict: 'collect_only', calibratedProbability: null,
    sizingPolicyId: null, reasonCode: '',
  };
}

function makeOutcome(id: number, profit: boolean, runId = 'run-1'): OutcomeIncrementRow {
  return {
    runId, candidateId: id, outcomeType: 'actual', entryTimestampNs: 1000000000,
    exitTimestampNs: 2000000000, holdingIntervalBars: 10,
    grossPnl: profit ? 50 : -50, commission: 2, slippage: 1,
    netPnl: profit ? 47 : -53, completionStatus: 'complete',
    labelPolicyVersion: 1, profitLabel: profit,
  };
}

function seedSufficientDataset(store: CorrectiveStore): void {
  const total = MIN_CANDIDATES_FOR_TRAINING;
  const posCount = MIN_POSITIVE_CLASS_SUPPORT + 30;
  const negCount = MIN_NEGATIVE_CLASS_SUPPORT + 30;

  for (let i = 1; i <= total; i++) {
    store.insertCandidate(makeCandidate(i));
    const isPositive = i <= posCount;
    const isCensored = i > posCount + negCount;
    if (isCensored) {
      store.insertOutcome({
        ...makeOutcome(i, false),
        outcomeType: 'censored',
        completionStatus: 'censored',
        profitLabel: null,
      });
    } else {
      store.insertOutcome(makeOutcome(i, isPositive));
    }
  }
}

describe('CorrectiveOperationsImpl', () => {
  let store: CorrectiveStore;
  let ops: CorrectiveOperationsImpl;

  beforeEach(() => {
    store = new CorrectiveStore(createTestDb());
    ops = new CorrectiveOperationsImpl(store);
  });

  // -- Config ---------------------------------------------------------------

  describe('readCorrectiveConfig', () => {
    it('returns default config', async () => {
      const config = await ops.readCorrectiveConfig();
      expect(config.state).toBe('disabled');
    });
  });

  describe('writeCorrectiveConfig', () => {
    it('updates config with partial overrides', async () => {
      const updated = await ops.writeCorrectiveConfig({ state: 'collect_only' });
      expect(updated.state).toBe('collect_only');
      expect(updated.threshold).toBe(0.5);
    });

    it('rejects invalid state transition implicitly via validation', async () => {
      await expect(
        ops.writeCorrectiveConfig({ state: 'enabled' }),
      ).rejects.toThrow(CorrectiveError);
    });

    it('allows disabled -> collect_only', async () => {
      const config = await ops.writeCorrectiveConfig({ state: 'collect_only' });
      expect(config.state).toBe('collect_only');
    });

    it('preserves modelArtifactId when not provided', async () => {
      store.writeConfig({
        schemaVersion: 1, state: 'disabled', provider: 'builtin_gbdt',
        mode: 'gate', threshold: 0.5, sizingExponent: 1.0,
        sizingPolicyId: 'gate', modelArtifactId: 'art-1',
      });
      const config = await ops.writeCorrectiveConfig({ threshold: 0.7 });
      expect(config.modelArtifactId).toBe('art-1');
    });

    it('clears modelArtifactId when explicitly set to null', async () => {
      store.writeConfig({
        schemaVersion: 1, state: 'disabled', provider: 'builtin_gbdt',
        mode: 'gate', threshold: 0.5, sizingExponent: 1.0,
        sizingPolicyId: 'gate', modelArtifactId: 'art-1',
      });
      const config = await ops.writeCorrectiveConfig({ modelArtifactId: null });
      expect(config.modelArtifactId).toBeNull();
    });
  });

  // -- Readiness ------------------------------------------------------------

  describe('validateCorrectiveReadiness', () => {
    it('returns invalid for empty dataset', async () => {
      const result = await ops.validateCorrectiveReadiness();
      expect(result.valid).toBe(false);
    });

    it('returns valid for sufficient dataset', async () => {
      seedSufficientDataset(store);
      const result = await ops.validateCorrectiveReadiness();
      expect(result.valid).toBe(true);
    });
  });

  // -- Training -------------------------------------------------------------

  describe('startCorrectiveTraining', () => {
    it('rejects when dataset not ready', async () => {
      await expect(ops.startCorrectiveTraining()).rejects.toThrow(
        expect.objectContaining({ code: CORRECTIVE_ERROR_CODES.TRAINING_DATASET_NOT_READY }),
      );
    });

    it('creates a queued job when dataset is ready', async () => {
      seedSufficientDataset(store);
      const job = await ops.startCorrectiveTraining();
      expect(job.state).toBe('queued');
      expect(job.jobId).toBeTruthy();
      expect(job.config.nFolds).toBe(5);
    });

    it('rejects when another job is already running', async () => {
      seedSufficientDataset(store);
      await ops.startCorrectiveTraining();
      await expect(ops.startCorrectiveTraining()).rejects.toThrow(
        expect.objectContaining({ code: CORRECTIVE_ERROR_CODES.TRAINING_ALREADY_RUNNING }),
      );
    });

    it('accepts config overrides', async () => {
      seedSufficientDataset(store);
      const job = await ops.startCorrectiveTraining({ nFolds: 10 });
      expect(job.config.nFolds).toBe(10);
    });
  });

  describe('getCorrectiveTrainingStatus', () => {
    it('returns job status', async () => {
      seedSufficientDataset(store);
      const job = await ops.startCorrectiveTraining();
      const status = await ops.getCorrectiveTrainingStatus(job.jobId);
      expect(status.state).toBe('queued');
    });

    it('throws for unknown job', async () => {
      await expect(ops.getCorrectiveTrainingStatus('nonexistent')).rejects.toThrow(CorrectiveError);
    });
  });

  // -- Artifacts ------------------------------------------------------------

  describe('publishCorrectiveArtifact', () => {
    it('throws for unknown job', async () => {
      await expect(ops.publishCorrectiveArtifact('nonexistent')).rejects.toThrow(CorrectiveError);
    });

    it('throws for non-completed job', async () => {
      seedSufficientDataset(store);
      const job = await ops.startCorrectiveTraining();
      await expect(ops.publishCorrectiveArtifact(job.jobId)).rejects.toThrow(
        expect.objectContaining({ code: CORRECTIVE_ERROR_CODES.TRAINING_DATASET_NOT_READY }),
      );
    });

    it('throws for completed job with no artifactId', async () => {
      seedSufficientDataset(store);
      const job = await ops.startCorrectiveTraining();
      store.updateTrainingJobState(job.jobId, 'completed', {
        completedAt: '2026-08-04T11:00:00.000Z',
      });
      await expect(ops.publishCorrectiveArtifact(job.jobId)).rejects.toThrow(
        expect.objectContaining({ code: CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND }),
      );
    });

    it('throws for completed job referencing missing artifact', async () => {
      seedSufficientDataset(store);
      const job = await ops.startCorrectiveTraining();
      store.updateTrainingJobState(job.jobId, 'completed', {
        completedAt: '2026-08-04T11:00:00.000Z',
        artifactId: 'ghost-artifact',
      });
      await expect(ops.publishCorrectiveArtifact(job.jobId)).rejects.toThrow(
        expect.objectContaining({ code: CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND }),
      );
    });

    it('returns artifact for completed job with valid artifact', async () => {
      seedSufficientDataset(store);
      const job = await ops.startCorrectiveTraining();
      store.insertArtifact(ARTIFACT_MANIFEST);
      store.updateTrainingJobState(job.jobId, 'completed', {
        completedAt: '2026-08-04T11:00:00.000Z',
        artifactId: 'art-test',
      });
      const artifact = await ops.publishCorrectiveArtifact(job.jobId);
      expect(artifact.artifactId).toBe('art-test');
    });
  });

  describe('listCorrectiveArtifacts', () => {
    it('returns empty list', async () => {
      const list = await ops.listCorrectiveArtifacts();
      expect(list).toHaveLength(0);
    });

    it('returns inserted artifacts', async () => {
      store.insertArtifact(ARTIFACT_MANIFEST);
      const list = await ops.listCorrectiveArtifacts();
      expect(list).toHaveLength(1);
      expect(list[0].artifactId).toBe('art-test');
    });
  });

  describe('getCorrectiveArtifactReport', () => {
    it('throws for unknown artifact', async () => {
      await expect(ops.getCorrectiveArtifactReport('nonexistent')).rejects.toThrow(CorrectiveError);
    });

    it('returns artifact report', async () => {
      store.insertArtifact(ARTIFACT_MANIFEST);
      const report = await ops.getCorrectiveArtifactReport('art-test');
      expect(report.artifactId).toBe('art-test');
      expect(report.modelFormat).toBe('onnx');
    });
  });

  // -- Comparisons ----------------------------------------------------------

  describe('runCorrectiveBacktestComparison (no adapter)', () => {
    it('throws when no executor adapter is injected', async () => {
      await expect(ops.runCorrectiveBacktestComparison('a', 'b')).rejects.toThrow(CorrectiveError);
    });
  });

  describe('getCorrectiveBacktestComparison', () => {
    it('throws for unknown comparison', async () => {
      await expect(ops.getCorrectiveBacktestComparison('nonexistent')).rejects.toThrow(CorrectiveError);
    });

    it('returns comparison when found', async () => {
      store.insertComparison(TEST_COMPARISON);
      const comparison = await ops.getCorrectiveBacktestComparison('cmp-1');
      expect(comparison.comparisonId).toBe('cmp-1');
      expect(comparison.correctiveMetrics.gatedCount).toBe(20);
    });
  });
});

// ---------------------------------------------------------------------------
// P6: runCorrectiveBacktestComparison with executor adapter
// ---------------------------------------------------------------------------

describe('CorrectiveOperationsImpl with executor adapter (P6)', () => {
  let store: CorrectiveStore;

  function makeAdapter(
    baselineResult: BacktestRunResult,
    correctiveResult: BacktestRunResult,
  ): BacktestExecutorAdapter {
    let callCount = 0;
    return {
      async runBacktest(
        _strategyArtifactId: string,
        config: CorrectiveConfigV1,
      ): Promise<BacktestRunResult> {
        callCount++;
        return config.state === 'disabled' ? baselineResult : correctiveResult;
      },
    };
  }

  const BASELINE_RESULT: BacktestRunResult = {
    runId: 'baseline-run',
    tradeCount: 100,
    netReturn: 500,
    returns: [10, -5, 15, -3, 8, 12, -2, 6, 4, -1],
    gatedCount: 0,
    resizedCount: 0,
    hitRate: 0.55,
    turnover: 1.0,
  };

  const CORRECTIVE_RESULT: BacktestRunResult = {
    runId: 'corrective-run',
    tradeCount: 70,
    netReturn: 650,
    returns: [12, -3, 18, 8, 14, -1, 9, 7],
    gatedCount: 30,
    resizedCount: 5,
    hitRate: 0.65,
    turnover: 0.7,
  };

  beforeEach(() => {
    store = new CorrectiveStore(createTestDb());
  });

  it('throws when artifact not found', async () => {
    const adapter = makeAdapter(BASELINE_RESULT, CORRECTIVE_RESULT);
    const ops = new CorrectiveOperationsImpl(store, adapter);
    await expect(
      ops.runCorrectiveBacktestComparison('nonexistent', 'strat-1'),
    ).rejects.toThrow(
      expect.objectContaining({ code: CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND }),
    );
  });

  it('runs baseline (disabled) then corrective (enabled) and persists report', async () => {
    store.insertArtifact(ARTIFACT_MANIFEST);
    const calls: { strategyId: string; state: string }[] = [];
    const adapter: BacktestExecutorAdapter = {
      async runBacktest(strategyArtifactId, config) {
        calls.push({ strategyId: strategyArtifactId, state: config.state });
        return config.state === 'disabled' ? BASELINE_RESULT : CORRECTIVE_RESULT;
      },
    };
    const ops = new CorrectiveOperationsImpl(store, adapter);

    const report = await ops.runCorrectiveBacktestComparison('art-test', 'strat-1');

    expect(calls).toHaveLength(2);
    expect(calls[0].state).toBe('disabled');
    expect(calls[1].state).toBe('enabled');
    expect(calls[0].strategyId).toBe('strat-1');
    expect(calls[1].strategyId).toBe('strat-1');

    expect(report.baselineRunId).toBe('baseline-run');
    expect(report.correctiveRunId).toBe('corrective-run');
    expect(report.strategyArtifactId).toBe('strat-1');
    expect(report.modelArtifactId).toBe('art-test');

    expect(report.baselineMetrics.tradeCount).toBe(100);
    expect(report.baselineMetrics.gatedCount).toBe(0);
    expect(report.correctiveMetrics.tradeCount).toBe(70);
    expect(report.correctiveMetrics.gatedCount).toBe(30);
    expect(report.correctiveMetrics.resizedCount).toBe(5);

    const persisted = await ops.getCorrectiveBacktestComparison(report.comparisonId);
    expect(persisted.comparisonId).toBe(report.comparisonId);
  });

  it('computes Sharpe from per-trade returns', async () => {
    store.insertArtifact(ARTIFACT_MANIFEST);
    const adapter = makeAdapter(BASELINE_RESULT, CORRECTIVE_RESULT);
    const ops = new CorrectiveOperationsImpl(store, adapter);

    const report = await ops.runCorrectiveBacktestComparison('art-test', 'strat-1');

    expect(report.baselineMetrics.sharpe).not.toBe(0);
    expect(Number.isFinite(report.baselineMetrics.sharpe)).toBe(true);
    expect(report.correctiveMetrics.sharpe).not.toBe(0);
    expect(Number.isFinite(report.correctiveMetrics.sharpe)).toBe(true);
  });

  it('computes maxDrawdown from cumulative PnL', async () => {
    const deepDrawdownResult: BacktestRunResult = {
      ...BASELINE_RESULT,
      returns: [10, -30, 5, -20, 2],
    };
    store.insertArtifact(ARTIFACT_MANIFEST);
    const adapter = makeAdapter(deepDrawdownResult, CORRECTIVE_RESULT);
    const ops = new CorrectiveOperationsImpl(store, adapter);

    const report = await ops.runCorrectiveBacktestComparison('art-test', 'strat-1');

    expect(report.baselineMetrics.maxDrawdown).toBeLessThan(0);
  });

  it('uses current config mode and threshold for report metadata', async () => {
    store.insertArtifact(ARTIFACT_MANIFEST);
    store.writeConfig({
      schemaVersion: 1, state: 'disabled', provider: 'builtin_gbdt',
      mode: 'hybrid', threshold: 0.6, sizingExponent: 1.5,
      sizingPolicyId: 'hybrid', modelArtifactId: null,
    });
    const adapter = makeAdapter(BASELINE_RESULT, CORRECTIVE_RESULT);
    const ops = new CorrectiveOperationsImpl(store, adapter);

    const report = await ops.runCorrectiveBacktestComparison('art-test', 'strat-1');
    expect(report.mode).toBe('hybrid');
    expect(report.threshold).toBe(0.6);
  });

  it('baseline config sets modelArtifactId=null and state=disabled', async () => {
    store.insertArtifact(ARTIFACT_MANIFEST);
    let capturedBaselineConfig: CorrectiveConfigV1 | null = null;
    const adapter: BacktestExecutorAdapter = {
      async runBacktest(_strategyId, config) {
        if (config.state === 'disabled') capturedBaselineConfig = config;
        return config.state === 'disabled' ? BASELINE_RESULT : CORRECTIVE_RESULT;
      },
    };
    const ops = new CorrectiveOperationsImpl(store, adapter);

    await ops.runCorrectiveBacktestComparison('art-test', 'strat-1');

    expect(capturedBaselineConfig).not.toBeNull();
    expect(capturedBaselineConfig!.state).toBe('disabled');
    expect(capturedBaselineConfig!.modelArtifactId).toBeNull();
  });

  it('corrective config sets modelArtifactId and state=enabled', async () => {
    store.insertArtifact(ARTIFACT_MANIFEST);
    let capturedCorrectiveConfig: CorrectiveConfigV1 | null = null;
    const adapter: BacktestExecutorAdapter = {
      async runBacktest(_strategyId, config) {
        if (config.state === 'enabled') capturedCorrectiveConfig = config;
        return config.state === 'disabled' ? BASELINE_RESULT : CORRECTIVE_RESULT;
      },
    };
    const ops = new CorrectiveOperationsImpl(store, adapter);

    await ops.runCorrectiveBacktestComparison('art-test', 'strat-1');

    expect(capturedCorrectiveConfig).not.toBeNull();
    expect(capturedCorrectiveConfig!.state).toBe('enabled');
    expect(capturedCorrectiveConfig!.modelArtifactId).toBe('art-test');
  });

  it('propagates executor adapter errors', async () => {
    store.insertArtifact(ARTIFACT_MANIFEST);
    const adapter: BacktestExecutorAdapter = {
      async runBacktest() {
        throw new Error('executor crashed');
      },
    };
    const ops = new CorrectiveOperationsImpl(store, adapter);

    await expect(
      ops.runCorrectiveBacktestComparison('art-test', 'strat-1'),
    ).rejects.toThrow('executor crashed');
  });

  it('handles zero-trade result gracefully', async () => {
    const emptyResult: BacktestRunResult = {
      runId: 'empty-run',
      tradeCount: 0,
      netReturn: 0,
      returns: [],
      gatedCount: 0,
      resizedCount: 0,
      hitRate: 0,
      turnover: 0,
    };
    store.insertArtifact(ARTIFACT_MANIFEST);
    const adapter = makeAdapter(emptyResult, emptyResult);
    const ops = new CorrectiveOperationsImpl(store, adapter);

    const report = await ops.runCorrectiveBacktestComparison('art-test', 'strat-1');
    expect(report.baselineMetrics.tradeCount).toBe(0);
    expect(report.baselineMetrics.sharpe).toBe(0);
    expect(report.baselineMetrics.maxDrawdown).toBe(0);
    expect(report.baselineMetrics.netReturn).toBe(0);
  });
});
