/**
 * TICKET_1335 L3: the durable owner of research-environment job truth.
 *
 * Root cause this module closes (TICKET_1335 D4): a Pixi materialization runs
 * for minutes and can be requested from Electron, the Service API, or the
 * standalone MCP process. Each surface previously kept its own in-memory notion
 * of "an install is running", so two installers could execute concurrently
 * against one `.pixi` directory, and a renderer reload lost the job entirely.
 *
 * Three mechanisms, at three different layers, and none of them is a substitute
 * for the others:
 *
 * 1. The partial unique index `at_most_one_active_job` (migration 140). This is
 *    the invariant's real enforcement: a second admission fails at the database,
 *    across processes, whether or not anyone consulted a lock.
 * 2. The long-held advisory lock in this module. It exists so a *loser* learns it
 *    lost before spawning anything, and so the whole admit-and-claim sequence is
 *    one atomic step. Without it, two callers could each pass their read of
 *    "is a job active" and then both attempt to insert; one would get a
 *    constraint error, but only after doing admission work.
 * 3. Heartbeat-based reconciliation. Constraint (1) forbids a second active job
 *    forever, including after the owner is killed -- so without reconciliation a
 *    crash during install would permanently wedge the environment.
 *
 * `owner_instance_id` is a random per-run value, never a PID. TICKET_1335 D4 is
 * explicit that PID is not ownership proof: PIDs are reused after a crash, so a
 * PID check would let an unrelated process inherit a dead owner's claim and pass
 * a liveness test it should fail. `owner_pid` is written for diagnostics and is
 * never read to authorize anything.
 */

import {
  DEFAULT_RESEARCH_ENVIRONMENT_PROFILE,
  RESEARCH_ENV_MAX_LOG_LINES,
  RESEARCH_ENV_MAX_LOG_LINE_CHARS,
  type ResearchEnvironmentFailure,
  type ResearchEnvironmentJobState,
  type ResearchEnvironmentOperation,
  type ResearchEnvironmentProfile,
  type ResearchEnvironmentProjection,
  type ResearchEnvironmentStage,
  type ResearchEnvironmentStatus,
} from '@StratCraft/types';

import {
  RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS,
  RESEARCH_ENV_PERSISTED_LOG_LINES,
} from './constants';

// -----------------------------------------------------------------------------
// Database surface
// -----------------------------------------------------------------------------

/**
 * The narrow slice of better-sqlite3 this module uses.
 *
 * Declared structurally rather than importing `better-sqlite3` so the package
 * does not bind a native module at runtime: Electron main and the standalone MCP
 * process load different builds of that binary (the ABI mismatch recorded in
 * `project_better_sqlite3_abi_rebuild`), and each passes in its own handle.
 */
export interface ResearchEnvironmentStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface ResearchEnvironmentDb {
  prepare(sql: string): ResearchEnvironmentStatement;
  /**
   * Must open with `BEGIN IMMEDIATE`. A deferred transaction takes its write
   * lock only at the first write, which would let two admissions both complete
   * their reads before either claimed the profile -- the exact race the lock
   * exists to close.
   */
  transactionImmediate<T>(fn: () => T): () => T;
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export const RESEARCH_ENV_JOB_ERROR_CODES = {
  /** Another job holds the profile; the caller must not spawn anything. */
  ACTIVE_JOB_EXISTS: 'RESEARCH_ENV_ACTIVE_JOB_EXISTS',
  /** The caller is not the recorded owner of the job it tried to mutate. */
  NOT_JOB_OWNER: 'RESEARCH_ENV_NOT_JOB_OWNER',
  /** The job does not exist. */
  JOB_NOT_FOUND: 'RESEARCH_ENV_JOB_NOT_FOUND',
  /** The job is already terminal and cannot be advanced. */
  JOB_ALREADY_TERMINAL: 'RESEARCH_ENV_JOB_ALREADY_TERMINAL',
  /** A persisted row could not be decoded into the shared contract. */
  CORRUPT_JOB_ROW: 'RESEARCH_ENV_CORRUPT_JOB_ROW',
} as const;

export type ResearchEnvironmentJobErrorCode =
  (typeof RESEARCH_ENV_JOB_ERROR_CODES)[keyof typeof RESEARCH_ENV_JOB_ERROR_CODES];

/**
 * Carries a machine-readable `code` because TICKET_858 requires the failure to
 * reach the UI as something a surface can branch on. A caller that had to match
 * on message text would be parsing human copy to make a decision, which
 * TICKET_1335 AC5 forbids.
 */
export class ResearchEnvironmentJobError extends Error {
  constructor(
    readonly code: ResearchEnvironmentJobErrorCode,
    message: string,
    /** Set when the code is `ACTIVE_JOB_EXISTS`, so the caller can attach. */
    readonly activeJobId?: string,
  ) {
    super(message);
    this.name = 'ResearchEnvironmentJobError';
  }
}

// -----------------------------------------------------------------------------
// Row shapes
// -----------------------------------------------------------------------------

interface JobRow {
  job_id: string;
  profile: string;
  operation: string;
  state: string;
  current_stage: string | null;
  manifest_sha256: string;
  lock_sha256: string;
  owner_instance_id: string;
  owner_pid: number | null;
  heartbeat_at: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result_json: string | null;
  failure_json: string | null;
  log_tail: string | null;
}

/**
 * A persisted job as this layer knows it.
 *
 * Distinct from the contract's `ResearchEnvironmentJob`: that type carries a
 * fully-derived `status`, which only `ResearchEnvironmentService` (L4) can
 * compute because it owns platform detection and capability probing. This layer
 * owns durable identity, ownership, and lifecycle -- and deliberately does not
 * synthesize a status it cannot truthfully populate.
 */
export interface PersistedResearchEnvironmentJob {
  jobId: string;
  profile: ResearchEnvironmentProfile;
  operation: ResearchEnvironmentOperation;
  state: ResearchEnvironmentJobState;
  currentStage?: ResearchEnvironmentStage;
  manifestSha256: string;
  lockSha256: string;
  ownerInstanceId: string;
  ownerPid?: number;
  heartbeatAt: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Terminal success payload, as produced by L4 and validated on read. */
  result?: ResearchEnvironmentStatus;
  failure?: ResearchEnvironmentFailure;
  logTail?: string[];
}

export interface PublishedResearchEnvironmentProjection {
  projection: ResearchEnvironmentProjection;
  status: ResearchEnvironmentStatus;
  pendingCleanupProjection?: ResearchEnvironmentProjection;
  publishedByJobId: string;
}

const ACTIVE_STATES: readonly ResearchEnvironmentJobState[] = ['queued', 'running'];

function isActive(state: ResearchEnvironmentJobState): boolean {
  return ACTIVE_STATES.includes(state);
}

// -----------------------------------------------------------------------------
// Dependencies
// -----------------------------------------------------------------------------

/**
 * Injected rather than imported so tests can drive time and identity
 * deterministically. `Date.now` is otherwise unobservable, and a reconciliation
 * test that had to sleep past a 90-second threshold could not exist.
 */
export interface ResearchEnvironmentJobRepositoryDeps {
  db: ResearchEnvironmentDb;
  /** Random per-run owner identity. Never a PID (TICKET_1335 D4). */
  instanceId: string;
  /** Diagnostics only; never read to authorize recovery. */
  pid?: number;
  now?: () => Date;
  newJobId?: () => string;
  /**
   * Validates a persisted status payload against the shared contract. Injected
   * so this package does not depend on zod; L4 passes
   * `parseResearchEnvironmentStatus` from `@StratCraft/types`.
   */
  parseStatus: (value: unknown) => ResearchEnvironmentStatus;
  /** Compatibility parser used only for JSON read from durable storage. */
  parsePersistedStatus: (value: unknown) => ResearchEnvironmentStatus;
  parseFailure: (value: unknown) => ResearchEnvironmentFailure;
}

// -----------------------------------------------------------------------------
// Repository
// -----------------------------------------------------------------------------

export class ResearchEnvironmentJobRepository {
  private readonly db: ResearchEnvironmentDb;
  private readonly instanceId: string;
  private readonly pid?: number;
  private readonly now: () => Date;
  private readonly newJobId: () => string;
  private readonly parseStatus: (value: unknown) => ResearchEnvironmentStatus;
  private readonly parsePersistedStatus: (value: unknown) => ResearchEnvironmentStatus;
  private readonly parseFailure: (value: unknown) => ResearchEnvironmentFailure;

  constructor(deps: ResearchEnvironmentJobRepositoryDeps) {
    this.db = deps.db;
    this.instanceId = deps.instanceId;
    this.pid = deps.pid;
    this.now = deps.now ?? (() => new Date());
    this.newJobId = deps.newJobId ?? defaultJobIdFactory;
    this.parseStatus = deps.parseStatus;
    this.parsePersistedStatus = deps.parsePersistedStatus;
    this.parseFailure = deps.parseFailure;
  }

  get ownerInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Atomically reconcile abandoned jobs, then claim the profile.
   *
   * Reconciliation runs *inside* the same immediate transaction as the insert on
   * purpose. Split across two transactions, a crashed job could be reclaimed by
   * this caller and then claimed by a third process in the gap, and this caller
   * would fail on a constraint it had just cleared. One transaction makes
   * "recover the dead owner and take the profile" a single atomic step.
   *
   * Throws `ACTIVE_JOB_EXISTS` when a *live* job holds the profile. The caller
   * must treat that as authoritative and spawn nothing -- TICKET_1335 AC6 is that
   * two concurrent installs produce one job, not that the second one is tidy.
   */
  admit(input: {
    operation: ResearchEnvironmentOperation;
    manifestSha256: string;
    lockSha256: string;
    profile?: ResearchEnvironmentProfile;
  }): PersistedResearchEnvironmentJob {
    const profile = input.profile ?? DEFAULT_RESEARCH_ENVIRONMENT_PROFILE;

    return this.db.transactionImmediate(() => {
      this.reconcileAbandonedWithinTransaction(profile);

      const surviving = this.readActiveRow(profile);
      if (surviving) {
        throw new ResearchEnvironmentJobError(
          RESEARCH_ENV_JOB_ERROR_CODES.ACTIVE_JOB_EXISTS,
          `A ${surviving.operation} job is already running for profile ${profile}.`,
          surviving.job_id,
        );
      }

      const jobId = this.newJobId();
      const timestamp = this.timestamp();
      this.db.prepare(
        `INSERT INTO research_environment_jobs
           (job_id, profile, operation, state, current_stage, manifest_sha256,
            lock_sha256, owner_instance_id, owner_pid, heartbeat_at, created_at)
         VALUES (?, ?, ?, 'queued', 'admission', ?, ?, ?, ?, ?, ?)`,
      ).run(
        jobId,
        profile,
        input.operation,
        input.manifestSha256,
        input.lockSha256,
        this.instanceId,
        this.pid ?? null,
        timestamp,
        timestamp,
      );

      return this.requireJob(jobId);
    })();
  }

  /**
   * Reconcile jobs whose owner is gone, outside an admission.
   *
   * Called at process start (TICKET_1335_1 AC6: after a crash, the page must not
   * find a permanently-installing environment). Idempotent, and safe to run in
   * every process that opens the database: a job owned by *this* instance is
   * never reclaimed, and a job with a fresh heartbeat is never reclaimed
   * regardless of which instance owns it.
   */
  reconcileAbandoned(profile: ResearchEnvironmentProfile = DEFAULT_RESEARCH_ENVIRONMENT_PROFILE): string[] {
    return this.db.transactionImmediate(
      () => this.reconcileAbandonedWithinTransaction(profile),
    )();
  }

  /**
   * The reclaim rule, in one place because both entry points must agree.
   *
   * A job is abandoned when it is active, is owned by a *different* instance,
   * and its heartbeat has gone stale. All three conditions are load-bearing:
   *
   * - `state IN ('queued','running')`: terminal jobs are history, not claims.
   * - `owner_instance_id <> ?`: a job this process owns is alive by construction
   *   -- if this process were dead it would not be executing this statement. This
   *   also stops a restarted process from reclaiming a job that a *sibling*
   *   process is still running.
   * - stale heartbeat: the only available evidence of owner death, since PID is
   *   not admissible (TICKET_1335 D4).
   *
   * Reclaimed jobs become `failed` with `operation_interrupted`, not `queued`.
   * Silently retrying would re-enter a Pixi materialization nobody approved,
   * and TICKET_1335_1 D4 binds every mutation to a fresh native-dialog approval.
   * The user is shown an interrupted job and re-approves a repair.
   */
  private reconcileAbandonedWithinTransaction(profile: ResearchEnvironmentProfile): string[] {
    const cutoff = new Date(this.now().getTime() - RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS)
      .toISOString();

    const abandoned = this.db.prepare(
      `SELECT job_id, operation, current_stage FROM research_environment_jobs
        WHERE profile = ?
          AND state IN ('queued', 'running')
          AND owner_instance_id <> ?
          AND heartbeat_at < ?`,
    ).all(profile, this.instanceId, cutoff) as Array<{
      job_id: string;
      operation: string;
      current_stage: string | null;
    }>;

    const finishedAt = this.timestamp();
    for (const row of abandoned) {
      // The failure's `stage` must be one the interrupted *operation* can carry,
      // or the shared contract rejects the row on read (the stage-belongs-to-
      // operation refinement in `researchEnvironmentJobSchema`). A job killed
      // while still in `admission` never began work, so it is attributed to the
      // operation's own first stage rather than to admission, which
      // `operation_interrupted` cannot take.
      const stage = interruptedStageFor(row.operation, row.current_stage);
      const failure: ResearchEnvironmentFailure = {
        category: 'operation_interrupted',
        stage,
        cause: 'process_lost',
        message: `The ${row.operation} operation stopped because the process running it was lost.`,
        remediation: 'Run Repair Environment to revalidate the environment against the committed lock.',
      };
      this.db.prepare(
        `UPDATE research_environment_jobs
            SET state = 'failed', finished_at = ?, failure_json = ?
          WHERE job_id = ?`,
      ).run(finishedAt, JSON.stringify(failure), row.job_id);
    }

    return abandoned.map(row => row.job_id);
  }

  /**
   * Refresh the heartbeat for a job this instance owns.
   *
   * Returns `false` when the row is gone or no longer active or no longer ours,
   * rather than throwing: the caller is a periodic timer, and an owner whose job
   * was reclaimed needs to *stop*, not to raise on every tick. The ownership and
   * state predicates are in the SQL so a reclaimed job cannot be resurrected by
   * a heartbeat that was already in flight.
   */
  heartbeat(jobId: string): boolean {
    const result = this.db.prepare(
      `UPDATE research_environment_jobs
          SET heartbeat_at = ?
        WHERE job_id = ?
          AND owner_instance_id = ?
          AND state IN ('queued', 'running')`,
    ).run(this.timestamp(), jobId, this.instanceId);
    return result.changes > 0;
  }

  /** Move an admitted job to `running` and stamp `started_at`. */
  markRunning(jobId: string, stage: ResearchEnvironmentStage): PersistedResearchEnvironmentJob {
    return this.db.transactionImmediate(() => {
      this.assertOwnedAndActive(jobId);
      const timestamp = this.timestamp();
      this.db.prepare(
        `UPDATE research_environment_jobs
            SET state = 'running',
                current_stage = ?,
                started_at = COALESCE(started_at, ?),
                heartbeat_at = ?
          WHERE job_id = ?`,
      ).run(stage, timestamp, timestamp, jobId);
      return this.requireJob(jobId);
    })();
  }

  /**
   * Advance the stage of a running job.
   *
   * Doubles as a heartbeat because a stage transition is itself proof of life,
   * and an owner that reported progress should never then be reclaimed for
   * silence in the same window.
   */
  advanceStage(jobId: string, stage: ResearchEnvironmentStage): PersistedResearchEnvironmentJob {
    return this.db.transactionImmediate(() => {
      this.assertOwnedAndActive(jobId);
      const timestamp = this.timestamp();
      this.db.prepare(
        `UPDATE research_environment_jobs
            SET current_stage = ?, heartbeat_at = ?
          WHERE job_id = ?`,
      ).run(stage, timestamp, jobId);
      return this.requireJob(jobId);
    })();
  }

  /**
   * Replace the persisted log tail.
   *
   * Truncation keeps the *last* lines: the tail exists to explain a failure, and
   * a failure's evidence is at the end. Redaction is the producing service's
   * responsibility before it calls here (TICKET_1335 D4) -- this layer cannot
   * know which substrings are secrets, and a redactor guessing at that would be
   * the kind of defensive check TICKET_859 puts after, not instead of, the fix
   * at the owning layer.
   */
  appendLogTail(jobId: string, lines: readonly string[]): PersistedResearchEnvironmentJob {
    return this.db.transactionImmediate(() => {
      this.assertOwnedAndActive(jobId);
      const bounded = lines
        .slice(-RESEARCH_ENV_PERSISTED_LOG_LINES)
        .map(line => line.slice(0, RESEARCH_ENV_MAX_LOG_LINE_CHARS));
      this.db.prepare(
        `UPDATE research_environment_jobs
            SET log_tail = ?, heartbeat_at = ?
          WHERE job_id = ?`,
      ).run(JSON.stringify(bounded), this.timestamp(), jobId);
      return this.requireJob(jobId);
    })();
  }

  /**
   * Terminal success. The verified status is persisted because it is what every
   * surface renders after reconnecting to a finished job (TICKET_1335_1 AC6);
   * recomputing it on read would re-probe the interpreter on every poll.
   */
  markSucceeded(jobId: string, status: ResearchEnvironmentStatus): PersistedResearchEnvironmentJob {
    return this.db.transactionImmediate(() => {
      this.assertOwnedAndActive(jobId);
      // Validated before the write, not after the read: a status that violates
      // the shared contract must never reach the table, because a row that
      // cannot be parsed back is unreadable by every surface (TICKET_857).
      const validated = this.parseStatus(status);
      this.upsertPublishedProjection(jobId, validated, null);
      this.db.prepare(
        `UPDATE research_environment_jobs
            SET state = 'succeeded',
                finished_at = ?,
                heartbeat_at = ?,
                result_json = ?,
                failure_json = NULL
          WHERE job_id = ?`,
      ).run(this.timestamp(), this.timestamp(), JSON.stringify(validated), jobId);
      return this.requireJob(jobId);
    })();
  }

  /**
   * Atomically publish a verified projection while retaining the active job
   * claim for cleanup of the now-inactive prefix. A crash after this commit
   * cannot make readers fall back to the prefix that cleanup may already have
   * removed.
   */
  publishProjection(
    jobId: string,
    status: ResearchEnvironmentStatus,
    pendingCleanupProjection: ResearchEnvironmentProjection,
  ): PersistedResearchEnvironmentJob {
    return this.db.transactionImmediate(() => {
      this.assertOwnedAndActive(jobId);
      const validated = this.parseStatus(status);
      this.upsertPublishedProjection(jobId, validated, pendingCleanupProjection);
      this.db.prepare(
        `UPDATE research_environment_jobs
            SET result_json = ?, heartbeat_at = ?
          WHERE job_id = ?`,
      ).run(JSON.stringify(validated), this.timestamp(), jobId);
      return this.requireJob(jobId);
    })();
  }

  /** Finish cleanup and the transition in one durable commit. */
  completePublishedTransition(
    jobId: string,
    status: ResearchEnvironmentStatus,
  ): PersistedResearchEnvironmentJob {
    return this.db.transactionImmediate(() => {
      this.assertOwnedAndActive(jobId);
      const validated = this.parseStatus(status);
      this.upsertPublishedProjection(jobId, validated, null);
      const timestamp = this.timestamp();
      this.db.prepare(
        `UPDATE research_environment_jobs
            SET state = 'succeeded', finished_at = ?, heartbeat_at = ?,
                result_json = ?, failure_json = NULL
          WHERE job_id = ?`,
      ).run(timestamp, timestamp, JSON.stringify(validated), jobId);
      return this.requireJob(jobId);
    })();
  }

  findPublishedProjection(
    profile: ResearchEnvironmentProfile = DEFAULT_RESEARCH_ENVIRONMENT_PROFILE,
  ): PublishedResearchEnvironmentProjection | undefined {
    const row = this.db.prepare(
      `SELECT projection, status_json, pending_cleanup_projection, published_by_job_id
         FROM research_environment_active_projection WHERE profile = ?`,
    ).get(profile) as {
      projection: ResearchEnvironmentProjection;
      status_json: string;
      pending_cleanup_projection: ResearchEnvironmentProjection | null;
      published_by_job_id: string;
    } | undefined;
    if (!row) return undefined;
    return {
      projection: row.projection,
      status: this.decodeJson(
        row.published_by_job_id,
        'status_json',
        row.status_json,
        this.parsePersistedStatus,
      ),
      ...(row.pending_cleanup_projection
        ? { pendingCleanupProjection: row.pending_cleanup_projection }
        : {}),
      publishedByJobId: row.published_by_job_id,
    };
  }

  clearPendingCleanup(jobId: string): void {
    this.db.transactionImmediate(() => {
      const job = this.assertOwnedAndActive(jobId);
      this.db.prepare(
        `UPDATE research_environment_active_projection
            SET pending_cleanup_projection = NULL, updated_at = ?
          WHERE profile = ?`,
      ).run(this.timestamp(), job.profile);
    })();
  }

  /** Terminal failure. The structured failure is what surfaces branch on. */
  markFailed(
    jobId: string,
    failure: ResearchEnvironmentFailure,
  ): PersistedResearchEnvironmentJob {
    return this.db.transactionImmediate(() => {
      this.assertOwnedAndActive(jobId);
      const validated = this.parseFailure(failure);
      this.db.prepare(
        `UPDATE research_environment_jobs
            SET state = 'failed',
                finished_at = ?,
                heartbeat_at = ?,
                failure_json = ?
          WHERE job_id = ?`,
      ).run(this.timestamp(), this.timestamp(), JSON.stringify(validated), jobId);
      return this.requireJob(jobId);
    })();
  }

  /**
   * The active job for a profile, or `undefined`.
   *
   * Read-only and ownership-blind on purpose: a renderer reconnecting after a
   * reload, and an MCP client in another process, both need to observe the job
   * that some *other* instance is running (TICKET_1335 AC10).
   */
  findActive(
    profile: ResearchEnvironmentProfile = DEFAULT_RESEARCH_ENVIRONMENT_PROFILE,
  ): PersistedResearchEnvironmentJob | undefined {
    const row = this.readActiveRow(profile);
    return row ? this.decode(row) : undefined;
  }

  findById(jobId: string): PersistedResearchEnvironmentJob | undefined {
    const row = this.db.prepare(
      'SELECT * FROM research_environment_jobs WHERE job_id = ?',
    ).get(jobId) as JobRow | undefined;
    return row ? this.decode(row) : undefined;
  }

  /** Most recent terminal job, used to render the last known result. */
  findLatestTerminal(
    profile: ResearchEnvironmentProfile = DEFAULT_RESEARCH_ENVIRONMENT_PROFILE,
  ): PersistedResearchEnvironmentJob | undefined {
    const row = this.db.prepare(
      `SELECT * FROM research_environment_jobs
        WHERE profile = ? AND state IN ('succeeded', 'failed')
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1`,
    ).get(profile) as JobRow | undefined;
    return row ? this.decode(row) : undefined;
  }

  /** Last projection that completed verification and was durably published. */
  findLatestSucceeded(
    profile: ResearchEnvironmentProfile = DEFAULT_RESEARCH_ENVIRONMENT_PROFILE,
  ): PersistedResearchEnvironmentJob | undefined {
    const row = this.db.prepare(
      `SELECT * FROM research_environment_jobs
        WHERE profile = ? AND state = 'succeeded' AND result_json IS NOT NULL
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1`,
    ).get(profile) as JobRow | undefined;
    return row ? this.decode(row) : undefined;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private readActiveRow(profile: ResearchEnvironmentProfile): JobRow | undefined {
    return this.db.prepare(
      `SELECT * FROM research_environment_jobs
        WHERE profile = ? AND state IN ('queued', 'running')`,
    ).get(profile) as JobRow | undefined;
  }

  private upsertPublishedProjection(
    jobId: string,
    status: ResearchEnvironmentStatus,
    pendingCleanupProjection: ResearchEnvironmentProjection | null,
  ): void {
    this.db.prepare(
      `INSERT INTO research_environment_active_projection
         (profile, projection, status_json, pending_cleanup_projection,
          published_by_job_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile) DO UPDATE SET
         projection = excluded.projection,
         status_json = excluded.status_json,
         pending_cleanup_projection = excluded.pending_cleanup_projection,
         published_by_job_id = excluded.published_by_job_id,
         updated_at = excluded.updated_at`,
    ).run(
      status.profile,
      status.projection,
      JSON.stringify(status),
      pendingCleanupProjection,
      jobId,
      this.timestamp(),
    );
  }

  /**
   * Ownership is checked on every mutation, not just at admission.
   *
   * Without this, a process whose job was reconciled away could keep writing
   * stages and a terminal result onto a row another instance now owns, which is
   * the corruption the single-active-job invariant exists to prevent.
   */
  private assertOwnedAndActive(jobId: string): JobRow {
    const row = this.db.prepare(
      'SELECT * FROM research_environment_jobs WHERE job_id = ?',
    ).get(jobId) as JobRow | undefined;

    if (!row) {
      throw new ResearchEnvironmentJobError(
        RESEARCH_ENV_JOB_ERROR_CODES.JOB_NOT_FOUND,
        `Research environment job ${jobId} does not exist.`,
      );
    }
    if (row.owner_instance_id !== this.instanceId) {
      throw new ResearchEnvironmentJobError(
        RESEARCH_ENV_JOB_ERROR_CODES.NOT_JOB_OWNER,
        `Research environment job ${jobId} is owned by another runtime instance.`,
      );
    }
    if (!isActive(row.state as ResearchEnvironmentJobState)) {
      throw new ResearchEnvironmentJobError(
        RESEARCH_ENV_JOB_ERROR_CODES.JOB_ALREADY_TERMINAL,
        `Research environment job ${jobId} already finished as ${row.state}.`,
      );
    }
    return row;
  }

  private requireJob(jobId: string): PersistedResearchEnvironmentJob {
    const job = this.findById(jobId);
    if (!job) {
      throw new ResearchEnvironmentJobError(
        RESEARCH_ENV_JOB_ERROR_CODES.JOB_NOT_FOUND,
        `Research environment job ${jobId} disappeared during the operation.`,
      );
    }
    return job;
  }

  /**
   * Decode a row into the persisted shape, validating the JSON payloads.
   *
   * A row whose `result_json` or `failure_json` cannot be validated raises
   * rather than being dropped to `undefined`. Silently discarding it would make
   * a failed job look like a failure-less failed job, which the shared contract
   * forbids and which would leave the UI with nothing actionable to render --
   * TICKET_858's definition of a silent failure.
   */
  private decode(row: JobRow): PersistedResearchEnvironmentJob {
    const job: PersistedResearchEnvironmentJob = {
      jobId: row.job_id,
      profile: row.profile as ResearchEnvironmentProfile,
      operation: row.operation as ResearchEnvironmentOperation,
      state: row.state as ResearchEnvironmentJobState,
      manifestSha256: row.manifest_sha256,
      lockSha256: row.lock_sha256,
      ownerInstanceId: row.owner_instance_id,
      heartbeatAt: row.heartbeat_at,
      createdAt: row.created_at,
    };
    if (row.current_stage) job.currentStage = row.current_stage as ResearchEnvironmentStage;
    if (row.owner_pid !== null) job.ownerPid = row.owner_pid;
    if (row.started_at) job.startedAt = row.started_at;
    if (row.finished_at) job.finishedAt = row.finished_at;
    if (row.result_json) {
      job.result = this.decodeJson(
        row.job_id,
        'result_json',
        row.result_json,
        this.parsePersistedStatus,
      );
    }
    if (row.failure_json) {
      job.failure = this.decodeJson(row.job_id, 'failure_json', row.failure_json, this.parseFailure);
    }
    if (row.log_tail) {
      job.logTail = this.decodeLogTail(row.job_id, row.log_tail);
    }
    return job;
  }

  private decodeJson<T>(
    jobId: string,
    column: string,
    raw: string,
    parse: (value: unknown) => T,
  ): T {
    try {
      return parse(JSON.parse(raw));
    } catch (error) {
      throw new ResearchEnvironmentJobError(
        RESEARCH_ENV_JOB_ERROR_CODES.CORRUPT_JOB_ROW,
        `Research environment job ${jobId} has an unreadable ${column}: `
          + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private decodeLogTail(jobId: string, raw: string): string[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ResearchEnvironmentJobError(
        RESEARCH_ENV_JOB_ERROR_CODES.CORRUPT_JOB_ROW,
        `Research environment job ${jobId} has an unreadable log_tail: `
          + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!Array.isArray(parsed) || parsed.some(line => typeof line !== 'string')) {
      throw new ResearchEnvironmentJobError(
        RESEARCH_ENV_JOB_ERROR_CODES.CORRUPT_JOB_ROW,
        `Research environment job ${jobId} has a log_tail that is not a string array.`,
      );
    }
    return (parsed as string[]).slice(-RESEARCH_ENV_MAX_LOG_LINES);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Map the stage a lost job was in onto a stage `operation_interrupted` may
 * legally carry for that operation.
 *
 * `admission` is excluded by the contract for this category, and a `verify` job
 * has no `install`/`repair` stage, so a job lost before it reported a work stage
 * is attributed to the first stage its operation actually performs.
 */
function interruptedStageFor(
  operation: string,
  currentStage: string | null,
): 'install' | 'repair' | 'uninstall' | 'python_verify' | 'julia_verify' {
  if (currentStage === 'install' || currentStage === 'repair'
    || currentStage === 'uninstall' || currentStage === 'python_verify' || currentStage === 'julia_verify') {
    if (operation === 'verify' && (currentStage === 'install' || currentStage === 'repair')) {
      return 'python_verify';
    }
    return currentStage;
  }
  if (operation === 'repair') return 'repair';
  if (operation === 'uninstall') return 'uninstall';
  if (operation === 'verify') return 'python_verify';
  return 'install';
}

/**
 * Default job identity.
 *
 * `randomUUID` is required rather than a timestamp or counter: two processes
 * admitting in the same millisecond must not mint the same primary key, and a
 * per-process counter cannot be unique across the Electron, Service API, and MCP
 * processes that share this table.
 */
function defaultJobIdFactory(): string {
  // Required lazily so the module stays loadable in a renderer bundle that has
  // no `node:crypto`; only a process that actually admits a job needs it.
  const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
  return randomUUID();
}
