/**
 * TICKET_1140: v113 migration unit test.
 *
 * Adds `gross_hit_rate_daily` / `net_hit_rate_daily` (nullable REAL) to
 * `nona_backtest_book`. Nullability is the contract: rows persisted before
 * v113 have no recomputable hit rate (the per-bar return stream is not
 * stored) and must stay NULL -- fabricating history is a TICKET_858
 * violation.
 *
 * Approach mirrors the v97 test: in-memory SQLite with the minimum schema
 * the migration touches, run the v113 `up` SQL, assert columns + NULL
 * back-fill semantics + that new writes land.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

vi.mock('../../utils/logger', () => ({
  dbLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  ipcLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Avoid loading the eval-parquet-writer (it imports electron's `app`).
vi.mock('../../services/signal-discovery/eval-parquet-writer', () => ({
  getEvalParquetRoot: () => '/tmp/StratCraft-test-eval-root-does-not-exist',
}));

vi.mock('../../services/data-providers/imported-package-ratio', () => ({
  computePackageCalendarRatios: () => ({}),
}));

import { EMBEDDED_MIGRATIONS_FOR_TEST } from '../migrations/migration-manager';

function createSeededDb(): BetterSqlite3Database {
  const db = new Database(':memory:');
  // Minimum pre-v113 shape of nona_backtest_book that the migration touches.
  db.exec(`
    CREATE TABLE nona_backtest_book (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id       INTEGER NOT NULL,
      gross_sharpe REAL,
      net_sharpe   REAL
    );
  `);
  return db;
}

function runV113(db: BetterSqlite3Database): void {
  const v113 = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 113);
  if (!v113) throw new Error('v113 migration not found in EMBEDDED_MIGRATIONS_FOR_TEST');
  if (typeof v113.up !== 'string') throw new Error('v113.up must be a SQL string');
  db.exec(v113.up);
}

describe('TICKET_1140: v113 adds nullable per-book daily hit rate columns', () => {
  let db: BetterSqlite3Database;
  beforeEach(() => { db = createSeededDb(); });
  afterEach(() => { db.close(); });

  it('adds gross_hit_rate_daily and net_hit_rate_daily', () => {
    runV113(db);
    const cols = (db.prepare(`PRAGMA table_info(nona_backtest_book)`).all() as Array<{ name: string; type: string; notnull: number }>);
    const gross = cols.find(c => c.name === 'gross_hit_rate_daily');
    const net = cols.find(c => c.name === 'net_hit_rate_daily');
    expect(gross).toBeDefined();
    expect(net).toBeDefined();
    expect(gross!.type).toBe('REAL');
    expect(net!.type).toBe('REAL');
    // Nullable: pre-v113 history must be representable as NULL.
    expect(gross!.notnull).toBe(0);
    expect(net!.notnull).toBe(0);
  });

  it('leaves pre-migration rows NULL (never fabricates history)', () => {
    db.prepare(`INSERT INTO nona_backtest_book (run_id, gross_sharpe, net_sharpe) VALUES (1, 1.2, 0.8)`).run();
    runV113(db);
    const row = db.prepare(`SELECT gross_hit_rate_daily, net_hit_rate_daily FROM nona_backtest_book WHERE run_id = 1`).get() as {
      gross_hit_rate_daily: number | null;
      net_hit_rate_daily: number | null;
    };
    expect(row.gross_hit_rate_daily).toBeNull();
    expect(row.net_hit_rate_daily).toBeNull();
  });

  it('accepts post-migration writes into both columns', () => {
    runV113(db);
    db.prepare(
      `INSERT INTO nona_backtest_book (run_id, gross_sharpe, net_sharpe, gross_hit_rate_daily, net_hit_rate_daily)
       VALUES (2, 1.0, 0.9, 0.61, 0.55)`,
    ).run();
    const row = db.prepare(`SELECT gross_hit_rate_daily, net_hit_rate_daily FROM nona_backtest_book WHERE run_id = 2`).get() as {
      gross_hit_rate_daily: number;
      net_hit_rate_daily: number;
    };
    expect(row.gross_hit_rate_daily).toBeCloseTo(0.61, 12);
    expect(row.net_hit_rate_daily).toBeCloseTo(0.55, 12);
  });
});
