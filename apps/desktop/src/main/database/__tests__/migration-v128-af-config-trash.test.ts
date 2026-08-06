/**
 * TICKET_1287_1 Layer B2: v128 migration unit test.
 *
 * Adds the reversible trash table backing the alpha_factory_config single-row
 * invariant:
 *  - table alpha_factory_config_trash mirroring alpha_factory_config's columns
 *    (as of v126, incl. run_mode) plus deleted_at, keyed by an autoincrement
 *    trash_id (the same config id can be trashed more than once).
 *  - index idx_af_config_trash_deleted ON alpha_factory_config_trash(deleted_at DESC)
 *
 * Contract: saveAlphaFactoryConfigOp copies every doomed row here before the
 * destructive `DELETE FROM alpha_factory_config WHERE id != ?`, so a mis-id'd
 * save (the 57 -> 0 signal-loss regression) is always recoverable. The migration
 * is idempotent (guards on sqlite_master) and reversible (DROP TABLE, index
 * drops with it).
 *
 * Approach mirrors the v127 test: in-memory SQLite, run the v128 `up` (function
 * form) against the raw better-sqlite3 handle, assert schema + round-trip, then
 * run `down` and assert the table is gone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

vi.mock('../../utils/logger', () => ({
  dbLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  ipcLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Avoid loading the eval-parquet-writer (it imports electron's `app`).
vi.mock('../../services/signal-discovery/eval-parquet-writer', () => ({
  getEvalParquetRoot: () => '/tmp/StratCraft-test-eval-root-does-not-exist',
}));

vi.mock('../../services/data-providers/imported-package-ratio', () => ({
  computePackageCalendarRatios: () => ({}),
}));

import { EMBEDDED_MIGRATIONS_FOR_TEST } from '../migrations/migration-manager';
import type { DatabaseManager } from '../db-manager';

function createDb(): BetterSqlite3Database {
  // The v128 migration is self-contained (creates its own table), so no
  // pre-existing schema is required.
  return new Database(':memory:');
}

function runMigrationUp(db: BetterSqlite3Database): void {
  const v128 = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 128);
  if (!v128) throw new Error('v128 migration not found in EMBEDDED_MIGRATIONS_FOR_TEST');
  if (typeof v128.up !== 'function') throw new Error('v128.up must be the function form');
  v128.up(db as unknown as DatabaseManager);
}

function runMigrationDown(db: BetterSqlite3Database): void {
  const v128 = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 128);
  if (!v128) throw new Error('v128 migration not found');
  if (typeof v128.down !== 'string') throw new Error('v128.down must be a SQL string');
  db.exec(v128.down);
}

function colInfo(db: BetterSqlite3Database, table: string) {
  return db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string; type: string; notnull: number; dflt_value: string | null; pk: number;
  }>;
}

function hasTable(db: BetterSqlite3Database, name: string): boolean {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").all(name)).length > 0;
}

function hasIndex(db: BetterSqlite3Database, name: string): boolean {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").all(name)).length > 0;
}

describe('TICKET_1287_1 B2: v128 alpha_factory_config_trash table', () => {
  let db: BetterSqlite3Database;
  beforeEach(() => { db = createDb(); });
  afterEach(() => { db.close(); });

  it('creates alpha_factory_config_trash mirroring config columns + deleted_at', () => {
    runMigrationUp(db);
    expect(hasTable(db, 'alpha_factory_config_trash')).toBe(true);

    const cols = colInfo(db, 'alpha_factory_config_trash');
    const names = cols.map(c => c.name);
    expect(names).toEqual([
      'trash_id', 'id', 'name', 'signal_method', 'lookback', 'signals',
      'exit_method', 'exits', 'factors', 'factor_method', 'factor_lookback',
      'combinator_mode', 'feed_lstm', 'run_mode', 'is_active', 'created_at',
      'updated_at', 'deleted_at',
    ]);

    // Surrogate autoincrement PK -- the same config id can be trashed twice.
    const pkCols = cols.filter(c => c.pk > 0).map(c => c.name);
    expect(pkCols).toEqual(['trash_id']);

    // deleted_at is the only NOT NULL contract (a trashed row must be stamped).
    const notNull = (name: string) => cols.find(c => c.name === name)!.notnull;
    expect(notNull('deleted_at')).toBe(1);
    expect(notNull('id')).toBe(1);
    expect(notNull('signals')).toBe(0);
  });

  it('creates the idx_af_config_trash_deleted (deleted_at DESC) index', () => {
    runMigrationUp(db);
    expect(hasIndex(db, 'idx_af_config_trash_deleted')).toBe(true);
    const sql = (db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_af_config_trash_deleted'",
    ).get() as { sql: string }).sql;
    expect(sql).toContain('deleted_at DESC');
  });

  it('is idempotent -- re-running up is a no-op', () => {
    runMigrationUp(db);
    expect(() => runMigrationUp(db)).not.toThrow();
    expect(hasTable(db, 'alpha_factory_config_trash')).toBe(true);
    expect(hasIndex(db, 'idx_af_config_trash_deleted')).toBe(true);
  });

  it('allows the same config id to be trashed more than once (autoincrement PK)', () => {
    runMigrationUp(db);
    const insert = db.prepare(`
      INSERT INTO alpha_factory_config_trash (id, signals, deleted_at)
      VALUES (@id, @signals, @deleted_at)
    `);
    insert.run({ id: 'af_1', signals: JSON.stringify([{ id: 's1' }]), deleted_at: '2026-07-20T10:00:00Z' });
    expect(() => insert.run({
      id: 'af_1', signals: '[]', deleted_at: '2026-07-20T11:00:00Z',
    })).not.toThrow(); // same id, distinct trash_id

    const rows = db.prepare("SELECT trash_id, id FROM alpha_factory_config_trash WHERE id = 'af_1'").all();
    expect(rows).toHaveLength(2);
  });

  it('down drops the table (and its index)', () => {
    runMigrationUp(db);
    runMigrationDown(db);
    expect(hasTable(db, 'alpha_factory_config_trash')).toBe(false);
    expect(hasIndex(db, 'idx_af_config_trash_deleted')).toBe(false);
  });

  it('up/down/up round-trips (reversible + re-appliable)', () => {
    runMigrationUp(db);
    runMigrationDown(db);
    expect(() => runMigrationUp(db)).not.toThrow();
    expect(hasTable(db, 'alpha_factory_config_trash')).toBe(true);
    expect(hasIndex(db, 'idx_af_config_trash_deleted')).toBe(true);
  });
});
