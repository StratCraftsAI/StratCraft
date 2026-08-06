import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resultRecord: undefined as undefined | Record<string, unknown>,
  queueTask: undefined as undefined | Record<string, unknown>,
  executorTask: undefined as undefined | Record<string, unknown>,
  loadConfig: undefined as undefined | Record<string, unknown>,
  queueEnqueue: vi.fn(),
  readCacheInWindow: vi.fn(),
  enqueueAndAwait: vi.fn(),
  checkpointRow: { bar_index: 25 } as undefined | { bar_index: number },
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/user-data',
    getAppPath: () => '/app',
  },
}));

vi.mock('fs', () => ({
  existsSync: () => true,
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('better-sqlite3', () => ({
  default: class MockDatabase {
    prepare() {
      return { get: () => mocks.checkpointRow };
    }
    close() {}
  },
}));

vi.mock('../../../database/db-manager', () => ({
  getDatabaseManager: () => ({}),
}));

vi.mock('../../../database/services/backtest-result-service', () => ({
  BacktestResultService: class {
    getByTaskId() {
      return mocks.resultRecord;
    }
  },
}));

vi.mock('../../executor-queue-service', () => ({
  getBacktestQueue: () => ({
    getTaskStatus: () => mocks.queueTask,
    enqueue: mocks.queueEnqueue,
  }),
}));

vi.mock('../../executor-service', () => ({
  getExecutorService: () => ({
    getTask: () => mocks.executorTask,
  }),
}));

vi.mock('../../data-download-queue', () => ({
  enqueueAndAwait: mocks.enqueueAndAwait,
  getDataDownloadQueue: vi.fn(),
}));

vi.mock('../../parquet-cache-service', () => ({
  getParquetCacheService: () => ({
    readCacheInWindow: mocks.readCacheInWindow,
  }),
}));

vi.mock('../../backtest-resume-config-service', () => ({
  loadBacktestResumeConfig: () => mocks.loadConfig,
  persistBacktestResumeConfig: vi.fn(),
}));

vi.mock('../../algorithm-compilation-service', () => ({
  buildCompilableCppSource: vi.fn(),
  getCppArtifactPath: vi.fn(),
  getAlgorithmCompilationService: vi.fn(),
  hashCppStrategySource: vi.fn(),
  separateCppIncludes: vi.fn(),
}));

vi.mock('../../compiler-resolver', () => ({
  getCompilerResolver: vi.fn(),
}));

import {
  getBacktestCandles,
  getBacktestPhase,
  resumeBacktest,
} from '../backtest-api';

const executorConfig = {
  taskId: 'task-1',
  strategyPath: '/strategy.cpp',
  frameworkPath: '/framework',
  outputDir: '/output',
  data: {
    symbol: 'AAPL',
    interval: '1d',
    startTime: 1,
    endTime: 2,
    dataPath: '/data.parquet',
    dataSourceType: 'parquet',
  },
  execution: {
    initialCapital: 100,
    commission: 0,
    slippage: 0,
    allowShort: true,
    maxPositionSize: 1,
  },
  strategy: { params: {} },
};

describe('TICKET_1302 backtest lifecycle Main service API', () => {
  beforeEach(() => {
    mocks.resultRecord = undefined;
    mocks.queueTask = undefined;
    mocks.executorTask = undefined;
    mocks.loadConfig = undefined;
    mocks.checkpointRow = { bar_index: 25 };
    mocks.queueEnqueue.mockReset().mockReturnValue({
      taskId: 'task-1',
      cancelled: false,
    });
    mocks.readCacheInWindow.mockReset().mockResolvedValue([{ timestamp: 1 }]);
    mocks.enqueueAndAwait.mockReset();
  });

  it('returns live phase and rejects an unknown runtime task', async () => {
    mocks.queueTask = { taskId: 'task-1' };
    mocks.executorTask = { lastPhase: 'execution' };
    await expect(getBacktestPhase('task-1')).resolves.toEqual({
      success: true,
      data: { taskId: 'task-1', phase: 'execution' },
    });
    mocks.queueTask = undefined;
    mocks.executorTask = undefined;
    expect((await getBacktestPhase('missing')).success).toBe(false);
  });

  it('resolves candle path and window exclusively from the persisted result', async () => {
    mocks.resultRecord = {
      task_id: 'task-1',
      symbol: 'AAPL',
      timeframe: '1d',
      start_date: '2024-01-01',
      end_date: '2024-01-31',
      data_path: '/authoritative.parquet',
    };
    const result = await getBacktestCandles({ task_id: 'task-1' });
    expect(result).toEqual({ success: true, data: { candles: [{ timestamp: 1 }] } });
    expect(mocks.readCacheInWindow).toHaveBeenCalledWith(
      '/authoritative.parquet',
      new Date('2024-01-01').getTime() / 1000,
      new Date('2024-01-31').getTime() / 1000,
    );
    expect(mocks.enqueueAndAwait).not.toHaveBeenCalled();
  });

  it('rejects unknown results and invalid persisted windows', async () => {
    expect((await getBacktestCandles({ task_id: 'missing' })).error).toContain('not found');
    mocks.resultRecord = {
      symbol: 'AAPL',
      timeframe: '1d',
      start_date: 'invalid',
      end_date: '2024-01-31',
      data_path: '/data.parquet',
    };
    expect((await getBacktestCandles({ task_id: 'task-1' })).error).toContain('Invalid');
  });

  it('resumes after restart from encrypted config and the latest checkpoint bar', async () => {
    mocks.loadConfig = executorConfig;
    const result = await resumeBacktest('task-1');
    expect(result).toEqual({ success: true, data: { taskId: 'task-1' } });
    expect(mocks.queueEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      resume: { enabled: true, taskId: 'task-1', fromBar: 25 },
    }));
  });

  it('fails explicitly when resume config, checkpoint, or queue admission is unavailable', async () => {
    expect((await resumeBacktest('task-1')).error).toContain('configuration is unavailable');
    mocks.loadConfig = executorConfig;
    mocks.checkpointRow = undefined;
    expect((await resumeBacktest('task-1')).error).toContain('not found');
    mocks.checkpointRow = { bar_index: 25 };
    mocks.queueEnqueue.mockReturnValue({
      taskId: 'task-1',
      cancelled: false,
      error: 'Backtest queue is full',
    });
    expect((await resumeBacktest('task-1')).error).toContain('queue is full');
    mocks.queueEnqueue.mockReturnValue({
      taskId: 'task-1',
      cancelled: true,
    });
    expect((await resumeBacktest('task-1')).error).toContain('cancelled');
  });
});
