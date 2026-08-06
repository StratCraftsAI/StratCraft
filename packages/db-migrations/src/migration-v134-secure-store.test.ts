import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openTestDatabase } from './test-database';
import { EMBEDDED_MIGRATIONS_FOR_TEST } from './migrations';

const migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(item => item.version === 134)!;

describe('migration v134 SecureStore lifecycle constraints', () => {
  it('installs the complete lifecycle schema and prevents active metadata drift', () => {
    const db = openTestDatabase(':memory:');
    db.pragma('foreign_keys = ON');
    expect(typeof migration.up).toBe('string');
    db.exec(migration.up as string);
    const now = Date.now();
    db.prepare(
      `INSERT INTO secure_store_key
         (key_id, keyring_account, key_fingerprint, generation,
          lifecycle_status, created_at, activated_at)
       VALUES ('k1', 'a1', 'f1', 1, 'available', ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO secure_store_state
         (singleton_id, store_id, envelope_version, active_key_id,
          active_generation, minimum_writer_protocol, updated_at)
       VALUES (1, 's1', 2, 'k1', 1, 1, ?)`,
    ).run(now);

    expect(() => db.prepare(
      `INSERT INTO secure_store_state
         (singleton_id, store_id, envelope_version, active_key_id,
          active_generation, minimum_writer_protocol, updated_at)
       VALUES (2, 's2', 2, 'k1', 1, 1, ?)`,
    ).run(now)).toThrow();
    expect(() => db.prepare(
      `UPDATE secure_store_state SET active_generation = 2 WHERE singleton_id = 1`,
    ).run()).toThrow();
    expect(() => db.prepare(
      `UPDATE secure_store_key SET lifecycle_status = 'retired' WHERE key_id = 'k1'`,
    ).run()).toThrow(/active SecureStore key cannot be retired/);
    db.close();
  });
});
