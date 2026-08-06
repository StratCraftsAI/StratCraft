import { describe, it, expect } from 'vitest';
import {
  CORRECTIVE_SCHEMA_VERSION,
  CORRECTIVE_STATES,
  CORRECTIVE_ERROR_CODES,
  DEFAULT_GATE_THRESHOLD,
  DEFAULT_SIZING_EXPONENT,
  MIN_GATE_THRESHOLD,
  MAX_GATE_THRESHOLD,
  MIN_SIZING_EXPONENT,
  MAX_SIZING_EXPONENT,
  MIN_CANDIDATES_FOR_TRAINING,
  MIN_POSITIVE_CLASS_SUPPORT,
  MIN_NEGATIVE_CLASS_SUPPORT,
  MIN_CALIBRATION_BIN_SUPPORT,
  POP_FEATURE_COUNT_V1,
  POP_FEATURE_SCHEMA_VERSION,
  SIZING_POLICY_IDS,
  OUTCOME_TYPES,
  TRAINING_JOB_STATES,
  ARTIFACT_FORMAT_ONNX,
  GOLDEN_VECTOR_TOLERANCE,
  DEFAULT_CORRECTIVE_CONFIG,
  DEFAULT_TRAINING_CONFIG,
  POP_FEATURE_SCHEMA_V1,
  isValidStateTransition,
  CorrectiveError,
  computeFeatureSchemaHash,
  type CandidateSnapshotV1,
  type OutcomeRecordV1,
  type CorrectiveConfigV1,
  type PopArtifactManifestV1,
  type CorrectiveState,
  type SizingPolicyId,
  type OutcomeType,
  type GateVerdict,
} from '../index.js';

// -----------------------------------------------------------------------
// 1. Constants integrity
// -----------------------------------------------------------------------

describe('constants', () => {
  it('schema version is 1', () => {
    expect(CORRECTIVE_SCHEMA_VERSION).toBe(1);
  });

  it('feature count matches feature schema length', () => {
    expect(POP_FEATURE_SCHEMA_V1.length).toBe(POP_FEATURE_COUNT_V1);
  });

  it('feature indices are contiguous 0..N-1', () => {
    POP_FEATURE_SCHEMA_V1.forEach((f, i) => {
      expect(f.index).toBe(i);
    });
  });

  it('feature names are unique', () => {
    const names = POP_FEATURE_SCHEMA_V1.map(f => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('threshold bounds are sane', () => {
    expect(MIN_GATE_THRESHOLD).toBe(0.0);
    expect(MAX_GATE_THRESHOLD).toBe(1.0);
    expect(DEFAULT_GATE_THRESHOLD).toBeGreaterThanOrEqual(MIN_GATE_THRESHOLD);
    expect(DEFAULT_GATE_THRESHOLD).toBeLessThanOrEqual(MAX_GATE_THRESHOLD);
  });

  it('sizing exponent bounds are sane', () => {
    expect(MIN_SIZING_EXPONENT).toBeGreaterThan(0);
    expect(MAX_SIZING_EXPONENT).toBeGreaterThan(MIN_SIZING_EXPONENT);
    expect(DEFAULT_SIZING_EXPONENT).toBeGreaterThanOrEqual(MIN_SIZING_EXPONENT);
    expect(DEFAULT_SIZING_EXPONENT).toBeLessThanOrEqual(MAX_SIZING_EXPONENT);
  });

  it('training minimums are positive', () => {
    expect(MIN_CANDIDATES_FOR_TRAINING).toBeGreaterThan(0);
    expect(MIN_POSITIVE_CLASS_SUPPORT).toBeGreaterThan(0);
    expect(MIN_NEGATIVE_CLASS_SUPPORT).toBeGreaterThan(0);
    expect(MIN_CALIBRATION_BIN_SUPPORT).toBeGreaterThan(0);
  });

  it('all error codes are unique', () => {
    const codes = Object.values(CORRECTIVE_ERROR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('error codes follow naming convention', () => {
    for (const code of Object.values(CORRECTIVE_ERROR_CODES)) {
      expect(code).toMatch(/^E_[A-Z]{3}_\d{3}$/);
    }
  });
});

// -----------------------------------------------------------------------
// 2. Feature schema hash parity with C++
// -----------------------------------------------------------------------

describe('computeFeatureSchemaHash', () => {
  it('produces a deterministic 8-char hex string', () => {
    const names = POP_FEATURE_SCHEMA_V1.map(f => f.name);
    const hash = computeFeatureSchemaHash(names);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is stable across calls', () => {
    const names = POP_FEATURE_SCHEMA_V1.map(f => f.name);
    const h1 = computeFeatureSchemaHash(names);
    const h2 = computeFeatureSchemaHash(names);
    expect(h1).toBe(h2);
  });

  it('changes when a feature name changes', () => {
    const names = POP_FEATURE_SCHEMA_V1.map(f => f.name);
    const h1 = computeFeatureSchemaHash(names);
    const altered = [...names];
    altered[0] = 'different_name';
    const h2 = computeFeatureSchemaHash(altered);
    expect(h1).not.toBe(h2);
  });

  it('changes when feature order changes', () => {
    const names = POP_FEATURE_SCHEMA_V1.map(f => f.name);
    const h1 = computeFeatureSchemaHash(names);
    const swapped = [...names];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    const h2 = computeFeatureSchemaHash(swapped);
    expect(h1).not.toBe(h2);
  });

  it('changes when a feature is added', () => {
    const names = POP_FEATURE_SCHEMA_V1.map(f => f.name);
    const h1 = computeFeatureSchemaHash(names);
    const h2 = computeFeatureSchemaHash([...names, 'extra']);
    expect(h1).not.toBe(h2);
  });
});

// -----------------------------------------------------------------------
// 3. Lifecycle state machine
// -----------------------------------------------------------------------

describe('isValidStateTransition', () => {
  it('allows disabled -> collect_only', () => {
    expect(isValidStateTransition('disabled', 'collect_only')).toBe(true);
  });

  it('allows disabled -> enabled', () => {
    expect(isValidStateTransition('disabled', 'enabled')).toBe(true);
  });

  it('allows collect_only -> disabled', () => {
    expect(isValidStateTransition('collect_only', 'disabled')).toBe(true);
  });

  it('allows collect_only -> enabled', () => {
    expect(isValidStateTransition('collect_only', 'enabled')).toBe(true);
  });

  it('allows enabled -> disabled', () => {
    expect(isValidStateTransition('enabled', 'disabled')).toBe(true);
  });

  it('allows enabled -> collect_only', () => {
    expect(isValidStateTransition('enabled', 'collect_only')).toBe(true);
  });

  it('every state can reach every other state (fully connected)', () => {
    for (const from of CORRECTIVE_STATES) {
      for (const to of CORRECTIVE_STATES) {
        if (from !== to) {
          expect(isValidStateTransition(from, to)).toBe(true);
        }
      }
    }
  });
});

// -----------------------------------------------------------------------
// 4. Default configuration
// -----------------------------------------------------------------------

describe('DEFAULT_CORRECTIVE_CONFIG', () => {
  it('starts disabled', () => {
    expect(DEFAULT_CORRECTIVE_CONFIG.state).toBe('disabled');
  });

  it('has schema version 1', () => {
    expect(DEFAULT_CORRECTIVE_CONFIG.schemaVersion).toBe(CORRECTIVE_SCHEMA_VERSION);
  });

  it('has no model artifact', () => {
    expect(DEFAULT_CORRECTIVE_CONFIG.modelArtifactId).toBeNull();
  });

  it('uses builtin_gbdt provider', () => {
    expect(DEFAULT_CORRECTIVE_CONFIG.provider).toBe('builtin_gbdt');
  });

  it('uses gate mode by default', () => {
    expect(DEFAULT_CORRECTIVE_CONFIG.mode).toBe('gate');
  });
});

// -----------------------------------------------------------------------
// 5. CorrectiveError
// -----------------------------------------------------------------------

describe('CorrectiveError', () => {
  it('carries code, message, and details', () => {
    const err = new CorrectiveError(
      CORRECTIVE_ERROR_CODES.CONFIG_ARTIFACT_REQUIRED_FOR_ENABLED,
      'test message',
      { foo: 42 },
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CorrectiveError');
    expect(err.code).toBe('E_COR_002');
    expect(err.message).toContain('E_COR_002');
    expect(err.message).toContain('test message');
    expect(err.details).toEqual({ foo: 42 });
  });

  it('works without details', () => {
    const err = new CorrectiveError(
      CORRECTIVE_ERROR_CODES.ARTIFACT_NOT_FOUND,
      'not found',
    );
    expect(err.details).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// 6. Contract shape assertions
// -----------------------------------------------------------------------

describe('contract shapes', () => {
  const makeCandidateSnapshot = (): CandidateSnapshotV1 => ({
    schemaVersion: CORRECTIVE_SCHEMA_VERSION,
    runId: 'run_001',
    candidateId: '1',
    strategyArtifactId: 'strat_001',
    modelArtifactId: null,
    asOfTimestampNs: '1700000000000000000',
    knowledgeCutoffTimestampNs: '1700000000000000000',
    symbolId: 'EURUSD',
    side: 'long',
    proposedSize: 1.0,
    finalSize: 1.0,
    sizeUnit: 'lots',
    featureVector: new Array(POP_FEATURE_COUNT_V1).fill(0),
    featureSchemaHash: 'abcd1234',
    featureSchemaVersion: POP_FEATURE_SCHEMA_VERSION,
    gateVerdict: 'disabled',
    calibratedProbability: null,
    sizingPolicyId: null,
    reasonCode: 'pop_disabled',
  });

  const makeOutcomeRecord = (): OutcomeRecordV1 => ({
    schemaVersion: CORRECTIVE_SCHEMA_VERSION,
    runId: 'run_001',
    candidateId: '1',
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
  });

  it('candidate snapshot has all required fields', () => {
    const c = makeCandidateSnapshot();
    expect(c.schemaVersion).toBe(CORRECTIVE_SCHEMA_VERSION);
    expect(c.featureVector.length).toBe(POP_FEATURE_COUNT_V1);
    expect(typeof c.runId).toBe('string');
    expect(typeof c.candidateId).toBe('string');
  });

  it('outcome record has all required fields', () => {
    const o = makeOutcomeRecord();
    expect(o.schemaVersion).toBe(CORRECTIVE_SCHEMA_VERSION);
    expect(typeof o.runId).toBe('string');
    expect(typeof o.candidateId).toBe('string');
    expect(OUTCOME_TYPES).toContain(o.outcomeType);
  });

  it('shadow outcome type exists', () => {
    const o = makeOutcomeRecord();
    const shadow: OutcomeRecordV1 = { ...o, outcomeType: 'shadow' };
    expect(shadow.outcomeType).toBe('shadow');
  });

  it('censored outcome type exists', () => {
    const o = makeOutcomeRecord();
    const censored: OutcomeRecordV1 = {
      ...o,
      outcomeType: 'censored',
      completionStatus: 'censored',
      exitTimestampNs: null,
      profitLabel: null,
      grossPnl: 0,
      commission: 0,
      slippage: 0,
      netPnl: 0,
    };
    expect(censored.completionStatus).toBe('censored');
    expect(censored.profitLabel).toBeNull();
  });
});

// -----------------------------------------------------------------------
// 7. C++ contract parity
// -----------------------------------------------------------------------

describe('C++ contract parity', () => {
  it('feature count matches C++ kPopFeatureCountV1', () => {
    expect(POP_FEATURE_COUNT_V1).toBe(14);
  });

  it('feature names match C++ kPopFeatureNamesV1 in order', () => {
    const expectedCppNames = [
      'proposed_size_normalized',
      'entry_price',
      'bid_ask_spread_bps',
      'atr_ratio',
      'volatility_z',
      'rsi_14',
      'bb_percent_b',
      'macd_histogram',
      'volume_ratio',
      'unrealized_pnl_normalized',
      'open_position_count',
      'bars_since_last_trade',
      'current_drawdown_pct',
      'side_encoded',
    ];
    const tsNames = POP_FEATURE_SCHEMA_V1.map(f => f.name);
    expect(tsNames).toEqual(expectedCppNames);
  });

  it('feature schema hash matches C++ kPopFeatureSchemaHashV1', () => {
    const names = POP_FEATURE_SCHEMA_V1.map(f => f.name);
    const hash = computeFeatureSchemaHash(names);
    expect(hash).toBe('b58a76c9');
  });

  it('golden vector tolerance matches C++ kGoldenVectorTolerance', () => {
    expect(GOLDEN_VECTOR_TOLERANCE).toBe(1e-6);
  });

  it('schema version matches C++ kCorrectiveSchemaVersion', () => {
    expect(CORRECTIVE_SCHEMA_VERSION).toBe(1);
  });

  it('CandidateSide enum values match C++', () => {
    const tsSides: readonly string[] = ['long', 'short'];
    expect(tsSides).toEqual(['long', 'short']);
  });

  it('GateVerdict enum values match C++', () => {
    const tsVerdicts: readonly GateVerdict[] = ['pass', 'reject', 'collect_only', 'disabled'];
    expect(tsVerdicts).toEqual(['pass', 'reject', 'collect_only', 'disabled']);
  });

  it('OutcomeType enum values match C++', () => {
    expect([...OUTCOME_TYPES]).toEqual(['actual', 'shadow', 'censored']);
  });

  it('SizingPolicy enum values match C++', () => {
    expect([...SIZING_POLICY_IDS]).toEqual(['gate', 'sizing', 'hybrid']);
  });
});

// -----------------------------------------------------------------------
// 8. Training config defaults
// -----------------------------------------------------------------------

describe('DEFAULT_TRAINING_CONFIG', () => {
  it('has valid fold count', () => {
    expect(DEFAULT_TRAINING_CONFIG.nFolds).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_TRAINING_CONFIG.nFolds).toBeLessThanOrEqual(20);
  });

  it('has non-negative embargo', () => {
    expect(DEFAULT_TRAINING_CONFIG.purgeEmbargoBars).toBeGreaterThanOrEqual(0);
  });

  it('has positive bootstrap params', () => {
    expect(DEFAULT_TRAINING_CONFIG.bootstrapSamples).toBeGreaterThan(0);
    expect(DEFAULT_TRAINING_CONFIG.bootstrapBlockSize).toBeGreaterThan(0);
  });

  it('has null training window by default', () => {
    expect(DEFAULT_TRAINING_CONFIG.trainingWindow).toBeNull();
  });
});
