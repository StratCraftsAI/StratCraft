/**
 * TICKET_1287 P2: v126 migration unit test.
 *
 * Adds per-signal chained-backtest schema:
 *  - nona_backtest_run.chain_id (TEXT NULL) + chain_position (INTEGER NULL)
 *  - partial index idx_backtest_run_chain ON nona_backtest_run(chain_id)
 *      WHERE chain_id IS NOT NULL
 *  - alpha_factory_config.run_mode (TEXT NOT NULL DEFAULT 'fused')
 *
 * Contract: fused runs keep both chain columns NULL (existing rows
 * unaffected, AC4); config rows default to 'fused' (behaviour bit-for-bit).
 * The migration is idempotent (PRAGMA guards) and reversible (SQLite 3.35+
 * DROP COLUMN + DROP INDEX).
 *
 * Approach mirrors the v113 test: in-memory SQLite with the minimum schema
 * the migration touches, run the v126 `up` (function form) against the raw
 * better-sqlite3 handle (it only uses db.exec / db.prepare, both present),
 * assert columns/index/defaults, then run `down` and assert reversal.
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

function createSeededDb(): BetterSqlite3Database {
  const db = new Database(':memory:');
  // Minimum pre-v126 shape of the two tables the migration touches.
  db.exec(`
    CREATE TABLE nona_backtest_run (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT NOT NULL,
      firm_sharpe  REAL
    );
    CREATE TABLE alpha_factory_config (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);
  return db;
}

function runMigrationUp(db: BetterSqlite3Database): void {
  const v126 = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 126);
  if (!v126) throw new Error('v126 migration not found in EMBEDDED_MIGRATIONS_FOR_TEST');
  if (typeof v126.up !== 'function') throw new Error('v126.up must be the function form');
  // The migration only calls db.exec / db.prepare -- both exist on the raw
  // better-sqlite3 handle, so the DatabaseManager type is structurally satisfied.
  v126.up(db as unknown as DatabaseManager);
}

function runMigrationDown(db: BetterSqlite3Database): void {
  const v126 = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 126);
  if (!v126) throw new Error('v126 migration not found');
  if (typeof v126.down !== 'string') throw new Error('v126.down must be a SQL string');
  db.exec(v126.down);
}

function colInfo(db: BetterSqlite3Database, table: string) {
  return db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string; type: string; notnull: number; dflt_value: string | null;
  }>;
}

function hasIndex(db: BetterSqlite3Database, name: string): boolean {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").all(name)).length > 0;
}

describe('TICKET_1287 P2: v126 chained-backtest schema', () => {
  let db: BetterSqlite3Database;
  beforeEach(() => { db = createSeededDb(); });
  afterEach(() => { db.close(); });

  it('adds nullable chain_id + chain_position to nona_backtest_run', () => {
    runMigrationUp(db);
    const cols = colInfo(db, 'nona_backtest_run');
    const chainId = cols.find(c => c.name === 'chain_id');
    const chainPos = cols.find(c => c.name === 'chain_position');
    expect(chainId).toBeDefined();
    expect(chainPos).toBeDefined();
    expect(chainId!.type).toBe('TEXT');
    expect(chainPos!.type).toBe('INTEGER');
    // Nullable: fused runs must be representable with both columns NULL.
    expect(chainId!.notnull).toBe(0);
    expect(chainPos!.notnull).toBe(0);
  });

  it('creates the partial idx_backtest_run_chain index', () => {
    runMigrationUp(db);
    expect(hasIndex(db, 'idx_backtest_run_chain')).toBe(true);
    const sql = (db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_backtest_run_chain'",
    ).get() as { sql: string }).sql;
    // Partial index -- fused rows (chain_id NULL) add no index weight.
    expect(sql).toContain('WHERE chain_id IS NOT NULL');
  });

  it("adds run_mode to alpha_factory_config with NOT NULL DEFAULT 'fused'", () => {
    runMigrationUp(db);
    const cols = colInfo(db, 'alpha_factory_config');
    const runMode = cols.find(c => c.name === 'run_mode');
    expect(runMode).toBeDefined();
    expect(runMode!.type).toBe('TEXT');
    expect(runMode!.notnull).toBe(1);
    expect(runMode!.dflt_value).toBe("'fused'");
  });

  it('leaves pre-migration run rows with NULL chain columns (AC4)', () => {
    db.prepare(`INSERT INTO nona_backtest_run (user_id, firm_sharpe) VALUES ('u1', 1.2)`).run();
    runMigrationUp(db);
    const row = db.prepare(`SELECT chain_id, chain_position FROM nona_backtest_run WHERE user_id = 'u1'`).get() as {
      chain_id: string | null; chain_position: number | null;
    };
    expect(row.chain_id).toBeNull();
    expect(row.chain_position).toBeNull();
  });

  it("defaults pre-migration config rows to run_mode='fused'", () => {
    db.prepare(`INSERT INTO alpha_factory_config (id, name) VALUES ('cfg-1', 'default')`).run();
    runMigrationUp(db);
    const row = db.prepare(`SELECT run_mode FROM alpha_factory_config WHERE id = 'cfg-1'`).get() as {
      run_mode: string;
    };
    expect(row.run_mode).toBe('fused');
  });

  it('is idempotent -- re-running up is a no-op (no duplicate column / index error)', () => {
    runMigrationUp(db);
    expect(() => runMigrationUp(db)).not.toThrow();
    const cols = colInfo(db, 'nona_backtest_run').filter(c => c.name === 'chain_id');
    expect(cols).toHaveLength(1);
  });

  it('accepts chain writes after migration', () => {
    runMigrationUp(db);
    db.prepare(
      `INSERT INTO nona_backtest_run (user_id, firm_sharpe, chain_id, chain_position) VALUES ('u2', 0.9, 'chain-x', 3)`,
    ).run();
    const row = db.prepare(`SELECT chain_id, chain_position FROM nona_backtest_run WHERE user_id = 'u2'`).get() as {
      chain_id: string; chain_position: number;
    };
    expect(row.chain_id).toBe('chain-x');
    expect(row.chain_position).toBe(3);
  });

  it('down reverses cleanly: drops index + both chain columns + run_mode', () => {
    runMigrationUp(db);
    runMigrationDown(db);

    expect(hasIndex(db, 'idx_backtest_run_chain')).toBe(false);

    const runCols = colInfo(db, 'nona_backtest_run').map(c => c.name);
    expect(runCols).not.toContain('chain_id');
    expect(runCols).not.toContain('chain_position');

    const cfgCols = colInfo(db, 'alpha_factory_config').map(c => c.name);
    expect(cfgCols).not.toContain('run_mode');
  });

  it('up/down/up round-trips (reversible + re-appliable)', () => {
    runMigrationUp(db);
    runMigrationDown(db);
    expect(() => runMigrationUp(db)).not.toThrow();
    expect(colInfo(db, 'nona_backtest_run').some(c => c.name === 'chain_id')).toBe(true);
    expect(hasIndex(db, 'idx_backtest_run_chain')).toBe(true);
  });
});
