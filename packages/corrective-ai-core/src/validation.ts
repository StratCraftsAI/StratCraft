// -----------------------------------------------------------------------
// TICKET_1361 P0: Contract validation
//
// Every invariant from Section 6 and D2/D3/D4/D6/D8. Surfaces receive
// typed CorrectiveError, never a generic string.
// -----------------------------------------------------------------------

import {
  CORRECTIVE_SCHEMA_VERSION,
  CORRECTIVE_ERROR_CODES,
  CORRECTIVE_STATES,
  MIN_GATE_THRESHOLD,
  MAX_GATE_THRESHOLD,
  MIN_SIZING_EXPONENT,
  MAX_SIZING_EXPONENT,
  MIN_CANDIDATES_FOR_TRAINING,
  MIN_POSITIVE_CLASS_SUPPORT,
  MIN_NEGATIVE_CLASS_SUPPORT,
  POP_FEATURE_COUNT_V1,
  SIZING_POLICY_IDS,
  OUTCOME_TYPES,
} from './constants.js';

import {
  type CorrectiveConfigV1,
  type CandidateSnapshotV1,
  type OutcomeRecordV1,
  type PopArtifactManifestV1,
  type CorrectiveState,
  CorrectiveError,
  isValidStateTransition,
} from './contracts.js';

export function validateConfig(config: CorrectiveConfigV1): void {
  if (config.schemaVersion !== CORRECTIVE_SCHEMA_VERSION) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.CONFIG_INVALID_STATE_TRANSITION,
      `Unsupported schema version: ${config.schemaVersion}`,
    );
  }

  if (!(CORRECTIVE_STATES as readonly string[]).includes(config.state)) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.CONFIG_INVALID_STATE_TRANSITION,
      `Unknown state: ${config.state}`,
    );
  }

  if (config.provider !== 'builtin_gbdt') {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.CONFIG_UNKNOWN_PROVIDER,
      `Unknown provider: ${config.provider}`,
    );
  }

  if (
    config.threshold < MIN_GATE_THRESHOLD ||
    config.threshold > MAX_GATE_THRESHOLD ||
    !Number.isFinite(config.threshold)
  ) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.CONFIG_THRESHOLD_OUT_OF_RANGE,
      `Threshold ${config.threshold} outside [${MIN_GATE_THRESHOLD}, ${MAX_GATE_THRESHOLD}]`,
    );
  }

  if (
    config.sizingExponent < MIN_SIZING_EXPONENT ||
    config.sizingExponent > MAX_SIZING_EXPONENT ||
    !Number.isFinite(config.sizingExponent)
  ) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.CONFIG_THRESHOLD_OUT_OF_RANGE,
      `Sizing exponent ${config.sizingExponent} outside [${MIN_SIZING_EXPONENT}, ${MAX_SIZING_EXPONENT}]`,
    );
  }

  if (!(SIZING_POLICY_IDS as readonly string[]).includes(config.sizingPolicyId)) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.CONFIG_UNKNOWN_SIZING_POLICY,
      `Unknown sizing policy: ${config.sizingPolicyId}`,
    );
  }

  if (config.state === 'enabled' && config.modelArtifactId === null) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.CONFIG_ARTIFACT_REQUIRED_FOR_ENABLED,
      'Enabled state requires a published model artifact',
    );
  }
}

export function validateStateTransition(
  from: CorrectiveState,
  to: CorrectiveState,
): void {
  if (from === to) return;
  if (!isValidStateTransition(from, to)) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.CONFIG_INVALID_STATE_TRANSITION,
      `Invalid state transition: ${from} -> ${to}`,
    );
  }
}

export function validateCandidate(candidate: CandidateSnapshotV1): void {
  if (candidate.schemaVersion !== CORRECTIVE_SCHEMA_VERSION) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.DATASET_SCHEMA_VERSION_MISMATCH,
      `Candidate schema version ${candidate.schemaVersion} != ${CORRECTIVE_SCHEMA_VERSION}`,
    );
  }

  if (!candidate.runId || !candidate.candidateId) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.DATASET_ORPHAN_CANDIDATE,
      'Candidate missing run_id or candidate_id',
    );
  }

  if (candidate.featureVector.length !== POP_FEATURE_COUNT_V1) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.INFERENCE_FEATURE_COUNT_MISMATCH,
      `Feature vector length ${candidate.featureVector.length} != ${POP_FEATURE_COUNT_V1}`,
    );
  }

  for (let i = 0; i < candidate.featureVector.length; i++) {
    if (!Number.isFinite(candidate.featureVector[i])) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.DATASET_NON_FINITE_FEATURE,
        `Non-finite feature at index ${i}: ${candidate.featureVector[i]}`,
      );
    }
  }

  if (!Number.isFinite(candidate.proposedSize) || candidate.proposedSize < 0) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.INFERENCE_NON_FINITE_INPUT,
      `Invalid proposed size: ${candidate.proposedSize}`,
    );
  }

  if (!Number.isFinite(candidate.finalSize) || candidate.finalSize < 0) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.INFERENCE_NON_FINITE_INPUT,
      `Invalid final size: ${candidate.finalSize}`,
    );
  }

  if (candidate.finalSize > candidate.proposedSize) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.INFERENCE_NON_FINITE_INPUT,
      `Final size ${candidate.finalSize} exceeds proposed size ${candidate.proposedSize}`,
    );
  }
}

export function validateOutcome(outcome: OutcomeRecordV1): void {
  if (outcome.schemaVersion !== CORRECTIVE_SCHEMA_VERSION) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.DATASET_SCHEMA_VERSION_MISMATCH,
      `Outcome schema version ${outcome.schemaVersion} != ${CORRECTIVE_SCHEMA_VERSION}`,
    );
  }

  if (!outcome.runId || !outcome.candidateId) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.DATASET_ORPHAN_CANDIDATE,
      'Outcome missing run_id or candidate_id',
    );
  }

  if (!(OUTCOME_TYPES as readonly string[]).includes(outcome.outcomeType)) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.DATASET_SCHEMA_VERSION_MISMATCH,
      `Unknown outcome type: ${outcome.outcomeType}`,
    );
  }

  if (outcome.completionStatus === 'complete') {
    if (outcome.profitLabel === null) {
      throw new CorrectiveError(
        CORRECTIVE_ERROR_CODES.DATASET_ORPHAN_CANDIDATE,
        'Complete outcome must have a profit label',
      );
    }
    for (const field of ['grossPnl', 'commission', 'slippage', 'netPnl'] as const) {
      if (!Number.isFinite(outcome[field])) {
        throw new CorrectiveError(
          CORRECTIVE_ERROR_CODES.DATASET_NON_FINITE_FEATURE,
          `Non-finite ${field}: ${outcome[field]}`,
        );
      }
    }
  }
}

export interface DatasetValidationResult {
  readonly valid: boolean;
  readonly totalCandidates: number;
  readonly totalOutcomes: number;
  readonly orphanCandidates: number;
  readonly duplicateOutcomes: number;
  readonly positiveSupport: number;
  readonly negativeSupport: number;
  readonly censoredCount: number;
  readonly bindingConstraint: string | null;
}

export function validateDatasetReadiness(
  candidateCount: number,
  outcomeCount: number,
  orphanCount: number,
  duplicateCount: number,
  positiveSupport: number,
  negativeSupport: number,
  censoredCount: number,
): DatasetValidationResult {
  const errors: string[] = [];

  if (orphanCount > 0) errors.push(`${orphanCount} orphan candidates`);
  if (duplicateCount > 0) errors.push(`${duplicateCount} duplicate outcomes`);
  if (candidateCount < MIN_CANDIDATES_FOR_TRAINING) {
    errors.push(`${candidateCount} candidates < ${MIN_CANDIDATES_FOR_TRAINING} minimum`);
  }
  if (positiveSupport < MIN_POSITIVE_CLASS_SUPPORT) {
    errors.push(`${positiveSupport} positive < ${MIN_POSITIVE_CLASS_SUPPORT} minimum`);
  }
  if (negativeSupport < MIN_NEGATIVE_CLASS_SUPPORT) {
    errors.push(`${negativeSupport} negative < ${MIN_NEGATIVE_CLASS_SUPPORT} minimum`);
  }

  return {
    valid: errors.length === 0,
    totalCandidates: candidateCount,
    totalOutcomes: outcomeCount,
    orphanCandidates: orphanCount,
    duplicateOutcomes: duplicateCount,
    positiveSupport,
    negativeSupport,
    censoredCount,
    bindingConstraint: errors.length > 0 ? errors[0] : null,
  };
}

export function validateArtifactManifest(manifest: PopArtifactManifestV1): void {
  if (manifest.schemaVersion !== CORRECTIVE_SCHEMA_VERSION) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.ARTIFACT_SCHEMA_INCOMPATIBLE,
      `Artifact schema version ${manifest.schemaVersion} != ${CORRECTIVE_SCHEMA_VERSION}`,
    );
  }

  if (manifest.modelFormat !== 'onnx') {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.ARTIFACT_SCHEMA_INCOMPATIBLE,
      `Unsupported model format: ${manifest.modelFormat}`,
    );
  }

  if (!manifest.contentHash) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.ARTIFACT_HASH_MISMATCH,
      'Artifact missing content hash',
    );
  }

  if (!manifest.artifactId) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND,
      'Artifact missing ID',
    );
  }

  const gv = manifest.goldenVector;
  if (gv.inputFeatures.length !== POP_FEATURE_COUNT_V1) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.ARTIFACT_FEATURE_SCHEMA_MISMATCH,
      `Golden vector feature count ${gv.inputFeatures.length} != ${POP_FEATURE_COUNT_V1}`,
    );
  }

  if (!Number.isFinite(gv.expectedProbability) || gv.expectedProbability < 0 || gv.expectedProbability > 1) {
    throw new CorrectiveError(
      CORRECTIVE_ERROR_CODES.ARTIFACT_GOLDEN_VECTOR_FAILED,
      `Golden vector expected probability out of range: ${gv.expectedProbability}`,
    );
  }
}

export function computeFeatureSchemaHash(featureNames: readonly string[]): string {
  let hash = 0x811c9dc5;
  const joined = featureNames.join('\0');
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
