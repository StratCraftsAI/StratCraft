/**
 * OpenTabsService Unit Tests
 *
 * TICKET_424_2F: Tests for open tab persistence, transaction-based save,
 * boolean->int conversion, and retrieval.
 * TICKET_718: Tests for stale task_id filtering (foreign key guard).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  dbLog: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { OpenTabsService } from '../open-tabs-service';
import type { DatabaseManager } from '../../db-manager';

function createMockDb(existingTaskIds: Set<string> = new Set(['t1', 't2'])) {
  const deleteStmt = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
  const insertStmt = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
  const existsStmt = {
    run: vi.fn(),
    get: vi.fn().mockImplementation((taskId: string) =>
      existingTaskIds.has(taskId) ? { '1': 1 } : undefined
    ),
    all: vi.fn(),
  };
  const selectStmt = { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
  let prepareCallIndex = 0;
  const stmts = [deleteStmt, insertStmt, existsStmt, selectStmt];

  const db = {
    prepare: vi.fn().mockImplementation(() => stmts[prepareCallIndex++] || selectStmt),
    transaction: vi.fn((fn: () => any) => {
      // Return a function that executes fn (matching better-sqlite3 transaction API)
      return fn;
    }),
  } as unknown as DatabaseManager;
  return { db, deleteStmt, insertStmt, existsStmt, selectStmt };
}

describe('OpenTabsService', () => {
  let db: DatabaseManager;
  let deleteStmt: ReturnType<typeof createMockDb>['deleteStmt'];
  let insertStmt: ReturnType<typeof createMockDb>['insertStmt'];
  let existsStmt: ReturnType<typeof createMockDb>['existsStmt'];
  let selectStmt: ReturnType<typeof createMockDb>['selectStmt'];
  let service: OpenTabsService;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db, deleteStmt, insertStmt, existsStmt, selectStmt } = createMockDb());
    service = new OpenTabsService(db);
  });

  // =========================================================================
  // saveOpenTabs
  // =========================================================================

  describe('saveOpenTabs', () => {
    it('should DELETE all + INSERT in transaction with boolean->int conversion', () => {
      service.saveOpenTabs([
        { taskId: 't1', strategyName: 'S1', isActive: true, lastAccessedAt: 1000 },
        { taskId: 't2', strategyName: 'S2', isActive: false, lastAccessedAt: 2000 },
      ]);

      expect(db.transaction).toHaveBeenCalled();
      expect(deleteStmt.run).toHaveBeenCalled();
      expect(insertStmt.run).toHaveBeenCalledTimes(2);
      expect(insertStmt.run).toHaveBeenCalledWith('t1', 'S1', 1, 1000);
      expect(insertStmt.run).toHaveBeenCalledWith('t2', 'S2', 0, 2000);
    });

    it('should only delete when array is empty', () => {
      service.saveOpenTabs([]);

      expect(deleteStmt.run).toHaveBeenCalled();
      expect(insertStmt.run).not.toHaveBeenCalled();
    });

    it('should skip tabs whose task_id does not exist in desktop_backtest_results', () => {
      // Only t1 exists in backtest_results
      ({ db, deleteStmt, insertStmt, existsStmt, selectStmt } = createMockDb(new Set(['t1'])));
      service = new OpenTabsService(db);

      service.saveOpenTabs([
        { taskId: 't1', strategyName: 'S1', isActive: true, lastAccessedAt: 1000 },
        { taskId: 'stale-task', strategyName: 'Gone', isActive: false, lastAccessedAt: 2000 },
      ]);

      expect(deleteStmt.run).toHaveBeenCalled();
      expect(existsStmt.get).toHaveBeenCalledWith('t1');
      expect(existsStmt.get).toHaveBeenCalledWith('stale-task');
      expect(insertStmt.run).toHaveBeenCalledTimes(1);
      expect(insertStmt.run).toHaveBeenCalledWith('t1', 'S1', 1, 1000);
    });

    it('should insert nothing when all task_ids are stale', () => {
      ({ db, deleteStmt, insertStmt, existsStmt, selectStmt } = createMockDb(new Set()));
      service = new OpenTabsService(db);

      service.saveOpenTabs([
        { taskId: 'gone1', strategyName: 'S1', isActive: true, lastAccessedAt: 1000 },
        { taskId: 'gone2', strategyName: 'S2', isActive: false, lastAccessedAt: 2000 },
      ]);

      expect(deleteStmt.run).toHaveBeenCalled();
      expect(insertStmt.run).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getOpenTabs
  // =========================================================================

  describe('getOpenTabs', () => {
    it('should ORDER BY last_accessed_at ASC', () => {
      // Reset mock to use a fresh prepare for getOpenTabs
      const getStmt = { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([{ task_id: 't1' }]) };
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(getStmt);

      const results = service.getOpenTabs();

      expect(results).toHaveLength(1);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.lastCall![0] as string;
      expect(sql).toContain('ORDER BY last_accessed_at ASC');
    });
  });

  // =========================================================================
  // clearOpenTabs
  // =========================================================================

  describe('clearOpenTabs', () => {
    it('should DELETE all', () => {
      const clearStmt = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(clearStmt);

      service.clearOpenTabs();

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.lastCall![0] as string;
      expect(sql).toContain('DELETE FROM desktop_open_tabs');
      expect(clearStmt.run).toHaveBeenCalled();
    });
  });
});
