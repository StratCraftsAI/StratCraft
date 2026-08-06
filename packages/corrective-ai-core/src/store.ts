import {
  CORRECTIVE_SCHEMA_VERSION,
  CORRECTIVE_ERROR_CODES,
  POP_FEATURE_SCHEMA_VERSION,
  type CorrectiveErrorCode,
} from './constants.js';

import type {
  CorrectiveConfigV1,
  CandidateSnapshotV1,
  OutcomeRecordV1,
  PopArtifactManifestV1,
  TrainingJobV1,
  TrainingConfigV1,
  ComparisonReportV1,
  CorrectiveState,
  TrainingJobState,
} from './contracts.js';

import type { TrainingRow } from './trainer-types.js';

import { CorrectiveError } from './contracts.js';

// ---------------------------------------------------------------------------
// Injected database interface (Electron-free)
// ---------------------------------------------------------------------------

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
}

// ---------------------------------------------------------------------------
// Wire types for candidates/outcomes from the increment stream
// ---------------------------------------------------------------------------

export interface CandidateIncrementRow {
  readonly runId: string;
  readonly candidateId: number;
  readonly strategyArtifactId: string;
  readonly modelArtifactId: string | null;
  readonly asOfTimestampNs: number;
  readonly knowledgeCutoffTimestampNs: number;
  readonly symbolId: string;
  readonly side: 'long' | 'short';
  readonly proposedSize: number;
  readonly finalSize: number;
  readonly sizeUnit: string;
  readonly featureVector: readonly number[];
  readonly featureSchemaHash: string;
  readonly featureSchemaVersion: number;
  readonly gateVerdict: string;
  readonly calibratedProbability: number | null;
  readonly sizingPolicyId: string | null;
  readonly reasonCode: string;
}

export interface OutcomeIncrementRow {
  readonly runId: string;
  readonly candidateId: number;
  readonly outcomeType: string;
  readonly entryTimestampNs: number;
  readonly exitTimestampNs: number | null;
  readonly holdingIntervalBars: number;
  readonly grossPnl: number;
  readonly commission: number;
  readonly slippage: number;
  readonly netPnl: number;
  readonly completionStatus: 'complete' | 'censored';
  readonly labelPolicyVersion: number;
  readonly profitLabel: boolean | null;
}

// ---------------------------------------------------------------------------
// CorrectiveStore
// ---------------------------------------------------------------------------

export class CorrectiveStore {
  constructor(private readonly db: SqliteDatabase) {}

  // -- Config ---------------------------------------------------------------

  readConfig(): CorrectiveConfigV1 {
    const row = this.db.prepare(`
      SELECT schema_version, state, provider, mode, threshold,
             sizing_exponent, sizing_policy_id, model_artifact_id
      FROM corrective_config WHERE id = 1
    `).get() as Record<string, unknown> | undefined;

    if (!row) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.CONFIG_INVALID_STATE_TRANSITION,
        'Corrective config row missing -- migration not applied',
      );
    }

    return {
      schemaVersion: row.schema_version as typeof CORRECTIVE_SCHEMA_VERSION,
      state: row.state as CorrectiveState,
      provider: row.provider as 'builtin_gbdt',
      mode: row.mode as CorrectiveConfigV1['mode'],
      threshold: row.threshold as number,
      sizingExponent: row.sizing_exponent as number,
      sizingPolicyId: row.sizing_policy_id as CorrectiveConfigV1['sizingPolicyId'],
      modelArtifactId: (row.model_artifact_id as string) || null,
    };
  }

  writeConfig(config: CorrectiveConfigV1): void {
    this.db.prepare(`
      UPDATE corrective_config SET
        schema_version = ?, state = ?, provider = ?, mode = ?,
        threshold = ?, sizing_exponent = ?, sizing_policy_id = ?,
        model_artifact_id = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = 1
    `).run(
      config.schemaVersion,
      config.state,
      config.provider,
      config.mode,
      config.threshold,
      config.sizingExponent,
      config.sizingPolicyId,
      config.modelArtifactId,
    );
  }

  // -- Candidates -----------------------------------------------------------

  insertCandidate(c: CandidateIncrementRow): void {
    this.db.prepare(`
      INSERT INTO corrective_candidates (
        run_id, candidate_id, schema_version, strategy_artifact_id,
        model_artifact_id, as_of_timestamp_ns, knowledge_cutoff_timestamp_ns,
        symbol_id, side, proposed_size, final_size, size_unit,
        feature_vector, feature_schema_hash, feature_schema_version,
        gate_verdict, calibrated_probability, sizing_policy_id, reason_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      c.runId,
      c.candidateId,
      CORRECTIVE_SCHEMA_VERSION,
      c.strategyArtifactId,
      c.modelArtifactId,
      c.asOfTimestampNs,
      c.knowledgeCutoffTimestampNs,
      c.symbolId,
      c.side,
      c.proposedSize,
      c.finalSize,
      c.sizeUnit,
      JSON.stringify(c.featureVector),
      c.featureSchemaHash,
      c.featureSchemaVersion,
      c.gateVerdict,
      c.calibratedProbability,
      c.sizingPolicyId,
      c.reasonCode,
    );
  }

  insertCandidateBatch(candidates: readonly CandidateIncrementRow[]): void {
    for (const c of candidates) {
      this.insertCandidate(c);
    }
  }

  getCandidatesByRun(runId: string): CandidateSnapshotV1[] {
    const rows = this.db.prepare(`
      SELECT * FROM corrective_candidates WHERE run_id = ?
      ORDER BY candidate_id
    `).all(runId) as Record<string, unknown>[];

    return rows.map(r => this.rowToCandidate(r));
  }

  getCandidatesByWindow(
    startNs: number,
    endNs: number,
  ): CandidateSnapshotV1[] {
    const rows = this.db.prepare(`
      SELECT * FROM corrective_candidates
      WHERE as_of_timestamp_ns >= ? AND as_of_timestamp_ns <= ?
      ORDER BY as_of_timestamp_ns, candidate_id
    `).all(startNs, endNs) as Record<string, unknown>[];

    return rows.map(r => this.rowToCandidate(r));
  }

  countCandidates(runId?: string): number {
    if (runId) {
      const row = this.db.prepare(
        'SELECT COUNT(*) as cnt FROM corrective_candidates WHERE run_id = ?',
      ).get(runId) as { cnt: number };
      return row.cnt;
    }
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM corrective_candidates',
    ).get() as { cnt: number };
    return row.cnt;
  }

  // -- Outcomes -------------------------------------------------------------

  insertOutcome(o: OutcomeIncrementRow): void {
    this.db.prepare(`
      INSERT INTO corrective_outcomes (
        run_id, candidate_id, schema_version, outcome_type,
        entry_timestamp_ns, exit_timestamp_ns, holding_interval_bars,
        gross_pnl, commission, slippage, net_pnl,
        completion_status, label_policy_version, profit_label
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      o.runId,
      o.candidateId,
      CORRECTIVE_SCHEMA_VERSION,
      o.outcomeType,
      o.entryTimestampNs,
      o.exitTimestampNs,
      o.holdingIntervalBars,
      o.grossPnl,
      o.commission,
      o.slippage,
      o.netPnl,
      o.completionStatus,
      o.labelPolicyVersion,
      o.profitLabel === null ? null : (o.profitLabel ? 1 : 0),
    );
  }

  insertOutcomeBatch(outcomes: readonly OutcomeIncrementRow[]): void {
    for (const o of outcomes) {
      this.insertOutcome(o);
    }
  }

  getOutcomesByRun(runId: string): OutcomeRecordV1[] {
    const rows = this.db.prepare(`
      SELECT * FROM corrective_outcomes WHERE run_id = ?
      ORDER BY candidate_id
    `).all(runId) as Record<string, unknown>[];

    return rows.map(r => this.rowToOutcome(r));
  }

  countOutcomes(runId?: string): number {
    if (runId) {
      const row = this.db.prepare(
        'SELECT COUNT(*) as cnt FROM corrective_outcomes WHERE run_id = ?',
      ).get(runId) as { cnt: number };
      return row.cnt;
    }
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM corrective_outcomes',
    ).get() as { cnt: number };
    return row.cnt;
  }

  // -- Dataset stats --------------------------------------------------------

  getDatasetStats(runId?: string): {
    totalCandidates: number;
    totalOutcomes: number;
    orphanCandidates: number;
    duplicateOutcomes: number;
    positiveSupport: number;
    negativeSupport: number;
    censoredCount: number;
  } {
    const runFilter = runId ? ' WHERE run_id = ?' : '';
    const runParams: unknown[] = runId ? [runId] : [];

    const totalCandidates = (this.db.prepare(
      `SELECT COUNT(*) as cnt FROM corrective_candidates${runFilter}`,
    ).get(...runParams) as { cnt: number }).cnt;

    const totalOutcomes = (this.db.prepare(
      `SELECT COUNT(*) as cnt FROM corrective_outcomes${runFilter}`,
    ).get(...runParams) as { cnt: number }).cnt;

    const orphanCandidates = (this.db.prepare(
      runId
        ? `SELECT COUNT(*) as cnt FROM corrective_candidates c
           LEFT JOIN corrective_outcomes o ON c.run_id = o.run_id AND c.candidate_id = o.candidate_id
           WHERE c.run_id = ? AND o.candidate_id IS NULL`
        : `SELECT COUNT(*) as cnt FROM corrective_candidates c
           LEFT JOIN corrective_outcomes o ON c.run_id = o.run_id AND c.candidate_id = o.candidate_id
           WHERE o.candidate_id IS NULL`,
    ).get(...runParams) as { cnt: number }).cnt;

    const duplicateOutcomes = (this.db.prepare(
      runId
        ? `SELECT COUNT(*) as cnt FROM (
             SELECT run_id, candidate_id FROM corrective_outcomes
             WHERE run_id = ? GROUP BY run_id, candidate_id HAVING COUNT(*) > 1
           )`
        : `SELECT COUNT(*) as cnt FROM (
             SELECT run_id, candidate_id FROM corrective_outcomes
             GROUP BY run_id, candidate_id HAVING COUNT(*) > 1
           )`,
    ).get(...runParams) as { cnt: number }).cnt;

    const positiveSupport = (this.db.prepare(
      runId
        ? 'SELECT COUNT(*) as cnt FROM corrective_outcomes WHERE run_id = ? AND profit_label = 1 AND completion_status = ?'
        : 'SELECT COUNT(*) as cnt FROM corrective_outcomes WHERE profit_label = 1 AND completion_status = ?',
    ).get(...(runId ? [runId, 'complete'] : ['complete'])) as { cnt: number }).cnt;

    const negativeSupport = (this.db.prepare(
      runId
        ? 'SELECT COUNT(*) as cnt FROM corrective_outcomes WHERE run_id = ? AND profit_label = 0 AND completion_status = ?'
        : 'SELECT COUNT(*) as cnt FROM corrective_outcomes WHERE profit_label = 0 AND completion_status = ?',
    ).get(...(runId ? [runId, 'complete'] : ['complete'])) as { cnt: number }).cnt;

    const censoredCount = (this.db.prepare(
      runId
        ? 'SELECT COUNT(*) as cnt FROM corrective_outcomes WHERE run_id = ? AND completion_status = ?'
        : 'SELECT COUNT(*) as cnt FROM corrective_outcomes WHERE completion_status = ?',
    ).get(...(runId ? [runId, 'censored'] : ['censored'])) as { cnt: number }).cnt;

    return {
      totalCandidates,
      totalOutcomes,
      orphanCandidates,
      duplicateOutcomes,
      positiveSupport,
      negativeSupport,
      censoredCount,
    };
  }

  // -- Training dataset (window-pushed join) --------------------------------

  getTrainingDataset(startNs?: number, endNs?: number): TrainingRow[] {
    let sql = `
      SELECT
        c.run_id, c.candidate_id, c.as_of_timestamp_ns,
        c.knowledge_cutoff_timestamp_ns, c.symbol_id, c.side,
        c.proposed_size, c.final_size, c.feature_vector,
        c.feature_schema_hash, c.gate_verdict,
        o.outcome_type, o.entry_timestamp_ns, o.exit_timestamp_ns,
        o.holding_interval_bars, o.net_pnl, o.completion_status,
        o.profit_label, o.label_policy_version
      FROM corrective_candidates c
      INNER JOIN corrective_outcomes o
        ON c.run_id = o.run_id AND c.candidate_id = o.candidate_id
    `;

    const params: unknown[] = [];

    if (startNs !== undefined && endNs !== undefined) {
      sql += ' WHERE c.as_of_timestamp_ns >= ? AND c.as_of_timestamp_ns <= ?';
      params.push(startNs, endNs);
    } else if (startNs !== undefined) {
      sql += ' WHERE c.as_of_timestamp_ns >= ?';
      params.push(startNs);
    } else if (endNs !== undefined) {
      sql += ' WHERE c.as_of_timestamp_ns <= ?';
      params.push(endNs);
    }

    sql += ' ORDER BY c.as_of_timestamp_ns, c.candidate_id';

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];

    return rows.map(r => this.rowToTrainingRow(r));
  }

  private rowToTrainingRow(r: Record<string, unknown>): TrainingRow {
    const profitLabelRaw = r.profit_label;
    let profitLabel: boolean | null = null;
    if (profitLabelRaw === 1) profitLabel = true;
    else if (profitLabelRaw === 0) profitLabel = false;

    return {
      runId: r.run_id as string,
      candidateId: r.candidate_id as number,
      asOfTimestampNs: r.as_of_timestamp_ns as number,
      knowledgeCutoffTimestampNs: r.knowledge_cutoff_timestamp_ns as number,
      symbolId: r.symbol_id as string,
      side: r.side as TrainingRow['side'],
      proposedSize: r.proposed_size as number,
      finalSize: r.final_size as number,
      featureVector: JSON.parse(r.feature_vector as string) as number[],
      featureSchemaHash: r.feature_schema_hash as string,
      gateVerdict: r.gate_verdict as TrainingRow['gateVerdict'],
      outcomeType: r.outcome_type as TrainingRow['outcomeType'],
      entryTimestampNs: r.entry_timestamp_ns as number,
      exitTimestampNs: r.exit_timestamp_ns as number | null,
      holdingIntervalBars: r.holding_interval_bars as number,
      netPnl: r.net_pnl as number,
      completionStatus: r.completion_status as TrainingRow['completionStatus'],
      profitLabel,
      labelPolicyVersion: r.label_policy_version as number,
    };
  }

  // -- Training jobs --------------------------------------------------------

  insertTrainingJob(job: TrainingJobV1): void {
    this.db.prepare(`
      INSERT INTO corrective_training_jobs (
        job_id, state, provider, config,
        created_at, started_at, completed_at,
        artifact_id, error_code, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.jobId,
      job.state,
      job.provider,
      JSON.stringify(job.config),
      job.createdAt,
      job.startedAt,
      job.completedAt,
      job.artifactId,
      job.errorCode,
      job.errorMessage,
    );
  }

  updateTrainingJobState(
    jobId: string,
    state: TrainingJobState,
    updates?: {
      startedAt?: string;
      completedAt?: string;
      artifactId?: string;
      errorCode?: string;
      errorMessage?: string;
    },
  ): void {
    this.db.prepare(`
      UPDATE corrective_training_jobs SET
        state = ?,
        started_at = COALESCE(?, started_at),
        completed_at = COALESCE(?, completed_at),
        artifact_id = COALESCE(?, artifact_id),
        error_code = COALESCE(?, error_code),
        error_message = COALESCE(?, error_message)
      WHERE job_id = ?
    `).run(
      state,
      updates?.startedAt ?? null,
      updates?.completedAt ?? null,
      updates?.artifactId ?? null,
      updates?.errorCode ?? null,
      updates?.errorMessage ?? null,
      jobId,
    );
  }

  getTrainingJob(jobId: string): TrainingJobV1 | null {
    const row = this.db.prepare(
      'SELECT * FROM corrective_training_jobs WHERE job_id = ?',
    ).get(jobId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToTrainingJob(row);
  }

  getActiveTrainingJob(): TrainingJobV1 | null {
    const row = this.db.prepare(
      "SELECT * FROM corrective_training_jobs WHERE state IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1",
    ).get() as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToTrainingJob(row);
  }

  // -- Artifacts ------------------------------------------------------------

  insertArtifact(manifest: PopArtifactManifestV1): void {
    this.db.prepare(`
      INSERT INTO corrective_artifacts (
        artifact_id, schema_version, model_format, model_filename,
        calibration_params, feature_manifest, feature_schema_hash,
        feature_schema_version, schema_version_str, trainer_version,
        label_policy_version, sizing_policy_version,
        training_window, validation_window,
        metrics, minimum_sample_evidence, golden_vector,
        content_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      manifest.artifactId,
      manifest.schemaVersion,
      manifest.modelFormat,
      manifest.modelFilename,
      JSON.stringify(manifest.calibrationParams),
      JSON.stringify(manifest.featureManifest),
      manifest.featureSchemaHash,
      manifest.featureSchemaVersion,
      manifest.schemaVersionStr,
      manifest.trainerVersion,
      manifest.labelPolicyVersion,
      manifest.sizingPolicyVersion,
      JSON.stringify(manifest.trainingWindow),
      JSON.stringify(manifest.validationWindow),
      JSON.stringify(manifest.metrics),
      JSON.stringify(manifest.minimumSampleEvidence),
      JSON.stringify(manifest.goldenVector),
      manifest.contentHash,
      manifest.createdAt,
    );
  }

  getArtifact(artifactId: string): PopArtifactManifestV1 | null {
    const row = this.db.prepare(
      'SELECT * FROM corrective_artifacts WHERE artifact_id = ?',
    ).get(artifactId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToArtifact(row);
  }

  listArtifacts(): PopArtifactManifestV1[] {
    const rows = this.db.prepare(
      'SELECT * FROM corrective_artifacts ORDER BY created_at DESC',
    ).all() as Record<string, unknown>[];

    return rows.map(r => this.rowToArtifact(r));
  }

  // -- Comparisons ----------------------------------------------------------

  insertComparison(report: ComparisonReportV1): void {
    this.db.prepare(`
      INSERT INTO corrective_comparisons (
        comparison_id, baseline_run_id, corrective_run_id,
        strategy_artifact_id, model_artifact_id,
        mode, threshold,
        baseline_metrics, corrective_metrics, holdout_metrics,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.comparisonId,
      report.baselineRunId,
      report.correctiveRunId,
      report.strategyArtifactId,
      report.modelArtifactId,
      report.mode,
      report.threshold,
      JSON.stringify(report.baselineMetrics),
      JSON.stringify(report.correctiveMetrics),
      report.holdoutMetrics ? JSON.stringify(report.holdoutMetrics) : null,
      report.createdAt,
    );
  }

  getComparison(comparisonId: string): ComparisonReportV1 | null {
    const row = this.db.prepare(
      'SELECT * FROM corrective_comparisons WHERE comparison_id = ?',
    ).get(comparisonId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToComparison(row);
  }

  // -- Row mappers ----------------------------------------------------------

  private rowToCandidate(r: Record<string, unknown>): CandidateSnapshotV1 {
    return {
      schemaVersion: r.schema_version as typeof CORRECTIVE_SCHEMA_VERSION,
      runId: r.run_id as string,
      candidateId: String(r.candidate_id),
      strategyArtifactId: r.strategy_artifact_id as string,
      modelArtifactId: (r.model_artifact_id as string) || null,
      asOfTimestampNs: String(r.as_of_timestamp_ns),
      knowledgeCutoffTimestampNs: String(r.knowledge_cutoff_timestamp_ns),
      symbolId: r.symbol_id as string,
      side: r.side as CandidateSnapshotV1['side'],
      proposedSize: r.proposed_size as number,
      finalSize: r.final_size as number,
      sizeUnit: r.size_unit as string,
      featureVector: JSON.parse(r.feature_vector as string) as number[],
      featureSchemaHash: r.feature_schema_hash as string,
      featureSchemaVersion: r.feature_schema_version as typeof POP_FEATURE_SCHEMA_VERSION,
      gateVerdict: r.gate_verdict as CandidateSnapshotV1['gateVerdict'],
      calibratedProbability: r.calibrated_probability as number | null,
      sizingPolicyId: (r.sizing_policy_id as CandidateSnapshotV1['sizingPolicyId']) || null,
      reasonCode: (r.reason_code as string) || '',
    };
  }

  private rowToOutcome(r: Record<string, unknown>): OutcomeRecordV1 {
    const profitLabelRaw = r.profit_label;
    let profitLabel: boolean | null = null;
    if (profitLabelRaw === 1) profitLabel = true;
    else if (profitLabelRaw === 0) profitLabel = false;

    return {
      schemaVersion: r.schema_version as typeof CORRECTIVE_SCHEMA_VERSION,
      runId: r.run_id as string,
      candidateId: String(r.candidate_id),
      outcomeType: r.outcome_type as OutcomeRecordV1['outcomeType'],
      entryTimestampNs: String(r.entry_timestamp_ns),
      exitTimestampNs: r.exit_timestamp_ns ? String(r.exit_timestamp_ns) : null,
      holdingIntervalBars: r.holding_interval_bars as number,
      grossPnl: r.gross_pnl as number,
      commission: r.commission as number,
      slippage: r.slippage as number,
      netPnl: r.net_pnl as number,
      completionStatus: r.completion_status as OutcomeRecordV1['completionStatus'],
      labelPolicyVersion: r.label_policy_version as number,
      profitLabel,
    };
  }

  private rowToTrainingJob(r: Record<string, unknown>): TrainingJobV1 {
    return {
      jobId: r.job_id as string,
      state: r.state as TrainingJobV1['state'],
      provider: r.provider as 'builtin_gbdt',
      config: JSON.parse(r.config as string) as TrainingConfigV1,
      createdAt: r.created_at as string,
      startedAt: (r.started_at as string) || null,
      completedAt: (r.completed_at as string) || null,
      artifactId: (r.artifact_id as string) || null,
      errorCode: (r.error_code as CorrectiveErrorCode) || null,
      errorMessage: (r.error_message as string) || null,
    };
  }

  private rowToArtifact(r: Record<string, unknown>): PopArtifactManifestV1 {
    return {
      schemaVersion: r.schema_version as typeof CORRECTIVE_SCHEMA_VERSION,
      artifactId: r.artifact_id as string,
      modelFormat: r.model_format as PopArtifactManifestV1['modelFormat'],
      modelFilename: r.model_filename as string,
      calibrationParams: JSON.parse(r.calibration_params as string),
      featureManifest: JSON.parse(r.feature_manifest as string),
      featureSchemaHash: r.feature_schema_hash as string,
      featureSchemaVersion: r.feature_schema_version as typeof POP_FEATURE_SCHEMA_VERSION,
      schemaVersionStr: r.schema_version_str as string,
      trainerVersion: r.trainer_version as string,
      labelPolicyVersion: r.label_policy_version as number,
      sizingPolicyVersion: r.sizing_policy_version as number,
      trainingWindow: JSON.parse(r.training_window as string),
      validationWindow: JSON.parse(r.validation_window as string),
      metrics: JSON.parse(r.metrics as string),
      minimumSampleEvidence: JSON.parse(r.minimum_sample_evidence as string),
      goldenVector: JSON.parse(r.golden_vector as string),
      contentHash: r.content_hash as string,
      createdAt: r.created_at as string,
    };
  }

  private rowToComparison(r: Record<string, unknown>): ComparisonReportV1 {
    return {
      comparisonId: r.comparison_id as string,
      baselineRunId: r.baseline_run_id as string,
      correctiveRunId: r.corrective_run_id as string,
      strategyArtifactId: r.strategy_artifact_id as string,
      modelArtifactId: r.model_artifact_id as string,
      mode: r.mode as ComparisonReportV1['mode'],
      threshold: r.threshold as number,
      baselineMetrics: JSON.parse(r.baseline_metrics as string),
      correctiveMetrics: JSON.parse(r.corrective_metrics as string),
      holdoutMetrics: r.holdout_metrics
        ? JSON.parse(r.holdout_metrics as string)
        : null,
      createdAt: r.created_at as string,
    };
  }
}
