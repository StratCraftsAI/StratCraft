/**
 * TICKET_1368 Phase 0: Characterization tests for existing Sigma marketplace
 * admission behavior.
 *
 * These tests document the CURRENT behavior of the admission authority when
 * applied to the frozen Sigma operation policies. They capture:
 *
 * 1. Correct behavior (Electron required-tier from registry).
 * 2. The known MCP defect (required-tier derived from user grants).
 * 3. The `confirm: true` transport boundary (boolean is not evidence).
 *
 * Tests that document a defect are marked with [DEFECT] in the name.
 * They must pass as characterization evidence; Phase 1+ fixes the defect.
 */
import { describe, it, expect } from 'vitest';
import type {
  OperationAdmissionPolicyReadOnly,
  OperationAdmissionPolicyMutation,
  AdmissionPrincipal,
  RequiredTierEvidence,
  IdentityBoundEntitlementEvidence,
} from '@StratCraft/types';
import {
  SIGMA_OPERATION_IDS,
  SIGMA_PRESENTATION_PLUGIN_ID,
  SIGMA_COMMERCIAL_PACKAGE_ID,
  SIGMA_PRODUCT_ID,
  SIGMA_ELIGIBILITY_VERDICTS,
  SIGMA_INSTALL_TERMINAL_STATES,
  SIGMA_INSTALL_STAGES,
  SIGMA_REQUIRED_HOST_ROLES,
  SIGMA_VERSION_PAIRING_RULE,
} from '@StratCraft/types';
import {
  OperationPolicyRegistry,
  OperationAdmissionAuthority,
  SIGMA_MARKETPLACE_POLICIES,
  type EntitlementEvidenceRepository,
} from '../index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOLD_USER: AdmissionPrincipal = {
  kind: 'authenticated',
  subjectKey: 'user-gold',
  sessionBinding: 'sess-gold',
  provenance: 'electron-session',
};

const PRO_USER: AdmissionPrincipal = {
  kind: 'authenticated',
  subjectKey: 'user-pro',
  sessionBinding: 'sess-pro',
  provenance: 'browser-oauth',
};

const FREE_USER: AdmissionPrincipal = {
  kind: 'authenticated',
  subjectKey: 'user-free',
  sessionBinding: 'sess-free',
  provenance: 'electron-session',
};

const ANON: AdmissionPrincipal = {
  kind: 'anonymous',
  provenance: 'explicit-anonymous',
};

function electronRepo(opts: {
  plan: string;
  pluginGrants?: Record<string, string>;
  registryRequiredTier: string;
}): EntitlementEvidenceRepository {
  const rev = 'electron-test-rev';
  return {
    async acquireEvidence(principal) {
      if (principal.kind === 'anonymous') return null;
      return {
        subjectKey: principal.subjectKey,
        plan: opts.plan,
        pluginGrants: opts.pluginGrants ?? {},
        sourceRevision: rev,
        observedAtMs: Date.now(),
        expiresAtMs: Date.now() + 60_000,
      };
    },
    async resolveRequiredTierEvidence(_pluginId) {
      return {
        kind: 'required',
        tier: opts.registryRequiredTier,
        registryRevision: rev,
      };
    },
    currentRevision() { return rev; },
  };
}

function mcpDefectiveRepo(opts: {
  plan: string;
  userGrants: Record<string, string>;
}): EntitlementEvidenceRepository {
  const rev = 'mcp-test-rev';
  return {
    async acquireEvidence(principal) {
      if (principal.kind === 'anonymous') return null;
      return {
        subjectKey: principal.subjectKey,
        plan: opts.plan,
        pluginGrants: opts.userGrants,
        sourceRevision: rev,
        observedAtMs: Date.now(),
        expiresAtMs: Date.now() + 60_000,
      };
    },
    async resolveRequiredTierEvidence(pluginId) {
      const tier = opts.userGrants[pluginId];
      if (tier) {
        return { kind: 'required', tier, registryRevision: rev };
      }
      return { kind: 'missing', registryRevision: rev };
    },
    currentRevision() { return rev; },
  };
}

function buildAuth(
  repo: EntitlementEvidenceRepository,
): OperationAdmissionAuthority {
  const reg = new OperationPolicyRegistry();
  reg.registerAll(SIGMA_MARKETPLACE_POLICIES);
  return new OperationAdmissionAuthority(reg.freeze(), repo, 'sigma-test');
}

// ---------------------------------------------------------------------------
// Frozen identity tests
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 0 -- frozen Sigma product identity', () => {
  it('canonical product ID is sigma', () => {
    expect(SIGMA_PRODUCT_ID).toBe('sigma');
  });

  it('presentation plugin ID is com.stratcraft.quant-lab-nexus', () => {
    expect(SIGMA_PRESENTATION_PLUGIN_ID).toBe('com.stratcraft.quant-lab-nexus');
  });

  it('commercial package ID is com.stratcraft.quant-lab', () => {
    expect(SIGMA_COMMERCIAL_PACKAGE_ID).toBe('com.stratcraft.quant-lab');
  });

  it('operation IDs are fixed', () => {
    expect(SIGMA_OPERATION_IDS.ELIGIBILITY).toBe('marketplace:sigma:eligibility');
    expect(SIGMA_OPERATION_IDS.INSTALL).toBe('marketplace:sigma:install');
    expect(SIGMA_OPERATION_IDS.UPDATE).toBe('marketplace:sigma:update');
  });

  it('required host roles are electron and service-api', () => {
    expect(SIGMA_REQUIRED_HOST_ROLES).toEqual(['electron', 'service-api']);
  });

  it('version-pairing rule is major-minor-match', () => {
    expect(SIGMA_VERSION_PAIRING_RULE).toBe('major-minor-match');
  });

  it('eligibility verdicts are exhaustive', () => {
    expect(SIGMA_ELIGIBILITY_VERDICTS).toEqual([
      'signed_out',
      'purchase_required',
      'upgrade_required',
      'installable',
      'installed',
      'update_available',
      'unavailable',
    ]);
  });

  it('install terminal states are exhaustive', () => {
    expect(SIGMA_INSTALL_TERMINAL_STATES).toEqual([
      'ready',
      'restart_required',
      'failed',
      'cancelled',
      'interrupted',
      'invalid',
      'incompatible',
      'rolled_back',
    ]);
  });

  it('install stages are exhaustive', () => {
    expect(SIGMA_INSTALL_STAGES).toEqual([
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
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sigma policy registration
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 0 -- Sigma policies registered', () => {
  it('registers three Sigma operations', () => {
    expect(SIGMA_MARKETPLACE_POLICIES).toHaveLength(3);
    const ids = SIGMA_MARKETPLACE_POLICIES.map(p => p.operationId);
    expect(ids).toContain(SIGMA_OPERATION_IDS.ELIGIBILITY);
    expect(ids).toContain(SIGMA_OPERATION_IDS.INSTALL);
    expect(ids).toContain(SIGMA_OPERATION_IDS.UPDATE);
  });

  it('eligibility is read-only with required auth', () => {
    const policy = SIGMA_MARKETPLACE_POLICIES.find(
      p => p.operationId === SIGMA_OPERATION_IDS.ELIGIBILITY,
    )!;
    expect(policy.authentication).toBe('required');
    expect(policy.mutationAuthority).toBe('none');
    expect(policy.entitlement).toEqual({
      kind: 'plugin-tier',
      pluginId: SIGMA_PRESENTATION_PLUGIN_ID,
      requirementSource: 'current-registry',
    });
  });

  it('install is mutation with direct-only delegation', () => {
    const policy = SIGMA_MARKETPLACE_POLICIES.find(
      p => p.operationId === SIGMA_OPERATION_IDS.INSTALL,
    )!;
    expect(policy.authentication).toBe('required');
    expect(policy.mutationAuthority).toBe('human-origin-required');
    expect((policy as any).delegationPolicy).toBe('direct-only');
  });

  it('update is mutation with direct-only delegation', () => {
    const policy = SIGMA_MARKETPLACE_POLICIES.find(
      p => p.operationId === SIGMA_OPERATION_IDS.UPDATE,
    )!;
    expect(policy.authentication).toBe('required');
    expect(policy.mutationAuthority).toBe('human-origin-required');
    expect((policy as any).delegationPolicy).toBe('direct-only');
  });

  it('all Sigma policies require marketplace-service runtime', () => {
    for (const policy of SIGMA_MARKETPLACE_POLICIES) {
      expect(policy.runtimeRequirements).toContain('marketplace-service');
    }
  });
});

// ---------------------------------------------------------------------------
// Electron surface -- correct behavior
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 0 -- Electron surface (correct required-tier source)', () => {
  it('gold user is admitted for eligibility when registry requires gold', async () => {
    const auth = buildAuth(electronRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: GOLD_USER,
    });
    expect(result.kind).toBe('admitted');
    if (result.kind === 'admitted') {
      expect(result.verdict.effectiveTier).toBe('gold');
      expect(result.verdict.requiredTier).toBe('gold');
    }
  });

  it('pro user is refused for eligibility when registry requires gold', async () => {
    const auth = buildAuth(electronRepo({ plan: 'pro', registryRequiredTier: 'gold' }));
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: PRO_USER,
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.verdict.code).toBe('insufficient_tier');
    }
  });

  it('free user is refused for eligibility when registry requires gold', async () => {
    const auth = buildAuth(electronRepo({ plan: 'free', registryRequiredTier: 'gold' }));
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: FREE_USER,
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.verdict.code).toBe('insufficient_tier');
    }
  });

  it('anonymous user is refused for eligibility (auth required)', async () => {
    const auth = buildAuth(electronRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: ANON,
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.verdict.code).toBe('authentication_required');
    }
  });

  it('gold user is admitted for install when registry requires gold', async () => {
    const auth = buildAuth(electronRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER,
    });
    expect(result.kind).toBe('admitted');
  });

  it('buyout user with plugin grant is admitted regardless of plan', async () => {
    const auth = buildAuth(electronRepo({
      plan: 'free',
      pluginGrants: { [SIGMA_PRESENTATION_PLUGIN_ID]: 'gold' },
      registryRequiredTier: 'gold',
    }));
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: FREE_USER,
    });
    expect(result.kind).toBe('admitted');
    if (result.kind === 'admitted') {
      expect(result.verdict.effectiveTier).toBe('gold');
    }
  });
});

// ---------------------------------------------------------------------------
// MCP surface -- defective required-tier source (characterization)
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 0 -- [DEFECT] MCP required-tier derived from user grants', () => {
  it('[DEFECT] gold user passes because grant equals grant-derived requirement', async () => {
    const auth = buildAuth(mcpDefectiveRepo({
      plan: 'gold',
      userGrants: { [SIGMA_PRESENTATION_PLUGIN_ID]: 'gold' },
    }));
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: GOLD_USER,
    });
    expect(result.kind).toBe('admitted');
  });

  it('[DEFECT] pro user with pro grant passes because required=pro (should be gold)', async () => {
    const auth = buildAuth(mcpDefectiveRepo({
      plan: 'pro',
      userGrants: { [SIGMA_PRESENTATION_PLUGIN_ID]: 'pro' },
    }));
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: PRO_USER,
    });
    // MCP defect: required tier = user's grant tier (pro), not registry (gold).
    // So a pro user with a pro grant passes -- incorrect for a gold-tier product.
    expect(result.kind).toBe('admitted');
  });

  it('[DEFECT] user with no grant gets missing required tier -- treated as public', async () => {
    const auth = buildAuth(mcpDefectiveRepo({
      plan: 'pro',
      userGrants: {},
    }));
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: PRO_USER,
    });
    // MCP defect: no grant => kind:'missing' => code:'entitlement_context_unavailable'.
    // This is a different failure mode than Electron, which returns the registry tier.
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.verdict.code).toBe('entitlement_context_unavailable');
    }
  });

  it('[DEFECT] cross-surface divergence: same user gets different verdicts', async () => {
    // Electron: registry says gold, user has pro => refused insufficient_tier
    const electronAuth = buildAuth(electronRepo({
      plan: 'pro',
      registryRequiredTier: 'gold',
    }));
    const electronResult = await electronAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: PRO_USER,
    });

    // MCP defective: user grant says pro, so required=pro => admitted
    const mcpAuth = buildAuth(mcpDefectiveRepo({
      plan: 'pro',
      userGrants: { [SIGMA_PRESENTATION_PLUGIN_ID]: 'pro' },
    }));
    const mcpResult = await mcpAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: PRO_USER,
    });

    // Electron correctly refuses; MCP incorrectly admits
    expect(electronResult.kind).toBe('refused');
    expect(mcpResult.kind).toBe('admitted');
  });
});

// ---------------------------------------------------------------------------
// confirm:true boundary (characterization)
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 0 -- confirm:true is not identity-bound evidence', () => {
  it('admission authority does not accept or inspect confirm boolean', async () => {
    const auth = buildAuth(electronRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    // The admit() method has no `confirm` parameter -- it accepts operation,
    // principal, and payloadHash. A transported confirm:true from a browser or
    // model cannot reach the authority decision.
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER,
      payloadHash: 'sha256-test',
    });
    expect(result.kind).toBe('admitted');
    if (result.kind === 'admitted') {
      expect(result.attestation.payloadHash).toBe('sha256-test');
      // Attestation binds principal and payload -- not a confirm boolean.
      expect(result.attestation.principalSubjectKey).toBe('user-gold');
    }
  });

  it('attestation lifecycle prevents replay of admission', async () => {
    const auth = buildAuth(electronRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER,
    });
    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') return;

    const attId = result.attestation.attestationId;

    // Activate
    const activated = auth.activate(attId);
    expect(activated.kind).toBe('activated');

    // Consume
    const consumed = auth.consume(attId, { surface: 'electron', route: 'install' });
    expect(consumed.kind).toBe('consumed');

    // Second consume fails -- single-use
    const replay = auth.consume(attId, { surface: 'electron', route: 'install' });
    expect(replay.kind).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
// Unavailable evidence fails closed
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 0 -- unavailable evidence fails closed', () => {
  it('unavailable required-tier evidence refuses admission', async () => {
    const repo: EntitlementEvidenceRepository = {
      async acquireEvidence(principal) {
        if (principal.kind === 'anonymous') return null;
        return {
          subjectKey: principal.subjectKey,
          plan: 'gold',
          pluginGrants: {},
          sourceRevision: 'rev-1',
          observedAtMs: Date.now(),
          expiresAtMs: Date.now() + 60_000,
        };
      },
      async resolveRequiredTierEvidence() {
        return { kind: 'unavailable', reasonCode: 'registry_fetch_failed' };
      },
      currentRevision() { return 'rev-1'; },
    };
    const auth = buildAuth(repo);
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: GOLD_USER,
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.verdict.code).toBe('entitlement_context_unavailable');
    }
  });

  it('corrupt required-tier evidence refuses admission', async () => {
    const repo: EntitlementEvidenceRepository = {
      async acquireEvidence(principal) {
        if (principal.kind === 'anonymous') return null;
        return {
          subjectKey: principal.subjectKey,
          plan: 'gold',
          pluginGrants: {},
          sourceRevision: 'rev-1',
          observedAtMs: Date.now(),
          expiresAtMs: Date.now() + 60_000,
        };
      },
      async resolveRequiredTierEvidence() {
        return { kind: 'corrupt', reasonCode: 'invalid_tier_format' };
      },
      currentRevision() { return 'rev-1'; },
    };
    const auth = buildAuth(repo);
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: GOLD_USER,
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.verdict.code).toBe('entitlement_context_invalid');
    }
  });

  it('null entitlement evidence for authenticated user still uses effective tier free', async () => {
    const repo: EntitlementEvidenceRepository = {
      async acquireEvidence() {
        return null;
      },
      async resolveRequiredTierEvidence() {
        return { kind: 'required', tier: 'gold', registryRevision: 'rev-1' };
      },
      currentRevision() { return 'rev-1'; },
    };
    const auth = buildAuth(repo);
    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: GOLD_USER,
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.verdict.code).toBe('insufficient_tier');
    }
  });
});
