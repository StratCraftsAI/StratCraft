import type Database from 'better-sqlite3';
import { openTestDatabase } from './test-database';
import { describe, expect, it } from 'vitest';
import { EMBEDDED_MIGRATIONS_FOR_TEST } from './index';

function apply(database: Database.Database, version: number): void {
  const migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(item => item.version === version);
  if (!migration || typeof migration.up !== 'string') {
    throw new Error(`Static migration ${version} is missing.`);
  }
  database.exec(migration.up);
}

function seedTask(database: Database.Database): void {
  const hash = (character: string) => character.repeat(64);
  database.prepare(`
    INSERT INTO research_task_index (
      task_id, task_spec_version, task_spec_hash, subject_id, project_id,
      artifact_kind, workspace_id, workspace_version, workspace_content_hash,
      workspace_root_device, workspace_root_file_identity,
      acceptance_profile_id, acceptance_profile_version,
      acceptance_profile_content_hash, data_capability_content_hash,
      capability_profile_id, capability_profile_version,
      capability_profile_content_hash, research_policy_id,
      research_policy_version, research_policy_content_hash,
      command_policy_id, command_policy_version, command_policy_content_hash
    ) VALUES (
      'task-1', '1', ?, 'subject-1', 'project-1', 'strategy',
      'workspace-1', '1', ?, '1', '2', 'acceptance-1', '1', ?, ?,
      'capability-1', '1', ?, 'research-1', '1', ?,
      'command-1', '1', ?
    )
  `).run(
    hash('a'), hash('b'), hash('c'), hash('d'),
    hash('e'), hash('f'), hash('1'),
  );
}

describe('migration v131 deterministic Artifact admission registry', () => {
  it('creates normalized admission, Artifact, evidence, provenance, and link owners', () => {
    const database = openTestDatabase(':memory:');
    database.pragma('foreign_keys = ON');
    apply(database, 130);
    apply(database, 131);
    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND (
        name LIKE 'artifact_%' OR name = 'artifact_registry'
      )
      ORDER BY name
    `).all();
    expect(tables).toEqual([
      { name: 'artifact_admission_attempt' },
      { name: 'artifact_admission_stage_result' },
      { name: 'artifact_canonical_link' },
      { name: 'artifact_evidence_reference' },
      { name: 'artifact_provenance_edge' },
      { name: 'artifact_registry' },
    ]);
    database.close();
  });

  it('enforces task ownership, idempotency, stage order, and immutable accepted rows', () => {
    const database = openTestDatabase(':memory:');
    database.pragma('foreign_keys = ON');
    apply(database, 130);
    apply(database, 131);
    seedTask(database);
    const hash = 'a'.repeat(64);
    database.prepare(`
      INSERT INTO artifact_admission_attempt (
        admission_result_id, task_id, candidate_id, candidate_content_hash,
        turn_admission_fingerprint, acceptance_profile_id,
        acceptance_profile_version, acceptance_profile_content_hash,
        gate_plan_json, status, started_at
      ) VALUES (
        'result-1', 'task-1', 'candidate-1', ?, ?,
        'acceptance-1', '1', ?, '["contract","security"]',
        'running', '2026-07-26T00:00:00.000Z'
      )
    `).run(hash, 'b'.repeat(64), 'c'.repeat(64));
    expect(() => database.prepare(`
      INSERT INTO artifact_admission_attempt (
        admission_result_id, task_id, candidate_id, candidate_content_hash,
        turn_admission_fingerprint, acceptance_profile_id,
        acceptance_profile_version, acceptance_profile_content_hash,
        gate_plan_json, status, started_at
      ) VALUES (
        'result-2', 'task-1', 'candidate-2', ?, ?,
        'acceptance-1', '1', ?, '[]', 'running', 'now'
      )
    `).run(hash, 'b'.repeat(64), 'c'.repeat(64))).toThrow(/UNIQUE/);
    expect(() => database.prepare(`
      INSERT INTO artifact_admission_stage_result (
        admission_result_id, stage_ordinal, stage, status,
        diagnostics_json, evidence_json, started_at, completed_at
      ) VALUES ('result-1', 8, 'contract', 'passed', '[]', '[]', 'now', 'now')
    `).run()).toThrow(/CHECK/);

    const manifest = JSON.stringify({ artifactId: 'artifact-1' });
    database.prepare(`
      INSERT INTO artifact_registry (
        artifact_id, artifact_kind, root_content_hash, candidate_content_hash,
        admission_result_id, task_id, manifest_json, accepted_at
      ) VALUES (
        'artifact-1', 'strategy', ?, ?, 'result-1', 'task-1', ?, 'now'
      )
    `).run('d'.repeat(64), hash, manifest);
    expect(() => database.prepare(`
      UPDATE artifact_registry SET manifest_json = '{}'
      WHERE artifact_id = 'artifact-1'
    `).run()).toThrow(/immutable/);
    expect(() => database.prepare(`
      DELETE FROM artifact_registry WHERE artifact_id = 'artifact-1'
    `).run()).toThrow(/immutable/);
    database.close();
  });
});
