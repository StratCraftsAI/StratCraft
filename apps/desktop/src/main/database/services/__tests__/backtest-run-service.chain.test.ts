/**
 * TICKET_1287 P2: BacktestRunService.getChainEntries real-SQLite tests.
 *
 * The mock-DB suite (backtest-run-service.test.ts) verifies the INSERT arg
 * plumbing for chain_id / chain_position. This suite exercises the actual
 * query semantics against an in-memory better-sqlite3 handle: entries are
 * returned ordered by chain_position, hydrated with books/signals/combinator
 * (design D5 -- each entry IS a first-class run row), and fused rows
 * (chain_id NULL) are never returned.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

vi.mock('../../../utils/logger', () => ({
  dbLog: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { BacktestRunService } from '../backtest-run-service';
import type { DatabaseManager } from '../../db-manager';

/**
 * Minimum schema the getChainEntries read path touches: the run table with
 * the v126 chain columns, plus the three child tables it hydrates (kept empty
 * here -- ordering/filtering is the contract under test).
 */
function createDb(): BetterSqlite3Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nona_backtest_run (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at     INTEGER NOT NULL,
      user_id        TEXT NOT NULL,
      run_label      TEXT,
      chain_id       TEXT,
      chain_position INTEGER
    );
    CREATE TABLE nona_backtest_book (id INTEGER PRIMARY KEY, run_id INTEGER);
    CREATE TABLE nona_backtest_run_signal (id INTEGER PRIMARY KEY, run_id INTEGER);
    CREATE TABLE nona_backtest_run_combinator (id INTEGER PRIMARY KEY, run_id INTEGER);
    -- TICKET_1287 F1a: the durable per-signal chain-outcome table (migration
    -- v127 shape) that F1b writes/reads.
    CREATE TABLE nona_backtest_chain_entry (
      chain_id       TEXT    NOT NULL,
      chain_position INTEGER NOT NULL,
      signal_id      INTEGER NOT NULL,
      signal_name    TEXT    NOT NULL,
      status         TEXT    NOT NULL,
      run_id         INTEGER NULL,
      error          TEXT    NULL,
      net_sharpe     REAL    NULL,
      gross_sharpe   REAL    NULL,
      max_drawdown   REAL    NULL,
      final_equity   REAL    NULL,
      trade_count    INTEGER NULL,
      created_at     INTEGER NOT NULL,
      PRIMARY KEY (chain_id, chain_position)
    );
    CREATE INDEX idx_chain_entry_created ON nona_backtest_chain_entry(created_at DESC);
  `);
  return db;
}

function insertRun(
  db: BetterSqlite3Database,
  args: { userId?: string; chainId?: string | null; chainPosition?: number | null; label?: string },
): number {
  const res = db.prepare(
    `INSERT INTO nona_backtest_run (created_at, user_id, run_label, chain_id, chain_position)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    Date.now(),
    args.userId ?? 'u1',
    args.label ?? null,
    args.chainId ?? null,
    args.chainPosition ?? null,
  );
  return Number(res.lastInsertRowid);
}

describe('TICKET_1287 P2: BacktestRunService.getChainEntries', () => {
  let db: BetterSqlite3Database;
  let service: BacktestRunService;

  beforeEach(() => {
    db = createDb();
    service = new BacktestRunService(db as unknown as DatabaseManager);
  });
  afterEach(() => { db.close(); });

  it('returns [] for an unknown chain id', () => {
    expect(service.getChainEntries('no-such-chain')).toEqual([]);
  });

  it('returns entries ordered by chain_position ascending', () => {
    // Insert out of order to prove the ORDER BY, not insertion order.
    insertRun(db, { chainId: 'chain-A', chainPosition: 2, label: 'pos2' });
    insertRun(db, { chainId: 'chain-A', chainPosition: 0, label: 'pos0' });
    insertRun(db, { chainId: 'chain-A', chainPosition: 1, label: 'pos1' });

    const entries = service.getChainEntries('chain-A');
    expect(entries.map(e => e.chain_position)).toEqual([0, 1, 2]);
    expect(entries.map(e => e.run_label)).toEqual(['pos0', 'pos1', 'pos2']);
  });

  it('excludes fused runs (chain_id NULL) and other chains', () => {
    insertRun(db, { chainId: 'chain-A', chainPosition: 0 });
    insertRun(db, { chainId: null }); // fused run
    insertRun(db, { chainId: 'chain-B', chainPosition: 0 }); // different chain

    const entries = service.getChainEntries('chain-A');
    expect(entries).toHaveLength(1);
    expect(entries[0].chain_id).toBe('chain-A');
  });

  it('hydrates each entry with books/signals/combinator shape (D5)', () => {
    const runId = insertRun(db, { chainId: 'chain-C', chainPosition: 0 });
    db.prepare('INSERT INTO nona_backtest_book (id, run_id) VALUES (10, ?)').run(runId);
    db.prepare('INSERT INTO nona_backtest_run_signal (id, run_id) VALUES (20, ?)').run(runId);

    const [entry] = service.getChainEntries('chain-C');
    expect(entry.books).toHaveLength(1);
    expect(entry.signals).toHaveLength(1);
    expect(entry.combinator).toBeNull(); // none inserted
    expect(entry.chain_id).toBe('chain-C');
    expect(entry.chain_position).toBe(0);
  });
});

describe('TICKET_1287 F1b: saveChainEntry / getChainEntryOutcomes / listChains', () => {
  let db: BetterSqlite3Database;
  let service: BacktestRunService;

  beforeEach(() => {
    db = createDb();
    service = new BacktestRunService(db as unknown as DatabaseManager);
  });
  afterEach(() => { db.close(); });

  it('writes a completed entry with run_id + metric snapshot', () => {
    service.saveChainEntry({
      chainId: 'K1', chainPosition: 0, signalId: 11, signalName: 'Sig-11',
      status: 'completed', runId: 500,
      netSharpe: 1.5, grossSharpe: 1.8, maxDrawdown: -0.1, finalEquity: 1.23,
      tradeCount: 42, createdAt: 1000,
    });

    const row = db.prepare(
      'SELECT * FROM nona_backtest_chain_entry WHERE chain_id = ? AND chain_position = ?',
    ).get('K1', 0) as Record<string, unknown>;
    expect(row.status).toBe('completed');
    expect(row.run_id).toBe(500);
    expect(row.error).toBeNull();
    expect(row.net_sharpe).toBe(1.5);
    expect(row.gross_sharpe).toBe(1.8);
    expect(row.max_drawdown).toBe(-0.1);
    expect(row.final_equity).toBe(1.23);
    expect(row.trade_count).toBe(42);
    expect(row.created_at).toBe(1000);
  });

  it('writes a failed entry with run_id NULL and verbatim error, metrics NULL', () => {
    service.saveChainEntry({
      chainId: 'K1', chainPosition: 1, signalId: 22, signalName: 'Sig-22',
      status: 'failed', error: 'insufficient bars for signal 22', createdAt: 1001,
    });

    const row = db.prepare(
      'SELECT * FROM nona_backtest_chain_entry WHERE chain_id = ? AND chain_position = ?',
    ).get('K1', 1) as Record<string, unknown>;
    expect(row.status).toBe('failed');
    expect(row.run_id).toBeNull();
    expect(row.error).toBe('insufficient bars for signal 22');
    expect(row.net_sharpe).toBeNull();
    expect(row.gross_sharpe).toBeNull();
    expect(row.trade_count).toBeNull();
  });

  it('writes a skipped entry (cancellation) with run_id NULL', () => {
    service.saveChainEntry({
      chainId: 'K1', chainPosition: 2, signalId: 33, signalName: 'Sig-33',
      status: 'skipped', createdAt: 1002,
    });
    const row = db.prepare(
      'SELECT * FROM nona_backtest_chain_entry WHERE chain_id = ? AND chain_position = ?',
    ).get('K1', 2) as Record<string, unknown>;
    expect(row.status).toBe('skipped');
    expect(row.run_id).toBeNull();
    expect(row.error).toBeNull();
  });

  it('rejects a duplicate (chain_id, chain_position) write (fail-fast, PK)', () => {
    service.saveChainEntry({
      chainId: 'K1', chainPosition: 0, signalId: 11, signalName: 'Sig-11',
      status: 'completed', runId: 500, createdAt: 1000,
    });
    expect(() => service.saveChainEntry({
      chainId: 'K1', chainPosition: 0, signalId: 11, signalName: 'Sig-11',
      status: 'completed', runId: 501, createdAt: 1000,
    })).toThrow(/UNIQUE|PRIMARY|constraint/i);
  });

  it('getChainEntryOutcomes returns [] for an unknown chain', () => {
    expect(service.getChainEntryOutcomes('no-such-chain')).toEqual([]);
  });

  it('getChainEntryOutcomes returns entries in chain_position order with verbatim error', () => {
    // Insert out of position order to prove ORDER BY.
    service.saveChainEntry({
      chainId: 'K2', chainPosition: 2, signalId: 33, signalName: 'Sig-33',
      status: 'skipped', createdAt: 2002,
    });
    service.saveChainEntry({
      chainId: 'K2', chainPosition: 0, signalId: 11, signalName: 'Sig-11',
      status: 'completed', runId: 700,
      netSharpe: 2.0, grossSharpe: 2.2, maxDrawdown: -0.2, finalEquity: 1.5,
      tradeCount: 10, createdAt: 2000,
    });
    service.saveChainEntry({
      chainId: 'K2', chainPosition: 1, signalId: 22, signalName: 'Sig-22',
      status: 'failed', error: 'predict crashed: NaN in features', createdAt: 2001,
    });

    const outcomes = service.getChainEntryOutcomes('K2');
    expect(outcomes.map((o) => o.signalId)).toEqual([11, 22, 33]);
    expect(outcomes.map((o) => o.status)).toEqual(['completed', 'failed', 'skipped']);
    // completed entry carries run_id + full metric snapshot
    expect(outcomes[0]).toEqual({
      signalId: 11, signalName: 'Sig-11', status: 'completed', runId: 700,
      netSharpe: 2.0, grossSharpe: 2.2, maxDrawdown: -0.2, finalEquity: 1.5,
      tradeCount: 10,
    });
    // failed entry: verbatim error, no runId, no metrics (TICKET_858)
    expect(outcomes[1]).toEqual({
      signalId: 22, signalName: 'Sig-22', status: 'failed',
      error: 'predict crashed: NaN in features',
    });
    // skipped entry: no runId, no error, no metrics
    expect(outcomes[2]).toEqual({ signalId: 33, signalName: 'Sig-33', status: 'skipped' });
  });

  it('listChains groups one row per chain, counts by status, orders by launch time desc', () => {
    // Chain OLD launched first (created_at 1000..1002).
    service.saveChainEntry({ chainId: 'OLD', chainPosition: 0, signalId: 1, signalName: 'a', status: 'completed', runId: 1, createdAt: 1002 });
    service.saveChainEntry({ chainId: 'OLD', chainPosition: 1, signalId: 2, signalName: 'b', status: 'failed', error: 'x', createdAt: 1000 });
    // Chain NEW launched later (created_at 3000..3002).
    service.saveChainEntry({ chainId: 'NEW', chainPosition: 0, signalId: 3, signalName: 'c', status: 'completed', runId: 2, createdAt: 3001 });
    service.saveChainEntry({ chainId: 'NEW', chainPosition: 1, signalId: 4, signalName: 'd', status: 'completed', runId: 3, createdAt: 3000 });
    service.saveChainEntry({ chainId: 'NEW', chainPosition: 2, signalId: 5, signalName: 'e', status: 'skipped', createdAt: 3002 });

    const chains = service.listChains(10);
    // Newest launch (MIN created_at 3000) first.
    expect(chains.map((c) => c.chainId)).toEqual(['NEW', 'OLD']);
    expect(chains[0]).toEqual({
      chainId: 'NEW', launchedAt: 3000, totalEntries: 3,
      completedCount: 2, failedCount: 0, skippedCount: 1,
    });
    expect(chains[1]).toEqual({
      chainId: 'OLD', launchedAt: 1000, totalEntries: 2,
      completedCount: 1, failedCount: 1, skippedCount: 0,
    });
  });

  it('listChains honours the limit', () => {
    service.saveChainEntry({ chainId: 'C1', chainPosition: 0, signalId: 1, signalName: 'a', status: 'completed', runId: 1, createdAt: 1000 });
    service.saveChainEntry({ chainId: 'C2', chainPosition: 0, signalId: 2, signalName: 'b', status: 'completed', runId: 2, createdAt: 2000 });
    service.saveChainEntry({ chainId: 'C3', chainPosition: 0, signalId: 3, signalName: 'c', status: 'completed', runId: 3, createdAt: 3000 });

    const chains = service.listChains(2);
    expect(chains).toHaveLength(2);
    expect(chains.map((c) => c.chainId)).toEqual(['C3', 'C2']); // newest two
  });

  it('completed run + its chain entry commit atomically in the same synchronous path', () => {
    // Simulate the executor's completed branch: saveRun (a transaction) returns
    // a run id, then saveChainEntry (also a transaction) writes the entry --
    // both committed, no window where the run exists without its entry.
    const runId = insertRun(db, { chainId: 'ATOM', chainPosition: 0, label: 'r' });
    service.saveChainEntry({
      chainId: 'ATOM', chainPosition: 0, signalId: 9, signalName: 'Sig-9',
      status: 'completed', runId, netSharpe: 1.1, createdAt: 5000,
    });

    const [outcome] = service.getChainEntryOutcomes('ATOM');
    expect(outcome.runId).toBe(runId);
    // The run row and the chain-entry row are both present + join-consistent.
    const runRow = db.prepare('SELECT chain_id, chain_position FROM nona_backtest_run WHERE id = ?').get(runId) as Record<string, unknown>;
    expect(runRow.chain_id).toBe('ATOM');
    expect(runRow.chain_position).toBe(0);
  });
});
