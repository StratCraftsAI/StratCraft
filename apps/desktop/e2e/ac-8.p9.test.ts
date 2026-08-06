import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closeApp, launchAppWithWorkerInstallation } from './fixtures';
import { buildMockWorkerPackage, createMockTrustStore } from './p9-mock-worker';
import { createP9Evidence, finishP9Evidence, sha256File, type P9LifecycleStep } from './p9-evidence';
import { runLocalStrategyWorkflow } from './p8-local-workflow';

const P9_WORKFLOW_TIMEOUT_MS = 15 * 60 * 1000;

function step(
  steps: P9LifecycleStep[],
  action: P9LifecycleStep['action'],
  success: boolean,
  detail: Record<string, unknown>,
): void {
  steps.push({ action, success, detail });
}

test('AC-8 commercial install/upgrade/uninstall/post-uninstall rerun', async () => {
  test.setTimeout(P9_WORKFLOW_TIMEOUT_MS);
  test.skip(process.env.STRATCRAFT_P9_REAL_E2E !== '1',
    'Set STRATCRAFT_P9_REAL_E2E=1 after building through start.sh.');

  const evidenceState = createP9Evidence();
  const fixtureRoot = resolve(__dirname, '../test-results/p9/fixtures');
  const trustFixture = createMockTrustStore(fixtureRoot);
  const installationRoot = resolve(fixtureRoot, 'installed');

  const v100PackagePath = buildMockWorkerPackage(
    fixtureRoot, '1.0.0', trustFixture,
  );
  const v200PackagePath = buildMockWorkerPackage(
    fixtureRoot, '2.0.0', trustFixture, { upgradesFrom: ['1.0.0'] },
  );

  const app = await launchAppWithWorkerInstallation({
    trustStorePath: trustFixture.trustStorePath,
    installationRoot,
  });

  try {
    // ------------------------------------------------------------------
    // Phase 1: Install v1.0.0
    // ------------------------------------------------------------------
    const installResult = await app.window.evaluate(
      async (sourcePath: string) =>
        (globalThis as any).electronAPI.researchWorker.e2eInstall(sourcePath),
      v100PackagePath,
    );
    expect(
      installResult,
      `Install v1.0.0 failed: ${installResult?.error ?? 'unknown'}`,
    ).toMatchObject({ success: true });
    step(evidenceState.evidence.lifecycleSteps, 'install', true, {
      version: '1.0.0', path: v100PackagePath,
    });

    // Phase 1b: Discover after install
    const discoverV1 = await app.window.evaluate(async () =>
      (globalThis as any).electronAPI.researchWorker.discover());
    expect(discoverV1).toMatchObject({
      state: 'ready',
      packageVersion: '1.0.0',
    });
    step(evidenceState.evidence.lifecycleSteps, 'discover', true, {
      state: 'ready',
      packageVersion: '1.0.0',
      capabilities: discoverV1.capabilities,
    });

    // ------------------------------------------------------------------
    // Phase 2: Upgrade to v2.0.0
    // ------------------------------------------------------------------
    const upgradeResult = await app.window.evaluate(
      async (sourcePath: string) =>
        (globalThis as any).electronAPI.researchWorker.e2eInstall(sourcePath),
      v200PackagePath,
    );
    expect(
      upgradeResult,
      `Upgrade to v2.0.0 failed: ${upgradeResult?.error ?? 'unknown'}`,
    ).toMatchObject({ success: true });
    step(evidenceState.evidence.lifecycleSteps, 'upgrade', true, {
      from: '1.0.0', to: '2.0.0', path: v200PackagePath,
    });

    // Phase 2b: Discover after upgrade
    const discoverV2 = await app.window.evaluate(async () =>
      (globalThis as any).electronAPI.researchWorker.discover());
    expect(discoverV2).toMatchObject({
      state: 'ready',
      packageVersion: '2.0.0',
    });
    step(evidenceState.evidence.lifecycleSteps, 'discover', true, {
      state: 'ready',
      packageVersion: '2.0.0',
    });

    // ------------------------------------------------------------------
    // Phase 3: Uninstall
    // ------------------------------------------------------------------
    const uninstallResult = await app.window.evaluate(async () =>
      (globalThis as any).electronAPI.researchWorker.e2eUninstall());
    expect(
      uninstallResult,
      `Uninstall failed: ${uninstallResult?.error ?? 'unknown'}`,
    ).toMatchObject({ success: true });
    step(evidenceState.evidence.lifecycleSteps, 'uninstall', true, {});

    // Phase 3b: Discover after uninstall - must be absent
    const discoverAbsent = await app.window.evaluate(async () =>
      (globalThis as any).electronAPI.researchWorker.discover());
    expect(discoverAbsent).toEqual({ state: 'absent' });
    step(evidenceState.evidence.lifecycleSteps, 'post-uninstall-discover', true, {
      state: 'absent',
    });

    // ------------------------------------------------------------------
    // Phase 4: Rerun open local workflow after uninstall
    // ------------------------------------------------------------------
    const sourcePath = resolve(__dirname, 'assets/sma-crossover-abi-v2.cpp');
    const localResult = await runLocalStrategyWorkflow(app.window, {
      sourceCode: readFileSync(sourcePath, 'utf8'),
      sourcePath,
      strategyName: 'P9 AC8 Post-Uninstall Open',
    });
    expect(localResult.totalBars).toBeGreaterThan(30);
    expect(
      app.privateBackendRequests,
      'The post-uninstall open workflow must not contact the private backend',
    ).toEqual([]);
    step(evidenceState.evidence.lifecycleSteps, 'post-uninstall-open-workflow', true, {
      algorithmId: localResult.algorithmId,
      taskId: localResult.taskId,
      totalBars: localResult.totalBars,
      metrics: localResult.metrics,
    });

    evidenceState.evidence.artifacts = [
      { path: trustFixture.trustStorePath, sha256: sha256File(trustFixture.trustStorePath), role: 'ephemeral-trust-store' },
      { path: v100PackagePath, role: 'signed-worker-v1.0.0' },
      { path: v200PackagePath, role: 'signed-worker-v2.0.0' },
      { path: sourcePath, sha256: sha256File(sourcePath), role: 'post-uninstall-abi-v2-source' },
      {
        path: localResult.compileArtifactPath,
        sha256: sha256File(localResult.compileArtifactPath),
        role: 'post-uninstall-compiled-strategy',
      },
    ];
  } catch (error) {
    evidenceState.evidence.errors.push({
      stage: 'commercial-lifecycle',
      message: error instanceof Error ? error.stack || error.message : String(error),
    });
    throw error;
  } finally {
    await closeApp(app);
    finishP9Evidence(evidenceState);
  }
});
