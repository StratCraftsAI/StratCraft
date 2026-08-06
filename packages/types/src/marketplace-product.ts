/**
 * TICKET_1368 Phase 0: Frozen Sigma marketplace product identity.
 *
 * Every Sigma identity, version-pairing rule, host role, and operation name
 * is defined here exactly once. No surface (Electron, Guide WebUI, MCP,
 * Service API) may hardcode another Sigma ID, tier, package pairing, or
 * compatibility rule.
 */

// =============================================================================
// Canonical product identity
// =============================================================================

export const SIGMA_PRODUCT_ID = 'sigma' as const;

export const SIGMA_PRESENTATION_PLUGIN_ID =
  'com.stratcraft.quant-lab-nexus' as const;

export const SIGMA_COMMERCIAL_PACKAGE_ID =
  'com.stratcraft.quant-lab' as const;

export const SIGMA_DISPLAY_NAME = 'Quant Lab (Sigma)' as const;

// =============================================================================
// Required host roles
// =============================================================================

export const SIGMA_REQUIRED_HOST_ROLES = ['electron', 'service-api'] as const;
export type SigmaHostRole = (typeof SIGMA_REQUIRED_HOST_ROLES)[number];

// =============================================================================
// Version-pairing rule
// =============================================================================

/**
 * The presentation plugin and commercial package must share the same major
 * and minor version. Patch divergence is permitted for independent hotfixes.
 */
export const SIGMA_VERSION_PAIRING_RULE = 'major-minor-match' as const;

// =============================================================================
// Operation IDs
// =============================================================================

export const SIGMA_OPERATION_IDS = {
  ELIGIBILITY: 'marketplace:sigma:eligibility',
  INSTALL: 'marketplace:sigma:install',
  UPDATE: 'marketplace:sigma:update',
} as const;

export type SigmaOperationId =
  (typeof SIGMA_OPERATION_IDS)[keyof typeof SIGMA_OPERATION_IDS];

// =============================================================================
// Eligibility verdicts
// =============================================================================

export const SIGMA_ELIGIBILITY_VERDICTS = [
  'signed_out',
  'purchase_required',
  'upgrade_required',
  'installable',
  'installed',
  'update_available',
  'unavailable',
] as const;

export type SigmaEligibilityVerdict =
  (typeof SIGMA_ELIGIBILITY_VERDICTS)[number];

// =============================================================================
// Install terminal states
// =============================================================================

export const SIGMA_INSTALL_TERMINAL_STATES = [
  'ready',
  'restart_required',
  'failed',
  'cancelled',
  'interrupted',
  'invalid',
  'incompatible',
  'rolled_back',
] as const;

export type SigmaInstallTerminalState =
  (typeof SIGMA_INSTALL_TERMINAL_STATES)[number];

// =============================================================================
// Install stages
// =============================================================================

export const SIGMA_INSTALL_STAGES = [
  'registry_resolution',
  'entitlement_resolution',
  'presentation_download',
  'presentation_verification',
  'commercial_download',
  'commercial_verification',
  'staging',
  'publication',
  'activation',
  'readiness',
] as const;

export type SigmaInstallStage = (typeof SIGMA_INSTALL_STAGES)[number];

// =============================================================================
// Compatibility contract
// =============================================================================

export interface SigmaCompatibilityContract {
  readonly minEngineVersion: string;
  readonly maxEngineVersion?: string;
  readonly requiredProtocolVersion: string;
  readonly supportedPlatforms: readonly string[];
}

// =============================================================================
// Phase 1: Marketplace eligibility result
// =============================================================================

export const MARKETPLACE_ELIGIBILITY_CONTRACT_VERSION = '1.0.0' as const;

/**
 * Per-verdict action metadata. Only present for verdicts that direct the user
 * to a specific next step.
 */
export interface MarketplaceEligibilityAction {
  readonly kind: 'login' | 'purchase' | 'upgrade' | 'launch' | 'update' | 'none';
  readonly url?: string;
  readonly label?: string;
}

/**
 * Structured eligibility result wrapping the verdict with all evidence
 * bindings required by the admission authority. Surfaces consume this type;
 * they do not reconstruct a verdict from component evidence.
 */
export interface MarketplaceEligibilityResult {
  readonly contractVersion: typeof MARKETPLACE_ELIGIBILITY_CONTRACT_VERSION;
  readonly productId: typeof SIGMA_PRODUCT_ID;
  readonly verdict: SigmaEligibilityVerdict;
  readonly action: MarketplaceEligibilityAction;
  readonly decisionId: string;
  readonly registryRevision: string;
  readonly entitlementRevision: string;
  readonly resolvedVersion: string | null;
  readonly installedVersion: string | null;
  readonly currentTier: string | null;
  readonly requiredTier: string;
  readonly platform: string;
  readonly compatibilityRevision: string;
  readonly decidedAtMs: number;
  readonly expiresAtMs: number;
}

// =============================================================================
// Phase 1: Product-bound evidence snapshot
// =============================================================================

export interface MarketplaceProductEvidence {
  readonly productId: string;
  readonly resolvedVersion: string | null;
  readonly registryRevision: string;
  readonly compatibilityResult: MarketplaceCompatibilityResult;
  readonly installedVersion: string | null;
  readonly platform: string;
}

export type MarketplaceCompatibilityResult =
  | { readonly kind: 'compatible'; readonly revision: string }
  | { readonly kind: 'incompatible'; readonly reason: string; readonly revision: string }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly revision: string };

// =============================================================================
// Phase 1: Marketplace attestation (extends generic attestation)
// =============================================================================

export interface MarketplaceAttestation {
  readonly attestationId: string;
  readonly operationId: SigmaOperationId;
  readonly principalSubjectKey: string | null;
  readonly sessionBinding: string | null;
  readonly state: import('./operation-admission').AttestationState;
  readonly policyRevision: number;
  readonly evidenceRevision: string;
  readonly payloadHash: string | null;
  readonly correlationId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly productId: typeof SIGMA_PRODUCT_ID;
  readonly resolvedVersion: string | null;
  readonly registryRevision: string;
  readonly entitlementRevision: string;
  readonly compatibilityRevision: string;
  readonly eligibilityDecisionId: string | null;
  readonly dispatchRoute: string | null;
}

// =============================================================================
// Phase 1: Install progress contract
// =============================================================================

export const MARKETPLACE_INSTALL_PROGRESS_CONTRACT_VERSION = '1.0.0' as const;

export interface MarketplaceInstallProgress {
  readonly contractVersion: typeof MARKETPLACE_INSTALL_PROGRESS_CONTRACT_VERSION;
  readonly operationInstanceId: string;
  readonly productId: string;
  readonly requestedVersion: string | null;
  readonly resolvedVersion: string | null;
  readonly currentStage: SigmaInstallStage;
  readonly completedStages: readonly SigmaInstallStage[];
  readonly progressFraction: number;
  readonly startedAtMs: number;
  readonly updatedAtMs: number;
}

// =============================================================================
// Phase 1: Install terminal result
// =============================================================================

export const MARKETPLACE_INSTALL_RESULT_CONTRACT_VERSION = '1.0.0' as const;

export interface MarketplaceInstallResult {
  readonly contractVersion: typeof MARKETPLACE_INSTALL_RESULT_CONTRACT_VERSION;
  readonly operationInstanceId: string;
  readonly productId: string;
  readonly terminalState: SigmaInstallTerminalState;
  readonly resolvedVersion: string | null;
  readonly presentationArtifactHash: string | null;
  readonly commercialArtifactHash: string | null;
  readonly commercialPackageId: string | null;
  readonly hostRoles: readonly SigmaHostRole[];
  readonly restartRequired: boolean;
  readonly failedStage: SigmaInstallStage | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly remediationHint: string | null;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
}

// =============================================================================
// Phase 1: Marketplace eligibility request (pure input to the authority)
// =============================================================================

export interface MarketplaceEligibilityRequest {
  readonly operationId: typeof SIGMA_OPERATION_IDS.ELIGIBILITY;
  readonly principal: import('./operation-admission').AdmissionPrincipal;
  readonly productEvidence: MarketplaceProductEvidence;
  readonly payloadHash?: string;
  readonly correlationId?: string;
}

export interface MarketplaceMutationRequest {
  readonly operationId: typeof SIGMA_OPERATION_IDS.INSTALL | typeof SIGMA_OPERATION_IDS.UPDATE;
  readonly principal: import('./operation-admission').AdmissionPrincipal;
  readonly productEvidence: MarketplaceProductEvidence;
  readonly eligibilityDecisionId: string;
  readonly payloadHash?: string;
  readonly correlationId?: string;
}

// =============================================================================
// Phase 1: Pure eligibility verdict resolver
// =============================================================================

/**
 * Maps the generic admission verdict to a Sigma-specific eligibility verdict.
 * This is the SOLE eligibility mapping function. Surface adapters consume the
 * result; they do not re-derive the verdict from component evidence.
 */
export function resolveMarketplaceEligibilityVerdict(
  admissionAdmitted: boolean,
  refusalCode: string | null,
  authenticated: boolean,
  effectiveTier: string | null,
  requiredTier: string,
  productEvidence: MarketplaceProductEvidence,
): { verdict: SigmaEligibilityVerdict; action: MarketplaceEligibilityAction } {
  if (!authenticated && !admissionAdmitted) {
    return {
      verdict: 'signed_out',
      action: { kind: 'login' },
    };
  }

  if (refusalCode === 'authentication_required') {
    return {
      verdict: 'signed_out',
      action: { kind: 'login' },
    };
  }

  if (productEvidence.compatibilityResult.kind === 'incompatible') {
    return {
      verdict: 'unavailable',
      action: { kind: 'none' },
    };
  }

  if (productEvidence.compatibilityResult.kind === 'unavailable') {
    return {
      verdict: 'unavailable',
      action: { kind: 'none' },
    };
  }

  if (productEvidence.resolvedVersion === null) {
    return {
      verdict: 'unavailable',
      action: { kind: 'none' },
    };
  }

  if (refusalCode === 'insufficient_tier') {
    const tierLevel = MARKETPLACE_TIER_LEVELS[
      (effectiveTier ?? 'free').toLowerCase()
    ] ?? 0;
    const requiredLevel = MARKETPLACE_TIER_LEVELS[requiredTier.toLowerCase()] ?? 999;

    if (tierLevel === 0 || effectiveTier === null) {
      return {
        verdict: 'purchase_required',
        action: { kind: 'purchase' },
      };
    }
    if (tierLevel < requiredLevel) {
      return {
        verdict: 'upgrade_required',
        action: { kind: 'upgrade' },
      };
    }
  }

  if (refusalCode === 'entitlement_context_unavailable' ||
      refusalCode === 'entitlement_context_invalid') {
    return {
      verdict: 'unavailable',
      action: { kind: 'none' },
    };
  }

  if (!admissionAdmitted) {
    return {
      verdict: 'unavailable',
      action: { kind: 'none' },
    };
  }

  if (productEvidence.installedVersion !== null) {
    const installed = productEvidence.installedVersion;
    const resolved = productEvidence.resolvedVersion;
    if (installed !== resolved) {
      return {
        verdict: 'update_available',
        action: { kind: 'update' },
      };
    }
    return {
      verdict: 'installed',
      action: { kind: 'launch' },
    };
  }

  return {
    verdict: 'installable',
    action: { kind: 'none' },
  };
}

// =============================================================================
// Phase 5: Sigma install operation (durable, reconnectable)
// =============================================================================

export const MARKETPLACE_INSTALL_OPERATION_CONTRACT_VERSION = '1.0.0' as const;

export interface SigmaInstallOperation {
  readonly contractVersion: typeof MARKETPLACE_INSTALL_OPERATION_CONTRACT_VERSION;
  readonly operationInstanceId: string;
  readonly productId: typeof SIGMA_PRODUCT_ID;
  readonly attestationId: string;
  readonly principalSubjectKey: string | null;
  readonly sessionBinding: string | null;
  readonly requestedVersion: string | null;
  readonly resolvedVersion: string | null;
  readonly registryRevision: string;
  readonly entitlementRevision: string;
  readonly compatibilityRevision: string;
  readonly payloadHash: string | null;
  readonly dispatchRoute: string;
  readonly currentStage: SigmaInstallStage;
  readonly completedStages: readonly SigmaInstallStage[];
  readonly progressFraction: number;
  readonly terminalState: SigmaInstallTerminalState | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly remediationHint: string | null;
  readonly startedAtMs: number;
  readonly updatedAtMs: number;
  readonly completedAtMs: number | null;
}

// =============================================================================
// Phase 5: Sigma install admission request (Service API body)
// =============================================================================

export interface SigmaInstallAdmissionRequest {
  readonly attestation_id: string;
  readonly evidence_revision: string;
  readonly dispatch_route: string;
}

const MARKETPLACE_TIER_LEVELS: Readonly<Record<string, number>> = {
  free: 0,
  basic: 1,
  pro: 2,
  gold: 3,
};
