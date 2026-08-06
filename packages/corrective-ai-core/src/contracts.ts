// -----------------------------------------------------------------------
// TICKET_1361 P0: Versioned Corrective Layer contracts
//
// This file is the SINGLE SOURCE OF TRUTH for candidate, outcome, feature,
// artifact, configuration, and error contracts. The C++ header
// (corrective_contracts.hpp) and training-worker schema are generated from
// or validated against these definitions.
//
// Identity: composite (run_id, candidate_id). candidate_id is a monotonic
// uint64 within run_id. Never used as a cross-run key.
// -----------------------------------------------------------------------

import {
  CORRECTIVE_SCHEMA_VERSION,
  CORRECTIVE_STATES,
  CORRECTIVE_ERROR_CODES,
  DEFAULT_GATE_THRESHOLD,
  DEFAULT_N_WALK_FORWARD_FOLDS,
  DEFAULT_BOOTSTRAP_SAMPLES,
  DEFAULT_BOOTSTRAP_BLOCK_SIZE,
  DEFAULT_SIZING_EXPONENT,
  GOLDEN_VECTOR_TOLERANCE,
  MIN_GATE_THRESHOLD,
  MAX_GATE_THRESHOLD,
  MIN_SIZING_EXPONENT,
  MAX_SIZING_EXPONENT,
  MIN_WALK_FORWARD_FOLDS,
  MAX_WALK_FORWARD_FOLDS,
  OUTCOME_TYPES,
  POP_FEATURE_COUNT_V1,
  POP_FEATURE_SCHEMA_VERSION,
  SIZING_POLICY_IDS,
  TRAINING_JOB_STATES,
  ARTIFACT_FORMAT_ONNX,
  type CorrectiveErrorCode,
} from './constants.js';

// -----------------------------------------------------------------------
// 1. Enums and union types
// -----------------------------------------------------------------------

export type CorrectiveState = (typeof CORRECTIVE_STATES)[number];

export type SizingPolicyId = (typeof SIZING_POLICY_IDS)[number];

export type OutcomeType = (typeof OUTCOME_TYPES)[number];

export type TrainingJobState = (typeof TRAINING_JOB_STATES)[number];

export type CandidateSide = 'long' | 'short';

export type GateVerdict = 'pass' | 'reject' | 'collect_only' | 'disabled';

// -----------------------------------------------------------------------
// 2. Point-in-time feature contract (D4)
// -----------------------------------------------------------------------

export interface PopFeatureDescriptor {
  readonly index: number;
  readonly name: string;
  readonly owner: string;
  readonly unit: string;
  readonly missingRule: 'zero' | 'nan_reject';
  readonly knowledgeTime: 'at_decision' | 'before_decision';
  readonly calculationVersion: number;
}

export const POP_FEATURE_SCHEMA_V1: readonly PopFeatureDescriptor[] = [
  { index: 0, name: 'proposed_size_normalized', owner: 'strategy', unit: 'ratio', missingRule: 'nan_reject', knowledgeTime: 'at_decision', calculationVersion: 1 },
  { index: 1, name: 'entry_price', owner: 'broker', unit: 'price', missingRule: 'nan_reject', knowledgeTime: 'at_decision', calculationVersion: 1 },
  { index: 2, name: 'bid_ask_spread_bps', owner: 'feed', unit: 'bps', missingRule: 'zero', knowledgeTime: 'at_decision', calculationVersion: 1 },
  { index: 3, name: 'atr_ratio', owner: 'indicator', unit: 'ratio', missingRule: 'nan_reject', knowledgeTime: 'before_decision', calculationVersion: 1 },
  { index: 4, name: 'volatility_z', owner: 'indicator', unit: 'z_score', missingRule: 'nan_reject', knowledgeTime: 'before_decision', calculationVersion: 1 },
  { index: 5, name: 'rsi_14', owner: 'indicator', unit: 'unitless_0_100', missingRule: 'nan_reject', knowledgeTime: 'before_decision', calculationVersion: 1 },
  { index: 6, name: 'bb_percent_b', owner: 'indicator', unit: 'ratio', missingRule: 'nan_reject', knowledgeTime: 'before_decision', calculationVersion: 1 },
  { index: 7, name: 'macd_histogram', owner: 'indicator', unit: 'price_diff', missingRule: 'nan_reject', knowledgeTime: 'before_decision', calculationVersion: 1 },
  { index: 8, name: 'volume_ratio', owner: 'feed', unit: 'ratio', missingRule: 'zero', knowledgeTime: 'before_decision', calculationVersion: 1 },
  { index: 9, name: 'unrealized_pnl_normalized', owner: 'broker', unit: 'ratio', missingRule: 'zero', knowledgeTime: 'at_decision', calculationVersion: 1 },
  { index: 10, name: 'open_position_count', owner: 'broker', unit: 'count', missingRule: 'zero', knowledgeTime: 'at_decision', calculationVersion: 1 },
  { index: 11, name: 'bars_since_last_trade', owner: 'strategy', unit: 'count', missingRule: 'zero', knowledgeTime: 'at_decision', calculationVersion: 1 },
  { index: 12, name: 'current_drawdown_pct', owner: 'broker', unit: 'percent', missingRule: 'zero', knowledgeTime: 'at_decision', calculationVersion: 1 },
  { index: 13, name: 'side_encoded', owner: 'strategy', unit: 'signed_unit', missingRule: 'nan_reject', knowledgeTime: 'at_decision', calculationVersion: 1 },
] as const;

// -----------------------------------------------------------------------
// 3. Candidate snapshot contract (D2)
// -----------------------------------------------------------------------

export interface CandidateSnapshotV1 {
  readonly schemaVersion: typeof CORRECTIVE_SCHEMA_VERSION;
  readonly runId: string;
  readonly candidateId: string;
  readonly strategyArtifactId: string;
  readonly modelArtifactId: string | null;
  readonly asOfTimestampNs: string;
  readonly knowledgeCutoffTimestampNs: string;
  readonly symbolId: string;
  readonly side: CandidateSide;
  readonly proposedSize: number;
  readonly finalSize: number;
  readonly sizeUnit: string;
  readonly featureVector: readonly number[];
  readonly featureSchemaHash: string;
  readonly featureSchemaVersion: typeof POP_FEATURE_SCHEMA_VERSION;
  readonly gateVerdict: GateVerdict;
  readonly calibratedProbability: number | null;
  readonly sizingPolicyId: SizingPolicyId | null;
  readonly reasonCode: string;
}

// -----------------------------------------------------------------------
// 4. Outcome record contract (D3)
// -----------------------------------------------------------------------

export interface OutcomeRecordV1 {
  readonly schemaVersion: typeof CORRECTIVE_SCHEMA_VERSION;
  readonly runId: string;
  readonly candidateId: string;
  readonly outcomeType: OutcomeType;
  readonly entryTimestampNs: string;
  readonly exitTimestampNs: string | null;
  readonly holdingIntervalBars: number;
  readonly grossPnl: number;
  readonly commission: number;
  readonly slippage: number;
  readonly netPnl: number;
  readonly completionStatus: 'complete' | 'censored';
  readonly labelPolicyVersion: number;
  readonly profitLabel: boolean | null;
}

// -----------------------------------------------------------------------
// 5. Configuration contract (Section 6)
// -----------------------------------------------------------------------

export interface CorrectiveConfigV1 {
  readonly schemaVersion: typeof CORRECTIVE_SCHEMA_VERSION;
  readonly state: CorrectiveState;
  readonly provider: 'builtin_gbdt';
  readonly mode: SizingPolicyId;
  readonly threshold: number;
  readonly sizingExponent: number;
  readonly sizingPolicyId: SizingPolicyId;
  readonly modelArtifactId: string | null;
}

export const DEFAULT_CORRECTIVE_CONFIG: CorrectiveConfigV1 = {
  schemaVersion: CORRECTIVE_SCHEMA_VERSION,
  state: 'disabled',
  provider: 'builtin_gbdt',
  mode: 'gate',
  threshold: DEFAULT_GATE_THRESHOLD,
  sizingExponent: DEFAULT_SIZING_EXPONENT,
  sizingPolicyId: 'gate',
  modelArtifactId: null,
};

// -----------------------------------------------------------------------
// 6. Immutable artifact manifest contract (D6)
// -----------------------------------------------------------------------

export interface PopArtifactManifestV1 {
  readonly schemaVersion: typeof CORRECTIVE_SCHEMA_VERSION;
  readonly artifactId: string;
  readonly modelFormat: typeof ARTIFACT_FORMAT_ONNX;
  readonly modelFilename: string;
  readonly calibrationParams: CalibrationParamsV1;
  readonly featureManifest: readonly PopFeatureDescriptor[];
  readonly featureSchemaHash: string;
  readonly featureSchemaVersion: typeof POP_FEATURE_SCHEMA_VERSION;
  readonly schemaVersionStr: string;
  readonly trainerVersion: string;
  readonly labelPolicyVersion: number;
  readonly sizingPolicyVersion: number;
  readonly trainingWindow: WindowBoundary;
  readonly validationWindow: WindowBoundary;
  readonly metrics: PopModelMetrics;
  readonly minimumSampleEvidence: MinimumSampleEvidence;
  readonly goldenVector: GoldenVectorV1;
  readonly contentHash: string;
  readonly createdAt: string;
}

export interface CalibrationParamsV1 {
  readonly method: 'isotonic' | 'platt';
  readonly fittedOn: 'validation_only';
  readonly parameters: Record<string, number>;
}

export interface WindowBoundary {
  readonly startTimestampNs: string;
  readonly endTimestampNs: string;
  readonly barCount: number;
  readonly candidateCount: number;
}

export interface PopModelMetrics {
  readonly brierScore: number;
  readonly logLoss: number;
  readonly rocAuc: number;
  readonly prAuc: number;
  readonly calibrationError: number;
  readonly coverage: number;
  readonly netReturnAfterCosts: number;
  readonly sharpe: number;
  readonly maxDrawdown: number;
  readonly hitRate: number;
  readonly turnover: number;
  readonly actualShadowSensitivity: ActualShadowSensitivity;
  readonly binnedReliability: readonly ReliabilityBin[];
  readonly bootstrapIntervals: BootstrapIntervals;
}

export interface ActualShadowSensitivity {
  readonly actualCount: number;
  readonly shadowCount: number;
  readonly censoredCount: number;
  readonly metricsActualOnly: Pick<PopModelMetrics, 'brierScore' | 'rocAuc' | 'hitRate'>;
  readonly metricsShadowOnly: Pick<PopModelMetrics, 'brierScore' | 'rocAuc' | 'hitRate'>;
}

export interface ReliabilityBin {
  readonly binLower: number;
  readonly binUpper: number;
  readonly meanPredicted: number;
  readonly meanObserved: number;
  readonly count: number;
}

export interface BootstrapIntervals {
  readonly nSamples: number;
  readonly blockSize: number;
  readonly brierScoreCi95: [number, number];
  readonly rocAucCi95: [number, number];
  readonly sharpeCi95: [number, number];
  readonly hitRateCi95: [number, number];
}

export interface GoldenVectorV1 {
  readonly inputFeatures: readonly number[];
  readonly expectedProbability: number;
  readonly expectedVerdict: GateVerdict;
  readonly tolerance: typeof GOLDEN_VECTOR_TOLERANCE;
}

export interface MinimumSampleEvidence {
  readonly totalCandidates: number;
  readonly positiveSupport: number;
  readonly negativeSupport: number;
  readonly calibrationBinMinSupport: number;
  readonly foldViability: number;
  readonly bindingReason: string;
}

// -----------------------------------------------------------------------
// 7. Training job contract
// -----------------------------------------------------------------------

export interface TrainingJobV1 {
  readonly jobId: string;
  readonly state: TrainingJobState;
  readonly provider: 'builtin_gbdt';
  readonly config: TrainingConfigV1;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly artifactId: string | null;
  readonly errorCode: CorrectiveErrorCode | null;
  readonly errorMessage: string | null;
}

export interface TrainingConfigV1 {
  readonly nFolds: number;
  readonly purgeEmbargoBars: number;
  readonly bootstrapSamples: number;
  readonly bootstrapBlockSize: number;
  readonly trainingWindow: WindowBoundary | null;
}

export const DEFAULT_TRAINING_CONFIG: TrainingConfigV1 = {
  nFolds: DEFAULT_N_WALK_FORWARD_FOLDS,
  purgeEmbargoBars: 0,
  bootstrapSamples: DEFAULT_BOOTSTRAP_SAMPLES,
  bootstrapBlockSize: DEFAULT_BOOTSTRAP_BLOCK_SIZE,
  trainingWindow: null,
};

// -----------------------------------------------------------------------
// 8. Typed error contract (D8)
// -----------------------------------------------------------------------

export class CorrectiveError extends Error {
  constructor(
    public readonly code: CorrectiveErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'CorrectiveError';
  }
}

// -----------------------------------------------------------------------
// 9. Comparison report contract (Section 7)
// -----------------------------------------------------------------------

export interface ComparisonReportV1 {
  readonly comparisonId: string;
  readonly baselineRunId: string;
  readonly correctiveRunId: string;
  readonly strategyArtifactId: string;
  readonly modelArtifactId: string;
  readonly mode: SizingPolicyId;
  readonly threshold: number;
  readonly baselineMetrics: ComparisonMetrics;
  readonly correctiveMetrics: ComparisonMetrics;
  readonly holdoutMetrics: ComparisonMetrics | null;
  readonly createdAt: string;
}

export interface ComparisonMetrics {
  readonly netReturn: number;
  readonly sharpe: number;
  readonly maxDrawdown: number;
  readonly hitRate: number;
  readonly turnover: number;
  readonly tradeCount: number;
  readonly gatedCount: number;
  readonly resizedCount: number;
}

// -----------------------------------------------------------------------
// 10. Lifecycle state machine
// -----------------------------------------------------------------------

const VALID_STATE_TRANSITIONS: Record<CorrectiveState, readonly CorrectiveState[]> = {
  disabled: ['collect_only', 'enabled'],
  collect_only: ['disabled', 'enabled'],
  enabled: ['disabled', 'collect_only'],
};

export function isValidStateTransition(
  from: CorrectiveState,
  to: CorrectiveState,
): boolean {
  return VALID_STATE_TRANSITIONS[from].includes(to);
}
