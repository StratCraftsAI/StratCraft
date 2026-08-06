import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { EMBEDDED_MIGRATIONS_FOR_TEST } from './migrations';

function database(): Database.Database {
  const db = new Database(':memory:', {
    nativeBinding: resolve(
      process.cwd(),
      '../../apps/desktop/src/mcp/standalone/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    ),
  });
  for (const version of [140, 142]) {
    const migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(item => item.version === version)!;
    db.exec(migration.up as string);
  }
  return db;
}

describe('migration v142 research environment uninstall', () => {
  it('accepts uninstall operations and stages while preserving existing rows', () => {
    const db = database();
    const insert = db.prepare(`INSERT INTO research_environment_jobs
      (job_id, profile, operation, state, current_stage, manifest_sha256, lock_sha256,
       owner_instance_id, heartbeat_at, created_at)
      VALUES (?, 'research-default', ?, 'queued', ?, 'm', 'l', 'owner', '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z')`);
    expect(() => insert.run('uninstall-job', 'uninstall', 'uninstall')).not.toThrow();
    expect(() => insert.run('bad-job', 'remove-package', 'uninstall')).toThrow(/CHECK/i);
    db.close();
  });
});
