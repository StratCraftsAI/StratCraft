/**
 * Unit tests for backtest handler functions.
 * Tests bridge success, bridge failure with SQL fallback, bridge-only, and exception handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';

const { mockDiscoverServiceApi, mockApiClient } = vi.hoisted(() => ({
  mockDiscoverServiceApi: vi.fn(),
  mockApiClient: {
    listBacktestResults: vi.fn(),
    getBacktestResult: vi.fn(),
    runBacktest: vi.fn(),
    getBacktestStatus: vi.fn(),
    cancelBacktest: vi.fn(),
    getBacktestQueue: vi.fn(),
    cancelAllBacktests: vi.fn(),
    getBacktestPhase: vi.fn(),
    resumeBacktest: vi.fn(),
    getBacktestCandles: vi.fn(),
  },
}));

vi.mock('../../bridge/discovery', () => ({
  discoverServiceApi: mockDiscoverServiceApi,
}));

vi.mock('../../bridge/api-client', () => mockApiClient);

import {
  handleListBacktestResults,
  handleGetBacktestResult,
  handleRunBacktest,
  handleGetBacktestStatus,
  handleCancelBacktest,
  handleGetBacktestQueue,
  handleCancelAllBacktests,
  handleGetBacktestPhase,
  handleGetBacktestTaskHistory,
  handleDeleteBacktestResult,
  handleDeleteBacktestTaskHistory,
  handleResumeBacktest,
  handleGetBacktestCandles,
  handleGetBacktestRun,
  handleDeleteBacktestRun,
} from '../backtests';

const mockConfig = { baseUrl: 'http://localhost:19876', token: 'test-token' };

function createMockDb(allResult: unknown[] = [], getResult: unknown = undefined): Database.Database {
  return {
    prepare: vi.fn(() => ({
      all: vi.fn(() => allResult),
      get: vi.fn(() => getResult),
    })),
  } as unknown as Database.Database;
}

// ── TICKET_1276 P2 Batch A: list/get are Class-S storage reads. The former
// bridge-first branch was deleted; direct `desktop_backtest_results` SQL is the
// sole path (no bridge to mock). run/status/cancel/queue/cancelAll below stay
// Class-R (bridge-only) and keep exercising the bridge mock.
describe('handleListBacktestResults', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reads backtest results directly from SQL', async () => {
    const sqlRows = [{ task_id: 'bt-direct', total_pnl: 300 }];
    const db = createMockDb(sqlRows);

    const result = await handleListBacktestResults(db, { limit: 20 });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(sqlRows);
    expect(db.prepare).toHaveBeenCalled();
  });
});

describe('handleGetBacktestResult', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the row read directly from SQL', async () => {
    const sqlRow = { task_id: 'bt-sql', total_pnl: 100 };
    const db = createMockDb([], sqlRow);

    const result = await handleGetBacktestResult(db, { task_id: 'bt-sql' });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(sqlRow);
  });

  it('returns isError when the SQL row is not found', async () => {
    const db = createMockDb([], undefined);

    const result = await handleGetBacktestResult(db, { task_id: 'nonexistent' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });
});

describe('handleRunBacktest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns isError when no bridge config (Electron not running)', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);

    const result = await handleRunBacktest(createMockDb(), { algorithm_id: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Electron desktop app is not running');
  });

  it('returns data on bridge success', async () => {
    const responseData = { taskId: 'task-123', status: 'queued' };
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.runBacktest.mockResolvedValue({ success: true, data: responseData });

    const result = await handleRunBacktest(createMockDb(), { algorithm_id: 42, symbol: 'AAPL' });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(responseData);
    expect(mockApiClient.runBacktest).toHaveBeenCalledWith(mockConfig, { algorithm_id: 42, symbol: 'AAPL' });
  });

  it('returns isError on bridge failure response', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.runBacktest.mockResolvedValue({ success: false, error: 'Invalid algorithm' });

    const result = await handleRunBacktest(createMockDb(), { algorithm_id: 999 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Backtest execution failed');
    expect(result.content[0].text).toContain('Invalid algorithm');
  });

  it('returns isError on bridge exception', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.runBacktest.mockRejectedValue(new Error('Connection refused'));

    const result = await handleRunBacktest(createMockDb(), { algorithm_id: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Backtest execution error');
    expect(result.content[0].text).toContain('Connection refused');
  });
});

describe('handleGetBacktestStatus', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns isError when no bridge config (Electron not running)', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);

    const result = await handleGetBacktestStatus(createMockDb(), { task_id: 'task-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Electron desktop app is not running');
  });

  it('returns data on bridge success', async () => {
    const statusData = { task_id: 'task-1', status: 'completed' };
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.getBacktestStatus.mockResolvedValue({ success: true, data: statusData });

    const result = await handleGetBacktestStatus(createMockDb(), { task_id: 'task-1' });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(statusData);
  });

  it('returns isError on bridge failure response', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.getBacktestStatus.mockResolvedValue({ success: false, error: 'Task not found' });

    const result = await handleGetBacktestStatus(createMockDb(), { task_id: 'missing' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Backtest status query failed');
  });

  it('returns isError on bridge exception', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.getBacktestStatus.mockRejectedValue(new Error('Timeout'));

    const result = await handleGetBacktestStatus(createMockDb(), { task_id: 'task-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Backtest status error');
    expect(result.content[0].text).toContain('Timeout');
  });
});

// ── TICKET_1235_4: Backtest lifecycle tests ────────────────────────

describe('handleCancelBacktest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns isError when no bridge config (Electron not running)', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);

    const result = await handleCancelBacktest(createMockDb(), { task_id: 'task-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Electron desktop app is not running');
  });

  it('returns data on bridge success', async () => {
    const cancelData = { taskId: 'task-1', status: 'cancelled', wasAlreadyTerminal: false };
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.cancelBacktest.mockResolvedValue({ success: true, data: cancelData });

    const result = await handleCancelBacktest(createMockDb(), { task_id: 'task-1' });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(cancelData);
    expect(mockApiClient.cancelBacktest).toHaveBeenCalledWith(mockConfig, 'task-1');
  });

  it('returns isError on bridge failure (task not found, AC2)', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.cancelBacktest.mockResolvedValue({ success: false, error: 'Task not found' });

    const result = await handleCancelBacktest(createMockDb(), { task_id: 'unknown-id' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Backtest cancel failed');
  });

  it('returns isError on bridge exception', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.cancelBacktest.mockRejectedValue(new Error('Network error'));

    const result = await handleCancelBacktest(createMockDb(), { task_id: 'task-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Backtest cancel error');
    expect(result.content[0].text).toContain('Network error');
  });
});

describe('handleGetBacktestQueue', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns isError when no bridge config (Electron not running)', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);

    const result = await handleGetBacktestQueue(createMockDb());

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Electron desktop app is not running');
  });

  it('returns queue data on bridge success', async () => {
    const queueData = {
      tasks: [{ taskId: 'task-1', status: 'running', strategyName: 'MyStrategy', createdAt: 1720000000 }],
      activeCount: 1,
      queuedCount: 0,
    };
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.getBacktestQueue.mockResolvedValue({ success: true, data: queueData });

    const result = await handleGetBacktestQueue(createMockDb());

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(queueData);
  });

  it('returns isError on bridge exception', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.getBacktestQueue.mockRejectedValue(new Error('Connection refused'));

    const result = await handleGetBacktestQueue(createMockDb());

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Backtest queue error');
  });
});

describe('handleCancelAllBacktests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns isError when confirm is false (AC3)', async () => {
    const result = await handleCancelAllBacktests(createMockDb(), { confirm: false });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('confirm=true');
  });

  it('returns isError when no bridge config (Electron not running)', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);

    const result = await handleCancelAllBacktests(createMockDb(), { confirm: true });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Electron desktop app is not running');
  });

  it('returns data on bridge success', async () => {
    const cancelAllData = { cancelledCount: 3 };
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.cancelAllBacktests.mockResolvedValue({ success: true, data: cancelAllData });

    const result = await handleCancelAllBacktests(createMockDb(), { confirm: true });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(cancelAllData);
  });

  it('returns isError on bridge exception', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.cancelAllBacktests.mockRejectedValue(new Error('Timeout'));

    const result = await handleCancelAllBacktests(createMockDb(), { confirm: true });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cancel all backtests error');
  });
});

describe('TICKET_1302 U4+U5 lifecycle closure', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('queries live phase through the runtime bridge and propagates failure', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.getBacktestPhase.mockResolvedValue({
      success: true,
      data: { taskId: 'task-1', phase: 'execution' },
    });
    expect(JSON.parse((await handleGetBacktestPhase(createMockDb(), { task_id: 'task-1' })).content[0].text))
      .toEqual({ taskId: 'task-1', phase: 'execution' });

    mockApiClient.getBacktestPhase.mockResolvedValue({ success: false, error: 'Task not found' });
    expect((await handleGetBacktestPhase(createMockDb(), { task_id: 'missing' })).isError).toBe(true);
    mockApiClient.getBacktestPhase.mockRejectedValue(new Error('offline'));
    expect((await handleGetBacktestPhase(createMockDb(), { task_id: 'task-1' })).content[0].text)
      .toContain('offline');
  });

  it('requires Electron for phase, resume, and candle runtime operations', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);
    expect((await handleGetBacktestPhase(createMockDb(), { task_id: 't' })).isError).toBe(true);
    expect((await handleResumeBacktest(createMockDb(), { task_id: 't' })).isError).toBe(true);
    expect((await handleGetBacktestCandles(createMockDb(), { task_id: 't' })).isError).toBe(true);
  });

  it('resumes and fetches bounded candles through the runtime bridge', async () => {
    mockDiscoverServiceApi.mockReturnValue(mockConfig);
    mockApiClient.resumeBacktest.mockResolvedValue({ success: true, data: { taskId: 't' } });
    expect((await handleResumeBacktest(createMockDb(), { task_id: 't' })).isError).toBeUndefined();
    mockApiClient.getBacktestCandles.mockResolvedValue({
      success: true,
      data: { candles: [{ timestamp: 1 }] },
    });
    const params = { task_id: 't' };
    expect(JSON.parse((await handleGetBacktestCandles(createMockDb(), params)).content[0].text))
      .toEqual({ candles: [{ timestamp: 1 }] });
    expect(mockApiClient.getBacktestCandles).toHaveBeenCalledWith(mockConfig, 't');
  });

  it('reads task history and enforces T2 plus not-found semantics for deletions', async () => {
    const rows = [{ task_id: 'failed-1' }];
    const historyDb = createMockDb(rows);
    expect(JSON.parse((await handleGetBacktestTaskHistory(historyDb, { limit: 3 })).content[0].text))
      .toEqual(rows);

    const deleteDb = {
      prepare: vi.fn(() => ({ run: vi.fn(() => ({ changes: 1 })) })),
    } as unknown as Database.Database;
    expect((await handleDeleteBacktestResult(deleteDb, { task_id: 'r', confirm: false })).isError).toBe(true);
    expect((await handleDeleteBacktestResult(deleteDb, { task_id: 'r', confirm: true })).isError).toBeUndefined();
    expect((await handleDeleteBacktestTaskHistory(deleteDb, { task_id: 'h', confirm: true })).isError).toBeUndefined();

    const missingDb = {
      prepare: vi.fn(() => ({ run: vi.fn(() => ({ changes: 0 })) })),
    } as unknown as Database.Database;
    expect((await handleDeleteBacktestResult(missingDb, { task_id: 'missing', confirm: true })).isError).toBe(true);
  });

  it('gets and T2-deletes persisted backtest runs', async () => {
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.startsWith('DELETE')) return { run: vi.fn(() => ({ changes: 1 })) };
        if (sql.includes('FROM nona_backtest_run WHERE')) return { get: vi.fn(() => ({ id: 9 })) };
        if (sql.includes('nona_backtest_run_combinator')) return { get: vi.fn(() => undefined) };
        return { all: vi.fn(() => []) };
      }),
    } as unknown as Database.Database;
    expect(JSON.parse((await handleGetBacktestRun(db, { run_id: 9 })).content[0].text))
      .toEqual({ id: 9, books: [], signals: [], combinator: null });
    expect((await handleDeleteBacktestRun(db, { run_id: 9, confirm: false })).isError).toBe(true);
    expect((await handleDeleteBacktestRun(db, { run_id: 9, confirm: true })).isError).toBeUndefined();
  });
});
