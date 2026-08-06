/**
 * DiscoveryRunHistoryService Unit Tests
 *
 * TICKET_912 Phase 2: stable run numbering via run_number column.
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

import { DiscoveryRunHistoryService } from '../discovery-run-history-service';
import type { DatabaseManager } from '../../db-manager';

function createMockDb() {
  const stmtRun = vi.fn();
  const stmtGet = vi.fn().mockReturnValue(undefined);
  const stmtAll = vi.fn().mockReturnValue([]);
  const stmtMock = { run: stmtRun, get: stmtGet, all: stmtAll };
  const db = {
    prepare: vi.fn().mockReturnValue(stmtMock),
  } as unknown as DatabaseManager;
  return { db, stmtMock, stmtRun, stmtGet, stmtAll };
}

function makeEntry(id: string) {
  return {
    id,
    timestamp: Date.now(),
    status: 'running',
    saturation_level: 'green',
    signal_count: 0,
    signal_name: null,
    config_signal_layer: 'layer_1',
    config_categories_json: '[]',
    config_hypotheses_count: 5,
    config_batch_size: 3,
    snapshot_json: null,
  };
}

describe('DiscoveryRunHistoryService', () => {
  let db: DatabaseManager;
  let stmtRun: ReturnType<typeof vi.fn>;
  let service: DiscoveryRunHistoryService;

  beforeEach(() => {
    const mock = createMockDb();
    db = mock.db;
    stmtRun = mock.stmtRun;
    service = new DiscoveryRunHistoryService(db);
  });

  describe('saveRun -- run_number assignment (TICKET_912 Phase 2)', () => {
    it('SQL includes run_number column with COALESCE auto-increment', () => {
      service.saveRun(makeEntry('run-1'));
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('run_number');
      expect(sql).toContain('COALESCE');
      expect(sql).toContain('MAX(run_number)');
    });

    it('passes entry.id twice -- once for the row, once for the COALESCE sub-select', () => {
      const entry = makeEntry('run-abc');
      service.saveRun(entry);
      const args = stmtRun.mock.calls[0];
      expect(args[0]).toBe('run-abc');
      expect(args[args.length - 1]).toBe('run-abc');
    });
  });

  describe('getHistory', () => {
    it('returns rows via SELECT * (includes run_number)', () => {
      service.getHistory(10);
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('SELECT *');
      expect(sql).toContain('ORDER BY created_at DESC');
    });
  });

  describe('updateRun -- no run_number mutation', () => {
    it('does not include run_number in SET clauses', () => {
      service.updateRun('run-1', { status: 'completed' });
      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).not.toContain('run_number');
    });
  });
});
