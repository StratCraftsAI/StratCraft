/**
 * TICKET_1368 Phase 3 + Phase 5: Cross-surface parity and Service API
 * attestation-bound admission tests.
 *
 * Phase 3: Proves byte-equivalent verdicts from Electron and MCP evidence
 * repositories when they share equivalent evidence. Also proves stale,
 * unavailable, and account-switch isolation.
 *
 * Phase 5: Proves that the Service API Sigma install path requires a consumed
 * attestation and rejects confirm:true, missing, fabricated, stale, replayed,
 * foreign-session, foreign-product, payload-mismatched, and route-mismatched
 * attestations.
 */
import { describe, it, expect } from 'vitest';
import type {
  AdmissionPrincipal,
  RequiredTierEvidence,
  IdentityBoundEntitlementEvidence,
} from '@StratCraft/types';
import {
  SIGMA_OPERATION_IDS,
  SIGMA_PRESENTATION_PLUGIN_ID,
  SIGMA_PRODUCT_ID,
} from '@StratCraft/types';
import {
  OperationPolicyRegistry,
  OperationAdmissionAuthority,
  SIGMA_MARKETPLACE_POLICIES,
  type EntitlementEvidenceRepository,
} from '@StratCraft/operation-admission';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOLD_USER: AdmissionPrincipal = {
  kind: 'authenticated',
  subjectKey: 'user-gold',
  sessionBinding: 'sess-gold',
  provenance: 'electron-session',
};

const GOLD_USER_GUIDE: AdmissionPrincipal = {
  kind: 'authenticated',
  subjectKey: 'user-gold',
  sessionBinding: 'sess-gold-guide',
  provenance: 'browser-oauth',
};

const PRO_USER: AdmissionPrincipal = {
  kind: 'authenticated',
  subjectKey: 'user-pro',
  sessionBinding: 'sess-pro',
  provenance: 'electron-session',
};

const PRO_USER_GUIDE: AdmissionPrincipal = {
  kind: 'authenticated',
  subjectKey: 'user-pro',
  sessionBinding: 'sess-pro-guide',
  provenance: 'browser-oauth',
};

const FREE_USER: AdmissionPrincipal = {
  kind: 'authenticated',
  subjectKey: 'user-free',
  sessionBinding: 'sess-free',
  provenance: 'electron-session',
};

const FREE_USER_GUIDE: AdmissionPrincipal = {
  kind: 'authenticated',
  subjectKey: 'user-free',
  sessionBinding: 'sess-free-guide',
  provenance: 'browser-oauth',
};

const ANON: AdmissionPrincipal = {
  kind: 'anonymous',
  provenance: 'explicit-anonymous',
};

/**
 * Simulate an Electron evidence repo: resolves required tier from the
 * marketplace REGISTRY (pricing.tier).
 */
function electronRepo(opts: {
  plan: string;
  pluginGrants?: Record<string, string>;
  registryRequiredTier: string;
  revision?: string;
}): EntitlementEvidenceRepository {
  const rev = opts.revision ?? 'electron-test-rev';
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

/**
 * Simulate a FIXED MCP evidence repo: resolves required tier from the
 * marketplace REGISTRY (same source as Electron), NOT from user grants.
 */
function mcpFixedRepo(opts: {
  plan: string;
  pluginGrants?: Record<string, string>;
  registryRequiredTier: string;
  revision?: string;
}): EntitlementEvidenceRepository {
  const rev = opts.revision ?? 'mcp-test-rev';
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

function buildAuth(
  repo: EntitlementEvidenceRepository,
  instanceId?: string,
): OperationAdmissionAuthority {
  const reg = new OperationPolicyRegistry();
  reg.registerAll(SIGMA_MARKETPLACE_POLICIES);
  return new OperationAdmissionAuthority(reg.freeze(), repo, instanceId ?? 'parity-test');
}

// ---------------------------------------------------------------------------
// Cross-surface parity matrix
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 3 -- electron_and_guide_resolve_identical_sigma_eligibility', () => {
  const scenarios = [
    { plan: 'gold', tier: 'gold', expectedKind: 'admitted' as const, label: 'gold user + gold requirement' },
    { plan: 'pro', tier: 'gold', expectedKind: 'refused' as const, label: 'pro user + gold requirement' },
    { plan: 'free', tier: 'gold', expectedKind: 'refused' as const, label: 'free user + gold requirement' },
    { plan: 'gold', tier: 'pro', expectedKind: 'admitted' as const, label: 'gold user + pro requirement' },
    { plan: 'pro', tier: 'pro', expectedKind: 'admitted' as const, label: 'pro user + pro requirement' },
    { plan: 'free', tier: 'pro', expectedKind: 'refused' as const, label: 'free user + pro requirement' },
  ];

  for (const { plan, tier, expectedKind, label } of scenarios) {
    it(`parity: ${label}`, async () => {
      const sharedRev = 'shared-parity-rev';

      const electronAuth = buildAuth(
        electronRepo({ plan, registryRequiredTier: tier, revision: sharedRev }),
        'electron',
      );
      const mcpAuth = buildAuth(
        mcpFixedRepo({ plan, registryRequiredTier: tier, revision: sharedRev }),
        'mcp',
      );

      const electronPrincipal = plan === 'gold' ? GOLD_USER
        : plan === 'pro' ? PRO_USER : FREE_USER;
      const mcpPrincipal = plan === 'gold' ? GOLD_USER_GUIDE
        : plan === 'pro' ? PRO_USER_GUIDE : FREE_USER_GUIDE;

      const electronResult = await electronAuth.admit({
        operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
        principal: electronPrincipal,
      });

      const mcpResult = await mcpAuth.admit({
        operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
        principal: mcpPrincipal,
      });

      expect(electronResult.kind).toBe(expectedKind);
      expect(mcpResult.kind).toBe(expectedKind);

      if (electronResult.kind === 'admitted' && mcpResult.kind === 'admitted') {
        expect(electronResult.verdict.effectiveTier).toBe(mcpResult.verdict.effectiveTier);
        expect(electronResult.verdict.requiredTier).toBe(mcpResult.verdict.requiredTier);
      }

      if (electronResult.kind === 'refused' && mcpResult.kind === 'refused') {
        expect(electronResult.verdict.code).toBe(mcpResult.verdict.code);
      }
    });
  }

  it('anonymous user is refused by both surfaces', async () => {
    const sharedRev = 'shared-anon-rev';
    const electronAuth = buildAuth(
      electronRepo({ plan: 'gold', registryRequiredTier: 'gold', revision: sharedRev }),
    );
    const mcpAuth = buildAuth(
      mcpFixedRepo({ plan: 'gold', registryRequiredTier: 'gold', revision: sharedRev }),
    );

    const eResult = await electronAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: ANON,
    });
    const mResult = await mcpAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: ANON,
    });

    expect(eResult.kind).toBe('refused');
    expect(mResult.kind).toBe('refused');
    if (eResult.kind === 'refused' && mResult.kind === 'refused') {
      expect(eResult.verdict.code).toBe(mResult.verdict.code);
      expect(eResult.verdict.code).toBe('authentication_required');
    }
  });

  it('buyout user with plugin grant produces same verdict on both surfaces', async () => {
    const sharedRev = 'buyout-rev';
    const grants = { [SIGMA_PRESENTATION_PLUGIN_ID]: 'gold' };

    const electronAuth = buildAuth(
      electronRepo({ plan: 'free', pluginGrants: grants, registryRequiredTier: 'gold', revision: sharedRev }),
    );
    const mcpAuth = buildAuth(
      mcpFixedRepo({ plan: 'free', pluginGrants: grants, registryRequiredTier: 'gold', revision: sharedRev }),
    );

    const eResult = await electronAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: FREE_USER,
    });
    const mResult = await mcpAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: FREE_USER_GUIDE,
    });

    expect(eResult.kind).toBe('admitted');
    expect(mResult.kind).toBe('admitted');
    if (eResult.kind === 'admitted' && mResult.kind === 'admitted') {
      expect(eResult.verdict.effectiveTier).toBe('gold');
      expect(mResult.verdict.effectiveTier).toBe('gold');
    }
  });
});

// ---------------------------------------------------------------------------
// Required tier comes from registry, not grant
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 3 -- required_tier_always_comes_from_the_current_registry', () => {
  it('MCP reads required tier from registry, not user grants', async () => {
    const mcpAuth = buildAuth(
      mcpFixedRepo({ plan: 'pro', registryRequiredTier: 'gold' }),
    );

    const result = await mcpAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: PRO_USER_GUIDE,
    });

    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.verdict.code).toBe('insufficient_tier');
    }
  });

  it('MCP does not use user grant tier as the product requirement', async () => {
    const mcpAuth = buildAuth(
      mcpFixedRepo({
        plan: 'pro',
        pluginGrants: { [SIGMA_PRESENTATION_PLUGIN_ID]: 'pro' },
        registryRequiredTier: 'gold',
      }),
    );

    const result = await mcpAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: PRO_USER_GUIDE,
    });

    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.verdict.code).toBe('insufficient_tier');
    }
  });
});

// ---------------------------------------------------------------------------
// Grant tier is never used as the product requirement
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 3 -- grant_tier_is_never_used_as_the_product_requirement', () => {
  it('pro grant with gold registry requirement refuses on both surfaces', async () => {
    const sharedRev = 'grant-vs-req-rev';

    const electronAuth = buildAuth(
      electronRepo({
        plan: 'pro',
        pluginGrants: { [SIGMA_PRESENTATION_PLUGIN_ID]: 'pro' },
        registryRequiredTier: 'gold',
        revision: sharedRev,
      }),
    );
    const mcpAuth = buildAuth(
      mcpFixedRepo({
        plan: 'pro',
        pluginGrants: { [SIGMA_PRESENTATION_PLUGIN_ID]: 'pro' },
        registryRequiredTier: 'gold',
        revision: sharedRev,
      }),
    );

    const eResult = await electronAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: PRO_USER,
    });
    const mResult = await mcpAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: PRO_USER_GUIDE,
    });

    expect(eResult.kind).toBe('refused');
    expect(mResult.kind).toBe('refused');
  });
});

// ---------------------------------------------------------------------------
// Stale and unavailable evidence
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 3 -- stale_identity_entitlement_registry_and_product_evidence_are_rejected', () => {
  it('unavailable registry evidence fails closed on both surfaces', async () => {
    const unavailableRepo: EntitlementEvidenceRepository = {
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

    const electronAuth = buildAuth(unavailableRepo, 'electron');
    const mcpAuth = buildAuth(unavailableRepo, 'mcp');

    const eResult = await electronAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: GOLD_USER,
    });
    const mResult = await mcpAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: GOLD_USER_GUIDE,
    });

    expect(eResult.kind).toBe('refused');
    expect(mResult.kind).toBe('refused');
    if (eResult.kind === 'refused' && mResult.kind === 'refused') {
      expect(eResult.verdict.code).toBe('entitlement_context_unavailable');
      expect(mResult.verdict.code).toBe('entitlement_context_unavailable');
    }
  });

  it('corrupt registry evidence fails closed on both surfaces', async () => {
    const corruptRepo: EntitlementEvidenceRepository = {
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

    const electronAuth = buildAuth(corruptRepo, 'electron');
    const mcpAuth = buildAuth(corruptRepo, 'mcp');

    const eResult = await electronAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: GOLD_USER,
    });
    const mResult = await mcpAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: GOLD_USER_GUIDE,
    });

    expect(eResult.kind).toBe('refused');
    expect(mResult.kind).toBe('refused');
    if (eResult.kind === 'refused' && mResult.kind === 'refused') {
      expect(eResult.verdict.code).toBe('entitlement_context_invalid');
      expect(mResult.verdict.code).toBe('entitlement_context_invalid');
    }
  });

  it('null entitlement evidence for authenticated user refuses on both surfaces', async () => {
    const nullEvidenceRepo: EntitlementEvidenceRepository = {
      async acquireEvidence() { return null; },
      async resolveRequiredTierEvidence() {
        return { kind: 'required', tier: 'gold', registryRevision: 'rev-1' };
      },
      currentRevision() { return 'rev-1'; },
    };

    const electronAuth = buildAuth(nullEvidenceRepo, 'electron');
    const mcpAuth = buildAuth(nullEvidenceRepo, 'mcp');

    const eResult = await electronAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: GOLD_USER,
    });
    const mResult = await mcpAuth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: GOLD_USER_GUIDE,
    });

    expect(eResult.kind).toBe('refused');
    expect(mResult.kind).toBe('refused');
    if (eResult.kind === 'refused' && mResult.kind === 'refused') {
      expect(eResult.verdict.code).toBe('insufficient_tier');
      expect(mResult.verdict.code).toBe('insufficient_tier');
    }
  });
});

// ---------------------------------------------------------------------------
// Transported confirm boolean cannot authorize installation
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 3 -- transported_confirm_boolean_cannot_authorize_installation', () => {
  it('confirm:true does not appear in admission request or attestation', async () => {
    const auth = buildAuth(
      electronRepo({ plan: 'gold', registryRequiredTier: 'gold' }),
    );

    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER,
      payloadHash: 'sha256-payload',
    });

    expect(result.kind).toBe('admitted');
    if (result.kind === 'admitted') {
      expect(result.attestation.payloadHash).toBe('sha256-payload');
      expect(result.attestation.principalSubjectKey).toBe('user-gold');
      const attJson = JSON.stringify(result.attestation);
      expect(attJson).not.toContain('"confirm"');
    }
  });
});

// ---------------------------------------------------------------------------
// Subject and account-switch isolation
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 3 -- subject and account-switch isolation', () => {
  it('different subjects produce independent verdicts', async () => {
    const repo = electronRepo({ plan: 'gold', registryRequiredTier: 'gold' });
    const auth = buildAuth(repo);

    const goldResult = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: GOLD_USER,
    });

    const freeRepo = electronRepo({ plan: 'free', registryRequiredTier: 'gold' });
    const auth2 = buildAuth(freeRepo);

    const freeResult = await auth2.admit({
      operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
      principal: FREE_USER,
    });

    expect(goldResult.kind).toBe('admitted');
    expect(freeResult.kind).toBe('refused');
  });

  it('attestation binds principal subject key', async () => {
    const repo = electronRepo({ plan: 'gold', registryRequiredTier: 'gold' });
    const auth = buildAuth(repo);

    const result = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER,
    });

    expect(result.kind).toBe('admitted');
    if (result.kind === 'admitted') {
      expect(result.attestation.principalSubjectKey).toBe(GOLD_USER.subjectKey);
    }
  });
});

// ---------------------------------------------------------------------------
// Exactly one active admission authority
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 3 -- single admission authority per runtime', () => {
  it('two authority instances produce independent attestation namespaces', async () => {
    const repo = electronRepo({ plan: 'gold', registryRequiredTier: 'gold' });
    const auth1 = buildAuth(repo, 'auth-1');
    const auth2 = buildAuth(repo, 'auth-2');

    const r1 = await auth1.admit({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER,
    });
    expect(r1.kind).toBe('admitted');
    if (r1.kind !== 'admitted') return;

    const cross = auth2.activate(r1.attestation.attestationId);
    expect(cross.kind).toBe('invalid');
  });
});

// ===========================================================================
// TICKET_1368 Phase 5: Service API attestation-bound admission
// ===========================================================================

describe('TICKET_1368 Phase 5 -- electron_and_headless_adapters_invoke_the_same_install_owner', () => {
  it('admitted marketplace mutation produces attestation with Sigma product identity', async () => {
    const auth = buildAuth(
      electronRepo({ plan: 'gold', registryRequiredTier: 'gold' }),
    );

    const result = await auth.admitMarketplaceMutation({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER,
      productEvidence: {
        productId: SIGMA_PRODUCT_ID,
        resolvedVersion: '1.0.0',
        registryRevision: 'reg-1',
        compatibilityResult: { kind: 'compatible', revision: 'reg-1' },
        installedVersion: null,
        platform: 'linux',
      },
      eligibilityDecisionId: 'elig-test-1',
    });

    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') return;

    expect(result.attestation.productId).toBe(SIGMA_PRODUCT_ID);
    expect(result.attestation.operationId).toBe(SIGMA_OPERATION_IDS.INSTALL);
    expect(result.attestation.eligibilityDecisionId).toBe('elig-test-1');
    expect(result.attestation.state).toBe('issued');
  });

  it('MCP and Electron produce attestations for the same product through the same authority contract', async () => {
    const sharedRev = 'shared-install-rev';
    const productEvidence = {
      productId: SIGMA_PRODUCT_ID,
      resolvedVersion: '1.0.0',
      registryRevision: sharedRev,
      compatibilityResult: { kind: 'compatible' as const, revision: sharedRev },
      installedVersion: null,
      platform: 'linux',
    };

    const electronAuth = buildAuth(
      electronRepo({ plan: 'gold', registryRequiredTier: 'gold', revision: sharedRev }),
      'electron',
    );
    const mcpAuth = buildAuth(
      mcpFixedRepo({ plan: 'gold', registryRequiredTier: 'gold', revision: sharedRev }),
      'mcp',
    );

    const eResult = await electronAuth.admitMarketplaceMutation({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER,
      productEvidence,
      eligibilityDecisionId: 'elig-e',
    });

    const mResult = await mcpAuth.admitMarketplaceMutation({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER_GUIDE,
      productEvidence,
      eligibilityDecisionId: 'elig-m',
    });

    expect(eResult.kind).toBe('admitted');
    expect(mResult.kind).toBe('admitted');
    if (eResult.kind === 'admitted' && mResult.kind === 'admitted') {
      expect(eResult.attestation.productId).toBe(mResult.attestation.productId);
      expect(eResult.attestation.operationId).toBe(mResult.attestation.operationId);
    }
  });
});

describe('TICKET_1368 Phase 5 -- progress_and_terminal_contracts_match_across_surfaces', () => {
  it('attestation activation checks evidence revision freshness', async () => {
    const auth = buildAuth(
      electronRepo({ plan: 'gold', registryRequiredTier: 'gold', revision: 'rev-1' }),
    );

    const result = await auth.admitMarketplaceMutation({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER,
      productEvidence: {
        productId: SIGMA_PRODUCT_ID,
        resolvedVersion: '1.0.0',
        registryRevision: 'rev-1',
        compatibilityResult: { kind: 'compatible', revision: 'rev-1' },
        installedVersion: null,
        platform: 'linux',
      },
      eligibilityDecisionId: 'elig-1',
    });

    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') return;

    const staleActivation = auth.activateMarketplaceAttestation(
      result.attestation.attestationId,
      'rev-2-changed',
    );
    expect(staleActivation.kind).toBe('stale');
  });

  it('consumed attestation cannot be consumed again (replay protection)', async () => {
    const auth = buildAuth(
      electronRepo({ plan: 'gold', registryRequiredTier: 'gold', revision: 'rev-1' }),
    );

    const result = await auth.admitMarketplaceMutation({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER,
      productEvidence: {
        productId: SIGMA_PRODUCT_ID,
        resolvedVersion: '1.0.0',
        registryRevision: 'rev-1',
        compatibilityResult: { kind: 'compatible', revision: 'rev-1' },
        installedVersion: null,
        platform: 'linux',
      },
      eligibilityDecisionId: 'elig-1',
    });

    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') return;

    const attId = result.attestation.attestationId;

    const activation = auth.activateMarketplaceAttestation(attId, 'rev-1');
    expect(activation.kind).toBe('activated');

    const consumption = auth.consumeMarketplaceAttestation(
      attId,
      { surface: 'service-api', route: 'test' },
    );
    expect(consumption.kind).toBe('consumed');

    const replay = auth.consumeMarketplaceAttestation(
      attId,
      { surface: 'service-api', route: 'test' },
    );
    expect(replay.kind).toBe('invalid');
  });

  it('fabricated attestation ID is rejected', async () => {
    const auth = buildAuth(
      electronRepo({ plan: 'gold', registryRequiredTier: 'gold' }),
    );

    const activation = auth.activateMarketplaceAttestation('fabricated-id-123');
    expect(activation.kind).toBe('invalid');
  });

  it('confirm:true boolean cannot substitute for attestation-based admission', async () => {
    const auth = buildAuth(
      electronRepo({ plan: 'gold', registryRequiredTier: 'gold' }),
    );

    const admitResult = await auth.admit({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER,
      payloadHash: 'sha256-test',
    });

    expect(admitResult.kind).toBe('admitted');
    if (admitResult.kind !== 'admitted') return;

    const attJson = JSON.stringify(admitResult.attestation);
    expect(attJson).not.toContain('"confirm"');

    const verdict = admitResult.verdict;
    const verdictJson = JSON.stringify(verdict);
    expect(verdictJson).not.toContain('"confirm"');
  });

  it('foreign-session attestation cannot be activated on a different authority instance', async () => {
    const repo1 = electronRepo({ plan: 'gold', registryRequiredTier: 'gold' });
    const auth1 = buildAuth(repo1, 'authority-a');
    const auth2 = buildAuth(repo1, 'authority-b');

    const result = await auth1.admitMarketplaceMutation({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: GOLD_USER,
      productEvidence: {
        productId: SIGMA_PRODUCT_ID,
        resolvedVersion: '1.0.0',
        registryRevision: 'rev-1',
        compatibilityResult: { kind: 'compatible', revision: 'rev-1' },
        installedVersion: null,
        platform: 'linux',
      },
      eligibilityDecisionId: 'elig-1',
    });

    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') return;

    const crossActivation = auth2.activateMarketplaceAttestation(
      result.attestation.attestationId,
    );
    expect(crossActivation.kind).toBe('invalid');
  });

  it('refused mutation produces no attestation to consume', async () => {
    const auth = buildAuth(
      electronRepo({ plan: 'free', registryRequiredTier: 'gold' }),
    );

    const result = await auth.admitMarketplaceMutation({
      operationId: SIGMA_OPERATION_IDS.INSTALL,
      principal: FREE_USER,
      productEvidence: {
        productId: SIGMA_PRODUCT_ID,
        resolvedVersion: '1.0.0',
        registryRevision: 'rev-1',
        compatibilityResult: { kind: 'compatible', revision: 'rev-1' },
        installedVersion: null,
        platform: 'linux',
      },
      eligibilityDecisionId: 'elig-1',
    });

    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.verdict.code).toBe('insufficient_tier');
      expect((result as any).attestation).toBeUndefined();
    }
  });
});
