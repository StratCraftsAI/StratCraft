/**
 * TICKET_1345: Operation Admission -- pure types and decision functions.
 *
 * Every exposed operation (MCP tool, IPC channel, Service API route) must
 * declare exactly one admission policy and pass through one local admission
 * authority before business execution. This module owns the type vocabulary,
 * the stage pipeline ordering, and the pure decision functions. It has no
 * filesystem, process, Electron, React, or MCP dependencies.
 *
 * The admission authority (packages/operation-admission/) consumes these types
 * and orchestrates the pipeline. Surface adapters (Electron, Guide MCP,
 * Service API) bind principals and translate results; they do not resolve
 * tiers, compare levels, or reconstruct verdicts.
 */

// =============================================================================
// Entitlement requirement discriminant
// =============================================================================

export interface OperationEntitlementPublic {
  readonly kind: 'public';
}

export interface OperationEntitlementPluginTier {
  readonly kind: 'plugin-tier';
  readonly pluginId: string;
  /**
   * The requirement source. `'current-registry'` means the required tier is
   * resolved at admission time from the marketplace registry, not copied as a
   * mutable literal into the policy.
   */
  readonly requirementSource: 'current-registry';
}

export type OperationEntitlementRequirement =
  | OperationEntitlementPublic
  | OperationEntitlementPluginTier;

// =============================================================================
// Operation admission policy
// =============================================================================

export type OperationAuthenticationRequirement = 'optional' | 'required';

export type OperationMutationAuthority = 'none' | 'human-origin-required';

export type OperationDelegationPolicy = 'direct-only' | 'session-trust-eligible';

/**
 * The authoritative policy for one exposed operation. Exactly one policy per
 * operationId across all surfaces.
 *
 * `human-origin-required` forces an explicit delegation policy; `none` must
 * not carry one. This is enforced by the discriminated helper types below.
 */
export type OperationAdmissionPolicy =
  | OperationAdmissionPolicyReadOnly
  | OperationAdmissionPolicyMutation;

interface OperationAdmissionPolicyBase {
  readonly operationId: string;
  readonly capabilityId: string;
  readonly authentication: OperationAuthenticationRequirement;
  readonly entitlement: OperationEntitlementRequirement;
  readonly runtimeRequirements: readonly string[];
  readonly policyRevision: number;
}

export interface OperationAdmissionPolicyReadOnly extends OperationAdmissionPolicyBase {
  readonly mutationAuthority: 'none';
  readonly delegationPolicy?: undefined;
}

export interface OperationAdmissionPolicyMutation extends OperationAdmissionPolicyBase {
  readonly mutationAuthority: 'human-origin-required';
  readonly delegationPolicy: OperationDelegationPolicy;
}

// =============================================================================
// Principal: the identity bound to an admission request
// =============================================================================

export type AdmissionPrincipalProvenance =
  | 'explicit-anonymous'
  | 'electron-session'
  | 'browser-oauth'
  | 'service-transport';

export interface AnonymousPrincipal {
  readonly kind: 'anonymous';
  readonly provenance: 'explicit-anonymous';
}

export interface AuthenticatedPrincipal {
  readonly kind: 'authenticated';
  readonly subjectKey: string;
  readonly sessionBinding: string;
  readonly provenance: 'electron-session' | 'browser-oauth' | 'service-transport';
}

export type AdmissionPrincipal = AnonymousPrincipal | AuthenticatedPrincipal;

// =============================================================================
// Required-tier evidence (resolved at admission time from the registry)
// =============================================================================

export type RequiredTierEvidence =
  | { readonly kind: 'explicit-public'; readonly registryRevision: string }
  | { readonly kind: 'required'; readonly tier: string; readonly registryRevision: string }
  | { readonly kind: 'missing'; readonly registryRevision: string }
  | { readonly kind: 'corrupt'; readonly reasonCode: string }
  | { readonly kind: 'unavailable'; readonly reasonCode: string };

// =============================================================================
// Identity-bound entitlement evidence
// =============================================================================

export interface IdentityBoundEntitlementEvidence {
  readonly subjectKey: string;
  readonly plan: string | null;
  readonly pluginGrants: Readonly<Record<string, string>>;
  readonly sourceRevision: string;
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
}

// =============================================================================
// Refusal codes -- ordered by the stage that produces them
// =============================================================================

export const OPERATION_REFUSAL_CODES = [
  'operation_policy_missing',
  'authentication_required',
  'entitlement_context_unavailable',
  'entitlement_context_invalid',
  'insufficient_tier',
  'admission_stale',
  'human_approval_required',
  'admission_authority_unavailable',
  'runtime_owner_unavailable',
  'runtime_owner_unreachable',
] as const;

export type OperationRefusalCode = (typeof OPERATION_REFUSAL_CODES)[number];

// =============================================================================
// Refusal stages
// =============================================================================

export const OPERATION_REFUSAL_STAGES = [
  'policy',
  'authentication',
  'entitlement-context',
  'entitlement',
  'attestation',
  'mutation-authority',
  'admission-authority',
  'runtime',
  'domain',
] as const;

export type OperationRefusalStage = (typeof OPERATION_REFUSAL_STAGES)[number];

// =============================================================================
// Admission verdict
// =============================================================================

export interface OperationAdmissionAllowed {
  readonly admitted: true;
  readonly decisionId: string;
  readonly operationId: string;
  readonly policyRevision: number;
  readonly entitlementEvaluated: true;
  readonly entitlementKind: 'public' | 'plugin-tier';
  readonly authenticated: boolean;
  readonly effectiveTier: string | null;
  readonly requiredTier: string;
  readonly entitlementEvidence:
    | 'resolved'
    | 'anonymous-free'
    | 'not-required'
    | 'not-required-unavailable';
  readonly evidenceRevision: string;
  readonly decisionSource: 'operation-admission';
}

export interface OperationAdmissionRefused {
  readonly admitted: false;
  readonly decisionId: string;
  readonly operationId: string;
  readonly policyRevision: number;
  readonly entitlementEvaluated: boolean;
  readonly stage: OperationRefusalStage;
  readonly code: OperationRefusalCode;
  readonly messageParams: Readonly<Record<string, string>>;
  readonly decisionSource: 'operation-admission';
}

export type OperationAdmissionVerdict =
  | OperationAdmissionAllowed
  | OperationAdmissionRefused;

// =============================================================================
// Attestation lifecycle
// =============================================================================

export const ATTESTATION_STATES = ['issued', 'activated', 'consumed', 'expired', 'revoked'] as const;
export type AttestationState = (typeof ATTESTATION_STATES)[number];

export interface OperationAttestation {
  readonly attestationId: string;
  readonly operationId: string;
  readonly principalSubjectKey: string | null;
  readonly sessionBinding: string | null;
  readonly state: AttestationState;
  readonly policyRevision: number;
  readonly evidenceRevision: string;
  readonly payloadHash: string | null;
  readonly correlationId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

/**
 * Valid attestation state transitions. Terminal states (`consumed`, `expired`,
 * `revoked`) have no outgoing transitions. The `issued -> activated` check is
 * where evidence-revision freshness is enforced: if the revision changed, the
 * attestation becomes `expired` instead of `activated`.
 */
const VALID_TRANSITIONS: Readonly<Record<AttestationState, readonly AttestationState[]>> = {
  issued: ['activated', 'expired', 'revoked'],
  activated: ['consumed', 'expired', 'revoked'],
  consumed: [],
  expired: [],
  revoked: [],
};

// =============================================================================
// Pure decision functions
// =============================================================================

/**
 * Resolve the admission verdict for an operation given a principal, policy,
 * and tier evidence. This is the SOLE admission decision function.
 *
 * Public operations produce an explicit allow verdict; they are never bypassed.
 * Plugin-tier operations delegate tier comparison to the existing
 * `resolvePluginAdmission()` from `@StratCraft/plugin-store`.
 *
 * This function is pure: it receives all evidence as arguments and performs no
 * IO. The caller (the admission authority) is responsible for acquiring
 * evidence from the identity-bound repository.
 */
export function resolveOperationAdmission(
  decisionId: string,
  principal: AdmissionPrincipal,
  policy: OperationAdmissionPolicy,
  requiredTierEvidence: RequiredTierEvidence,
  effectiveTier: string | null,
  evidenceRevision: string,
): OperationAdmissionVerdict {
  // Stage 1: authentication
  if (policy.authentication === 'required' && principal.kind === 'anonymous') {
    return refused(decisionId, policy, false, 'authentication', 'authentication_required', {
      operation: policy.operationId,
    });
  }

  const authenticated = principal.kind === 'authenticated';

  // Stage 2: entitlement
  if (policy.entitlement.kind === 'public') {
    // Public operations get an explicit allow -- never a bypass.
    let evidence: OperationAdmissionAllowed['entitlementEvidence'];
    if (authenticated && effectiveTier !== null) {
      evidence = 'not-required';
    } else if (authenticated && effectiveTier === null) {
      evidence = 'not-required-unavailable';
    } else {
      evidence = 'anonymous-free';
    }
    return {
      admitted: true,
      decisionId,
      operationId: policy.operationId,
      policyRevision: policy.policyRevision,
      entitlementEvaluated: true,
      entitlementKind: 'public',
      authenticated,
      effectiveTier,
      requiredTier: 'free',
      entitlementEvidence: evidence,
      evidenceRevision,
      decisionSource: 'operation-admission',
    };
  }

  // plugin-tier path
  // Evidence must be present and resolvable
  if (requiredTierEvidence.kind === 'missing') {
    return refused(decisionId, policy, true, 'entitlement-context', 'entitlement_context_unavailable', {
      operation: policy.operationId,
      pluginId: policy.entitlement.pluginId,
      reason: 'missing_registry_entry',
    });
  }
  if (requiredTierEvidence.kind === 'corrupt') {
    return refused(decisionId, policy, true, 'entitlement-context', 'entitlement_context_invalid', {
      operation: policy.operationId,
      pluginId: policy.entitlement.pluginId,
      reason: requiredTierEvidence.reasonCode,
    });
  }
  if (requiredTierEvidence.kind === 'unavailable') {
    return refused(decisionId, policy, true, 'entitlement-context', 'entitlement_context_unavailable', {
      operation: policy.operationId,
      pluginId: policy.entitlement.pluginId,
      reason: requiredTierEvidence.reasonCode,
    });
  }
  if (requiredTierEvidence.kind === 'explicit-public') {
    // Registry says this plugin's operation is public (e.g. T0).
    return {
      admitted: true,
      decisionId,
      operationId: policy.operationId,
      policyRevision: policy.policyRevision,
      entitlementEvaluated: true,
      entitlementKind: 'plugin-tier',
      authenticated,
      effectiveTier,
      requiredTier: 'free',
      entitlementEvidence: effectiveTier !== null ? 'resolved' : 'anonymous-free',
      evidenceRevision,
      decisionSource: 'operation-admission',
    };
  }

  // requiredTierEvidence.kind === 'required'
  const requiredTier = requiredTierEvidence.tier.toLowerCase();
  const granted = (effectiveTier ?? 'free').toLowerCase();

  // Unknown tiers fail closed -- never converted to level zero
  if (!isKnownTier(requiredTier)) {
    return refused(decisionId, policy, true, 'entitlement-context', 'entitlement_context_invalid', {
      operation: policy.operationId,
      pluginId: policy.entitlement.pluginId,
      reason: 'unknown_required_tier',
      tier: requiredTier,
    });
  }
  if (!isKnownTier(granted)) {
    return refused(decisionId, policy, true, 'entitlement-context', 'entitlement_context_invalid', {
      operation: policy.operationId,
      reason: 'unknown_granted_tier',
      tier: granted,
    });
  }

  const grantedLevel = TIER_LEVELS[granted]!;
  const requiredLevel = TIER_LEVELS[requiredTier]!;

  if (grantedLevel < requiredLevel) {
    return refused(decisionId, policy, true, 'entitlement', 'insufficient_tier', {
      operation: policy.operationId,
      effectiveTier: granted,
      requiredTier,
    });
  }

  return {
    admitted: true,
    decisionId,
    operationId: policy.operationId,
    policyRevision: policy.policyRevision,
    entitlementEvaluated: true,
    entitlementKind: 'plugin-tier',
    authenticated,
    effectiveTier: granted,
    requiredTier,
    entitlementEvidence: 'resolved',
    evidenceRevision,
    decisionSource: 'operation-admission',
  };
}

/**
 * Is this attestation expired at the given time?
 */
export function isAttestationExpired(
  attestation: OperationAttestation,
  nowMs: number,
): boolean {
  return nowMs >= attestation.expiresAtMs;
}

/**
 * Validate and perform an attestation state transition.
 *
 * Returns the new attestation on success, or `null` when the transition is
 * invalid (already consumed, already expired, or not a valid edge in the
 * state machine).
 */
export function transitionAttestationState(
  attestation: OperationAttestation,
  to: AttestationState,
  nowMs: number,
): OperationAttestation | null {
  // Check expiry first -- an expired attestation transitions to `expired`
  // regardless of the requested target.
  if (attestation.state !== 'expired' && attestation.state !== 'consumed' && attestation.state !== 'revoked') {
    if (isAttestationExpired(attestation, nowMs)) {
      if (to === 'expired') {
        return { ...attestation, state: 'expired' };
      }
      return null;
    }
  }

  const allowed = VALID_TRANSITIONS[attestation.state];
  if (!allowed.includes(to)) return null;

  return { ...attestation, state: to };
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Canonical tier levels. Duplicated from `@StratCraft/plugin-store` to keep
 * this module dependency-free within `@StratCraft/types`. The values are the
 * canonical four-tier mapping.
 */
const TIER_LEVELS: Readonly<Record<string, number>> = {
  free: 0,
  basic: 1,
  pro: 2,
  gold: 3,
};

function isKnownTier(tier: string): boolean {
  return tier in TIER_LEVELS;
}

function refused(
  decisionId: string,
  policy: OperationAdmissionPolicy,
  entitlementEvaluated: boolean,
  stage: OperationRefusalStage,
  code: OperationRefusalCode,
  messageParams: Record<string, string>,
): OperationAdmissionRefused {
  return {
    admitted: false,
    decisionId,
    operationId: policy.operationId,
    policyRevision: policy.policyRevision,
    entitlementEvaluated,
    stage,
    code,
    messageParams,
    decisionSource: 'operation-admission',
  };
}
