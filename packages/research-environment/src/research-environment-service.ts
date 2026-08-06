/**
 * TICKET_1335 L4: `ResearchEnvironmentService` -- the one shared lifecycle owner.
 *
 * The root cause recorded in TICKET_1335 is that this owner did not exist:
 * Desktop IPC owned installation while Guide WebUI owned only a bridge, package
 * identity was split between a SQLite registry row and `pixi.toml`, and an
 * ambient `pip` exit code was treated as readiness. Every surface -- Electron
 * IPC, the Service API, MCP -- is an adapter over this class. None of them may
 * spawn a package manager, resolve an interpreter, or decide readiness.
 *
 * What this layer owns:
 *   - synthesizing `ResearchEnvironmentStatus`, which L3 deliberately did not do
 *     because it requires platform detection and interpreter probes;
 *   - argument-vector spawning of `pixi install --locked` (D3);
 *   - the five capability probes including PySR's Julia backend (D5);
 *   - mapping every failure onto a distinct contract category (D6).
 *
 * What it does NOT own: job admission, ownership, and crash recovery. Those are
 * L3's (`ResearchEnvironmentJobRepository`), and this class calls into it rather
 * than keeping any private notion of "an install is running" -- the private
 * registry per surface is precisely what allowed two installers to run against
 * one `.pixi` directory.
 */

import {
  DEFAULT_RESEARCH_ENVIRONMENT_PROFILE,
  DEFAULT_RESEARCH_ENVIRONMENT_PROJECTION,
  parseResearchEnvironmentStatus,
  RESEARCH_CAPABILITIES,
  type ResearchCapability,
  type ResearchEnvironmentFailure,
  type ResearchEnvironmentJob,
  type ResearchEnvironmentOperation,
  type ResearchEnvironmentProfile,
  type ResearchEnvironmentProjection,
  type RemovableResearchCapability,
  type ResearchEnvironmentStatus,
  type ResearchEnvironmentStatusInput,
} from '@StratCraft/types';

import {
  RESEARCH_ENV_PATH_ERROR_CODES,
  ResearchEnvironmentPathError,
  isSupportedPlatform,
  readEnvironmentIdentity,
  readLockedVersions,
  resolveProjectionEnvironmentPaths,
  validateEnvironmentRemovalTarget,
  resolvePixiExecutable,
  type EnvironmentHost,
} from './environment-paths';
import {
  ResearchEnvironmentJobError,
  RESEARCH_ENV_JOB_ERROR_CODES,
  type PersistedResearchEnvironmentJob,
  type ResearchEnvironmentJobRepository,
} from './job-repository';
import { PROBE_PROGRAM } from './probe-program';
import {
  parseProbeOutput,
  projectProbeResults,
  ResearchEnvironmentProbeError,
  uniformCapabilities,
} from './probe-result';
import {
  looksLikeLockDrift,
  looksLikeNetworkFailure,
  runPixiInstall,
  runPixiRepair,
  runPixiUninstall,
  runPixiVersion,
  runReadinessProbe,
  type ProcessResult,
  type ProcessRunner,
} from './process-runner';
import { ResearchEnvironmentHeartbeat } from './heartbeat';
import { RESEARCH_ENV_PERSISTED_LOG_LINES } from './constants';
import {
  parsePixiProgressLine,
  parseProbeProgressLine,
  type ResearchEnvironmentWorkloadUpdate,
} from './workload-progress';

// -----------------------------------------------------------------------------
// Mutation approval
// -----------------------------------------------------------------------------

/**
 * The trusted approval an adapter must supply for install and repair.
 *
 * Constructed only by an authority that observed a real human decision --
 * Electron Main after `dialog.showMessageBox()`. TICKET_1335 D6 is explicit that
 * a renderer- or model-supplied boolean is never authority, and D4 states the
 * public operation schemas contain no approval value at all: the *public*
 * operation takes no approval, and the adapter creates this internal object
 * after verifying the human decision.
 *
 * The hashes are bound in so that editing `pixi.toml` while the dialog is open
 * invalidates the approval. The service recomputes both hashes at admission and
 * compares -- D4 requires that "adapters may not prevalidate hashes and assume
 * the service will see the same files".
 */
export interface LocalMutationApproval {
  operation: Exclude<ResearchEnvironmentOperation, 'verify'>;
  profile: ResearchEnvironmentProfile;
  manifestSha256: string;
  lockSha256: string;
  /** Canonical repository-owned environment directory shown to the approver. */
  environmentRoot: string;
  targetProjection?: ResearchEnvironmentProjection;
  /** Opaque identity of the surface that obtained the decision. */
  grantedTo: string;
  /**
   * Identity of the *decision*, unique per human confirmation.
   *
   * Single-use is bound to this rather than to `grantedTo`, because
   * `grantedTo` identifies a surface (an MCP session, a `webContents.id`) and
   * is stable across many confirmations. Keying replay detection on the
   * surface would reject a second genuinely-approved install from the same
   * session against an unchanged lock -- a legitimate operation, e.g.
   * retrying after a network failure -- while keying it on the decision
   * rejects exactly what must be rejected: reusing one confirmation twice.
   *
   * Adapters set this from the authority's own decision identity, never from a
   * value they synthesize: the MCP authority's per-confirmation id, or Main's
   * per-dialog UUID. A derived value (a hash of the subject and a timestamp,
   * say) would be equal for two decisions that happened to bind the same
   * subject in the same millisecond, silently collapsing them into one.
   */
  decisionId: string;
}

export const RESEARCH_ENV_SERVICE_ERROR_CODES = {
  APPROVAL_REQUIRED: 'RESEARCH_ENV_APPROVAL_REQUIRED',
  APPROVAL_OPERATION_MISMATCH: 'RESEARCH_ENV_APPROVAL_OPERATION_MISMATCH',
  APPROVAL_PROFILE_MISMATCH: 'RESEARCH_ENV_APPROVAL_PROFILE_MISMATCH',
  APPROVAL_STALE_HASHES: 'RESEARCH_ENV_APPROVAL_STALE_HASHES',
  APPROVAL_ALREADY_CONSUMED: 'RESEARCH_ENV_APPROVAL_ALREADY_CONSUMED',
  UNSUPPORTED_PLATFORM: 'RESEARCH_ENV_UNSUPPORTED_PLATFORM',
  WORKLOAD_ACTIVE: 'RESEARCH_ENV_WORKLOAD_ACTIVE',
  WORKLOAD_STATE_UNKNOWN: 'RESEARCH_ENV_WORKLOAD_STATE_UNKNOWN',
} as const;

export type ResearchEnvironmentServiceErrorCode =
  (typeof RESEARCH_ENV_SERVICE_ERROR_CODES)[keyof typeof RESEARCH_ENV_SERVICE_ERROR_CODES];

export class ResearchEnvironmentServiceError extends Error {
  constructor(
    readonly code: ResearchEnvironmentServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ResearchEnvironmentServiceError';
  }
}

// -----------------------------------------------------------------------------
// Dependencies
// -----------------------------------------------------------------------------

export interface ResearchEnvironmentServiceDeps {
  repositoryRoot: string;
  host: EnvironmentHost;
  runner: ProcessRunner;
  jobs: ResearchEnvironmentJobRepository;
  now?: () => Date;
  /**
   * Heartbeat factory. Injected so a test can drive the scheduler without real
   * timers; the service owns starting and stopping it around each operation.
   */
  createHeartbeat?: (jobId: string) => { start(jobId: string): void; stop(): void };
  /** Structured diagnostics sink. Never the only destination for a failure. */
  log?: (message: string, detail?: Record<string, unknown>) => void;
  workloadActivity?: () => { state: 'idle' | 'active' | 'unknown'; detail?: string };
  onWorkloadUpdate?: (update: ResearchEnvironmentWorkloadUpdate) => void;
}

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

export class ResearchEnvironmentService {
  private readonly repositoryRoot: string;
  private readonly host: EnvironmentHost;
  private readonly runner: ProcessRunner;
  private readonly jobs: ResearchEnvironmentJobRepository;
  private readonly now: () => Date;
  private readonly log: (message: string, detail?: Record<string, unknown>) => void;
  private readonly createHeartbeat: (jobId: string) => { start(jobId: string): void; stop(): void };
  private readonly workloadActivity: () => { state: 'idle' | 'active' | 'unknown'; detail?: string };
  private readonly onWorkloadUpdate: (update: ResearchEnvironmentWorkloadUpdate) => void;
  /** Approvals already spent, so a single grant cannot start two operations. */
  private readonly consumedApprovals = new Set<string>();
  /**
   * Jobs whose claim was reclaimed while we were still operating.
   *
   * Checked before every job mutation. Writing to a job another instance may now
   * own would let two processes report progress for one profile, and the L3
   * repository would reject the write as a non-owner anyway -- catching it here
   * turns that into an explicit, reportable abandonment instead of an opaque
   * ownership error mid-operation.
   */
  private readonly lostClaims = new Set<string>();

  constructor(deps: ResearchEnvironmentServiceDeps) {
    this.repositoryRoot = deps.repositoryRoot;
    this.host = deps.host;
    this.runner = deps.runner;
    this.jobs = deps.jobs;
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => {});
    this.workloadActivity = deps.workloadActivity ?? (() => ({ state: 'unknown' }));
    this.onWorkloadUpdate = deps.onWorkloadUpdate ?? (() => {});
    this.createHeartbeat = deps.createHeartbeat ?? (() => (
      // `onClaimLost` is not optional behaviour. If reconciliation reclaims this
      // job while our child process is still running, continuing to write to
      // `.pixi` is exactly the concurrent-materialization hazard the whole
      // lifecycle exists to prevent, so the lost claim is recorded and the
      // operation stops advancing a job it no longer owns.
      new ResearchEnvironmentHeartbeat(this.jobs, {
        setInterval: (callback, ms) => setInterval(callback, ms),
        clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
        onClaimLost: (lostJobId: string) => {
          this.lostClaims.add(lostJobId);
          this.log('research-environment claim lost while operating', { jobId: lostJobId });
        },
      })
    ));
  }

  private activeProjection(
    profile: ResearchEnvironmentProfile,
  ): ResearchEnvironmentProjection {
    const published = this.jobs.findPublishedProjection(profile);
    if (published) return published.projection;
    const latest = this.jobs.findLatestSucceeded(profile);
    return latest?.result
      ? latest.result.projection
      : DEFAULT_RESEARCH_ENVIRONMENT_PROJECTION;
  }

  private targetProjection(
    operation: ResearchEnvironmentOperation,
    active: ResearchEnvironmentProjection,
  ): ResearchEnvironmentProjection {
    if (operation === 'remove_capability') return 'without-gpquant';
    if (operation === 'restore_capability' || operation === 'install') return 'default';
    return active;
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  /**
   * Synthesize the canonical status.
   *
   * Order of precedence is deliberate. An unsupported platform is decided before
   * anything is read from disk, because on an unsupported host the lock cannot
   * materialize and probing would produce misleading per-package errors -- D7
   * requires the verdict be environment-level with every capability `absent`.
   *
   * An active job outranks a disk probe: while an install runs, the environment
   * is `installing`, not `absent`, and the reported state must name the running
   * operation so a reload cannot relabel a repair as an install (AC6a).
   *
   * Only then is the on-disk environment probed. Crucially, an existing `.pixi`
   * is never reported `ready` on the strength of its existence: readiness
   * requires the last successful verification to have been performed against the
   * *currently committed* lock hash. The 7.9 GB environment already on the
   * development host was materialized outside this service, so trusting its
   * presence would certify an environment nobody audited; requiring hash
   * equality is what converts "an environment exists" into "this is the
   * environment the repository approved", and makes divergence a `lock_drift`
   * failure rather than a silent pass.
   */
  async getStatus(
    profile: ResearchEnvironmentProfile = DEFAULT_RESEARCH_ENVIRONMENT_PROFILE,
  ): Promise<ResearchEnvironmentStatus> {
    const platform = this.host.platform;
    const architecture = this.host.architecture;
    const projection = this.activeProjection(profile);
    const paths = resolveProjectionEnvironmentPaths(
      { repositoryRoot: this.repositoryRoot, host: this.host }, projection,
    );

    // The expected-version read is itself a failure surface: a missing or
    // capability-incomplete lock must be reported, not thrown past the caller.
    let expectedVersions: Record<ResearchCapability, string>;
    try {
      expectedVersions = readLockedVersions({ repositoryRoot: this.repositoryRoot, host: this.host });
    } catch (error) {
      return this.statusFromLockReadFailure(error, profile, platform, architecture, undefined, projection);
    }

    if (!isSupportedPlatform(platform, architecture)) {
      return parseResearchEnvironmentStatus({
        profile,
        projection,
        state: 'failed',
        supportedPlatform: false,
        platform,
        architecture,
        capabilities: uniformCapabilities(expectedVersions, 'absent'),
        failure: {
          category: 'unsupported_platform',
          stage: 'admission',
          cause: 'unsupported',
          message: `The locked research environment supports linux-64 only; this host is `
            + `${platform}-${architecture}.`,
          remediation: 'Run research workloads on a supported linux-64 host. The committed '
            + 'pixi.lock is solved for linux-64 and cannot materialize on this platform.',
        },
      } satisfies ResearchEnvironmentStatusInput);
    }

    const active = this.jobs.findActive(profile);
    if (active) {
      return this.statusForActiveJob(active, expectedVersions, platform, architecture);
    }

    return this.statusFromDisk(profile, expectedVersions, platform, architecture, paths.interpreterPath);
  }

  /**
   * Status while an operation is in flight.
   *
   * The in-flight state is derived from the job's own operation, never chosen
   * independently, so the contract's operation/state pairing invariant holds by
   * construction rather than by agreement between two call sites.
   */
  private statusForActiveJob(
    job: PersistedResearchEnvironmentJob,
    expectedVersions: Record<ResearchCapability, string>,
    platform: string,
    architecture: string,
  ): ResearchEnvironmentStatus {
    const inFlightState = {
      install: 'installing',
      repair: 'repairing',
      verify: 'verifying',
      uninstall: 'uninstalling',
      remove_capability: 'installing',
      restore_capability: 'installing',
    } as const;

    return parseResearchEnvironmentStatus({
      profile: job.profile,
      projection: this.targetProjection(job.operation, this.activeProjection(job.profile)),
      state: inFlightState[job.operation],
      supportedPlatform: true,
      platform,
      architecture,
      activeJobId: job.jobId,
      activeOperation: job.operation,
      manifestSha256: job.manifestSha256,
      lockSha256: job.lockSha256,
      capabilities: uniformCapabilities(
        expectedVersions,
        job.operation === 'verify' ? 'verifying' : 'installing',
        'Operation in progress.',
      ),
    } satisfies ResearchEnvironmentStatusInput);
  }

  /**
   * Status derived from the last durable verification plus the current identity.
   *
   * `findLatestTerminal` is the source of readiness, not the filesystem. A
   * successful job persisted the full verified status (L3 `markSucceeded`), so a
   * reconnecting surface renders the same evidence without re-probing the
   * interpreter on every poll.
   */
  private statusFromDisk(
    profile: ResearchEnvironmentProfile,
    expectedVersions: Record<ResearchCapability, string>,
    platform: string,
    architecture: string,
    interpreterPath: string,
  ): ResearchEnvironmentStatus {
    const base = {
      profile,
      projection: this.activeProjection(profile),
      supportedPlatform: true,
      platform,
      architecture,
    };

    let identity: { manifestSha256: string; lockSha256: string };
    try {
      identity = readEnvironmentIdentity({ repositoryRoot: this.repositoryRoot, host: this.host });
    } catch (error) {
      return this.statusFromLockReadFailure(error, profile, platform, architecture, expectedVersions);
    }

    const terminal = this.jobs.findLatestTerminal(profile);
    const interpreterPresent = this.host.isExecutable(interpreterPath);

    if (terminal?.state === 'succeeded' && terminal.result) {
      // Verified once -- but against which lock? If the committed lock has moved
      // since, the recorded versions describe a different dependency set, so the
      // environment is stale rather than ready. Reporting ready here is the
      // silent-pass failure this check exists to prevent.
      const sameLock = terminal.result.lockSha256 === identity.lockSha256
        && terminal.result.manifestSha256 === identity.manifestSha256;

      if (sameLock && interpreterPresent) {
        return parseResearchEnvironmentStatus(terminal.result);
      }

      if (!interpreterPresent) {
        return parseResearchEnvironmentStatus({
          ...base,
          state: 'failed',
          manifestSha256: identity.manifestSha256,
          lockSha256: identity.lockSha256,
          capabilities: uniformCapabilities(expectedVersions, 'absent'),
          failure: {
            category: 'operation_interrupted',
            stage: 'install',
            cause: 'process_lost',
            message: 'The environment was verified previously, but its interpreter is no longer '
              + `present at ${interpreterPath}. The environment directory may have been removed `
              + 'or partially deleted.',
            remediation: 'Run Install Environment to materialize the locked environment again.',
          },
        } satisfies ResearchEnvironmentStatusInput);
      }

      return parseResearchEnvironmentStatus({
        ...base,
        state: 'failed',
        manifestSha256: identity.manifestSha256,
        lockSha256: identity.lockSha256,
        interpreterPath,
        capabilities: uniformCapabilities(
          expectedVersions,
          'absent',
          'Last verified against a different committed lock.',
        ),
        failure: {
          category: 'lock_drift',
          stage: 'admission',
          cause: 'manifest_drift',
          message: 'The environment was last verified against a different manifest and lock than '
            + 'the ones currently committed, so its recorded package versions no longer describe '
            + 'the approved dependency set.',
          remediation: 'Run Repair Environment to revalidate the environment against the '
            + 'currently committed pixi.lock.',
        },
      } satisfies ResearchEnvironmentStatusInput);
    }

    if (terminal?.state === 'failed' && terminal.failure) {
      const published = this.jobs.findPublishedProjection(profile);
      if (published
        && published.status.manifestSha256 === identity.manifestSha256
        && published.status.lockSha256 === identity.lockSha256
        && published.status.interpreterPath
        && this.host.isExecutable(published.status.interpreterPath)) {
        return parseResearchEnvironmentStatus(published.status);
      }
      const previous = this.jobs.findLatestSucceeded(profile);
      if (previous?.result
        && previous.result.manifestSha256 === identity.manifestSha256
        && previous.result.lockSha256 === identity.lockSha256
        && previous.result.interpreterPath
        && this.host.isExecutable(previous.result.interpreterPath)) {
        return parseResearchEnvironmentStatus(previous.result);
      }
      return parseResearchEnvironmentStatus({
        ...base,
        state: 'failed',
        manifestSha256: identity.manifestSha256,
        lockSha256: identity.lockSha256,
        ...(interpreterPresent ? { interpreterPath } : {}),
        capabilities: terminal.result?.capabilities
          ?? uniformCapabilities(expectedVersions, 'absent'),
        failure: terminal.failure,
      } satisfies ResearchEnvironmentStatusInput);
    }

    // Never verified by this service. An interpreter may nonetheless exist --
    // materialized by `start.sh` or a developer's own `pixi install`. It is
    // reported `absent` rather than `ready` because no verification evidence
    // exists for it, and the contract has no state meaning "present but
    // unattested". Verify Again is the action that resolves it, and it needs no
    // confirmation because it mutates nothing.
    return parseResearchEnvironmentStatus({
      ...base,
      state: 'absent',
      manifestSha256: identity.manifestSha256,
      lockSha256: identity.lockSha256,
      ...(interpreterPresent ? { interpreterPath } : {}),
      capabilities: uniformCapabilities(
        expectedVersions,
        'absent',
        interpreterPresent
          ? 'An environment is present but has not been verified by this application.'
          : undefined,
      ),
    } satisfies ResearchEnvironmentStatusInput);
  }

  /** Lock/manifest read failures, mapped to their distinct contract categories. */
  private statusFromLockReadFailure(
    error: unknown,
    profile: ResearchEnvironmentProfile,
    platform: string,
    architecture: string,
    expectedVersions?: Record<ResearchCapability, string>,
    projection: ResearchEnvironmentProjection = DEFAULT_RESEARCH_ENVIRONMENT_PROJECTION,
  ): ResearchEnvironmentStatus {
    // Without a readable lock there are no expected versions, so each capability
    // reports a placeholder that is still a valid non-empty contract string. The
    // failure carries the real explanation; the cards exist so every capability
    // remains renderable (AC3).
    const capabilities = expectedVersions
      ? uniformCapabilities(expectedVersions, 'absent')
      : uniformCapabilities(
        Object.fromEntries(
          RESEARCH_CAPABILITIES.map(capability => [capability, 'unknown']),
        ) as Record<ResearchCapability, string>,
        'absent',
      );

    const failure = this.pathErrorToFailure(error);
    this.log('research-environment status could not read canonical files', {
      code: failure.category,
    });

    return parseResearchEnvironmentStatus({
      profile,
      projection,
      state: 'failed',
      supportedPlatform: isSupportedPlatform(platform, architecture),
      platform,
      architecture,
      capabilities,
      failure,
    } satisfies ResearchEnvironmentStatusInput);
  }

  private pathErrorToFailure(error: unknown): ResearchEnvironmentFailure {
    if (error instanceof ResearchEnvironmentPathError) {
      switch (error.code) {
        case RESEARCH_ENV_PATH_ERROR_CODES.LOCK_MISSING:
          return {
            category: 'lock_missing',
            stage: 'admission',
            cause: 'missing_lock',
            message: error.message,
            remediation: 'Restore pixi.lock from version control. The environment must never be '
              + 'solved at runtime, so a missing lock cannot be regenerated by the application.',
          };
        case RESEARCH_ENV_PATH_ERROR_CODES.MANIFEST_MISSING:
          return {
            category: 'lock_missing',
            stage: 'admission',
            cause: 'missing_lock',
            message: error.message,
            remediation: 'Restore pixi.toml from version control.',
          };
        case RESEARCH_ENV_PATH_ERROR_CODES.PIXI_MISSING:
          return {
            category: 'pixi_missing',
            stage: 'admission',
            cause: 'missing_executable',
            message: error.message,
            remediation: 'Install pixi from https://pixi.sh, then restart the application so it '
              + 'inherits the updated PATH.',
          };
        case RESEARCH_ENV_PATH_ERROR_CODES.LOCK_CAPABILITY_MISSING:
          return {
            category: 'lock_drift',
            stage: 'admission',
            cause: 'manifest_drift',
            message: error.message,
            remediation: 'Re-solve and commit pixi.lock through the normal dependency-review '
              + 'workflow so it resolves every required capability.',
          };
        case RESEARCH_ENV_PATH_ERROR_CODES.TARGET_PATH_ESCAPE:
          return {
            category: 'uninstall_failed',
            stage: 'uninstall',
            cause: 'postcondition',
            message: error.message,
            remediation: 'Restore the registered projection beneath the workspace .pixi/envs directory so it resolves to the repository-owned environment, then retry.',
          };
        default:
          break;
      }
    }

    return {
      category: 'lifecycle_coordination_failed',
      stage: 'admission',
      cause: 'lock_io',
      message: error instanceof Error ? error.message : String(error),
      remediation: 'Check that the repository files are readable, then retry.',
    };
  }

  // ---------------------------------------------------------------------------
  // Job read
  // ---------------------------------------------------------------------------

  /**
   * Read a durable job by ID, for reconnect after navigation or reload (AC6).
   *
   * Ownership-blind by design: the requesting process is often not the one
   * running the job.
   */
  async getJob(jobId: string): Promise<ResearchEnvironmentJob | undefined> {
    const persisted = this.jobs.findById(jobId);
    if (!persisted) {
      return undefined;
    }
    return this.toContractJob(persisted);
  }

  private async toContractJob(
    persisted: PersistedResearchEnvironmentJob,
  ): Promise<ResearchEnvironmentJob> {
    // A terminal job renders its persisted status; a live one renders current
    // status so the surface sees the operation in flight.
    const status = persisted.result ?? await this.getStatus(persisted.profile);
    const transitionOperation = persisted.operation === 'remove_capability'
      || persisted.operation === 'restore_capability';
    const published = transitionOperation
      ? this.jobs.findPublishedProjection(persisted.profile)
      : undefined;
    const publishedByThisJob = published?.publishedByJobId === persisted.jobId;
    const transition = transitionOperation
      && (persisted.state === 'succeeded' || persisted.state === 'failed')
      ? publishedByThisJob && published?.pendingCleanupProjection
        ? {
            outcome: 'post_publication_cleanup_pending' as const,
            activeProjection: published.projection,
            pendingCleanupProjection: published.pendingCleanupProjection,
            recoveryOperation: 'retry_approved_lifecycle_mutation' as const,
          }
        : persisted.state === 'succeeded'
          ? {
              outcome: 'completed' as const,
              activeProjection: status.projection,
            }
          : {
              outcome: 'pre_publication_failure' as const,
              activeProjection: published?.projection ?? this.activeProjection(persisted.profile),
            }
      : undefined;
    return {
      jobId: persisted.jobId,
      profile: persisted.profile,
      operation: persisted.operation,
      state: persisted.state,
      ...(persisted.startedAt ? { startedAt: persisted.startedAt } : {}),
      ...(persisted.finishedAt ? { finishedAt: persisted.finishedAt } : {}),
      ...(persisted.currentStage ? { currentStage: persisted.currentStage } : {}),
      ...(persisted.logTail ? { logTail: persisted.logTail } : {}),
      status: persisted.failure
        ? { ...status, state: 'failed', failure: persisted.failure }
        : status,
      ...(transition ? { transition } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * Install the locked environment. Requires a verified human approval.
   *
   * Returns the job ID after admission; the operation continues in the
   * background. D4 forbids occupying one MCP HTTP request for the duration, and
   * TICKET_855 forbids making it pass by raising a timeout.
   */
  async install(approval: LocalMutationApproval): Promise<string> {
    if (!approval) return this.startMutation('install', approval);
    const operation = this.activeProjection(approval?.profile ?? DEFAULT_RESEARCH_ENVIRONMENT_PROFILE) === 'default'
      ? 'install' : 'restore_capability';
    if (operation === 'restore_capability') {
      const activity = this.workloadActivity();
      if (activity.state !== 'idle') {
        throw new ResearchEnvironmentServiceError(
          activity.state === 'active'
            ? RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_ACTIVE
            : RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_STATE_UNKNOWN,
          'GPQuant restoration requires authoritatively idle research workload state.',
        );
      }
    }
    return this.startMutation(operation, { ...approval, operation, targetProjection: 'default' });
  }

  /**
   * Repair: revalidating reinstall from the same committed lock.
   *
   * A distinct operation, not install relabelled. It adds `--revalidate` so
   * existing artifacts are re-checked rather than assumed intact, and it changes
   * neither `pixi.toml` nor `pixi.lock`.
   */
  async repair(approval: LocalMutationApproval): Promise<string> {
    return this.startMutation('repair', approval);
  }

  async uninstall(approval: LocalMutationApproval): Promise<string> {
    const activity = this.workloadActivity();
    if (activity.state !== 'idle') {
      throw new ResearchEnvironmentServiceError(
        activity.state === 'active'
          ? RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_ACTIVE
          : RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_STATE_UNKNOWN,
        activity.state === 'active'
          ? `The research environment is in use${activity.detail ? ` by ${activity.detail}` : ''}. Wait for all research workloads to finish, then retry.`
          : `Research workload activity could not be determined${activity.detail ? `: ${activity.detail}` : ''}. Uninstall fails closed; retry when activity can be verified.`,
      );
    }
    return this.startMutation('uninstall', approval);
  }

  async removeCapability(
    capability: RemovableResearchCapability,
    approval: LocalMutationApproval,
  ): Promise<string> {
    if (capability !== 'gpquant') {
      throw new ResearchEnvironmentServiceError(
        RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_PROFILE_MISMATCH,
        `Unknown removable research capability: ${capability}.`,
      );
    }
    const activity = this.workloadActivity();
    if (activity.state !== 'idle') {
      throw new ResearchEnvironmentServiceError(
        activity.state === 'active'
          ? RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_ACTIVE
          : RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_STATE_UNKNOWN,
        activity.state === 'active'
          ? `GPQuant cannot be removed while research workloads are active${activity.detail ? `: ${activity.detail}` : ''}.`
          : `GPQuant removal requires authoritative idle workload state${activity.detail ? `: ${activity.detail}` : ''}.`,
      );
    }
    if (this.activeProjection(approval.profile) === 'without-gpquant') {
      return this.startMutation('remove_capability', approval);
    }
    return this.startMutation('remove_capability', approval);
  }

  /**
   * Verify: run the canonical readiness verifier. No approval required, because
   * it installs, repairs, solves, and changes nothing.
   *
   * Still a durable job rather than a synchronous call: the verifier initializes
   * the PySR Julia backend, which is multi-second to multi-minute even on a
   * ready environment. A blocking IPC request would freeze the renderer for its
   * duration and be unfixable without raising a timeout.
   */
  async verify(
    profile: ResearchEnvironmentProfile = DEFAULT_RESEARCH_ENVIRONMENT_PROFILE,
  ): Promise<string> {
    const identity = this.requireIdentityForMutation();
    const job = this.admit('verify', identity, profile);
    void this.runOperation(job, 'verify');
    return job.jobId;
  }

  private async startMutation(
    operation: Exclude<ResearchEnvironmentOperation, 'verify'>,
    approval: LocalMutationApproval,
  ): Promise<string> {
    const identity = this.requireIdentityForMutation();
    this.consumeApproval(operation, approval, identity);
    const job = this.admit(operation, identity, approval.profile);
    void this.runOperation(job, operation);
    return job.jobId;
  }

  /**
   * The canonical manifest/lock identity, read fresh from disk.
   *
   * Public so an authority adapter can fill the approval it constructs from the
   * *service's own* read rather than performing its own. That is deliberate:
   * D4 forbids an adapter prevalidating hashes and assuming the service will
   * see the same files, so the adapter must not read them independently. Since
   * `startMutation` re-reads and compares immediately afterwards, a manifest
   * edited between the human's decision and admission still invalidates the
   * approval -- exposing this read weakens nothing.
   */
  readIdentity(
    operation: Exclude<ResearchEnvironmentOperation, 'verify'> = 'install',
  ): { manifestSha256: string; lockSha256: string; environmentRoot: string; targetProjection: ResearchEnvironmentProjection } {
    const targetProjection = this.targetProjection(
      operation,
      this.activeProjection(DEFAULT_RESEARCH_ENVIRONMENT_PROFILE),
    );
    return {
      ...this.requireIdentityForMutation(),
      environmentRoot: resolveProjectionEnvironmentPaths({
        repositoryRoot: this.repositoryRoot,
        host: this.host,
      }, targetProjection).environmentRoot,
      targetProjection,
    };
  }

  private requireIdentityForMutation(): { manifestSha256: string; lockSha256: string } {
    if (!isSupportedPlatform(this.host.platform, this.host.architecture)) {
      throw new ResearchEnvironmentServiceError(
        RESEARCH_ENV_SERVICE_ERROR_CODES.UNSUPPORTED_PLATFORM,
        `The locked research environment supports linux-64 only; this host is `
        + `${this.host.platform}-${this.host.architecture}.`,
      );
    }
    // Recomputed here, at admission, from the canonical paths. Throws
    // LOCK_MISSING / MANIFEST_MISSING, which the adapter surfaces.
    return readEnvironmentIdentity({ repositoryRoot: this.repositoryRoot, host: this.host });
  }

  /**
   * Validate and spend the approval.
   *
   * Hash comparison against freshly-read files is what makes the approval
   * time-bound: a manifest edited while the confirmation dialog was open yields
   * different hashes and the approval is rejected before any job or child
   * process exists. Single-use is enforced by recording the grant, so one
   * dialog cannot authorize two installs.
   */
  private consumeApproval(
    operation: Exclude<ResearchEnvironmentOperation, 'verify'>,
    approval: LocalMutationApproval | undefined,
    identity: { manifestSha256: string; lockSha256: string },
  ): void {
    if (!approval) {
      throw new ResearchEnvironmentServiceError(
        RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_REQUIRED,
        `${operation} requires a verified local mutation approval.`,
      );
    }
    if (approval.operation !== operation) {
      throw new ResearchEnvironmentServiceError(
        RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_OPERATION_MISMATCH,
        `The approval authorizes ${approval.operation}, not ${operation}.`,
      );
    }
    const expectedProjection = this.targetProjection(operation, this.activeProjection(approval.profile));
    if (approval.targetProjection && approval.targetProjection !== expectedProjection) {
      throw new ResearchEnvironmentServiceError(
        RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_PROFILE_MISMATCH,
        `The approval names projection ${approval.targetProjection}, not ${expectedProjection}.`,
      );
    }
    if (approval.profile !== DEFAULT_RESEARCH_ENVIRONMENT_PROFILE) {
      throw new ResearchEnvironmentServiceError(
        RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_PROFILE_MISMATCH,
        `The approval names an unknown profile: ${approval.profile}.`,
      );
    }
    const expectedEnvironmentRoot = resolveProjectionEnvironmentPaths({
      repositoryRoot: this.repositoryRoot,
      host: this.host,
    }, expectedProjection).environmentRoot;
    if (approval.environmentRoot !== expectedEnvironmentRoot) {
      throw new ResearchEnvironmentServiceError(
        RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_PROFILE_MISMATCH,
        `The approval names a different environment scope: ${approval.environmentRoot}.`,
      );
    }
    if (approval.manifestSha256 !== identity.manifestSha256
      || approval.lockSha256 !== identity.lockSha256) {
      throw new ResearchEnvironmentServiceError(
        RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_STALE_HASHES,
        'The manifest or lock changed after the confirmation was shown, so the approval no '
        + 'longer describes the environment that would be materialized. Retry the operation.',
      );
    }

    const key = `${approval.operation}:${approval.grantedTo}:${approval.decisionId}`;
    if (this.consumedApprovals.has(key)) {
      throw new ResearchEnvironmentServiceError(
        RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_ALREADY_CONSUMED,
        'This approval was already used. Confirm the operation again.',
      );
    }
    this.consumedApprovals.add(key);
  }

  /**
   * Claim the profile through L3.
   *
   * `ACTIVE_JOB_EXISTS` is authoritative and propagates: the caller must spawn
   * nothing. AC6 requires two concurrent installs to produce *one* job.
   */
  private admit(
    operation: ResearchEnvironmentOperation,
    identity: { manifestSha256: string; lockSha256: string },
    profile: ResearchEnvironmentProfile,
  ): PersistedResearchEnvironmentJob {
    return this.jobs.admit({
      operation,
      manifestSha256: identity.manifestSha256,
      lockSha256: identity.lockSha256,
      profile,
    });
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /**
   * Run an admitted operation to a terminal job state.
   *
   * Never throws to its caller: the job row is the contract, so every failure
   * path ends in `markFailed` with a structured category. An exception escaping
   * here would leave a `running` row with no owner heartbeat, which the
   * reconciler would eventually reclaim as an interrupted operation -- correct
   * but far slower and less specific than reporting the real cause now
   * (TICKET_858: a failure that never reaches the surface is a silent failure).
   */
  private async runOperation(
    job: PersistedResearchEnvironmentJob,
    operation: ResearchEnvironmentOperation,
  ): Promise<void> {
    const heartbeat = this.createHeartbeat(job.jobId);
    heartbeat.start(job.jobId);

    let workloadPid: number | null = null;
    let workloadSummary = 'Preparing environment';
    let workloadFraction: number | null = null;
    const publishWorkload = (state: ResearchEnvironmentWorkloadUpdate['state'], error?: string): void => {
      this.onWorkloadUpdate({
        jobId: job.jobId,
        state,
        summary: error ?? workloadSummary,
        fraction: workloadFraction,
        pid: workloadPid,
        ...(error ? { error } : {}),
        updatedAt: this.now().toISOString(),
      });
    };
    const capturePid = (pid: number): void => {
      workloadPid = pid;
      publishWorkload('running');
    };
    publishWorkload('admitted');

    const logLines: string[] = [];
    const captureLine = (line: string): void => {
      logLines.push(line);
      if (logLines.length > RESEARCH_ENV_PERSISTED_LOG_LINES) {
        logLines.splice(0, logLines.length - RESEARCH_ENV_PERSISTED_LOG_LINES);
      }
      const progress = parseProbeProgressLine(line) ?? parsePixiProgressLine(line);
      if (progress) {
        workloadSummary = progress.summary;
        workloadFraction = progress.fraction;
        publishWorkload('running');
      }
    };

    try {
      const projection = this.targetProjection(operation, this.activeProjection(job.profile));
      const paths = resolveProjectionEnvironmentPaths(
        { repositoryRoot: this.repositoryRoot, host: this.host }, projection,
      );

      if (operation !== 'verify') {
        const identityBefore = operation === 'uninstall'
          ? readEnvironmentIdentity({ repositoryRoot: this.repositoryRoot, host: this.host })
          : undefined;
        if (operation === 'uninstall') {
          validateEnvironmentRemovalTarget(this.host, paths, 'default');
        }
        const pixiExecutable = resolvePixiExecutable(this.host);
        this.jobs.markRunning(
          job.jobId,
          operation === 'remove_capability' || operation === 'restore_capability'
            ? 'transition'
            : operation,
        );

        const published = this.jobs.findPublishedProjection(job.profile);
        if (published?.pendingCleanupProjection) {
          const pendingPaths = resolveProjectionEnvironmentPaths(
            { repositoryRoot: this.repositoryRoot, host: this.host },
            published.pendingCleanupProjection,
          );
          if (this.host.fileExists(pendingPaths.environmentRoot)) {
            validateEnvironmentRemovalTarget(
              this.host,
              pendingPaths,
              published.pendingCleanupProjection,
            );
            const recoveredCleanup = await runPixiUninstall({
              runner: this.runner,
              pixiExecutable,
              manifestPath: pendingPaths.manifestPath,
              repositoryRoot: this.repositoryRoot,
              environment: published.pendingCleanupProjection,
              onOutputLine: captureLine,
              onSpawn: capturePid,
            });
            if (!this.succeeded(recoveredCleanup)) {
              this.jobs.markFailed(job.jobId, this.materializationFailure(recoveredCleanup, operation));
              return;
            }
          }
          this.jobs.clearPendingCleanup(job.jobId);
        }

        const result = operation === 'install' || operation === 'remove_capability'
          || operation === 'restore_capability'
          ? await runPixiInstall({
            runner: this.runner,
            pixiExecutable,
            manifestPath: paths.manifestPath,
            repositoryRoot: this.repositoryRoot,
            environment: projection,
            onOutputLine: captureLine,
            onSpawn: capturePid,
          })
          : operation === 'repair' ? await runPixiRepair({
            runner: this.runner,
            pixiExecutable,
            manifestPath: paths.manifestPath,
            repositoryRoot: this.repositoryRoot,
            environment: projection,
            onOutputLine: captureLine,
            onSpawn: capturePid,
          }) : await runPixiUninstall({
            runner: this.runner,
            pixiExecutable,
            manifestPath: paths.manifestPath,
            repositoryRoot: this.repositoryRoot,
            environment: projection,
            onOutputLine: captureLine,
            onSpawn: capturePid,
          });

        this.persistLogTail(job.jobId, logLines);

        // Checked after the long-running child returns, which is the only point
        // where reconciliation could plausibly have reclaimed the job: the
        // materialization is the multi-minute window during which a starved
        // heartbeat could exceed the staleness threshold. Abandoning here is
        // deliberate -- writing a result for a job another instance may now own
        // would produce two processes reporting progress for one profile.
        if (this.hasLostClaim(job.jobId)) {
          return;
        }

        if (!this.succeeded(result)) {
          this.jobs.markFailed(job.jobId, this.materializationFailure(result, operation));
          return;
        }
        if (operation === 'uninstall') {
          if (this.host.fileExists(paths.environmentRoot) || this.host.isExecutable(paths.interpreterPath)) {
            this.jobs.markFailed(job.jobId, {
              category: 'uninstall_failed', stage: 'uninstall', cause: 'postcondition',
              message: 'Pixi returned success but the research environment is still present.',
              remediation: 'Retry Uninstall Environment after confirming no research workload is active.',
            });
            return;
          }
          const identity = readEnvironmentIdentity({ repositoryRoot: this.repositoryRoot, host: this.host });
          if (identity.manifestSha256 !== identityBefore?.manifestSha256
            || identity.lockSha256 !== identityBefore.lockSha256) {
            this.jobs.markFailed(job.jobId, {
              category: 'uninstall_failed', stage: 'uninstall', cause: 'postcondition',
              message: 'Research environment uninstall changed pixi.toml or pixi.lock.',
              remediation: 'Restore the committed manifest and lockfile from version control before retrying.',
            });
            return;
          }
          this.jobs.markSucceeded(job.jobId, parseResearchEnvironmentStatus({
            profile: job.profile,
            projection,
            state: 'absent',
            supportedPlatform: true,
            platform: this.host.platform,
            architecture: this.host.architecture,
            manifestSha256: identity.manifestSha256,
            lockSha256: identity.lockSha256,
            capabilities: uniformCapabilities(
              readLockedVersions({ repositoryRoot: this.repositoryRoot, host: this.host }),
              'absent',
            ),
          } satisfies ResearchEnvironmentStatusInput));
          return;
        }
      } else {
        this.jobs.markRunning(job.jobId, 'python_verify');
      }

      workloadSummary = `Verifying capabilities (0/${RESEARCH_CAPABILITIES.length})`;
      workloadFraction = 0;
      workloadPid = null;
      publishWorkload('running');

      const verifiedStatus = await this.runVerification(
        job, operation, projection, paths.interpreterPath, captureLine, capturePid, logLines,
      );
      if (!verifiedStatus) return;

      if (operation === 'remove_capability' || operation === 'restore_capability') {
        const previousProjection = operation === 'remove_capability' ? 'default' : 'without-gpquant';
        // This transaction is the switch. Every interpreter resolver observes
        // the verified target from this point onward, while the durable pending
        // cleanup marker makes a crash between publication and cleanup
        // recoverable without falling back to the prefix being removed.
        this.jobs.publishProjection(job.jobId, verifiedStatus, previousProjection);
        const previousPaths = resolveProjectionEnvironmentPaths(
          { repositoryRoot: this.repositoryRoot, host: this.host }, previousProjection,
        );
        if (this.host.fileExists(previousPaths.environmentRoot)) {
          validateEnvironmentRemovalTarget(this.host, previousPaths, previousProjection);
          const cleanup = await runPixiUninstall({
            runner: this.runner,
            pixiExecutable: resolvePixiExecutable(this.host),
            manifestPath: previousPaths.manifestPath,
            repositoryRoot: this.repositoryRoot,
            environment: previousProjection,
            onOutputLine: captureLine,
            onSpawn: capturePid,
          });
          if (!this.succeeded(cleanup)) {
            this.jobs.markFailed(job.jobId, this.materializationFailure(cleanup, operation));
            return;
          }
        }
        this.jobs.completePublishedTransition(job.jobId, verifiedStatus);
        return;
      }
      this.jobs.markSucceeded(job.jobId, verifiedStatus);
    } catch (error) {
      this.persistLogTail(job.jobId, logLines);
      this.failWithUnexpected(job.jobId, operation, error);
    } finally {
      heartbeat.stop();
      this.lostClaims.delete(job.jobId);
      const terminal = this.jobs.findById(job.jobId);
      workloadPid = null;
      if (terminal?.state === 'succeeded') {
        workloadSummary = 'Completed';
        workloadFraction = 1;
        publishWorkload('completed');
      } else if (terminal?.state === 'failed') {
        publishWorkload('failed', terminal.failure?.message ?? 'Research environment operation failed.');
      }
    }
  }

  /**
   * Probe the environment and record the terminal result.
   *
   * The stage advances to `python_verify` before the probe and, on a Julia-layer
   * failure, the failure itself carries `julia_verify` -- so the two PySR layers
   * stay distinguishable (AC8).
   */
  private async runVerification(
    job: PersistedResearchEnvironmentJob,
    operation: ResearchEnvironmentOperation,
    projection: ResearchEnvironmentProjection,
    interpreterPath: string,
    captureLine: (line: string) => void,
    capturePid: (pid: number) => void,
    logLines: string[],
  ): Promise<ResearchEnvironmentStatus | undefined> {
    if (!this.host.isExecutable(interpreterPath)) {
      // Reached when materialization reported success but produced no
      // interpreter. Attributed to the materialization stage, not to a
      // capability, because no capability can be blamed for an absent runtime.
      //
      // The category/stage pair is built as one unit rather than from two
      // independent ternaries: the contract's failure union only admits
      // (install_failed, install) and (repair_failed, repair), and picking each
      // field separately would let a future edit produce the illegal
      // (install_failed, repair) combination that TICKET_1335 AC5 requires be
      // rejected. The type system catches it precisely because the union is
      // spelled per-variant.
      const message = 'The environment reported success but no interpreter exists at '
        + `${interpreterPath}.`;
      const remediation = 'Run Repair Environment to revalidate the environment against the '
        + 'committed lock.';
      this.jobs.markFailed(job.jobId, operation === 'repair'
        ? {
          category: 'repair_failed', stage: 'repair', cause: 'process_exit', message, remediation,
        }
        : {
          category: 'install_failed', stage: 'install', cause: 'process_exit', message, remediation,
        });
      return undefined;
    }

    this.jobs.advanceStage(job.jobId, 'python_verify');

    const result = await runReadinessProbe({
      runner: this.runner,
      interpreterPath,
      repositoryRoot: this.repositoryRoot,
      program: PROBE_PROGRAM,
      onOutputLine: captureLine,
      onSpawn: capturePid,
    });
    this.persistLogTail(job.jobId, logLines);

    // The probe is the second multi-minute window (a cold Julia depot download),
    // so the claim is re-checked here as well as after materialization.
    if (this.hasLostClaim(job.jobId)) {
      return undefined;
    }

    const expectedVersions = readLockedVersions({
      repositoryRoot: this.repositoryRoot,
      host: this.host,
    });
    const identity = readEnvironmentIdentity({
      repositoryRoot: this.repositoryRoot,
      host: this.host,
    });

    let parsed;
    try {
      parsed = parseProbeOutput(result.stdout);
    } catch (error) {
      // The verifier did not report. Distinguish a timeout from a crash, because
      // an interrupted verification is recoverable by retrying while a crash
      // needs the log tail.
      if (result.timedOut) {
        this.jobs.markFailed(job.jobId, {
          category: 'operation_interrupted',
          stage: 'julia_verify',
          cause: 'process_lost',
          message: 'The readiness verifier exceeded its time bound before reporting. The PySR '
            + 'Julia backend downloads and precompiles on first use, which can be slow on a '
            + 'cold depot.',
          remediation: 'Retry verification. If it times out repeatedly, run Repair Environment.',
        });
        return undefined;
      }
      this.jobs.markFailed(job.jobId, {
        category: 'verification_failed',
        stage: 'python_verify',
        cause: 'probe',
        capability: RESEARCH_CAPABILITIES[0],
        message: error instanceof ResearchEnvironmentProbeError
          ? error.message
          : `The readiness verifier produced unusable output: ${(error as Error).message}`,
        remediation: 'Run Repair Environment to revalidate the environment against the committed lock.',
      });
      return undefined;
    }

    const capabilityProjection = projectProbeResults({ parsed, expectedVersions, projection });

    if (capabilityProjection.failure) {
      // The capability record is persisted alongside the failure so each card
      // can show which capability failed and why, not just an overall error.
      this.jobs.appendLogTail(job.jobId, []);
      this.jobs.markFailed(job.jobId, capabilityProjection.failure);
      return undefined;
    }

    const pixiVersion = await this.readPixiVersion();

    return parseResearchEnvironmentStatus({
      profile: job.profile,
      projection,
      state: 'ready',
      supportedPlatform: true,
      platform: this.host.platform,
      architecture: this.host.architecture,
      manifestSha256: identity.manifestSha256,
      lockSha256: identity.lockSha256,
      interpreterPath,
      lastVerifiedAt: this.now().toISOString(),
      ...(pixiVersion ? { pixiVersion } : {}),
      capabilities: capabilityProjection.capabilities,
    } satisfies ResearchEnvironmentStatusInput);
  }

  /**
   * `pixi --version`, best effort.
   *
   * A failure here is not a readiness failure: the version is diagnostic, and
   * gating readiness on it would create a second compatibility authority beside
   * the committed lock.
   */
  private async readPixiVersion(): Promise<string | undefined> {
    try {
      const result = await runPixiVersion({
        runner: this.runner,
        pixiExecutable: resolvePixiExecutable(this.host),
        repositoryRoot: this.repositoryRoot,
      });
      if (!this.succeeded(result)) {
        return undefined;
      }
      // `pixi --version` prints `pixi <semver>`.
      const match = /(\d+\.\d+\.\d+\S*)/.exec(result.stdout.trim());
      return match?.[1];
    } catch {
      return undefined;
    }
  }

  private succeeded(result: ProcessResult): boolean {
    return result.exitCode === 0 && !result.timedOut && !result.spawnError;
  }

  /**
   * Whether reconciliation reclaimed this job while we were operating.
   *
   * Reported rather than silently returned: the reconciler has already marked the
   * row `failed` with `operation_interrupted`, so the surface has an actionable
   * state -- but a log line is what lets an operator tell "reclaimed mid-install"
   * apart from "the process simply stopped" (TICKET_858).
   */
  private hasLostClaim(jobId: string): boolean {
    if (!this.lostClaims.has(jobId)) {
      return false;
    }
    this.log('research-environment operation abandoned after losing its claim', { jobId });
    return true;
  }

  /**
   * Map a failed `pixi install` onto its distinct contract category.
   *
   * Drift is checked before network, and both before the generic exit-code
   * failure, because pixi exits 1 for all three. Without this classification
   * every install failure would arrive as `install_failed` and D6's requirement
   * that each category render a distinct actionable state would be unmeetable.
   */
  private materializationFailure(
    result: ProcessResult,
    operation: ResearchEnvironmentOperation,
  ): ResearchEnvironmentFailure {
    const stage = operation === 'repair' ? 'repair' as const
      : operation === 'uninstall' ? 'uninstall' as const
      : 'install' as const;

    if (result.spawnError) {
      return {
        category: 'pixi_missing',
        stage: 'admission',
        cause: 'missing_executable',
        message: `The pixi executable could not be started: ${result.spawnError}`,
        remediation: 'Install pixi from https://pixi.sh, then restart the application so it '
          + 'inherits the updated PATH.',
      };
    }

    if (result.timedOut) {
      return {
        category: 'operation_interrupted',
        stage,
        cause: 'process_lost',
        message: 'The environment materialization exceeded its time bound and was stopped. The '
          + 'lock and manifest were not modified.',
        remediation: 'Retry the operation. Check available disk space and network throughput; a '
          + 'first-time install downloads several gigabytes.',
      };
    }

    if (operation !== 'uninstall' && looksLikeLockDrift(result)) {
      return {
        category: 'lock_drift',
        stage: 'admission',
        cause: 'manifest_drift',
        message: 'pixi refused to install because pixi.lock is not up to date with pixi.toml. The '
          + 'lock was not modified.',
        remediation: 'A developer must re-solve and commit pixi.lock through the normal '
          + 'dependency-review workflow. The application never solves the environment at runtime.',
      };
    }

    if (operation !== 'uninstall' && looksLikeNetworkFailure(result)) {
      return {
        category: 'network_failed',
        stage: operation === 'repair' ? 'repair' : 'install',
        cause: 'network',
        message: 'Package download failed while materializing the locked environment.',
        remediation: 'Check the network connection and any proxy configuration, then retry.',
      };
    }

    // Built as a paired unit -- see the equivalent note in `runVerification`. The
    // union admits only (install_failed, install) and (repair_failed, repair).
    const message = `pixi exited with code ${result.exitCode ?? 'null'}`
      + `${result.signal ? ` (signal ${result.signal})` : ''}.`;
    const remediation = 'Review the operation log for the failing package, then retry. If it '
      + 'persists, run Repair Environment.';
    return operation === 'repair'
      ? { category: 'repair_failed', stage: 'repair', cause: 'process_exit', message, remediation }
      : operation === 'uninstall'
        ? { category: 'uninstall_failed', stage: 'uninstall', cause: 'process_exit', message, remediation }
        : { category: 'install_failed', stage: 'install', cause: 'process_exit', message, remediation };
  }

  private persistLogTail(jobId: string, lines: readonly string[]): void {
    if (lines.length === 0) {
      return;
    }
    try {
      this.jobs.appendLogTail(jobId, lines);
    } catch (error) {
      // A log-tail write failure must not convert a successful operation into a
      // failed one; the tail is diagnostic. Recorded rather than swallowed.
      this.log('research-environment log tail could not be persisted', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Terminal failure for an unexpected exception.
   *
   * `ACTIVE_JOB_EXISTS` is re-thrown rather than recorded: it means this call
   * never owned a job, so writing a failure would mark *another* process's
   * running operation as failed.
   */
  private failWithUnexpected(
    jobId: string,
    operation: ResearchEnvironmentOperation,
    error: unknown,
  ): void {
    if (error instanceof ResearchEnvironmentJobError
      && error.code === RESEARCH_ENV_JOB_ERROR_CODES.ACTIVE_JOB_EXISTS) {
      throw error;
    }

    const failure = error instanceof ResearchEnvironmentPathError
      ? this.pathErrorToFailure(error)
      : {
        category: 'lifecycle_coordination_failed' as const,
        stage: 'admission' as const,
        cause: 'database' as const,
        message: error instanceof Error ? error.message : String(error),
        remediation: 'Retry the operation. If it persists, restart the application so the '
          + 'environment job store is reopened.',
      };

    this.log('research-environment operation failed', {
      jobId,
      operation,
      category: failure.category,
    });

    try {
      this.jobs.markFailed(jobId, failure);
    } catch (markError) {
      // The job may already be terminal, or owned elsewhere. Nothing further can
      // be recorded against it; surfacing this to the log is the only remaining
      // action, and the reconciler covers an abandoned row.
      this.log('research-environment failure could not be recorded', {
        jobId,
        error: markError instanceof Error ? markError.message : String(markError),
      });
    }
  }
}
