import { describe, it, expect } from 'vitest';
import {
  CORRECTIVE_SCHEMA_VERSION,
  CORRECTIVE_ERROR_CODES,
  POP_FEATURE_COUNT_V1,
  POP_FEATURE_SCHEMA_VERSION,
  MIN_GATE_THRESHOLD,
  MAX_GATE_THRESHOLD,
  MIN_SIZING_EXPONENT,
  MAX_SIZING_EXPONENT,
  MIN_CANDIDATES_FOR_TRAINING,
  MIN_POSITIVE_CLASS_SUPPORT,
  MIN_NEGATIVE_CLASS_SUPPORT,
  DEFAULT_CORRECTIVE_CONFIG,
  CorrectiveError,
  type CandidateSnapshotV1,
  type OutcomeRecordV1,
  type CorrectiveConfigV1,
  type CorrectiveState,
  type PopArtifactManifestV1,
} from '../index.js';

import {
  validateConfig,
  validateStateTransition,
  validateCandidate,
  validateOutcome,
  validateDatasetReadiness,
  validateArtifactManifest,
} from '../validation.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeValidCandidate(): CandidateSnapshotV1 {
  return {
    schemaVersion: CORRECTIVE_SCHEMA_VERSION,
    runId: 'run_001',
    candidateId: '42',
    strategyArtifactId: 'strat_001',
    modelArtifactId: null,
    asOfTimestampNs: '1700000000000000000',
    knowledgeCutoffTimestampNs: '1700000000000000000',
    symbolId: 'EURUSD',
    side: 'long',
    proposedSize: 1.0,
    finalSize: 1.0,
    sizeUnit: 'lots',
    featureVector: new Array(POP_FEATURE_COUNT_V1).fill(0.5),
    featureSchemaHash: 'abcd1234',
    featureSchemaVersion: POP_FEATURE_SCHEMA_VERSION,
    gateVerdict: 'disabled',
    calibratedProbability: null,
    sizingPolicyId: null,
    reasonCode: 'pop_disabled',
  };
}

function makeValidOutcome(): OutcomeRecordV1 {
  return {
    schemaVersion: CORRECTIVE_SCHEMA_VERSION,
    runId: 'run_001',
    candidateId: '42',
    outcomeType: 'actual',
    entryTimestampNs: '1700000000000000000',
    exitTimestampNs: '1700001000000000000',
    holdingIntervalBars: 10,
    grossPnl: 100.0,
    commission: 5.0,
    slippage: 2.0,
    netPnl: 93.0,
    completionStatus: 'complete',
    labelPolicyVersion: 1,
    profitLabel: true,
  };
}

function makeValidManifest(): PopArtifactManifestV1 {
  return {
    schemaVersion: CORRECTIVE_SCHEMA_VERSION,
    artifactId: 'art_001',
    modelFormat: 'onnx',
    modelFilename: 'model.onnx',
    calibrationParams: {
      method: 'isotonic',
      fittedOn: 'validation_only',
      parameters: {},
    },
    featureManifest: [],
    featureSchemaHash: 'abcd1234',
    featureSchemaVersion: POP_FEATURE_SCHEMA_VERSION,
    schemaVersionStr: '1.0.0',
    trainerVersion: '0.1.0',
    labelPolicyVersion: 1,
    sizingPolicyVersion: 1,
    trainingWindow: {
      startTimestampNs: '1600000000000000000',
      endTimestampNs: '1700000000000000000',
      barCount: 5000,
      candidateCount: 300,
    },
    validationWindow: {
      startTimestampNs: '1700000000000000000',
      endTimestampNs: '1700100000000000000',
      barCount: 1000,
      candidateCount: 100,
    },
    metrics: {
      brierScore: 0.2,
      logLoss: 0.5,
      rocAuc: 0.65,
      prAuc: 0.6,
      calibrationError: 0.05,
      coverage: 0.95,
      netReturnAfterCosts: 0.03,
      sharpe: 1.2,
      maxDrawdown: -0.1,
      hitRate: 0.55,
      turnover: 0.3,
      actualShadowSensitivity: {
        actualCount: 200,
        shadowCount: 100,
        censoredCount: 5,
        metricsActualOnly: { brierScore: 0.19, rocAuc: 0.66, hitRate: 0.56 },
        metricsShadowOnly: { brierScore: 0.22, rocAuc: 0.63, hitRate: 0.53 },
      },
      binnedReliability: [
        { binLower: 0, binUpper: 0.5, meanPredicted: 0.3, meanObserved: 0.32, count: 150 },
        { binLower: 0.5, binUpper: 1.0, meanPredicted: 0.7, meanObserved: 0.68, count: 150 },
      ],
      bootstrapIntervals: {
        nSamples: 1000,
        blockSize: 10,
        brierScoreCi95: [0.18, 0.22],
        rocAucCi95: [0.60, 0.70],
        sharpeCi95: [0.8, 1.6],
        hitRateCi95: [0.50, 0.60],
      },
    },
    minimumSampleEvidence: {
      totalCandidates: 300,
      positiveSupport: 160,
      negativeSupport: 140,
      calibrationBinMinSupport: 15,
      foldViability: 5,
      bindingReason: 'all minimums met',
    },
    goldenVector: {
      inputFeatures: new Array(POP_FEATURE_COUNT_V1).fill(0.5),
      expectedProbability: 0.6,
      expectedVerdict: 'pass',
      tolerance: 1e-6,
    },
    contentHash: 'sha256_abc123',
    createdAt: '2026-08-04T00:00:00Z',
  };
}

// -----------------------------------------------------------------------
// Config validation
// -----------------------------------------------------------------------

describe('validateConfig', () => {
  it('accepts valid default config', () => {
    expect(() => validateConfig(DEFAULT_CORRECTIVE_CONFIG)).not.toThrow();
  });

  it('accepts enabled config with artifact', () => {
    const cfg: CorrectiveConfigV1 = {
      ...DEFAULT_CORRECTIVE_CONFIG,
      state: 'enabled',
      modelArtifactId: 'art_001',
    };
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it('rejects enabled state without artifact', () => {
    const cfg: CorrectiveConfigV1 = {
      ...DEFAULT_CORRECTIVE_CONFIG,
      state: 'enabled',
      modelArtifactId: null,
    };
    expect(() => validateConfig(cfg)).toThrow(CorrectiveError);
    try { validateConfig(cfg); } catch (e) {
      expect((e as CorrectiveError).code).toBe(
        CORRECTIVE_ERROR_CODES.CONFIG_ARTIFACT_REQUIRED_FOR_ENABLED,
      );
    }
  });

  it('rejects threshold below minimum', () => {
    const cfg: CorrectiveConfigV1 = {
      ...DEFAULT_CORRECTIVE_CONFIG,
      threshold: -0.1,
    };
    expect(() => validateConfig(cfg)).toThrow(CorrectiveError);
  });

  it('rejects threshold above maximum', () => {
    const cfg: CorrectiveConfigV1 = {
      ...DEFAULT_CORRECTIVE_CONFIG,
      threshold: 1.1,
    };
    expect(() => validateConfig(cfg)).toThrow(CorrectiveError);
  });

  it('rejects NaN threshold', () => {
    const cfg: CorrectiveConfigV1 = {
      ...DEFAULT_CORRECTIVE_CONFIG,
      threshold: NaN,
    };
    expect(() => validateConfig(cfg)).toThrow(CorrectiveError);
  });

  it('rejects Infinity threshold', () => {
    const cfg: CorrectiveConfigV1 = {
      ...DEFAULT_CORRECTIVE_CONFIG,
      threshold: Infinity,
    };
    expect(() => validateConfig(cfg)).toThrow(CorrectiveError);
  });

  it('rejects sizing exponent below minimum', () => {
    const cfg: CorrectiveConfigV1 = {
      ...DEFAULT_CORRECTIVE_CONFIG,
      sizingExponent: 0.05,
    };
    expect(() => validateConfig(cfg)).toThrow(CorrectiveError);
  });

  it('rejects sizing exponent above maximum', () => {
    const cfg: CorrectiveConfigV1 = {
      ...DEFAULT_CORRECTIVE_CONFIG,
      sizingExponent: 10.0,
    };
    expect(() => validateConfig(cfg)).toThrow(CorrectiveError);
  });

  it('rejects unknown provider', () => {
    const cfg = {
      ...DEFAULT_CORRECTIVE_CONFIG,
      provider: 'unknown_provider' as 'builtin_gbdt',
    };
    expect(() => validateConfig(cfg)).toThrow(CorrectiveError);
    try { validateConfig(cfg); } catch (e) {
      expect((e as CorrectiveError).code).toBe(
        CORRECTIVE_ERROR_CODES.CONFIG_UNKNOWN_PROVIDER,
      );
    }
  });

  it('rejects unknown sizing policy', () => {
    const cfg = {
      ...DEFAULT_CORRECTIVE_CONFIG,
      sizingPolicyId: 'unknown' as any,
    };
    expect(() => validateConfig(cfg)).toThrow(CorrectiveError);
    try { validateConfig(cfg); } catch (e) {
      expect((e as CorrectiveError).code).toBe(
        CORRECTIVE_ERROR_CODES.CONFIG_UNKNOWN_SIZING_POLICY,
      );
    }
  });

  it('rejects wrong schema version', () => {
    const cfg = { ...DEFAULT_CORRECTIVE_CONFIG, schemaVersion: 99 as 1 };
    expect(() => validateConfig(cfg)).toThrow(CorrectiveError);
  });

  it('rejects unknown state', () => {
    const cfg = { ...DEFAULT_CORRECTIVE_CONFIG, state: 'bogus' as any };
    expect(() => validateConfig(cfg)).toThrow(CorrectiveError);
  });

  it('accepts collect_only without artifact', () => {
    const cfg: CorrectiveConfigV1 = {
      ...DEFAULT_CORRECTIVE_CONFIG,
      state: 'collect_only',
      modelArtifactId: null,
    };
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it('accepts boundary threshold values', () => {
    for (const t of [0.0, 0.5, 1.0]) {
      const cfg: CorrectiveConfigV1 = { ...DEFAULT_CORRECTIVE_CONFIG, threshold: t };
      expect(() => validateConfig(cfg)).not.toThrow();
    }
  });
});

// -----------------------------------------------------------------------
// State transition validation
// -----------------------------------------------------------------------

describe('validateStateTransition', () => {
  it('allows same-state no-op', () => {
    for (const s of ['disabled', 'collect_only', 'enabled'] as const) {
      expect(() => validateStateTransition(s, s)).not.toThrow();
    }
  });

  it('allows all valid transitions', () => {
    const states: CorrectiveState[] = ['disabled', 'collect_only', 'enabled'];
    for (const from of states) {
      for (const to of states) {
        expect(() => validateStateTransition(from, to)).not.toThrow();
      }
    }
  });

  it('rejects invalid transition for unknown states (TypeError from map access)', () => {
    expect(() =>
      validateStateTransition('bogus' as CorrectiveState, 'disabled'),
    ).toThrow(TypeError);
  });
});

// -----------------------------------------------------------------------
// Candidate validation
// -----------------------------------------------------------------------

describe('validateCandidate', () => {
  it('accepts valid candidate', () => {
    expect(() => validateCandidate(makeValidCandidate())).not.toThrow();
  });

  it('rejects wrong schema version', () => {
    const c = { ...makeValidCandidate(), schemaVersion: 99 as 1 };
    expect(() => validateCandidate(c)).toThrow(CorrectiveError);
  });

  it('rejects empty runId', () => {
    const c = { ...makeValidCandidate(), runId: '' };
    expect(() => validateCandidate(c)).toThrow(CorrectiveError);
  });

  it('rejects empty candidateId', () => {
    const c = { ...makeValidCandidate(), candidateId: '' };
    expect(() => validateCandidate(c)).toThrow(CorrectiveError);
  });

  it('rejects wrong feature count', () => {
    const c = { ...makeValidCandidate(), featureVector: [1, 2, 3] };
    expect(() => validateCandidate(c)).toThrow(CorrectiveError);
    try { validateCandidate(c); } catch (e) {
      expect((e as CorrectiveError).code).toBe(
        CORRECTIVE_ERROR_CODES.INFERENCE_FEATURE_COUNT_MISMATCH,
      );
    }
  });

  it('rejects NaN in feature vector', () => {
    const fv = new Array(POP_FEATURE_COUNT_V1).fill(0.5);
    fv[3] = NaN;
    const c = { ...makeValidCandidate(), featureVector: fv };
    expect(() => validateCandidate(c)).toThrow(CorrectiveError);
    try { validateCandidate(c); } catch (e) {
      expect((e as CorrectiveError).code).toBe(
        CORRECTIVE_ERROR_CODES.DATASET_NON_FINITE_FEATURE,
      );
    }
  });

  it('rejects Infinity in feature vector', () => {
    const fv = new Array(POP_FEATURE_COUNT_V1).fill(0.5);
    fv[7] = Infinity;
    const c = { ...makeValidCandidate(), featureVector: fv };
    expect(() => validateCandidate(c)).toThrow(CorrectiveError);
  });

  it('rejects negative proposed size', () => {
    const c = { ...makeValidCandidate(), proposedSize: -1.0 };
    expect(() => validateCandidate(c)).toThrow(CorrectiveError);
  });

  it('rejects final size exceeding proposed size', () => {
    const c = { ...makeValidCandidate(), proposedSize: 1.0, finalSize: 2.0 };
    expect(() => validateCandidate(c)).toThrow(CorrectiveError);
  });

  it('rejects negative final size', () => {
    const c = { ...makeValidCandidate(), finalSize: -0.5 };
    expect(() => validateCandidate(c)).toThrow(CorrectiveError);
  });

  it('rejects NaN final size', () => {
    const c = { ...makeValidCandidate(), finalSize: NaN };
    expect(() => validateCandidate(c)).toThrow(CorrectiveError);
  });

  it('rejects NaN proposed size', () => {
    const c = { ...makeValidCandidate(), proposedSize: NaN };
    expect(() => validateCandidate(c)).toThrow(CorrectiveError);
  });

  it('accepts zero final size (gated)', () => {
    const c = { ...makeValidCandidate(), proposedSize: 1.0, finalSize: 0.0 };
    expect(() => validateCandidate(c)).not.toThrow();
  });
});

// -----------------------------------------------------------------------
// Outcome validation
// -----------------------------------------------------------------------

describe('validateOutcome', () => {
  it('accepts valid outcome', () => {
    expect(() => validateOutcome(makeValidOutcome())).not.toThrow();
  });

  it('rejects wrong schema version', () => {
    const o = { ...makeValidOutcome(), schemaVersion: 99 as 1 };
    expect(() => validateOutcome(o)).toThrow(CorrectiveError);
  });

  it('rejects empty runId', () => {
    const o = { ...makeValidOutcome(), runId: '' };
    expect(() => validateOutcome(o)).toThrow(CorrectiveError);
  });

  it('rejects complete outcome without profit label', () => {
    const o = { ...makeValidOutcome(), profitLabel: null };
    expect(() => validateOutcome(o)).toThrow(CorrectiveError);
  });

  it('rejects non-finite grossPnl on complete outcome', () => {
    const o = { ...makeValidOutcome(), grossPnl: NaN };
    expect(() => validateOutcome(o)).toThrow(CorrectiveError);
  });

  it('rejects non-finite commission on complete outcome', () => {
    const o = { ...makeValidOutcome(), commission: Infinity };
    expect(() => validateOutcome(o)).toThrow(CorrectiveError);
  });

  it('rejects non-finite slippage on complete outcome', () => {
    const o = { ...makeValidOutcome(), slippage: -Infinity };
    expect(() => validateOutcome(o)).toThrow(CorrectiveError);
  });

  it('rejects non-finite netPnl on complete outcome', () => {
    const o = { ...makeValidOutcome(), netPnl: NaN };
    expect(() => validateOutcome(o)).toThrow(CorrectiveError);
  });

  it('accepts censored outcome with null profitLabel', () => {
    const o: OutcomeRecordV1 = {
      ...makeValidOutcome(),
      outcomeType: 'censored',
      completionStatus: 'censored',
      profitLabel: null,
    };
    expect(() => validateOutcome(o)).not.toThrow();
  });

  it('accepts shadow outcome', () => {
    const o: OutcomeRecordV1 = { ...makeValidOutcome(), outcomeType: 'shadow' };
    expect(() => validateOutcome(o)).not.toThrow();
  });

  it('rejects unknown outcome type', () => {
    const o = { ...makeValidOutcome(), outcomeType: 'bogus' as any };
    expect(() => validateOutcome(o)).toThrow(CorrectiveError);
  });
});

// -----------------------------------------------------------------------
// Dataset readiness validation
// -----------------------------------------------------------------------

describe('validateDatasetReadiness', () => {
  it('returns valid for sufficient dataset', () => {
    const r = validateDatasetReadiness(300, 300, 0, 0, 160, 140, 5);
    expect(r.valid).toBe(true);
    expect(r.bindingConstraint).toBeNull();
  });

  it('returns invalid for orphan candidates', () => {
    const r = validateDatasetReadiness(300, 295, 5, 0, 160, 140, 0);
    expect(r.valid).toBe(false);
    expect(r.bindingConstraint).toContain('orphan');
  });

  it('returns invalid for duplicate outcomes', () => {
    const r = validateDatasetReadiness(300, 303, 0, 3, 160, 140, 0);
    expect(r.valid).toBe(false);
    expect(r.bindingConstraint).toContain('duplicate');
  });

  it('returns invalid for insufficient total candidates', () => {
    const r = validateDatasetReadiness(50, 50, 0, 0, 30, 20, 0);
    expect(r.valid).toBe(false);
    expect(r.bindingConstraint).toContain('candidates');
  });

  it('returns invalid for insufficient positive support', () => {
    const r = validateDatasetReadiness(300, 300, 0, 0, 10, 290, 0);
    expect(r.valid).toBe(false);
    expect(r.bindingConstraint).toContain('positive');
  });

  it('returns invalid for insufficient negative support', () => {
    const r = validateDatasetReadiness(300, 300, 0, 0, 280, 10, 0);
    expect(r.valid).toBe(false);
    expect(r.bindingConstraint).toContain('negative');
  });

  it('reports first binding constraint', () => {
    const r = validateDatasetReadiness(50, 48, 2, 1, 5, 3, 0);
    expect(r.valid).toBe(false);
    expect(r.bindingConstraint).not.toBeNull();
  });

  it('tracks censored count', () => {
    const r = validateDatasetReadiness(300, 300, 0, 0, 160, 130, 10);
    expect(r.censoredCount).toBe(10);
  });
});

// -----------------------------------------------------------------------
// Artifact manifest validation
// -----------------------------------------------------------------------

describe('validateArtifactManifest', () => {
  it('accepts valid manifest', () => {
    expect(() => validateArtifactManifest(makeValidManifest())).not.toThrow();
  });

  it('rejects wrong schema version', () => {
    const m = { ...makeValidManifest(), schemaVersion: 99 as 1 };
    expect(() => validateArtifactManifest(m)).toThrow(CorrectiveError);
    try { validateArtifactManifest(m); } catch (e) {
      expect((e as CorrectiveError).code).toBe(
        CORRECTIVE_ERROR_CODES.ARTIFACT_SCHEMA_INCOMPATIBLE,
      );
    }
  });

  it('rejects non-onnx model format', () => {
    const m = { ...makeValidManifest(), modelFormat: 'pytorch' as 'onnx' };
    expect(() => validateArtifactManifest(m)).toThrow(CorrectiveError);
  });

  it('rejects missing content hash', () => {
    const m = { ...makeValidManifest(), contentHash: '' };
    expect(() => validateArtifactManifest(m)).toThrow(CorrectiveError);
    try { validateArtifactManifest(m); } catch (e) {
      expect((e as CorrectiveError).code).toBe(
        CORRECTIVE_ERROR_CODES.ARTIFACT_HASH_MISMATCH,
      );
    }
  });

  it('rejects missing artifact ID', () => {
    const m = { ...makeValidManifest(), artifactId: '' };
    expect(() => validateArtifactManifest(m)).toThrow(CorrectiveError);
    try { validateArtifactManifest(m); } catch (e) {
      expect((e as CorrectiveError).code).toBe(
        CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND,
      );
    }
  });

  it('rejects golden vector with wrong feature count', () => {
    const m = {
      ...makeValidManifest(),
      goldenVector: {
        inputFeatures: [0.1, 0.2, 0.3],
        expectedProbability: 0.6,
        expectedVerdict: 'pass' as const,
        tolerance: 1e-6 as const,
      },
    };
    expect(() => validateArtifactManifest(m)).toThrow(CorrectiveError);
    try { validateArtifactManifest(m); } catch (e) {
      expect((e as CorrectiveError).code).toBe(
        CORRECTIVE_ERROR_CODES.ARTIFACT_FEATURE_SCHEMA_MISMATCH,
      );
    }
  });

  it('rejects golden vector with out-of-range probability', () => {
    const m = {
      ...makeValidManifest(),
      goldenVector: {
        inputFeatures: new Array(POP_FEATURE_COUNT_V1).fill(0.5),
        expectedProbability: 1.5,
        expectedVerdict: 'pass' as const,
        tolerance: 1e-6 as const,
      },
    };
    expect(() => validateArtifactManifest(m)).toThrow(CorrectiveError);
    try { validateArtifactManifest(m); } catch (e) {
      expect((e as CorrectiveError).code).toBe(
        CORRECTIVE_ERROR_CODES.ARTIFACT_GOLDEN_VECTOR_FAILED,
      );
    }
  });

  it('rejects golden vector with NaN probability', () => {
    const m = {
      ...makeValidManifest(),
      goldenVector: {
        inputFeatures: new Array(POP_FEATURE_COUNT_V1).fill(0.5),
        expectedProbability: NaN,
        expectedVerdict: 'pass' as const,
        tolerance: 1e-6 as const,
      },
    };
    expect(() => validateArtifactManifest(m)).toThrow(CorrectiveError);
  });
});
