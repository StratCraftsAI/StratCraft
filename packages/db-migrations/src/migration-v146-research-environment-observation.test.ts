import { describe, expect, it } from 'vitest';

import { EMBEDDED_MIGRATIONS_FOR_TEST } from './migrations';
import { openTestDatabase } from './test-database';

describe('TICKET_1355_2C migration v146 research environment observation', () => {
  const migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(item => item.version === 146)!;

  it('enforces one observation owner per job and tool call', () => {
    const db = openTestDatabase(':memory:');
    db.exec(`
      CREATE TABLE nona_ai_conversations (id INTEGER PRIMARY KEY);
      CREATE TABLE research_environment_jobs (job_id TEXT PRIMARY KEY);
      INSERT INTO nona_ai_conversations VALUES (1);
      INSERT INTO research_environment_jobs VALUES ('job-1');
    `);
    db.exec(migration.up as string);
    const insert = db.prepare(`INSERT INTO research_environment_job_observations
      (conversation_id, originating_turn_id, tool_call_id, job_id, operation,
       mcp_session_id, observation_state, created_at, updated_at)
      VALUES (1, 'turn-1', 'call-1', ?, 'install', 'session-1', 'observing', ?, ?)`);
    insert.run('job-1', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
    expect(() => insert.run('job-1', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'))
      .toThrow();
    expect(db.prepare('SELECT last_seen_revision FROM research_environment_job_observations').get())
      .toEqual({ last_seen_revision: 0 });
    db.close();
  });

  it('rolls back its table and indexes', () => {
    const db = openTestDatabase(':memory:');
    db.exec(`CREATE TABLE nona_ai_conversations (id INTEGER PRIMARY KEY);
      CREATE TABLE research_environment_jobs (job_id TEXT PRIMARY KEY);`);
    db.exec(migration.up as string);
    db.exec(migration.down as string);
    expect(db.prepare(`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'research_environment_job_observations'`).get())
      .toBeUndefined();
    db.close();
  });
});
