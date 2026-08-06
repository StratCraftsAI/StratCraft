/**
 * TICKET_1276 P2 gate 2 -- schema-version-skew contract tests.
 *
 * Exercises assertSchemaCompatible / readSchemaVersion / SchemaSkewError
 * against a REAL in-memory better-sqlite3 DB (no mock), mirroring the app's
 * `schema_version` table mechanism (MAX(version)) rather than PRAGMA
 * user_version. Covers: equal (normal), DB ahead (schemaAhead), DB behind
 * (schemaBehind), and the fresh/test DB (no table -> version 0 -> schemaBehind).
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  assertSchemaCompatible,
  readSchemaVersion,
  SchemaSkewError,
} from '../db';

/** Create an in-memory DB whose schema_version table reports `version`. */
function dbAtVersion(version: number): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Insert a range of applied versions so MAX(version) == version, matching how
  // the migration runner records every applied migration.
  const insert = db.prepare('INSERT INTO schema_version (version) VALUES (?)');
  for (let v = 1; v <= version; v++) {
    insert.run(v);
  }
  return db;
}

describe('readSchemaVersion', () => {
  it('returns 0 when the schema_version table is absent (fresh/test DB)', () => {
    const db = new Database(':memory:');
    expect(readSchemaVersion(db)).toBe(0);
    db.close();
  });

  it('returns MAX(version) from the schema_version table', () => {
    const db = dbAtVersion(42);
    expect(readSchemaVersion(db)).toBe(42);
    db.close();
  });

  it('returns 0 when the table exists but is empty', () => {
    const db = new Database(':memory:');
    db.exec(
      `CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT);`,
    );
    expect(readSchemaVersion(db)).toBe(0);
    db.close();
  });
});

describe('assertSchemaCompatible', () => {
  it('does not throw when DB version equals expected', () => {
    const db = dbAtVersion(125);
    expect(() => assertSchemaCompatible(db, 125)).not.toThrow();
    db.close();
  });

  it('throws schemaAhead when DB is newer than MCP build', () => {
    const db = dbAtVersion(130);
    try {
      assertSchemaCompatible(db, 125);
      throw new Error('expected assertSchemaCompatible to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaSkewError);
      const e = err as SchemaSkewError;
      expect(e.kind).toBe('schemaAhead');
      expect(e.dbVersion).toBe(130);
      expect(e.expectedVersion).toBe(125);
      expect(e.message).toContain('AHEAD');
      expect(e.message).toContain('gap 5');
    }
    db.close();
  });

  it('throws schemaBehind when DB is older than MCP build', () => {
    const db = dbAtVersion(120);
    try {
      assertSchemaCompatible(db, 125);
      throw new Error('expected assertSchemaCompatible to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaSkewError);
      const e = err as SchemaSkewError;
      expect(e.kind).toBe('schemaBehind');
      expect(e.dbVersion).toBe(120);
      expect(e.expectedVersion).toBe(125);
      expect(e.message).toContain('BEHIND');
      expect(e.message).toContain('Launch the StratCraft desktop app');
    }
    db.close();
  });

  it('treats a fresh DB (version 0) as schemaBehind, never a silent read', () => {
    const db = new Database(':memory:');
    try {
      assertSchemaCompatible(db, 125);
      throw new Error('expected assertSchemaCompatible to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaSkewError);
      expect((err as SchemaSkewError).kind).toBe('schemaBehind');
      expect((err as SchemaSkewError).dbVersion).toBe(0);
    }
    db.close();
  });

  it('defaults expected to the shared EXPECTED_SCHEMA_VERSION constant', async () => {
    // At the current constant (125) a matching DB must pass with no override arg.
    const { EXPECTED_SCHEMA_VERSION } = await import('@StratCraft/types');
    const db = dbAtVersion(EXPECTED_SCHEMA_VERSION);
    expect(() => assertSchemaCompatible(db)).not.toThrow();
    db.close();
  });
});
