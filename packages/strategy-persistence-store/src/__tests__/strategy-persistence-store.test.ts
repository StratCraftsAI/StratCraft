import { describe, expect, it, vi } from 'vitest';
import {
  getAuditByAlgorithm,
  listAuditEntries,
  listDeletedStrategies,
  purgeDeletedStrategy,
  restoreDeletedStrategy,
  type SqliteDatabase,
} from '../index';

function databaseWithStatement(statement: {
  get?: (...params: unknown[]) => unknown;
  all?: (...params: unknown[]) => unknown[];
  run?: (...params: unknown[]) => { changes: number };
}) {
  const prepared = {
    get: vi.fn(statement.get ?? (() => undefined)),
    all: vi.fn(statement.all ?? (() => [])),
    run: vi.fn(statement.run ?? (() => ({ changes: 1 }))),
  };
  const db = {
    prepare: vi.fn(() => prepared),
  } as unknown as SqliteDatabase;
  return { db, prepared, prepare: db.prepare as ReturnType<typeof vi.fn> };
}

describe('strategy persistence store', () => {
  it('lists deleted strategies with no pagination clauses by default', () => {
    const rows = [{ id: 1, deleted_at: '2026-07-26' }];
    const { db, prepared, prepare } = databaseWithStatement({ all: () => rows });

    expect(listDeletedStrategies(db)).toEqual(rows);
    expect(prepare.mock.calls[0][0]).not.toContain('LIMIT');
    expect(prepared.all).toHaveBeenCalledWith({});
  });

  it('pushes limit and offset into the deleted-strategy query', () => {
    const { db, prepared, prepare } = databaseWithStatement({});

    listDeletedStrategies(db, { limit: 20, offset: 40 });

    expect(prepare.mock.calls[0][0]).toContain('LIMIT @limit OFFSET @offset');
    expect(prepared.all).toHaveBeenCalledWith({ limit: 20, offset: 40 });
  });

  it('supports an offset without a limit using SQLite LIMIT -1', () => {
    const { db, prepared, prepare } = databaseWithStatement({});

    listDeletedStrategies(db, { offset: 3 });

    expect(prepare.mock.calls[0][0]).toContain('LIMIT -1 OFFSET @offset');
    expect(prepared.all).toHaveBeenCalledWith({ offset: 3 });
  });

  it('restores only a strategy that is currently soft-deleted', () => {
    const { db, prepared } = databaseWithStatement({ run: () => ({ changes: 1 }) });

    expect(() => restoreDeletedStrategy(db, 7)).not.toThrow();
    expect(prepared.run).toHaveBeenCalledWith(7);
  });

  it('rejects restore when the strategy is absent from the recycle bin', () => {
    const { db } = databaseWithStatement({ run: () => ({ changes: 0 }) });

    expect(() => restoreDeletedStrategy(db, 7)).toThrow(
      'Record 7 not found in nona_algorithms or not deleted',
    );
  });

  it('purges only a strategy that is currently soft-deleted', () => {
    const { db, prepared } = databaseWithStatement({ run: () => ({ changes: 1 }) });

    expect(() => purgeDeletedStrategy(db, 9)).not.toThrow();
    expect(prepared.run).toHaveBeenCalledWith(9);
  });

  it('rejects purge when the strategy is absent from the recycle bin', () => {
    const { db } = databaseWithStatement({ run: () => ({ changes: 0 }) });

    expect(() => purgeDeletedStrategy(db, 9)).toThrow(
      'Record 9 not found in nona_algorithms or not soft-deleted',
    );
  });

  it('returns the newest audit for an algorithm or null when none exists', () => {
    const record = { id: 3, algorithm_id: 8 };
    const found = databaseWithStatement({ get: () => record });
    const missing = databaseWithStatement({ get: () => undefined });

    expect(getAuditByAlgorithm(found.db, 8)).toEqual(record);
    expect(found.prepared.get).toHaveBeenCalledWith(8);
    expect(getAuditByAlgorithm(missing.db, 8)).toBeNull();
  });

  it('lists audits with every desktop-supported filter and an explicit limit', () => {
    const rows = [{ id: 1, algorithm_id: 2 }];
    const { db, prepared, prepare } = databaseWithStatement({ all: () => rows });

    expect(listAuditEntries(db, {
      signal_source: 'indicator_detector',
      llm_provider: 'openai',
      llm_model: 'gpt',
      min_star: 2,
      max_star: 5,
      limit: 25,
    })).toEqual(rows);
    const sql = String(prepare.mock.calls[0][0]);
    expect(sql).toContain('signal_source = @signal_source');
    expect(sql).toContain('llm_provider = @llm_provider');
    expect(sql).toContain('llm_model = @llm_model');
    expect(sql).toContain('star_rating >= @min_star');
    expect(sql).toContain('star_rating <= @max_star');
    expect(prepared.all).toHaveBeenCalledWith({
      signal_source: 'indicator_detector',
      llm_provider: 'openai',
      llm_model: 'gpt',
      min_star: 2,
      max_star: 5,
      limit: 25,
    });
  });

  it('lists unfiltered audits with the authoritative default limit', () => {
    const { db, prepared, prepare } = databaseWithStatement({});

    listAuditEntries(db);

    expect(prepare.mock.calls[0][0]).not.toContain(' WHERE ');
    expect(prepared.all).toHaveBeenCalledWith({ limit: 100 });
  });

  it('preserves the desktop empty-filter and zero-limit fallback behavior', () => {
    const { db, prepared, prepare } = databaseWithStatement({});

    listAuditEntries(db, {
      signal_source: '',
      llm_provider: '',
      llm_model: '',
      limit: 0,
    });

    expect(prepare.mock.calls[0][0]).not.toContain(' WHERE ');
    expect(prepared.all).toHaveBeenCalledWith({ limit: 100 });
  });
});
