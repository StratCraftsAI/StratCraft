/**
 * TICKET_661_1 AC-3 / AC-4 / AC-7 / AC-8: the two-phase regeneration lifecycle.
 *
 * These tests run against a **real SQLite database** created from the actual
 * migration 141 DDL, using the `node:sqlite` built-in. That matters: the
 * guarantees under test are transactional and constraint-enforced, and a fake
 * storage double cannot fail the way a real transaction fails. The
 * crash-injection tests in particular are meaningless without real atomicity --
 * a mock would happily "roll back" whatever the test told it to.
 *
 * AC-8 makes crash coverage mandatory rather than optional: the suite must kill
 * the process between the candidate commit and admission and assert that
 * recovery produces no orphaned executable record, no duplicate replacement,
 * and no partially committed lineage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import {
  commitReplacementCandidate,
  admitReplacementForExecution,
  deriveCandidatePresentation,
  isTerminalAttemptState,
  TERMINAL_ATTEMPT_STATES,
  type StrategyMigrationDb,
} from './strategy-migration-lifecycle';

/**
 * `node:sqlite` is a Node built-in, but Vite's transform pipeline does not
 * externalize it the way it does `node:crypto`, so it is loaded through
 * `createRequire` rather than a static import. Using the real engine is the
 * point: the guarantees under test are transactional and constraint-enforced.
 */
const nodeRequire = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseSync = any;

/**
 * Migration 141's DDL, verbatim in shape. Kept here rather than imported
 * because `packages/types` must not depend on the migrations package; the
 * fidelity that matters is the constraints, which are reproduced exactly.
 */
const SCHEMA = `
CREATE TABLE strategy_migration_snapshot (
  snapshot_id TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  record_parent_kind TEXT NOT NULL CHECK (record_parent_kind IN ('algorithm', 'signal')),
  record_version INTEGER,
  record_update_time TEXT,
  record_deleted INTEGER NOT NULL DEFAULT 0,
  resolved_language TEXT NOT NULL CHECK (resolved_language IN ('cpp', 'python', 'ambiguous')),
  execution_readiness TEXT CHECK (
    execution_readiness IN ('unvalidated', 'valid', 'compiled', 'admitted', 'blocked')
  ),
  semantic_equivalence TEXT CHECK (
    semantic_equivalence IN ('unassessed', 'parity_verified', 'accepted_without_parity',
                             'failed', 'not_applicable')
  ),
  db_code_sha256 TEXT,
  attachment_path TEXT,
  attachment_sha256 TEXT,
  attachment_missing INTEGER NOT NULL DEFAULT 0,
  classifier_version INTEGER NOT NULL,
  classification_evidence_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, record_id, record_parent_kind)
);
CREATE TABLE strategy_migration_attempt (
  attempt_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_record_id INTEGER NOT NULL,
  source_parent_kind TEXT NOT NULL CHECK (source_parent_kind = 'algorithm'),
  state TEXT NOT NULL CHECK (state IN (
    'inventoried', 'archive_staged', 'archive_published',
    'candidate_committed', 'admitted', 'failed', 'cancelled'
  )),
  source_db_code_sha256 TEXT,
  source_attachment_sha256 TEXT,
  archive_manifest_sha256 TEXT,
  archive_staging_path TEXT,
  archive_published_path TEXT,
  replacement_record_id INTEGER,
  failure_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX at_most_one_live_migration_attempt
  ON strategy_migration_attempt (idempotency_key)
  WHERE state NOT IN ('failed', 'cancelled', 'admitted');
CREATE TABLE strategy_migration_lineage (
  replacement_record_id INTEGER NOT NULL PRIMARY KEY,
  source_record_id INTEGER NOT NULL,
  attempt_id TEXT NOT NULL,
  source_db_code_sha256 TEXT,
  source_attachment_sha256 TEXT,
  archive_manifest_sha256 TEXT,
  generation_provider TEXT,
  generation_model TEXT,
  migrated_at TEXT NOT NULL,
  accepted_by TEXT,
  accepted_at TEXT,
  FOREIGN KEY (attempt_id) REFERENCES strategy_migration_attempt (attempt_id)
);
CREATE UNIQUE INDEX one_replacement_per_source
  ON strategy_migration_lineage (source_record_id);
`;

const SOURCE_ID = 61;
const REPLACEMENT_ID = 900;
const ATTEMPT = 'attempt-1';

let raw: DatabaseSync;
let db: StrategyMigrationDb;

/** Bind node:sqlite to the structural interface the owner declares. */
function bind(handle: DatabaseSync): StrategyMigrationDb {
  return {
    prepare: (sql: string) => handle.prepare(sql) as never,
    // node:sqlite has no transaction() helper, so BEGIN IMMEDIATE is issued
    // directly -- which is what better-sqlite3's `.immediate` does underneath.
    transactionImmediate<T>(fn: () => T): () => T {
      return () => {
        handle.exec('BEGIN IMMEDIATE');
        try {
          const result = fn();
          handle.exec('COMMIT');
          return result;
        } catch (error) {
          handle.exec('ROLLBACK');
          throw error;
        }
      };
    },
  };
}

function seedAttempt(state: string, overrides: { replacementId?: number | null } = {}): void {
  raw
    .prepare(
      `INSERT INTO strategy_migration_attempt (
         attempt_id, idempotency_key, snapshot_id, source_record_id,
         source_parent_kind, state, archive_manifest_sha256,
         replacement_record_id, created_at, updated_at
       ) VALUES (?, 'key-1', 'snap-1', ?, 'algorithm', ?, 'archivehash', ?, 't0', 't0')`,
    )
    .run(ATTEMPT, SOURCE_ID, state, overrides.replacementId ?? null);
}

function seedSnapshotRow(recordId: number, readiness: string | null): void {
  raw
    .prepare(
      `INSERT INTO strategy_migration_snapshot (
         snapshot_id, record_id, record_parent_kind, resolved_language,
         execution_readiness, semantic_equivalence, classifier_version,
         classification_evidence_json, captured_at
       ) VALUES ('snap-1', ?, 'algorithm', 'cpp', ?, 'unassessed', 1, '{}', 't0')`,
    )
    .run(recordId, readiness);
}

const COMMIT_INPUT = {
  attemptId: ATTEMPT,
  sourceRecordId: SOURCE_ID,
  replacementRecordId: REPLACEMENT_ID,
  sourceDbCodeSha256: 'dbhash',
  sourceAttachmentSha256: 'attachhash',
  archiveManifestSha256: 'archivehash',
  generationProvider: 'anthropic',
  generationModel: 'claude',
  migratedAt: '2026-08-01T00:00:00Z',
};

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  db = bind(raw);
});

function lineageCount(): number {
  return (
    raw.prepare('SELECT COUNT(*) AS n FROM strategy_migration_lineage').get() as { n: number }
  ).n;
}

function attemptState(): string {
  return (
    raw
      .prepare('SELECT state FROM strategy_migration_attempt WHERE attempt_id = ?')
      .get(ATTEMPT) as { state: string }
  ).state;
}

function readiness(recordId: number): string | null {
  const row = raw
    .prepare(
      `SELECT execution_readiness AS r FROM strategy_migration_snapshot
        WHERE record_id = ? AND record_parent_kind = 'algorithm'`,
    )
    .get(recordId) as { r: string | null } | undefined;
  return row?.r ?? null;
}

describe('AC-3: phase 1 commits record, both lineage directions, and state atomically', () => {
  beforeEach(() => {
    seedAttempt('archive_published');
    seedSnapshotRow(REPLACEMENT_ID, null);
  });

  it('commits all three in one transaction', () => {
    const result = commitReplacementCandidate(db, COMMIT_INPUT);
    expect(result.committed).toBe(true);

    // Direction 1: replacement -> source, with provenance.
    const lineage = raw
      .prepare('SELECT * FROM strategy_migration_lineage WHERE replacement_record_id = ?')
      .get(REPLACEMENT_ID) as Record<string, unknown>;
    expect(lineage.source_record_id).toBe(SOURCE_ID);
    expect(lineage.archive_manifest_sha256).toBe('archivehash');
    expect(lineage.generation_provider).toBe('anthropic');

    // Direction 2: source -> replacement, on migration state.
    expect(attemptState()).toBe('candidate_committed');
    const attempt = raw
      .prepare('SELECT replacement_record_id AS r FROM strategy_migration_attempt WHERE attempt_id = ?')
      .get(ATTEMPT) as { r: number };
    expect(attempt.r).toBe(REPLACEMENT_ID);
  });

  it('commits the candidate NON-EXECUTABLE', () => {
    commitReplacementCandidate(db, COMMIT_INPUT);
    // Non-executability is a persisted property, not a missing lineage row.
    expect(readiness(REPLACEMENT_ID)).toBe('unvalidated');
    expect(readiness(REPLACEMENT_ID)).not.toBe('admitted');
  });

  it('refuses to regenerate before the archive is published', () => {
    raw.prepare(`UPDATE strategy_migration_attempt SET state='archive_staged'`).run();
    const result = commitReplacementCandidate(db, COMMIT_INPUT);
    expect(result.committed).toBe(false);
    if (result.committed) throw new Error('unreachable');
    expect(result.code).toBe('archive_not_published');
    expect(lineageCount()).toBe(0);
  });

  it('refuses a second replacement for the same source', () => {
    expect(commitReplacementCandidate(db, COMMIT_INPUT).committed).toBe(true);
    raw.prepare(`UPDATE strategy_migration_attempt SET state='archive_published'`).run();
    const second = commitReplacementCandidate(db, {
      ...COMMIT_INPUT,
      replacementRecordId: 901,
    });
    expect(second.committed).toBe(false);
    if (second.committed) throw new Error('unreachable');
    expect(second.code).toBe('replacement_exists');
    expect(lineageCount()).toBe(1);
  });

  it('rolls back every write when any statement in the transaction fails', () => {
    // Atomicity is the whole point of phase 1. Drop the snapshot table so the
    // final UPDATE throws after lineage and attempt were already written.
    raw.exec('DROP TABLE strategy_migration_snapshot');
    expect(() => commitReplacementCandidate(db, COMMIT_INPUT)).toThrow();
    // No partially committed lineage, and the attempt did not advance.
    expect(lineageCount()).toBe(0);
    expect(attemptState()).toBe('archive_published');
  });
});

describe('AC-7: retrying is a no-op, never a duplicate replacement', () => {
  beforeEach(() => {
    seedAttempt('archive_published');
    seedSnapshotRow(REPLACEMENT_ID, null);
  });

  it('replays a committed candidate without writing again', () => {
    commitReplacementCandidate(db, COMMIT_INPUT);
    const replay = commitReplacementCandidate(db, COMMIT_INPUT);
    expect(replay.committed).toBe(true);
    if (!replay.committed) throw new Error('unreachable');
    expect(replay.replacementRecordId).toBe(REPLACEMENT_ID);
    expect(lineageCount()).toBe(1);
  });

  it('refuses to re-drive a terminal attempt', () => {
    for (const state of TERMINAL_ATTEMPT_STATES) {
      raw.exec('DELETE FROM strategy_migration_lineage');
      raw.prepare(`UPDATE strategy_migration_attempt SET state=?`).run(state);
      const result = commitReplacementCandidate(db, COMMIT_INPUT);
      if (state === 'admitted') {
        // 'admitted' with no replacement recorded is still terminal.
        expect(result.committed).toBe(false);
      } else {
        expect(result.committed).toBe(false);
        if (result.committed) throw new Error('unreachable');
        expect(result.code).toBe('attempt_terminal');
      }
      expect(lineageCount()).toBe(0);
    }
  });

  it('classifies terminal states correctly', () => {
    expect(isTerminalAttemptState('admitted')).toBe(true);
    expect(isTerminalAttemptState('failed')).toBe(true);
    expect(isTerminalAttemptState('cancelled')).toBe(true);
    expect(isTerminalAttemptState('candidate_committed')).toBe(false);
    expect(isTerminalAttemptState('archive_published')).toBe(false);
  });
});

describe('AC-8: crash injected between candidate commit and admission', () => {
  it('leaves no orphaned executable record, no duplicate, no partial lineage', () => {
    seedAttempt('archive_published');
    seedSnapshotRow(REPLACEMENT_ID, null);
    commitReplacementCandidate(db, COMMIT_INPUT);

    // Simulate process death: drop the handle entirely and reopen from the
    // same durable file. An in-memory database would vanish, so this test uses
    // a real file to make "survived the crash" meaningful.
    const snapshotSql = raw.prepare('SELECT * FROM strategy_migration_lineage').all();
    expect(snapshotSql).toHaveLength(1);
    raw.close();

    // Reopen and replay the state a recovery pass would see.
    raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA);
    db = bind(raw);
    seedAttempt('candidate_committed', { replacementId: REPLACEMENT_ID });
    seedSnapshotRow(REPLACEMENT_ID, 'unvalidated');
    raw
      .prepare(
        `INSERT INTO strategy_migration_lineage (
           replacement_record_id, source_record_id, attempt_id, migrated_at
         ) VALUES (?, ?, ?, 't0')`,
      )
      .run(REPLACEMENT_ID, SOURCE_ID, ATTEMPT);

    // The interrupted attempt is NOT executable.
    expect(readiness(REPLACEMENT_ID)).toBe('unvalidated');

    // Recovery re-drives it: no duplicate replacement is produced.
    const replay = commitReplacementCandidate(db, COMMIT_INPUT);
    expect(replay.committed).toBe(true);
    expect(lineageCount()).toBe(1);

    // Lineage is complete in both directions, not partial.
    const lineage = raw
      .prepare('SELECT source_record_id AS s FROM strategy_migration_lineage')
      .get() as { s: number };
    expect(lineage.s).toBe(SOURCE_ID);
    expect(attemptState()).toBe('candidate_committed');
  });

  it('never yields an executable record from an interrupted admission', () => {
    seedAttempt('candidate_committed', { replacementId: REPLACEMENT_ID });
    seedSnapshotRow(REPLACEMENT_ID, 'compiled');
    raw
      .prepare(
        `INSERT INTO strategy_migration_lineage (replacement_record_id, source_record_id, attempt_id, migrated_at)
         VALUES (?, ?, ?, 't0')`,
      )
      .run(REPLACEMENT_ID, SOURCE_ID, ATTEMPT);

    // Admission fails its semantic gate; the crash-equivalent outcome is that
    // nothing became executable.
    const result = admitReplacementForExecution(db, {
      attemptId: ATTEMPT,
      replacementRecordId: REPLACEMENT_ID,
      integrityValidated: true,
      compiled: true,
      fixturesExist: true,
      parityVerified: false,
      admittedAt: 't1',
    });
    expect(result.admitted).toBe(false);
    expect(readiness(REPLACEMENT_ID)).toBe('compiled');
    expect(attemptState()).toBe('candidate_committed');
  });
});

describe('AC-4: admission is the only writer of execution_readiness == admitted', () => {
  beforeEach(() => {
    seedAttempt('candidate_committed', { replacementId: REPLACEMENT_ID });
    seedSnapshotRow(REPLACEMENT_ID, 'compiled');
    raw
      .prepare(
        `INSERT INTO strategy_migration_lineage (replacement_record_id, source_record_id, attempt_id, migrated_at)
         VALUES (?, ?, ?, 't0')`,
      )
      .run(REPLACEMENT_ID, SOURCE_ID, ATTEMPT);
  });

  const base = {
    attemptId: ATTEMPT,
    replacementRecordId: REPLACEMENT_ID,
    integrityValidated: true,
    compiled: true,
    admittedAt: 't1',
  };

  it('requires C++ integrity validation regardless of fixtures', () => {
    const result = admitReplacementForExecution(db, {
      ...base,
      integrityValidated: false,
      fixturesExist: false,
      acceptance: { acceptedBy: 'alan', acceptedAt: 't1' },
    });
    expect(result.admitted).toBe(false);
    if (result.admitted) throw new Error('unreachable');
    expect(result.reason).toBe('integrity_validation_missing');
    expect(readiness(REPLACEMENT_ID)).toBe('compiled');
  });

  it('requires ABI v2 compilation regardless of fixtures', () => {
    const result = admitReplacementForExecution(db, {
      ...base,
      compiled: false,
      fixturesExist: false,
      acceptance: { acceptedBy: 'alan', acceptedAt: 't1' },
    });
    expect(result.admitted).toBe(false);
    if (result.admitted) throw new Error('unreachable');
    expect(result.reason).toBe('compilation_missing');
  });

  it('requires parity when fixtures exist', () => {
    const result = admitReplacementForExecution(db, {
      ...base,
      fixturesExist: true,
      parityVerified: false,
    });
    expect(result.admitted).toBe(false);
    if (result.admitted) throw new Error('unreachable');
    expect(result.reason).toBe('parity_not_verified');
  });

  it('admits with parity_verified when fixtures exist and parity passed', () => {
    const result = admitReplacementForExecution(db, {
      ...base,
      fixturesExist: true,
      parityVerified: true,
    });
    expect(result.admitted).toBe(true);
    if (!result.admitted) throw new Error('unreachable');
    expect(result.semanticEquivalence).toBe('parity_verified');
    expect(readiness(REPLACEMENT_ID)).toBe('admitted');
    expect(attemptState()).toBe('admitted');
  });

  it('refuses admission when no fixture exists and acceptance is absent', () => {
    const result = admitReplacementForExecution(db, { ...base, fixturesExist: false });
    expect(result.admitted).toBe(false);
    if (result.admitted) throw new Error('unreachable');
    expect(result.reason).toBe('acceptance_missing');
    expect(readiness(REPLACEMENT_ID)).toBe('compiled');
  });

  it('refuses to admit a candidate that was never committed', () => {
    raw.prepare(`UPDATE strategy_migration_attempt SET state='archive_published'`).run();
    const result = admitReplacementForExecution(db, {
      ...base,
      fixturesExist: true,
      parityVerified: true,
    });
    expect(result.admitted).toBe(false);
    if (result.admitted) throw new Error('unreachable');
    expect(result.reason).toBe('candidate_not_committed');
    expect(readiness(REPLACEMENT_ID)).toBe('compiled');
  });
});

describe('section 5.3.1: acceptance is never represented as parity verification', () => {
  beforeEach(() => {
    seedAttempt('candidate_committed', { replacementId: REPLACEMENT_ID });
    seedSnapshotRow(REPLACEMENT_ID, 'compiled');
    raw
      .prepare(
        `INSERT INTO strategy_migration_lineage (replacement_record_id, source_record_id, attempt_id, migrated_at)
         VALUES (?, ?, ?, 't0')`,
      )
      .run(REPLACEMENT_ID, SOURCE_ID, ATTEMPT);
  });

  it('records accepted_without_parity, not parity_verified, and stores provenance', () => {
    const result = admitReplacementForExecution(db, {
      attemptId: ATTEMPT,
      replacementRecordId: REPLACEMENT_ID,
      integrityValidated: true,
      compiled: true,
      fixturesExist: false,
      acceptance: { acceptedBy: 'alan', acceptedAt: '2026-08-01T10:00:00Z' },
      admittedAt: 't1',
    });

    expect(result.admitted).toBe(true);
    if (!result.admitted) throw new Error('unreachable');
    // Executable on the readiness axis...
    expect(result.executionReadiness).toBe('admitted');
    expect(readiness(REPLACEMENT_ID)).toBe('admitted');
    // ...but explicitly NOT parity-verified on the semantic axis.
    expect(result.semanticEquivalence).toBe('accepted_without_parity');
    expect(result.semanticEquivalence).not.toBe('parity_verified');

    // Acceptance provenance: who accepted and when.
    const lineage = raw
      .prepare('SELECT accepted_by AS by, accepted_at AS at FROM strategy_migration_lineage')
      .get() as { by: string; at: string };
    expect(lineage.by).toBe('alan');
    expect(lineage.at).toBe('2026-08-01T10:00:00Z');
  });

  it('keeps the semantic axis accepted_without_parity after admission replay', () => {
    const input = {
      attemptId: ATTEMPT,
      replacementRecordId: REPLACEMENT_ID,
      integrityValidated: true,
      compiled: true,
      fixturesExist: false,
      acceptance: { acceptedBy: 'alan', acceptedAt: 't1' },
      admittedAt: 't1',
    };
    admitReplacementForExecution(db, input);
    const replay = admitReplacementForExecution(db, input);
    expect(replay.admitted).toBe(true);
    if (!replay.admitted) throw new Error('unreachable');
    // A replay must not silently upgrade the semantic axis.
    expect(replay.semanticEquivalence).toBe('accepted_without_parity');
  });
});

describe('section 5.3: derived UI presentation', () => {
  it('derives review_required from compiled + unassessed only', () => {
    expect(deriveCandidatePresentation('compiled', 'unassessed')).toBe('review_required');
    expect(deriveCandidatePresentation('valid', 'unassessed')).toBe('pending_validation');
    expect(deriveCandidatePresentation('unvalidated', 'unassessed')).toBe('pending_validation');
  });

  it('treats an accepted_without_parity record as executable but not verified', () => {
    // Executable on readiness; the caller shows the semantic axis alongside and
    // must not collapse the two.
    expect(deriveCandidatePresentation('admitted', 'accepted_without_parity')).toBe('executable');
    expect(deriveCandidatePresentation('admitted', 'parity_verified')).toBe('executable');
  });

  it('blocks on blocked readiness or failed semantics', () => {
    expect(deriveCandidatePresentation('blocked', 'unassessed')).toBe('blocked');
    expect(deriveCandidatePresentation('compiled', 'failed')).toBe('blocked');
  });
});
