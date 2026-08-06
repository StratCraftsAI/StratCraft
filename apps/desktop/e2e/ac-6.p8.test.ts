import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closeApp, launchApp, type AppContext } from './fixtures';
import { createP8Evidence, finishP8Evidence, sha256File } from './p8-evidence';
import { runLocalStrategyWorkflow } from './p8-local-workflow';

const P8_WORKFLOW_TIMEOUT_MS = 10 * 60 * 1000;

test('AC-6 runs a no-login local ABI v2 workflow on real bounded data', async () => {
  test.setTimeout(P8_WORKFLOW_TIMEOUT_MS);
  test.skip(process.env.STRATCRAFT_P8_REAL_E2E !== '1',
    'Set STRATCRAFT_P8_REAL_E2E=1 after building through start.sh.');

  const evidenceState = createP8Evidence('AC-6');
  const sourcePath = resolve(__dirname, 'assets/sma-crossover-abi-v2.cpp');
  let app: AppContext | undefined;
  try {
    app = await launchApp();
    const result = await runLocalStrategyWorkflow(app.window, {
      sourceCode: readFileSync(sourcePath, 'utf8'),
      sourcePath,
      strategyName: 'P8 AC6 Local SMA',
    });
    expect(result.totalBars).toBeGreaterThan(30);
    expect(
      app.privateBackendRequests,
      'The no-login local workflow must not contact the private backend',
    ).toEqual([]);
    evidenceState.evidence.data = {
      provider: 'yfinance',
      symbol: 'AAPL',
      interval: '1d',
      requestedStart: '2024-01-02',
      requestedEnd: '2024-06-28',
      totalBars: result.totalBars,
      dataPath: result.dataPath,
    };
    evidenceState.evidence.artifacts = [
      { path: sourcePath, sha256: sha256File(sourcePath), role: 'abi-v2-source' },
      {
        path: result.compileArtifactPath,
        sha256: sha256File(result.compileArtifactPath),
        role: 'compiled-strategy',
      },
      { path: result.dataPath, sha256: sha256File(result.dataPath), role: 'real-market-data' },
    ];
    evidenceState.evidence.result = {
      algorithmId: result.algorithmId,
      version: result.version,
      taskId: result.taskId,
      compileSourceHash: result.compileSourceHash,
      metrics: result.metrics,
      persistedHistory: result.historyRecord,
      uiInspected: true,
      privateBackendContacted: app.privateBackendRequests.length > 0,
      privateBackendRequests: app.privateBackendRequests,
      commercialWorkerRequired: false,
    };
  } catch (error) {
    evidenceState.evidence.errors.push({
      stage: 'local-workflow',
      message: error instanceof Error ? error.stack || error.message : String(error),
    });
    throw error;
  } finally {
    if (app) await closeApp(app);
    finishP8Evidence(evidenceState);
  }
});
