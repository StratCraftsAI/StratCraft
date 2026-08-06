import { expect, Page } from '@playwright/test';
import { existsSync } from 'node:fs';

export interface LocalWorkflowInput {
  sourceCode: string;
  sourcePath: string;
  strategyName: string;
}

export interface LocalWorkflowResult {
  algorithmId: number;
  version: number;
  compileArtifactPath: string;
  compileSourceHash: string;
  dataPath: string;
  totalBars: number;
  taskId: string;
  metrics: Record<string, number>;
  historyRecord: Record<string, unknown>;
}

export async function runLocalStrategyWorkflow(
  page: Page,
  input: LocalWorkflowInput,
): Promise<LocalWorkflowResult> {
  const authState = await page.evaluate(async () =>
    (globalThis as any).electronAPI.auth.getState());
  expect(authState?.data?.isAuthenticated ?? authState?.isAuthenticated).toBe(false);

  const saved = await page.evaluate(async ({ sourceCode, strategyName }) =>
    (globalThis as any).electronAPI.hub.invokeEntity(
      'save',
      'nona_algorithm',
      {
        code: sourceCode,
        strategy_name: strategyName,
        strategy_type: 1,
        classification_metadata: JSON.stringify({
          signal_source: 'indicator_detector_trend',
          strategy_role: 'execution',
          strategy_composition: 'atomic',
          abi_version: 2,
          generated_by: 'ticket_1304_8_p8',
        }),
        strategy_rules: JSON.stringify({ fixture: 'sma_crossover', abi_version: 2 }),
        description: 'TICKET_1304_8 P8 local ABI v2 strategy',
        file_path: `${strategyName}.cpp`,
        user_id: 'local',
        local_only: 1,
      },
      'system',
    ), input);
  expect(
    saved,
    `Failed to persist the ABI v2 strategy: ${JSON.stringify(saved)}`,
  ).toMatchObject({ success: true });
  const algorithmId = Number(saved.data);
  expect(algorithmId).toBeGreaterThan(0);

  const algorithm = await page.evaluate(async (id) =>
    (globalThis as any).electronAPI.hub.invokeEntity(
      'get',
      'nona_algorithm',
      id,
      'system',
    ), algorithmId);
  expect(algorithm).toMatchObject({ success: true });
  expect(algorithm.data.version).toBeGreaterThanOrEqual(1);
  expect(algorithm.data.code).toContain('QNX_STRATEGY_FACTORY_EXPORT');

  const compiled = await page.evaluate(async ({ algorithmId, sourceCode, strategyName }) =>
    (globalThis as any).electronAPI.executor.compileAlgorithm({
      algorithmId,
      sourceCode,
      strategyName,
    }), { algorithmId, sourceCode: input.sourceCode, strategyName: input.strategyName });
  expect(compiled).toMatchObject({ success: true, status: 'success' });
  expect(compiled.artifactPath).toBeTruthy();
  expect(existsSync(compiled.artifactPath)).toBe(true);

  const data = await page.evaluate(async () =>
    (globalThis as any).electronAPI.data.ensure({
      symbol: 'AAPL',
      startDate: '2024-01-02',
      endDate: '2024-06-28',
      interval: '1d',
      provider: 'yfinance',
      forceDownload: true,
      callerId: 'backtest',
    }));
  expect(data).toMatchObject({ success: true, source: 'yfinance' });
  expect(data.coverage.totalBars).toBeGreaterThan(30);
  expect(data.coverage.startDate).toBe('2024-01-02');
  expect(data.coverage.endDate).toBe('2024-06-28');
  expect(existsSync(data.dataPath)).toBe(true);

  const taskId = `p8_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const run = await page.evaluate(async (config) =>
    (globalThis as any).electronAPI.executor.runBacktest(config), {
      taskId,
      algorithmId,
      language: 'cpp',
      strategyPath: input.sourcePath,
      strategyName: input.strategyName,
      cppStrategyArtifactPath: compiled.artifactPath,
      symbol: 'AAPL',
      interval: '1d',
      startTime: Date.parse('2024-01-02T00:00:00Z') / 1000,
      endTime: Date.parse('2024-06-28T23:59:59Z') / 1000,
      dataPath: data.dataPath,
      dataSourceType: 'parquet',
      initialCapital: 100000,
      commission: 0.001,
      slippage: 0.0005,
    });
  expect(
    run,
    `Failed to launch the local ABI v2 backtest: ${JSON.stringify(run)}`,
  ).toMatchObject({ success: true, taskId });

  await expect.poll(
    () => page.evaluate(async (id) =>
      (globalThis as any).electronAPI.executor.getTaskStatus(id), taskId),
    { timeout: 180_000, intervals: [250, 500, 1000] },
  ).toMatchObject({ success: true, status: 'completed' });

  const result = await page.evaluate(async (id) =>
    (globalThis as any).electronAPI.executor.getResults(id), taskId);
  expect(result).toMatchObject({ success: true });
  expect(result.result?.success).toBe(true);
  expect(result.result?.metrics).toEqual(expect.objectContaining({
    totalReturn: expect.any(Number),
    sharpeRatio: expect.any(Number),
    totalTrades: expect.any(Number),
  }));

  const history = await page.evaluate(async (id) =>
    (globalThis as any).electronAPI.executor.getHistoryResult(id), taskId);
  expect(history).toMatchObject({ success: true });
  expect(history.data).toMatchObject({
    task_id: taskId,
    strategy_name: input.strategyName,
    symbol: 'AAPL',
    timeframe: '1d',
  });

  await page.evaluate(async ({ taskId, strategyName }) =>
    (globalThis as any).electronAPI.executor.saveOpenTabs([{
      taskId,
      strategyName,
      isActive: true,
      lastAccessedAt: Date.now(),
    }]), { taskId, strategyName: input.strategyName });
  await page.evaluate(() => {
    const key = 'StratCraft:app-state';
    const persisted = JSON.parse(localStorage.getItem(key) || '{"state":{},"version":0}');
    persisted.state = {
      ...persisted.state,
      activeView: 'backtestResult',
      previousView: 'backtest',
    };
    localStorage.setItem(key, JSON.stringify(persisted));
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const privacyDecline = page.getByRole('button', { name: 'No Thanks' });
  if (await privacyDecline.isVisible({ timeout: 3000 }).catch(() => false)) {
    await privacyDecline.click();
  }
  // BacktestTabBar truncates names > 16 chars to 15 + ellipsis; check a prefix
  const displayPrefix = input.strategyName.length > 16
    ? input.strategyName.slice(0, 15)
    : input.strategyName;
  const historyAfterReload = await page.evaluate(async (id) =>
    (globalThis as any).electronAPI.executor.getHistoryResult(id), taskId);
  expect(historyAfterReload).toMatchObject({
    success: true,
    data: { task_id: taskId, strategy_name: input.strategyName },
  });
  await expect(page.getByText(displayPrefix, { exact: false }).first())
    .toBeVisible({ timeout: 30_000 });

  return {
    algorithmId,
    version: algorithm.data.version,
    compileArtifactPath: compiled.artifactPath,
    compileSourceHash: compiled.sourceHash,
    dataPath: data.dataPath,
    totalBars: data.coverage.totalBars,
    taskId,
    metrics: result.result.metrics,
    historyRecord: history.data,
  };
}
