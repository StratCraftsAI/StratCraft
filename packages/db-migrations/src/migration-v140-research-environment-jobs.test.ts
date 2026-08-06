/**
 * TICKET_1335 D4: durable research-environment job store.
 *
 * The invariant under test is TICKET_1335 AC6/AC6a: at most one active job per
 * profile, enforced by the database rather than by whichever runtime happens to
 * ask first. These assertions run against real SQLite because a partial unique
 * index is exactly the kind of constraint that type-checks and then does not
 * exist.
 */

import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openTestDatabase } from './test-database';
import { EMBEDDED_MIGRATIONS_FOR_TEST } from './migrations';

const migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(item => item.version === 140)!;

const NOW = '2026-07-30T00:00:00.000Z';
const SHA = 'a'.repeat(64);

function openMigrated() {
  const db = openTestDatabase(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(migration.up as string);
  return db;
}

function insertJob(
  db: Database.Database,
  jobId: string,
  state: string,
  overrides: Partial<{ profile: string; operation: string; stage: string | null }> = {},
) {
  return db.prepare(
    `INSERT INTO research_environment_jobs
       (job_id, profile, operation, state, current_stage, manifest_sha256,
        lock_sha256, owner_instance_id, owner_pid, heartbeat_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jobId,
    overrides.profile ?? 'research-default',
    overrides.operation ?? 'install',
    state,
    overrides.stage === undefined ? 'admission' : overrides.stage,
    SHA, SHA, `owner-${jobId}`, 4242, NOW, NOW,
  );
}

describe('migration v140 research_environment_jobs', () => {
  it('creates the table with the documented columns', () => {
    const db = openMigrated();
    const columns = (db.prepare('PRAGMA table_info(research_environment_jobs)').all() as Array<{ name: string }>)
      .map(c => c.name);
    for (const expected of [
      'job_id', 'profile', 'operation', 'state', 'current_stage',
      'manifest_sha256', 'lock_sha256', 'owner_instance_id', 'owner_pid',
      'heartbeat_at', 'created_at', 'started_at', 'finished_at',
      'result_json', 'failure_json', 'log_tail',
    ]) {
      expect(columns).toContain(expected);
    }
    db.close();
  });

  describe('at most one active job per profile (AC6)', () => {
    it.each([
      ['queued', 'queued'],
      ['queued', 'running'],
      ['running', 'queued'],
      ['running', 'running'],
    ])('rejects a second %s job while one is %s', (first, second) => {
      const db = openMigrated();
      insertJob(db, 'job-1', first);
      expect(() => insertJob(db, 'job-2', second)).toThrow(/UNIQUE/i);
      db.close();
    });

    it('admits a new job only after the previous one reaches a terminal state', () => {
      const db = openMigrated();
      insertJob(db, 'job-1', 'running');
      expect(() => insertJob(db, 'job-2', 'running')).toThrow(/UNIQUE/i);

      db.prepare(
        `UPDATE research_environment_jobs SET state = 'failed', finished_at = ? WHERE job_id = 'job-1'`,
      ).run(NOW);

      expect(() => insertJob(db, 'job-2', 'running')).not.toThrow();
      db.close();
    });

    it('accumulates terminal history without constraint pressure', () => {
      const db = openMigrated();
      for (const [index, state] of ['succeeded', 'failed', 'succeeded', 'failed'].entries()) {
        insertJob(db, `job-${index}`, state);
      }
      const count = db.prepare('SELECT COUNT(*) AS n FROM research_environment_jobs').get() as { n: number };
      expect(count.n).toBe(4);
      db.close();
    });

    it('blocks a promotion that would create a second active job', () => {
      const db = openMigrated();
      insertJob(db, 'job-1', 'running');
      insertJob(db, 'job-2', 'failed');
      expect(() => db.prepare(
        `UPDATE research_environment_jobs SET state = 'running' WHERE job_id = 'job-2'`,
      ).run()).toThrow(/UNIQUE/i);
      db.close();
    });

    it('scopes the constraint to the profile, not the whole table', () => {
      // The index is per-profile by design. Only `research-default` exists
      // today (TICKET_1335 D1), so this proves the index key rather than a
      // second profile being supported.
      const db = openMigrated();
      insertJob(db, 'job-1', 'running');
      expect(() => insertJob(db, 'job-2', 'running', { profile: 'research-other' })).not.toThrow();
      db.close();
    });
  });

  describe('column checks reject illegal rows', () => {
    it('rejects an unknown operation', () => {
      const db = openMigrated();
      expect(() => insertJob(db, 'job-1', 'running', { operation: 'solve' })).toThrow(/CHECK/i);
      db.close();
    });

    it('rejects an unknown job state', () => {
      const db = openMigrated();
      expect(() => insertJob(db, 'job-1', 'cancelled')).toThrow(/CHECK/i);
      db.close();
    });

    it('rejects an unknown stage', () => {
      const db = openMigrated();
      expect(() => insertJob(db, 'job-1', 'running', { stage: 'solve' })).toThrow(/CHECK/i);
      db.close();
    });

    it.each(['admission', 'install', 'repair', 'python_verify', 'julia_verify'])(
      'accepts the %s stage',
      (stage) => {
        const db = openMigrated();
        expect(() => insertJob(db, `job-${stage}`, 'running', { stage })).not.toThrow();
        db.close();
      },
    );

    it('permits a null stage before admission assigns one', () => {
      const db = openMigrated();
      expect(() => insertJob(db, 'job-1', 'queued', { stage: null })).not.toThrow();
      db.close();
    });

    it('requires the bound manifest and lock hashes', () => {
      const db = openMigrated();
      expect(() => db.prepare(
        `INSERT INTO research_environment_jobs
           (job_id, profile, operation, state, manifest_sha256, lock_sha256,
            owner_instance_id, heartbeat_at, created_at)
         VALUES ('job-1', 'research-default', 'install', 'queued', NULL, ?, 'o', ?, ?)`,
      ).run(SHA, NOW, NOW)).toThrow(/NOT NULL/i);
      db.close();
    });

    it('requires an owner instance id, which is never a PID', () => {
      const db = openMigrated();
      expect(() => db.prepare(
        `INSERT INTO research_environment_jobs
           (job_id, profile, operation, state, manifest_sha256, lock_sha256,
            owner_instance_id, heartbeat_at, created_at)
         VALUES ('job-1', 'research-default', 'install', 'queued', ?, ?, NULL, ?, ?)`,
      ).run(SHA, SHA, NOW, NOW)).toThrow(/NOT NULL/i);

      // owner_pid stays nullable: TICKET_1335 D4 keeps it as diagnostics only.
      const pidColumn = (db.prepare('PRAGMA table_info(research_environment_jobs)').all() as Array<{ name: string; notnull: number }>)
        .find(c => c.name === 'owner_pid')!;
      expect(pidColumn.notnull).toBe(0);
      db.close();
    });
  });

  describe('crash reconciliation shape (AC6a)', () => {
    it('lets an orphaned active row transition to a terminal failure', () => {
      const db = openMigrated();
      insertJob(db, 'job-1', 'running');
      db.prepare(
        `UPDATE research_environment_jobs
            SET state = 'failed', finished_at = ?, failure_json = ?
          WHERE job_id = 'job-1'`,
      ).run(NOW, JSON.stringify({ category: 'operation_interrupted', cause: 'process_lost' }));

      const row = db.prepare(
        `SELECT state, failure_json FROM research_environment_jobs WHERE job_id = 'job-1'`,
      ).get() as { state: string; failure_json: string };
      expect(row.state).toBe('failed');
      expect(JSON.parse(row.failure_json).cause).toBe('process_lost');
      db.close();
    });

    it('exposes heartbeat and owner identity for lease inspection', () => {
      const db = openMigrated();
      insertJob(db, 'job-1', 'running');
      const row = db.prepare(
        `SELECT owner_instance_id, heartbeat_at FROM research_environment_jobs WHERE job_id = 'job-1'`,
      ).get() as { owner_instance_id: string; heartbeat_at: string };
      expect(row.owner_instance_id).toBe('owner-job-1');
      expect(row.heartbeat_at).toBe(NOW);
      db.close();
    });
  });

  it('reverses cleanly and can be reapplied', () => {
    const db = openMigrated();
    insertJob(db, 'job-1', 'running');
    db.exec(migration.down as string);

    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'research_environment_jobs'`,
    ).all();
    expect(tables).toHaveLength(0);

    db.exec(migration.up as string);
    expect(() => insertJob(db, 'job-1', 'running')).not.toThrow();
    db.close();
  });
});
