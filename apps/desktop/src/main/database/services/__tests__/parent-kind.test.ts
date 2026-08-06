/**
 * resolveParentKind Unit Tests
 *
 * TICKET_762 R1: parent-kind resolver dispatches a bare algorithm id to the
 * owning table (nona_algorithms vs nona_signal). Soft-deleted rows are
 * treated as absent. Order of lookup is nona_algorithms first (older /
 * larger pool); resolver returns on the first hit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resolveParentKind } from '../parent-kind';
import type { DatabaseManager } from '../../db-manager';

function createMockDb() {
  const algoStmt = { get: vi.fn() };
  const signalStmt = { get: vi.fn() };
  const prepare = vi.fn((sql: string) => {
    if (sql.includes('FROM nona_algorithms')) return algoStmt;
    if (sql.includes('FROM nona_signal')) return signalStmt;
    throw new Error(`unexpected SQL in resolveParentKind: ${sql}`);
  });
  const db = { prepare } as unknown as DatabaseManager;
  return { db, prepare, algoStmt, signalStmt };
}

describe('resolveParentKind', () => {
  let mocks: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMockDb();
  });

  it('returns "algorithm" when the id exists in nona_algorithms', () => {
    mocks.algoStmt.get.mockReturnValue({ '1': 1 });
    expect(resolveParentKind(mocks.db, 42)).toBe('algorithm');
    expect(mocks.algoStmt.get).toHaveBeenCalledWith(42);
    // Short-circuits: nona_signal is never queried on algorithm hit.
    expect(mocks.signalStmt.get).not.toHaveBeenCalled();
  });

  it('returns "signal" when the id exists only in nona_signal', () => {
    mocks.algoStmt.get.mockReturnValue(undefined);
    mocks.signalStmt.get.mockReturnValue({ '1': 1 });
    expect(resolveParentKind(mocks.db, 7)).toBe('signal');
    expect(mocks.algoStmt.get).toHaveBeenCalledWith(7);
    expect(mocks.signalStmt.get).toHaveBeenCalledWith(7);
  });

  it('returns null when the id is in neither table', () => {
    mocks.algoStmt.get.mockReturnValue(undefined);
    mocks.signalStmt.get.mockReturnValue(undefined);
    expect(resolveParentKind(mocks.db, 999)).toBeNull();
    expect(mocks.algoStmt.get).toHaveBeenCalledWith(999);
    expect(mocks.signalStmt.get).toHaveBeenCalledWith(999);
  });

  it('checks nona_algorithms first (older / larger pool)', () => {
    mocks.algoStmt.get.mockReturnValue(undefined);
    mocks.signalStmt.get.mockReturnValue(undefined);
    resolveParentKind(mocks.db, 1);

    // First prepared statement must select FROM nona_algorithms.
    const firstSql = mocks.prepare.mock.calls[0][0] as string;
    const secondSql = mocks.prepare.mock.calls[1][0] as string;
    expect(firstSql).toContain('FROM nona_algorithms');
    expect(secondSql).toContain('FROM nona_signal');
  });

  it('applies soft-delete filter (deleted_at IS NULL) on both lookups', () => {
    mocks.algoStmt.get.mockReturnValue(undefined);
    mocks.signalStmt.get.mockReturnValue(undefined);
    resolveParentKind(mocks.db, 1);

    const algoSql = mocks.prepare.mock.calls[0][0] as string;
    const signalSql = mocks.prepare.mock.calls[1][0] as string;
    expect(algoSql).toContain('deleted_at IS NULL');
    expect(signalSql).toContain('deleted_at IS NULL');
  });

  it('treats soft-deleted rows as absent (resolver short-circuits to signal)', () => {
    // nona_algorithms returns undefined for soft-deleted ids because the
    // query includes `deleted_at IS NULL`. The resolver therefore falls
    // through to nona_signal -- this test pins that semantics.
    mocks.algoStmt.get.mockReturnValue(undefined);
    mocks.signalStmt.get.mockReturnValue({ '1': 1 });
    expect(resolveParentKind(mocks.db, 100)).toBe('signal');
  });
});
