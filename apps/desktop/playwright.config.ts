import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/*.unit.test.ts',
  // Playwright CLEARS outputDir on every run. Its default is `test-results/`,
  // which is also where the P8/P9 acceptance evidence and worker fixtures are
  // committed (see e2e/p8-evidence.ts) -- so a default-configured run deletes
  // tracked evidence as a side effect. Per-run artifacts get their own
  // directory; the committed evidence tree is never the scratch target.
  outputDir: './playwright-artifacts',
  globalSetup: process.platform === 'linux' ? './e2e/global-setup.ts' : undefined,
  timeout: 60_000,
  retries: 1,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
