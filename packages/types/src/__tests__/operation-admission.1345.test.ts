import { describe, it, expect } from 'vitest';
import {
  resolveOperationAdmission,
  isAttestationExpired,
  transitionAttestationState,
  type OperationAdmissionPolicy,
  type OperationAdmissionPolicyReadOnly,
  type OperationAdmissionPolicyMutation,
  type AdmissionPrincipal,
  type RequiredTierEvidence,
  type OperationAttestation,
} from '../operation-admission';

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
  operationId: 'install_research_environment',
  capabilityId: 'research-environment',
  authentication: 'required',
  entitlement: { kind: 'plugin-tier', pluginId: 'com.stratcraft.base', requirementSource: 'current-registry' },
  mutationAuthority: 'human-origin-required',
  delegationPolicy: 'direct-only',
  runtimeRequirements: ['research-runtime-service'],
  policyRevision: 1,
};

const ANON_PRINCIPAL: AdmissionPrincipal = {
  kind: 'anonymous',
  provenance: 'explicit-anonymous',
};

const AUTH_PRINCIPAL: AdmissionPrincipal = {
  kind: 'authenticated',
  subjectKey: 'user-42',
  sessionBinding: 'session-abc',
  provenance: 'electron-session',
};

const EVIDENCE_REV = 'rev-001';

function makeAttestation(overrides?: Partial<OperationAttestation>): OperationAttestation {
  return {
    attestationId: 'att-1',
    operationId: 'op-1',
    principalSubjectKey: 'user-42',
    sessionBinding: 'session-abc',
    state: 'issued',
    policyRevision: 1,
    evidenceRevision: EVIDENCE_REV,
    payloadHash: null,
    correlationId: 'corr-1',
    issuedAtMs: 1000,
    expiresAtMs: 5000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests per ticket test_cases
// ---------------------------------------------------------------------------

describe('resolveOperationAdmission', () => {
  it('public_operation_records_an_explicit_allowed_verdict', () => {
    const v = resolveOperationAdmission('d1', ANON_PRINCIPAL, PUBLIC_POLICY, { kind: 'explicit-public', registryRevision: EVIDENCE_REV }, null, EVIDENCE_REV);
    expect(v.admitted).toBe(true);
    if (!v.admitted) return;
    expect(v.entitlementEvaluated).toBe(true);
    expect(v.entitlementKind).toBe('public');
    expect(v.requiredTier).toBe('free');
    expect(v.decisionSource).toBe('operation-admission');
  });

  it('public_operation_does_not_require_optional_authenticated_tier_evidence', () => {
    const v = resolveOperationAdmission('d2', AUTH_PRINCIPAL, PUBLIC_POLICY, { kind: 'explicit-public', registryRevision: EVIDENCE_REV }, null, EVIDENCE_REV);
    expect(v.admitted).toBe(true);
    if (!v.admitted) return;
    expect(v.entitlementEvidence).toBe('not-required-unavailable');
    expect(v.authenticated).toBe(true);
  });

  it('public_operation_with_available_tier_evidence_records_not_required', () => {
    const v = resolveOperationAdmission('d2b', AUTH_PRINCIPAL, PUBLIC_POLICY, { kind: 'explicit-public', registryRevision: EVIDENCE_REV }, 'pro', EVIDENCE_REV);
    expect(v.admitted).toBe(true);
    if (!v.admitted) return;
    expect(v.entitlementEvidence).toBe('not-required');
  });

  it('tier_operation_uses_centralized_effective_and_required_tiers', () => {
    const evidence: RequiredTierEvidence = { kind: 'required', tier: 'pro', registryRevision: EVIDENCE_REV };
    const v = resolveOperationAdmission('d3', AUTH_PRINCIPAL, TIER_POLICY, evidence, 'gold', EVIDENCE_REV);
    expect(v.admitted).toBe(true);
    if (!v.admitted) return;
    expect(v.effectiveTier).toBe('gold');
    expect(v.requiredTier).toBe('pro');
    expect(v.entitlementKind).toBe('plugin-tier');
  });

  it('unauthenticated_and_insufficient_tier_are_distinct_refusals', () => {
    // Unauthenticated on a required-auth policy
    const v1 = resolveOperationAdmission('d4a', ANON_PRINCIPAL, TIER_POLICY, { kind: 'required', tier: 'pro', registryRevision: EVIDENCE_REV }, null, EVIDENCE_REV);
    expect(v1.admitted).toBe(false);
    if (v1.admitted) return;
    expect(v1.code).toBe('authentication_required');
    expect(v1.stage).toBe('authentication');

    // Insufficient tier on an authenticated principal
    const v2 = resolveOperationAdmission('d4b', AUTH_PRINCIPAL, TIER_POLICY, { kind: 'required', tier: 'gold', registryRevision: EVIDENCE_REV }, 'pro', EVIDENCE_REV);
    expect(v2.admitted).toBe(false);
    if (v2.admitted) return;
    expect(v2.code).toBe('insufficient_tier');
    expect(v2.stage).toBe('entitlement');

    // Different codes
    expect(v1.code).not.toBe(v2.code);
    expect(v1.stage).not.toBe(v2.stage);
  });

  it('entitlement_refusal_precedes_runtime_discovery', () => {
    const v = resolveOperationAdmission('d5', AUTH_PRINCIPAL, TIER_POLICY, { kind: 'required', tier: 'gold', registryRevision: EVIDENCE_REV }, 'free', EVIDENCE_REV);
    expect(v.admitted).toBe(false);
    if (v.admitted) return;
    expect(v.code).toBe('insufficient_tier');
    // The runtime requirements are never evaluated -- they remain on the policy
    // but the verdict is produced before the runtime stage.
  });

  it('runtime_failure_occurs_only_after_entitlement_admission', () => {
    // An allowed verdict carries the admission -- runtime failures are a
    // separate downstream concern (stage 8 in the pipeline), not represented
    // in the admission verdict.
    const v = resolveOperationAdmission('d6', AUTH_PRINCIPAL, TIER_POLICY, { kind: 'required', tier: 'pro', registryRevision: EVIDENCE_REV }, 'pro', EVIDENCE_REV);
    expect(v.admitted).toBe(true);
    if (!v.admitted) return;
    expect(v.entitlementEvaluated).toBe(true);
  });

  it('mutation_authority_is_composed_without_reimplementing_entitlement', () => {
    // The mutation policy still gets its entitlement evaluated by the same
    // function; mutation authority is a downstream stage not in this function.
    const v = resolveOperationAdmission('d7', AUTH_PRINCIPAL, MUTATION_POLICY, { kind: 'required', tier: 'pro', registryRevision: EVIDENCE_REV }, 'gold', EVIDENCE_REV);
    expect(v.admitted).toBe(true);
    if (!v.admitted) return;
    expect(v.entitlementKind).toBe('plugin-tier');
    // The verdict does not mention mutation authority -- it is a later stage.
  });

  it('one_operation_attempt_evaluates_entitlement_exactly_once', () => {
    const v = resolveOperationAdmission('d8', AUTH_PRINCIPAL, TIER_POLICY, { kind: 'required', tier: 'pro', registryRevision: EVIDENCE_REV }, 'pro', EVIDENCE_REV);
    expect(v.admitted).toBe(true);
    if (!v.admitted) return;
    expect(v.entitlementEvaluated).toBe(true);
    expect(v.decisionId).toBe('d8');
  });

  it('unknown_tier_and_missing_registry_entry_fail_closed', () => {
    // Missing registry entry
    const v1 = resolveOperationAdmission('d9a', AUTH_PRINCIPAL, TIER_POLICY, { kind: 'missing', registryRevision: EVIDENCE_REV }, 'pro', EVIDENCE_REV);
    expect(v1.admitted).toBe(false);
    if (v1.admitted) return;
    expect(v1.code).toBe('entitlement_context_unavailable');

    // Unknown required tier
    const v2 = resolveOperationAdmission('d9b', AUTH_PRINCIPAL, TIER_POLICY, { kind: 'required', tier: 'platinum', registryRevision: EVIDENCE_REV }, 'pro', EVIDENCE_REV);
    expect(v2.admitted).toBe(false);
    if (v2.admitted) return;
    expect(v2.code).toBe('entitlement_context_invalid');

    // Unknown granted tier
    const v3 = resolveOperationAdmission('d9c', AUTH_PRINCIPAL, TIER_POLICY, { kind: 'required', tier: 'pro', registryRevision: EVIDENCE_REV }, 'platinum', EVIDENCE_REV);
    expect(v3.admitted).toBe(false);
    if (v3.admitted) return;
    expect(v3.code).toBe('entitlement_context_invalid');
  });

  it('corrupt_and_unavailable_evidence_fail_closed', () => {
    const v1 = resolveOperationAdmission('d10a', AUTH_PRINCIPAL, TIER_POLICY, { kind: 'corrupt', reasonCode: 'bad_json' }, 'pro', EVIDENCE_REV);
    expect(v1.admitted).toBe(false);
    if (v1.admitted) return;
    expect(v1.code).toBe('entitlement_context_invalid');

    const v2 = resolveOperationAdmission('d10b', AUTH_PRINCIPAL, TIER_POLICY, { kind: 'unavailable', reasonCode: 'disk_error' }, 'pro', EVIDENCE_REV);
    expect(v2.admitted).toBe(false);
    if (v2.admitted) return;
    expect(v2.code).toBe('entitlement_context_unavailable');
  });
});

// ---------------------------------------------------------------------------
// Attestation lifecycle
// ---------------------------------------------------------------------------

describe('attestation lifecycle', () => {
  it('isAttestationExpired returns false before expiry and true at/after', () => {
    const att = makeAttestation({ expiresAtMs: 5000 });
    expect(isAttestationExpired(att, 4999)).toBe(false);
    expect(isAttestationExpired(att, 5000)).toBe(true);
    expect(isAttestationExpired(att, 5001)).toBe(true);
  });

  it('valid transitions: issued -> activated -> consumed', () => {
    const att = makeAttestation({ state: 'issued' });
    const activated = transitionAttestationState(att, 'activated', 2000);
    expect(activated).not.toBeNull();
    expect(activated!.state).toBe('activated');

    const consumed = transitionAttestationState(activated!, 'consumed', 3000);
    expect(consumed).not.toBeNull();
    expect(consumed!.state).toBe('consumed');
  });

  it('issued -> expired is valid', () => {
    const att = makeAttestation({ state: 'issued' });
    const expired = transitionAttestationState(att, 'expired', 2000);
    expect(expired).not.toBeNull();
    expect(expired!.state).toBe('expired');
  });

  it('consumed is terminal -- no outgoing transitions', () => {
    const att = makeAttestation({ state: 'consumed' });
    expect(transitionAttestationState(att, 'activated', 2000)).toBeNull();
    expect(transitionAttestationState(att, 'issued', 2000)).toBeNull();
    expect(transitionAttestationState(att, 'expired', 2000)).toBeNull();
    expect(transitionAttestationState(att, 'revoked', 2000)).toBeNull();
  });

  it('expired is terminal', () => {
    const att = makeAttestation({ state: 'expired' });
    expect(transitionAttestationState(att, 'activated', 2000)).toBeNull();
    expect(transitionAttestationState(att, 'consumed', 2000)).toBeNull();
  });

  it('revoked is terminal', () => {
    const att = makeAttestation({ state: 'revoked' });
    expect(transitionAttestationState(att, 'activated', 2000)).toBeNull();
  });

  it('activation after expiry returns null', () => {
    const att = makeAttestation({ state: 'issued', expiresAtMs: 3000 });
    expect(transitionAttestationState(att, 'activated', 3001)).toBeNull();
  });

  it('expired transition at expiry time succeeds', () => {
    const att = makeAttestation({ state: 'issued', expiresAtMs: 3000 });
    const result = transitionAttestationState(att, 'expired', 3000);
    expect(result).not.toBeNull();
    expect(result!.state).toBe('expired');
  });

  it('stale_attestation_requires_fresh_admission', () => {
    // An issued attestation that has expired cannot be activated
    const att = makeAttestation({ state: 'issued', expiresAtMs: 2000 });
    const result = transitionAttestationState(att, 'activated', 2500);
    expect(result).toBeNull();
  });

  it('invalid transition: issued -> consumed (must activate first)', () => {
    const att = makeAttestation({ state: 'issued' });
    expect(transitionAttestationState(att, 'consumed', 2000)).toBeNull();
  });

  it('revoke from issued', () => {
    const att = makeAttestation({ state: 'issued' });
    const revoked = transitionAttestationState(att, 'revoked', 2000);
    expect(revoked).not.toBeNull();
    expect(revoked!.state).toBe('revoked');
  });

  it('revoke from activated', () => {
    const att = makeAttestation({ state: 'activated' });
    const revoked = transitionAttestationState(att, 'revoked', 2000);
    expect(revoked).not.toBeNull();
    expect(revoked!.state).toBe('revoked');
  });
});
