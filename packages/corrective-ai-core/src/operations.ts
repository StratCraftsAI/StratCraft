// -----------------------------------------------------------------------
// TICKET_1361 P0: Shared operations interface
//
// Section 7 of the design doc. Electron IPC and MCP adapters call these
// exact functions with injected runtime dependencies. They do NOT
// duplicate validation, SQL, artifact selection, state transitions, or
// readiness decisions.
//
// P0 defines the contract only. P2 implements each operation.
// -----------------------------------------------------------------------

import type {
  CorrectiveConfigV1,
  CandidateSnapshotV1,
  OutcomeRecordV1,
  PopArtifactManifestV1,
  TrainingJobV1,
  TrainingConfigV1,
  ComparisonReportV1,
  ComparisonMetrics,
  CorrectiveState,
} from './contracts.js';

import type { DatasetValidationResult } from './validation.js';

// ---------------------------------------------------------------------------
// Executor adapter for comparison runs (injected by Electron/MCP surface)
// ---------------------------------------------------------------------------

export interface BacktestRunResult {
  readonly runId: string;
  readonly tradeCount: number;
  readonly netReturn: number;
  readonly returns: readonly number[];
  readonly gatedCount: number;
  readonly resizedCount: number;
  readonly hitRate: number;
  readonly turnover: number;
}

export interface BacktestExecutorAdapter {
  runBacktest(
    strategyArtifactId: string,
    correctiveConfig: CorrectiveConfigV1,
  ): Promise<BacktestRunResult>;
}

export interface CorrectiveOperations {
  readCorrectiveConfig(): Promise<CorrectiveConfigV1>;

  writeCorrectiveConfig(
    config: Partial<CorrectiveConfigV1> & { state?: CorrectiveState },
  ): Promise<CorrectiveConfigV1>;

  validateCorrectiveReadiness(): Promise<DatasetValidationResult>;

  startCorrectiveTraining(
    config?: Partial<TrainingConfigV1>,
  ): Promise<TrainingJobV1>;

  getCorrectiveTrainingStatus(
    jobId: string,
  ): Promise<TrainingJobV1>;

  publishCorrectiveArtifact(
    jobId: string,
  ): Promise<PopArtifactManifestV1>;

  listCorrectiveArtifacts(): Promise<readonly PopArtifactManifestV1[]>;

  getCorrectiveArtifactReport(
    artifactId: string,
  ): Promise<PopArtifactManifestV1>;

  runCorrectiveBacktestComparison(
    artifactId: string,
    strategyArtifactId: string,
  ): Promise<ComparisonReportV1>;

  getCorrectiveBacktestComparison(
    comparisonId: string,
  ): Promise<ComparisonReportV1>;
}
