/**
 * TICKET_1276 P2 gate 2 / TICKET_1335: schema-version invariant.
 *
 * `packages/types/src/schema-version.ts` documents its own contract -- "this
 * MUST equal the highest `version` in `EMBEDDED_MIGRATIONS`" -- and states that
 * "the migration-invariants property test asserts that equality so this
 * constant cannot silently drift behind a newly added migration".
 *
 * That test did not exist. The constant consequently sat at 138 while
 * `EMBEDDED_MIGRATIONS` reached 139, so the MCP standalone process would have
 * compared an on-disk `MAX(schema_version.version)` of 139 against an expected
 * 138 and raised `schemaAhead` against a correctly migrated database. The drift
 * was introduced by migration 139 and found while adding migration 140.
 *
 * This file is that missing guard. It lives in the migrations package because
 * that is where `EMBEDDED_MIGRATIONS` is defined; the types package cannot
 * import it without inverting the dependency direction.
 */

import { describe, expect, it } from 'vitest';
import { EXPECTED_SCHEMA_VERSION } from '@StratCraft/types';
import { EMBEDDED_MIGRATIONS_FOR_TEST } from './migrations';

describe('schema-version invariant', () => {
  const versions = EMBEDDED_MIGRATIONS_FOR_TEST.map(migration => migration.version);

  it('pins EXPECTED_SCHEMA_VERSION to the highest embedded migration', () => {
    expect(EXPECTED_SCHEMA_VERSION).toBe(Math.max(...versions));
  });

  it('assigns every migration a unique version', () => {
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('declares migrations in ascending version order', () => {
    expect([...versions]).toEqual([...versions].sort((a, b) => a - b));
  });

  it('gives every migration a name, an up, and a declared down', () => {
    for (const migration of EMBEDDED_MIGRATIONS_FOR_TEST) {
      expect(migration.name, `migration ${migration.version} name`).toBeTruthy();
      expect(migration.up, `migration ${migration.version} up`).toBeTruthy();
      // `down` must be *declared*, but may legitimately be empty: a migration
      // that drops tables after data has moved to parquet (v96) is deliberately
      // one-way, and inventing a reversal would recreate an empty table that
      // readers would mistake for real history.
      expect(migration.down, `migration ${migration.version} down`).toBeDefined();
    }
  });

  it('declares a non-empty down for the reversible research-environment job store', () => {
    const v140 = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 140)!;
    expect(v140.down).toBeTruthy();
  });
});
