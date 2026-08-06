/**
 * TICKET_1335: shared research-environment lifecycle contract.
 *
 * The root cause this module closes is recorded in TICKET_1335's "Root cause"
 * section: the operation was modelled as "install a factor engine", so package
 * identity lived partly in a SQLite `factor_engine_registry` row and partly in
 * `pixi.toml`, Desktop IPC owned installation while Guide WebUI owned only a
 * bridge, and an ambient `pip` exit code was treated as readiness even though
 * research jobs resolve a different, Pixi-managed interpreter.
 *
 * The single owner is the locked `pixi.toml` + `pixi.lock` pair, surfaced
 * through one `ResearchEnvironmentService`. Electron IPC, the Service API, and
 * MCP are adapters over that service. This module is the contract all three
 * serialize, and the one every surface's UI state is derived from -- no
 * surface-local variant of these shapes is permitted (TICKET_1335 "API and
 * contract sketch"; TICKET_1335_1 D2).
 *
 * Two properties are load-bearing and are enforced at runtime below rather than
 * left to TypeScript, because types are erased and every consumer here sits on
 * the far side of a process or trust boundary:
 *
 * 1. `RESEARCH_CAPABILITIES` is a runtime tuple and `ResearchCapability` is
 *    derived from it. Renderers iterate the tuple to build one card per
 *    capability (TICKET_1335_1 AC3), so runtime coverage and compile-time
 *    identity cannot drift.
 * 2. `ResearchEnvironmentFailure` is a discriminated union whose `stage`,
 *    `cause`, and `capability` fields are legal only in specific combinations.
 *    TICKET_1335 AC5 requires that illegal combinations be *rejected*, not
 *    merely untypable, so the schema encodes the union per-variant.
 */

import { z } from 'zod';

// -----------------------------------------------------------------------------
// Profile
// -----------------------------------------------------------------------------

/**
 * The one governed environment profile. TICKET_1335 D1 fixes this to a closed
 * set so an MCP or IPC caller cannot name an arbitrary environment; adding a
 * profile is a repository change reviewed like code, not a runtime argument.
 */
export const RESEARCH_ENVIRONMENT_PROFILES = ['research-default'] as const;

export type ResearchEnvironmentProfile =
  (typeof RESEARCH_ENVIRONMENT_PROFILES)[number];

export const DEFAULT_RESEARCH_ENVIRONMENT_PROFILE: ResearchEnvironmentProfile =
  'research-default';

// -----------------------------------------------------------------------------
// Capabilities
// -----------------------------------------------------------------------------

/**
 * Runtime source of truth for the locked capabilities the environment reports.
 *
 * `pandas_ta` is a first-class member rather than an implementation detail of
 * the TA-Lib catalog entry: TICKET_1335 D2 removed Engine Store's pip install
 * path, so the locked environment is the only thing standing behind the TA-Lib
 * factor engine and its readiness must be reported rather than assumed
 * (TICKET_1335 D5; TICKET_1335_1 D3/AC15).
 *
 * Deliberately absent: a `shared_stack` pseudo-capability. TICKET_1335 D5 step 7
 * attributes NumPy/pandas/SciPy/scikit-learn/PyArrow import failures to the
 * first capability probe that depends on them, because nothing in the UI
 * installs or reports the shared stack independently.
 *
 * The identifier is `pandas_ta`, not `pandas-ta`: it is a `Record` key and a
 * Python module name, and keeping the hyphenated distribution name out of the
 * key space avoids a second spelling crossing the boundary.
 */
export const RESEARCH_CAPABILITIES = [
  'histdata',
  'duckdb',
  'gplearn',
  'gpquant',
  'pysr',
  'pandas_ta',
] as const;

export type ResearchCapability = (typeof RESEARCH_CAPABILITIES)[number];

/** Version of the durable status JSON contract (TICKET_1369). */
export const RESEARCH_ENVIRONMENT_STATUS_SCHEMA_VERSION = 2 as const;

export interface ResearchEnvironmentStatusMigration {
  fromSchemaVersion: 1;
  reason: 'histdata_capability_added';
  migratedAtRead: true;
}

export const RESEARCH_ENVIRONMENT_PROJECTIONS = ['default', 'without-gpquant'] as const;
export type ResearchEnvironmentProjection = (typeof RESEARCH_ENVIRONMENT_PROJECTIONS)[number];
export const DEFAULT_RESEARCH_ENVIRONMENT_PROJECTION: ResearchEnvironmentProjection = 'default';

export const REMOVABLE_RESEARCH_CAPABILITIES = ['gpquant'] as const;
export type RemovableResearchCapability = (typeof REMOVABLE_RESEARCH_CAPABILITIES)[number];

/**
 * The single validator for capability identity crossing a process or trust
 * boundary, mirroring `isFactorCatalogId` in `./factor-catalog`.
 */
export function isResearchCapability(value: unknown): value is ResearchCapability {
  return typeof value === 'string'
    && (RESEARCH_CAPABILITIES as readonly string[]).includes(value);
}

// -----------------------------------------------------------------------------
// States, operations, stages
// -----------------------------------------------------------------------------

export const RESEARCH_ENVIRONMENT_STATES = [
  'absent',
  'installing',
  'repairing',
  'verifying',
  'uninstalling',
  'ready',
  'failed',
] as const;

export type ResearchEnvironmentState =
  (typeof RESEARCH_ENVIRONMENT_STATES)[number];

/**
 * Capability states mirror the environment states by construction. TICKET_1335
 * D7 is explicit that `unsupported` is NOT a capability state: on an
 * unsupported platform every capability stays `absent` and the *environment*
 * carries `unsupported_platform`, so an unsupported host cannot be mistaken for
 * a per-package problem.
 */
export const RESEARCH_CAPABILITY_STATES = RESEARCH_ENVIRONMENT_STATES;
export const RESEARCH_CAPABILITY_LIFECYCLE_STATES = [
  ...RESEARCH_CAPABILITY_STATES,
  'intentionally_absent',
] as const;

export type ResearchCapabilityState = (typeof RESEARCH_CAPABILITY_LIFECYCLE_STATES)[number];

/**
 * The three public mutating/inspecting operations. `verify` is here rather than
 * being a synchronous call because the canonical verifier initializes the PySR
 * Julia backend and runs a bounded regression probe -- multi-second to
 * multi-minute even on a `ready` environment (TICKET_1335_1 D4). Modelling it
 * as a blocking request would be unfixable without raising a timeout, which
 * TICKET_855 forbids.
 */
export const RESEARCH_ENVIRONMENT_OPERATIONS = [
  'install',
  'repair',
  'verify',
  'uninstall',
  'remove_capability',
  'restore_capability',
] as const;

export type ResearchEnvironmentOperation =
  (typeof RESEARCH_ENVIRONMENT_OPERATIONS)[number];

/**
 * `julia_verify` is a distinct stage from `python_verify` because PySR has a
 * second runtime layer: the Julia dependencies install on first import, so a
 * green Python wheel install proves nothing about backend readiness
 * (TICKET_1335 investigation item 4, and the D0 execution record where first
 * import drove a 1.4 GB Julia depot download). TICKET_1335 AC4 and
 * TICKET_1335_1 AC8 both depend on these being separable.
 */
export const RESEARCH_ENVIRONMENT_STAGES = [
  'admission',
  'install',
  'repair',
  'uninstall',
  'transition',
  'python_verify',
  'julia_verify',
] as const;

export type ResearchEnvironmentStage =
  (typeof RESEARCH_ENVIRONMENT_STAGES)[number];

export const RESEARCH_ENVIRONMENT_JOB_STATES = [
  'queued',
  'running',
  'succeeded',
  'failed',
] as const;

export type ResearchEnvironmentJobState =
  (typeof RESEARCH_ENVIRONMENT_JOB_STATES)[number];

// -----------------------------------------------------------------------------
// Bounds
// -----------------------------------------------------------------------------

/**
 * Bounds exist so a hostile or merely broken producer cannot push an unbounded
 * payload across the boundary, and so the persisted log tail stays bounded as
 * TICKET_1335 D4 requires. They live here rather than in a surface constants
 * file because every surface validates against the same schema (TICKET_179).
 */
export const RESEARCH_ENV_MAX_IDENTIFIER_CHARS = 128;
export const RESEARCH_ENV_MAX_VERSION_CHARS = 64;
export const RESEARCH_ENV_MAX_PATH_CHARS = 4096;
export const RESEARCH_ENV_MAX_MESSAGE_CHARS = 2048;
export const RESEARCH_ENV_MAX_LOG_LINES = 200;
export const RESEARCH_ENV_MAX_LOG_LINE_CHARS = 2048;

// -----------------------------------------------------------------------------
// Capability status
// -----------------------------------------------------------------------------

export interface ResearchCapabilityStatus {
  /** Version required by the committed lock. */
  expected: string;
  /** Version read back from the resolved interpreter; absent until verified. */
  installed?: string;
  state: ResearchCapabilityState;
  /** Human-readable evidence summary, e.g. the probe result. Never parsed. */
  verification?: string;
}

// -----------------------------------------------------------------------------
// Failure
// -----------------------------------------------------------------------------

export const RESEARCH_ENVIRONMENT_FAILURE_CATEGORIES = [
  'unsupported_platform',
  'pixi_missing',
  'lock_missing',
  'lock_drift',
  'lifecycle_coordination_failed',
  'network_failed',
  'install_failed',
  'repair_failed',
  'uninstall_failed',
  'workload_active',
  'operation_interrupted',
  'verification_failed',
] as const;

export type ResearchEnvironmentFailureCategory =
  (typeof RESEARCH_ENVIRONMENT_FAILURE_CATEGORIES)[number];

/**
 * Every failure carries operator-facing text. Surfaces render `message` and
 * `remediation` but select presentation from `category`/`stage`/`cause`/
 * `capability` only -- TICKET_1335 AC5 and TICKET_1335_1 AC7 forbid parsing the
 * human text to make a decision.
 */
export interface ResearchFailureCommon {
  message: string;
  remediation: string;
}

export type ResearchEnvironmentFailure = ResearchFailureCommon & (
  | { category: 'unsupported_platform'; stage: 'admission'; cause: 'unsupported' }
  | { category: 'pixi_missing'; stage: 'admission'; cause: 'missing_executable' }
  | { category: 'lock_missing'; stage: 'admission'; cause: 'missing_lock' }
  | { category: 'lock_drift'; stage: 'admission'; cause: 'manifest_drift' }
  | {
      category: 'lifecycle_coordination_failed';
      stage: 'admission';
      cause: 'lock_io' | 'invalid_lock_metadata' | 'database';
    }
  | { category: 'network_failed'; stage: 'install' | 'repair'; cause: 'network' }
  | { category: 'install_failed'; stage: 'install'; cause: 'process_exit' }
  | { category: 'repair_failed'; stage: 'repair'; cause: 'process_exit' }
  | { category: 'uninstall_failed'; stage: 'uninstall'; cause: 'process_exit' | 'postcondition' }
  | { category: 'workload_active'; stage: 'admission'; cause: 'active' | 'unknown' }
  | {
      category: 'operation_interrupted';
      stage: 'install' | 'repair' | 'uninstall' | 'python_verify' | 'julia_verify';
      cause: 'process_lost';
    }
  | {
      category: 'verification_failed';
      stage: 'python_verify' | 'julia_verify';
      cause: 'import' | 'probe' | 'backend_init';
      capability: ResearchCapability;
    }
);

// -----------------------------------------------------------------------------
// Status and job
// -----------------------------------------------------------------------------

export interface ResearchEnvironmentStatus {
  schemaVersion: typeof RESEARCH_ENVIRONMENT_STATUS_SCHEMA_VERSION;
  migration?: ResearchEnvironmentStatusMigration;
  profile: ResearchEnvironmentProfile;
  projection: ResearchEnvironmentProjection;
  state: ResearchEnvironmentState;
  supportedPlatform: boolean;
  platform: string;
  architecture: string;
  activeJobId?: string;
  activeOperation?: ResearchEnvironmentOperation;
  pixiVersion?: string;
  manifestSha256?: string;
  lockSha256?: string;
  interpreterPath?: string;
  lastVerifiedAt?: string;
  /**
   * Every runtime capability appears exactly once, so any capability that can
   * be blamed by `failure.capability` is guaranteed a reportable entry and a
   * renderable card (TICKET_1335 AC3; TICKET_1335_1 AC3).
   */
  capabilities: Record<ResearchCapability, ResearchCapabilityStatus>;
  failure?: ResearchEnvironmentFailure;
}

/** In-process producers may omit the version; the boundary parser stamps it. */
export type ResearchEnvironmentStatusInput =
  Omit<ResearchEnvironmentStatus, 'schemaVersion'> & { schemaVersion?: never };

export interface ResearchEnvironmentJob {
  jobId: string;
  profile: ResearchEnvironmentProfile;
  operation: ResearchEnvironmentOperation;
  state: ResearchEnvironmentJobState;
  startedAt?: string;
  finishedAt?: string;
  currentStage?: ResearchEnvironmentStage;
  /**
   * Bounded, redacted log tail. TICKET_1335 D4 requires logs to be bounded and
   * secrets redacted; the bound is enforced by the schema, and redaction is the
   * producing service's responsibility before serialization.
   */
  logTail?: string[];
  status: ResearchEnvironmentStatus;
  transition?: ResearchEnvironmentTransitionResult;
}

/** Canonical phase result for capability projection transitions (TICKET_1355_2E). */
export type ResearchEnvironmentTransitionResult =
  | {
      outcome: 'completed';
      activeProjection: ResearchEnvironmentProjection;
    }
  | {
      outcome: 'pre_publication_failure';
      activeProjection: ResearchEnvironmentProjection;
    }
  | {
      outcome: 'post_publication_cleanup_pending';
      activeProjection: ResearchEnvironmentProjection;
      pendingCleanupProjection: ResearchEnvironmentProjection;
      recoveryOperation: 'retry_approved_lifecycle_mutation';
    };

// -----------------------------------------------------------------------------
// Runtime schemas
// -----------------------------------------------------------------------------

const identifierSchema = z.string().min(1).max(RESEARCH_ENV_MAX_IDENTIFIER_CHARS);
const versionSchema = z.string().min(1).max(RESEARCH_ENV_MAX_VERSION_CHARS);
const pathSchema = z.string().min(1).max(RESEARCH_ENV_MAX_PATH_CHARS);
const messageSchema = z.string().min(1).max(RESEARCH_ENV_MAX_MESSAGE_CHARS);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });

export const researchCapabilitySchema = z.enum(RESEARCH_CAPABILITIES);

export const researchCapabilityStatusSchema: z.ZodType<ResearchCapabilityStatus> =
  z.object({
    expected: versionSchema,
    installed: versionSchema.optional(),
    state: z.enum(RESEARCH_CAPABILITY_LIFECYCLE_STATES),
    verification: messageSchema.optional(),
  }).strict();

const failureCommonShape = {
  message: messageSchema,
  remediation: messageSchema,
};

/**
 * The union is spelled out per variant rather than as a flat object with
 * optional fields. A flat shape would accept `verification_failed` at stage
 * `admission`, or `unsupported_platform` carrying a `capability` -- exactly the
 * illegal combinations TICKET_1335 AC5 requires be rejected.
 */
export const researchEnvironmentFailureSchema: z.ZodType<ResearchEnvironmentFailure> =
  z.discriminatedUnion('category', [
    z.object({
      ...failureCommonShape,
      category: z.literal('unsupported_platform'),
      stage: z.literal('admission'),
      cause: z.literal('unsupported'),
    }).strict(),
    z.object({
      ...failureCommonShape,
      category: z.literal('pixi_missing'),
      stage: z.literal('admission'),
      cause: z.literal('missing_executable'),
    }).strict(),
    z.object({
      ...failureCommonShape,
      category: z.literal('lock_missing'),
      stage: z.literal('admission'),
      cause: z.literal('missing_lock'),
    }).strict(),
    z.object({
      ...failureCommonShape,
      category: z.literal('lock_drift'),
      stage: z.literal('admission'),
      cause: z.literal('manifest_drift'),
    }).strict(),
    z.object({
      ...failureCommonShape,
      category: z.literal('lifecycle_coordination_failed'),
      stage: z.literal('admission'),
      cause: z.enum(['lock_io', 'invalid_lock_metadata', 'database']),
    }).strict(),
    z.object({
      ...failureCommonShape,
      category: z.literal('network_failed'),
      stage: z.enum(['install', 'repair']),
      cause: z.literal('network'),
    }).strict(),
    z.object({
      ...failureCommonShape,
      category: z.literal('install_failed'),
      stage: z.literal('install'),
      cause: z.literal('process_exit'),
    }).strict(),
    z.object({
      ...failureCommonShape,
      category: z.literal('repair_failed'),
      stage: z.literal('repair'),
      cause: z.literal('process_exit'),
    }).strict(),
    z.object({
      ...failureCommonShape,
      category: z.literal('uninstall_failed'),
      stage: z.literal('uninstall'),
      cause: z.enum(['process_exit', 'postcondition']),
    }).strict(),
    z.object({
      ...failureCommonShape,
      category: z.literal('workload_active'),
      stage: z.literal('admission'),
      cause: z.enum(['active', 'unknown']),
    }).strict(),
    z.object({
      ...failureCommonShape,
      category: z.literal('operation_interrupted'),
      stage: z.enum(['install', 'repair', 'uninstall', 'python_verify', 'julia_verify']),
      cause: z.literal('process_lost'),
    }).strict(),
    z.object({
      ...failureCommonShape,
      category: z.literal('verification_failed'),
      stage: z.enum(['python_verify', 'julia_verify']),
      cause: z.enum(['import', 'probe', 'backend_init']),
      capability: researchCapabilitySchema,
    }).strict(),
  ]) as z.ZodType<ResearchEnvironmentFailure>;

/**
 * Built from the runtime tuple so a capability added to `RESEARCH_CAPABILITIES`
 * is required here without a second edit. A status object missing a capability,
 * or carrying an unknown one, is rejected at the boundary -- the runtime half of
 * TICKET_1335_1 AC3.
 */
const capabilitiesRecordSchema = z.object(
  Object.fromEntries(
    RESEARCH_CAPABILITIES.map(capability => [capability, researchCapabilityStatusSchema]),
  ) as Record<ResearchCapability, typeof researchCapabilityStatusSchema>,
).strict();

export const researchEnvironmentStatusSchema: z.ZodType<ResearchEnvironmentStatus> =
  z.object({
    schemaVersion: z.literal(RESEARCH_ENVIRONMENT_STATUS_SCHEMA_VERSION),
    migration: z.object({
      fromSchemaVersion: z.literal(1),
      reason: z.literal('histdata_capability_added'),
      migratedAtRead: z.literal(true),
    }).strict().optional(),
    profile: z.enum(RESEARCH_ENVIRONMENT_PROFILES),
    projection: z.enum(RESEARCH_ENVIRONMENT_PROJECTIONS),
    state: z.enum(RESEARCH_ENVIRONMENT_STATES),
    supportedPlatform: z.boolean(),
    platform: identifierSchema,
    architecture: identifierSchema,
    activeJobId: identifierSchema.optional(),
    activeOperation: z.enum(RESEARCH_ENVIRONMENT_OPERATIONS).optional(),
    pixiVersion: versionSchema.optional(),
    manifestSha256: sha256Schema.optional(),
    lockSha256: sha256Schema.optional(),
    interpreterPath: pathSchema.optional(),
    lastVerifiedAt: timestampSchema.optional(),
    capabilities: capabilitiesRecordSchema,
    failure: researchEnvironmentFailureSchema.optional(),
  }).strict().superRefine((status, context) => {
    // A `failed` environment without a failure would leave the UI with nothing
    // actionable to render, which TICKET_1335_1 AC7 forbids; the inverse would
    // let a non-failed status carry a stale failure the UI might surface.
    if (status.state === 'failed' && !status.failure) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'A failed environment must carry a structured failure.',
      });
    }
    if (status.state !== 'failed' && status.failure) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'Only a failed environment may carry a failure.',
      });
    }
    // TICKET_1335 D7: an unsupported platform is an environment-level verdict.
    // Every capability stays `absent` so no card can imply a package problem.
    if (!status.supportedPlatform) {
      if (status.failure?.category !== 'unsupported_platform') {
        context.addIssue({
          code: 'custom',
          path: ['failure'],
          message: 'An unsupported platform must fail with unsupported_platform.',
        });
      }
      for (const capability of RESEARCH_CAPABILITIES) {
        if (status.capabilities[capability].state !== 'absent') {
          context.addIssue({
            code: 'custom',
            path: ['capabilities', capability, 'state'],
            message: 'Capabilities remain absent on an unsupported platform.',
          });
        }
      }
    }
    // An in-flight state without a job identity cannot be reconnected after a
    // renderer reload, which TICKET_1335_1 AC6 requires.
    const inFlight = status.state === 'installing'
      || status.state === 'repairing'
      || status.state === 'verifying'
      || status.state === 'uninstalling';
    if (inFlight && (!status.activeJobId || !status.activeOperation)) {
      context.addIssue({
        code: 'custom',
        path: ['activeJobId'],
        message: 'An in-flight environment must identify its active job.',
      });
    }
    // TICKET_1335_1 AC6a: the reported state must not relabel the operation
    // that is actually running, or reload would rename a repair an install.
    const expectedInFlightState: Record<ResearchEnvironmentOperation, ResearchEnvironmentState> = {
      install: 'installing',
      repair: 'repairing',
      verify: 'verifying',
      uninstall: 'uninstalling',
      remove_capability: 'installing',
      restore_capability: 'installing',
    };
    if (inFlight && status.activeOperation
      && expectedInFlightState[status.activeOperation] !== status.state) {
      context.addIssue({
        code: 'custom',
        path: ['activeOperation'],
        message: 'Active operation must match the in-flight environment state.',
      });
    }
    // TICKET_1335_1 AC8/AC9: `ready` is a claim that the verifier passed, so it
    // must carry the evidence the page displays.
    if (status.state === 'ready') {
      if (!status.interpreterPath || !status.lastVerifiedAt) {
        context.addIssue({
          code: 'custom',
          message: 'A ready environment must record its interpreter and verification time.',
        });
      }
      for (const capability of RESEARCH_CAPABILITIES) {
        const entry = status.capabilities[capability];
        const intentionallyAbsent = status.projection === 'without-gpquant'
          && capability === 'gpquant'
          && entry.state === 'intentionally_absent'
          && !entry.installed;
        if (!intentionallyAbsent && (entry.state !== 'ready' || !entry.installed)) {
          context.addIssue({
            code: 'custom',
            path: ['capabilities', capability],
            message: 'A ready environment requires every capability verified with a version.',
          });
        }
      }
    }
  }) as unknown as z.ZodType<ResearchEnvironmentStatus>;

const researchEnvironmentTransitionResultSchema: z.ZodType<ResearchEnvironmentTransitionResult> =
  z.discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('completed'),
      activeProjection: z.enum(RESEARCH_ENVIRONMENT_PROJECTIONS),
    }).strict(),
    z.object({
      outcome: z.literal('pre_publication_failure'),
      activeProjection: z.enum(RESEARCH_ENVIRONMENT_PROJECTIONS),
    }).strict(),
    z.object({
      outcome: z.literal('post_publication_cleanup_pending'),
      activeProjection: z.enum(RESEARCH_ENVIRONMENT_PROJECTIONS),
      pendingCleanupProjection: z.enum(RESEARCH_ENVIRONMENT_PROJECTIONS),
      recoveryOperation: z.literal('retry_approved_lifecycle_mutation'),
    }).strict(),
  ]);

export const researchEnvironmentJobSchema: z.ZodType<ResearchEnvironmentJob> =
  z.object({
    jobId: identifierSchema,
    profile: z.enum(RESEARCH_ENVIRONMENT_PROFILES),
    operation: z.enum(RESEARCH_ENVIRONMENT_OPERATIONS),
    state: z.enum(RESEARCH_ENVIRONMENT_JOB_STATES),
    startedAt: timestampSchema.optional(),
    finishedAt: timestampSchema.optional(),
    currentStage: z.enum(RESEARCH_ENVIRONMENT_STAGES).optional(),
    logTail: z.array(z.string().max(RESEARCH_ENV_MAX_LOG_LINE_CHARS))
      .max(RESEARCH_ENV_MAX_LOG_LINES)
      .optional(),
    status: researchEnvironmentStatusSchema,
    transition: researchEnvironmentTransitionResultSchema.optional(),
  }).strict().superRefine((job, context) => {
    // A terminal job with no end timestamp would leave the UI unable to stop
    // its elapsed-time display, and a failed job must stay actionable.
    const terminal = job.state === 'succeeded' || job.state === 'failed';
    if (terminal && !job.finishedAt) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'A terminal job must record when it finished.',
      });
    }
    if (!terminal && job.finishedAt) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'A non-terminal job cannot have finished.',
      });
    }
    if (job.state === 'failed' && !job.status.failure) {
      context.addIssue({
        code: 'custom',
        path: ['status', 'failure'],
        message: 'A failed job must carry a structured failure.',
      });
    }
    const transitionOperation = job.operation === 'remove_capability'
      || job.operation === 'restore_capability';
    if (transitionOperation && terminal && !job.transition) {
      context.addIssue({
        code: 'custom', path: ['transition'],
        message: 'A terminal capability transition must carry its canonical phase result.',
      });
    }
    if (!transitionOperation && job.transition) {
      context.addIssue({
        code: 'custom', path: ['transition'],
        message: 'Only capability transitions may carry a transition phase result.',
      });
    }
    if (job.transition?.outcome === 'post_publication_cleanup_pending'
      && (job.state !== 'failed'
        || job.transition.activeProjection === job.transition.pendingCleanupProjection)) {
      context.addIssue({
        code: 'custom', path: ['transition'],
        message: 'Cleanup-pending requires a failed job and a distinct inactive projection.',
      });
    }
    // The stage a job reports must belong to the operation that is running;
    // `install` stages under a verify job would misdirect every failure card.
    const stagesByOperation: Record<ResearchEnvironmentOperation, readonly ResearchEnvironmentStage[]> = {
      install: ['admission', 'install', 'python_verify', 'julia_verify'],
      repair: ['admission', 'repair', 'python_verify', 'julia_verify'],
      verify: ['admission', 'python_verify', 'julia_verify'],
      uninstall: ['admission', 'uninstall'],
      remove_capability: ['admission', 'install', 'transition', 'python_verify', 'julia_verify'],
      restore_capability: ['admission', 'install', 'transition', 'python_verify', 'julia_verify'],
    };
    if (job.currentStage
      && !stagesByOperation[job.operation].includes(job.currentStage)) {
      context.addIssue({
        code: 'custom',
        path: ['currentStage'],
        message: 'Stage does not belong to the running operation.',
      });
    }
    if (job.status.failure
      && !stagesByOperation[job.operation].includes(job.status.failure.stage)) {
      context.addIssue({
        code: 'custom',
        path: ['status', 'failure', 'stage'],
        message: 'Failure stage does not belong to the running operation.',
      });
    }
  }) as unknown as z.ZodType<ResearchEnvironmentJob>;

// -----------------------------------------------------------------------------
// Boundary parsers
// -----------------------------------------------------------------------------

/**
 * Adapters call these rather than casting. TICKET_1335's contract section is
 * explicit that TypeScript types alone are not treated as runtime validation at
 * the IPC, Service API, MCP, preload, persistence-recovery, and renderer
 * boundaries.
 */
export function parseResearchEnvironmentStatus(value: unknown): ResearchEnvironmentStatus {
  const candidate = value && typeof value === 'object'
    ? { schemaVersion: RESEARCH_ENVIRONMENT_STATUS_SCHEMA_VERSION, ...value }
    : value;
  return researchEnvironmentStatusSchema.parse(candidate);
}

/**
 * Compatibility reader for durable status JSON.
 *
 * Only the exact pre-HistData capability key set is migrated. A payload which
 * declares the current version, or any other incomplete capability shape,
 * remains corrupt and is rejected by the strict current schema.
 */
export function parsePersistedResearchEnvironmentStatus(
  value: unknown,
): ResearchEnvironmentStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return researchEnvironmentStatusSchema.parse(value);
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== undefined) {
    return researchEnvironmentStatusSchema.parse(value);
  }
  const capabilities = record.capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return researchEnvironmentStatusSchema.parse(value);
  }
  const legacyKeys = ['duckdb', 'gplearn', 'gpquant', 'pysr', 'pandas_ta'];
  const actualKeys = Object.keys(capabilities).sort();
  if (actualKeys.join(',') !== [...legacyKeys].sort().join(',')) {
    return parseResearchEnvironmentStatus(value);
  }

  const legacy = record as Record<string, unknown> & {
    capabilities: Record<string, unknown>;
  };
  return researchEnvironmentStatusSchema.parse({
    ...legacy,
    schemaVersion: RESEARCH_ENVIRONMENT_STATUS_SCHEMA_VERSION,
    migration: {
      fromSchemaVersion: 1,
      reason: 'histdata_capability_added',
      migratedAtRead: true,
    },
    state: 'failed',
    activeJobId: undefined,
    activeOperation: undefined,
    capabilities: {
      histdata: {
        expected: 'unknown',
        state: 'absent',
        verification: 'HistData was not recorded by the historical status schema.',
      },
      ...legacy.capabilities,
    },
    failure: {
      category: 'lock_drift',
      stage: 'admission',
      cause: 'manifest_drift',
      message: 'The saved research-environment verification predates the required HistData capability.',
      remediation: 'Run Verify Again to record every capability from the current locked environment.',
    },
  });
}

export function parseResearchEnvironmentJob(value: unknown): ResearchEnvironmentJob {
  return researchEnvironmentJobSchema.parse(value);
}

/**
 * Validate a persisted or transported failure payload.
 *
 * Needed independently of `parseResearchEnvironmentStatus` because L3 stores
 * the failure as its own column and recovers it without a surrounding status
 * (TICKET_1335 D4 crash reconciliation), so the failure crosses the persistence
 * boundary on its own.
 */
export function parseResearchEnvironmentFailure(value: unknown): ResearchEnvironmentFailure {
  return researchEnvironmentFailureSchema.parse(value);
}

// -----------------------------------------------------------------------------
// Human-origin attestation
// -----------------------------------------------------------------------------

/**
 * Evidence that a human approved one environment mutation, as it crosses a
 * process boundary.
 *
 * This is deliberately NOT `LocalMutationApproval`. TICKET_1335 D6 item 3
 * requires the approval object itself never be serialized into an MCP result,
 * event, browser state, or public tool argument -- so the approval is
 * constructed inside the process that owns `ResearchEnvironmentService`, and
 * only this attestation travels.
 *
 * The distinction is load-bearing rather than cosmetic. The Service API is
 * loopback with a bearer token, and that token proves only that a local process
 * could read the discovery file; it is not evidence that a human approved a
 * multi-gigabyte local mutation. If the transport carried a ready-made approval,
 * possessing the token would be equivalent to possessing approval. Carrying the
 * attestation instead keeps the authority (who observed the human) separate
 * from the owner (who performs the mutation), which is the same separation
 * Electron Main gets for free by holding both in one process.
 *
 * `manifestSha256`/`lockSha256` are deliberately absent: the service re-reads
 * both at admission (D4 forbids adapters prevalidating hashes and assuming the
 * service sees the same files), so transporting them would add a value that is
 * either ignored or, worse, trusted.
 */
export interface ResearchEnvironmentApprovalAttestation {
  /** The mutation the human approved. */
  operation: 'install' | 'repair' | 'uninstall' | 'remove_capability' | 'restore_capability';
  /** The profile the decision was bound to. */
  profile: ResearchEnvironmentProfile;
  /** Opaque identity of the surface the decision was granted to. */
  grantedTo: string;
  /** Identity of the decision itself; enforces single-use at the service. */
  decisionId: string;
  /** When the authority verified the human decision. */
  verifiedAt: string;
}

export const researchEnvironmentApprovalAttestationSchema:
z.ZodType<ResearchEnvironmentApprovalAttestation> = z.object({
  operation: z.enum(['install', 'repair', 'uninstall', 'remove_capability', 'restore_capability']),
  profile: z.enum(RESEARCH_ENVIRONMENT_PROFILES),
  // Non-empty: an attestation whose subject or decision identity is blank
  // carries no evidence, and must not be silently accepted as one that does.
  grantedTo: z.string().min(1),
  decisionId: z.string().min(1),
  verifiedAt: z.string().datetime(),
  // `.strict()` is the enforcement, not decoration: without it zod strips
  // unknown keys, so a transported approval object or a prevalidated hash
  // would be silently dropped instead of refused. D6 item 3 requires refusal.
}).strict();

export function parseResearchEnvironmentApprovalAttestation(
  value: unknown,
): ResearchEnvironmentApprovalAttestation {
  return researchEnvironmentApprovalAttestationSchema.parse(value);
}
