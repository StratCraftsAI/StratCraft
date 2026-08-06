import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

import {
  CorrectiveStore,
  type SqliteDatabase,
  type CandidateIncrementRow,
  type OutcomeIncrementRow,
} from '../store.js';

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

function makeCandidate(id: number, tsNs: number): CandidateIncrementRow {
  return {
    runId: 'run-1', candidateId: id, strategyArtifactId: 'strat-1',
    modelArtifactId: null, asOfTimestampNs: tsNs,
    knowledgeCutoffTimestampNs: tsNs - 500, symbolId: 'EURUSD', side: 'long',
    proposedSize: 100, finalSize: 100, sizeUnit: 'shares',
    featureVector: FEATURE_VECTOR, featureSchemaHash: 'b58a76c9',
    featureSchemaVersion: 1, gateVerdict: 'collect_only',
    calibratedProbability: null, sizingPolicyId: null, reasonCode: '',
  };
}

function makeOutcome(id: number, profit: boolean): OutcomeIncrementRow {
  return {
    runId: 'run-1', candidateId: id, outcomeType: 'actual',
    entryTimestampNs: 1_000_000_000, exitTimestampNs: 2_000_000_000,
    holdingIntervalBars: 10, grossPnl: profit ? 50 : -50,
    commission: 2, slippage: 1, netPnl: profit ? 47 : -53,
    completionStatus: 'complete', labelPolicyVersion: 1, profitLabel: profit,
  };
}

describe('CorrectiveStore.readConfig edge cases', () => {
  it('throws when config row is missing', () => {
    const db = new Database(':memory:');
    db.exec(`
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
    `);
    const store = new CorrectiveStore(db);
    expect(() => store.readConfig()).toThrow('migration not applied');
  });
});

describe('CorrectiveStore.getTrainingDataset', () => {
  let store: CorrectiveStore;

  beforeEach(() => {
    const db = new Database(':memory:');
    db.exec(MIGRATION_SQL);
    store = new CorrectiveStore(db);

    for (let i = 1; i <= 20; i++) {
      store.insertCandidate(makeCandidate(i, 1_000_000_000 + i * 1_000_000));
      store.insertOutcome(makeOutcome(i, i % 2 === 0));
    }
  });

  it('returns all joined rows without window', () => {
    const rows = store.getTrainingDataset();
    expect(rows).toHaveLength(20);
    expect(rows[0].runId).toBe('run-1');
    expect(rows[0].featureVector).toHaveLength(14);
    expect(typeof rows[0].profitLabel).toBe('boolean');
  });

  it('pushes time window down to SQL (window pushdown mandatory)', () => {
    const startNs = 1_000_000_000 + 5 * 1_000_000;
    const endNs = 1_000_000_000 + 15 * 1_000_000;

    const rows = store.getTrainingDataset(startNs, endNs);

    expect(rows.length).toBeLessThan(20);
    for (const row of rows) {
      expect(row.asOfTimestampNs).toBeGreaterThanOrEqual(startNs);
      expect(row.asOfTimestampNs).toBeLessThanOrEqual(endNs);
    }
  });

  it('pushes start-only window', () => {
    const startNs = 1_000_000_000 + 10 * 1_000_000;
    const rows = store.getTrainingDataset(startNs);
    expect(rows.length).toBeLessThan(20);
    for (const row of rows) {
      expect(row.asOfTimestampNs).toBeGreaterThanOrEqual(startNs);
    }
  });

  it('pushes end-only window', () => {
    const endNs = 1_000_000_000 + 10 * 1_000_000;
    const rows = store.getTrainingDataset(undefined, endNs);
    expect(rows.length).toBeLessThan(20);
    for (const row of rows) {
      expect(row.asOfTimestampNs).toBeLessThanOrEqual(endNs);
    }
  });

  it('only returns rows with matching outcomes (INNER JOIN)', () => {
    store.insertCandidate(makeCandidate(99, 9_000_000_000));
    const rows = store.getTrainingDataset();
    expect(rows).toHaveLength(20);
  });

  it('rows are ordered by asOfTimestampNs', () => {
    const rows = store.getTrainingDataset();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].asOfTimestampNs).toBeGreaterThanOrEqual(
        rows[i - 1].asOfTimestampNs,
      );
    }
  });

  it('maps profitLabel correctly for true/false/null', () => {
    store.insertCandidate(makeCandidate(50, 50_000_000_000));
    store.insertOutcome({
      ...makeOutcome(50, false),
      completionStatus: 'censored',
      profitLabel: null,
    });

    const rows = store.getTrainingDataset();
    const row50 = rows.find(r => r.candidateId === 50);
    expect(row50?.profitLabel).toBeNull();
    expect(row50?.completionStatus).toBe('censored');
  });
});
