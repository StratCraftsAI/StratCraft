/**
 * TICKET_950: v97 migration unit test.
 *
 * Purges historical dangling nona_signal references from
 * `alpha_factory_config.signals`. Companion to the writer-side cascade
 * (cascade-soft-delete-signal.ts) -- the migration handles the backlog of
 * dangling chips accumulated BEFORE the cascade shipped.
 *
 * Approach: bootstrap an in-memory SQLite, declare the minimum schema the
 * migration touches, seed dirty data, drive the v97 migration through
 * MigrationManager.migrate() up to v97, and assert the post-state. We
 * stop at v97 (the manager runs everything ahead of the current schema
 * version, and we set schema_version = 96 so only v97 runs).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

// Mock the logger so test output stays clean and we can assert log calls.
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

import {
  EMBEDDED_MIGRATIONS_FOR_TEST,
  installElectronMigrationHost,
} from '../migrations/migration-manager';

beforeAll(async () => {
  await installElectronMigrationHost();
});

function createSeededDb(): BetterSqlite3Database {
  const db = new Database(':memory:');
  // Declare just the columns v97 needs. The v97 body only touches
  // nona_signal.id / nona_signal.deleted_at and alpha_factory_config.id /
  // alpha_factory_config.signals / alpha_factory_config.updated_at.
  db.exec(`
    CREATE TABLE nona_signal (
      id          TEXT PRIMARY KEY,
      deleted_at  TEXT
    );
    CREATE TABLE alpha_factory_config (
      id          TEXT PRIMARY KEY,
      signals     TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function runV97(db: BetterSqlite3Database): void {
  // The migration body is a `(db: DatabaseManager) => void` -- we pass a
  // DatabaseManager-shaped facade backed by better-sqlite3 directly.
  // Only .prepare(...) is touched by v97.
  const v97 = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 97);
  if (!v97) throw new Error('v97 migration not found in EMBEDDED_MIGRATIONS_FOR_TEST');
  if (typeof v97.up !== 'function') throw new Error('v97.up must be a function');
  const facade = {
    prepare: (sql: string) => db.prepare(sql),
  } as unknown as Parameters<typeof v97.up>[0];
  v97.up(facade);
}

describe('TICKET_950: v97 migration purges dangling AF chip refs', () => {
  let db: BetterSqlite3Database;
  beforeEach(() => { db = createSeededDb(); });
  afterEach(() => { db.close(); });

  it('drops chips whose id is not in the live nona_signal set', () => {
    // Live row.
    db.prepare(`INSERT INTO nona_signal (id, deleted_at) VALUES (?, NULL)`).run('10');
    // Soft-deleted row -- the migration must treat its id as NOT live.
    db.prepare(`INSERT INTO nona_signal (id, deleted_at) VALUES (?, ?)`).run('11', '2026-06-13 00:00:00');

    db.prepare(`INSERT INTO alpha_factory_config (id, signals) VALUES (?, ?)`).run(
      'af-A',
      JSON.stringify([
        { id: '10', name: 'live' },
        { id: '11', name: 'soft-deleted' },
        { id: '999', name: 'never-existed' },
      ]),
    );

    runV97(db);

    const after = JSON.parse(
      (db.prepare(`SELECT signals FROM alpha_factory_config WHERE id = ?`).get('af-A') as { signals: string }).signals,
    );
    expect(after).toEqual([{ id: '10', name: 'live' }]);
  });

  it('is idempotent on a clean DB (no AF config rows touched if no chips dangle)', () => {
    db.prepare(`INSERT INTO nona_signal (id, deleted_at) VALUES (?, NULL)`).run('10');
    db.prepare(`INSERT INTO alpha_factory_config (id, signals, updated_at) VALUES (?, ?, ?)`).run(
      'af-A',
      JSON.stringify([{ id: '10', name: 'live' }]),
      '2020-01-01 00:00:00',
    );

    runV97(db);

    const row = db.prepare(`SELECT signals, updated_at FROM alpha_factory_config WHERE id = ?`).get('af-A') as { signals: string; updated_at: string };
    expect(JSON.parse(row.signals)).toEqual([{ id: '10', name: 'live' }]);
    // Untouched timestamp -- the migration must not gratuitously bump
    // updated_at on rows with no dangling refs.
    expect(row.updated_at).toBe('2020-01-01 00:00:00');
  });

  it('handles zero AF config rows without error', () => {
    db.prepare(`INSERT INTO nona_signal (id, deleted_at) VALUES (?, NULL)`).run('10');
    expect(() => runV97(db)).not.toThrow();
  });

  it('matches numeric chip ids the same as string ids (legacy normalization)', () => {
    db.prepare(`INSERT INTO nona_signal (id, deleted_at) VALUES (?, NULL)`).run('7');
    // Legacy chip with numeric id.
    db.prepare(`INSERT INTO alpha_factory_config (id, signals) VALUES (?, ?)`).run(
      'af-A',
      JSON.stringify([{ id: 7, name: 'numeric-id' }, { id: '99', name: 'dangling' }]),
    );

    runV97(db);

    const after = JSON.parse(
      (db.prepare(`SELECT signals FROM alpha_factory_config WHERE id = ?`).get('af-A') as { signals: string }).signals,
    );
    expect(after).toEqual([{ id: 7, name: 'numeric-id' }]);
  });

  it('skips a row with malformed signals JSON without aborting other rows', () => {
    db.prepare(`INSERT INTO nona_signal (id, deleted_at) VALUES (?, NULL)`).run('10');
    db.prepare(`INSERT INTO alpha_factory_config (id, signals) VALUES (?, ?)`).run('af-A', 'not-json-at-all');
    db.prepare(`INSERT INTO alpha_factory_config (id, signals) VALUES (?, ?)`).run(
      'af-B',
      JSON.stringify([{ id: 'dangling', name: 'x' }]),
    );

    expect(() => runV97(db)).not.toThrow();
    // af-A is left as-is (the row is not corrupted further).
    expect((db.prepare(`SELECT signals FROM alpha_factory_config WHERE id = ?`).get('af-A') as { signals: string }).signals).toBe('not-json-at-all');
    // af-B was purged.
    expect(JSON.parse((db.prepare(`SELECT signals FROM alpha_factory_config WHERE id = ?`).get('af-B') as { signals: string }).signals)).toEqual([]);
  });

  it('drops chips with null/undefined id (malformed entries are not preserved)', () => {
    db.prepare(`INSERT INTO nona_signal (id, deleted_at) VALUES (?, NULL)`).run('10');
    db.prepare(`INSERT INTO alpha_factory_config (id, signals) VALUES (?, ?)`).run(
      'af-A',
      JSON.stringify([{ id: '10', name: 'live' }, { name: 'no-id' }, { id: null }]),
    );

    runV97(db);

    const after = JSON.parse(
      (db.prepare(`SELECT signals FROM alpha_factory_config WHERE id = ?`).get('af-A') as { signals: string }).signals,
    );
    expect(after).toEqual([{ id: '10', name: 'live' }]);
  });
});
