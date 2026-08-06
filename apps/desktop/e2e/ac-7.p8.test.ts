import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closeApp, launchApp, type AppContext } from './fixtures';
import { createP8Evidence, finishP8Evidence, sha256File } from './p8-evidence';
import { runLocalStrategyWorkflow } from './p8-local-workflow';

const START_ENDPOINT = '/api/start_market_regime_analysis';
const POLL_ENDPOINT = '/api/check_market_regime_status';
const P8_WORKFLOW_TIMEOUT_MS = 10 * 60 * 1000;
const GENERATION_POLL_INTERVAL_MS = 1000;
const GENERATION_POLL_ATTEMPTS = 180;

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for AC-7 authenticated E2E`);
  return value;
}

function extractTaskId(payload: any): string | undefined {
  return payload?.task_id || payload?.data?.task_id;
}

function extractGeneratedCode(payload: any): string | undefined {
  const result = payload?.data?.result || payload?.result || payload?.data || payload;
  return result?.strategy_code || result?.strategyCode;
}

test('AC-7 authenticates backend generation then validates and runs locally', async () => {
  test.setTimeout(P8_WORKFLOW_TIMEOUT_MS);
  test.skip(process.env.STRATCRAFT_P8_AUTH_E2E !== '1',
    'Set STRATCRAFT_P8_AUTH_E2E=1 with a live Basic token and request JSON.');

  const evidenceState = createP8Evidence('AC-7');
  let app: AppContext | undefined;
  try {
    const baseUrl = requireEnvironment('STRATCRAFT_E2E_BACKEND_URL').replace(/\/$/, '');
    const token = requireEnvironment('STRATCRAFT_E2E_BASIC_ACCESS_TOKEN');
    const requestBody = JSON.parse(requireEnvironment('STRATCRAFT_E2E_AC7_REQUEST_JSON'));

    const anonymous = await fetch(`${baseUrl}${START_ENDPOINT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    expect(anonymous.status).toBe(401);

    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    };
    const start = await fetch(`${baseUrl}${START_ENDPOINT}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    const startPayload = await start.json();
    expect(start.ok).toBe(true);
    const taskId = extractTaskId(startPayload);
    expect(taskId).toBeTruthy();

    let terminalPayload: any = startPayload;
    let generatedCode = extractGeneratedCode(startPayload);
    for (
      let attempt = 0;
      !generatedCode && attempt < GENERATION_POLL_ATTEMPTS;
      attempt += 1
    ) {
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, GENERATION_POLL_INTERVAL_MS));
      const poll = await fetch(`${baseUrl}${POLL_ENDPOINT}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ task_id: taskId }),
      });
      expect(poll.ok).toBe(true);
      terminalPayload = await poll.json();
      const status = terminalPayload?.data?.status || terminalPayload?.status;
      if (status === 'failed' || status === 'rejected') {
        throw new Error(`Backend generation failed: ${JSON.stringify(terminalPayload)}`);
      }
      generatedCode = extractGeneratedCode(terminalPayload);
    }
    expect(generatedCode).toContain('QNX_STRATEGY_FACTORY_EXPORT');

    const generatedDir = resolve(__dirname, '../test-results/p8/generated');
    const sourcePath = resolve(generatedDir, `ac7-${taskId}.cpp`);
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(sourcePath, generatedCode!, 'utf8');

    app = await launchApp();
    const unauthenticatedUi = await app.window.evaluate(async () =>
      (globalThis as any).electronAPI.strategy.generate({
        strategy_name: 'P8 unauthenticated rejection',
        regime: 'trend',
      }));
    expect(unauthenticatedUi).toMatchObject({ success: false });
    expect(unauthenticatedUi.error).toContain('AUTH');

    const result = await runLocalStrategyWorkflow(app.window, {
      sourceCode: generatedCode!,
      sourcePath,
      strategyName: 'P8 AC7 Authenticated Generated',
    });
    expect(
      app.privateBackendRequests,
      'The local execution half must not contact the private backend',
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
      { path: sourcePath, sha256: sha256File(sourcePath), role: 'backend-generated-abi-v2-source' },
      {
        path: result.compileArtifactPath,
        sha256: sha256File(result.compileArtifactPath),
        role: 'compiled-strategy',
      },
      { path: result.dataPath, sha256: sha256File(result.dataPath), role: 'real-market-data' },
    ];
    evidenceState.evidence.result = {
      backend: {
        baseUrl,
        startEndpoint: START_ENDPOINT,
        pollEndpoint: POLL_ENDPOINT,
        anonymousStatus: anonymous.status,
        authenticatedStartStatus: start.status,
        taskId,
        terminalStatus: terminalPayload?.data?.status || terminalPayload?.status || 'synchronous',
      },
      algorithmId: result.algorithmId,
      version: result.version,
      backtestTaskId: result.taskId,
      compileSourceHash: result.compileSourceHash,
      metrics: result.metrics,
      persistedHistory: result.historyRecord,
      unauthenticatedUiError: unauthenticatedUi.error,
      localPrivateBackendRequests: app.privateBackendRequests,
      uiInspected: true,
    };
  } catch (error) {
    evidenceState.evidence.errors.push({
      stage: 'authenticated-generation-workflow',
      message: error instanceof Error ? error.stack || error.message : String(error),
    });
    throw error;
  } finally {
    if (app) await closeApp(app);
    finishP8Evidence(evidenceState);
  }
});
