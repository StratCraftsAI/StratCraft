import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@': path.resolve(__dirname, 'src/renderer'),
      '@host/secrets': path.resolve(__dirname, 'src/renderer/components/settings/SecretsPanel/index.ts'),
      // The CI build rebuilds the workspace dependency for Electron before
      // verify-ci starts Vitest under plain Node. The standalone MCP install is
      // the authoritative Node-ABI owner created by the workflow's npm ci.
      'better-sqlite3': path.resolve(
        __dirname,
        'src/mcp/standalone/node_modules/better-sqlite3/lib/index.js',
      ),
      // Unit tests mock Electron APIs and must not require the downloaded
      // Electron executable. CI intentionally installs workspace dependencies
      // with lifecycle scripts disabled, so resolve the module to a Node-safe
      // test adapter before individual vi.mock factories take ownership.
      electron: path.resolve(__dirname, 'test-support/electron.cjs'),
    },
  },
  test: {
    env: {
      // Raw CommonJS dependencies can require the Electron package outside
      // Vite's alias graph. Prevent its installer guard from running in the
      // Node-only unit-test process; no Electron executable is launched.
      ELECTRON_OVERRIDE_DIST_PATH: path.resolve(__dirname, 'test-support'),
    },
    clearMocks: true,
    restoreMocks: true,
    include: [
      'src/**/*.test.ts',
      // TICKET_941: signal-contract scripts live at the repo root (shared between
      // headless and Electron contexts) but their tests run under this vitest
      // config so all coverage lands in one place.
      '../../scripts/__tests__/**/*.test.ts',
      // TICKET_1003: plugin-side unit tests that depend on the desktop vitest
      // config (shared resolve aliases, environment: node).
      '../../plugins/quant-lab-nexus/ui/quant-lab-nexus/src/**/*.test.ts',
      '../../plugins/data-plugin/ui/data-nexus/src/**/*.test.ts',
      // TICKET_1208: strategy-builder-nexus plugin unit tests
      '../../plugins/strategy-builder-nexus/src/**/*.test.ts',
      '../../apps/web-dashboard/src/**/*.test.{ts,tsx}',
      'e2e/**/*.unit.test.ts',
    ],
    exclude: ['**/node_modules/**', 'src/mcp/standalone/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'src/main/**',
        'src/shared/**',
        'src/preload/**',
        'src/headless/**',
        'e2e/public-tree-evidence.ts',
        'e2e/p8-evidence.ts',
        'e2e/p9-evidence.ts',
      ],
      exclude: [
        '**/node_modules/**',
        'src/mcp/standalone/**',
        '**/*.d.ts',
        '**/types/**',
        '**/__tests__/**',
        // Entry-point / barrel files that require Electron runtime and cannot be unit tested
        'src/main/index.ts',
        'src/main/window.ts',
        'src/main/ipc/index.ts',
        'src/main/services/index.ts',
        'src/main/services/api/index.ts',
        'src/main/services/api/constants.ts',
      ],
      thresholds: {
        // TICKET_494_2 D2: all four are chosen bars matching TICKET_494's
        // 100-percent mandate. `branches` was previously 98.85 -- a measurement
        // autoUpdate had written back, not a bar anyone selected.
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
        // TICKET_494_2: MUST stay false. With autoUpdate on, any passing
        // --coverage run rewrites the values above to whatever the code
        // currently achieves, so a coverage regression silently lowers the gate
        // instead of failing the run. The numbers above are decisions, not
        // measurements -- only a human edit may change them.
        autoUpdate: false,
      },
    },
  },
});
