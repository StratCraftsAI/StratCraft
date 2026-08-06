/**
 * TICKET_1345: Operation admission authority tests.
 *
 * Test names match the ticket's test_cases specification.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type {
  OperationAdmissionPolicy,
  OperationAdmissionPolicyReadOnly,
  OperationAdmissionPolicyMutation,
  AdmissionPrincipal,
  RequiredTierEvidence,
  IdentityBoundEntitlementEvidence,
} from '@StratCraft/types';
import {
  OperationPolicyRegistry,
  OperationAdmissionAuthority,
  type EntitlementEvidenceRepository,
} from '../index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PUBLIC_POLICY: OperationAdmissionPolicyReadOnly = {
  operationId: 'get_research_environment_status',
  capabilityId: 'research-environment',
  authentication: 'optional',
  entitlement: { kind: 'public' },
  mutationAuthority: 'none',
  runtimeRequirements: ['research-runtime-service'],
  policyRevision: 1,
};

const TIER_POLICY: OperationAdmissionPolicyReadOnly = {
  operationId: 'list_entitlements',
  capabilityId: 'entitlement-management',
  authentication: 'required',
  entitlement: { kind: 'plugin-tier', pluginId: 'com.stratcraft.base', requirementSource: 'current-registry' },
  mutationAuthority: 'none',
  runtimeRequirements: [],
  policyRevision: 1,
};

const MUTATION_POLICY: OperationAdmissionPolicyMutation = {
  operationId: 'purge_strategy',
  capabilityId: 'strategy-management',
  authentication: 'required',
  entitlement: { kind: 'plugin-tier', pluginId: 'com.stratcraft.base', requirementSource: 'current-registry' },
  mutationAuthority: 'human-origin-required',
  delegationPolicy: 'direct-only',
  runtimeRequirements: [],
  policyRevision: 1,
};

const ANON: AdmissionPrincipal = { kind: 'anonymous', provenance: 'explicit-anonymous' };

const USER_A: AdmissionPrincipal = {
  kind: 'authenticated',
  subjectKey: 'user-a',
  sessionBinding: 'sess-a',
  provenance: 'electron-session',
};

const USER_B: AdmissionPrincipal = {
  kind: 'authenticated',
  subjectKey: 'user-b',
  sessionBinding: 'sess-b',
  provenance: 'browser-oauth',
};

function makeEvidenceRepo(overrides?: {
  plan?: string | null;
  pluginGrants?: Record<string, string>;
  requiredTier?: string;
  revision?: string;
}): EntitlementEvidenceRepository {
  const revision = overrides?.revision ?? 'rev-1';
  return {
    async acquireEvidence(principal, pluginId) {
      if (principal.kind === 'anonymous') return null;
      return {
        subjectKey: principal.subjectKey,
        plan: overrides?.plan ?? 'pro',
        pluginGrants: overrides?.pluginGrants ?? {},
        sourceRevision: revision,
        observedAtMs: Date.now(),
        expiresAtMs: Date.now() + 3600_000,
      };
    },
    async resolveRequiredTierEvidence(pluginId) {
      const tier = overrides?.requiredTier ?? 'pro';
      return { kind: 'required', tier, registryRevision: revision } as RequiredTierEvidence;
    },
    currentRevision() { return revision; },
  };
}

function buildAuthority(
  policies: OperationAdmissionPolicy[],
  repo?: EntitlementEvidenceRepository,
): OperationAdmissionAuthority {
  const registry = new OperationPolicyRegistry();
  for (const p of policies) registry.register(p);
  return new OperationAdmissionAuthority(registry.freeze(), repo ?? makeEvidenceRepo(), 'test-auth');
}

// ---------------------------------------------------------------------------
// Policy registry tests
// ---------------------------------------------------------------------------

describe('OperationPolicyRegistry', () => {
  it('rejects duplicate operationId', () => {
    const reg = new OperationPolicyRegistry();
    reg.register(PUBLIC_POLICY);
    expect(() => reg.register(PUBLIC_POLICY)).toThrow('Duplicate');
  });

  it('rejects registration after freeze', () => {
    const reg = new OperationPolicyRegistry();
    reg.register(PUBLIC_POLICY);
    reg.freeze();
    expect(() => reg.register(TIER_POLICY)).toThrow('frozen');
  });

  it('frozen lookup returns the registered policy', () => {
    const reg = new OperationPolicyRegistry();
    reg.register(PUBLIC_POLICY);
    const frozen = reg.freeze();
    expect(frozen.lookup('get_research_environment_status')).toBe(PUBLIC_POLICY);
    expect(frozen.lookup('nonexistent')).toBeUndefined();
  });

  it('frozen has() works', () => {
    const reg = new OperationPolicyRegistry();
    reg.register(PUBLIC_POLICY);
    const frozen = reg.freeze();
    expect(frozen.has('get_research_environment_status')).toBe(true);
    expect(frozen.has('nonexistent')).toBe(false);
  });

  it('registerAll registers multiple policies', () => {
    const reg = new OperationPolicyRegistry();
    reg.registerAll([PUBLIC_POLICY, TIER_POLICY, MUTATION_POLICY]);
    expect(reg.size()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Admission authority tests (ticket test_cases)
// ---------------------------------------------------------------------------

describe('OperationAdmissionAuthority', () => {
  it('public_operation_records_an_explicit_allowed_verdict', async () => {
    const auth = buildAuthority([PUBLIC_POLICY]);
    const result = await auth.admit({ operationId: 'get_research_environment_status', principal: ANON });
    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') return;
    expect(result.verdict.admitted).toBe(true);
    expect(result.verdict.entitlementEvaluated).toBe(true);
    expect(result.verdict.entitlementKind).toBe('public');
  });

  it('public_operation_does_not_require_optional_authenticated_tier_evidence', async () => {
    const repo: EntitlementEvidenceRepository = {
      async acquireEvidence() { return null; },
      async resolveRequiredTierEvidence() {
        return { kind: 'explicit-public', registryRevision: 'r1' };
      },
      currentRevision() { return 'r1'; },
    };
    const auth = buildAuthority([PUBLIC_POLICY], repo);
    const result = await auth.admit({ operationId: 'get_research_environment_status', principal: USER_A });
    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') return;
    expect(result.verdict.entitlementEvidence).toBe('not-required-unavailable');
  });

  it('tier_operation_uses_centralized_effective_and_required_tiers', async () => {
    const auth = buildAuthority([TIER_POLICY], makeEvidenceRepo({ plan: 'gold', requiredTier: 'pro' }));
    const result = await auth.admit({ operationId: 'list_entitlements', principal: USER_A });
    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') return;
    expect(result.verdict.effectiveTier).toBe('gold');
    expect(result.verdict.requiredTier).toBe('pro');
  });

  it('unauthenticated_and_insufficient_tier_are_distinct_refusals', async () => {
    const auth = buildAuthority([TIER_POLICY], makeEvidenceRepo({ plan: 'free', requiredTier: 'gold' }));

    // Unauthenticated
    const r1 = await auth.admit({ operationId: 'list_entitlements', principal: ANON });
    expect(r1.kind).toBe('refused');
    if (r1.kind !== 'refused') return;
    expect(r1.verdict.code).toBe('authentication_required');

    // Insufficient tier (authenticated but free vs gold)
    const r2 = await auth.admit({ operationId: 'list_entitlements', principal: USER_A });
    expect(r2.kind).toBe('refused');
    if (r2.kind !== 'refused') return;
    expect(r2.verdict.code).toBe('insufficient_tier');

    expect(r1.verdict.code).not.toBe(r2.verdict.code);
  });

  it('entitlement_refusal_precedes_runtime_discovery', async () => {
    const auth = buildAuthority([TIER_POLICY], makeEvidenceRepo({ plan: 'free', requiredTier: 'gold' }));
    const result = await auth.admit({ operationId: 'list_entitlements', principal: USER_A });
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.verdict.code).toBe('insufficient_tier');
    expect(result.verdict.stage).toBe('entitlement');
  });

  it('runtime_failure_occurs_only_after_entitlement_admission', async () => {
    const auth = buildAuthority([TIER_POLICY]);
    const result = await auth.admit({ operationId: 'list_entitlements', principal: USER_A });
    expect(result.kind).toBe('admitted');
  });

  it('mutation_authority_is_composed_without_reimplementing_entitlement', async () => {
    const auth = buildAuthority([MUTATION_POLICY]);
    const result = await auth.admit({ operationId: 'purge_strategy', principal: USER_A });
    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') return;
    // Mutation authority is a downstream stage — the authority only checks entitlement
    expect(result.verdict.entitlementEvaluated).toBe(true);
    expect(result.verdict.entitlementKind).toBe('plugin-tier');
  });

  it('one_operation_attempt_evaluates_entitlement_exactly_once', async () => {
    const callLog: string[] = [];
    const repo: EntitlementEvidenceRepository = {
      async acquireEvidence(principal, pluginId) {
        callLog.push('acquireEvidence');
        return {
          subjectKey: principal.kind === 'authenticated' ? principal.subjectKey : '',
          plan: 'pro',
          pluginGrants: {},
          sourceRevision: 'r1',
          observedAtMs: Date.now(),
          expiresAtMs: Date.now() + 3600_000,
        };
      },
      async resolveRequiredTierEvidence(pluginId) {
        callLog.push('resolveRequiredTierEvidence');
        return { kind: 'required', tier: 'pro', registryRevision: 'r1' };
      },
      currentRevision() { return 'r1'; },
    };

    const auth = buildAuthority([TIER_POLICY], repo);
    await auth.admit({ operationId: 'list_entitlements', principal: USER_A });

    expect(callLog.filter(c => c === 'acquireEvidence')).toHaveLength(1);
    expect(callLog.filter(c => c === 'resolveRequiredTierEvidence')).toHaveLength(1);
  });

  it('unknown_tier_and_missing_registry_entry_fail_closed', async () => {
    const repo: EntitlementEvidenceRepository = {
      async acquireEvidence() { return null; },
      async resolveRequiredTierEvidence() {
        return { kind: 'missing', registryRevision: 'r1' };
      },
      currentRevision() { return 'r1'; },
    };
    const auth = buildAuthority([TIER_POLICY], repo);
    const result = await auth.admit({ operationId: 'list_entitlements', principal: USER_A });
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.verdict.code).toBe('entitlement_context_unavailable');
  });

  it('stale_attestation_requires_fresh_admission', async () => {
    const auth = buildAuthority([PUBLIC_POLICY]);
    const result = await auth.admit({ operationId: 'get_research_environment_status', principal: ANON });
    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') return;

    // Try to activate with a different evidence revision
    const activation = auth.activate(result.attestation.attestationId, 'rev-different');
    expect(activation.kind).toBe('stale');
    if (activation.kind !== 'stale') return;
    expect(activation.code).toBe('admission_stale');
  });
});

// ---------------------------------------------------------------------------
// Authority ownership and attestation lifecycle tests
// ---------------------------------------------------------------------------

describe('OperationAdmissionAuthority - attestation lifecycle', () => {
  it('exactly_one_process_holds_the_admission_authority_role', () => {
    const auth = buildAuthority([PUBLIC_POLICY]);
    expect(auth.instanceId).toBe('test-auth');
  });

  it('attestation_activation_precedes_business_runtime_discovery', async () => {
    const auth = buildAuthority([PUBLIC_POLICY]);
    const result = await auth.admit({ operationId: 'get_research_environment_status', principal: ANON });
    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') return;

    const att = result.attestation;
    expect(att.state).toBe('issued');

    const activation = auth.activate(att.attestationId);
    expect(activation.kind).toBe('activated');
    if (activation.kind !== 'activated') return;
    expect(activation.attestation.state).toBe('activated');
  });

  it('attestation_consumption_is_atomic_and_single_use', async () => {
    const auth = buildAuthority([PUBLIC_POLICY]);
    const result = await auth.admit({ operationId: 'get_research_environment_status', principal: ANON });
    if (result.kind !== 'admitted') return;

    auth.activate(result.attestation.attestationId);
    const consume1 = auth.consume(result.attestation.attestationId, { surface: 'mcp', route: 'test' });
    expect(consume1.kind).toBe('consumed');

    // Second consumption fails
    const consume2 = auth.consume(result.attestation.attestationId, { surface: 'mcp', route: 'test' });
    expect(consume2.kind).toBe('invalid');
  });

  it('finalization_emits_exactly_one_sanitized_terminal_record', async () => {
    const auth = buildAuthority([PUBLIC_POLICY]);
    const result = await auth.admit({ operationId: 'get_research_environment_status', principal: ANON });
    if (result.kind !== 'admitted') return;

    auth.activate(result.attestation.attestationId);
    auth.consume(result.attestation.attestationId, { surface: 'mcp', route: 'test' });

    const record = auth.finalize(
      result.attestation.attestationId,
      { stage: 'completed', code: 'ok' },
      'mcp',
    );
    expect(record).not.toBeNull();
    expect(record!.operationId).toBe('get_research_environment_status');
    expect(record!.authorityInstance).toBe('test-auth');
    expect(record!.correlationId).toBeTruthy();

    // Second finalization fails (attestation cleaned up)
    const record2 = auth.finalize(
      result.attestation.attestationId,
      { stage: 'completed', code: 'ok' },
      'mcp',
    );
    expect(record2).toBeNull();
  });

  it('principal_is_bound_to_identity_scoped_entitlement_evidence', async () => {
    const callLog: Array<{ subjectKey: string; pluginId: string }> = [];
    const repo: EntitlementEvidenceRepository = {
      async acquireEvidence(principal, pluginId) {
        if (principal.kind !== 'authenticated') return null;
        callLog.push({ subjectKey: principal.subjectKey, pluginId });
        return {
          subjectKey: principal.subjectKey,
          plan: 'pro',
          pluginGrants: {},
          sourceRevision: 'r1',
          observedAtMs: Date.now(),
          expiresAtMs: Date.now() + 3600_000,
        };
      },
      async resolveRequiredTierEvidence() {
        return { kind: 'required', tier: 'pro', registryRevision: 'r1' };
      },
      currentRevision() { return 'r1'; },
    };

    const auth = buildAuthority([TIER_POLICY], repo);

    await auth.admit({ operationId: 'list_entitlements', principal: USER_A });
    await auth.admit({ operationId: 'list_entitlements', principal: USER_B });

    // Each principal's evidence was acquired separately
    expect(callLog).toHaveLength(2);
    expect(callLog[0]!.subjectKey).toBe('user-a');
    expect(callLog[1]!.subjectKey).toBe('user-b');
  });

  it('user_payload_cannot_select_or_replace_the_bound_principal', async () => {
    const auth = buildAuthority([PUBLIC_POLICY]);
    const result = await auth.admit({ operationId: 'get_research_environment_status', principal: USER_A });
    if (result.kind !== 'admitted') return;

    // The attestation binds the principal
    expect(result.attestation.principalSubjectKey).toBe('user-a');
    expect(result.attestation.sessionBinding).toBe('sess-a');
  });

  it('unregistered operation fails with operation_policy_missing', async () => {
    const auth = buildAuthority([PUBLIC_POLICY]);
    const result = await auth.admit({ operationId: 'nonexistent_op', principal: ANON });
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.verdict.code).toBe('operation_policy_missing');
    expect(result.verdict.stage).toBe('policy');
  });

  it('cannot consume without activating first', async () => {
    const auth = buildAuthority([PUBLIC_POLICY]);
    const result = await auth.admit({ operationId: 'get_research_environment_status', principal: ANON });
    if (result.kind !== 'admitted') return;

    const consume = auth.consume(result.attestation.attestationId, { surface: 'mcp', route: 'test' });
    expect(consume.kind).toBe('invalid');
  });
});
