/**
 * TICKET_634_5: Migration Invariant Property Tests
 *
 * Validates structural invariants of the embedded migration array
 * using source code analysis (no DB connection required).
 */
import { describe, it, expect } from 'vitest';
import { EXPECTED_SCHEMA_VERSION } from '@StratCraft/types';
import { EMBEDDED_MIGRATIONS_FOR_TEST } from '../migrations/migration-manager';

// Read migration source to extract migration metadata
function extractMigrations(): Array<{ version: number; name: string; hasUp: boolean; hasDown: boolean }> {
  return EMBEDDED_MIGRATIONS_FOR_TEST.map((migration) => ({
    version: migration.version,
    name: migration.name,
    hasUp: Boolean(migration.up),
    hasDown: Boolean(migration.down),
  }));
}

describe('Migration Invariant Tests', () => {
  const migrations = extractMigrations();

  it('should have at least one migration', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('should have strictly monotonically increasing version numbers', () => {
    for (let i = 1; i < migrations.length; i++) {
      expect(migrations[i].version).toBeGreaterThan(migrations[i - 1].version);
    }
  });

  it('should have no duplicate version numbers', () => {
    const versions = migrations.map((m) => m.version);
    const uniqueVersions = new Set(versions);
    expect(uniqueVersions.size).toBe(versions.length);
  });

  it('should have no duplicate migration names', () => {
    const names = migrations.map((m) => m.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('should have version numbers starting from 1', () => {
    expect(migrations[0].version).toBe(1);
  });

  it('should have non-empty names for all migrations', () => {
    for (const m of migrations) {
      expect(m.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('should have an up migration for every version', () => {
    expect(migrations.every((migration) => migration.hasUp)).toBe(true);
  });

  it('should use English-only characters in migration names', () => {
    for (const m of migrations) {
      // eslint-disable-next-line no-control-regex
      expect(m.name).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  // TICKET_1276 P2 gate 2: the shared EXPECTED_SCHEMA_VERSION constant that the
  // MCP schema-skew guard compares against MUST track the highest embedded
  // migration version. If a new migration is added without bumping the
  // constant, the MCP process would wrongly believe the DB is "ahead" and
  // refuse to read. This guard makes that drift a build-time test failure.
  it('EXPECTED_SCHEMA_VERSION equals the highest embedded migration version', () => {
    const maxVersion = migrations.reduce((m, cur) => Math.max(m, cur.version), 0);
    expect(EXPECTED_SCHEMA_VERSION).toBe(maxVersion);
  });
});
