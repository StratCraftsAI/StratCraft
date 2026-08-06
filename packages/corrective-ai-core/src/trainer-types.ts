import type {
  CandidateSide,
  GateVerdict,
  OutcomeType,
  SizingPolicyId,
  PopModelMetrics,
  CalibrationParamsV1,
  WindowBoundary,
  MinimumSampleEvidence,
  GoldenVectorV1,
  PopFeatureDescriptor,
} from './contracts.js';

import type {
  POP_FEATURE_SCHEMA_VERSION,
  CORRECTIVE_SCHEMA_VERSION,
  ARTIFACT_FORMAT_ONNX,
} from './constants.js';

export interface TrainingRow {
  readonly runId: string;
  readonly candidateId: number;
  readonly asOfTimestampNs: number;
  readonly knowledgeCutoffTimestampNs: number;
  readonly symbolId: string;
  readonly side: CandidateSide;
  readonly proposedSize: number;
  readonly finalSize: number;
  readonly featureVector: readonly number[];
  readonly featureSchemaHash: string;
  readonly gateVerdict: GateVerdict;
  readonly outcomeType: OutcomeType;
  readonly entryTimestampNs: number;
  readonly exitTimestampNs: number | null;
  readonly holdingIntervalBars: number;
  readonly netPnl: number;
  readonly completionStatus: 'complete' | 'censored';
  readonly profitLabel: boolean | null;
  readonly labelPolicyVersion: number;
}

export interface FoldSpec {
  readonly foldIndex: number;
  readonly trainIndices: readonly number[];
  readonly valIndices: readonly number[];
  readonly purgedCount: number;
  readonly embargoedCount: number;
}

export interface HoldoutSpec {
  readonly trainValIndices: readonly number[];
  readonly holdoutIndices: readonly number[];
}

export interface FoldResult {
  readonly foldIndex: number;
  readonly oofPredictions: readonly number[];
  readonly oofLabels: readonly boolean[];
  readonly oofIndices: readonly number[];
  readonly modelBytes: Uint8Array;
}

export interface WorkerFoldInput {
  readonly foldIndex: number;
  readonly trainFeatures: readonly (readonly number[])[];
  readonly trainLabels: readonly boolean[];
  readonly valFeatures: readonly (readonly number[])[];
  readonly valLabels: readonly boolean[];
}

export interface WorkerFoldOutput {
  readonly foldIndex: number;
  readonly valPredictions: readonly number[];
  readonly modelPath: string;
  readonly trainMetrics: { rocAuc: number; logLoss: number };
}

export interface CalibrationResult {
  readonly method: 'isotonic' | 'platt';
  readonly fittedOn: 'validation_only';
  readonly breakpoints: readonly CalibrationBreakpoint[];
  readonly parameters: Record<string, number>;
}

export interface CalibrationBreakpoint {
  readonly x: number;
  readonly y: number;
}

export interface ThresholdSelectionResult {
  readonly threshold: number;
  readonly criterion: 'max_net_return' | 'max_f1';
  readonly metricAtThreshold: number;
  readonly candidatesEvaluated: number;
}

export interface TrainerConfig {
  readonly nFolds: number;
  readonly purgeEmbargoBars: number;
  readonly bootstrapSamples: number;
  readonly bootstrapBlockSize: number;
  readonly trainingWindowStartNs: number | null;
  readonly trainingWindowEndNs: number | null;
  readonly holdoutFraction: number;
  readonly pythonExecutable: string;
  readonly workerScriptPath: string;
  readonly artifactOutputDir: string;
}

export const DEFAULT_HOLDOUT_FRACTION = 0.15;
export const DEFAULT_TRAINER_VERSION = '0.1.0';
