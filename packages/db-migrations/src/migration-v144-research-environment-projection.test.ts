import { describe, expect, it } from 'vitest';

import { EMBEDDED_MIGRATIONS_FOR_TEST } from './migrations';
import { openTestDatabase } from './test-database';

const SHA = 'a'.repeat(64);
const NOW = '2026-08-04T00:00:00.000Z';

function database() {
  const db = openTestDatabase(':memory:');
  for (const version of [140, 142, 143]) {
    const migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(item => item.version === version)!;
    db.exec(migration.up as string);
  }
  return db;
}

function insertResult(db: ReturnType<typeof database>, jobId: string, result: string | null): void {
  db.prepare(`INSERT INTO research_environment_jobs
    (job_id, profile, operation, state, current_stage, manifest_sha256, lock_sha256,
     owner_instance_id, heartbeat_at, created_at, result_json)
    VALUES (?, 'research-default', 'install', 'succeeded', 'python_verify', ?, ?,
            'owner', ?, ?, ?)`)
    .run(jobId, SHA, SHA, NOW, NOW, result);
}

function result(db: ReturnType<typeof database>, jobId: string): string | null {
  return (db.prepare(
    'SELECT result_json FROM research_environment_jobs WHERE job_id = ?',
  ).get(jobId) as { result_json: string | null }).result_json;
}

describe('migration v144 research environment projection backfill', () => {
  const migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(item => item.version === 144)!;

  it('adds the default projection to legacy persisted status objects', () => {
    const db = database();
    insertResult(db, 'legacy', JSON.stringify({ profile: 'research-default', state: 'ready' }));

    db.exec(migration.up as string);

    expect(JSON.parse(result(db, 'legacy')!)).toEqual({
      profile: 'research-default',
      projection: 'default',
      state: 'ready',
    });
    db.close();
  });

  it('preserves an explicitly persisted projection', () => {
    const db = database();
    const persisted = JSON.stringify({
      profile: 'research-default', projection: 'without-gpquant', state: 'ready',
    });
    insertResult(db, 'current', persisted);

    db.exec(migration.up as string);

    expect(result(db, 'current')).toBe(persisted);
    db.close();
  });

  it('leaves null and malformed payloads untouched so corruption remains observable', () => {
    const db = database();
    insertResult(db, 'null-result', null);
    insertResult(db, 'malformed', '{');

    db.exec(migration.up as string);

    expect(result(db, 'null-result')).toBeNull();
    expect(result(db, 'malformed')).toBe('{');
    db.close();
  });

  it('removes the backfilled default projection on rollback', () => {
    const db = database();
    const legacy = JSON.stringify({ profile: 'research-default', state: 'ready' });
    insertResult(db, 'legacy', legacy);

    db.exec(migration.up as string);
    db.exec(migration.down as string);

    expect(JSON.parse(result(db, 'legacy')!)).toEqual(JSON.parse(legacy));
    db.close();
  });
});
