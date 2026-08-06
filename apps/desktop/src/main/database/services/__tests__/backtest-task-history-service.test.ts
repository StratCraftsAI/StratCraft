/**
 * BacktestTaskHistoryService Unit Tests
 *
 * TICKET_424_2C: Tests for terminal-state task persistence (failed/cancelled),
 * retrieval with ordering, and deletion.
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

import { BacktestTaskHistoryService } from '../backtest-task-history-service';
import type { DatabaseManager } from '../../db-manager';

function createMockDb() {
  const stmtMock = {
    run: vi.fn().mockReturnValue({ changes: 1 }),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  };
  const db = {
    prepare: vi.fn().mockReturnValue(stmtMock),
  } as unknown as DatabaseManager;
  return { db, stmtMock };
}

describe('BacktestTaskHistoryService', () => {
  let db: DatabaseManager;
  let stmtMock: ReturnType<typeof createMockDb>['stmtMock'];
  let service: BacktestTaskHistoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db, stmtMock } = createMockDb());
    service = new BacktestTaskHistoryService(db);
  });

  // =========================================================================
  // saveTask
  // =========================================================================

  describe('saveTask', () => {
    it('should INSERT OR REPLACE with finished_at=Date.now()', () => {
      const now = 1700000000000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      service.saveTask({
        task_id: 'task-1',
        strategy_name: 'Strategy A',
        status: 'failed',
        error_message: 'timeout',
        created_at: 1699999000000,
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('INSERT OR REPLACE INTO desktop_backtest_task_history');
      const args = stmtMock.run.mock.calls[0];
      expect(args[0]).toBe('task-1');
      expect(args[1]).toBe('Strategy A');
      expect(args[2]).toBe('failed');
      expect(args[3]).toBe('timeout');
      expect(args[5]).toBe(now); // finished_at
    });
  });

  // =========================================================================
  // getTerminalTasks
  // =========================================================================

  describe('getTerminalTasks', () => {
    it('should filter status IN (failed, cancelled) with ORDER BY DESC', () => {
      stmtMock.all.mockReturnValue([{ task_id: 't1', status: 'failed' }]);
      const results = service.getTerminalTasks();

      expect(results).toHaveLength(1);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain("status IN ('failed', 'cancelled')");
      expect(sql).toContain('ORDER BY finished_at DESC');
    });

    it('should default limit to 50', () => {
      service.getTerminalTasks();
      expect(stmtMock.all).toHaveBeenCalledWith(50);
    });

    it('should accept custom limit', () => {
      service.getTerminalTasks(10);
      expect(stmtMock.all).toHaveBeenCalledWith(10);
    });
  });

  // =========================================================================
  // deleteByTaskId
  // =========================================================================

  describe('deleteByTaskId', () => {
    it('should execute DELETE', () => {
      service.deleteByTaskId('task-1');
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('DELETE FROM desktop_backtest_task_history WHERE task_id = ?');
      expect(stmtMock.run).toHaveBeenCalledWith('task-1');
    });
  });
});
