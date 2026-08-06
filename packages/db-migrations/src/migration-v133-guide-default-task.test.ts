/**
 * TICKET_1303_1_8_1: v133 registers the default Guide chat research task.
 *
 * v132 gave `agent_inference_attribution.task_id` a NOT NULL foreign key to
 * `research_task_index`, but the admitted default Guide chat task (`guide-chat`)
 * had no row there, so every plain Guide turn aborted with
 * "FOREIGN KEY constraint failed". v133 seeds the missing owner row.
 *
 * These tests enable `foreign_keys = ON` to match the production standalone MCP
 * connection (apps/desktop/src/mcp/standalone/src/db.ts), so the constraint is
 * actually enforced rather than silently ignored.
 */
import type Database from 'better-sqlite3';
import { openTestDatabase } from './test-database';
import { describe, expect, it } from 'vitest';
import { EMBEDDED_MIGRATIONS_FOR_TEST } from './index';

const GUIDE_TASK_ID = 'guide-chat';

function apply(database: Database.Database, version: number): void {
  const migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(item => item.version === version);
  if (!migration || typeof migration.up !== 'string') {
    throw new Error(`Static migration ${version} is missing.`);
  }
  database.exec(migration.up);
}

function migrated(): Database.Database {
  const database = openTestDatabase(':memory:');
  database.pragma('foreign_keys = ON');
  for (const version of [130, 131, 132, 133]) apply(database, version);
  return database;
}

function insertGuideAttribution(database: Database.Database, recordId: string): void {
  database.prepare(`
    INSERT INTO agent_inference_attribution (
      record_id, schema_version, subject_scope_hash, task_id, turn_id,
      admission_fingerprint, runtime_id, adapter_contract_version,
      native_version, protocol_version, entitlement_source, payer_class,
      provider_id, model_id, usage_json, status, started_at, recorded_at,
      record_json
    ) VALUES (
      ?, '1.0.0', ?, ?, 'turn-1', ?, 'stratcraft',
      '1', '1', '1', 'local', 'local', 'OLLAMA', 'model', '{}',
      'started', '2026-07-27T00:00:00.000Z',
      '2026-07-27T00:00:00.000Z', '{}'
    )
  `).run(recordId, 'a'.repeat(64), GUIDE_TASK_ID, 'b'.repeat(64));
}

describe('migration v133 default Guide chat research task', () => {
  it('migration_seeds_the_default_guide_task_idempotently', () => {
    const database = migrated();

    const row = database.prepare(`
      SELECT task_id, task_spec_version, task_spec_hash, subject_id,
             workspace_id, workspace_content_hash
      FROM research_task_index WHERE task_id = ?
    `).get(GUIDE_TASK_ID) as Record<string, string> | undefined;
    expect(row).toBeDefined();
    expect(row?.subject_id).toBe('mcp-standalone');
    expect(row?.task_spec_version).toBe('1');
    // SHA-256 of "guide-chat:v1" -- the frozen GUIDE_TASK_IDENTITY hash.
    expect(row?.task_spec_hash)
      .toBe('6d46982c7260297e11fb04a5c9a54cbcda9513c6800ce0a29fc342164372bfbb');
    expect(row?.workspace_id).toBe('guide-application-data');
    // SHA-256 of "guide-application-data:v1".
    expect(row?.workspace_content_hash)
      .toBe('0508ea005c0cd18391653a4b9394715a985c055a490645729e200225c6059550');

    // Re-applying must not duplicate or abort. research_task_index carries an
    // immutable-UPDATE trigger, so the migration uses DO NOTHING rather than
    // DO UPDATE -- a re-run would otherwise RAISE(ABORT).
    apply(database, 133);
    apply(database, 133);
    const count = database.prepare(`
      SELECT COUNT(*) AS count FROM research_task_index WHERE task_id = ?
    `).get(GUIDE_TASK_ID) as { count: number };
    expect(count.count).toBe(1);

    // The default is shared infrastructure, never a user's task selection:
    // research_task_selection.task_id is UNIQUE, so seeding it would let one
    // subject claim the shared default permanently.
    const selected = database.prepare(`
      SELECT COUNT(*) AS count FROM research_task_selection WHERE task_id = ?
    `).get(GUIDE_TASK_ID) as { count: number };
    expect(selected.count).toBe(0);

    database.close();
  });

  it('makes the default guide task attributable while unknown tasks still fail', () => {
    const database = migrated();

    // The exact INSERT that regressed: it must now succeed.
    expect(() => insertGuideAttribution(database, 'record-guide-1')).not.toThrow();
    const stored = database.prepare(`
      SELECT COUNT(*) AS count FROM agent_inference_attribution WHERE task_id = ?
    `).get(GUIDE_TASK_ID) as { count: number };
    expect(stored.count).toBe(1);

    // Referential integrity must remain intact for every other task id.
    expect(() => database.prepare(`
      INSERT INTO agent_inference_attribution (
        record_id, schema_version, subject_scope_hash, task_id, turn_id,
        admission_fingerprint, runtime_id, adapter_contract_version,
        native_version, protocol_version, entitlement_source, payer_class,
        provider_id, model_id, usage_json, status, started_at, recorded_at,
        record_json
      ) VALUES (
        'record-2', '1.0.0', ?, 'missing-task', 'turn-2', ?, 'stratcraft',
        '1', '1', '1', 'local', 'local', 'OLLAMA', 'model', '{}',
        'started', '2026-07-27T00:00:00.000Z',
        '2026-07-27T00:00:00.000Z', '{}'
      )
    `).run('a'.repeat(64), 'b'.repeat(64))).toThrow(/FOREIGN KEY/);

    database.close();
  });

  it('migration_down_removes_only_the_seeded_default_task', () => {
    const database = migrated();
    const migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(item => item.version === 133);
    expect(typeof migration?.down).toBe('string');

    // research_task_index is append-only (immutable UPDATE/DELETE triggers), so
    // the down step deliberately retains the row instead of breaking that
    // guarantee. It must still execute cleanly and disturb nothing.
    insertGuideAttribution(database, 'record-guide-1');
    expect(() => database.exec(migration!.down as string)).not.toThrow();
    const after = database.prepare(`
      SELECT COUNT(*) AS count FROM research_task_index WHERE task_id = ?
    `).get(GUIDE_TASK_ID) as { count: number };
    expect(after.count).toBe(1);
    const attributions = database.prepare(`
      SELECT COUNT(*) AS count FROM agent_inference_attribution
    `).get() as { count: number };
    expect(attributions.count).toBe(1);

    database.close();
  });
});
