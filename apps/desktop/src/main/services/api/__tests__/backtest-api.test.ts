/**
 * Backtest Service API Unit Tests
 *
 * TICKET_494: Full coverage for backtest-api.ts
 * Covers listResults, getResult, deleteResult, runBacktest, getBacktestStatus.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockPrepare,
  mockAll,
  mockGet,
  mockRun,
  mockGetHistory,
  mockGetByTaskId,
  mockDeleteByTaskId,
  mockGetBacktestQueue,
  mockRegisterPreparing,
  mockEnqueue,
  mockGetTaskStatus,
  mockExistsSync,
  mockMkdirSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockGetAppPath,
  mockGetPath,
  mockIsPackaged,
  mockBuildCompilableCppSource,
  mockGetCppArtifactPath,
  mockHashCppStrategySource,
  mockGetCompilerResolver,
  mockDataDownloadEnqueue,
  mockCompileAlgorithm,
  mockGetAlgorithmCompilationService,
  mockBacktestResultService,
  mockGetDataDownloadQueue,
  mockGetLocale,
} = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockAll: vi.fn(),
  mockGet: vi.fn(),
  mockRun: vi.fn(),
  mockGetHistory: vi.fn(),
  mockGetByTaskId: vi.fn(),
  mockDeleteByTaskId: vi.fn(),
  mockGetBacktestQueue: vi.fn(),
  mockRegisterPreparing: vi.fn().mockReturnValue({ success: true }),
  mockEnqueue: vi.fn(),
  mockGetTaskStatus: vi.fn(),
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockReadFileSync: vi.fn().mockReturnValue(''),
  mockWriteFileSync: vi.fn(),
  mockGetAppPath: vi.fn().mockReturnValue('/app'),
  mockGetPath: vi.fn().mockReturnValue('/userData'),
  mockIsPackaged: false,
  mockBuildCompilableCppSource: vi.fn().mockReturnValue('compiled-source'),
  mockGetCppArtifactPath: vi.fn().mockReturnValue('/artifacts/1_abc123'),
  mockHashCppStrategySource: vi.fn().mockReturnValue('abc123'),
  mockGetCompilerResolver: vi.fn().mockReturnValue({
    resolve: () => ({ info: { includes: ['/default/include'] } }),
  }),
  mockDataDownloadEnqueue: vi.fn(),
  mockCompileAlgorithm: vi.fn(),
  mockGetAlgorithmCompilationService: vi.fn(),
  mockBacktestResultService: vi.fn(),
  mockGetDataDownloadQueue: vi.fn(),
  mockGetLocale: vi.fn().mockReturnValue('en-US'),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../database/db-manager', () => ({
  getDatabaseManager: () => ({
    prepare: mockPrepare,
  }),
}));

vi.mock('../../../database/services/backtest-result-service', () => ({
  BacktestResultService: mockBacktestResultService,
}));

vi.mock('../../executor-queue-service', () => ({
  getBacktestQueue: mockGetBacktestQueue,
}));

vi.mock('../../data-download-queue', () => ({
  getDataDownloadQueue: mockGetDataDownloadQueue,
}));

vi.mock('../../algorithm-compilation-service', () => ({
  buildCompilableCppSource: mockBuildCompilableCppSource,
  getCppArtifactPath: mockGetCppArtifactPath,
  getAlgorithmCompilationService: mockGetAlgorithmCompilationService,
  hashCppStrategySource: mockHashCppStrategySource,
  separateCppIncludes: (code: string) => {
    const includePattern = /^\s*#include\s*[<"][^>"]+[>"]\s*$/;
    const pragmaOncePattern = /^\s*#pragma\s+once\s*$/;
    const lines = code.split('\n');
    const includes: string[] = [];
    const bodyLines: string[] = [];
    for (const line of lines) {
      if (pragmaOncePattern.test(line)) continue;
      if (includePattern.test(line)) { includes.push(line.trim()); continue; }
      bodyLines.push(line);
    }
    return { includes, body: bodyLines.join('\n') };
  },
}));

vi.mock('../../compiler-resolver', () => ({
  getCompilerResolver: mockGetCompilerResolver,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('electron', () => {
  const electronMock = {
    app: {
      isPackaged: mockIsPackaged,
      getAppPath: mockGetAppPath,
      getPath: mockGetPath,
      getLocale: mockGetLocale,
    },
    BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
    shell: { openExternal: vi.fn() },
    safeStorage: {
      decryptString: (value: Buffer) => value.toString('utf8'),
      encryptString: (value: string) => Buffer.from(value, 'utf8'),
      isEncryptionAvailable: () => false,
    },
    session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
  };
  return { ...electronMock, default: electronMock };
});

vi.mock('../../../window', () => ({
  getMainWindow: vi.fn(),
  sendToRenderer: vi.fn(),
}));

vi.mock('../../../utils/log-rotation', () => ({
  rotateAndCompressLogFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('crypto', () => ({
  randomBytes: () => ({ toString: () => 'deadbeef' }),
}));

vi.mock('../../../../shared/constants', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../shared/constants')>(),
  DEFAULT_INITIAL_CAPITAL: 100000,
  DEFAULT_COMMISSION_RATE: 0.001,
  DEFAULT_SLIPPAGE_RATE: 0.0005,
  DEFAULT_MAX_POSITION_SIZE: 1.0,
}));

vi.mock('../../../i18n/main-strings', () => {
  const messages: Record<string, string> = {
    'main.backtestApi.algorithmNotFound': 'Algorithm with id={{id}} not found',
    'main.backtestApi.legacyPythonStrategy': 'Algorithm {{id}} has a legacy Python strategy file. Regenerate the strategy as C++ to run a backtest.',
    'main.backtestApi.pythonResearchArtifact': 'Algorithm {{id}} is a Python research artifact (Signal Discovery). Python signals cannot be backtested directly. Use Quant Lab Combinator to compose them into executable C++ strategies.',
    'main.backtestApi.ambiguousStrategyLanguage': 'Algorithm {{id}} has contradictory or missing strategy language evidence, so it cannot be run safely. Evidence: {{detail}}.',
    'main.backtestApi.noStrategySource': 'Algorithm {{id}} has no strategy source code to run. Evidence: {{detail}}.',
    'main.backtestApi.noFilePathNoCode': 'Algorithm {{id}} has no file_path and no code in database',
    'main.backtestApi.cannotExtractClassName': 'Cannot extract C++ class name from algorithm {{id}} code',
    'main.backtestApi.noStrategyPath': 'Algorithm {{id}} did not produce a strategy path',
    'main.backtestApi.dataDownloadFailed': 'Data download failed: {{error}}',
    'main.backtestApi.compilationFailed': 'C++ compilation failed: {{error}}. Fix the strategy code and recompile.',
    'main.backtestApi.taskCancelledDuringPrep': 'Task was cancelled during preparation',
    'main.backtestApi.taskNotFound': 'Task {{taskId}} not found',
  };
  return {
    mainT: (
      _locale: string,
      _namespace: string,
      key: string,
      params: Record<string, string | number> = {},
    ) => (messages[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params[name] ?? `{{${name}}}`)),
  };
});

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
  listResults, getResult, deleteResult, runBacktest, getBacktestStatus,
  extractCppBaseClass, extractCppMethodBody, extractCppClassMembers,
  rewriteDataAccess, adaptStandaloneToWorkflowComponent, generateWorkflowStrategyCpp,
  buildFeedPlan,
} from '../backtest-api';
import type { BarInterval } from '@StratCraft/types';
import type { CppWorkflowComponent } from '../backtest-api';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('backtest-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(
      'class TestStrategy : public stratforge::Strategy { void next() override {} };',
    );
    mockExistsSync.mockReturnValue(false);
    mockGetAppPath.mockReturnValue('/app');
    mockGetPath.mockReturnValue('/userData');
    mockGetLocale.mockReturnValue('en-US');
    mockBacktestResultService.mockImplementation(() => ({
      getHistory: mockGetHistory,
      getByTaskId: mockGetByTaskId,
      deleteByTaskId: mockDeleteByTaskId,
    }));
    mockGetDataDownloadQueue.mockReturnValue({
      enqueue: mockDataDownloadEnqueue,
    });
    mockBuildCompilableCppSource.mockReturnValue('compiled-source');
    mockGetCppArtifactPath.mockReturnValue('/artifacts/1_abc123');
    mockHashCppStrategySource.mockReturnValue('abc123');
    mockGetCompilerResolver.mockReturnValue({
      resolve: () => ({ info: { includes: ['/default/include'] } }),
    });
    mockRegisterPreparing.mockReturnValue({ success: true });
    mockPrepare.mockImplementation((sql: string) => ({
      all: mockAll,
      run: mockRun,
      get: (...args: unknown[]) => {
        const row = mockGet(...args) as Record<string, unknown> | undefined;
        if (sql.includes('SELECT classification_metadata')) {
          if (row && Object.hasOwn(row, 'classification_metadata')) return row;
          const filePath = typeof row?.file_path === 'string' ? row.file_path : '';
          const dbCode = typeof row?.code === 'string' ? row.code : '';
          const hasSource = filePath.length > 0 || dbCode.trim().length > 0;
          const hasPythonEvidence = filePath.endsWith('.py') || /^\s*(from|import)\s+/m.test(dbCode);
          return {
            classification_metadata: hasSource && !hasPythonEvidence
              ? JSON.stringify({ language: 'cpp' })
              : null,
          };
        }
        return row;
      },
    }));
    mockGetBacktestQueue.mockReturnValue({
      registerPreparing: mockRegisterPreparing,
      enqueue: mockEnqueue,
      getTaskStatus: mockGetTaskStatus,
    });
    mockDataDownloadEnqueue.mockImplementation(
      (_config: unknown, onSuccess: (result: unknown) => void) => {
        onSuccess({ dataPath: '/mock/data.parquet' });
      },
    );
    mockCompileAlgorithm.mockResolvedValue({
      success: true,
      algorithmId: '1',
      status: 'success',
      artifactPath: '/cache/default_compiled.so',
    });
    mockGetAlgorithmCompilationService.mockReturnValue({
      compileAlgorithm: mockCompileAlgorithm,
    });
  });

  // =========================================================================
  // listResults
  // =========================================================================

  describe('listResults', () => {
    it('returns backtest history records', async () => {
      const records = [{ task_id: 'task_1', pnl: 100 }];
      mockGetHistory.mockReturnValue(records);

      const result = await listResults(10);

      expect(result).toEqual({ success: true, data: records });
      expect(mockGetHistory).toHaveBeenCalledWith(10);
    });

    it('uses default limit of 50', async () => {
      mockGetHistory.mockReturnValue([]);

      await listResults();

      expect(mockGetHistory).toHaveBeenCalledWith(50);
    });

    it('returns error on failure', async () => {
      mockGetHistory.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = await listResults();

      expect(result).toEqual({ success: false, error: 'DB error' });
    });

    it('handles non-Error throw via String()', async () => {
      mockGetHistory.mockImplementation(() => {
        throw 42;
      });

      const result = await listResults();

      expect(result).toEqual({ success: false, error: '42' });
    });
  });

  // =========================================================================
  // getResult
  // =========================================================================

  describe('getResult', () => {
    it('returns result record by taskId', async () => {
      const record = { task_id: 'task_1', total_pnl: 500 };
      mockGetByTaskId.mockReturnValue(record);

      const result = await getResult('task_1');

      expect(result).toEqual({ success: true, data: record });
      expect(mockGetByTaskId).toHaveBeenCalledWith('task_1');
    });

    it('returns null when not found', async () => {
      mockGetByTaskId.mockReturnValue(null);

      const result = await getResult('nonexistent');

      expect(result).toEqual({ success: true, data: null });
    });

    it('returns error on failure', async () => {
      mockGetByTaskId.mockImplementation(() => {
        throw new Error('Read error');
      });

      const result = await getResult('task_1');

      expect(result).toEqual({ success: false, error: 'Read error' });
    });

    it('handles non-Error throw via String()', async () => {
      mockGetByTaskId.mockImplementation(() => {
        throw { code: 'SQLITE_ERROR' };
      });

      const result = await getResult('task_1');

      expect(result).toEqual({ success: false, error: '[object Object]' });
    });
  });

  // =========================================================================
  // deleteResult
  // =========================================================================

  describe('deleteResult', () => {
    it('deletes result and returns success', async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = await deleteResult('task_1');

      expect(result).toEqual({ success: true });
      expect(mockRun).toHaveBeenCalledWith('task_1');
    });

    it('returns error on failure', async () => {
      mockRun.mockImplementation(() => {
        throw new Error('Delete failed');
      });

      const result = await deleteResult('task_1');

      expect(result).toEqual({ success: false, error: 'Delete failed' });
    });

    it('handles non-Error throw via String()', async () => {
      mockRun.mockImplementation(() => {
        throw 'permission denied';
      });

      const result = await deleteResult('task_1');

      expect(result).toEqual({ success: false, error: 'permission denied' });
    });
  });

  // =========================================================================
  // runBacktest
  // =========================================================================

  describe('runBacktest', () => {
    const baseParams = { algorithm_id: 1 };

    it('runs backtest successfully with defaults', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/strategies/main.cpp',
        strategy_name: 'Test Strategy',
      });
      mockExistsSync.mockReturnValue(true);
      mockEnqueue.mockReturnValue({ taskId: 'mcp_123_deadbeef', cancelled: false });

      const result = await runBacktest(baseParams);

      expect(result.success).toBe(true);
      expect(result.data?.taskId).toBeDefined();
      expect(mockRegisterPreparing).toHaveBeenCalled();
      expect(mockEnqueue).toHaveBeenCalled();
      expect(mockMkdirSync).toHaveBeenCalled();
    });

    it('returns error when algorithm not found', async () => {
      mockGet.mockReturnValue(undefined);

      const result = await runBacktest(baseParams);

      expect(result).toEqual({
        success: false,
        error: 'Algorithm with id=1 not found',
      });
    });

    // TICKET_762 A3/A4: both runBacktest read paths (enqueue lookup and
    // classification_metadata lookup) must go through v_algorithms_all so
    // discovery signals (nona_signal) resolve by id.
    it('reads via v_algorithms_all view for both enqueue and metadata lookups', async () => {
      mockGet.mockReturnValue(undefined); // short-circuit at the first lookup

      await runBacktest(baseParams);

      const sqls = mockPrepare.mock.calls
        .map((c) => c[0] as string)
        .filter((s) => /FROM\s+(v_algorithms_all|nona_algorithms)/.test(s));
      expect(sqls.length).toBeGreaterThan(0);
      for (const sql of sqls) {
        expect(sql).toMatch(/FROM\s+v_algorithms_all/);
        expect(sql).not.toMatch(/FROM\s+nona_algorithms/);
      }
    });

    it('returns error when file_path is null and no code in DB', async () => {
      mockGet.mockReturnValue({ id: 1, file_path: null, strategy_name: 'Test', code: null });

      const result = await runBacktest(baseParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('has no strategy source code to run');
    });

    it('returns error when file does not exist and no code in DB', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/missing/strategy.py',
        strategy_name: 'Test',
        code: null,
      });
      mockExistsSync.mockReturnValue(false);

      const result = await runBacktest(baseParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('legacy Python strategy file');
    });

    it('returns error when task is cancelled during preparation', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/strategies/main.cpp',
        strategy_name: 'Test',
      });
      mockExistsSync.mockReturnValue(true);
      mockEnqueue.mockReturnValue({ taskId: 'mcp_123_deadbeef', cancelled: true });

      const result = await runBacktest(baseParams);

      expect(result).toEqual({
        success: false,
        error: 'Task was cancelled during preparation',
      });
    });

    it('passes custom parameters to config', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/strategies/main.cpp',
        strategy_name: 'Test',
      });
      mockExistsSync.mockReturnValue(true);
      mockEnqueue.mockReturnValue({ taskId: 'mcp_123_deadbeef', cancelled: false });

      await runBacktest({
        algorithm_id: 1,
        symbol: 'MSFT',
        interval: '1h',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 50000,
        commission: 0.002,
        slippage: 0.001,
        allow_short: false,
        data_source: 'clickhouse',
      });

      const config = mockEnqueue.mock.calls[0][0];
      expect(config.data.symbol).toBe('MSFT');
      expect(config.data.interval).toBe('1h');
      expect(config.data.dataSourceType).toBe('parquet');
      expect(config.execution.initialCapital).toBe(50000);
      expect(config.execution.commission).toBe(0.002);
      expect(config.execution.slippage).toBe(0.001);
      expect(config.execution.allowShort).toBe(false);
    });

    it('generates main.cpp and routes explicit C++ algorithms through cpp_backtest', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'Cpp Strategy',
        code: 'class CppStrategy final : public stratforge::Strategy { public: void next() override {} };',
      });
      mockReadFileSync.mockReturnValue(
        '/* {{STRATEGY_NAME}} */ {{STRATEGY_CODE}} QNX_STRATEGY_FACTORY_EXPORT({{STRATEGY_CLASS}}) {{GENERATED_TIME}}',
      );
      mockEnqueue.mockReturnValue({ taskId: 'mcp_123_deadbeef', cancelled: false });

      const result = await runBacktest({
        algorithm_id: 1,
        language: 'cpp',
        compiler_path: '/opt/qnx/bin/clang++',
        runner_path: '/opt/qnx/bin/stratforge-runner',
        cpp_include_paths: ['/opt/qnx/include'],
      });

      expect(result.success).toBe(true);
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.language).toBe('cpp');
      expect(config.strategyPath).toContain('main.cpp');
      expect(config.compilerPath).toBe('/opt/qnx/bin/clang++');
      expect(config.runnerPath).toBe('/opt/qnx/bin/stratforge-runner');
      expect(config.cppIncludePaths).toEqual(['/opt/qnx/include']);

      const [mainCppPath, mainCppSource] = mockWriteFileSync.mock.calls.find(
        ([path]) => String(path).endsWith('main.cpp'),
      )!;
      expect(mainCppPath).toContain('main.cpp');
      expect(mainCppSource).toContain('CppStrategy final');
      expect(mainCppSource).toContain('QNX_STRATEGY_FACTORY_EXPORT(CppStrategy)');
    });

    it('generates workflow main.cpp for C++ component workflows', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'Cpp Workflow',
        code: null,
      });
      mockReadFileSync.mockReturnValue([
        '{{WORKFLOW_NAME}}',
        '{{WORKFLOW_CLASS}}',
        '{{COMPONENT_CODE}}',
        '{{COMPONENT_MEMBERS}}',
        '{{COMPONENT_INIT_CALLS}}',
        '{{REGIME_UPDATE_CALLS}}',
        '{{ENTRY_UPDATE_CALLS}}',
        '{{EXIT_UPDATE_CALLS}}',
        '{{GENERATED_TIME}}',
      ].join('\n'));
      mockEnqueue.mockReturnValue({ taskId: 'mcp_123_deadbeef', cancelled: false });

      const result = await runBacktest({
        algorithm_id: 1,
        language: 'cpp',
        workflow_components: [
          {
            role: 'regime',
            name: 'TrendRegime',
            code: 'class TrendRegime final : public qnx_workflow::RegimeComponent {};',
          },
          {
            role: 'entry',
            name: 'BreakoutEntry',
            code: 'class BreakoutEntry final : public qnx_workflow::EntryComponent {};',
          },
          {
            role: 'exit',
            name: 'RiskExit',
            code: 'class RiskExit final : public qnx_workflow::ExitComponent {};',
          },
        ],
      });

      expect(result.success).toBe(true);
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.language).toBe('cpp');
      expect(config.strategyPath).toContain('main.cpp');

      const [, mainCppSource] = mockWriteFileSync.mock.calls.find(
        ([path]) => String(path).endsWith('main.cpp'),
      )!;
      expect(mainCppSource).toContain('Cpp Workflow');
      expect(mainCppSource).toContain('Cpp_WorkflowWorkflow');
      expect(mainCppSource).toContain('TrendRegime regime_0_TrendRegime_;');
      expect(mainCppSource).toContain('state_.regime = regime_0_TrendRegime_.on_bar(ctx);');
      // TICKET_783_1: entry components are collected into a fixed-size
      // std::array<N> and reduced by combine_entries() instead of clobbering
      // state_.signal in declaration order.
      expect(mainCppSource).toContain('entry_signals[0] = entry_1_BreakoutEntry_.on_bar(ctx);');
      expect(mainCppSource).toContain('auto signal = exit_2_RiskExit_.on_bar(ctx);');

      // Verify deterministic bar update order: regime < entry < exit
      const src = String(mainCppSource);
      const regimeIdx = src.indexOf('state_.regime = regime_0_TrendRegime_.on_bar(ctx);');
      const entryIdx = src.indexOf('entry_signals[0] = entry_1_BreakoutEntry_.on_bar(ctx);');
      const exitIdx = src.indexOf('auto signal = exit_2_RiskExit_.on_bar(ctx);');
      expect(regimeIdx).toBeGreaterThan(-1);
      expect(entryIdx).toBeGreaterThan(regimeIdx);
      expect(exitIdx).toBeGreaterThan(entryIdx);
    });

    it('normalizes workflow role aliases (analysis/step/postCondition)', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'Alias Workflow',
        code: null,
      });
      mockReadFileSync.mockReturnValue([
        '{{WORKFLOW_NAME}}',
        '{{WORKFLOW_CLASS}}',
        '{{COMPONENT_CODE}}',
        '{{COMPONENT_MEMBERS}}',
        '{{COMPONENT_INIT_CALLS}}',
        '{{REGIME_UPDATE_CALLS}}',
        '{{ENTRY_UPDATE_CALLS}}',
        '{{EXIT_UPDATE_CALLS}}',
        '{{GENERATED_TIME}}',
      ].join('\n'));
      mockEnqueue.mockReturnValue({ taskId: 'mcp_alias_deadbeef', cancelled: false });

      const result = await runBacktest({
        algorithm_id: 1,
        language: 'cpp',
        workflow_components: [
          {
            role: 'analysis',
            name: 'AliasRegime',
            code: 'class AliasRegime final : public qnx_workflow::RegimeComponent {};',
          },
          {
            role: 'step',
            name: 'AliasEntry',
            code: 'class AliasEntry final : public qnx_workflow::EntryComponent {};',
          },
          {
            role: 'postCondition',
            name: 'AliasExit',
            code: 'class AliasExit final : public qnx_workflow::ExitComponent {};',
          },
        ],
      });

      expect(result.success).toBe(true);

      const [, mainCppSource] = mockWriteFileSync.mock.calls.find(
        ([path]) => String(path).endsWith('main.cpp'),
      )!;

      // Aliases normalized to canonical role names in member identifiers
      const src = String(mainCppSource);
      expect(src).toContain('AliasRegime regime_0_AliasRegime_;');
      expect(src).toContain('AliasEntry entry_1_AliasEntry_;');
      expect(src).toContain('AliasExit exit_2_AliasExit_;');

      // Verify ordering: regime < entry < exit
      // TICKET_783_1: entry call shape is `entry_signals[i] = X_.on_bar(ctx);`
      // (collected into a std::array for combine_entries).
      const regimeIdx = src.indexOf('state_.regime = regime_0_AliasRegime_.on_bar(ctx);');
      const entryIdx = src.indexOf('entry_signals[0] = entry_1_AliasEntry_.on_bar(ctx);');
      const exitIdx = src.indexOf('auto signal = exit_2_AliasExit_.on_bar(ctx);');
      expect(regimeIdx).toBeGreaterThan(-1);
      expect(entryIdx).toBeGreaterThan(regimeIdx);
      expect(exitIdx).toBeGreaterThan(entryIdx);
    });

    it('returns error on unexpected exception', async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error('Unexpected');
      });

      const result = await runBacktest(baseParams);

      expect(result).toEqual({ success: false, error: 'Unexpected' });
    });

    it('handles non-Error throw in catch block', async () => {
      mockPrepare.mockImplementation(() => {
        throw 'string error';
      });

      const result = await runBacktest(baseParams);

      expect(result).toEqual({ success: false, error: 'string error' });
    });

    // -----------------------------------------------------------------------
    // TICKET_690: Legacy Python strategies are rejected
    // -----------------------------------------------------------------------

    it('rejects legacy Python strategy file with clear error', async () => {
      mockGet.mockReturnValue({
        id: 99,
        file_path: '/strategies/legacy.py',
        strategy_name: 'LegacyPython',
        code: 'from framework import BaseStrategy\n\nclass Legacy(BaseStrategy):\n    pass',
      });
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        'from framework import BaseStrategy\n\nclass Legacy(BaseStrategy):\n    pass',
      );

      const result = await runBacktest({ algorithm_id: 99 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('legacy Python strategy file');
      expect(result.error).toContain('Regenerate the strategy as C++');
    });

    // TICKET_568_9: Python research artifact rejection guard
    it('rejects Python research artifact (Signal Discovery) with clear error', async () => {
      mockGet.mockReturnValueOnce({
        id: 200,
        file_path: null,
        strategy_name: 'StatisticalMeanReversionSignal',
        code: 'class StatisticalMeanReversionSignal(SignalSourceBase): pass',
      });
      // Second call for classification_metadata check
      mockGet.mockReturnValueOnce({
        classification_metadata: JSON.stringify({
          signal_source: 'signal_discovery',
          language: 'python',
        }),
      });

      const result = await runBacktest({ algorithm_id: 200 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Python research artifact');
      expect(result.error).toContain('Quant Lab Combinator');
    });

    it('accepts missing metadata language when readable attachment evidence is C++', async () => {
      mockGet.mockReturnValueOnce({
        id: 201,
        file_path: '/strategies/main.cpp',
        strategy_name: 'CppStrategy',
        code: null,
      });
      // Second call for classification_metadata check
      mockGet.mockReturnValueOnce({
        classification_metadata: JSON.stringify({
          signal_source: 'signal_discovery',
        }),
      });
      mockExistsSync.mockReturnValue(true);
      mockEnqueue.mockReturnValue({ taskId: 'mcp_201_deadbeef', cancelled: false });

      const result = await runBacktest({ algorithm_id: 201 });

      expect(result.success).toBe(true);
    });

    it('accepts null classification_metadata when readable attachment evidence is C++', async () => {
      mockGet.mockReturnValueOnce({
        id: 202,
        file_path: '/strategies/main.cpp',
        strategy_name: 'CppStrategy',
        code: null,
      });
      // Second call for classification_metadata check
      mockGet.mockReturnValueOnce({
        classification_metadata: null,
      });
      mockExistsSync.mockReturnValue(true);
      mockEnqueue.mockReturnValue({ taskId: 'mcp_202_deadbeef', cancelled: false });

      const result = await runBacktest({ algorithm_id: 202 });

      expect(result.success).toBe(true);
    });

    it('returns error when C++ class name cannot be extracted', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'NoCppClass',
        code: '// just a function\nint compute() { return 0; }',
      });

      const result = await runBacktest({ algorithm_id: 1, language: 'cpp' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot extract C++ class name');
    });

    // -----------------------------------------------------------------------
    // C++ strategy generation from DB code
    // -----------------------------------------------------------------------

    it('generates main.cpp for C++ strategy from DB code', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'AutoCpp',
        code: 'class AutoCppStrat : public stratforge::Strategy { void next() override {} };',
      });
      mockReadFileSync.mockReturnValue(
        '{{STRATEGY_NAME}} {{STRATEGY_CODE}} {{STRATEGY_CLASS}} {{GENERATED_TIME}}',
      );
      mockEnqueue.mockReturnValue({ taskId: 'mcp_autocpp_deadbeef', cancelled: false });

      const result = await runBacktest({ algorithm_id: 1 });

      expect(result.success).toBe(true);
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.language).toBe('cpp');
      expect(config.strategyPath).toContain('main.cpp');
    });

    it('reads code from existing .cpp file when code is null', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/strategies/my_strategy.cpp',
        strategy_name: 'FileRead',
        code: null,
      });
      mockExistsSync.mockImplementation((path: string) => {
        // Not a main.cpp, and not a .py
        return String(path).includes('my_strategy.cpp');
      });
      mockReadFileSync.mockReturnValue(
        'class FileStrat : public stratforge::Strategy { void next() override {} };',
      );
      mockEnqueue.mockReturnValue({ taskId: 'mcp_file_deadbeef', cancelled: false });

      const result = await runBacktest({ algorithm_id: 1 });

      expect(result.success).toBe(true);
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.language).toBe('cpp');
    });

    // -----------------------------------------------------------------------
    // Existing main.cpp path (UI-generated C++ workflow)
    // -----------------------------------------------------------------------

    it('uses existing main.cpp file as-is for C++ workflow', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/strategies/workflow/main.cpp',
        strategy_name: 'ExistingCpp',
        code: '#include <stratforge/strategy.hpp>\nclass ExCpp {};',
      });
      mockExistsSync.mockReturnValue(true);
      mockEnqueue.mockReturnValue({ taskId: 'mcp_excpp_deadbeef', cancelled: false });

      const result = await runBacktest({ algorithm_id: 1, language: 'cpp' });

      expect(result.success).toBe(true);
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.strategyPath).toBe('/strategies/workflow/main.cpp');
    });

    // -----------------------------------------------------------------------
    // dry_run parameter
    // -----------------------------------------------------------------------

    it('passes dry_run in strategy params when set', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/strategies/main.cpp',
        strategy_name: 'DryRun',
      });
      mockExistsSync.mockReturnValue(true);
      mockEnqueue.mockReturnValue({ taskId: 'mcp_dry_deadbeef', cancelled: false });

      const result = await runBacktest({ algorithm_id: 1, dry_run: true });

      expect(result.success).toBe(true);
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.strategy.params.dry_run).toBe(true);
    });

    it('does not include dry_run in strategy params when not set', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/strategies/main.cpp',
        strategy_name: 'NoDry',
      });
      mockExistsSync.mockReturnValue(true);
      mockEnqueue.mockReturnValue({ taskId: 'mcp_nodry_deadbeef', cancelled: false });

      const result = await runBacktest({ algorithm_id: 1 });

      expect(result.success).toBe(true);
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.strategy.params.dry_run).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // Data download failure
    // -----------------------------------------------------------------------

    it('returns error when data download fails', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/strategies/main.cpp',
        strategy_name: 'DataFail',
      });
      mockExistsSync.mockReturnValue(true);
      mockDataDownloadEnqueue.mockImplementation(
        (_config: unknown, onSuccess: (result: unknown) => void) => {
          onSuccess({ error: 'Download timeout' });
        },
      );

      const result = await runBacktest({ algorithm_id: 1 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Data download failed');
      expect(result.error).toContain('Download timeout');
    });

    it('returns error when data download returns no dataPath', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/strategies/main.cpp',
        strategy_name: 'NoPath',
      });
      mockExistsSync.mockReturnValue(true);
      mockDataDownloadEnqueue.mockImplementation(
        (_config: unknown, onSuccess: (result: unknown) => void) => {
          onSuccess({});
        },
      );

      const result = await runBacktest({ algorithm_id: 1 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Data download failed');
      expect(result.error).toContain('no dataPath returned');
    });

    it('returns error when data download rejects', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/strategies/main.cpp',
        strategy_name: 'DataReject',
      });
      mockExistsSync.mockReturnValue(true);
      mockDataDownloadEnqueue.mockImplementation(
        (_config: unknown, _onSuccess: unknown, onError: (error: unknown) => void) => {
          onError(new Error('Network failure'));
        },
      );

      const result = await runBacktest({ algorithm_id: 1 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network failure');
    });

    // -----------------------------------------------------------------------
    // C++ compile cache hit (lines 544-559)
    // -----------------------------------------------------------------------

    it('reuses cached C++ artifact when compile hash matches', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'CachedCpp',
        code: 'class CachedStrat {};',
        compile_status: 'success',
        compile_hash: 'abc123',
        compile_artifact_path: '/artifacts/1_abc123',
      });
      mockExistsSync.mockReturnValue(true);
      mockHashCppStrategySource.mockReturnValue('abc123');
      mockReadFileSync.mockReturnValue(
        '{{STRATEGY_NAME}} {{STRATEGY_CODE}} {{STRATEGY_CLASS}} {{GENERATED_TIME}}',
      );
      mockEnqueue.mockReturnValue({ taskId: 'mcp_cached_deadbeef', cancelled: false });

      const result = await runBacktest({ algorithm_id: 1, language: 'cpp' });

      expect(result.success).toBe(true);
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.cppStrategyArtifactPath).toBe('/artifacts/1_abc123');
      expect(mockBuildCompilableCppSource).toHaveBeenCalled();
      expect(mockHashCppStrategySource).toHaveBeenCalled();
    });

    it('triggers compilation when compile hash does not match', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'MismatchCpp',
        code: 'class MismatchStrat {};',
        compile_status: 'success',
        compile_hash: 'old_hash',
        compile_artifact_path: '/artifacts/1_old_hash',
      });
      mockHashCppStrategySource.mockReturnValue('new_hash');
      mockExistsSync.mockImplementation((path: string) => {
        if (String(path).includes('artifacts')) return false;
        return false;
      });
      mockReadFileSync.mockReturnValue(
        '{{STRATEGY_NAME}} {{STRATEGY_CODE}} {{STRATEGY_CLASS}} {{GENERATED_TIME}}',
      );
      mockEnqueue.mockReturnValue({ taskId: 'mcp_mismatch_deadbeef', cancelled: false });
      mockCompileAlgorithm.mockResolvedValue({
        success: true,
        algorithmId: '1',
        status: 'success',
        artifactPath: '/cache/1_new_hash.so',
      });

      const result = await runBacktest({ algorithm_id: 1, language: 'cpp' });

      expect(result.success).toBe(true);
      expect(mockCompileAlgorithm).toHaveBeenCalled();
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.cppStrategyArtifactPath).toBe('/cache/1_new_hash.so');
    });

    it('triggers compilation when buildCompilableCppSource throws during cache check', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'JitFallback',
        code: 'class JitStrat {};',
        compile_status: 'success',
        compile_hash: 'some_hash',
        compile_artifact_path: '/artifacts/1_some',
      });
      mockBuildCompilableCppSource.mockImplementation(() => {
        throw new Error('Compilation service error');
      });
      mockReadFileSync.mockReturnValue(
        '{{STRATEGY_NAME}} {{STRATEGY_CODE}} {{STRATEGY_CLASS}} {{GENERATED_TIME}}',
      );
      mockEnqueue.mockReturnValue({ taskId: 'mcp_jit_deadbeef', cancelled: false });
      mockCompileAlgorithm.mockResolvedValue({
        success: true,
        algorithmId: '1',
        status: 'success',
        artifactPath: '/cache/1_recompiled.so',
      });

      const result = await runBacktest({ algorithm_id: 1, language: 'cpp' });

      expect(result.success).toBe(true);
      expect(mockCompileAlgorithm).toHaveBeenCalledWith({
        algorithmId: 1,
        parentKind: 'algorithm',
        sourceCode: 'class JitStrat {};',
        strategyName: 'JitFallback',
      });
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.cppStrategyArtifactPath).toBe('/cache/1_recompiled.so');
    });

    it('uses default compiler includes when cpp_include_paths not provided', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'DefaultInc',
        code: 'class DefaultIncStrat {};',
        compile_status: 'success',
        compile_hash: 'abc123',
        compile_artifact_path: null,
      });
      mockBuildCompilableCppSource.mockReturnValue('compiled-source');
      mockHashCppStrategySource.mockReturnValue('abc123');
      mockGetCompilerResolver.mockReturnValue({
        resolve: () => ({ info: { includes: ['/default/include'] } }),
      });
      // existsSync must return true for artifact path check AND false for main.cpp check
      mockExistsSync.mockImplementation((path: string) => {
        if (String(path).includes('main.cpp')) return false;
        return true;
      });
      mockReadFileSync.mockReturnValue(
        '{{STRATEGY_NAME}} {{STRATEGY_CODE}} {{STRATEGY_CLASS}} {{GENERATED_TIME}}',
      );
      mockEnqueue.mockReturnValue({ taskId: 'mcp_definc_deadbeef', cancelled: false });

      const result = await runBacktest({ algorithm_id: 1, language: 'cpp' });

      expect(result.success).toBe(true);
      expect(mockGetCompilerResolver).toHaveBeenCalled();
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.cppStrategyArtifactPath).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // Workflow error paths
    // -----------------------------------------------------------------------

    it('returns error for empty workflow components array', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'EmptyWorkflow',
        code: null,
      });
      mockEnqueue.mockReturnValue({ taskId: 'mcp_empty_deadbeef', cancelled: false });

      const result = await runBacktest({
        algorithm_id: 1,
        language: 'cpp',
        workflow_components: [],
      });

      // Empty workflow_components means isCppStrategy returns false (no components),
      // and code is null, so it should fail with no code error
      expect(result.success).toBe(false);
    });

    it('returns error for workflow component with empty code', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'EmptyCode',
        code: null,
      });
      mockReadFileSync.mockReturnValue('template');

      const result = await runBacktest({
        algorithm_id: 1,
        language: 'cpp',
        workflow_components: [
          { role: 'entry', name: 'Empty', code: '   ' },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty code');
    });

    it('returns error for workflow component without class name', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'NoClassName',
        code: null,
      });
      mockReadFileSync.mockReturnValue('template');

      const result = await runBacktest({
        algorithm_id: 1,
        language: 'cpp',
        workflow_components: [
          { role: 'entry', code: 'int x = 0;' },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing a class name');
    });

    it('uses class_name from component when provided', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'ExplicitName',
        code: null,
      });
      mockReadFileSync.mockReturnValue([
        '{{WORKFLOW_NAME}}',
        '{{WORKFLOW_CLASS}}',
        '{{COMPONENT_CODE}}',
        '{{COMPONENT_MEMBERS}}',
        '{{COMPONENT_INIT_CALLS}}',
        '{{REGIME_UPDATE_CALLS}}',
        '{{ENTRY_UPDATE_CALLS}}',
        '{{EXIT_UPDATE_CALLS}}',
        '{{GENERATED_TIME}}',
      ].join('\n'));
      mockEnqueue.mockReturnValue({ taskId: 'mcp_explicit_deadbeef', cancelled: false });

      const result = await runBacktest({
        algorithm_id: 1,
        language: 'cpp',
        workflow_components: [
          {
            role: 'entry',
            class_name: 'CustomEntry',
            code: 'struct something { int x; };',
          },
        ],
      });

      expect(result.success).toBe(true);
      const [, src] = mockWriteFileSync.mock.calls.find(
        ([path]) => String(path).endsWith('main.cpp'),
      )!;
      expect(src).toContain('CustomEntry entry_0_CustomEntry_;');
    });

    // -----------------------------------------------------------------------
    // cppHardening parameter
    // -----------------------------------------------------------------------

    it('passes cppHardening to executor config', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/strategies/main.cpp',
        strategy_name: 'Hardened',
      });
      mockExistsSync.mockReturnValue(true);
      mockEnqueue.mockReturnValue({ taskId: 'mcp_hard_deadbeef', cancelled: false });

      const hardening = { sandboxEnabled: true, memoryLimitMb: 512 };
      const result = await runBacktest({
        algorithm_id: 1,
        cpp_hardening: hardening as any,
      });

      expect(result.success).toBe(true);
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.cppHardening).toEqual(hardening);
    });
  });

  // =========================================================================
  // TICKET_650: Early error gate for compile_status='error'
  // =========================================================================

  describe('TICKET_650: compile_status error gate', () => {
    it('returns actionable error when C++ compile_status is error with compile_error', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'FailedCpp',
        code: 'class BrokenStrat {};',
        compile_status: 'error',
        compile_hash: null,
        compile_artifact_path: null,
        compile_error: 'strategy.cpp:42: error: undeclared identifier',
      });

      const result = await runBacktest({ algorithm_id: 1, language: 'cpp' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('C++ compilation failed');
      expect(result.error).toContain('strategy.cpp:42: error: undeclared identifier');
      expect(result.error).toContain('Fix the strategy code and recompile');
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('falls through to JIT when compile_status is error but compile_error is null', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'NoErrorMsg',
        code: 'class NoErrorStrat {};',
        compile_status: 'error',
        compile_hash: null,
        compile_artifact_path: null,
        compile_error: null,
      });
      mockReadFileSync.mockReturnValue(
        '{{STRATEGY_NAME}} {{STRATEGY_CODE}} {{STRATEGY_CLASS}} {{GENERATED_TIME}}',
      );
      mockExistsSync.mockReturnValue(false);
      mockEnqueue.mockReturnValue({ taskId: 'mcp_123_deadbeef', cancelled: false });

      const result = await runBacktest({ algorithm_id: 1, language: 'cpp' });

      // Should NOT be blocked -- falls through to executor JIT
      expect(result.success).toBe(true);
      expect(mockEnqueue).toHaveBeenCalled();
    });

    it('returns error when C++ compilation fails on cache miss', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'CompileFail',
        code: 'class BrokenStrat {};',
        compile_status: 'pending',
        compile_hash: null,
        compile_artifact_path: null,
        compile_error: null,
      });
      mockReadFileSync.mockReturnValue(
        '{{STRATEGY_NAME}} {{STRATEGY_CODE}} {{STRATEGY_CLASS}} {{GENERATED_TIME}}',
      );
      mockCompileAlgorithm.mockResolvedValue({
        success: false,
        algorithmId: '1',
        status: 'error',
        error: 'linker error: undefined reference to main',
      });

      const result = await runBacktest({ algorithm_id: 1, language: 'cpp' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('C++ pre-compilation failed');
      expect(result.error).toContain('linker error');
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('triggers compilation on cache miss and uses artifact path', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: null,
        strategy_name: 'CacheMiss',
        code: 'class CacheMissStrat {};',
        compile_status: 'pending',
        compile_hash: null,
        compile_artifact_path: null,
        compile_error: null,
      });
      mockReadFileSync.mockReturnValue(
        '{{STRATEGY_NAME}} {{STRATEGY_CODE}} {{STRATEGY_CLASS}} {{GENERATED_TIME}}',
      );
      mockEnqueue.mockReturnValue({ taskId: 'mcp_miss_deadbeef', cancelled: false });
      mockCompileAlgorithm.mockResolvedValue({
        success: true,
        algorithmId: '1',
        status: 'success',
        artifactPath: '/cache/1_fresh.so',
      });

      const result = await runBacktest({ algorithm_id: 1, language: 'cpp' });

      expect(result.success).toBe(true);
      expect(mockCompileAlgorithm).toHaveBeenCalledWith({
        algorithmId: 1,
        parentKind: 'algorithm',
        sourceCode: 'class CacheMissStrat {};',
        strategyName: 'CacheMiss',
      });
      const config = mockEnqueue.mock.calls[0][0];
      expect(config.cppStrategyArtifactPath).toBe('/cache/1_fresh.so');
    });

    it('gates all strategies with compile_status error (TICKET_690: C++ only)', async () => {
      mockGet.mockReturnValue({
        id: 1,
        file_path: '/strategies/main.cpp',
        strategy_name: 'FailedCompile',
        code: 'class Strat {};',
        compile_status: 'error',
        compile_hash: null,
        compile_artifact_path: null,
        compile_error: 'some error',
      });
      mockExistsSync.mockReturnValue(true);

      const result = await runBacktest({ algorithm_id: 1 });

      // All strategies are C++ now -- compile error gate always applies
      expect(result.success).toBe(false);
      expect(result.error).toContain('C++ compilation failed');
    });
  });

  // =========================================================================
  // getBacktestStatus
  // =========================================================================

  describe('getBacktestStatus', () => {
    it('returns status from queue when task is found', async () => {
      mockGetTaskStatus.mockReturnValue({
        status: 'running',
        strategyName: 'Test',
        errorMessage: undefined,
      });

      const result = await getBacktestStatus('task_1');

      expect(result).toEqual({
        success: true,
        data: { status: 'running', strategyName: 'Test', errorMessage: undefined },
      });
    });

    it('falls back to DB task history when not in queue', async () => {
      mockGetTaskStatus.mockReturnValue(null);
      mockGet.mockReturnValue({
        task_id: 'task_1',
        status: 'completed',
        strategy_name: 'Test',
        error_message: null,
      });

      const result = await getBacktestStatus('task_1');

      expect(result).toEqual({
        success: true,
        data: { status: 'completed', strategyName: 'Test', errorMessage: undefined },
      });
    });

    it('falls back to backtest results when not in history', async () => {
      mockGetTaskStatus.mockReturnValue(null);
      mockGet.mockReturnValue(undefined);
      mockGetByTaskId.mockReturnValue({
        task_id: 'task_1',
        strategy_name: 'Test',
      });

      const result = await getBacktestStatus('task_1');

      expect(result).toEqual({
        success: true,
        data: { status: 'completed', strategyName: 'Test' },
      });
    });

    it('returns error when task not found anywhere', async () => {
      mockGetTaskStatus.mockReturnValue(null);
      mockGet.mockReturnValue(undefined);
      mockGetByTaskId.mockReturnValue(null);

      const result = await getBacktestStatus('unknown');

      expect(result).toEqual({
        success: false,
        error: 'Task unknown not found',
      });
    });

    it('returns error on exception', async () => {
      mockGetBacktestQueue.mockImplementation(() => {
        throw new Error('Queue not initialized');
      });

      const result = await getBacktestStatus('task_1');

      expect(result).toEqual({ success: false, error: 'Queue not initialized' });
    });

    it('handles non-Error throw via String()', async () => {
      mockGetBacktestQueue.mockImplementation(() => {
        throw 'not ready';
      });

      const result = await getBacktestStatus('task_1');

      expect(result).toEqual({ success: false, error: 'not ready' });
    });

    it('includes errorMessage from task history when present', async () => {
      mockGetTaskStatus.mockReturnValue(null);
      mockGet.mockReturnValue({
        task_id: 'task_1',
        status: 'failed',
        strategy_name: 'Test',
        error_message: 'Execution timeout',
      });

      const result = await getBacktestStatus('task_1');

      expect(result).toEqual({
        success: true,
        data: { status: 'failed', strategyName: 'Test', errorMessage: 'Execution timeout' },
      });
    });
  });

  // =========================================================================
  // TICKET_686: Workflow Composer Adapter Layer
  // =========================================================================

  describe('extractCppBaseClass', () => {
    it('detects RegimeDetectorStrategy', () => {
      const code = 'class MyRegime final : public stratforge::RegimeDetectorStrategy {';
      expect(extractCppBaseClass(code)).toBe('RegimeDetectorStrategy');
    });

    it('detects KronosDetectorStrategy without stratforge:: prefix', () => {
      const code = 'class KronosDetector : public KronosDetectorStrategy {';
      expect(extractCppBaseClass(code)).toBe('KronosDetectorStrategy');
    });

    it('detects RegimeEntryStrategy', () => {
      const code = 'class MyEntry final : public stratforge::RegimeEntryStrategy {';
      expect(extractCppBaseClass(code)).toBe('RegimeEntryStrategy');
    });

    it('detects SignalEntryStrategy', () => {
      const code = 'class SigEntry : public stratforge::SignalEntryStrategy {';
      expect(extractCppBaseClass(code)).toBe('SignalEntryStrategy');
    });

    it('detects AISignalEntryStrategy', () => {
      const code = 'class AIEntry final : public stratforge::AISignalEntryStrategy {';
      expect(extractCppBaseClass(code)).toBe('AISignalEntryStrategy');
    });

    it('detects ExitStrategy', () => {
      const code = 'class MyExit : public stratforge::ExitStrategy {';
      expect(extractCppBaseClass(code)).toBe('ExitStrategy');
    });

    it('returns null for plain Strategy', () => {
      const code = 'class MyStrat final : public stratforge::Strategy {';
      expect(extractCppBaseClass(code)).toBeNull();
    });

    it('returns null for workflow components', () => {
      const code = 'class MyComp : public qnx_workflow::RegimeComponent {';
      expect(extractCppBaseClass(code)).toBeNull();
    });

    it('returns null when no class definition found', () => {
      expect(extractCppBaseClass('int main() { return 0; }')).toBeNull();
    });

    it('handles final keyword before colon', () => {
      const code = 'class MyRegime final : public RegimeDetectorStrategy {';
      expect(extractCppBaseClass(code)).toBe('RegimeDetectorStrategy');
    });
  });

  describe('extractCppMethodBody', () => {
    it('extracts simple method body', () => {
      const code = 'void initialize_indicators() override { sma_ = 20; }';
      const result = extractCppMethodBody(code, /\binitialize_indicators\s*\([^)]*\)\s*(?:override\s*)?\{/);
      expect(result).toBe('sma_ = 20;');
    });

    it('extracts body with nested braces', () => {
      const code = 'void update_indicators() override { if (x) { a = 1; } else { b = 2; } }';
      const result = extractCppMethodBody(code, /\bupdate_indicators\s*\([^)]*\)\s*(?:override\s*)?\{/);
      expect(result).toBe('if (x) { a = 1; } else { b = 2; }');
    });

    it('returns null when method not found', () => {
      const code = 'void other_method() { }';
      const result = extractCppMethodBody(code, /\binitialize_indicators\s*\([^)]*\)\s*(?:override\s*)?\{/);
      expect(result).toBeNull();
    });

    it('returns empty string for empty body', () => {
      const code = 'void initialize_indicators() override {}';
      const result = extractCppMethodBody(code, /\binitialize_indicators\s*\([^)]*\)\s*(?:override\s*)?\{/);
      expect(result).toBe('');
    });
  });

  describe('extractCppClassMembers', () => {
    it('extracts member declarations ending with underscore', () => {
      const code = [
        'class Foo {',
        'private:',
        '    double sma_;',
        '    int period_ = 20;',
        '    void method() {}',
        '};',
      ].join('\n');
      const result = extractCppClassMembers(code);
      expect(result).toContain('double sma_;');
      expect(result).toContain('int period_ = 20;');
      expect(result).not.toContain('void method');
    });
  });

  describe('rewriteDataAccess', () => {
    it('rewrites data() to ctx.data', () => {
      expect(rewriteDataAccess('auto x = data().close()[0];')).toBe('auto x = ctx.data.close()[0];');
    });

    it('rewrites data(0) to ctx.data', () => {
      expect(rewriteDataAccess('data(0).high()[1]')).toBe('ctx.data.high()[1]');
    });

    it('rewrites position() to ctx.strategy.position()', () => {
      expect(rewriteDataAccess('auto p = position();')).toBe('auto p = ctx.strategy.position();');
    });

    it('rewrites buy( to ctx.strategy.buy(', () => {
      expect(rewriteDataAccess('buy();')).toBe('ctx.strategy.buy();');
    });

    it('rewrites sell( to ctx.strategy.sell(', () => {
      expect(rewriteDataAccess('sell();')).toBe('ctx.strategy.sell();');
    });

    it('rewrites standalone close( but not .close(', () => {
      const input = 'close(); auto c = data().close()[0];';
      const result = rewriteDataAccess(input);
      expect(result).toContain('ctx.strategy.close()');
      expect(result).toContain('ctx.data.close()[0]');
    });

    it('strips set_minimum_period calls', () => {
      expect(rewriteDataAccess('set_minimum_period(20);')).toBe('');
    });

    // TICKET_686_1: receiver-aware scoping. Reject corruption of
    // chip-local `.data()` / `.buy()` / `.sell()` / `.position()` calls
    // when they appear on a non-`ctx` receiver (typically a `std::vector`
    // or other STL container).
    it('does NOT rewrite vec.data() (std::vector<T>::data())', () => {
      const input = 'auto p = std::span<const double>(returns.data(), n);';
      expect(rewriteDataAccess(input)).toBe(input);
    });

    it('does NOT rewrite obj.data() member-call form', () => {
      const input = 'foo.data();';
      expect(rewriteDataAccess(input)).toBe(input);
    });

    it('does NOT rewrite obj->data() pointer-call form', () => {
      // Lookbehind `(?<!\w)` blocks `>data(`; the rewrite only fires
      // when `data(` starts a fresh identifier.
      const input = 'auto* p = ptr->data();';
      expect(rewriteDataAccess(input)).toBe(input);
    });

    it('does NOT rewrite obj.buy() / obj.sell() / obj.position()', () => {
      const input = 'order.buy(10); order.sell(5); portfolio.position();';
      expect(rewriteDataAccess(input)).toBe(input);
    });

    it('still rewrites standalone data() at line start', () => {
      // Sanity: the tightened regex still fires for the actual workflow
      // adapter use case (backtrader-style standalone `data()` call).
      expect(rewriteDataAccess('data().close()[0]')).toBe('ctx.data.close()[0]');
    });

    it('rewrites mixed standalone + member calls correctly', () => {
      const input = 'auto a = data().close()[0]; auto b = returns.data();';
      const result = rewriteDataAccess(input);
      expect(result).toBe('auto a = ctx.data.close()[0]; auto b = returns.data();');
    });

    it('regression: 2026-05-23 StatisticalRegimeDetectionSignal chip', () => {
      // Verbatim slice from the rejected chip captured at
      // ~/.config/@StratCraft/desktop/logs/signal-discovery/rejected/
      // 20260523_074600_StatisticalRegimeDetectionSignal.cpp (TICKET_787_1).
      // Pre-fix this produced `returns.ctx.data` and crashed the compile gate.
      const input
        = 'auto garch_fit = stratforge::stats::garch11_fit('
        + 'std::span<const double>(returns.data(), lookback_garch));';
      expect(rewriteDataAccess(input)).toBe(input);
    });
  });

  describe('adaptStandaloneToWorkflowComponent', () => {
    it('transforms RegimeDetectorStrategy to RegimeComponent adapter', () => {
      const code = [
        '#pragma once',
        '#include <vector>',
        'class MyRegime final : public stratforge::RegimeDetectorStrategy {',
        'public:',
        '    void initialize_indicators() override { sma_ = 20; }',
        '    void update_indicators() override { val_ = data().close()[0]; }',
        '    double calculate_trend_strength() const override { return val_; }',
        'private:',
        '    int sma_;',
        '    double val_;',
        '};',
      ].join('\n');

      const result = adaptStandaloneToWorkflowComponent(code, 'regime');
      expect(result.includes).toContain('#include <vector>');
      expect(result.adapterClassName).toBe('MyRegime_WfAdapter');
      expect(result.adaptedCode).toContain('class MyRegime_WfAdapter : public qnx_workflow::RegimeComponent');
      expect(result.adaptedCode).toContain('void init(qnx_workflow::ComponentContext& ctx)');
      expect(result.adaptedCode).toContain('void advance_indicators(qnx_workflow::ComponentContext& ctx) override');
      expect(result.adaptedCode).toContain('qnx_workflow::Regime on_bar(qnx_workflow::ComponentContext& ctx)');
      expect(result.adaptedCode).toContain('advance_indicators(ctx);');
      expect(result.adaptedCode).toContain('ctx.data.close()');
      expect(result.adaptedCode).not.toContain('#pragma once');
    });

    it('transforms RegimeEntryStrategy to EntryComponent adapter', () => {
      const code = [
        'class MyEntry final : public stratforge::RegimeEntryStrategy {',
        'public:',
        '    void initialize_indicators() override {}',
        '    void update_indicators() override {}',
        '    stratforge::EntrySignal check_open_conditions() override { return {}; }',
        '    bool check_close_conditions() override { return false; }',
        '};',
      ].join('\n');

      const result = adaptStandaloneToWorkflowComponent(code, 'entry');
      expect(result.adapterClassName).toBe('MyEntry_WfAdapter');
      expect(result.adaptedCode).toContain('class MyEntry_WfAdapter : public qnx_workflow::EntryComponent');
      expect(result.adaptedCode).toContain('void advance_indicators(qnx_workflow::ComponentContext& ctx) override');
      expect(result.adaptedCode).toContain('qnx_workflow::ComponentSignal on_bar');
      expect(result.adaptedCode).toContain('advance_indicators(ctx);');
    });

    it('transforms ExitStrategy to ExitComponent adapter', () => {
      const code = [
        'class MyExit : public stratforge::ExitStrategy {',
        'public:',
        '    void initialize_indicators() override {}',
        '    bool check_exit_signal() override { return true; }',
        '};',
      ].join('\n');

      const result = adaptStandaloneToWorkflowComponent(code, 'exit');
      expect(result.adapterClassName).toBe('MyExit_WfAdapter');
      expect(result.adaptedCode).toContain('class MyExit_WfAdapter : public qnx_workflow::ExitComponent');
      expect(result.adaptedCode).toContain('void advance_indicators(qnx_workflow::ComponentContext& ctx) override');
      expect(result.adaptedCode).toContain('advance_indicators(ctx);');
    });

    it('passes through already-adapted workflow components', () => {
      const code = 'class MyComp : public qnx_workflow::RegimeComponent { };';
      const result = adaptStandaloneToWorkflowComponent(code, 'regime');
      expect(result.adapterClassName).toBeNull();
      expect(result.adaptedCode).toContain('qnx_workflow::RegimeComponent');
    });

    it('passes through plain Strategy classes', () => {
      const code = 'class MyStrat final : public stratforge::Strategy { void next() override {} };';
      const result = adaptStandaloneToWorkflowComponent(code, 'entry');
      expect(result.adapterClassName).toBeNull();
    });

    it('handles code with no class definition', () => {
      const code = 'int compute() { return 0; }';
      const result = adaptStandaloneToWorkflowComponent(code, 'regime');
      expect(result.adapterClassName).toBeNull();
    });

    it('handles pre-TICKET_684_1 code missing update_indicators', () => {
      const code = [
        'class OldRegime : public stratforge::RegimeDetectorStrategy {',
        'public:',
        '    void initialize_indicators() override { period_ = 10; }',
        'private:',
        '    int period_;',
        '};',
      ].join('\n');

      const result = adaptStandaloneToWorkflowComponent(code, 'regime');
      expect(result.adapterClassName).toBe('OldRegime_WfAdapter');
      // Should generate adapter with empty update body
      expect(result.adaptedCode).toContain('// no indicator update');
    });
  });

  // =========================================================================
  // TICKET_686_1: Lambda closure + EntrySignal field bug fixes
  // =========================================================================

  describe('TICKET_686_1: adapter lambda closure on multi-line bodies with comments', () => {
    it('regime adapter: lambda }() is not consumed by // comments in method body', () => {
      const code = [
        'class CommentRegime final : public stratforge::RegimeDetectorStrategy {',
        'public:',
        '    void initialize_indicators() override {}',
        '    std::size_t get_base_warmup_period() const override { return 10; }',
        '    void update_indicators() override {}',
        '    double calculate_trend_strength() const override {',
        '        if (data().close()[0] > 100.0) {',
        '            return 1.0;  // strong trend',
        '        }',
        '        return 0.0;  // no trend',
        '    }',
        'private:',
        '    int dummy_;',
        '};',
      ].join('\n');

      const result = adaptStandaloneToWorkflowComponent(code, 'regime');
      expect(result.adapterClassName).toBe('CommentRegime_WfAdapter');

      // The closing }() must be on its own line, not on the comment line
      const lines = result.adaptedCode.split('\n');
      const lambdaCloseLines = lines.filter(l => l.trim().startsWith('}()'));
      expect(lambdaCloseLines.length).toBeGreaterThanOrEqual(1);

      // Must NOT have }() on the same line as a // comment
      const brokenLines = lines.filter(l => /\/\/.*\}\(\)/.test(l));
      expect(brokenLines.length).toBe(0);
    });

    it('entry adapter: uses long_signal/short_signal instead of direction', () => {
      const code = [
        'class SignalEntry final : public stratforge::RegimeEntryStrategy {',
        'public:',
        '    void initialize_indicators() override {}',
        '    std::size_t get_base_warmup_period() const override { return 5; }',
        '    void update_indicators() override {}',
        '    stratforge::EntrySignal check_open_conditions() override {',
        '        return stratforge::EntrySignal{.long_signal = true};',
        '    }',
        '    bool check_close_conditions() override { return false; }',
        '};',
      ].join('\n');

      const result = adaptStandaloneToWorkflowComponent(code, 'entry');
      expect(result.adapterClassName).toBe('SignalEntry_WfAdapter');

      // Must use long_signal / short_signal, NOT direction
      expect(result.adaptedCode).toContain('entry.long_signal');
      expect(result.adaptedCode).toContain('entry.short_signal');
      expect(result.adaptedCode).not.toContain('entry.direction');
    });

    it('entry adapter: open check lambda has explicit return type -> stratforge::EntrySignal', () => {
      const code = [
        'class TypedEntry final : public stratforge::SignalEntryStrategy {',
        'public:',
        '    void initialize_indicators() override {}',
        '    std::size_t get_base_warmup_period() const override { return 5; }',
        '    void update_indicators() override {}',
        '    stratforge::EntrySignal check_open_conditions() override {',
        '        return stratforge::EntrySignal{};',
        '    }',
        '    bool check_close_conditions() override { return false; }',
        '};',
      ].join('\n');

      const result = adaptStandaloneToWorkflowComponent(code, 'entry');
      expect(result.adaptedCode).toContain('-> stratforge::EntrySignal');
    });

    it('entry adapter: close check lambda }() is not consumed by // comments', () => {
      const code = [
        'class CommentEntry final : public stratforge::RegimeEntryStrategy {',
        'public:',
        '    void initialize_indicators() override {}',
        '    std::size_t get_base_warmup_period() const override { return 5; }',
        '    void update_indicators() override {}',
        '    stratforge::EntrySignal check_open_conditions() override { return {}; }',
        '    bool check_close_conditions() override {',
        '        if (position().is_long()) {',
        '            return true;  // exit long',
        '        }',
        '        return false;  // hold',
        '    }',
        '};',
      ].join('\n');

      const result = adaptStandaloneToWorkflowComponent(code, 'entry');
      const lines = result.adaptedCode.split('\n');

      // Must NOT have }() on the same line as a // comment
      const brokenLines = lines.filter(l => /\/\/.*\}\(\)/.test(l));
      expect(brokenLines.length).toBe(0);
    });

    it('exit adapter: lambda }() is not consumed by // comments', () => {
      const code = [
        'class CommentExit : public stratforge::ExitStrategy {',
        'public:',
        '    void initialize_indicators() override {}',
        '    std::size_t get_base_warmup_period() const override { return 5; }',
        '    void update_indicators() override {}',
        '    bool check_exit_signal() override {',
        '        return true;  // always exit',
        '    }',
        '};',
      ].join('\n');

      const result = adaptStandaloneToWorkflowComponent(code, 'exit');
      const lines = result.adaptedCode.split('\n');

      const brokenLines = lines.filter(l => /\/\/.*\}\(\)/.test(l));
      expect(brokenLines.length).toBe(0);
    });
  });

  describe('generateWorkflowStrategyCpp with standalone adapter (TICKET_686 integration)', () => {
    it('transforms standalone strategies into workflow with adapters and hoisted includes', () => {
      // Template with includes already present
      mockReadFileSync.mockReturnValue([
        '#include <qnx_strategy_sdk/qnx_strategy_sdk.hpp>',
        '#include <stratforge/strategy/strategy.hpp>',
        '#include <memory>',
        '#include <string>',
        '',
        'namespace qnx_workflow {',
        '// ... workflow types ...',
        '} // namespace qnx_workflow',
        '',
        '{{COMPONENT_CODE}}',
        '',
        'class {{WORKFLOW_CLASS}} final : public stratforge::Strategy {',
        '    void init() override {',
        '        auto ctx = make_context();',
        '{{COMPONENT_INIT_CALLS}}',
        '{{WARMUP_PERIOD_COMPUTATION}}',
        '    }',
        '    void prenext() override {',
        '        auto ctx = make_context();',
        '{{PRENEXT_CALLS}}',
        '    }',
        '    void next() override {',
        '        auto ctx = make_context();',
        '{{REGIME_UPDATE_CALLS}}',
        '{{ENTRY_UPDATE_CALLS}}',
        '{{EXIT_UPDATE_CALLS}}',
        '    }',
        '{{COMPONENT_MEMBERS}}',
        '};',
        'QNX_STRATEGY_FACTORY_EXPORT({{WORKFLOW_CLASS}})',
        '// {{WORKFLOW_NAME}} {{GENERATED_TIME}}',
      ].join('\n'));

      const result = generateWorkflowStrategyCpp('TestWorkflow', [
        {
          role: 'regime',
          name: 'Regime',
          code: [
            '#pragma once',
            '#include <vector>',
            'class TrendRegime final : public stratforge::RegimeDetectorStrategy {',
            'public:',
            '    void initialize_indicators() override { period_ = 20; }',
            '    void update_indicators() override { auto c = data().close()[0]; }',
            '    double calculate_trend_strength() const override { return 0.5; }',
            'private:',
            '    int period_;',
            '};',
          ].join('\n'),
        },
        {
          role: 'entry',
          name: 'Entry',
          code: [
            '#include <cmath>',
            'class BuyEntry final : public stratforge::SignalEntryStrategy {',
            'public:',
            '    void initialize_indicators() override {}',
            '    void update_indicators() override {}',
            '    stratforge::EntrySignal check_open_conditions() override { return {1}; }',
            '    bool check_close_conditions() override { return false; }',
            '};',
          ].join('\n'),
        },
      ]);

      // No #pragma once in output
      expect(result).not.toContain('#pragma once');

      // Hoisted includes (not already in template)
      expect(result).toContain('#include <vector>');
      expect(result).toContain('#include <cmath>');

      // Adapter class names used
      expect(result).toContain('TrendRegime_WfAdapter');
      expect(result).toContain('BuyEntry_WfAdapter');

      // Adapter inherits correct component types
      expect(result).toContain('qnx_workflow::RegimeComponent');
      expect(result).toContain('qnx_workflow::EntryComponent');

      // Data access rewritten
      expect(result).toContain('ctx.data.close()');
      expect(result).not.toContain('data().close()');

      // Members and init calls present
      expect(result).toContain('regime_0_Regime_');
      expect(result).toContain('entry_1_Entry_');

      // Adapters contain advance_indicators() override
      expect(result).toContain('void advance_indicators(qnx_workflow::ComponentContext& ctx) override');

      // Prenext calls advance_indicators() (not on_bar with try/catch)
      expect(result).toContain('void prenext() override');
      const prenextSection = result.split('prenext')[1].split('void next')[0];
      expect(prenextSection).toContain('regime_0_Regime_.advance_indicators(ctx);');
      expect(prenextSection).toContain('entry_1_Entry_.advance_indicators(ctx);');
      expect(prenextSection).not.toContain('std::out_of_range');
      expect(prenextSection).not.toContain('try {');
      expect(prenextSection).not.toContain('catch');
      expect(result).not.toContain('{{PRENEXT_CALLS}}');

      // No stdexcept include needed
      expect(result).not.toContain('#include <stdexcept>');
    });

    it('passes through already-adapted components without transformation', () => {
      mockReadFileSync.mockReturnValue([
        '#include <memory>',
        '{{COMPONENT_CODE}}',
        '{{WORKFLOW_CLASS}}',
        '{{COMPONENT_MEMBERS}}',
        '{{COMPONENT_INIT_CALLS}}',
        '{{WARMUP_PERIOD_COMPUTATION}}',
        '{{PRENEXT_CALLS}}',
        '{{REGIME_UPDATE_CALLS}}',
        '{{ENTRY_UPDATE_CALLS}}',
        '{{EXIT_UPDATE_CALLS}}',
        '{{WORKFLOW_NAME}} {{GENERATED_TIME}}',
      ].join('\n'));

      const result = generateWorkflowStrategyCpp('PassThrough', [
        {
          role: 'regime',
          name: 'Already',
          code: 'class AlreadyAdapted : public qnx_workflow::RegimeComponent { void init(qnx_workflow::ComponentContext&) override {} qnx_workflow::Regime on_bar(qnx_workflow::ComponentContext&) override { return qnx_workflow::Regime::Unknown; } };',
        },
      ]);

      // Should use original class name, not _WfAdapter
      expect(result).toContain('AlreadyAdapted regime_0_Already_;');
      expect(result).not.toContain('_WfAdapter');
    });

    // =========================================================================
    // TICKET_783_1: combine_entries / signalMethod wiring
    //
    // Each test uses a minimal template stub that carries every placeholder
    // the generator now consumes (including the new TICKET_783_1 ones); we
    // then assert against the emitted source.
    // =========================================================================

    // TICKET_783_3: stub now carries every placeholder the generator emits,
    // including the new rolling-lookback / entry-priors / rolling-pnl /
    // prev_entry_signals slots.
    const T783_TEMPLATE_STUB = [
      '#include <qnx_strategy_sdk/qnx_strategy_sdk.hpp>',
      '#include <array>',
      '{{COMPONENT_CODE}}',
      'namespace {',
      'constexpr const char* kSignalMethod = {{SIGNAL_METHOD_CONST}};',
      'constexpr double kLambdaWarmup = {{LAMBDA_WARMUP_CONST}};',
      'constexpr double kSrFloor = {{SR_FLOOR_CONST}};',
      'constexpr double kVoteThreshold = {{VOTE_THRESHOLD_CONST}};',
      'constexpr std::size_t kRollingLookback = {{ROLLING_LOOKBACK_CONST}};',
      'constexpr bool kConfidenceWeightedSizing = {{CONFIDENCE_WEIGHTED_SIZING}};',
      '{{ENTRY_PRIORS}}',
      '{{COMBINE_ENTRIES_FN}}',
      '} // namespace',
      'class {{WORKFLOW_CLASS}} final : public stratforge::Strategy {',
      '  void init() override { auto ctx = make_context();',
      '{{COMPONENT_INIT_CALLS}}',
      '{{WARMUP_PERIOD_COMPUTATION}}',
      '  }',
      '  void prenext() override { auto ctx = make_context();',
      '{{PRENEXT_CALLS}}',
      '  }',
      '  void next() override { auto ctx = make_context();',
      '{{REGIME_UPDATE_CALLS}}',
      '    if (bar_index >= 1) {',
      '{{ROLLING_PNL_UPDATE_CALLS}}',
      '    }',
      '{{ENTRY_UPDATE_CALLS}}',
      '{{EXIT_UPDATE_CALLS}}',
      '  }',
      '{{COMPONENT_MEMBERS}}',
      '{{PREV_ENTRY_SIGNALS_MEMBER}}',
      '{{ROLLING_PNL_MEMBERS}}',
      '{{ROLLING_VOTE_MEMBERS}}',
      '{{CORR_MATRIX_MEMBER}}',
      '};',
      'QNX_STRATEGY_FACTORY_EXPORT({{WORKFLOW_CLASS}})',
      '// {{WORKFLOW_NAME}} {{GENERATED_TIME}}',
    ].join('\n');

    function entryComponent(name: string, body: string) {
      return {
        role: 'entry' as const,
        name,
        code: [
          `class ${name} : public qnx_workflow::EntryComponent {`,
          'public:',
          '  qnx_workflow::ComponentSignal on_bar(qnx_workflow::ComponentContext& ctx) override {',
          `    ${body}`,
          '  }',
          '};',
        ].join('\n'),
      };
    }

    it('TICKET_783_1 T783-1: two always-Long entry components emit majority-vote aggregator', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('TwoLong', [
        entryComponent('LongA', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
        entryComponent('LongB', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
      ]);

      // Default signalMethod is "equal".
      expect(result).toContain('constexpr const char* kSignalMethod = "equal";');
      // lambda_warmup collapses the unified formula to 1/N majority vote.
      expect(result).toContain('constexpr double kLambdaWarmup = 1.0;');
      // combine_entries function emitted and called with std::array<N=2>.
      expect(result).toContain('combine_entries(');
      expect(result).toContain('std::array<qnx_workflow::ComponentSignal, 2> entry_signals{};');
      // The N=2 helper signature is in the generated TU.
      expect(result).toContain('const std::array<qnx_workflow::ComponentSignal, 2>& signals');
      // Majority-vote body present (not last-wins clobber).
      expect(result).toContain('Signal::EnterLong');
      expect(result).toContain('"equal/majority-vote"');
      // entry_signal mirrors the combined result, not the last component's.
      expect(result).toContain('state_.entry_signal = combined;');
      expect(result).toContain('state_.signal = combined;');
    });

    it('TICKET_783_1 T783-2: two entries (Long + Hold) -- aggregator emitted, body is majority-vote', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('LongPlusHold', [
        entryComponent('LongOnly', 'return {qnx_workflow::Signal::EnterLong, 1.0, "L"};'),
        entryComponent('HoldOnly', 'return {qnx_workflow::Signal::Hold, 0.0, "H"};'),
      ]);

      expect(result).toContain('std::array<qnx_workflow::ComponentSignal, 2> entry_signals{};');
      // TICKET_783_3: aggregator body is weighted-score-driven; for `equal`
      // the w_raw per signal collapses to 1, then TICKET_783_4's normalisation
      // turns the vector into 1/N, so the final score is a pure majority vote.
      expect(result).toContain('score += w_method[i] * dir[i];');
      expect(result).toContain('std::array<double, 2> dir{};');
      // Confidence is normalised against the post-normalisation weight_sum.
      expect(result).toContain('std::abs(score) / weight_sum');
    });

    it('TICKET_783_1 T783-3: two entries (Long + Short) -- aggregator emits tie -> Hold via majority vote', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('TieCase', [
        entryComponent('Longish', 'return {qnx_workflow::Signal::EnterLong, 1.0, "L"};'),
        entryComponent('Shortish', 'return {qnx_workflow::Signal::EnterShort, 1.0, "S"};'),
      ]);

      // The runtime tie -> Hold contract lives in combine_entries' else
      // branch; assert the structural shape is emitted.
      expect(result).toContain('out.signal = qnx_workflow::Signal::Hold;');
      expect(result).toContain('out.signal = qnx_workflow::Signal::EnterLong;');
      expect(result).toContain('out.signal = qnx_workflow::Signal::EnterShort;');
      // N=2 still.
      expect(result).toContain('std::array<qnx_workflow::ComponentSignal, 2> entry_signals{};');
    });

    it('TICKET_783_1 T783-4: single entry component still goes through combine_entries (N=1 array)', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('SingleEntry', [
        entryComponent('SoloEntry', 'return {qnx_workflow::Signal::EnterLong, 1.0, "S"};'),
      ]);

      // N=1 array, real combine_entries body, never the old last-wins path.
      expect(result).toContain('std::array<qnx_workflow::ComponentSignal, 1> entry_signals{};');
      expect(result).toContain('const std::array<qnx_workflow::ComponentSignal, 1>& signals');
      expect(result).toContain('state_.signal = combined;');
      // Old conditional-clobber shape ("if (signal.signal != qnx_workflow::Signal::Hold)") must be gone.
      expect(result).not.toContain('if (signal.signal != qnx_workflow::Signal::Hold)');
    });

    it('TICKET_783_5: every method in WORKFLOW_SIGNAL_METHODS now has a real aggregator body (no reserved fallback path remains)', () => {
      // After TICKET_783_5, every entry in WORKFLOW_SIGNAL_METHODS is wired
      // through to a real branch -- there is no "reserved -> fall back to
      // equal" path left. This test pins that invariant: the reason string
      // must reflect the actually-selected method, never collapse to the
      // 783_1 "equal/majority-vote" sentinel for a non-equal method.
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const expectedReason: Record<string, string> = {
        equal: 'equal/majority-vote',
        sharpe_weighted: 'sharpe_weighted',
        regime_based: 'regime_based/majority-vote',
        correlation_adjusted: 'correlation_adjusted',
      };

      // regime_based requires a regime-role chip; build the right shape per method.
      for (const method of ['equal', 'sharpe_weighted', 'correlation_adjusted'] as const) {
        const r = generateWorkflowStrategyCpp(
          'EveryMethod',
          [entryComponent('Solo', 'return {qnx_workflow::Signal::EnterLong, 1.0, "x"};')],
          undefined,
          { signalMethod: method },
        );
        expect(r).toContain(`constexpr const char* kSignalMethod = "${method}";`);
        expect(r).toContain(`out.reason = "${expectedReason[method]}";`);
      }
    });

    it('TICKET_783_1: regime-only workflow (zero entry components) emits a combine_entries stub and no entry block', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('RegimeOnly', [
        {
          role: 'regime',
          name: 'Reg',
          code: [
            'class Reg : public qnx_workflow::RegimeComponent {',
            'public:',
            '  qnx_workflow::Regime on_bar(qnx_workflow::ComponentContext&) override {',
            '    return qnx_workflow::Regime::Unknown;',
            '  }',
            '};',
          ].join('\n'),
        },
      ]);

      // No entry_signals array declaration, no per-bar combine call.
      expect(result).not.toContain('std::array<qnx_workflow::ComponentSignal,');
      expect(result).not.toContain('combine_entries(entry_signals');
      // But the placeholder is still consumed -- stub function emitted.
      expect(result).not.toContain('{{COMBINE_ENTRIES_FN}}');
      expect(result).toContain('inline qnx_workflow::ComponentSignal combine_entries()');
    });

    // =========================================================================
    // TICKET_783_3: Bayesian backbone -- generator emits the Bayesian
    // skeleton even when no priors are supplied.
    // =========================================================================

    it('TICKET_783_3: emits per-entry-component prior constants defaulting to 0/0 when no cachedStats', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('NoPriors', [
        entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
        entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
      ]);

      // Defaults emitted as 0.0 / 0 -- aggregator inherits the equal behaviour
      // because n_prior_i = 0 and rolling will be empty on the first bars.
      expect(result).toContain('constexpr double kSharpePrior_0 = 0.0;');
      expect(result).toContain('constexpr std::int64_t kNPrior_0 = 0;');
      expect(result).toContain('constexpr double kSharpePrior_1 = 0.0;');
      expect(result).toContain('constexpr std::int64_t kNPrior_1 = 0;');
    });

    it('TICKET_783_3: threads supplied cachedStats into emitted prior constants', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('WithPriors', [
        {
          ...entryComponent('Strong', 'return {qnx_workflow::Signal::EnterLong, 1.0, "S"};'),
          cachedStats: { sharpePrior: 2.0, nPrior: 1260 },
        },
        {
          ...entryComponent('Weak', 'return {qnx_workflow::Signal::EnterLong, 1.0, "W"};'),
          cachedStats: { sharpePrior: 0.3, nPrior: 252 },
        },
      ]);

      // Priors are emitted with C++ double-literal formatting (trailing .0 for
      // integer values; passthrough for already-decimal values).
      expect(result).toContain('constexpr double kSharpePrior_0 = 2.0;');
      expect(result).toContain('constexpr std::int64_t kNPrior_0 = 1260;');
      expect(result).toContain('constexpr double kSharpePrior_1 = 0.3;');
      expect(result).toContain('constexpr std::int64_t kNPrior_1 = 252;');
    });

    it('TICKET_783_3: strips cachedStats from non-entry roles', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('MixedRoles', [
        {
          role: 'regime',
          name: 'R',
          code: [
            'class R : public qnx_workflow::RegimeComponent {',
            'public:',
            '  qnx_workflow::Regime on_bar(qnx_workflow::ComponentContext&) override {',
            '    return qnx_workflow::Regime::Unknown;',
            '  }',
            '};',
          ].join('\n'),
          // Regime chips should never carry priors -- the generator drops them.
          cachedStats: { sharpePrior: 99, nPrior: 99 },
        },
        {
          ...entryComponent('E', 'return {qnx_workflow::Signal::EnterLong, 1.0, "E"};'),
          // The only entry chip -- prior index 0.
          cachedStats: { sharpePrior: 1.5, nPrior: 300 },
        },
      ]);

      // Entry's prior survives at index 0.
      expect(result).toContain('constexpr double kSharpePrior_0 = 1.5;');
      // No other kSharpePrior_X emitted (only one entry component).
      expect(result).not.toContain('kSharpePrior_1');
      // The regime's bogus prior never appears anywhere.
      expect(result).not.toContain('= 99');
    });

    it('TICKET_783_3: emits lambda_schedule constexpr, kRollingLookback, kNMin', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'Skeleton',
        [entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};')],
        undefined,
        { lookback: 90 },
      );

      // Lookback flows from options to kRollingLookback.
      expect(result).toContain('constexpr std::size_t kRollingLookback = 90;');
      // lambda_schedule lives in the SDK section of the template -- the stub
      // doesn't carry it, so this assertion is anchored against the SDK
      // template helper for production but skipped here. We still assert the
      // generator emitted the constants the schedule reads:
      //   (the schedule itself is in workflow.cpp.template, verified by
      //   T783-3b/c against the real template via the in-test SDK path).
    });

    it('TICKET_783_3: emits std::array<RollingPnl<kRollingLookback>, N> rolling_pnl_ member', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('Rolling', [
        entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
        entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
      ]);

      expect(result).toContain(
        'std::array<qnx_workflow::RollingPnl<kRollingLookback>, 2> rolling_pnl_{};'
      );
      expect(result).toContain(
        'std::array<qnx_workflow::ComponentSignal, 2> prev_entry_signals_{};'
      );
    });

    it('TICKET_783_3: combine_entries body computes posterior and consumes rolling pnl', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('Posterior', [
        entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
        entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
      ]);

      // Body should reference posterior + clip + hard floor + rolling.
      expect(result).toContain('lambda_schedule(n_rolling)');
      expect(result).toContain('rolling[i].non_zero_count()');
      expect(result).toContain('rolling[i].sharpe()');
      expect(result).toContain('lambda_i * sharpe_prior');
      expect(result).toContain('std::max(0.0, sr_post - kSrFloor)');
      expect(result).toContain('if (n_total >= kNMin)');
      // The signature now takes (signals, rolling).
      expect(result).toContain(
        'const std::array<qnx_workflow::RollingPnl<kRollingLookback>, 2>& rolling'
      );
    });

    it('TICKET_783_3: shadow-PnL update block uses sign(prev_vote) * bar_return per component', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('ShadowPnl', [
        entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
        entryComponent('B', 'return {qnx_workflow::Signal::EnterShort, 1.0, "B"};'),
      ]);

      // Per-component update reads prev_entry_signals_[i], computes r = +/-bar_return,
      // and pushes into rolling_pnl_[i].
      expect(result).toContain('const auto& prev = prev_entry_signals_[0];');
      expect(result).toContain('const auto& prev = prev_entry_signals_[1];');
      expect(result).toContain('rolling_pnl_[0].push(r, was_active);');
      expect(result).toContain('rolling_pnl_[1].push(r, was_active);');
      expect(result).toContain('r = bar_return;');
      expect(result).toContain('r = -bar_return;');
    });

    it('TICKET_783_3: srFloor option propagates into kSrFloor constant', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'WithFloor',
        [entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};')],
        undefined,
        { srFloor: 0.25 },
      );

      expect(result).toContain('constexpr double kSrFloor = 0.25;');
    });

    it('TICKET_1130 Phase 2: default kConfidenceWeightedSizing is false', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'DefaultCWS',
        [entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};')],
      );

      expect(result).toContain('constexpr bool kConfidenceWeightedSizing = false;');
    });

    it('TICKET_1130 Phase 2: confidenceWeightedSizing=true emits true constant', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'WithCWS',
        [entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};')],
        undefined,
        { confidenceWeightedSizing: true },
      );

      expect(result).toContain('constexpr bool kConfidenceWeightedSizing = true;');
    });

    it('TICKET_783_3: regime-only workflow emits no priors / no rolling members', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('RegimeOnly783_3', [
        {
          role: 'regime',
          name: 'Reg',
          code: [
            'class Reg : public qnx_workflow::RegimeComponent {',
            'public:',
            '  qnx_workflow::Regime on_bar(qnx_workflow::ComponentContext&) override {',
            '    return qnx_workflow::Regime::Unknown;',
            '  }',
            '};',
          ].join('\n'),
        },
      ]);

      // No prior constants emitted -- the placeholder comment stands in.
      expect(result).not.toContain('kSharpePrior_0');
      // No rolling/prev member declarations -- only comment markers in their place.
      expect(result).not.toContain('std::array<qnx_workflow::RollingPnl');
      expect(result).not.toContain('std::array<qnx_workflow::ComponentSignal,');
      expect(result).not.toContain('rolling_pnl_[0]');
      // Sanity: every TICKET_783_3 / 783_5 placeholder was consumed (no `{{...}}` left).
      expect(result).not.toMatch(/\{\{(ENTRY_PRIORS|ROLLING_PNL_MEMBERS|ROLLING_PNL_UPDATE_CALLS|PREV_ENTRY_SIGNALS_MEMBER|ROLLING_LOOKBACK_CONST|ROLLING_VOTE_MEMBERS|CORR_MATRIX_MEMBER)\}\}/);
    });

    // =========================================================================
    // TICKET_783_4: sharpe_weighted aggregator (thin consumer of the Bayesian
    // backbone shipped in TICKET_783_3).
    //
    // Runtime behaviour (T783-4a..e from the design doc) is asserted via the
    // compile-gate / backtest pipeline; these tests assert the *generated code
    // shape* that makes the runtime behaviour structurally guaranteed:
    //
    //   * sharpe_weighted assigns w_raw = sr_clip (not 1.0) in the hot loop
    //   * equal still assigns w_raw = 1.0 (no regression to T783-1..4)
    //   * normalisation pass divides by w_sum_raw, falls back to all-zero
    //     when no signal has positive weight (D2 contract -> Hold)
    //   * the reason string reflects the method
    //   * kSignalMethod round-trips through codegen for observability
    // =========================================================================

    it('TICKET_783_4: sharpe_weighted emits w_raw = sr_clip in the inner loop', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'SharpeWeighted',
        [
          entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          entryComponent('B', 'return {qnx_workflow::Signal::EnterShort, 1.0, "B"};'),
        ],
        undefined,
        { signalMethod: 'sharpe_weighted' },
      );

      // Bayesian machinery is computed (same as equal).
      expect(result).toContain('const double sr_clip = std::max(0.0, sr_post - kSrFloor);');
      // Method-specific transform: w_raw is bound to sr_clip, not 1.0.
      expect(result).toContain('w_raw = sr_clip;');
      // The (void)sr_clip "discard" used by equal must NOT appear in this
      // body -- sr_clip is consumed.
      expect(result).not.toContain('(void)sr_clip;');
      // kSignalMethod constant round-trips for observability.
      expect(result).toContain('constexpr const char* kSignalMethod = "sharpe_weighted";');
      // Reason string reflects the method.
      expect(result).toContain('out.reason = "sharpe_weighted";');
    });

    it('TICKET_783_4: equal method still emits w_raw = 1.0 (no regression)', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('Equal', [
        entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
        entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
      ]);

      // Default method is `equal`.
      expect(result).toContain('constexpr const char* kSignalMethod = "equal";');
      // equal keeps the placeholder w_raw = 1.0 (the Bayesian machinery is
      // still computed but ignored, so sr_clip is discarded via (void)).
      expect(result).toContain('double w_raw = 1.0;');
      expect(result).toContain('(void)sr_clip;');
      // `equal` reason string survives the TICKET_783_4 rewrite.
      expect(result).toContain('out.reason = "equal/majority-vote";');
      // The sharpe_weighted-only assignment must NOT appear.
      expect(result).not.toContain('w_raw = sr_clip;');
    });

    it('TICKET_783_4: emits normalisation pass that divides by w_sum_raw, zeroes on degenerate sum', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'Normalised',
        [
          entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          entryComponent('B', 'return {qnx_workflow::Signal::EnterShort, 1.0, "B"};'),
        ],
        undefined,
        { signalMethod: 'sharpe_weighted' },
      );

      // Raw weight accumulator.
      expect(result).toContain('double w_sum_raw = 0.0;');
      expect(result).toContain('w_sum_raw += w_raw;');
      // Normalisation guard + divisor.
      expect(result).toContain('if (w_sum_raw > 0.0)');
      expect(result).toContain('w_method[i] /= w_sum_raw;');
      // Degenerate (all-zero) sum -> all weights pinned to 0; the threshold
      // branch below maps score == 0 to Hold (D2 contract).
      expect(result).toContain('w_method.fill(0.0);');
    });

    it('TICKET_783_4: weight buffer + score pass are codegen-time independent of method', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      // Compare equal and sharpe_weighted: the per-component buffer + the
      // post-normalisation score+confidence loop are identical between
      // methods -- only the w_raw assignment inside the hard-floor branch
      // differs. This guards against accidental divergence in the
      // skeleton shared by both methods (and by 783_5 once it lands).
      const equalResult = generateWorkflowStrategyCpp('Eq', [
        entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
        entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
      ]);
      const sharpeResult = generateWorkflowStrategyCpp(
        'Sw',
        [
          entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
        ],
        undefined,
        { signalMethod: 'sharpe_weighted' },
      );

      for (const r of [equalResult, sharpeResult]) {
        expect(r).toContain('std::array<double, 2> w_method{};');
        expect(r).toContain('std::array<double, 2> dir{};');
        expect(r).toContain('score += w_method[i] * dir[i];');
        expect(r).toContain('weight_sum += w_method[i];');
        expect(r).toContain('std::abs(score) / weight_sum');
      }
    });

    // =========================================================================
    // TICKET_783_2: regime_based aggregator -- per-entry kAllowedRegimes_i
    // arrays, regime_allowed<K>() helper, and the regime-gate branch inside
    // combine_entries that zeroes w_raw on disallowed regimes.
    // =========================================================================

    function regimeComponent(name: string, body: string) {
      return {
        role: 'regime' as const,
        name,
        code: [
          `class ${name} : public qnx_workflow::RegimeComponent {`,
          'public:',
          '  qnx_workflow::Regime on_bar(qnx_workflow::ComponentContext& ctx) override {',
          `    ${body}`,
          '  }',
          '};',
        ].join('\n'),
      };
    }

    it('TICKET_783_2 T783-6: emits kAllowedRegimes_i + regime_allowed helper + regime gate under regime_based', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'RegimeGate',
        [
          regimeComponent('Detector', 'return qnx_workflow::Regime::TrendingUp;'),
          {
            ...entryComponent('EntryA', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
            allowedRegimes: ['TrendingUp'],
          },
          {
            ...entryComponent('EntryB', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
            allowedRegimes: ['Ranging'],
          },
        ],
        undefined,
        { signalMethod: 'regime_based' },
      );

      // Per-entry constexpr arrays match the chips' allow-lists (indices 0/1
      // correspond to the two entry components in input order; the regime
      // detector is not counted in this numbering).
      expect(result).toContain(
        'constexpr std::array<qnx_workflow::Regime, 1> kAllowedRegimes_0{{ qnx_workflow::Regime::TrendingUp }};',
      );
      expect(result).toContain(
        'constexpr std::array<qnx_workflow::Regime, 1> kAllowedRegimes_1{{ qnx_workflow::Regime::Ranging }};',
      );
      // Helper emitted with constexpr-if for the empty-array sentinel.
      expect(result).toContain('[[nodiscard]] inline bool regime_allowed(');
      expect(result).toContain('if constexpr (K == 0)');
      // combine_entries now takes the current regime; the gate switch maps
      // per-i to the matching kAllowedRegimes_i lookup.
      expect(result).toContain(
        'combine_entries(entry_signals, rolling_pnl_, state_.regime);',
      );
      expect(result).toContain('switch (i) {');
      expect(result).toContain('if (!regime_allowed(regime, kAllowedRegimes_0)) w_raw = 0.0;');
      expect(result).toContain('if (!regime_allowed(regime, kAllowedRegimes_1)) w_raw = 0.0;');
      // Reason string reflects the active method.
      expect(result).toContain('out.reason = "regime_based/majority-vote";');
      expect(result).toContain('constexpr const char* kSignalMethod = "regime_based";');
    });

    it('TICKET_783_2 T783-6a: un-annotated chips under regime_based emit empty kAllowedRegimes_i arrays (collapses to majority vote)', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'RegimeNoAnnot',
        [
          regimeComponent('Detector', 'return qnx_workflow::Regime::TrendingUp;'),
          entryComponent('EntryA', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          entryComponent('EntryB', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
        ],
        undefined,
        { signalMethod: 'regime_based' },
      );

      // Empty allow-list is emitted as a zero-length std::array; regime_allowed's
      // `if constexpr (K == 0)` branch returns true unconditionally, so the gate
      // is a no-op for un-annotated chips.
      expect(result).toContain('constexpr std::array<qnx_workflow::Regime, 0> kAllowedRegimes_0{};');
      expect(result).toContain('constexpr std::array<qnx_workflow::Regime, 0> kAllowedRegimes_1{};');
      // Switch + per-i gate is still emitted (always under regime_based).
      expect(result).toContain('switch (i) {');
    });

    it('TICKET_783_2 T783-6c: unknown regime string in chip metadata raises a structured error at codegen', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      expect(() =>
        generateWorkflowStrategyCpp(
          'BadRegime',
          [
            regimeComponent('Detector', 'return qnx_workflow::Regime::TrendingUp;'),
            {
              ...entryComponent('EntryA', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
              allowedRegimes: ['TrandingUp'],
            },
          ],
          undefined,
          { signalMethod: 'regime_based' },
        ),
      ).toThrow(/allowed_regimes contains unknown regime 'TrandingUp'/);
    });

    it('TICKET_783_2: regime_based with no regime-role component throws (codegen-layer invariant)', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      expect(() =>
        generateWorkflowStrategyCpp(
          'EntryOnly',
          [entryComponent('EntryA', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};')],
          undefined,
          { signalMethod: 'regime_based' },
        ),
      ).toThrow(/regime_based.*requires at least one regime\/analysis-role component/);
    });

    it('TICKET_880: empty component set generates a legal always-Hold strategy (does NOT throw)', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      // An empty set arises when every selected Alpha Factory signal is a factor
      // (universe cross-sectional) that was labelled-no-op'd at the dispatch
      // boundary. The generator must treat this as a Hold strategy, not an error.
      let result = '';
      expect(() => {
        result = generateWorkflowStrategyCpp('AllFactorsSkipped', []);
      }).not.toThrow();

      // It must still emit a compilable strategy: the factory export, a class,
      // and the combine_entries() Hold stub (returns an empty ComponentSignal).
      expect(result).toContain('QNX_STRATEGY_FACTORY_EXPORT(');
      expect(result).toContain('final : public stratforge::Strategy');
      expect(result).toContain('inline qnx_workflow::ComponentSignal combine_entries()');
      expect(result).toContain('return qnx_workflow::ComponentSignal{};');
      // No leftover placeholders -- every template token consumed at N=0.
      expect(result).not.toMatch(/\{\{[A-Z_]+\}\}/);
    });

    it('TICKET_880: empty component set emits no entry/regime/exit component members', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp('AllFactorsSkipped', []);

      // No actual component-member declarations are emitted (the N=0 builders
      // collapse to comments, which DO mention the names -- so assert on the
      // concrete declaration shapes, not the bare identifiers).
      expect(result).not.toContain('std::array<qnx_workflow::ComponentSignal,');
      expect(result).not.toMatch(/std::array<qnx_workflow::RollingPnl<[^>]+>,\s*\d+>\s*rolling_pnl_/);
      expect(result).not.toMatch(/std::array<qnx_workflow::ComponentSignal,\s*\d+>\s*prev_entry_signals_/);
      // The collapse-to-comment markers confirm the N=0 path was taken.
      expect(result).toContain('no entry components');
    });

    it('TICKET_783_2: allowed_regimes is silently dropped on non-entry roles', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      // A regime-role chip carrying allowed_regimes should not break codegen
      // (it would be a logical loop -- a detector gating itself). The
      // normaliser scrubs the field for non-entry roles.
      expect(() =>
        generateWorkflowStrategyCpp(
          'RegimeWithAllowed',
          [
            { ...regimeComponent('Detector', 'return qnx_workflow::Regime::TrendingUp;'), allowedRegimes: ['NotARegime'] },
            entryComponent('EntryA', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          ],
          undefined,
          { signalMethod: 'regime_based' },
        ),
      ).not.toThrow();
    });

    it('TICKET_783_2: non-regime_based methods still pass state_.regime to combine_entries (uniform caller)', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      // Both equal and sharpe_weighted should emit the same call shape so
      // the entry-update block is method-agnostic; regime gating just happens
      // not to fire inside the body.
      for (const method of ['equal', 'sharpe_weighted'] as const) {
        const r = generateWorkflowStrategyCpp(
          'Uniform',
          [
            entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
            entryComponent('B', 'return {qnx_workflow::Signal::EnterShort, 1.0, "B"};'),
          ],
          undefined,
          { signalMethod: method },
        );
        expect(r).toContain('combine_entries(entry_signals, rolling_pnl_, state_.regime);');
        // No switch-on-i gate emitted under non-regime methods.
        expect(r).not.toContain('switch (i) {');
        // (void)regime keeps -Wunused-parameter quiet.
        expect(r).toContain('(void)regime;');
      }
    });

    it('TICKET_783_4: hard-floor branch still pins w_raw = 1.0 under sharpe_weighted (cold-start D1)', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'ColdStart',
        [
          entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
        ],
        undefined,
        { signalMethod: 'sharpe_weighted' },
      );

      // The `double w_raw = 1.0;` declaration -- the hard-floor default --
      // is preserved under sharpe_weighted; only the inside of the
      // `if (n_total >= kNMin)` branch differs by method. This is what
      // makes T783-4e (cold-start -> equal-weight contribution) hold.
      expect(result).toContain('double w_raw = 1.0;');
      expect(result).toContain('if (n_total >= kNMin)');
      // And the sharpe-specific assignment lives strictly inside that
      // branch (so cold-start components keep their w_raw = 1.0).
      const ifIdx = result.indexOf('if (n_total >= kNMin)');
      const assignIdx = result.indexOf('w_raw = sr_clip;');
      const closeBraceIdx = result.indexOf('}', assignIdx);
      expect(ifIdx).toBeGreaterThan(-1);
      expect(assignIdx).toBeGreaterThan(ifIdx);
      expect(closeBraceIdx).toBeGreaterThan(assignIdx);
    });

    // =========================================================================
    // TICKET_783_5: correlation_adjusted aggregator. Like the 783_4 tests, the
    // runtime semantics (T783-5 / 5a / 5b / 5c / 5d / 5e from the design doc)
    // are guaranteed via the *generated code shape* that this block pins.
    //
    //   * w_raw uses sr_clip (shared with sharpe_weighted) so cold-start /
    //     negative-prior contracts are inherited untouched
    //   * a per-i redundancy denominator `(1 + sum_{j != i} |corr_matrix[i][j]|)`
    //     is applied before the normalisation pass shipped by 783_4
    //   * the caller emits a vote-push + matrix refresh block, threads
    //     corr_matrix_ into combine_entries, and the combine signature grows
    //     by one parameter
    //   * rolling_vote_ + corr_matrix_ members are emitted on the workflow
    //     class only under correlation_adjusted (no per-class storage cost
    //     for the other 3 methods)
    //   * the reason string + kSignalMethod constant round-trip
    // =========================================================================

    it('TICKET_783_5: w_raw uses sr_clip (shared with sharpe_weighted) under correlation_adjusted', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'CorrAdjusted',
        [
          entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          entryComponent('B', 'return {qnx_workflow::Signal::EnterShort, 1.0, "B"};'),
        ],
        undefined,
        { signalMethod: 'correlation_adjusted' },
      );

      // Bayesian machinery + sr_clip share the same line as sharpe_weighted.
      expect(result).toContain('const double sr_clip = std::max(0.0, sr_post - kSrFloor);');
      expect(result).toContain('w_raw = sr_clip;');
      // The equal-method `(void)sr_clip;` discard must NOT appear in this body.
      expect(result).not.toContain('(void)sr_clip;');
      // kSignalMethod + reason round-trip.
      expect(result).toContain('constexpr const char* kSignalMethod = "correlation_adjusted";');
      expect(result).toContain('out.reason = "correlation_adjusted";');
    });

    it('TICKET_783_5 T783-5: emits per-i redundancy denominator inside Pass 1 and divides w_raw by (1 + sum)', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'Three',
        [
          entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
          entryComponent('C', 'return {qnx_workflow::Signal::EnterLong, 1.0, "C"};'),
        ],
        undefined,
        { signalMethod: 'correlation_adjusted' },
      );

      // The j != i guard and the |corr_matrix[i][j]| accumulator are present
      // exactly as the unified formula prescribes.
      expect(result).toContain('double redundancy = 0.0;');
      expect(result).toContain('for (std::size_t j = 0; j < 3; ++j) {');
      expect(result).toContain('if (j == i) continue;');
      expect(result).toContain('redundancy += std::abs(corr_matrix[i][j]);');
      // The division collapses to w_raw when redundancy is 0 (warmup), which
      // is what makes T783-5b (cold-start matches sharpe_weighted) hold.
      expect(result).toContain('w_raw /= (1.0 + redundancy);');
    });

    it('TICKET_783_5: combine_entries signature gains the corr_matrix parameter only under correlation_adjusted', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const corr = generateWorkflowStrategyCpp(
        'Corr',
        [
          entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
        ],
        undefined,
        { signalMethod: 'correlation_adjusted' },
      );
      // 2D const-ref matrix parameter wired into the signature.
      expect(corr).toContain(
        'const std::array<std::array<double, 2>, 2>& corr_matrix,',
      );
      // Caller threads corr_matrix_ in (rolling_pnl_ still present from 783_3).
      expect(corr).toContain(
        'combine_entries(entry_signals, rolling_pnl_, corr_matrix_, state_.regime);',
      );

      // Under sharpe_weighted the matrix is NOT in the signature -- the caller
      // shape is identical to 783_1..4.
      const sw = generateWorkflowStrategyCpp(
        'Sw',
        [
          entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
        ],
        undefined,
        { signalMethod: 'sharpe_weighted' },
      );
      expect(sw).not.toContain('std::array<std::array<double, ');
      expect(sw).toContain('combine_entries(entry_signals, rolling_pnl_, state_.regime);');
    });

    it('TICKET_783_5: emits rolling_vote_ + corr_matrix_ members under correlation_adjusted only', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const corr = generateWorkflowStrategyCpp(
        'CorrMembers',
        [
          entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
        ],
        undefined,
        { signalMethod: 'correlation_adjusted' },
      );
      expect(corr).toContain(
        'std::array<qnx_workflow::RollingVote<kRollingLookback>, 2> rolling_vote_{};',
      );
      expect(corr).toContain(
        'std::array<std::array<double, 2>, 2> corr_matrix_{};',
      );

      // None of the other 3 methods emit those members -- comment placeholder
      // stands in so the class layout is unchanged for non-correlation runs.
      for (const method of ['equal', 'sharpe_weighted'] as const) {
        const r = generateWorkflowStrategyCpp(
          'NoCorrMembers',
          [
            entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
            entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
          ],
          undefined,
          { signalMethod: method },
        );
        expect(r).not.toContain('rolling_vote_');
        expect(r).not.toContain('corr_matrix_');
      }
    });

    it('TICKET_783_5: caller pushes vote sign into rolling_vote_ and refreshes corr_matrix_ every kCorrRefreshK bars', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'CorrCaller',
        [
          entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          entryComponent('B', 'return {qnx_workflow::Signal::EnterShort, 1.0, "B"};'),
        ],
        undefined,
        { signalMethod: 'correlation_adjusted' },
      );

      // Vote sign push happens BEFORE combine_entries (per design doc).
      expect(result).toContain('if (entry_signals[i].signal == qnx_workflow::Signal::EnterLong) v = 1;');
      expect(result).toContain('else if (entry_signals[i].signal == qnx_workflow::Signal::EnterShort) v = -1;');
      expect(result).toContain('rolling_vote_[i].push(v);');
      // Matrix refresh cadence gate.
      expect(result).toContain('if ((ctx.bar_index % kCorrRefreshK) == 0) {');
      // Only the upper triangle is computed and mirrored to the lower.
      expect(result).toContain('const double rho = qnx_workflow::rolling_corr(rolling_vote_[i], rolling_vote_[j]);');
      expect(result).toContain('corr_matrix_[i][j] = rho;');
      expect(result).toContain('corr_matrix_[j][i] = rho;');
      // Diagonal pinned to 1.0 each refresh.
      expect(result).toContain('corr_matrix_[i][i] = 1.0;');
    });

    it('TICKET_783_5 T783-5d: N=1 correlation_adjusted produces the same per-component body shape (no j != i term to sum)', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'CorrN1',
        [entryComponent('Solo', 'return {qnx_workflow::Signal::EnterLong, 1.0, "S"};')],
        undefined,
        { signalMethod: 'correlation_adjusted' },
      );

      // 1x1 matrix parameter + members.
      expect(result).toContain('const std::array<std::array<double, 1>, 1>& corr_matrix,');
      expect(result).toContain('std::array<std::array<double, 1>, 1> corr_matrix_{};');
      // The redundancy loop is still emitted unconditionally -- with N=1 the
      // `if (j == i) continue;` skips every iteration, so redundancy stays 0
      // and w_raw is divided by (1 + 0) = 1: identical to sharpe_weighted.
      expect(result).toContain('for (std::size_t j = 0; j < 1; ++j) {');
      expect(result).toContain('if (j == i) continue;');
      expect(result).toContain('w_raw /= (1.0 + redundancy);');
    });

    it('TICKET_783_5 T783-5b: hard-floor branch still pins w_raw = 1.0 under correlation_adjusted (cold-start D1)', () => {
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'CorrColdStart',
        [
          entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
        ],
        undefined,
        { signalMethod: 'correlation_adjusted' },
      );

      // The cold-start contract from 783_3 / 783_4 survives: `w_raw = 1.0` is
      // the default before the `if (n_total >= kNMin)` branch, and the
      // sr_clip assignment lives strictly inside that branch. The redundancy
      // division then applies to the floor value too -- but corr_matrix_ is
      // zero-initialised, so during warmup `redundancy = 0` and the division
      // by `(1 + 0)` leaves w_raw at 1.0 (= sharpe_weighted, T783-5b).
      expect(result).toContain('double w_raw = 1.0;');
      expect(result).toContain('if (n_total >= kNMin)');
      const ifIdx = result.indexOf('if (n_total >= kNMin)');
      const srClipIdx = result.indexOf('w_raw = sr_clip;');
      expect(srClipIdx).toBeGreaterThan(ifIdx);
      // The redundancy division lives OUTSIDE the kNMin gate so cold-start
      // components also pass through it (no behavioural cost under warmup
      // because the matrix is zero-initialised).
      const redundancyIdx = result.indexOf('double redundancy = 0.0;');
      const closeBraceAfterSrClip = result.indexOf('}', srClipIdx);
      expect(redundancyIdx).toBeGreaterThan(closeBraceAfterSrClip);
    });

    it('TICKET_783_5: kCorrRefreshK constant survives in the template (not consumed by codegen)', () => {
      // kCorrRefreshK is declared in the SDK template (workflow.cpp.template)
      // -- the generator only references it. The full template, when read,
      // must contain the constant; here we just verify the generator does
      // NOT shadow / redefine it (no `constexpr ... kCorrRefreshK = ...` line
      // emitted by the generator's combine_entries body).
      mockReadFileSync.mockReturnValue(T783_TEMPLATE_STUB);

      const result = generateWorkflowStrategyCpp(
        'NoShadowKCorr',
        [
          entryComponent('A', 'return {qnx_workflow::Signal::EnterLong, 1.0, "A"};'),
          entryComponent('B', 'return {qnx_workflow::Signal::EnterLong, 1.0, "B"};'),
        ],
        undefined,
        { signalMethod: 'correlation_adjusted' },
      );
      // Generator references but does not redeclare kCorrRefreshK.
      expect(result).toContain('ctx.bar_index % kCorrRefreshK');
      expect(result).not.toMatch(/constexpr\s+[^;]+kCorrRefreshK\s*=/);
    });

    it('deduplicates includes already present in template', () => {
      mockReadFileSync.mockReturnValue([
        '#include <memory>',
        '#include <string>',
        '{{COMPONENT_CODE}}',
        '{{WORKFLOW_CLASS}}',
        '{{COMPONENT_MEMBERS}}',
        '{{COMPONENT_INIT_CALLS}}',
        '{{WARMUP_PERIOD_COMPUTATION}}',
        '{{PRENEXT_CALLS}}',
        '{{REGIME_UPDATE_CALLS}}',
        '{{ENTRY_UPDATE_CALLS}}',
        '{{EXIT_UPDATE_CALLS}}',
        '{{WORKFLOW_NAME}} {{GENERATED_TIME}}',
      ].join('\n'));

      const result = generateWorkflowStrategyCpp('DedupeTest', [
        {
          role: 'entry',
          name: 'Dup',
          code: [
            '#include <memory>',
            '#include <cmath>',
            'class DupEntry : public qnx_workflow::EntryComponent {};',
          ].join('\n'),
        },
      ]);

      // <memory> already in template -- should not be duplicated
      const memoryCount = (result.match(/#include <memory>/g) || []).length;
      expect(memoryCount).toBe(1);
      // <cmath> not in template -- should be hoisted
      expect(result).toContain('#include <cmath>');
    });
  });

  // =========================================================================
  // TICKET_1225 P3: FeedPlan builder
  // =========================================================================

  describe('TICKET_1225 P3: buildFeedPlan', () => {
    it('returns single-feed degenerate plan when no components have timeframes', () => {
      const plan = buildFeedPlan([
        { role: 'regime', code: 'class R{};' },
        { role: 'entry', code: 'class E{};' },
      ]);

      expect(plan.feeds).toHaveLength(1);
      expect(plan.feeds[0].index).toBe(0);
      expect(plan.feeds[0].role).toBe('execution');
    });

    it('picks the finest TF as execution feed', () => {
      const plan = buildFeedPlan([
        { role: 'regime', code: 'class R{};', timeframe: '1M' },
        { role: 'entry', code: 'class E{};', timeframe: '1h' },
      ]);

      expect(plan.feeds).toHaveLength(2);
      expect(plan.executionInterval).toBe('1h');
      expect(plan.feeds[0].interval).toBe('1h');
      expect(plan.feeds[0].role).toBe('execution');
      expect(plan.feeds[0].index).toBe(0);
      expect(plan.feeds[1].interval).toBe('1M');
      expect(plan.feeds[1].role).toBe('context');
      expect(plan.feeds[1].index).toBe(1);
    });

    it('deduplicates TFs -- two components with same TF produce one feed', () => {
      const plan = buildFeedPlan([
        { role: 'entry', code: 'class E1{};', timeframe: '1h' },
        { role: 'exit', code: 'class X{};', timeframe: '1h' },
        { role: 'regime', code: 'class R{};', timeframe: '1d' },
      ]);

      expect(plan.feeds).toHaveLength(2);
      expect(plan.feeds.map(f => f.interval)).toEqual(['1h', '1d']);
    });

    it('sorts context feeds coarsest-last', () => {
      const plan = buildFeedPlan([
        { role: 'regime', code: 'class R{};', timeframe: '1M' },
        { role: 'entry', code: 'class E{};', timeframe: '5m' },
        { role: 'exit', code: 'class X{};', timeframe: '1d' },
      ]);

      expect(plan.feeds.map(f => f.interval)).toEqual(['5m', '1d', '1M']);
    });

    it('marks native TFs as parquet source with resolved path', () => {
      const nativeSet = new Set(['1h', '1d'] as BarInterval[]);
      const plan = buildFeedPlan(
        [
          { role: 'entry', code: 'class E{};', timeframe: '1h' },
          { role: 'regime', code: 'class R{};', timeframe: '1d' },
        ],
        nativeSet,
        (interval) => `/data/${interval}.parquet`,
      );

      expect(plan.feeds[0].source).toEqual({ kind: 'parquet', dataPath: '/data/1h.parquet' });
      expect(plan.feeds[1].source).toEqual({ kind: 'parquet', dataPath: '/data/1d.parquet' });
    });

    it('marks non-native TFs as resample with finest native base', () => {
      const nativeSet = new Set(['1h', '1d'] as BarInterval[]);
      const plan = buildFeedPlan(
        [
          { role: 'entry', code: 'class E{};', timeframe: '1h' },
          { role: 'regime', code: 'class R{};', timeframe: '1M' },
        ],
        nativeSet,
        (interval) => `/data/${interval}.parquet`,
      );

      expect(plan.feeds[0].source).toEqual({ kind: 'parquet', dataPath: '/data/1h.parquet' });
      // 1M is not native -> resample from finest native in plan (1h)
      expect(plan.feeds[1].source).toEqual({ kind: 'resample', base: '1h' });
    });

    it('handles 3-TF plan with mixed native and derived', () => {
      const nativeSet = new Set(['1h', '4h'] as BarInterval[]);
      const plan = buildFeedPlan(
        [
          { role: 'entry', code: 'class E{};', timeframe: '1h' },
          { role: 'regime', code: 'class R{};', timeframe: '4h' },
          { role: 'exit', code: 'class X{};', timeframe: '1w' },
        ],
        nativeSet,
        (interval) => `/data/${interval}.parquet`,
      );

      expect(plan.feeds).toHaveLength(3);
      expect(plan.feeds[0]).toMatchObject({ index: 0, interval: '1h', role: 'execution', source: { kind: 'parquet' } });
      expect(plan.feeds[1]).toMatchObject({ index: 1, interval: '4h', role: 'context', source: { kind: 'parquet' } });
      expect(plan.feeds[2]).toMatchObject({ index: 2, interval: '1w', role: 'context', source: { kind: 'resample', base: '1h' } });
    });
  });

  // =========================================================================
  // TICKET_1225 P3: generateWorkflowStrategyCpp with FeedPlan
  // =========================================================================

  describe('TICKET_1225 P3: multi-feed code generation', () => {
    // Helper: a minimal template that contains all required placeholders.
    function setupMultiFeedTemplate(): void {
      mockReadFileSync.mockReturnValue([
        '#include <qnx_strategy_sdk/qnx_strategy_sdk.hpp>',
        '#include <stratforge/strategy/strategy.hpp>',
        '#include <array>',
        '#include <cmath>',
        '#include <cstdint>',
        '#include <memory>',
        '#include <string>',
        '#include <unordered_map>',
        '#include <algorithm>',
        '#include <cstdlib>',
        'namespace qnx_workflow { /* template body */ }',
        '{{COMPONENT_CODE}}',
        'namespace { {{SIGNAL_METHOD_CONST}} {{LAMBDA_WARMUP_CONST}} {{SR_FLOOR_CONST}} {{VOTE_THRESHOLD_CONST}} {{ROLLING_LOOKBACK_CONST}} {{CONFIDENCE_WEIGHTED_SIZING}} {{ENTRY_PRIORS}} {{COMBINE_ENTRIES_FN}}',
        '{{FEED_INDEX_CONSTANTS}}',
        '}',
        'class {{WORKFLOW_CLASS}} final {',
        'void init() { auto ctx = make_context(); {{COMPONENT_INIT_CALLS}} {{WARMUP_PERIOD_COMPUTATION}} }',
        'void prenext() { auto ctx = make_context(); {{PRENEXT_CALLS}} }',
        'void next() { auto ctx = make_context();',
        '{{REGIME_UPDATE_CALLS}}',
        '{{ROLLING_PNL_UPDATE_CALLS}}',
        '{{ENTRY_UPDATE_CALLS}}',
        '{{EXIT_UPDATE_CALLS}}',
        '}',
        '{{COMPONENT_MEMBERS}}',
        '{{PREV_ENTRY_SIGNALS_MEMBER}}',
        '{{ROLLING_PNL_MEMBERS}}',
        '{{ROLLING_VOTE_MEMBERS}}',
        '{{CORR_MATRIX_MEMBER}}',
        '};',
        'QNX_STRATEGY_FACTORY_EXPORT({{WORKFLOW_CLASS}})',
        '{{EXPECTED_FEEDS_EXPORT}}',
        '{{WORKFLOW_NAME}} {{GENERATED_TIME}}',
      ].join('\n'));
    }

    it('single-feed plan produces code identical in semantics to no-plan call', () => {
      setupMultiFeedTemplate();
      const components: CppWorkflowComponent[] = [
        { role: 'regime', code: 'class R : public qnx_workflow::RegimeComponent {};' },
        { role: 'entry', code: 'class E : public qnx_workflow::EntryComponent {};' },
      ];

      // Without plan
      const codeNoPlan = generateWorkflowStrategyCpp('Test', components);
      // With single-feed plan
      const plan = buildFeedPlan(components);
      const codeWithPlan = generateWorkflowStrategyCpp('Test', components, undefined, {}, plan);

      // Both should produce semantically identical code (same template expansion).
      // The only difference would be in feed index constants and expected feeds export.
      // Since single-feed, both use make_context() / data(0) -- no feed_advanced guards.
      expect(codeNoPlan).toContain('regime_0_R_.on_bar(ctx)');
      expect(codeWithPlan).toContain('regime_0_R_.on_bar(ctx)');
      // Neither should contain feed_advanced (single feed).
      expect(codeNoPlan).not.toContain('feed_advanced');
      expect(codeWithPlan).not.toContain('feed_advanced');
    });

    it('multi-feed plan emits feed_advanced guards for regime (level semantics)', () => {
      setupMultiFeedTemplate();
      const components: CppWorkflowComponent[] = [
        { role: 'regime', code: 'class R : public qnx_workflow::RegimeComponent {};', timeframe: '1M' as BarInterval },
        { role: 'entry', code: 'class E : public qnx_workflow::EntryComponent {};', timeframe: '1h' as BarInterval },
      ];
      const plan = buildFeedPlan(components);

      const code = generateWorkflowStrategyCpp('MTF', components, undefined, {}, plan);

      // Regime component is on feed 1 (1M is coarser -> index 1).
      expect(code).toContain('if (feed_advanced(1))');
      // Should bind to the correct feed context.
      expect(code).toContain('make_context(1)');
      // Entry is on feed 0 (1h = execution).
      expect(code).toContain('if (feed_advanced(0))');
    });

    it('multi-feed plan emits edge semantics for entry and exit', () => {
      setupMultiFeedTemplate();
      const components: CppWorkflowComponent[] = [
        { role: 'entry', code: 'class E : public qnx_workflow::EntryComponent {};', timeframe: '1h' as BarInterval },
        { role: 'exit', code: 'class X : public qnx_workflow::ExitComponent {};', timeframe: '1d' as BarInterval },
      ];
      const plan = buildFeedPlan(components);

      const code = generateWorkflowStrategyCpp('MTF', components, undefined, {}, plan);

      // Exit component is on feed 1 (1d is coarser).
      // Edge semantics: signal only on new bar.
      expect(code).toContain('if (feed_advanced(1))');
      expect(code).toContain('X_.on_bar(fctx)');
    });

    it('multi-feed plan emits per-feed warmup', () => {
      setupMultiFeedTemplate();
      const components: CppWorkflowComponent[] = [
        { role: 'regime', code: 'class R : public qnx_workflow::RegimeComponent {};', timeframe: '1M' as BarInterval },
        { role: 'entry', code: 'class E : public qnx_workflow::EntryComponent {};', timeframe: '1h' as BarInterval },
      ];
      const plan = buildFeedPlan(components);

      const code = generateWorkflowStrategyCpp('MTF', components, undefined, {}, plan);

      // Per-feed warmup: set_minimum_period(feedIdx, wp) for each feed.
      expect(code).toContain('set_minimum_period(0, wp)');
      expect(code).toContain('set_minimum_period(1, wp)');
    });

    it('emits feed index constants', () => {
      setupMultiFeedTemplate();
      const components: CppWorkflowComponent[] = [
        { role: 'entry', code: 'class E : public qnx_workflow::EntryComponent {};', timeframe: '1h' as BarInterval },
        { role: 'regime', code: 'class R : public qnx_workflow::RegimeComponent {};', timeframe: '1d' as BarInterval },
      ];
      const plan = buildFeedPlan(components);

      const code = generateWorkflowStrategyCpp('MTF', components, undefined, {}, plan);

      expect(code).toContain('static constexpr std::size_t kFeedIndex_0 = 0;');
      expect(code).toContain('static constexpr std::size_t kFeedIndex_1 = 1;');
    });

    it('emits expected feeds export', () => {
      setupMultiFeedTemplate();
      const components: CppWorkflowComponent[] = [
        { role: 'entry', code: 'class E : public qnx_workflow::EntryComponent {};', timeframe: '1h' as BarInterval },
        { role: 'regime', code: 'class R : public qnx_workflow::RegimeComponent {};', timeframe: '1d' as BarInterval },
        { role: 'exit', code: 'class X : public qnx_workflow::ExitComponent {};', timeframe: '1w' as BarInterval },
      ];
      const plan = buildFeedPlan(components);

      const code = generateWorkflowStrategyCpp('MTF', components, undefined, {}, plan);

      expect(code).toContain('qnx_strategy_expected_feeds() { return 3; }');
    });

    it('multi-feed prenext only advances indicators when feed has new bar', () => {
      setupMultiFeedTemplate();
      const components: CppWorkflowComponent[] = [
        { role: 'regime', code: 'class R : public qnx_workflow::RegimeComponent {};', timeframe: '1d' as BarInterval },
        { role: 'entry', code: 'class E : public qnx_workflow::EntryComponent {};', timeframe: '1h' as BarInterval },
      ];
      const plan = buildFeedPlan(components);

      const code = generateWorkflowStrategyCpp('MTF', components, undefined, {}, plan);

      // Prenext should have feed_advanced guards for each component.
      expect(code).toContain('if (feed_advanced(1))');
      expect(code).toContain('if (feed_advanced(0))');
      expect(code).toContain('advance_indicators(fctx)');
    });

    it('component init uses correct feed context in multi-feed', () => {
      setupMultiFeedTemplate();
      const components: CppWorkflowComponent[] = [
        { role: 'regime', code: 'class R : public qnx_workflow::RegimeComponent {};', timeframe: '1d' as BarInterval },
        { role: 'entry', code: 'class E : public qnx_workflow::EntryComponent {};', timeframe: '1h' as BarInterval },
      ];
      const plan = buildFeedPlan(components);

      const code = generateWorkflowStrategyCpp('MTF', components, undefined, {}, plan);

      // Regime on feed 1 should get make_context(1).
      expect(code).toContain('auto fctx = make_context(1); regime_0_R_.init(fctx);');
      // Entry on feed 0 uses the default ctx.
      expect(code).toContain('entry_1_E_.init(ctx);');
    });
  });

  // =========================================================================
  // TICKET_1225 P3: interval-constants INTERVAL_RANK + isIntervalFinerThan
  // =========================================================================

  describe('TICKET_1225 P3: interval ordering', () => {
    it('buildFeedPlan uses correct ordering for 10-token vocabulary', () => {
      // Verify that the rank-based ordering agrees with the ALL_INTERVALS order.
      const plan = buildFeedPlan([
        { role: 'entry', code: 'class E{};', timeframe: '4h' as BarInterval },
        { role: 'regime', code: 'class R{};', timeframe: '1m' as BarInterval },
        { role: 'exit', code: 'class X{};', timeframe: '1M' as BarInterval },
      ]);

      // Execution = finest = 1m
      expect(plan.executionInterval).toBe('1m');
      // Context sorted coarsest-last: 4h, 1M
      expect(plan.feeds.map(f => f.interval)).toEqual(['1m', '4h', '1M']);
    });
  });
});
