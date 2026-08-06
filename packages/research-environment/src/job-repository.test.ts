/**
 * TICKET_1335 L3 tests.
 *
 * These run against real SQLite with the real migration 140 body, not a mock.
 * The invariant under test -- at most one active job per profile -- is enforced by
 * a partial unique index, which is exactly the kind of constraint that
 * type-checks against a fake and then does not exist in production.
 *
 * Time and identity are injected so crash reconciliation is testable without
 * sleeping past a 90-second threshold.
 */

import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import {
  RESEARCH_CAPABILITIES,
  RESEARCH_ENV_MAX_LOG_LINES,
  RESEARCH_ENV_MAX_LOG_LINE_CHARS,
  parsePersistedResearchEnvironmentStatus,
  parseResearchEnvironmentStatus,
  researchEnvironmentFailureSchema,
  type ResearchEnvironmentFailure,
  type ResearchEnvironmentStatus,
} from '@StratCraft/types';
import { EMBEDDED_MIGRATIONS_FOR_TEST } from '@StratCraft/db-migrations';
import {
  RESEARCH_ENV_JOB_ERROR_CODES,
  ResearchEnvironmentJobError,
  ResearchEnvironmentJobRepository,
  type ResearchEnvironmentDb,
} from './job-repository';
import {
  RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS,
  RESEARCH_ENV_PERSISTED_LOG_LINES,
} from './constants';

const SHA = 'a'.repeat(64);
const BASE_TIME = new Date('2026-07-30T00:00:00.000Z').getTime();

const migrations = EMBEDDED_MIGRATIONS_FOR_TEST.filter(
  item => item.version === 140 || item.version === 145,
);

/**
 * The native binding is resolved from the standalone MCP copy for the same
 * reason the migration-140 suite does: this workspace's root `better-sqlite3` is
 * built against the Electron ABI, so a Node-hosted vitest run cannot load it
 * (`project_better_sqlite3_abi_rebuild`).
 */
function openMigrated(): Database.Database {
  const db = new Database(':memory:', {
    nativeBinding: resolve(
      process.cwd(),
      '../../apps/desktop/src/mcp/standalone/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    ),
  });
  db.pragma('foreign_keys = ON');
  for (const migration of migrations) db.exec(migration.up as string);
  return db;
}

/**
 * Adapts better-sqlite3 to the structural surface the repository declares, and
 * records the SQL of every statement whose `run` was actually invoked.
 *
 * The recording exists so a test can assert that a rejected payload was never
 * written, which a `toThrow()` assertion alone cannot establish.
 */
function adapt(db: Database.Database, writes: string[]): ResearchEnvironmentDb {
  return {
    prepare: (sql: string) => {
      const statement = db.prepare(sql);
      return {
        run: (...params: unknown[]) => {
          writes.push(sql);
          return statement.run(...(params as never[]));
        },
        get: (...params: unknown[]) => statement.get(...(params as never[])),
        all: (...params: unknown[]) => statement.all(...(params as never[])),
      } as never;
    },
    transactionImmediate: <T>(fn: () => T) => db.transaction(fn).immediate,
  };
}

interface Harness {
  db: Database.Database;
  clock: { current: number };
  repo: ResearchEnvironmentJobRepository;
  /** SQL of every executed write, in order. */
  writes: string[];
  make(instanceId: string): ResearchEnvironmentJobRepository;
}

function harness(): Harness {
  const db = openMigrated();
  const clock = { current: BASE_TIME };
  const writes: string[] = [];
  let counter = 0;
  const shared = adapt(db, writes);

  const make = (instanceId: string) => new ResearchEnvironmentJobRepository({
    db: shared,
    instanceId,
    pid: 4242,
    now: () => new Date(clock.current),
    newJobId: () => `job-${++counter}`,
    parseStatus: parseResearchEnvironmentStatus,
    parsePersistedStatus: parsePersistedResearchEnvironmentStatus,
    parseFailure: value => researchEnvironmentFailureSchema.parse(value),
  });

  return { db, clock, writes, repo: make('instance-a'), make };
}

/** A contract-valid `ready` status, which the schema's refinements demand. */
function readyStatus(): ResearchEnvironmentStatus {
  return {
    schemaVersion: 2,
    profile: 'research-default',
    projection: 'default',
    state: 'ready',
    supportedPlatform: true,
    platform: 'linux',
    architecture: 'x64',
    interpreterPath: '/workspace/StratCraft/.pixi/envs/default/bin/python',
    lastVerifiedAt: '2026-07-30T00:00:00.000Z',
    capabilities: Object.fromEntries(
      RESEARCH_CAPABILITIES.map(capability => [capability, {
        expected: '1.0.0',
        installed: '1.0.0',
        state: 'ready' as const,
        verification: 'import ok',
      }]),
    ) as ResearchEnvironmentStatus['capabilities'],
  };
}

function installFailure(): ResearchEnvironmentFailure {
  return {
    category: 'install_failed',
    stage: 'install',
    cause: 'process_exit',
    message: 'pixi install exited with code 1.',
    remediation: 'Check connectivity and run Repair Environment.',
  };
}

function admit(repo: ResearchEnvironmentJobRepository, operation: 'install' | 'repair' | 'verify' = 'install') {
  return repo.admit({ operation, manifestSha256: SHA, lockSha256: SHA });
}

function expectCode(fn: () => unknown, code: string): ResearchEnvironmentJobError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ResearchEnvironmentJobError);
    expect((error as ResearchEnvironmentJobError).code).toBe(code);
    return error as ResearchEnvironmentJobError;
  }
  throw new Error(`Expected ${code} to be thrown.`);
}

// -----------------------------------------------------------------------------

describe('constants agree with the shared contract', () => {
  // A persisted tail longer than the contract's bound would be written happily
  // and then rejected when a surface parsed the job, so the two bounds cannot be
  // allowed to drift independently (TICKET_179).
  it('persists no more lines than the contract permits', () => {
    expect(RESEARCH_ENV_PERSISTED_LOG_LINES).toBeLessThanOrEqual(RESEARCH_ENV_MAX_LOG_LINES);
  });
});

describe('admission claims the profile', () => {
  it('admits a queued job in the admission stage owned by this instance', () => {
    const { repo } = harness();
    const job = admit(repo);
    expect(job).toMatchObject({
      jobId: 'job-1',
      profile: 'research-default',
      operation: 'install',
      state: 'queued',
      currentStage: 'admission',
      ownerInstanceId: 'instance-a',
      ownerPid: 4242,
      manifestSha256: SHA,
      lockSha256: SHA,
    });
    expect(job.createdAt).toBe('2026-07-30T00:00:00.000Z');
    expect(job.startedAt).toBeUndefined();
    expect(job.finishedAt).toBeUndefined();
  });

  // TICKET_1335 AC6: two concurrent installs produce ONE job. The second caller
  // must learn it lost before spawning anything.
  it('rejects a second admission on the same profile from the same instance', () => {
    const { repo } = harness();
    const first = admit(repo);
    const error = expectCode(
      () => admit(repo),
      RESEARCH_ENV_JOB_ERROR_CODES.ACTIVE_JOB_EXISTS,
    );
    expect(error.activeJobId).toBe(first.jobId);
  });

  // The cross-process case: a different instance sharing the same database file
  // must be refused too, which is what the partial unique index guarantees.
  it('rejects a second admission from a different instance', () => {
    const { repo, make } = harness();
    const first = admit(repo);
    const error = expectCode(
      () => admit(make('instance-b')),
      RESEARCH_ENV_JOB_ERROR_CODES.ACTIVE_JOB_EXISTS,
    );
    expect(error.activeJobId).toBe(first.jobId);
  });

  it('rejects a second admission for a different operation', () => {
    const { repo } = harness();
    admit(repo, 'install');
    expectCode(
      () => admit(repo, 'verify'),
      RESEARCH_ENV_JOB_ERROR_CODES.ACTIVE_JOB_EXISTS,
    );
  });

  it('admits again once the previous job reached a terminal state', () => {
    const { repo } = harness();
    const first = admit(repo);
    repo.markRunning(first.jobId, 'install');
    repo.markSucceeded(first.jobId, readyStatus());
    const second = admit(repo);
    expect(second.jobId).toBe('job-2');
    expect(second.state).toBe('queued');
  });

  it('admits again after a failed job, so failure is recoverable', () => {
    const { repo } = harness();
    const first = admit(repo);
    repo.markFailed(first.jobId, installFailure());
    expect(admit(repo, 'repair').operation).toBe('repair');
  });

  it('keeps terminal jobs as history rather than deleting them', () => {
    const { repo, db } = harness();
    const first = admit(repo);
    repo.markFailed(first.jobId, installFailure());
    admit(repo);
    const count = db.prepare('SELECT COUNT(*) AS n FROM research_environment_jobs').get() as { n: number };
    expect(count.n).toBe(2);
  });
});

describe('lifecycle transitions', () => {
  it('marks a job running and stamps started_at once', () => {
    const { repo, clock } = harness();
    const job = admit(repo);
    const running = repo.markRunning(job.jobId, 'install');
    expect(running.state).toBe('running');
    expect(running.currentStage).toBe('install');
    expect(running.startedAt).toBe('2026-07-30T00:00:00.000Z');

    // COALESCE keeps the original start time; a re-entered markRunning must not
    // reset elapsed time in the UI.
    clock.current += 60_000;
    const again = repo.markRunning(job.jobId, 'python_verify');
    expect(again.startedAt).toBe('2026-07-30T00:00:00.000Z');
    expect(again.currentStage).toBe('python_verify');
  });

  it('advances stages and treats progress as proof of life', () => {
    const { repo, clock } = harness();
    const job = admit(repo);
    repo.markRunning(job.jobId, 'install');
    clock.current += 30_000;
    const advanced = repo.advanceStage(job.jobId, 'julia_verify');
    expect(advanced.currentStage).toBe('julia_verify');
    expect(advanced.heartbeatAt).toBe(new Date(BASE_TIME + 30_000).toISOString());
  });

  it('records a terminal success with the verified status', () => {
    const { repo } = harness();
    const job = admit(repo);
    repo.markRunning(job.jobId, 'install');
    const done = repo.markSucceeded(job.jobId, readyStatus());
    expect(done.state).toBe('succeeded');
    expect(done.finishedAt).toBeDefined();
    expect(done.result?.state).toBe('ready');
    expect(done.failure).toBeUndefined();
  });

  it('clears a previous failure payload on success', () => {
    const { repo, db } = harness();
    const job = admit(repo);
    // Simulate a row that carried failure JSON from an earlier attempt at the
    // same row; success must not leave both payloads readable.
    db.prepare('UPDATE research_environment_jobs SET failure_json = ? WHERE job_id = ?')
      .run(JSON.stringify(installFailure()), job.jobId);
    const done = repo.markSucceeded(job.jobId, readyStatus());
    expect(done.failure).toBeUndefined();
  });

  it('records a terminal failure with the structured failure', () => {
    const { repo } = harness();
    const job = admit(repo);
    const failed = repo.markFailed(job.jobId, installFailure());
    expect(failed.state).toBe('failed');
    expect(failed.failure).toMatchObject({ category: 'install_failed', cause: 'process_exit' });
    expect(failed.finishedAt).toBeDefined();
  });

  // TICKET_857: a status violating the shared contract must never reach the
  // table, because a row that cannot be parsed back is unreadable everywhere.
  // The assertion is deliberately that the UPDATE never executed, not merely
  // that the call threw. Validating only on read-back would also throw -- via the
  // decode step -- while having already written an unreadable row, so a
  // throw-only assertion would pass against a store with no pre-write check at
  // all. The statement spy is what distinguishes the two.
  it('rejects an invalid status before writing it', () => {
    const { repo, writes } = harness();
    const job = admit(repo);
    const bogus = { ...readyStatus(), interpreterPath: undefined } as unknown as ResearchEnvironmentStatus;
    writes.length = 0;
    expect(() => repo.markSucceeded(job.jobId, bogus)).toThrow();
    expect(writes.filter(sql => sql.includes('result_json'))).toEqual([]);
  });

  it('rejects an invalid failure before writing it', () => {
    const { repo, writes } = harness();
    const job = admit(repo);
    const bogus = {
      category: 'unsupported_platform',
      stage: 'admission',
      cause: 'unsupported',
      capability: 'duckdb',
      message: 'x',
      remediation: 'y',
    } as unknown as ResearchEnvironmentFailure;
    writes.length = 0;
    expect(() => repo.markFailed(job.jobId, bogus)).toThrow();
    expect(writes.filter(sql => sql.includes('failure_json'))).toEqual([]);
  });

  it('leaves the job claimable after a rejected terminal write', () => {
    const { repo, db } = harness();
    const job = admit(repo);
    const bogus = { ...readyStatus(), interpreterPath: undefined } as unknown as ResearchEnvironmentStatus;
    expect(() => repo.markSucceeded(job.jobId, bogus)).toThrow();
    const row = db.prepare('SELECT state, result_json FROM research_environment_jobs WHERE job_id = ?')
      .get(job.jobId) as { state: string; result_json: string | null };
    expect(row.state).toBe('queued');
    expect(row.result_json).toBeNull();
  });
});

describe('ownership is checked on every mutation', () => {
  it('refuses mutations from a non-owning instance', () => {
    const { repo, make } = harness();
    const job = admit(repo);
    const other = make('instance-b');
    for (const mutate of [
      () => other.markRunning(job.jobId, 'install'),
      () => other.advanceStage(job.jobId, 'install'),
      () => other.appendLogTail(job.jobId, ['line']),
      () => other.markSucceeded(job.jobId, readyStatus()),
      () => other.markFailed(job.jobId, installFailure()),
    ]) {
      expectCode(mutate, RESEARCH_ENV_JOB_ERROR_CODES.NOT_JOB_OWNER);
    }
  });

  it('refuses mutations on an unknown job', () => {
    const { repo } = harness();
    expectCode(
      () => repo.markRunning('nope', 'install'),
      RESEARCH_ENV_JOB_ERROR_CODES.JOB_NOT_FOUND,
    );
  });

  it('refuses mutations on an already terminal job', () => {
    const { repo } = harness();
    const job = admit(repo);
    repo.markFailed(job.jobId, installFailure());
    expectCode(
      () => repo.advanceStage(job.jobId, 'install'),
      RESEARCH_ENV_JOB_ERROR_CODES.JOB_ALREADY_TERMINAL,
    );
  });
});

describe('heartbeat', () => {
  it('refreshes the heartbeat for an owned active job', () => {
    const { repo, clock } = harness();
    const job = admit(repo);
    clock.current += 5_000;
    expect(repo.heartbeat(job.jobId)).toBe(true);
    expect(repo.findById(job.jobId)!.heartbeatAt)
      .toBe(new Date(BASE_TIME + 5_000).toISOString());
  });

  // A periodic timer must learn it lost rather than throw on every tick.
  it('returns false rather than throwing when the claim is not ours', () => {
    const { repo, make } = harness();
    const job = admit(repo);
    expect(make('instance-b').heartbeat(job.jobId)).toBe(false);
  });

  it('returns false for a terminal job', () => {
    const { repo } = harness();
    const job = admit(repo);
    repo.markSucceeded(job.jobId, readyStatus());
    expect(repo.heartbeat(job.jobId)).toBe(false);
  });

  it('returns false for an unknown job', () => {
    const { repo } = harness();
    expect(repo.heartbeat('nope')).toBe(false);
  });
});

describe('crash reconciliation', () => {
  // Without this, the partial unique index would wedge the profile forever after
  // a crash: no active job may be admitted, and the dead one never terminates.
  it('fails an abandoned job whose owner is gone and frees the profile', () => {
    const { repo, make, clock } = harness();
    const dead = admit(repo);
    repo.markRunning(dead.jobId, 'install');

    clock.current += RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS + 1;
    const survivor = make('instance-b');
    const reclaimed = survivor.reconcileAbandoned();
    expect(reclaimed).toEqual([dead.jobId]);

    const row = survivor.findById(dead.jobId)!;
    expect(row.state).toBe('failed');
    expect(row.failure).toMatchObject({
      category: 'operation_interrupted',
      stage: 'install',
      cause: 'process_lost',
    });
    expect(row.finishedAt).toBeDefined();
    expect(survivor.findActive()).toBeUndefined();
  });

  // TICKET_1335_1 D4 binds every mutation to a fresh approval, so a reclaimed
  // job must NOT be silently requeued into an unapproved Pixi run.
  it('does not requeue a reclaimed job', () => {
    const { repo, make, clock } = harness();
    const dead = admit(repo);
    clock.current += RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS + 1;
    make('instance-b').reconcileAbandoned();
    expect(repo.findById(dead.jobId)!.state).toBe('failed');
  });

  // The threshold errs toward leaving a possibly-dead job alone: reclaiming a
  // live installer is worse than a delayed recovery.
  it('leaves a job with a fresh heartbeat alone', () => {
    const { repo, make, clock } = harness();
    const live = admit(repo);
    clock.current += RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS - 1;
    expect(make('instance-b').reconcileAbandoned()).toEqual([]);
    expect(make('instance-b').findById(live.jobId)!.state).toBe('queued');
  });

  // A process executing the reconciler is alive by construction, so its own job
  // is never abandoned no matter how starved its heartbeat timer was.
  it('never reclaims a job owned by the reconciling instance', () => {
    const { repo, clock } = harness();
    const mine = admit(repo);
    clock.current += RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS * 10;
    expect(repo.reconcileAbandoned()).toEqual([]);
    expect(repo.findById(mine.jobId)!.state).toBe('queued');
  });

  it('leaves terminal jobs untouched', () => {
    const { repo, make, clock } = harness();
    const done = admit(repo);
    repo.markSucceeded(done.jobId, readyStatus());
    clock.current += RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS * 10;
    expect(make('instance-b').reconcileAbandoned()).toEqual([]);
    expect(make('instance-b').findById(done.jobId)!.state).toBe('succeeded');
  });

  // Reconciliation is folded into admission so recovery and claiming are one
  // atomic step; a split would let a third process take the profile in the gap.
  it('admits after reclaiming an abandoned job in one step', () => {
    const { repo, make, clock } = harness();
    const dead = admit(repo);
    repo.markRunning(dead.jobId, 'install');
    clock.current += RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS + 1;

    const survivor = make('instance-b');
    const fresh = survivor.admit({ operation: 'repair', manifestSha256: SHA, lockSha256: SHA });
    expect(fresh.state).toBe('queued');
    expect(fresh.ownerInstanceId).toBe('instance-b');
    expect(survivor.findById(dead.jobId)!.state).toBe('failed');
  });

  it('is idempotent', () => {
    const { repo, make, clock } = harness();
    admit(repo);
    clock.current += RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS + 1;
    const survivor = make('instance-b');
    expect(survivor.reconcileAbandoned()).toHaveLength(1);
    expect(survivor.reconcileAbandoned()).toEqual([]);
  });

  // The interruption failure's stage must be legal for the job's operation, or
  // the shared contract rejects the row when a surface reads it.
  it('attributes the interruption to a stage the operation can carry', () => {
    const cases: Array<{ operation: 'install' | 'repair' | 'verify'; stage: string }> = [
      { operation: 'install', stage: 'install' },
      { operation: 'repair', stage: 'repair' },
      { operation: 'verify', stage: 'python_verify' },
    ];
    for (const testCase of cases) {
      const { repo, make, clock } = harness();
      // Left in `admission`, which `operation_interrupted` may not carry.
      const dead = admit(repo, testCase.operation);
      clock.current += RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS + 1;
      const survivor = make('instance-b');
      survivor.reconcileAbandoned();
      expect(survivor.findById(dead.jobId)!.failure!.stage).toBe(testCase.stage);
    }
  });

  it('preserves a work stage the lost job had already reached', () => {
    const { repo, make, clock } = harness();
    const dead = admit(repo);
    repo.markRunning(dead.jobId, 'julia_verify');
    clock.current += RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS + 1;
    const survivor = make('instance-b');
    survivor.reconcileAbandoned();
    expect(survivor.findById(dead.jobId)!.failure!.stage).toBe('julia_verify');
  });

  it('remaps an install stage recorded against a verify job', () => {
    const { repo, make, clock, db } = harness();
    const dead = admit(repo, 'verify');
    // A stage no verify job should hold; the reconciler must still emit a
    // contract-legal failure rather than writing an unreadable row.
    db.prepare("UPDATE research_environment_jobs SET current_stage = 'install' WHERE job_id = ?")
      .run(dead.jobId);
    clock.current += RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS + 1;
    const survivor = make('instance-b');
    survivor.reconcileAbandoned();
    expect(survivor.findById(dead.jobId)!.failure!.stage).toBe('python_verify');
  });
});

describe('log tail', () => {
  it('persists a bounded, tail-preserving log', () => {
    const { repo } = harness();
    const job = admit(repo);
    const lines = Array.from({ length: RESEARCH_ENV_PERSISTED_LOG_LINES + 25 }, (_, i) => `line-${i}`);
    const updated = repo.appendLogTail(job.jobId, lines);
    expect(updated.logTail).toHaveLength(RESEARCH_ENV_PERSISTED_LOG_LINES);
    // The end is kept, because a failure's evidence is at the end.
    expect(updated.logTail!.at(-1)).toBe(`line-${lines.length - 1}`);
  });

  it('truncates over-long lines to the contract bound', () => {
    const { repo } = harness();
    const job = admit(repo);
    const updated = repo.appendLogTail(job.jobId, ['x'.repeat(RESEARCH_ENV_MAX_LOG_LINE_CHARS + 500)]);
    expect(updated.logTail![0]).toHaveLength(RESEARCH_ENV_MAX_LOG_LINE_CHARS);
  });

  it('replaces the tail rather than accumulating unboundedly', () => {
    const { repo } = harness();
    const job = admit(repo);
    repo.appendLogTail(job.jobId, ['first']);
    expect(repo.appendLogTail(job.jobId, ['second']).logTail).toEqual(['second']);
  });

  it('counts a log write as proof of life', () => {
    const { repo, clock } = harness();
    const job = admit(repo);
    clock.current += 20_000;
    expect(repo.appendLogTail(job.jobId, ['line']).heartbeatAt)
      .toBe(new Date(BASE_TIME + 20_000).toISOString());
  });
});

describe('reads are ownership-blind', () => {
  // A renderer reconnecting after reload, and an MCP client in another process,
  // must both observe the job another instance is running (TICKET_1335 AC10).
  it('finds the active job from a different instance', () => {
    const { repo, make } = harness();
    const job = admit(repo);
    const observer = make('instance-b');
    expect(observer.findActive()!.jobId).toBe(job.jobId);
    expect(observer.findById(job.jobId)!.ownerInstanceId).toBe('instance-a');
  });

  it('reports no active job when none is claimed', () => {
    const { repo } = harness();
    expect(repo.findActive()).toBeUndefined();
    expect(repo.findById('nope')).toBeUndefined();
    expect(repo.findLatestTerminal()).toBeUndefined();
  });

  it('returns the most recent terminal job', () => {
    const { repo, clock } = harness();
    const first = admit(repo);
    repo.markFailed(first.jobId, installFailure());
    clock.current += 60_000;
    const second = admit(repo);
    repo.markSucceeded(second.jobId, readyStatus());
    expect(repo.findLatestTerminal()!.jobId).toBe(second.jobId);
  });

  it('ignores active jobs when reporting the latest terminal one', () => {
    const { repo, clock } = harness();
    const done = admit(repo);
    repo.markSucceeded(done.jobId, readyStatus());
    clock.current += 60_000;
    admit(repo);
    expect(repo.findLatestTerminal()!.jobId).toBe(done.jobId);
  });

  it('exposes the owning instance identity', () => {
    const { repo } = harness();
    expect(repo.ownerInstanceId).toBe('instance-a');
  });
});

describe('corrupt rows fail loudly', () => {
  // TICKET_858: dropping an unreadable payload to `undefined` would make a
  // failed job look like a failure-less failed job, leaving the UI nothing
  // actionable to render.
  it('raises on unparseable result JSON', () => {
    const { repo, db } = harness();
    const job = admit(repo);
    db.prepare('UPDATE research_environment_jobs SET result_json = ? WHERE job_id = ?')
      .run('{not json', job.jobId);
    expectCode(() => repo.findById(job.jobId), RESEARCH_ENV_JOB_ERROR_CODES.CORRUPT_JOB_ROW);
  });

  it('raises on result JSON that violates the contract', () => {
    const { repo, db } = harness();
    const job = admit(repo);
    db.prepare('UPDATE research_environment_jobs SET result_json = ? WHERE job_id = ?')
      .run(JSON.stringify({ state: 'ready' }), job.jobId);
    expectCode(() => repo.findById(job.jobId), RESEARCH_ENV_JOB_ERROR_CODES.CORRUPT_JOB_ROW);
  });

  it('raises on unparseable failure JSON', () => {
    const { repo, db } = harness();
    const job = admit(repo);
    db.prepare('UPDATE research_environment_jobs SET failure_json = ? WHERE job_id = ?')
      .run('{nope', job.jobId);
    expectCode(() => repo.findById(job.jobId), RESEARCH_ENV_JOB_ERROR_CODES.CORRUPT_JOB_ROW);
  });

  it('raises on unparseable log tail JSON', () => {
    const { repo, db } = harness();
    const job = admit(repo);
    db.prepare('UPDATE research_environment_jobs SET log_tail = ? WHERE job_id = ?')
      .run('{nope', job.jobId);
    expectCode(() => repo.findById(job.jobId), RESEARCH_ENV_JOB_ERROR_CODES.CORRUPT_JOB_ROW);
  });

  it('raises on a log tail that is not a string array', () => {
    const { repo, db } = harness();
    const job = admit(repo);
    db.prepare('UPDATE research_environment_jobs SET log_tail = ? WHERE job_id = ?')
      .run(JSON.stringify([1, 2, 3]), job.jobId);
    expectCode(() => repo.findById(job.jobId), RESEARCH_ENV_JOB_ERROR_CODES.CORRUPT_JOB_ROW);
  });

  // TICKET_1335 AC13: the row vanishing under an in-flight operation.
  //
  // Every mutating method re-reads the job it just wrote, and that read is not
  // ceremonial: if an external delete removed the row, returning a fabricated or
  // stale job would let the operation keep advancing a claim that no longer
  // exists in the durable store -- the "permanent running row / second worker"
  // state AC10 forbids. It must fail loudly instead (TICKET_857).
  it('raises JOB_NOT_FOUND when the row disappears mid-operation', () => {
    const { repo, db } = harness();
    const job = admit(repo);

    // The row must vanish BETWEEN the ownership guard and the confirming re-read,
    // both of which run inside one transaction -- deleting beforehand would be
    // caught by the guard instead and never reach `requireJob`. A trigger is the
    // only way to interleave a delete into that window, and it stands in for the
    // real cause: another connection removing the row while this write is in
    // flight.
    db.exec(`
      CREATE TRIGGER qnx_1335_vanish
      AFTER UPDATE ON research_environment_jobs
      BEGIN
        DELETE FROM research_environment_jobs WHERE job_id = NEW.job_id;
      END;
    `);

    try {
      expectCode(
        () => repo.markRunning(job.jobId, 'install'),
        RESEARCH_ENV_JOB_ERROR_CODES.JOB_NOT_FOUND,
      );
    } finally {
      db.exec('DROP TRIGGER IF EXISTS qnx_1335_vanish;');
    }
  });

  it('bounds an over-long persisted log tail on read', () => {
    const { repo, db } = harness();
    const job = admit(repo);
    const oversized = Array.from({ length: RESEARCH_ENV_MAX_LOG_LINES + 50 }, (_, i) => `l${i}`);
    db.prepare('UPDATE research_environment_jobs SET log_tail = ? WHERE job_id = ?')
      .run(JSON.stringify(oversized), job.jobId);
    expect(repo.findById(job.jobId)!.logTail).toHaveLength(RESEARCH_ENV_MAX_LOG_LINES);
  });
});

describe('persisted status migration (TICKET_1369)', () => {
  function legacyStatus(): Record<string, unknown> {
    const legacy = structuredClone(readyStatus()) as unknown as Record<string, unknown>;
    delete legacy.schemaVersion;
    delete (legacy.capabilities as Record<string, unknown>).histdata;
    return legacy;
  }

  it('migrates a pre-HistData terminal result before current-schema parsing', () => {
    const { repo, db } = harness();
    const job = admit(repo);
    db.prepare(`UPDATE research_environment_jobs
      SET state = 'succeeded', result_json = ?, finished_at = heartbeat_at
      WHERE job_id = ?`).run(JSON.stringify(legacyStatus()), job.jobId);

    const result = repo.findLatestTerminal()!.result!;
    expect(result.state).toBe('failed');
    expect(result.migration?.reason).toBe('histdata_capability_added');
    expect(result.capabilities.histdata.state).toBe('absent');
  });

  it('migrates a pre-HistData active projection through the same reader', () => {
    const { repo, db } = harness();
    const job = admit(repo);
    db.prepare(`UPDATE research_environment_jobs
      SET state = 'succeeded', result_json = ?, finished_at = heartbeat_at
      WHERE job_id = ?`).run(JSON.stringify(legacyStatus()), job.jobId);
    db.prepare(`INSERT INTO research_environment_active_projection
      (profile, projection, status_json, pending_cleanup_projection,
       published_by_job_id, updated_at)
      VALUES ('research-default', 'default', ?, NULL, ?, ?)`)
      .run(JSON.stringify(legacyStatus()), job.jobId, job.heartbeatAt);

    const status = repo.findPublishedProjection()!.status;
    expect(status.state).toBe('failed');
    expect(status.migration?.fromSchemaVersion).toBe(1);
  });

  it('classifies malformed current terminal data as a corrupt durable row', () => {
    const { repo, db } = harness();
    const job = admit(repo);
    const malformed = readyStatus() as unknown as Record<string, unknown>;
    delete (malformed.capabilities as Record<string, unknown>).histdata;
    db.prepare(`UPDATE research_environment_jobs
      SET state = 'succeeded', result_json = ?, finished_at = heartbeat_at
      WHERE job_id = ?`).run(JSON.stringify(malformed), job.jobId);

    expectCode(
      () => repo.findLatestTerminal(),
      RESEARCH_ENV_JOB_ERROR_CODES.CORRUPT_JOB_ROW,
    );
  });
});

describe('default identity factory', () => {
  // The default job id must be unique across processes sharing the table, so a
  // counter or timestamp would not do.
  it('mints distinct ids without an injected factory', () => {
    const db = openMigrated();
    const shared = adapt(db, []);
    const repo = new ResearchEnvironmentJobRepository({
      db: shared,
      instanceId: 'instance-a',
      parseStatus: parseResearchEnvironmentStatus,
      parsePersistedStatus: parsePersistedResearchEnvironmentStatus,
      parseFailure: value => researchEnvironmentFailureSchema.parse(value),
    });
    const first = admit(repo);
    repo.markFailed(first.jobId, installFailure());
    const second = admit(repo);
    expect(first.jobId).not.toBe(second.jobId);
    expect(first.jobId).toMatch(/^[0-9a-f-]{36}$/);
    // No pid injected: the diagnostics column stays absent rather than guessing.
    expect(first.ownerPid).toBeUndefined();
  });
});
