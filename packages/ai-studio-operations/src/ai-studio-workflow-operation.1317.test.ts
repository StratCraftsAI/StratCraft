/**
 * TICKET_1317: shared AI Studio workflow operation.
 *
 * Covers the contract that both surfaces consume unchanged: canonical hashing,
 * snapshot validation, the action gate, request preconditions, the reducer's
 * compare-and-swap rules, and generation-manifest agreement.
 *
 * AC2 (versioned snapshot), AC3 (host-owned action authorization),
 * AC4 (reviewed rules agree with the generated artifact), AC6 (surface parity).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import {
  AI_STUDIO_WORKFLOW_CONTRACT_VERSION,
  MAX_CANONICAL_RULES_BYTES,
  WORKFLOW_CONFLICT_CODES,
  WORKFLOW_CONTRACT_UNAVAILABLE,
  buildWorkflowPreconditions,
  canonicalizeStrategyRules,
  computeArtifactHash,
  computeRulesHash,
  gateWorkflowAction,
  parseWorkflowConflict,
  reduceWorkflowSnapshot,
  validateGenerationManifest,
  validateWorkflowSnapshot,
  StrategyRulesShapeError,
  type WorkflowBinding,
  type WorkflowSnapshot,
} from './ai-studio-workflow-contract';
import type { StrategyRulesResponse } from './vibing-chat-protocol';

// The exact production reproduction from TICKET_1317 section 2: Williams %R
// period 10, take profit 6%, stop loss 2%.
const REVIEWED_RULES: StrategyRulesResponse = {
  entry_conditions: [
    { type: 'LONG', condition: 'WILLR(10) crosses above -80', action: 'Open long' },
    { type: 'SHORT', condition: 'WILLR(10) crosses below -20', action: 'Open short' },
  ],
  exit_conditions: [
    { type: 'TAKE_PROFIT', condition: '6% profit target' },
    { type: 'STOP_LOSS', condition: '2% loss limit' },
  ],
  risk_management: { take_profit_pct: 6, stop_loss_pct: 2, position_size_pct: undefined },
  indicators: [{ name: 'WILLR', params: '10', description: 'Williams %R, 10 period' }],
  filters: [],
  status: 'COMPLETE',
  completeness_score: 0.95,
};

/** The drifted rules actually observed in the defect: period 14, TP 5%. */
const DRIFTED_RULES: StrategyRulesResponse = {
  ...REVIEWED_RULES,
  entry_conditions: [
    { type: 'LONG', condition: 'WILLR(14) crosses above -80', action: 'Open long' },
    { type: 'SHORT', condition: 'WILLR(14) crosses below -20', action: 'Open short' },
  ],
  exit_conditions: [
    { type: 'TAKE_PROFIT', condition: '5% profit target' },
    { type: 'STOP_LOSS', condition: '2% loss limit' },
  ],
  risk_management: { take_profit_pct: 5, stop_loss_pct: 2 },
  indicators: [{ name: 'WILLR', params: '14', description: 'Williams %R, 14 period' }],
};

function snapshotPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const rules = (overrides.strategy_rules ?? REVIEWED_RULES) as StrategyRulesResponse | null;
  return {
    contract_version: AI_STUDIO_WORKFLOW_CONTRACT_VERSION,
    session_id: 'studio-1',
    workflow_revision: 1,
    strategy_rules: rules,
    rules_hash: computeRulesHash(rules),
    rules_hash_algorithm: 'sha256',
    available_actions: ['generate_code'],
    committed_at: 1000,
    expires_at: 100000,
    resumable: true,
    generated_artifact_hash: null,
    generated_class_name: null,
    ...overrides,
  };
}

function bindingFrom(snapshot: WorkflowSnapshot): WorkflowBinding {
  return {
    subjectId: 'subject-1',
    conversationId: 'conv-1',
    sessionId: snapshot.sessionId,
    workflowRevision: snapshot.workflowRevision,
    rulesHash: snapshot.rulesHash,
    strategyRules: snapshot.strategyRules,
    availableActions: snapshot.availableActions,
    expiresAt: snapshot.expiresAt,
    generatedArtifactHash: snapshot.generatedArtifactHash,
    generatedClassName: snapshot.generatedClassName,
    rowRevision: 1,
  };
}

describe('validates_backend_revision_hash_actions_and_generation_manifest', () => {
  describe('canonical hashing', () => {
    it('excludes advisory telemetry so a completeness change alone is not a rule change', () => {
      const rescored: StrategyRulesResponse = {
        ...REVIEWED_RULES,
        completeness_score: 0.42,
        status: 'PARTIAL',
        missing_fields: ['filters'],
        detected_language: 'zh',
      };
      expect(computeRulesHash(rescored)).toBe(computeRulesHash(REVIEWED_RULES));
    });

    it('changes when a behavioural parameter changes', () => {
      expect(computeRulesHash(DRIFTED_RULES)).not.toBe(computeRulesHash(REVIEWED_RULES));
    });

    it('hashes integral JSON numbers identically regardless of source spelling', () => {
      const integerRules = {
        ...REVIEWED_RULES,
        risk_management: { take_profit_pct: 6, stop_loss_pct: 2 },
      };
      const floatRules = JSON.parse(
        JSON.stringify(integerRules).replace(
          '"take_profit_pct":6',
          '"take_profit_pct":6.0',
        ).replace(
          '"stop_loss_pct":2',
          '"stop_loss_pct":2.0',
        ),
      ) as StrategyRulesResponse;
      expect(computeRulesHash(floatRules)).toBe(computeRulesHash(integerRules));
    });

    it('matches the frozen Python backend hash vector', () => {
      const backendVector = {
        entry_conditions: [
          { direction: 'long', expr: 'williams_r_14 crosses above -80' },
          { direction: 'short', expr: 'williams_r_14 crosses below -20' },
        ],
        exit_conditions: [
          { type: 'take_profit', value: 6 },
          { type: 'opposite_crossover' },
        ],
        risk_management: {
          stop_loss_atr_mult: 2,
          position_size_pct: 2,
          max_dd: null,
        },
        indicators: [
          { name: 'williams_r', period: 14 },
          { name: 'atr', period: 14 },
        ],
        filters: [],
        completeness_score: 83,
        status: 'extracted',
        missing_fields: ['timeframe'],
        detected_language: 'en',
      } as unknown as StrategyRulesResponse;
      expect(computeRulesHash(backendVector)).toBe(
        '75fabd6cec2b5b500047afc39506b31889fbf35380957eeeee2fe611c780e072',
      );
    });

    it('treats an omitted and an explicitly-null risk knob identically', () => {
      const omitted = { ...REVIEWED_RULES, risk_management: { take_profit_pct: 6, stop_loss_pct: 2 } };
      expect(computeRulesHash(omitted)).toBe(computeRulesHash(REVIEWED_RULES));
    });

    it('is order-sensitive for entry conditions, which are semantically ordered', () => {
      const reordered: StrategyRulesResponse = {
        ...REVIEWED_RULES,
        entry_conditions: [...REVIEWED_RULES.entry_conditions!].reverse(),
      };
      expect(computeRulesHash(reordered)).not.toBe(computeRulesHash(REVIEWED_RULES));
    });

    it('canonicalizes null rules to empty behavioural containers', () => {
      expect(canonicalizeStrategyRules(null)).toEqual({
        entry_conditions: [],
        exit_conditions: [],
        risk_management: {},
        indicators: [],
        filters: [],
      });
    });

    it('hashes an artifact and returns null for absent code', () => {
      expect(computeArtifactHash(null)).toBeNull();
      expect(computeArtifactHash('')).toBeNull();
      expect(computeArtifactHash('class X {};')).toBe(
        createHash('sha256').update('class X {};', 'utf8').digest('hex'),
      );
    });
  });

  describe('snapshot validation', () => {
    it('accepts a well-formed snapshot', () => {
      const result = validateWorkflowSnapshot(snapshotPayload(), { now: 5000 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.sessionId).toBe('studio-1');
      expect(result.value.workflowRevision).toBe(1);
      expect(result.value.availableActions).toEqual(['generate_code']);
    });

    it('reports contract-unavailable when the backend sends no snapshot', () => {
      const result = validateWorkflowSnapshot(undefined);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONTRACT_UNAVAILABLE);
    });

    it('rejects an unsupported contract version rather than guessing the shape', () => {
      const result = validateWorkflowSnapshot(snapshotPayload({ contract_version: 99 }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONTRACT_UNAVAILABLE);
      expect(result.conflict.actual).toEqual({ contract_version: 99 });
    });

    it('rejects a snapshot whose rules_hash does not describe its own rules', () => {
      const result = validateWorkflowSnapshot(
        snapshotPayload({ rules_hash: 'deadbeef' }),
        { now: 5000 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.RULES_HASH_MISMATCH);
    });

    it('rejects an expired snapshot', () => {
      const result = validateWorkflowSnapshot(
        snapshotPayload({ expires_at: 100 }),
        { now: 200 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.SESSION_EXPIRED);
    });

    it('rejects a missing or invalid workflow revision', () => {
      for (const bad of [undefined, 0, 1.5, 'two']) {
        const result = validateWorkflowSnapshot(
          snapshotPayload({ workflow_revision: bad }),
          { now: 5000 },
        );
        expect(result.ok).toBe(false);
      }
    });

    it('rejects a missing session id and a blank rules hash', () => {
      expect(validateWorkflowSnapshot(snapshotPayload({ session_id: '  ' })).ok).toBe(false);
      expect(validateWorkflowSnapshot(snapshotPayload({ rules_hash: '' })).ok).toBe(false);
    });

    it('rejects an unsupported hash algorithm', () => {
      const result = validateWorkflowSnapshot(
        snapshotPayload({ rules_hash_algorithm: 'md5' }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONTRACT_UNAVAILABLE);
    });

    it('rejects rules that exceed the byte bound', () => {
      const huge: StrategyRulesResponse = {
        ...REVIEWED_RULES,
        filters: [ 'x'.repeat(MAX_CANONICAL_RULES_BYTES + 10) ],
      };
      const result = validateWorkflowSnapshot(
        snapshotPayload({ strategy_rules: huge, rules_hash: computeRulesHash(huge) }),
        { now: 5000 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.RULES_TOO_LARGE);
    });

    it('parses only known structured conflict codes', () => {
      expect(parseWorkflowConflict({
        code: WORKFLOW_CONFLICT_CODES.STALE_REVISION,
        message: 'stale',
      })?.code).toBe(WORKFLOW_CONFLICT_CODES.STALE_REVISION);
      expect(parseWorkflowConflict({ code: 'something_else' })).toBeNull();
      expect(parseWorkflowConflict(null)).toBeNull();
    });
  });

  describe('action gate (AC3)', () => {
    const snapshot = (validateWorkflowSnapshot(snapshotPayload(), { now: 5000 }) as
      { ok: true; value: WorkflowSnapshot }).value;

    it('permits an advertised action', () => {
      expect(gateWorkflowAction(bindingFrom(snapshot), 'generate_code', { now: 5000 }).ok).toBe(true);
    });

    it('refuses an action the snapshot does not advertise', () => {
      const result = gateWorkflowAction(bindingFrom(snapshot), 'save_strategy', { now: 5000 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.ACTION_UNAVAILABLE);
    });

    it('refuses any action once the session expired', () => {
      const result = gateWorkflowAction(
        { ...bindingFrom(snapshot), expiresAt: 100 },
        'generate_code',
        { now: 200 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.SESSION_EXPIRED);
    });
  });

  describe('request preconditions', () => {
    it('carries the committed revision and hash for backend compare-and-swap', () => {
      const snapshot = (validateWorkflowSnapshot(snapshotPayload(), { now: 5000 }) as
        { ok: true; value: WorkflowSnapshot }).value;
      expect(buildWorkflowPreconditions(bindingFrom(snapshot))).toEqual({
        expected_workflow_revision: 1,
        expected_rules_hash: computeRulesHash(REVIEWED_RULES),
      });
    });
  });

  describe('reducer compare-and-swap', () => {
    const identity = { subjectId: 'subject-1', conversationId: 'conv-1' };
    const first = (validateWorkflowSnapshot(snapshotPayload(), { now: 5000 }) as
      { ok: true; value: WorkflowSnapshot }).value;

    it('creates the first binding and increments the local row revision', () => {
      const result = reduceWorkflowSnapshot(null, first, identity);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.rowRevision).toBe(1);
      expect(result.value.sessionId).toBe('studio-1');
    });

    it('advances to a newer revision', () => {
      const previous = bindingFrom(first);
      const next = { ...first, workflowRevision: 2 };
      const result = reduceWorkflowSnapshot(previous, next, identity);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.workflowRevision).toBe(2);
      expect(result.value.rowRevision).toBe(2);
    });

    it('refuses to overwrite a newer snapshot with an older one', () => {
      const previous = { ...bindingFrom(first), workflowRevision: 5 };
      const result = reduceWorkflowSnapshot(previous, first, identity);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.STALE_REVISION);
    });

    it('refuses a snapshot belonging to a different session', () => {
      const previous = { ...bindingFrom(first), sessionId: 'studio-other' };
      const result = reduceWorkflowSnapshot(previous, { ...first, workflowRevision: 2 }, identity);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.SESSION_UNKNOWN);
    });

    it('fails closed across subjects', () => {
      const previous = { ...bindingFrom(first), subjectId: 'someone-else' };
      const result = reduceWorkflowSnapshot(previous, { ...first, workflowRevision: 2 }, identity);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.CROSS_SUBJECT);
    });
  });

  describe('generation manifest agreement (AC4)', () => {
    const snapshot = (validateWorkflowSnapshot(snapshotPayload(), { now: 5000 }) as
      { ok: true; value: WorkflowSnapshot }).value;
    const dispatched = bindingFrom(snapshot);
    const artifact = 'class LarryWilliams {};';

    function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        contract_version: AI_STUDIO_WORKFLOW_CONTRACT_VERSION,
        session_id: 'studio-1',
        input_workflow_revision: 1,
        input_rules_hash: computeRulesHash(REVIEWED_RULES),
        generated_rules_hash: computeRulesHash(REVIEWED_RULES),
        rules_agreement: true,
        artifact_hash: computeArtifactHash(artifact),
        class_name: 'LarryWilliams',
        field_digests: {
          entry_conditions: { used_digest: 'a', matches_input: true },
          exit_conditions: { used_digest: 'b', matches_input: true },
          risk_management: { used_digest: 'c', matches_input: true },
          indicators: { used_digest: 'd', matches_input: true },
          filters: { used_digest: 'e', matches_input: true },
        },
        ...overrides,
      };
    }

    it('accepts a manifest that agrees with the dispatched snapshot', () => {
      const result = validateGenerationManifest(manifest(), dispatched, artifact);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.rulesAgreement).toBe(true);
    });

    it('rejects the production drift: generated from period 14 / TP 5% after reviewing 10 / 6%', () => {
      const result = validateGenerationManifest(
        manifest({
          generated_rules_hash: computeRulesHash(DRIFTED_RULES),
          rules_agreement: false,
          field_digests: {
            entry_conditions: { used_digest: 'x', matches_input: false },
            exit_conditions: { used_digest: 'y', matches_input: false },
            risk_management: { used_digest: 'z', matches_input: false },
            indicators: { used_digest: 'w', matches_input: false },
            filters: { used_digest: 'e', matches_input: true },
          },
        }),
        dispatched,
        artifact,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.RULES_HASH_MISMATCH);
      // The drifted fields are named, not hidden behind an opaque hash diff.
      expect(result.conflict.message).toContain('entry_conditions');
      expect(result.conflict.message).toContain('indicators');
    });

    it('rejects a manifest for a different session', () => {
      const result = validateGenerationManifest(
        manifest({ session_id: 'studio-other' }), dispatched, artifact,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.SESSION_UNKNOWN);
    });

    it('rejects a manifest built from a different input revision', () => {
      const result = validateGenerationManifest(
        manifest({ input_workflow_revision: 7 }), dispatched, artifact,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.STALE_REVISION);
    });

    it('rejects a manifest whose input rules differ from the reviewed snapshot', () => {
      const result = validateGenerationManifest(
        manifest({ input_rules_hash: computeRulesHash(DRIFTED_RULES) }), dispatched, artifact,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.RULES_HASH_MISMATCH);
    });

    it('rejects a manifest whose artifact hash does not match the returned code', () => {
      const result = validateGenerationManifest(
        manifest({ artifact_hash: computeArtifactHash('class Other {};') }),
        dispatched,
        artifact,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.RULES_HASH_MISMATCH);
    });

    it('reports contract-unavailable when no manifest is present', () => {
      const result = validateGenerationManifest(undefined, dispatched, artifact);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONTRACT_UNAVAILABLE);
    });

    it('rejects an unsupported manifest contract version', () => {
      const result = validateGenerationManifest(
        manifest({ contract_version: 42 }), dispatched, artifact,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.conflict.code).toBe(WORKFLOW_CONTRACT_UNAVAILABLE);
    });
  });
});

describe('preserves_electron_and_guide_contract_parity', () => {
  it('exposes one validator, gate, request builder, reducer, and manifest checker', () => {
    // AC6: both surfaces import these same symbols. A surface that
    // reconstructed any of these decisions locally would be a parity break.
    expect(typeof validateWorkflowSnapshot).toBe('function');
    expect(typeof gateWorkflowAction).toBe('function');
    expect(typeof buildWorkflowPreconditions).toBe('function');
    expect(typeof reduceWorkflowSnapshot).toBe('function');
    expect(typeof validateGenerationManifest).toBe('function');
  });

  it('produces identical hashes for the same rules regardless of caller', () => {
    // The Guide adapter and the Electron adapter hash the same reviewed rules;
    // divergence here would let one surface dispatch preconditions the other
    // could never satisfy.
    const fromGuide = computeRulesHash(REVIEWED_RULES);
    const fromElectron = computeRulesHash(JSON.parse(JSON.stringify(REVIEWED_RULES)));
    expect(fromGuide).toBe(fromElectron);
  });
});

// =============================================================================
// TICKET_1317 regression: rule-shape rejection must mirror the backend exactly
//
// Live defect: the backend coerced a wrong-typed field with `list(value)`
// while this side passed it through unchanged, so identical input produced
// different hashes. Coercion was the worse half -- `list("trend_up")` yields
// `["t","r","e","n","d","_","u","p"]`, fabricating conditions the user never
// wrote and then certifying them with a clean hash. Both sides now reject.
// =============================================================================

describe('rule shape rejection (cross-language parity)', () => {
  it.each([
    ['filters', 'trend_up'],
    ['filters', 5],
    ['indicators', { a: 1 }],
    ['entry_conditions', 'long'],
    ['exit_conditions', { x: 1 }],
  ])('rejects %s with a non-list value (%p)', (field, value) => {
    const rules = { ...REVIEWED_RULES, [field]: value } as never;
    expect(() => computeRulesHash(rules)).toThrow(StrategyRulesShapeError);
  });

  it.each([
    [[1, 2]],
    ['none'],
  ])('rejects risk_management that is not an object (%p)', (value) => {
    const rules = { ...REVIEWED_RULES, risk_management: value } as never;
    expect(() => computeRulesHash(rules)).toThrow(StrategyRulesShapeError);
  });

  it('rejects strategy_rules that is not an object', () => {
    for (const bad of ['oops', [1, 2], 42]) {
      expect(() => computeRulesHash(bad as never)).toThrow(StrategyRulesShapeError);
    }
  });

  it('surfaces a malformed field as a structured conflict, not a throw', () => {
    // Built directly: snapshotPayload() hashes its rules, which now throws for
    // malformed input -- the point of this test is the validator's behaviour.
    const result = validateWorkflowSnapshot({
      contract_version: AI_STUDIO_WORKFLOW_CONTRACT_VERSION,
      session_id: 'studio-1',
      workflow_revision: 1,
      strategy_rules: { ...REVIEWED_RULES, filters: 'trend_up' },
      rules_hash: 'f'.repeat(64),
      rules_hash_algorithm: 'sha256',
      available_actions: ['generate_code'],
      committed_at: 1_000,
      expires_at: 9_999_999_999,
      resumable: true,
      generated_artifact_hash: null,
      generated_class_name: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict.code).toBe(WORKFLOW_CONFLICT_CODES.RULES_HASH_MISMATCH);
    expect(result.conflict.actual).toMatchObject({ field: 'filters' });
  });

  it('leaves well-formed rules byte-identical to the backend', () => {
    // Frozen cross-language vector: the Python peer produces this exact digest
    // for the live Larry Williams %R extraction that triggered the defect.
    const live = {
      entry_conditions: [{
        type: 'LONG',
        condition: 'Williams %R(14) < -80',
        action: 'Open long position on oversold signal',
      }],
      exit_conditions: [{
        type: 'SIGNAL_EXIT',
        condition: 'Williams %R(14) crosses above -20',
      }],
      risk_management: { position_size_pct: 2.0, stop_loss_pct: 2.0 },
      indicators: [{
        name: 'Williams %R',
        params: '14',
        description: '14-period Williams Percent Range',
      }],
      filters: [],
    } as never;
    expect(computeRulesHash(live)).toBe(
      '404d92083a7e6e2611e2fffc2557261f2e30c311affade273a597aa81b1c9001',
    );
  });
});
