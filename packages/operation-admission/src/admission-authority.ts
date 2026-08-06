/**
 * TICKET_1345: Operation Admission Authority.
 *
 * The single local admission owner across Electron and Guide. Exactly one
 * instance runs at a time. Surface adapters (Electron IPC, MCP, Service API)
 * call `admit()` to produce a bound attestation, `activate()` before
 * business-runtime discovery, `consume()` at the dispatch boundary, and
 * `finalize()` to emit one terminal lifecycle record.
 *
 * Purity boundary: this class has no filesystem, process, or network
 * dependencies. All IO is behind the injected `EntitlementEvidenceRepository`.
 */

import type {
  AdmissionPrincipal,
  OperationAdmissionPolicy,
  OperationAdmissionVerdict,
  OperationAttestation,
  AttestationState,
  RequiredTierEvidence,
  IdentityBoundEntitlementEvidence,
  OperationRefusalStage,
  OperationRefusalCode,
  OperationAdmissionRefused,
  MarketplaceEligibilityRequest,
  MarketplaceEligibilityResult,
  MarketplaceMutationRequest,
  MarketplaceAttestation,
  MarketplaceProductEvidence,
  SigmaOperationId,
} from '@StratCraft/types';
import {
  resolveOperationAdmission,
  transitionAttestationState,
  isAttestationExpired,
  resolveMarketplaceEligibilityVerdict,
  MARKETPLACE_ELIGIBILITY_CONTRACT_VERSION,
  SIGMA_PRODUCT_ID,
} from '@StratCraft/types';
import { resolveUserTier } from '@StratCraft/plugin-store';
import type { FrozenPolicyRegistry } from './policy-registry';

// =============================================================================
// Evidence repository interface (the IO boundary)
// =============================================================================

export interface EntitlementEvidenceRepository {
  acquireEvidence(
    principal: AdmissionPrincipal,
    pluginId: string,
  ): Promise<IdentityBoundEntitlementEvidence | null>;

  resolveRequiredTierEvidence(pluginId: string): Promise<RequiredTierEvidence>;

  currentRevision(): string;
}

// =============================================================================
// Request / result types
// =============================================================================

export interface OperationAdmissionRequest {
  readonly operationId: string;
  readonly principal: AdmissionPrincipal;
  readonly payloadHash?: string;
  readonly correlationId?: string;
}

export type OperationAdmissionResult =
  | { readonly kind: 'admitted'; readonly verdict: OperationAdmissionVerdict & { admitted: true }; readonly attestation: OperationAttestation }
  | { readonly kind: 'refused'; readonly verdict: OperationAdmissionRefused };

export type AttestationActivationResult =
  | { readonly kind: 'activated'; readonly attestation: OperationAttestation }
  | { readonly kind: 'stale'; readonly code: 'admission_stale' }
  | { readonly kind: 'invalid'; readonly reason: string };

export type AttestationConsumptionResult =
  | { readonly kind: 'consumed'; readonly attestation: OperationAttestation }
  | { readonly kind: 'invalid'; readonly reason: string };

export interface DispatchBinding {
  readonly surface: string;
  readonly route: string;
}

export interface SanitizedOperationOutcome {
  readonly stage: OperationRefusalStage | 'completed';
  readonly code: string;
  readonly runtimeOwner?: string;
}

export interface OperationLifecycleRecord {
  readonly correlationId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly policyRevision: number;
  readonly entitlementKind: 'public' | 'plugin-tier';
  readonly effectiveTier: string | null;
  readonly requiredTier: string;
  readonly principalProvenance: string;
  readonly evidenceRevision: string;
  readonly decisionSource: 'operation-admission';
  readonly outcome: string;
  readonly attestationState: AttestationState;
  readonly authorityInstance: string;
  readonly surface: string;
  readonly timestampMs: number;
}

// =============================================================================
// Authority
// =============================================================================

const ATTESTATION_TTL_MS = 30_000;
const MARKETPLACE_ELIGIBILITY_TTL_MS = 60_000;
const MARKETPLACE_ELIGIBILITY_REFUSED_TTL_MS = 30_000;

let idCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++idCounter).toString(36)}`;
}

export type MarketplaceAdmissionResult =
  | { readonly kind: 'admitted'; readonly verdict: OperationAdmissionVerdict & { admitted: true }; readonly attestation: MarketplaceAttestation }
  | { readonly kind: 'refused'; readonly verdict: OperationAdmissionRefused };

export type MarketplaceActivationResult =
  | { readonly kind: 'activated'; readonly attestation: MarketplaceAttestation }
  | { readonly kind: 'stale'; readonly code: 'admission_stale' }
  | { readonly kind: 'invalid'; readonly reason: string };

export type MarketplaceConsumptionResult =
  | { readonly kind: 'consumed'; readonly attestation: MarketplaceAttestation }
  | { readonly kind: 'invalid'; readonly reason: string };

export class OperationAdmissionAuthority {
  private readonly attestations = new Map<string, OperationAttestation>();
  private readonly marketplaceAttestations = new Map<string, MarketplaceAttestation>();
  private readonly lifecycleRecords: OperationLifecycleRecord[] = [];
  readonly instanceId: string;

  constructor(
    private readonly registry: FrozenPolicyRegistry,
    private readonly evidenceRepo: EntitlementEvidenceRepository,
    instanceId?: string,
  ) {
    this.instanceId = instanceId ?? generateId('auth');
  }

  async admit(request: OperationAdmissionRequest): Promise<OperationAdmissionResult> {
    const correlationId = request.correlationId ?? generateId('corr');
    const decisionId = generateId('dec');

    // Stage 2: resolve the registered operation policy
    const policy = this.registry.lookup(request.operationId);
    if (!policy) {
      const verdict: OperationAdmissionRefused = {
        admitted: false,
        decisionId,
        operationId: request.operationId,
        policyRevision: 0,
        entitlementEvaluated: false,
        stage: 'policy',
        code: 'operation_policy_missing',
        messageParams: { operation: request.operationId },
        decisionSource: 'operation-admission',
      };
      return { kind: 'refused', verdict };
    }

    // Stages 3-4: resolve entitlement evidence
    let requiredTierEvidence: RequiredTierEvidence;
    let effectiveTier: string | null = null;
    let evidenceRevision = this.evidenceRepo.currentRevision();

    if (policy.entitlement.kind === 'public') {
      requiredTierEvidence = { kind: 'explicit-public', registryRevision: evidenceRevision };
      // For public policies with optional auth, try to get the effective tier
      if (request.principal.kind === 'authenticated') {
        const evidence = await this.evidenceRepo.acquireEvidence(
          request.principal,
          '',
        );
        if (evidence) {
          effectiveTier = evidence.plan?.toLowerCase() ?? 'free';
        }
      }
    } else {
      // plugin-tier
      requiredTierEvidence = await this.evidenceRepo.resolveRequiredTierEvidence(
        policy.entitlement.pluginId,
      );
      evidenceRevision = this.evidenceRepo.currentRevision();

      if (request.principal.kind === 'authenticated') {
        const evidence = await this.evidenceRepo.acquireEvidence(
          request.principal,
          policy.entitlement.pluginId,
        );
        if (evidence) {
          effectiveTier = resolveUserTier(policy.entitlement.pluginId, {
            plan: evidence.plan ?? undefined,
            pluginTierOverrides: evidence.pluginGrants as Record<string, string>,
          });
        }
      }
    }

    // Stage 5: produce verdict
    const verdict = resolveOperationAdmission(
      decisionId,
      request.principal,
      policy,
      requiredTierEvidence,
      effectiveTier,
      evidenceRevision,
    );

    if (!verdict.admitted) {
      return { kind: 'refused', verdict };
    }

    // Issue attestation
    const attestationId = generateId('att');
    const nowMs = Date.now();
    const attestation: OperationAttestation = {
      attestationId,
      operationId: policy.operationId,
      principalSubjectKey: request.principal.kind === 'authenticated'
        ? request.principal.subjectKey : null,
      sessionBinding: request.principal.kind === 'authenticated'
        ? request.principal.sessionBinding : null,
      state: 'issued',
      policyRevision: policy.policyRevision,
      evidenceRevision,
      payloadHash: request.payloadHash ?? null,
      correlationId,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + ATTESTATION_TTL_MS,
    };

    this.attestations.set(attestationId, attestation);
    return { kind: 'admitted', verdict, attestation };
  }

  activate(
    attestationId: string,
    currentEvidenceRevision?: string,
  ): AttestationActivationResult {
    const att = this.attestations.get(attestationId);
    if (!att) return { kind: 'invalid', reason: 'attestation_not_found' };

    // Check evidence revision freshness
    if (currentEvidenceRevision !== undefined && att.evidenceRevision !== currentEvidenceRevision) {
      const expired = transitionAttestationState(att, 'expired', Date.now());
      if (expired) this.attestations.set(attestationId, expired);
      return { kind: 'stale', code: 'admission_stale' };
    }

    const nowMs = Date.now();
    const activated = transitionAttestationState(att, 'activated', nowMs);
    if (!activated) {
      if (isAttestationExpired(att, nowMs)) {
        const expired = transitionAttestationState(att, 'expired', nowMs);
        if (expired) this.attestations.set(attestationId, expired);
        return { kind: 'stale', code: 'admission_stale' };
      }
      return { kind: 'invalid', reason: `cannot transition from ${att.state} to activated` };
    }

    this.attestations.set(attestationId, activated);
    return { kind: 'activated', attestation: activated };
  }

  consume(
    attestationId: string,
    _dispatch: DispatchBinding,
  ): AttestationConsumptionResult {
    const att = this.attestations.get(attestationId);
    if (!att) return { kind: 'invalid', reason: 'attestation_not_found' };

    const nowMs = Date.now();
    const consumed = transitionAttestationState(att, 'consumed', nowMs);
    if (!consumed) {
      if (isAttestationExpired(att, nowMs)) {
        const expired = transitionAttestationState(att, 'expired', nowMs);
        if (expired) this.attestations.set(attestationId, expired);
      }
      return { kind: 'invalid', reason: `cannot transition from ${att.state} to consumed` };
    }

    this.attestations.set(attestationId, consumed);
    return { kind: 'consumed', attestation: consumed };
  }

  finalize(
    attestationId: string,
    outcome: SanitizedOperationOutcome,
    surface: string,
  ): OperationLifecycleRecord | null {
    const att = this.attestations.get(attestationId);
    if (!att) return null;

    const policy = this.registry.lookup(att.operationId);
    if (!policy) return null;

    const record: OperationLifecycleRecord = {
      correlationId: att.correlationId,
      operationId: att.operationId,
      capabilityId: policy.capabilityId,
      policyRevision: att.policyRevision,
      entitlementKind: policy.entitlement.kind === 'public' ? 'public' : 'plugin-tier',
      effectiveTier: null,
      requiredTier: policy.entitlement.kind === 'public' ? 'free' : 'unknown',
      principalProvenance: att.principalSubjectKey ? 'authenticated' : 'anonymous',
      evidenceRevision: att.evidenceRevision,
      decisionSource: 'operation-admission',
      outcome: outcome.code,
      attestationState: att.state,
      authorityInstance: this.instanceId,
      surface,
      timestampMs: Date.now(),
    };

    this.lifecycleRecords.push(record);

    // Clean up the attestation from the in-memory store
    this.attestations.delete(attestationId);

    return record;
  }

  getAttestation(attestationId: string): OperationAttestation | undefined {
    return this.attestations.get(attestationId);
  }

  getLifecycleRecords(): readonly OperationLifecycleRecord[] {
    return this.lifecycleRecords;
  }

  // ===========================================================================
  // TICKET_1368 Phase 1: Marketplace-specific admission
  // ===========================================================================

  async resolveMarketplaceEligibility(
    request: MarketplaceEligibilityRequest,
  ): Promise<MarketplaceEligibilityResult> {
    const correlationId = request.correlationId ?? generateId('corr');
    const decisionId = generateId('elig');
    const nowMs = Date.now();

    const genericResult = await this.admit({
      operationId: request.operationId,
      principal: request.principal,
      payloadHash: request.payloadHash,
      correlationId,
    });

    const admitted = genericResult.kind === 'admitted';
    const refusalCode = genericResult.kind === 'refused'
      ? genericResult.verdict.code : null;
    const authenticated = request.principal.kind === 'authenticated';
    const effectiveTier = admitted
      ? genericResult.verdict.effectiveTier
      : (genericResult.kind === 'refused'
        ? (genericResult.verdict.messageParams['effectiveTier'] ?? null)
        : null);
    const requiredTier = admitted
      ? genericResult.verdict.requiredTier
      : (genericResult.kind === 'refused'
        ? (genericResult.verdict.messageParams['requiredTier'] ?? 'unknown')
        : 'unknown');

    const { verdict, action } = resolveMarketplaceEligibilityVerdict(
      admitted,
      refusalCode,
      authenticated,
      effectiveTier,
      requiredTier,
      request.productEvidence,
    );

    const evidenceRevision = this.evidenceRepo.currentRevision();

    const ttlMs = verdict === 'installable' || verdict === 'update_available'
      ? MARKETPLACE_ELIGIBILITY_TTL_MS
      : MARKETPLACE_ELIGIBILITY_REFUSED_TTL_MS;

    return {
      contractVersion: MARKETPLACE_ELIGIBILITY_CONTRACT_VERSION,
      productId: SIGMA_PRODUCT_ID,
      verdict,
      action,
      decisionId,
      registryRevision: request.productEvidence.registryRevision,
      entitlementRevision: evidenceRevision,
      resolvedVersion: request.productEvidence.resolvedVersion,
      installedVersion: request.productEvidence.installedVersion,
      currentTier: effectiveTier,
      requiredTier,
      platform: request.productEvidence.platform,
      compatibilityRevision: request.productEvidence.compatibilityResult.revision,
      decidedAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
    };
  }

  async admitMarketplaceMutation(
    request: MarketplaceMutationRequest,
  ): Promise<MarketplaceAdmissionResult> {
    const correlationId = request.correlationId ?? generateId('corr');

    const genericResult = await this.admit({
      operationId: request.operationId,
      principal: request.principal,
      payloadHash: request.payloadHash,
      correlationId,
    });

    if (genericResult.kind === 'refused') {
      return { kind: 'refused', verdict: genericResult.verdict };
    }

    const att = genericResult.attestation;
    const marketplaceAtt: MarketplaceAttestation = {
      attestationId: att.attestationId,
      operationId: att.operationId as SigmaOperationId,
      principalSubjectKey: att.principalSubjectKey,
      sessionBinding: att.sessionBinding,
      state: att.state,
      policyRevision: att.policyRevision,
      evidenceRevision: att.evidenceRevision,
      payloadHash: att.payloadHash,
      correlationId: att.correlationId,
      issuedAtMs: att.issuedAtMs,
      expiresAtMs: att.expiresAtMs,
      productId: SIGMA_PRODUCT_ID,
      resolvedVersion: request.productEvidence.resolvedVersion,
      registryRevision: request.productEvidence.registryRevision,
      entitlementRevision: this.evidenceRepo.currentRevision(),
      compatibilityRevision: request.productEvidence.compatibilityResult.revision,
      eligibilityDecisionId: request.eligibilityDecisionId,
      dispatchRoute: null,
    };

    this.marketplaceAttestations.set(att.attestationId, marketplaceAtt);

    return {
      kind: 'admitted',
      verdict: genericResult.verdict,
      attestation: marketplaceAtt,
    };
  }

  activateMarketplaceAttestation(
    attestationId: string,
    currentEvidenceRevision?: string,
  ): MarketplaceActivationResult {
    const mAtt = this.marketplaceAttestations.get(attestationId);
    if (!mAtt) {
      return { kind: 'invalid', reason: 'marketplace_attestation_not_found' };
    }

    const genericResult = this.activate(attestationId, currentEvidenceRevision);
    if (genericResult.kind !== 'activated') {
      return genericResult;
    }

    const updated: MarketplaceAttestation = { ...mAtt, state: 'activated' };
    this.marketplaceAttestations.set(attestationId, updated);
    return { kind: 'activated', attestation: updated };
  }

  consumeMarketplaceAttestation(
    attestationId: string,
    dispatch: DispatchBinding,
  ): MarketplaceConsumptionResult {
    const mAtt = this.marketplaceAttestations.get(attestationId);
    if (!mAtt) {
      return { kind: 'invalid', reason: 'marketplace_attestation_not_found' };
    }

    const genericResult = this.consume(attestationId, dispatch);
    if (genericResult.kind !== 'consumed') {
      return genericResult;
    }

    const updated: MarketplaceAttestation = {
      ...mAtt,
      state: 'consumed',
      dispatchRoute: dispatch.route,
    };
    this.marketplaceAttestations.set(attestationId, updated);
    return { kind: 'consumed', attestation: updated };
  }

  finalizeMarketplaceAdmission(
    attestationId: string,
    outcome: SanitizedOperationOutcome,
    surface: string,
  ): OperationLifecycleRecord | null {
    this.marketplaceAttestations.delete(attestationId);
    return this.finalize(attestationId, outcome, surface);
  }

  getMarketplaceAttestation(
    attestationId: string,
  ): MarketplaceAttestation | undefined {
    return this.marketplaceAttestations.get(attestationId);
  }
}
