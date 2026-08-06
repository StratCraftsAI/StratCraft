import { describe, expect, it } from 'vitest';

import { EMBEDDED_MIGRATIONS_FOR_TEST } from './migrations';
import { openTestDatabase } from './test-database';

const SHA = 'a'.repeat(64);
const NOW = '2026-08-04T00:00:00.000Z';

function database() {
  const db = openTestDatabase(':memory:');
  for (const version of [140, 142, 143, 144]) {
    const migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(item => item.version === version)!;
    db.exec(migration.up as string);
  }
  return db;
}

describe('migration v145 durable active research projection', () => {
  const migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(item => item.version === 145)!;

  it('backfills the latest verified status as the authoritative projection', () => {
    const db = database();
    const status = JSON.stringify({
      profile: 'research-default', projection: 'without-gpquant', state: 'ready',
    });
    db.prepare(`INSERT INTO research_environment_jobs
      (job_id, profile, operation, state, current_stage, manifest_sha256, lock_sha256,
       owner_instance_id, heartbeat_at, created_at, finished_at, result_json)
      VALUES ('job-1', 'research-default', 'remove_capability', 'succeeded', 'transition',
              ?, ?, 'owner', ?, ?, ?, ?)`)
      .run(SHA, SHA, NOW, NOW, NOW, status);

    db.exec(migration.up as string);

    expect(db.prepare('SELECT * FROM research_environment_active_projection').get())
      .toMatchObject({
        profile: 'research-default',
        projection: 'without-gpquant',
        pending_cleanup_projection: null,
        published_by_job_id: 'job-1',
        status_json: status,
      });
    db.close();
  });

  it('rolls back only the projection owner table', () => {
    const db = database();
    db.exec(migration.up as string);
    db.exec(migration.down as string);
    expect(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'research_environment_active_projection'",
    ).get()).toBeUndefined();
    expect(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'research_environment_jobs'",
    ).get()).toBeDefined();
    db.close();
  });
});
