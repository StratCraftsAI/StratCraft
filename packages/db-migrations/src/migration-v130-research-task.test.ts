import type Database from 'better-sqlite3';
import { openTestDatabase } from './test-database';
import { describe, expect, it } from 'vitest';
import { EMBEDDED_MIGRATIONS_FOR_TEST } from './index';

function applyMigration130(database: Database.Database): void {
  const migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(({ version }) => version === 130);
  if (!migration) throw new Error('Migration 130 is missing.');
  if (typeof migration.up !== 'string') throw new Error('Migration 130 must be static SQL.');
  database.exec(migration.up);
}

describe('migration v130 research task ownership', () => {
  it('creates the canonical catalog, head, immutable task index, and foreign keys', () => {
    const database = openTestDatabase(':memory:');
    database.pragma('foreign_keys = ON');
    applyMigration130(database);
    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'research_task_%'
      ORDER BY name
    `).all();
    expect(tables).toEqual([
      { name: 'research_task_catalog_entry' },
      { name: 'research_task_catalog_head' },
      { name: 'research_task_index' },
      { name: 'research_task_selection' },
    ]);

    expect(() => database.prepare(`
      INSERT INTO research_task_catalog_head (kind, id, version)
      VALUES ('project', 'missing', '1')
    `).run()).toThrow(/FOREIGN KEY/);
    database.close();
  });

  it('enforces immutable catalog entries and task rows', () => {
    const database = openTestDatabase(':memory:');
    applyMigration130(database);
    const hash = 'a'.repeat(64);
    database.prepare(`
      INSERT INTO research_task_catalog_entry
        (kind, id, version, content_hash, payload_json)
      VALUES ('project', 'project-1', '1', ?, '{"allowedArtifactKinds":["strategy"]}')
    `).run(hash);
    expect(() => database.prepare(`
      UPDATE research_task_catalog_entry SET payload_json = '{}' WHERE id = 'project-1'
    `).run()).toThrow(/immutable/);
    expect(() => database.prepare(`
      DELETE FROM research_task_catalog_entry WHERE id = 'project-1'
    `).run()).toThrow(/immutable/);

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
        'task-1', '1', ?, 'subject-1', 'project-1',
        'strategy', 'workspace-1', '1', ?,
        '1', '2', 'acceptance-1', '1', ?, ?,
        'capability-1', '1', ?, 'research-1', '1', ?,
        'command-1', '1', ?
      )
    `).run(
      'b'.repeat(64),
      'c'.repeat(64),
      'd'.repeat(64),
      'e'.repeat(64),
      'f'.repeat(64),
      '1'.repeat(64),
      '2'.repeat(64),
    );
    database.prepare(`
      INSERT INTO research_task_selection (subject_id, task_id)
      VALUES ('subject-1', 'task-1')
    `).run();
    expect(database.prepare(`
      SELECT task_id FROM research_task_selection WHERE subject_id = 'subject-1'
    `).get()).toEqual({ task_id: 'task-1' });
    expect(() => database.prepare(`
      UPDATE research_task_index SET project_id = 'other' WHERE task_id = 'task-1'
    `).run()).toThrow(/immutable/);
    expect(() => database.prepare(`
      DELETE FROM research_task_index WHERE task_id = 'task-1'
    `).run()).toThrow(/immutable/);
    database.close();
  });

  it('rejects malformed hashes and unsupported Artifact kinds', () => {
    const database = openTestDatabase(':memory:');
    applyMigration130(database);
    expect(() => database.prepare(`
      INSERT INTO research_task_catalog_entry
        (kind, id, version, content_hash, payload_json)
      VALUES ('project', 'project-1', '1', 'BAD', '{}')
    `).run()).toThrow(/CHECK/);
    expect(() => database.prepare(`
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
        'task-1', '1', ?, 'subject-1', 'project-1',
        'python', 'workspace-1', '1', ?,
        '1', '2', 'acceptance-1', '1', ?, ?,
        'capability-1', '1', ?, 'research-1', '1', ?,
        'command-1', '1', ?
      )
    `).run(
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64),
      'd'.repeat(64),
      'e'.repeat(64),
      'f'.repeat(64),
      '1'.repeat(64),
    ))
      .toThrow(/CHECK/);
    database.close();
  });
});
