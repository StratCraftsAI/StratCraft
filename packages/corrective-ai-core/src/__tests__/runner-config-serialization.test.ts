import { describe, it, expect } from 'vitest';

import type {
  CorrectiveConfigV1,
  PopArtifactManifestV1,
} from '../contracts.js';
import { CORRECTIVE_SCHEMA_VERSION, POP_FEATURE_COUNT_V1, GOLDEN_VECTOR_TOLERANCE } from '../constants.js';

/**
 * TICKET_1361 P5: Tests for the flat runner JSON serialization logic.
 *
 * The actual serializeCorrectiveRunnerConfig lives in executor-service.ts
 * (Electron layer), but its logic is pure -- these tests verify the
 * serialization contract that the C++ pop_preflight.hpp parser expects.
 *
 * We duplicate the serialization function here to keep the test in the
 * shared package where it can run without Electron dependencies.
 */

function serializeCorrectiveRunnerConfig(
  config: CorrectiveConfigV1,
  artifact: PopArtifactManifestV1 | null,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    corrective_state: config.state,
  };

  if (config.state === 'disabled') return flat;

  flat.corrective_mode = config.mode;
  flat.corrective_threshold = config.threshold;
  flat.corrective_sizing_exponent = config.sizingExponent;

  if (config.state === 'collect_only' || !artifact) return flat;

  flat.corrective_model_path = `/mock/artifacts/${artifact.modelFilename}`;
  flat.corrective_content_hash = artifact.contentHash;
  flat.corrective_feature_schema_hash = parseInt(artifact.featureSchemaHash, 16);
  flat.corrective_feature_count = artifact.featureManifest.length;

  const cal = artifact.calibrationParams;
  flat.corrective_calibration_method = cal.method;
  if (cal.method === 'platt') {
    flat.corrective_platt_a = cal.parameters['plattA'] ?? 0;
    flat.corrective_platt_b = cal.parameters['plattB'] ?? 0;
  } else {
    const breakpoints = Object.entries(cal.parameters)
      .filter(([k]) => k.startsWith('bp_x_'))
      .sort(([a], [b]) => a.localeCompare(b));
    if (breakpoints.length > 0) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [k, v] of breakpoints) {
        xs.push(v);
        const yKey = k.replace('bp_x_', 'bp_y_');
        ys.push(cal.parameters[yKey] ?? 0);
      }
      flat.corrective_bp_x = xs.join(',');
      flat.corrective_bp_y = ys.join(',');
    }
  }

  const gv = artifact.goldenVector;
  flat.corrective_gv_features = gv.inputFeatures.join(',');
  flat.corrective_gv_expected_prob = gv.expectedProbability;
  flat.corrective_gv_expected_verdict = gv.expectedVerdict;

  return flat;
}

function makeConfig(overrides?: Partial<CorrectiveConfigV1>): CorrectiveConfigV1 {
  return {
    schemaVersion: CORRECTIVE_SCHEMA_VERSION,
    state: 'disabled',
    provider: 'builtin_gbdt',
    mode: 'gate',
    threshold: 0.5,
    sizingExponent: 1.0,
    sizingPolicyId: 'gate',
    modelArtifactId: null,
    ...overrides,
  };
}

function makeArtifact(overrides?: Record<string, unknown>): PopArtifactManifestV1 {
  const base = {
    schemaVersion: CORRECTIVE_SCHEMA_VERSION,
    artifactId: 'art-001',
    modelFormat: 'onnx',
    modelFilename: 'pop_model_test.onnx',
    calibrationParams: {
      method: 'isotonic' as const,
      fittedOn: 'validation_only' as const,
      parameters: {
        bp_x_0: 0.1, bp_y_0: 0.05,
        bp_x_1: 0.5, bp_y_1: 0.5,
        bp_x_2: 0.9, bp_y_2: 0.95,
      },
    },
    featureManifest: Array.from({ length: POP_FEATURE_COUNT_V1 }, (_, i) => ({
      index: i,
      name: `feature_${i}`,
      owner: 'pop_feature_builder',
      unit: 'ratio',
      missingRule: 'zero' as const,
      knowledgeTime: 'at_decision' as const,
      calculationVersion: 1,
    })),
    featureSchemaHash: 'b58a76c9',
    featureSchemaVersion: 1,
    schemaVersionStr: '1.0.0',
    trainerVersion: '1.0.0',
    labelPolicyVersion: 1,
    sizingPolicyVersion: 1,
    trainingWindow: { startTimestampNs: '0', endTimestampNs: '1000000', barCount: 1000, candidateCount: 200 },
    validationWindow: { startTimestampNs: '1000000', endTimestampNs: '1500000', barCount: 500, candidateCount: 50 },
    metrics: {} as PopArtifactManifestV1['metrics'],
    minimumSampleEvidence: {} as PopArtifactManifestV1['minimumSampleEvidence'],
    goldenVector: {
      inputFeatures: Array.from({ length: POP_FEATURE_COUNT_V1 }, (_, i) => 0.1 * (i + 1)),
      expectedProbability: 0.65,
      expectedVerdict: 'pass' as const,
      tolerance: GOLDEN_VECTOR_TOLERANCE,
    },
    contentHash: 'abc123def456',
    createdAt: '2026-08-04T00:00:00Z',
  };
  return { ...base, ...overrides } as unknown as PopArtifactManifestV1;
}

describe('serializeCorrectiveRunnerConfig', () => {
  it('disabled config emits only corrective_state', () => {
    const flat = serializeCorrectiveRunnerConfig(makeConfig(), null);
    expect(flat).toEqual({ corrective_state: 'disabled' });
    expect(Object.keys(flat)).toHaveLength(1);
  });

  it('collect_only config emits state + mode + threshold + exponent but no artifact keys', () => {
    const flat = serializeCorrectiveRunnerConfig(
      makeConfig({ state: 'collect_only', mode: 'hybrid', threshold: 0.6, sizingExponent: 2.0 }),
      null,
    );
    expect(flat.corrective_state).toBe('collect_only');
    expect(flat.corrective_mode).toBe('hybrid');
    expect(flat.corrective_threshold).toBe(0.6);
    expect(flat.corrective_sizing_exponent).toBe(2.0);
    expect(flat).not.toHaveProperty('corrective_model_path');
    expect(flat).not.toHaveProperty('corrective_calibration_method');
  });

  it('enabled config without artifact emits state + policy only', () => {
    const flat = serializeCorrectiveRunnerConfig(
      makeConfig({ state: 'enabled' }),
      null,
    );
    expect(flat.corrective_state).toBe('enabled');
    expect(flat.corrective_mode).toBe('gate');
    expect(flat).not.toHaveProperty('corrective_model_path');
  });

  it('enabled config with isotonic artifact emits all flat keys', () => {
    const artifact = makeArtifact();
    const flat = serializeCorrectiveRunnerConfig(
      makeConfig({ state: 'enabled', modelArtifactId: 'art-001' }),
      artifact,
    );

    expect(flat.corrective_state).toBe('enabled');
    expect(flat.corrective_model_path).toBe('/mock/artifacts/pop_model_test.onnx');
    expect(flat.corrective_content_hash).toBe('abc123def456');
    expect(flat.corrective_feature_schema_hash).toBe(parseInt('b58a76c9', 16));
    expect(flat.corrective_feature_count).toBe(POP_FEATURE_COUNT_V1);
    expect(flat.corrective_calibration_method).toBe('isotonic');
    expect(flat.corrective_bp_x).toBe('0.1,0.5,0.9');
    expect(flat.corrective_bp_y).toBe('0.05,0.5,0.95');
    expect(flat).not.toHaveProperty('corrective_platt_a');
    expect(flat).not.toHaveProperty('corrective_platt_b');

    const gvFeatures = (flat.corrective_gv_features as string).split(',').map(Number);
    expect(gvFeatures).toHaveLength(POP_FEATURE_COUNT_V1);
    expect(flat.corrective_gv_expected_prob).toBe(0.65);
    expect(flat.corrective_gv_expected_verdict).toBe('pass');
  });

  it('enabled config with platt artifact emits platt keys, no breakpoints', () => {
    const artifact = makeArtifact({
      calibrationParams: {
        method: 'platt',
        fittedOn: 'validation_only',
        parameters: { plattA: -1.5, plattB: 0.3 },
      },
    });
    const flat = serializeCorrectiveRunnerConfig(
      makeConfig({ state: 'enabled', modelArtifactId: 'art-001' }),
      artifact,
    );

    expect(flat.corrective_calibration_method).toBe('platt');
    expect(flat.corrective_platt_a).toBe(-1.5);
    expect(flat.corrective_platt_b).toBe(0.3);
    expect(flat).not.toHaveProperty('corrective_bp_x');
    expect(flat).not.toHaveProperty('corrective_bp_y');
  });

  it('golden vector verdict reject is serialized correctly', () => {
    const artifact = makeArtifact({
      goldenVector: {
        inputFeatures: Array.from({ length: POP_FEATURE_COUNT_V1 }, () => 0.5),
        expectedProbability: 0.3,
        expectedVerdict: 'reject',
        tolerance: 0.01,
      },
    });
    const flat = serializeCorrectiveRunnerConfig(
      makeConfig({ state: 'enabled', modelArtifactId: 'art-001' }),
      artifact,
    );

    expect(flat.corrective_gv_expected_verdict).toBe('reject');
    expect(flat.corrective_gv_expected_prob).toBe(0.3);
  });

  it('feature schema hash hex->int conversion matches C++ expectation', () => {
    const artifact = makeArtifact({ featureSchemaHash: 'b58a76c9' });
    const flat = serializeCorrectiveRunnerConfig(
      makeConfig({ state: 'enabled', modelArtifactId: 'art-001' }),
      artifact,
    );
    expect(flat.corrective_feature_schema_hash).toBe(0xb58a76c9);
  });
});
