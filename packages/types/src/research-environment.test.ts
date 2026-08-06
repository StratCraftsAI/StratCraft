/**
 * TICKET_1335 / TICKET_1335_1: shared research-environment contract tests.
 *
 * These cover the two properties the design relies on being enforced at
 * runtime rather than by TypeScript, because every consumer sits across a
 * process or trust boundary:
 *
 * - TICKET_1335_1 AC3 -- missing and unknown capability representations cannot
 *   cross the preload boundary.
 * - TICKET_1335 AC5 -- illegal category/stage/cause combinations are rejected,
 *   not merely untypable.
 */

import { describe, it, expect } from 'vitest';
import {
  RESEARCH_CAPABILITIES,
  RESEARCH_ENVIRONMENT_STATES,
  RESEARCH_ENVIRONMENT_OPERATIONS,
  RESEARCH_ENVIRONMENT_STAGES,
  RESEARCH_ENVIRONMENT_PROFILES,
  RESEARCH_ENVIRONMENT_FAILURE_CATEGORIES,
  RESEARCH_ENVIRONMENT_STATUS_SCHEMA_VERSION,
  DEFAULT_RESEARCH_ENVIRONMENT_PROFILE,
  isResearchCapability,
  researchEnvironmentFailureSchema,
  researchEnvironmentStatusSchema,
  researchEnvironmentJobSchema,
  parseResearchEnvironmentStatus,
  parsePersistedResearchEnvironmentStatus,
  parseResearchEnvironmentJob,
  parseResearchEnvironmentApprovalAttestation,
  type ResearchCapability,
  type ResearchCapabilityStatus,
  type ResearchEnvironmentStatus,
} from './research-environment';

const SHA = 'a'.repeat(64);
const TS = '2026-07-30T00:00:00.000Z';

function capabilities(
  overrides: Partial<Record<ResearchCapability, ResearchCapabilityStatus>> = {},
  base: ResearchCapabilityStatus = { expected: '1.0.0', state: 'absent' },
): Record<ResearchCapability, ResearchCapabilityStatus> {
  return Object.fromEntries(
    RESEARCH_CAPABILITIES.map(c => [c, overrides[c] ?? base]),
  ) as Record<ResearchCapability, ResearchCapabilityStatus>;
}

function readyCapabilities(): Record<ResearchCapability, ResearchCapabilityStatus> {
  return capabilities({}, {
    expected: '1.0.0',
    installed: '1.0.0',
    state: 'ready',
    verification: 'probe passed',
  });
}

const absentStatus: ResearchEnvironmentStatus = {
  schemaVersion: RESEARCH_ENVIRONMENT_STATUS_SCHEMA_VERSION,
  profile: 'research-default',
  projection: 'default',
  state: 'absent',
  supportedPlatform: true,
  platform: 'linux',
  architecture: 'x64',
  capabilities: capabilities(),
};

const readyStatus: ResearchEnvironmentStatus = {
  schemaVersion: RESEARCH_ENVIRONMENT_STATUS_SCHEMA_VERSION,
  profile: 'research-default',
  projection: 'default',
  state: 'ready',
  supportedPlatform: true,
  platform: 'linux',
  architecture: 'x64',
  pixiVersion: '0.75.0',
  manifestSha256: SHA,
  lockSha256: SHA,
  interpreterPath: '/repo/.pixi/envs/default/bin/python',
  lastVerifiedAt: TS,
  capabilities: readyCapabilities(),
};

// -----------------------------------------------------------------------------
// Tuples
// -----------------------------------------------------------------------------

describe('runtime tuples', () => {
  it('exposes the six locked capabilities without duplicates', () => {
    expect([...RESEARCH_CAPABILITIES]).toEqual([
      'histdata', 'duckdb', 'gplearn', 'gpquant', 'pysr', 'pandas_ta',
    ]);
    expect(new Set(RESEARCH_CAPABILITIES).size).toBe(RESEARCH_CAPABILITIES.length);
  });

  it('has no shared_stack pseudo-capability (TICKET_1335 D5 step 7)', () => {
    expect(RESEARCH_CAPABILITIES).not.toContain('shared_stack' as never);
  });

  it('spells pandas_ta as a module key, not the distribution name', () => {
    expect(RESEARCH_CAPABILITIES).toContain('pandas_ta');
    expect(RESEARCH_CAPABILITIES).not.toContain('pandas-ta' as never);
  });

  it('exposes the canonical environment states', () => {
    expect([...RESEARCH_ENVIRONMENT_STATES]).toEqual([
      'absent', 'installing', 'repairing', 'verifying', 'uninstalling', 'ready', 'failed',
    ]);
  });

  it('separates julia_verify from python_verify (TICKET_1335 AC4)', () => {
    expect(RESEARCH_ENVIRONMENT_STAGES).toContain('python_verify');
    expect(RESEARCH_ENVIRONMENT_STAGES).toContain('julia_verify');
  });

  it('fixes the profile to a closed set (TICKET_1335 D1)', () => {
    expect([...RESEARCH_ENVIRONMENT_PROFILES]).toEqual(['research-default']);
    expect(DEFAULT_RESEARCH_ENVIRONMENT_PROFILE).toBe('research-default');
  });

  it('exposes verify as a public operation, not a synchronous call', () => {
    expect([...RESEARCH_ENVIRONMENT_OPERATIONS]).toEqual([
      'install', 'repair', 'verify', 'uninstall', 'remove_capability', 'restore_capability',
    ]);
  });

  it('narrows capability identity at the boundary', () => {
    for (const capability of RESEARCH_CAPABILITIES) {
      expect(isResearchCapability(capability)).toBe(true);
    }
    for (const value of ['numpy', '', 'pandas-ta', 0, null, undefined, {}]) {
      expect(isResearchCapability(value)).toBe(false);
    }
  });
});

// -----------------------------------------------------------------------------
// AC3: capability record coverage
// -----------------------------------------------------------------------------

describe('capabilities record (TICKET_1335_1 AC3)', () => {
  it('accepts a record covering every capability exactly once', () => {
    expect(() => parseResearchEnvironmentStatus(absentStatus)).not.toThrow();
  });

  it.each(RESEARCH_CAPABILITIES)('rejects a record missing %s', (capability) => {
    const partial = capabilities();
    delete (partial as Record<string, unknown>)[capability];
    expect(() => parseResearchEnvironmentStatus({ ...absentStatus, capabilities: partial }))
      .toThrow();
  });

  it('rejects a record carrying an unknown capability', () => {
    expect(() => parseResearchEnvironmentStatus({
      ...absentStatus,
      capabilities: { ...capabilities(), numpy: { expected: '2.2.6', state: 'ready' } },
    })).toThrow();
  });

  it('rejects an unknown capability state', () => {
    expect(() => parseResearchEnvironmentStatus({
      ...absentStatus,
      capabilities: capabilities({ duckdb: { expected: '1.5.3', state: 'unsupported' as never } }),
    })).toThrow();
  });
});

describe('persisted status schema migration (TICKET_1369)', () => {
  it('rejects a non-object live status payload', () => {
    expect(() => parseResearchEnvironmentStatus(null)).toThrow();
  });

  it('projects the exact pre-HistData schema to an actionable non-ready status', () => {
    const legacy = structuredClone(readyStatus) as unknown as Record<string, unknown>;
    delete legacy.schemaVersion;
    delete (legacy.capabilities as Record<string, unknown>).histdata;

    const migrated = parsePersistedResearchEnvironmentStatus(legacy);
    expect(migrated.schemaVersion).toBe(RESEARCH_ENVIRONMENT_STATUS_SCHEMA_VERSION);
    expect(migrated.state).toBe('failed');
    expect(migrated.failure?.category).toBe('lock_drift');
    expect(migrated.failure?.remediation).toContain('Verify Again');
    expect(migrated.migration).toEqual({
      fromSchemaVersion: 1,
      reason: 'histdata_capability_added',
      migratedAtRead: true,
    });
    expect(migrated.capabilities.histdata.state).toBe('absent');
  });

  it('rejects a malformed payload declaring the current schema', () => {
    const malformed = structuredClone(readyStatus) as unknown as Record<string, unknown>;
    delete (malformed.capabilities as Record<string, unknown>).histdata;
    expect(() => parsePersistedResearchEnvironmentStatus(malformed)).toThrow();
  });

  it('stamps an unversioned current capability record without migration', () => {
    const unversioned = structuredClone(readyStatus) as unknown as Record<string, unknown>;
    delete unversioned.schemaVersion;
    const parsed = parsePersistedResearchEnvironmentStatus(unversioned);
    expect(parsed.schemaVersion).toBe(RESEARCH_ENVIRONMENT_STATUS_SCHEMA_VERSION);
    expect(parsed.migration).toBeUndefined();
  });

  it.each([null, { ...readyStatus, schemaVersion: undefined, capabilities: null }])(
    'rejects non-status durable payload %#',
    malformed => {
      expect(() => parsePersistedResearchEnvironmentStatus(malformed)).toThrow();
    },
  );
});

// -----------------------------------------------------------------------------
// AC5: failure legality
// -----------------------------------------------------------------------------

describe('failure union (TICKET_1335 AC5)', () => {
  const legal = [
    { category: 'unsupported_platform', stage: 'admission', cause: 'unsupported' },
    { category: 'pixi_missing', stage: 'admission', cause: 'missing_executable' },
    { category: 'lock_missing', stage: 'admission', cause: 'missing_lock' },
    { category: 'lock_drift', stage: 'admission', cause: 'manifest_drift' },
    { category: 'lifecycle_coordination_failed', stage: 'admission', cause: 'lock_io' },
    { category: 'lifecycle_coordination_failed', stage: 'admission', cause: 'invalid_lock_metadata' },
    { category: 'lifecycle_coordination_failed', stage: 'admission', cause: 'database' },
    { category: 'network_failed', stage: 'install', cause: 'network' },
    { category: 'network_failed', stage: 'repair', cause: 'network' },
    { category: 'install_failed', stage: 'install', cause: 'process_exit' },
    { category: 'repair_failed', stage: 'repair', cause: 'process_exit' },
    { category: 'uninstall_failed', stage: 'uninstall', cause: 'process_exit' },
    { category: 'uninstall_failed', stage: 'uninstall', cause: 'postcondition' },
    { category: 'workload_active', stage: 'admission', cause: 'active' },
    { category: 'workload_active', stage: 'admission', cause: 'unknown' },
    { category: 'operation_interrupted', stage: 'install', cause: 'process_lost' },
    { category: 'operation_interrupted', stage: 'julia_verify', cause: 'process_lost' },
    { category: 'verification_failed', stage: 'python_verify', cause: 'import', capability: 'duckdb' },
    { category: 'verification_failed', stage: 'python_verify', cause: 'probe', capability: 'pandas_ta' },
    { category: 'verification_failed', stage: 'julia_verify', cause: 'backend_init', capability: 'pysr' },
  ] as const;

  it.each(legal)('accepts $category/$stage/$cause', (failure) => {
    expect(() => researchEnvironmentFailureSchema.parse({
      ...failure, message: 'm', remediation: 'r',
    })).not.toThrow();
  });

  it('covers every declared failure category', () => {
    const covered = new Set(legal.map(f => f.category));
    for (const category of RESEARCH_ENVIRONMENT_FAILURE_CATEGORIES) {
      expect(covered.has(category as never)).toBe(true);
    }
  });

  const illegal = [
    // Wrong stage for the category.
    { category: 'verification_failed', stage: 'admission', cause: 'import', capability: 'duckdb' },
    { category: 'install_failed', stage: 'repair', cause: 'process_exit' },
    { category: 'repair_failed', stage: 'install', cause: 'process_exit' },
    { category: 'pixi_missing', stage: 'install', cause: 'missing_executable' },
    { category: 'network_failed', stage: 'python_verify', cause: 'network' },
    { category: 'operation_interrupted', stage: 'admission', cause: 'process_lost' },
    // Wrong cause for the category.
    { category: 'lock_missing', stage: 'admission', cause: 'manifest_drift' },
    { category: 'install_failed', stage: 'install', cause: 'network' },
    { category: 'lifecycle_coordination_failed', stage: 'admission', cause: 'process_lost' },
    // capability present where it does not belong.
    { category: 'install_failed', stage: 'install', cause: 'process_exit', capability: 'duckdb' },
    { category: 'unsupported_platform', stage: 'admission', cause: 'unsupported', capability: 'pysr' },
    // capability absent where it is required.
    { category: 'verification_failed', stage: 'python_verify', cause: 'import' },
    // unknown capability blamed.
    { category: 'verification_failed', stage: 'python_verify', cause: 'import', capability: 'numpy' },
    // unknown category.
    { category: 'solve_failed', stage: 'admission', cause: 'unsupported' },
  ] as const;

  it.each(illegal)('rejects $category/$stage/$cause', (failure) => {
    expect(() => researchEnvironmentFailureSchema.parse({
      ...failure, message: 'm', remediation: 'r',
    })).toThrow();
  });

  it('requires actionable text on every failure (no logging-only)', () => {
    expect(() => researchEnvironmentFailureSchema.parse({
      category: 'pixi_missing', stage: 'admission', cause: 'missing_executable',
      message: 'm',
    })).toThrow();
    expect(() => researchEnvironmentFailureSchema.parse({
      category: 'pixi_missing', stage: 'admission', cause: 'missing_executable',
      message: '', remediation: 'r',
    })).toThrow();
  });
});

// -----------------------------------------------------------------------------
// Status cross-field legality
// -----------------------------------------------------------------------------

describe('status legality', () => {
  it('rejects a failed environment with no failure', () => {
    expect(() => parseResearchEnvironmentStatus({ ...absentStatus, state: 'failed' })).toThrow();
  });

  it('rejects a non-failed environment carrying a failure', () => {
    expect(() => parseResearchEnvironmentStatus({
      ...absentStatus,
      failure: { category: 'pixi_missing', stage: 'admission', cause: 'missing_executable', message: 'm', remediation: 'r' },
    })).toThrow();
  });

  describe('unsupported platform (TICKET_1335 D7 / AC12)', () => {
    const unsupported = {
      ...absentStatus,
      state: 'failed' as const,
      supportedPlatform: false,
      platform: 'darwin',
      architecture: 'arm64',
      failure: {
        category: 'unsupported_platform' as const,
        stage: 'admission' as const,
        cause: 'unsupported' as const,
        message: 'm', remediation: 'r',
      },
    };

    it('accepts unsupported_platform with every capability absent', () => {
      expect(() => parseResearchEnvironmentStatus(unsupported)).not.toThrow();
    });

    it('rejects an unsupported platform failing with another category', () => {
      expect(() => parseResearchEnvironmentStatus({
        ...unsupported,
        failure: { category: 'pixi_missing', stage: 'admission', cause: 'missing_executable', message: 'm', remediation: 'r' },
      })).toThrow();
    });

    it('rejects a non-absent capability on an unsupported platform', () => {
      expect(() => parseResearchEnvironmentStatus({
        ...unsupported,
        capabilities: capabilities({ duckdb: { expected: '1.5.3', installed: '1.5.3', state: 'ready' } }),
      })).toThrow();
    });
  });

  describe('in-flight identity (TICKET_1335_1 AC6/AC6a)', () => {
    it.each([
      ['installing', 'install'],
      ['repairing', 'repair'],
      ['verifying', 'verify'],
    ] as const)('accepts %s carrying its %s job', (state, operation) => {
      expect(() => parseResearchEnvironmentStatus({
        ...absentStatus, state, activeJobId: 'job-1', activeOperation: operation,
      })).not.toThrow();
    });

    it('rejects an in-flight state with no active job id', () => {
      expect(() => parseResearchEnvironmentStatus({
        ...absentStatus, state: 'installing', activeOperation: 'install',
      })).toThrow();
    });

    it('rejects an in-flight state with no active operation', () => {
      expect(() => parseResearchEnvironmentStatus({
        ...absentStatus, state: 'installing', activeJobId: 'job-1',
      })).toThrow();
    });

    it('rejects repairing relabelled as install', () => {
      expect(() => parseResearchEnvironmentStatus({
        ...absentStatus, state: 'repairing', activeJobId: 'job-1', activeOperation: 'install',
      })).toThrow();
    });

    it('rejects installing relabelled as repair', () => {
      expect(() => parseResearchEnvironmentStatus({
        ...absentStatus, state: 'installing', activeJobId: 'job-1', activeOperation: 'repair',
      })).toThrow();
    });
  });

  describe('ready evidence (TICKET_1335_1 AC9)', () => {
    it('accepts a fully verified ready environment', () => {
      expect(() => parseResearchEnvironmentStatus(readyStatus)).not.toThrow();
    });

    it('rejects ready without a resolved interpreter', () => {
      const { interpreterPath, ...rest } = readyStatus;
      expect(() => parseResearchEnvironmentStatus(rest)).toThrow();
    });

    it('rejects ready without a verification timestamp', () => {
      const { lastVerifiedAt, ...rest } = readyStatus;
      expect(() => parseResearchEnvironmentStatus(rest)).toThrow();
    });

    it('rejects ready while a capability is still failed (AC8 subset guard)', () => {
      expect(() => parseResearchEnvironmentStatus({
        ...readyStatus,
        capabilities: { ...readyCapabilities(), pysr: { expected: '1.5.10', state: 'failed' } },
      })).toThrow();
    });

    it('rejects ready when a capability reports no installed version', () => {
      expect(() => parseResearchEnvironmentStatus({
        ...readyStatus,
        capabilities: { ...readyCapabilities(), gpquant: { expected: '0.1.6', state: 'ready' } },
      })).toThrow();
    });
  });

  it('rejects an unknown profile', () => {
    expect(() => parseResearchEnvironmentStatus({ ...absentStatus, profile: 'research-custom' })).toThrow();
  });

  it('rejects unknown extra fields at the boundary', () => {
    expect(() => parseResearchEnvironmentStatus({ ...absentStatus, approval: { granted: true } })).toThrow();
  });

  it('rejects a malformed manifest hash', () => {
    expect(() => parseResearchEnvironmentStatus({ ...absentStatus, manifestSha256: 'not-a-hash' })).toThrow();
  });
});

// -----------------------------------------------------------------------------
// Job legality
// -----------------------------------------------------------------------------

describe('job legality', () => {
  const runningJob = {
    jobId: 'job-1',
    profile: 'research-default' as const,
    operation: 'install' as const,
    state: 'running' as const,
    startedAt: TS,
    currentStage: 'install' as const,
    status: { ...absentStatus, state: 'installing' as const, activeJobId: 'job-1', activeOperation: 'install' as const },
  };

  it('accepts a running install job', () => {
    expect(() => parseResearchEnvironmentJob(runningJob)).not.toThrow();
  });

  it('rejects a terminal job with no finish time', () => {
    expect(() => parseResearchEnvironmentJob({
      ...runningJob, state: 'succeeded', status: readyStatus,
    })).toThrow();
  });

  it('rejects a non-terminal job that reports finishing', () => {
    expect(() => parseResearchEnvironmentJob({ ...runningJob, finishedAt: TS })).toThrow();
  });

  it('rejects a failed job with no structured failure', () => {
    expect(() => parseResearchEnvironmentJob({
      ...runningJob, state: 'failed', finishedAt: TS,
    })).toThrow();
  });

  it('rejects a verify job reporting an install stage (no mutation stages)', () => {
    expect(() => parseResearchEnvironmentJob({
      ...runningJob,
      operation: 'verify',
      currentStage: 'install',
      status: { ...absentStatus, state: 'verifying', activeJobId: 'job-1', activeOperation: 'verify' },
    })).toThrow();
  });

  it('rejects an install job reporting a repair stage', () => {
    expect(() => parseResearchEnvironmentJob({ ...runningJob, currentStage: 'repair' })).toThrow();
  });

  it('accepts a repair job in its repair stage', () => {
    expect(() => parseResearchEnvironmentJob({
      ...runningJob,
      operation: 'repair',
      currentStage: 'repair',
      status: { ...absentStatus, state: 'repairing', activeJobId: 'job-1', activeOperation: 'repair' },
    })).not.toThrow();
  });

  it('rejects a failure whose stage does not belong to the operation', () => {
    expect(() => parseResearchEnvironmentJob({
      ...runningJob,
      operation: 'verify',
      state: 'failed',
      finishedAt: TS,
      currentStage: 'python_verify',
      status: {
        ...absentStatus,
        state: 'failed',
        failure: { category: 'install_failed', stage: 'install', cause: 'process_exit', message: 'm', remediation: 'r' },
      },
    })).toThrow();
  });

  it('bounds the redacted log tail (TICKET_1335 D4)', () => {
    expect(() => parseResearchEnvironmentJob({
      ...runningJob, logTail: Array.from({ length: 201 }, () => 'line'),
    })).toThrow();
    expect(() => parseResearchEnvironmentJob({
      ...runningJob, logTail: ['x'.repeat(2049)],
    })).toThrow();
    expect(() => parseResearchEnvironmentJob({
      ...runningJob, logTail: ['bounded line'],
    })).not.toThrow();
  });

  it('rejects approval-shaped fields on a job (TICKET_1335_1 AC5)', () => {
    expect(() => parseResearchEnvironmentJob({ ...runningJob, approval: 'token' })).toThrow();
    expect(() => parseResearchEnvironmentJob({ ...runningJob, confirm: true })).toThrow();
  });

  it('requires a structured phase result for terminal capability transitions', () => {
    const transitionJob = {
      ...runningJob,
      operation: 'restore_capability' as const,
      state: 'failed' as const,
      finishedAt: TS,
      currentStage: 'transition' as const,
      status: {
        ...readyStatus,
        state: 'failed' as const,
        failure: {
          category: 'install_failed' as const,
          stage: 'install' as const,
          cause: 'process_exit' as const,
          message: 'Cleanup failed.', remediation: 'Retry cleanup.',
        },
      },
    };
    expect(() => parseResearchEnvironmentJob(transitionJob)).toThrow();
    expect(() => parseResearchEnvironmentJob({
      ...transitionJob,
      transition: {
        outcome: 'post_publication_cleanup_pending',
        activeProjection: 'default',
        pendingCleanupProjection: 'without-gpquant',
        recoveryOperation: 'retry_approved_lifecycle_mutation',
      },
    })).not.toThrow();
    expect(() => parseResearchEnvironmentJob({
      ...transitionJob,
      transition: {
        outcome: 'post_publication_cleanup_pending',
        activeProjection: 'default',
        pendingCleanupProjection: 'default',
        recoveryOperation: 'retry_approved_lifecycle_mutation',
      },
    })).toThrow();
  });
});

/**
 * TICKET_1335 D6 item 3: what crosses the wire is evidence of a decision, never
 * the approval itself. These assert the evidence cannot be blank, forged into a
 * different operation, or carry the hashes the service must re-read itself.
 */
describe('research environment approval attestation (TICKET_1335 D6)', () => {
  const attestation = {
    operation: 'install' as const,
    profile: DEFAULT_RESEARCH_ENVIRONMENT_PROFILE,
    grantedTo: 'mcp-session-1',
    decisionId: 'decision-1',
    verifiedAt: TS,
  };

  it('accepts a well-formed attestation for both mutating operations', () => {
    expect(parseResearchEnvironmentApprovalAttestation(attestation)).toEqual(attestation);
    expect(parseResearchEnvironmentApprovalAttestation({
      ...attestation, operation: 'repair',
    }).operation).toBe('repair');
  });

  it('refuses verify, which requires no approval and must not present one', () => {
    expect(() => parseResearchEnvironmentApprovalAttestation({
      ...attestation, operation: 'verify',
    })).toThrow();
  });

  it('refuses blank decision or grant identity', () => {
    // A blank identity carries no evidence; accepting it would make the
    // single-use guard trivially bypassable by omitting the value.
    expect(() => parseResearchEnvironmentApprovalAttestation({
      ...attestation, decisionId: '',
    })).toThrow();
    expect(() => parseResearchEnvironmentApprovalAttestation({
      ...attestation, grantedTo: '',
    })).toThrow();
  });

  it('refuses an unknown profile', () => {
    expect(() => parseResearchEnvironmentApprovalAttestation({
      ...attestation, profile: 'research-experimental',
    })).toThrow();
  });

  it('refuses a non-timestamp verifiedAt', () => {
    expect(() => parseResearchEnvironmentApprovalAttestation({
      ...attestation, verifiedAt: 'recently',
    })).toThrow();
  });

  it('refuses a transported approval object or hashes (D6 item 3)', () => {
    // The approval is constructed by the owner, never transported; and the
    // service re-reads both hashes at admission, so a transported hash would be
    // either ignored or wrongly trusted.
    expect(() => parseResearchEnvironmentApprovalAttestation({
      ...attestation, manifestSha256: SHA,
    })).toThrow();
    expect(() => parseResearchEnvironmentApprovalAttestation({
      ...attestation, lockSha256: SHA,
    })).toThrow();
    expect(() => parseResearchEnvironmentApprovalAttestation({
      ...attestation, approval: { operation: 'install' },
    })).toThrow();
    expect(() => parseResearchEnvironmentApprovalAttestation({
      ...attestation, confirm: true,
    })).toThrow();
  });
});
