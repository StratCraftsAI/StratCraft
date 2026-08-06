/**
 * TICKET_1287 F1a: v127 migration unit test.
 *
 * Adds the durable per-signal chain-entry store:
 *  - table nona_backtest_chain_entry with 13 columns and PRIMARY KEY
 *      (chain_id, chain_position)
 *  - index idx_chain_entry_created ON nona_backtest_chain_entry(created_at DESC)
 *
 * Contract (design §10 F1a): a chain records completed | failed | skipped
 * entries alike; only a completed entry maps to a real nona_backtest_run row,
 * so run_id is NULL for failed/skipped and non-NULL for completed. error holds
 * the verbatim failure message (TICKET_858). The migration is idempotent (guards
 * on sqlite_master) and reversible (DROP TABLE, index drops with it).
 *
 * Approach mirrors the v126 test: in-memory SQLite, run the v127 `up`
 * (function form) against the raw better-sqlite3 handle (it only uses
 * db.exec / db.prepare, both present), assert schema + round-trip rows, then
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
  // The v127 migration is self-contained (creates its own table), so no
  // pre-existing schema is required.
  return new Database(':memory:');
}

function runMigrationUp(db: BetterSqlite3Database): void {
  const v127 = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 127);
  if (!v127) throw new Error('v127 migration not found in EMBEDDED_MIGRATIONS_FOR_TEST');
  if (typeof v127.up !== 'function') throw new Error('v127.up must be the function form');
  // The migration only calls db.exec / db.prepare -- both exist on the raw
  // better-sqlite3 handle, so the DatabaseManager type is structurally satisfied.
  v127.up(db as unknown as DatabaseManager);
}

function runMigrationDown(db: BetterSqlite3Database): void {
  const v127 = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 127);
  if (!v127) throw new Error('v127 migration not found');
  if (typeof v127.down !== 'string') throw new Error('v127.down must be a SQL string');
  db.exec(v127.down);
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

describe('TICKET_1287 F1a: v127 nona_backtest_chain_entry table', () => {
  let db: BetterSqlite3Database;
  beforeEach(() => { db = createDb(); });
  afterEach(() => { db.close(); });

  it('creates nona_backtest_chain_entry with all 13 columns and the composite PK', () => {
    runMigrationUp(db);
    expect(hasTable(db, 'nona_backtest_chain_entry')).toBe(true);

    const cols = colInfo(db, 'nona_backtest_chain_entry');
    const names = cols.map(c => c.name);
    expect(names).toEqual([
      'chain_id', 'chain_position', 'signal_id', 'signal_name', 'status',
      'run_id', 'error', 'net_sharpe', 'gross_sharpe', 'max_drawdown',
      'final_equity', 'trade_count', 'created_at',
    ]);
    expect(names).toHaveLength(13);

    // Composite primary key (chain_id, chain_position).
    const pkCols = cols.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
    expect(pkCols).toEqual(['chain_id', 'chain_position']);

    // NOT NULL contract on the required columns.
    const notNull = (name: string) => cols.find(c => c.name === name)!.notnull;
    expect(notNull('chain_id')).toBe(1);
    expect(notNull('chain_position')).toBe(1);
    expect(notNull('signal_id')).toBe(1);
    expect(notNull('signal_name')).toBe(1);
    expect(notNull('status')).toBe(1);
    expect(notNull('created_at')).toBe(1);
    // Nullable: run_id (NULL unless completed) + error + metric snapshot.
    expect(notNull('run_id')).toBe(0);
    expect(notNull('error')).toBe(0);
    expect(notNull('net_sharpe')).toBe(0);
  });

  it('creates the idx_chain_entry_created (created_at DESC) index', () => {
    runMigrationUp(db);
    expect(hasIndex(db, 'idx_chain_entry_created')).toBe(true);
    const sql = (db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_chain_entry_created'",
    ).get() as { sql: string }).sql;
    expect(sql).toContain('created_at DESC');
  });

  it('is idempotent -- re-running up is a no-op (no "table already exists" error)', () => {
    runMigrationUp(db);
    expect(() => runMigrationUp(db)).not.toThrow();
    expect(hasTable(db, 'nona_backtest_chain_entry')).toBe(true);
    expect(hasIndex(db, 'idx_chain_entry_created')).toBe(true);
  });

  it('round-trips a completed entry (run_id set, metric snapshot) and a failed entry (run_id NULL, error set)', () => {
    runMigrationUp(db);
    const insert = db.prepare(`
      INSERT INTO nona_backtest_chain_entry
        (chain_id, chain_position, signal_id, signal_name, status, run_id, error,
         net_sharpe, gross_sharpe, max_drawdown, final_equity, trade_count, created_at)
      VALUES (@chain_id, @chain_position, @signal_id, @signal_name, @status, @run_id, @error,
              @net_sharpe, @gross_sharpe, @max_drawdown, @final_equity, @trade_count, @created_at)
    `);

    // Completed entry: run_id present, metric snapshot populated, no error.
    insert.run({
      chain_id: 'chain-1', chain_position: 0, signal_id: 42, signal_name: 'lightgbm_v2',
      status: 'completed', run_id: 907, error: null,
      net_sharpe: 1.23, gross_sharpe: 1.55, max_drawdown: -0.14, final_equity: 112345.6,
      trade_count: 88, created_at: 1_700_000_000_000,
    });
    // Failed entry: run_id NULL, verbatim error, no metrics.
    insert.run({
      chain_id: 'chain-1', chain_position: 1, signal_id: 43, signal_name: 'attn_v1',
      status: 'failed', run_id: null, error: 'executor timeout after 600000ms',
      net_sharpe: null, gross_sharpe: null, max_drawdown: null, final_equity: null,
      trade_count: null, created_at: 1_700_000_001_000,
    });

    const rows = db.prepare(
      `SELECT * FROM nona_backtest_chain_entry WHERE chain_id = 'chain-1' ORDER BY chain_position`,
    ).all() as Array<{
      chain_position: number; status: string; run_id: number | null;
      error: string | null; net_sharpe: number | null; trade_count: number | null;
    }>;

    expect(rows).toHaveLength(2);

    expect(rows[0].status).toBe('completed');
    expect(rows[0].run_id).toBe(907);
    expect(rows[0].error).toBeNull();
    expect(rows[0].net_sharpe).toBeCloseTo(1.23);
    expect(rows[0].trade_count).toBe(88);

    expect(rows[1].status).toBe('failed');
    expect(rows[1].run_id).toBeNull();
    expect(rows[1].error).toBe('executor timeout after 600000ms');
    expect(rows[1].net_sharpe).toBeNull();
  });

  it('enforces the (chain_id, chain_position) primary key', () => {
    runMigrationUp(db);
    const insert = db.prepare(`
      INSERT INTO nona_backtest_chain_entry
        (chain_id, chain_position, signal_id, signal_name, status, created_at)
      VALUES ('chain-2', 0, 1, 's1', 'skipped', 1)
    `);
    insert.run();
    expect(() => insert.run()).toThrow(); // duplicate PK
  });

  it('down drops the table (and its index)', () => {
    runMigrationUp(db);
    runMigrationDown(db);
    expect(hasTable(db, 'nona_backtest_chain_entry')).toBe(false);
    expect(hasIndex(db, 'idx_chain_entry_created')).toBe(false);
  });

  it('up/down/up round-trips (reversible + re-appliable)', () => {
    runMigrationUp(db);
    runMigrationDown(db);
    expect(() => runMigrationUp(db)).not.toThrow();
    expect(hasTable(db, 'nona_backtest_chain_entry')).toBe(true);
    expect(hasIndex(db, 'idx_chain_entry_created')).toBe(true);
  });
});
