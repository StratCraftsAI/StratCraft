import { randomUUID } from 'node:crypto';

import {
  CORRECTIVE_SCHEMA_VERSION,
  CORRECTIVE_ERROR_CODES,
} from './constants.js';

import {
  type CorrectiveConfigV1,
  type PopArtifactManifestV1,
  type TrainingJobV1,
  type TrainingConfigV1,
  type ComparisonReportV1,
  type ComparisonMetrics,
  type CorrectiveState,
  DEFAULT_CORRECTIVE_CONFIG,
  DEFAULT_TRAINING_CONFIG,
  CorrectiveError,
} from './contracts.js';

import type { CorrectiveOperations, BacktestExecutorAdapter, BacktestRunResult } from './operations.js';

import type { DatasetValidationResult } from './validation.js';
import {
  validateConfig,
  validateStateTransition,
  validateDatasetReadiness,
} from './validation.js';

import { computeSharpe, computeMaxDrawdown } from './metrics.js';

import type { CorrectiveStore } from './store.js';

export class CorrectiveOperationsImpl implements CorrectiveOperations {
  constructor(
    private readonly store: CorrectiveStore,
    private readonly executorAdapter?: BacktestExecutorAdapter,
  ) {}

  async readCorrectiveConfig(): Promise<CorrectiveConfigV1> {
    return this.store.readConfig();
  }

  async writeCorrectiveConfig(
    partial: Partial<CorrectiveConfigV1> & { state?: CorrectiveState },
  ): Promise<CorrectiveConfigV1> {
    const current = this.store.readConfig();

    const merged: CorrectiveConfigV1 = {
      schemaVersion: CORRECTIVE_SCHEMA_VERSION,
      state: partial.state ?? current.state,
      provider: partial.provider ?? current.provider,
      mode: partial.mode ?? current.mode,
      threshold: partial.threshold ?? current.threshold,
      sizingExponent: partial.sizingExponent ?? current.sizingExponent,
      sizingPolicyId: partial.sizingPolicyId ?? current.sizingPolicyId,
      modelArtifactId: partial.modelArtifactId !== undefined
        ? partial.modelArtifactId
        : current.modelArtifactId,
    };

    if (partial.state !== undefined && partial.state !== current.state) {
      validateStateTransition(current.state, partial.state);
    }

    validateConfig(merged);

    this.store.writeConfig(merged);
    return merged;
  }

  async validateCorrectiveReadiness(): Promise<DatasetValidationResult> {
    const stats = this.store.getDatasetStats();
    return validateDatasetReadiness(
      stats.totalCandidates,
      stats.totalOutcomes,
      stats.orphanCandidates,
      stats.duplicateOutcomes,
      stats.positiveSupport,
      stats.negativeSupport,
      stats.censoredCount,
    );
  }

  async startCorrectiveTraining(
    configOverrides?: Partial<TrainingConfigV1>,
  ): Promise<TrainingJobV1> {
    const activeJob = this.store.getActiveTrainingJob();
    if (activeJob) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.TRAINING_ALREADY_RUNNING,
        `Training job ${activeJob.jobId} is already ${activeJob.state}`,
      );
    }

    const readiness = await this.validateCorrectiveReadiness();
    if (!readiness.valid) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.TRAINING_DATASET_NOT_READY,
        `Dataset not ready: ${readiness.bindingConstraint}`,
      );
    }

    const config: TrainingConfigV1 = {
      nFolds: configOverrides?.nFolds ?? DEFAULT_TRAINING_CONFIG.nFolds,
      purgeEmbargoBars: configOverrides?.purgeEmbargoBars ?? DEFAULT_TRAINING_CONFIG.purgeEmbargoBars,
      bootstrapSamples: configOverrides?.bootstrapSamples ?? DEFAULT_TRAINING_CONFIG.bootstrapSamples,
      bootstrapBlockSize: configOverrides?.bootstrapBlockSize ?? DEFAULT_TRAINING_CONFIG.bootstrapBlockSize,
      trainingWindow: configOverrides?.trainingWindow ?? DEFAULT_TRAINING_CONFIG.trainingWindow,
    };

    const job: TrainingJobV1 = {
      jobId: randomUUID(),
      state: 'queued',
      provider: 'builtin_gbdt',
      config,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      artifactId: null,
      errorCode: null,
      errorMessage: null,
    };

    this.store.insertTrainingJob(job);
    return job;
  }

  async getCorrectiveTrainingStatus(jobId: string): Promise<TrainingJobV1> {
    const job = this.store.getTrainingJob(jobId);
    if (!job) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        `Training job not found: ${jobId}`,
      );
    }
    return job;
  }

  async publishCorrectiveArtifact(jobId: string): Promise<PopArtifactManifestV1> {
    const job = this.store.getTrainingJob(jobId);
    if (!job) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        `Training job not found: ${jobId}`,
      );
    }
    if (job.state !== 'completed') {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.TRAINING_DATASET_NOT_READY,
        `Training job ${jobId} is ${job.state}, not completed`,
      );
    }
    if (!job.artifactId) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        `Training job ${jobId} has no artifact`,
      );
    }

    const artifact = this.store.getArtifact(job.artifactId);
    if (!artifact) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        `Artifact ${job.artifactId} not found in registry`,
      );
    }

    return artifact;
  }

  async listCorrectiveArtifacts(): Promise<readonly PopArtifactManifestV1[]> {
    return this.store.listArtifacts();
  }

  async getCorrectiveArtifactReport(artifactId: string): Promise<PopArtifactManifestV1> {
    const artifact = this.store.getArtifact(artifactId);
    if (!artifact) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        `Artifact not found: ${artifactId}`,
      );
    }
    return artifact;
  }

  async runCorrectiveBacktestComparison(
    artifactId: string,
    strategyArtifactId: string,
  ): Promise<ComparisonReportV1> {
    if (!this.executorAdapter) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.TRAINING_DATASET_NOT_READY,
        'Backtest comparison requires an executor adapter (not available in this context)',
      );
    }

    const artifact = this.store.getArtifact(artifactId);
    if (!artifact) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        `Artifact not found: ${artifactId}`,
      );
    }

    const currentConfig = this.store.readConfig();

    const baselineConfig: CorrectiveConfigV1 = {
      ...currentConfig,
      state: 'disabled',
      modelArtifactId: null,
    };

    const correctiveConfig: CorrectiveConfigV1 = {
      ...currentConfig,
      state: 'enabled',
      modelArtifactId: artifactId,
    };

    const baselineResult = await this.executorAdapter.runBacktest(
      strategyArtifactId,
      baselineConfig,
    );

    const correctiveResult = await this.executorAdapter.runBacktest(
      strategyArtifactId,
      correctiveConfig,
    );

    const baselineMetrics = this.buildComparisonMetrics(baselineResult);
    const correctiveMetrics = this.buildComparisonMetrics(correctiveResult);

    const comparisonId = randomUUID();
    const report: ComparisonReportV1 = {
      comparisonId,
      baselineRunId: baselineResult.runId,
      correctiveRunId: correctiveResult.runId,
      strategyArtifactId,
      modelArtifactId: artifactId,
      mode: currentConfig.mode,
      threshold: currentConfig.threshold,
      baselineMetrics,
      correctiveMetrics,
      holdoutMetrics: null,
      createdAt: new Date().toISOString(),
    };

    this.store.insertComparison(report);
    return report;
  }

  private buildComparisonMetrics(result: BacktestRunResult): ComparisonMetrics {
    const cumulativePnl: number[] = [];
    let cum = 0;
    for (const r of result.returns) {
      cum += r;
      cumulativePnl.push(cum);
    }

    return {
      netReturn: result.netReturn,
      sharpe: computeSharpe(result.returns),
      maxDrawdown: computeMaxDrawdown(cumulativePnl),
      hitRate: result.hitRate,
      turnover: result.turnover,
      tradeCount: result.tradeCount,
      gatedCount: result.gatedCount,
      resizedCount: result.resizedCount,
    };
  }

  async getCorrectiveBacktestComparison(comparisonId: string): Promise<ComparisonReportV1> {
    const comparison = this.store.getComparison(comparisonId);
    if (!comparison) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        `Comparison not found: ${comparisonId}`,
      );
    }
    return comparison;
  }
}
