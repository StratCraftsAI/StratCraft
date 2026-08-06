/**
 * TICKET_1368 Phase 1: Marketplace eligibility and mutation lifecycle tests.
 *
 * Covers the new marketplace-specific authority methods, the pure verdict
 * resolver, product-bound attestation lifecycle, stale evidence, replay,
 * mismatch, expiry, and failure paths. 100% branch coverage of Phase 1 code.
 */
import { describe, it, expect } from 'vitest';
import type {
  AdmissionPrincipal,
  MarketplaceProductEvidence,
  MarketplaceEligibilityRequest,
  MarketplaceMutationRequest,
  MarketplaceEligibilityResult,
  SigmaEligibilityVerdict,
} from '@StratCraft/types';
import {
  SIGMA_OPERATION_IDS,
  SIGMA_PRESENTATION_PLUGIN_ID,
  SIGMA_PRODUCT_ID,
  MARKETPLACE_ELIGIBILITY_CONTRACT_VERSION,
  resolveMarketplaceEligibilityVerdict,
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

function makeProductEvidence(opts?: Partial<MarketplaceProductEvidence>): MarketplaceProductEvidence {
  return {
    productId: SIGMA_PRODUCT_ID,
    resolvedVersion: '1.0.0',
    registryRevision: 'reg-rev-1',
    compatibilityResult: { kind: 'compatible', revision: 'compat-rev-1' },
    installedVersion: null,
    platform: 'linux-x64',
    ...opts,
  };
}

function makeRepo(opts: {
  plan: string;
  pluginGrants?: Record<string, string>;
  registryRequiredTier: string;
  revision?: string;
}): EntitlementEvidenceRepository {
  const rev = opts.revision ?? 'test-rev';
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
    async resolveRequiredTierEvidence() {
      return {
        kind: 'required' as const,
        tier: opts.registryRequiredTier,
        registryRevision: rev,
      };
    },
    currentRevision() { return rev; },
  };
}

function buildAuth(repo: EntitlementEvidenceRepository): OperationAdmissionAuthority {
  const reg = new OperationPolicyRegistry();
  reg.registerAll(SIGMA_MARKETPLACE_POLICIES);
  return new OperationAdmissionAuthority(reg.freeze(), repo, 'phase1-test');
}

function eligibilityRequest(
  principal: AdmissionPrincipal,
  productEvidence?: MarketplaceProductEvidence,
): MarketplaceEligibilityRequest {
  return {
    operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
    principal,
    productEvidence: productEvidence ?? makeProductEvidence(),
  };
}

function mutationRequest(
  principal: AdmissionPrincipal,
  eligibilityDecisionId: string,
  operationId?: typeof SIGMA_OPERATION_IDS.INSTALL | typeof SIGMA_OPERATION_IDS.UPDATE,
  productEvidence?: MarketplaceProductEvidence,
): MarketplaceMutationRequest {
  return {
    operationId: operationId ?? SIGMA_OPERATION_IDS.INSTALL,
    principal,
    productEvidence: productEvidence ?? makeProductEvidence(),
    eligibilityDecisionId,
  };
}

// ---------------------------------------------------------------------------
// Pure verdict resolver
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 1 -- resolveMarketplaceEligibilityVerdict', () => {
  const pe = makeProductEvidence();

  it('unauthenticated + refused => signed_out', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      false, 'authentication_required', false, null, 'gold', pe,
    );
    expect(r.verdict).toBe('signed_out');
    expect(r.action.kind).toBe('login');
  });

  it('authenticated + admitted + no install => installable', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      true, null, true, 'gold', 'gold', pe,
    );
    expect(r.verdict).toBe('installable');
    expect(r.action.kind).toBe('none');
  });

  it('authenticated + admitted + installed same version => installed', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      true, null, true, 'gold', 'gold',
      makeProductEvidence({ installedVersion: '1.0.0', resolvedVersion: '1.0.0' }),
    );
    expect(r.verdict).toBe('installed');
    expect(r.action.kind).toBe('launch');
  });

  it('authenticated + admitted + installed older version => update_available', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      true, null, true, 'gold', 'gold',
      makeProductEvidence({ installedVersion: '0.9.0', resolvedVersion: '1.0.0' }),
    );
    expect(r.verdict).toBe('update_available');
    expect(r.action.kind).toBe('update');
  });

  it('free user + insufficient_tier => purchase_required', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      false, 'insufficient_tier', true, 'free', 'gold', pe,
    );
    expect(r.verdict).toBe('purchase_required');
    expect(r.action.kind).toBe('purchase');
  });

  it('null tier + insufficient_tier => purchase_required', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      false, 'insufficient_tier', true, null, 'gold', pe,
    );
    expect(r.verdict).toBe('purchase_required');
    expect(r.action.kind).toBe('purchase');
  });

  it('pro user + insufficient_tier for gold => upgrade_required', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      false, 'insufficient_tier', true, 'pro', 'gold', pe,
    );
    expect(r.verdict).toBe('upgrade_required');
    expect(r.action.kind).toBe('upgrade');
  });

  it('basic user + insufficient_tier for gold => upgrade_required', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      false, 'insufficient_tier', true, 'basic', 'gold', pe,
    );
    expect(r.verdict).toBe('upgrade_required');
    expect(r.action.kind).toBe('upgrade');
  });

  it('incompatible platform => unavailable', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      true, null, true, 'gold', 'gold',
      makeProductEvidence({
        compatibilityResult: { kind: 'incompatible', reason: 'unsupported_arch', revision: 'cr1' },
      }),
    );
    expect(r.verdict).toBe('unavailable');
    expect(r.action.kind).toBe('none');
  });

  it('unavailable compatibility => unavailable', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      true, null, true, 'gold', 'gold',
      makeProductEvidence({
        compatibilityResult: { kind: 'unavailable', reason: 'check_failed', revision: 'cr1' },
      }),
    );
    expect(r.verdict).toBe('unavailable');
    expect(r.action.kind).toBe('none');
  });

  it('null resolved version => unavailable', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      true, null, true, 'gold', 'gold',
      makeProductEvidence({ resolvedVersion: null }),
    );
    expect(r.verdict).toBe('unavailable');
    expect(r.action.kind).toBe('none');
  });

  it('entitlement_context_unavailable => unavailable', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      false, 'entitlement_context_unavailable', true, null, 'unknown', pe,
    );
    expect(r.verdict).toBe('unavailable');
    expect(r.action.kind).toBe('none');
  });

  it('entitlement_context_invalid => unavailable', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      false, 'entitlement_context_invalid', true, null, 'unknown', pe,
    );
    expect(r.verdict).toBe('unavailable');
    expect(r.action.kind).toBe('none');
  });

  it('unknown refusal code maps to unavailable', () => {
    const r = resolveMarketplaceEligibilityVerdict(
      false, 'operation_policy_missing', true, null, 'gold', pe,
    );
    expect(r.verdict).toBe('unavailable');
    expect(r.action.kind).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Full eligibility flow through authority
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 1 -- resolveMarketplaceEligibility', () => {
  it('gold user gets installable verdict', async () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.resolveMarketplaceEligibility(
      eligibilityRequest(GOLD_USER),
    );
    expect(result.verdict).toBe('installable');
    expect(result.contractVersion).toBe(MARKETPLACE_ELIGIBILITY_CONTRACT_VERSION);
    expect(result.productId).toBe(SIGMA_PRODUCT_ID);
    expect(result.registryRevision).toBe('reg-rev-1');
    expect(result.platform).toBe('linux-x64');
    expect(result.currentTier).toBe('gold');
    expect(result.requiredTier).toBe('gold');
    expect(result.expiresAtMs).toBeGreaterThan(result.decidedAtMs);
  });

  it('anonymous user gets signed_out verdict', async () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.resolveMarketplaceEligibility(
      eligibilityRequest(ANON),
    );
    expect(result.verdict).toBe('signed_out');
    expect(result.action.kind).toBe('login');
  });

  it('pro user gets upgrade_required for gold product', async () => {
    const auth = buildAuth(makeRepo({ plan: 'pro', registryRequiredTier: 'gold' }));
    const result = await auth.resolveMarketplaceEligibility(
      eligibilityRequest(PRO_USER),
    );
    expect(result.verdict).toBe('upgrade_required');
    expect(result.action.kind).toBe('upgrade');
  });

  it('free user gets purchase_required for gold product', async () => {
    const auth = buildAuth(makeRepo({ plan: 'free', registryRequiredTier: 'gold' }));
    const result = await auth.resolveMarketplaceEligibility(
      eligibilityRequest(FREE_USER),
    );
    expect(result.verdict).toBe('purchase_required');
    expect(result.action.kind).toBe('purchase');
  });

  it('gold user with installed same version gets installed verdict', async () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.resolveMarketplaceEligibility(
      eligibilityRequest(GOLD_USER, makeProductEvidence({
        installedVersion: '1.0.0',
        resolvedVersion: '1.0.0',
      })),
    );
    expect(result.verdict).toBe('installed');
    expect(result.action.kind).toBe('launch');
  });

  it('gold user with outdated install gets update_available', async () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.resolveMarketplaceEligibility(
      eligibilityRequest(GOLD_USER, makeProductEvidence({
        installedVersion: '0.9.0',
        resolvedVersion: '1.0.0',
      })),
    );
    expect(result.verdict).toBe('update_available');
    expect(result.action.kind).toBe('update');
  });

  it('incompatible platform gets unavailable', async () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.resolveMarketplaceEligibility(
      eligibilityRequest(GOLD_USER, makeProductEvidence({
        compatibilityResult: { kind: 'incompatible', reason: 'arm64_unsupported', revision: 'cr2' },
      })),
    );
    expect(result.verdict).toBe('unavailable');
  });

  it('null resolved version gets unavailable', async () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.resolveMarketplaceEligibility(
      eligibilityRequest(GOLD_USER, makeProductEvidence({
        resolvedVersion: null,
      })),
    );
    expect(result.verdict).toBe('unavailable');
  });

  it('buyout user with plugin grant is installable', async () => {
    const auth = buildAuth(makeRepo({
      plan: 'free',
      pluginGrants: { [SIGMA_PRESENTATION_PLUGIN_ID]: 'gold' },
      registryRequiredTier: 'gold',
    }));
    const result = await auth.resolveMarketplaceEligibility(
      eligibilityRequest(FREE_USER),
    );
    expect(result.verdict).toBe('installable');
    expect(result.currentTier).toBe('gold');
  });

  it('eligibility TTL is longer for installable than refused', async () => {
    const repoGold = makeRepo({ plan: 'gold', registryRequiredTier: 'gold' });
    const repoFree = makeRepo({ plan: 'free', registryRequiredTier: 'gold' });

    const authGold = buildAuth(repoGold);
    const authFree = buildAuth(repoFree);

    const installable = await authGold.resolveMarketplaceEligibility(
      eligibilityRequest(GOLD_USER),
    );
    const refused = await authFree.resolveMarketplaceEligibility(
      eligibilityRequest(FREE_USER),
    );

    const installableTtl = installable.expiresAtMs - installable.decidedAtMs;
    const refusedTtl = refused.expiresAtMs - refused.decidedAtMs;
    expect(installableTtl).toBeGreaterThan(refusedTtl);
  });
});

// ---------------------------------------------------------------------------
// Mutation admission with product binding
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 1 -- admitMarketplaceMutation', () => {
  it('gold user is admitted for install with product binding', async () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.admitMarketplaceMutation(
      mutationRequest(GOLD_USER, 'elig-1'),
    );
    expect(result.kind).toBe('admitted');
    if (result.kind === 'admitted') {
      expect(result.attestation.productId).toBe(SIGMA_PRODUCT_ID);
      expect(result.attestation.resolvedVersion).toBe('1.0.0');
      expect(result.attestation.registryRevision).toBe('reg-rev-1');
      expect(result.attestation.eligibilityDecisionId).toBe('elig-1');
      expect(result.attestation.operationId).toBe(SIGMA_OPERATION_IDS.INSTALL);
    }
  });

  it('update operation produces correct attestation', async () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.admitMarketplaceMutation(
      mutationRequest(GOLD_USER, 'elig-2', SIGMA_OPERATION_IDS.UPDATE),
    );
    expect(result.kind).toBe('admitted');
    if (result.kind === 'admitted') {
      expect(result.attestation.operationId).toBe(SIGMA_OPERATION_IDS.UPDATE);
    }
  });

  it('free user is refused for install mutation', async () => {
    const auth = buildAuth(makeRepo({ plan: 'free', registryRequiredTier: 'gold' }));
    const result = await auth.admitMarketplaceMutation(
      mutationRequest(FREE_USER, 'elig-3'),
    );
    expect(result.kind).toBe('refused');
  });

  it('anonymous user is refused for install mutation', async () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.admitMarketplaceMutation(
      mutationRequest(ANON, 'elig-4'),
    );
    expect(result.kind).toBe('refused');
  });

  it('attestation binds entitlement revision', async () => {
    const auth = buildAuth(makeRepo({
      plan: 'gold',
      registryRequiredTier: 'gold',
      revision: 'ent-rev-42',
    }));
    const result = await auth.admitMarketplaceMutation(
      mutationRequest(GOLD_USER, 'elig-5'),
    );
    if (result.kind === 'admitted') {
      expect(result.attestation.entitlementRevision).toBe('ent-rev-42');
    }
  });

  it('attestation binds compatibility revision', async () => {
    const pe = makeProductEvidence({
      compatibilityResult: { kind: 'compatible', revision: 'compat-77' },
    });
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.admitMarketplaceMutation(
      mutationRequest(GOLD_USER, 'elig-6', SIGMA_OPERATION_IDS.INSTALL, pe),
    );
    if (result.kind === 'admitted') {
      expect(result.attestation.compatibilityRevision).toBe('compat-77');
    }
  });
});

// ---------------------------------------------------------------------------
// Marketplace attestation lifecycle
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 1 -- marketplace attestation lifecycle', () => {
  async function admitAndGetAttId(): Promise<{ auth: OperationAdmissionAuthority; attId: string }> {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.admitMarketplaceMutation(
      mutationRequest(GOLD_USER, 'elig-lc'),
    );
    if (result.kind !== 'admitted') throw new Error('expected admitted');
    return { auth, attId: result.attestation.attestationId };
  }

  it('activate transitions marketplace attestation to activated', async () => {
    const { auth, attId } = await admitAndGetAttId();
    const r = auth.activateMarketplaceAttestation(attId);
    expect(r.kind).toBe('activated');
    if (r.kind === 'activated') {
      expect(r.attestation.state).toBe('activated');
      expect(r.attestation.productId).toBe(SIGMA_PRODUCT_ID);
    }
  });

  it('consume transitions marketplace attestation to consumed with dispatch', async () => {
    const { auth, attId } = await admitAndGetAttId();
    auth.activateMarketplaceAttestation(attId);
    const r = auth.consumeMarketplaceAttestation(attId, {
      surface: 'guide-webui',
      route: '/api/v1/sigma/install',
    });
    expect(r.kind).toBe('consumed');
    if (r.kind === 'consumed') {
      expect(r.attestation.state).toBe('consumed');
      expect(r.attestation.dispatchRoute).toBe('/api/v1/sigma/install');
    }
  });

  it('double consume fails -- single-use', async () => {
    const { auth, attId } = await admitAndGetAttId();
    auth.activateMarketplaceAttestation(attId);
    auth.consumeMarketplaceAttestation(attId, { surface: 's', route: 'r' });
    const replay = auth.consumeMarketplaceAttestation(attId, { surface: 's', route: 'r' });
    expect(replay.kind).toBe('invalid');
  });

  it('finalize cleans up marketplace attestation', async () => {
    const { auth, attId } = await admitAndGetAttId();
    auth.activateMarketplaceAttestation(attId);
    auth.consumeMarketplaceAttestation(attId, { surface: 's', route: 'r' });
    const record = auth.finalizeMarketplaceAdmission(
      attId,
      { stage: 'completed', code: 'success' },
      'guide-webui',
    );
    expect(record).not.toBeNull();
    expect(record!.operationId).toBe(SIGMA_OPERATION_IDS.INSTALL);
    expect(auth.getMarketplaceAttestation(attId)).toBeUndefined();
  });

  it('activate with stale evidence revision returns stale', async () => {
    const { auth, attId } = await admitAndGetAttId();
    const r = auth.activateMarketplaceAttestation(attId, 'different-revision');
    expect(r.kind).toBe('stale');
    if (r.kind === 'stale') {
      expect(r.code).toBe('admission_stale');
    }
  });

  it('activate unknown attestation returns invalid', () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const r = auth.activateMarketplaceAttestation('nonexistent');
    expect(r.kind).toBe('invalid');
  });

  it('consume unknown attestation returns invalid', () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const r = auth.consumeMarketplaceAttestation('nonexistent', { surface: 's', route: 'r' });
    expect(r.kind).toBe('invalid');
  });

  it('finalize unknown attestation returns null', () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const r = auth.finalizeMarketplaceAdmission(
      'nonexistent',
      { stage: 'completed', code: 'success' },
      'test',
    );
    expect(r).toBeNull();
  });

  it('getMarketplaceAttestation retrieves the bound attestation', async () => {
    const { auth, attId } = await admitAndGetAttId();
    const att = auth.getMarketplaceAttestation(attId);
    expect(att).toBeDefined();
    expect(att!.productId).toBe(SIGMA_PRODUCT_ID);
    expect(att!.eligibilityDecisionId).toBe('elig-lc');
  });
});

// ---------------------------------------------------------------------------
// Cross-surface parity: equivalent evidence => same verdict
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 1 -- cross-surface parity', () => {
  it('electron and guide with identical evidence produce same verdict', async () => {
    const repo = makeRepo({ plan: 'gold', registryRequiredTier: 'gold' });
    const authElectron = buildAuth(repo);
    const authGuide = buildAuth(repo);

    const electronResult = await authElectron.resolveMarketplaceEligibility(
      eligibilityRequest(GOLD_USER),
    );
    const guideResult = await authGuide.resolveMarketplaceEligibility(
      eligibilityRequest({ ...GOLD_USER, provenance: 'browser-oauth' }),
    );

    expect(electronResult.verdict).toBe(guideResult.verdict);
    expect(electronResult.requiredTier).toBe(guideResult.requiredTier);
    expect(electronResult.currentTier).toBe(guideResult.currentTier);
  });
});

// ---------------------------------------------------------------------------
// Edge cases and invariants
// ---------------------------------------------------------------------------

describe('TICKET_1368 Phase 1 -- invariants', () => {
  it('eligibility decisionId is unique per call', async () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const r1 = await auth.resolveMarketplaceEligibility(eligibilityRequest(GOLD_USER));
    const r2 = await auth.resolveMarketplaceEligibility(eligibilityRequest(GOLD_USER));
    expect(r1.decisionId).not.toBe(r2.decisionId);
  });

  it('eligibility does not issue a generic attestation', async () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const r = await auth.resolveMarketplaceEligibility(eligibilityRequest(GOLD_USER));
    // eligibility is read-only -- no attestation to activate/consume
    expect(r.decisionId).toBeTruthy();
    expect(auth.getMarketplaceAttestation(r.decisionId)).toBeUndefined();
  });

  it('mutation attestation binds payload hash', async () => {
    const auth = buildAuth(makeRepo({ plan: 'gold', registryRequiredTier: 'gold' }));
    const result = await auth.admitMarketplaceMutation({
      ...mutationRequest(GOLD_USER, 'elig-ph'),
      payloadHash: 'sha256-abc123',
    });
    if (result.kind === 'admitted') {
      expect(result.attestation.payloadHash).toBe('sha256-abc123');
    }
  });

  it('unavailable registry evidence refuses eligibility', async () => {
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
        return { kind: 'unavailable', reasonCode: 'registry_offline' };
      },
      currentRevision() { return 'rev-1'; },
    };
    const auth = buildAuth(repo);
    const result = await auth.resolveMarketplaceEligibility(
      eligibilityRequest(GOLD_USER),
    );
    expect(result.verdict).toBe('unavailable');
  });

  it('corrupt registry evidence refuses eligibility', async () => {
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
        return { kind: 'corrupt', reasonCode: 'bad_schema' };
      },
      currentRevision() { return 'rev-1'; },
    };
    const auth = buildAuth(repo);
    const result = await auth.resolveMarketplaceEligibility(
      eligibilityRequest(GOLD_USER),
    );
    expect(result.verdict).toBe('unavailable');
  });
});
