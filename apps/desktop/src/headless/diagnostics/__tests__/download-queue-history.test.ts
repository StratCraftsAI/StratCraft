import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../bootstrap', () => ({
  HeadlessBootstrap: {
    init: vi.fn().mockResolvedValue(undefined),
  },
}));

const prepareMock = vi.fn();
const mockDb = { prepare: prepareMock };

vi.mock('../../../main/database/db-manager', () => ({
  getDatabaseManager: () => ({ getDb: () => mockDb }),
}));

import mod from '../download-queue-history';

function setupDb(rows: Record<string, unknown>[], statusCounts: { status: string; cnt: number }[]) {
  prepareMock.mockImplementation((sql: string) => {
    if (sql.includes('GROUP BY')) {
      return { all: () => statusCounts };
    }
    return { all: (..._args: unknown[]) => rows };
  });
}

describe('download-queue-history diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads download_queue rows', async () => {
    const rows = [
      { task_id: 't1', symbol: 'EURUSD', status: 'completed', error: null },
      { task_id: 't2', symbol: 'GBPUSD', status: 'failed', error: 'Timeout' },
    ];
    setupDb(rows, [{ status: 'completed', cnt: 1 }, { status: 'failed', cnt: 1 }]);

    const result = await mod.run({});
    expect(result.name).toBe('download-queue-history');
    expect(result.details.rowCount).toBe(2);
    expect(result.details.statusCounts).toEqual({ completed: 1, failed: 1 });
  });

  it('fails when there are error rows', async () => {
    const rows = [
      { task_id: 't1', status: 'failed', error: 'Timeout after 30s' },
    ];
    setupDb(rows, [{ status: 'failed', cnt: 1 }]);

    const result = await mod.run({});
    expect(result.pass).toBe(false);
    expect(result.details.errorCount).toBe(1);
  });

  it('passes when no errors', async () => {
    const rows = [
      { task_id: 't1', status: 'completed', error: null },
    ];
    setupDb(rows, [{ status: 'completed', cnt: 1 }]);

    const result = await mod.run({});
    expect(result.pass).toBe(true);
  });

  it('returns valid DiagResult shape', async () => {
    setupDb([], []);

    const result = await mod.run({});
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('pass');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('details');
    expect(result).toHaveProperty('durationMs');
    expect(typeof result.durationMs).toBe('number');
  });

  it('summary includes total counts', async () => {
    setupDb([], [{ status: 'completed', cnt: 10 }, { status: 'queued', cnt: 3 }]);

    const result = await mod.run({});
    expect(result.summary).toContain('13 total tasks');
    expect(result.summary).toContain('completed=10');
    expect(result.summary).toContain('queued=3');
  });
});
