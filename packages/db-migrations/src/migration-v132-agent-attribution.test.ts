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

describe('migration v132 immutable local attribution and governance outbox', () => {
  it('creates the separate inference, governance, message, and delivery owners', () => {
    const database = openTestDatabase(':memory:');
    apply(database, 130);
    apply(database, 131);
    apply(database, 132);
    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'agent_%'
      ORDER BY name
    `).all();
    expect(tables).toEqual([
      { name: 'agent_governance_attribution' },
      { name: 'agent_governance_outbox_delivery' },
      { name: 'agent_governance_outbox_message' },
      { name: 'agent_inference_attribution' },
    ]);
    database.close();
  });

  it('pins provider-event uniqueness and append-only enforcement in SQLite', () => {
    const database = openTestDatabase(':memory:');
    apply(database, 130);
    apply(database, 131);
    apply(database, 132);
    expect(() => database.prepare(`
      INSERT INTO agent_inference_attribution (
        record_id, schema_version, subject_scope_hash, task_id, turn_id,
        admission_fingerprint, runtime_id, adapter_contract_version,
        native_version, protocol_version, entitlement_source, payer_class,
        provider_id, model_id, usage_json, status, started_at, recorded_at,
        record_json
      ) VALUES (
        'record-1', '1.0.0', ?, 'missing-task', 'turn-1', ?, 'stratcraft',
        '1', '1', '1', 'local', 'local', 'OLLAMA', 'model', '{}',
        'started', '2026-07-26T00:00:00.000Z',
        '2026-07-26T00:00:00.000Z', '{}'
      )
    `).run('a'.repeat(64), 'b'.repeat(64))).toThrow(/FOREIGN KEY/);
    database.close();
  });
});
