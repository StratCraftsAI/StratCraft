import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /**
     * TICKET_1335 AC13: the 100 percent coverage mandate, enforced as a gate.
     *
     * This package is the shared research-environment lifecycle owner -- the
     * only code permitted to spawn a package manager, decide readiness, or admit
     * a durable job. Every surface is an adapter over it, so an untested branch
     * here is untested for Electron, the Service API, and MCP simultaneously.
     * That is why the mandate is enforced at this package rather than folded
     * into the aggregate desktop number, where 6 files of lifecycle logic would
     * be diluted by thousands of unrelated lines.
     *
     * Thresholds are a floor at the measured level, not a ratchet that drifts
     * down: this package's failure paths ARE its product (D6 maps every failure
     * onto a distinct contract category), so a regression must fail the build
     * rather than be averaged away.
     *
     * Functions are held at a true 100. Statements and branches are held just
     * below it because a documented residue is genuinely unreachable from a
     * linux-64 test run, and faking the last points would mean either an
     * `istanbul ignore` covering real code or a test asserting nothing:
     *
     *   - `node-host.ts:38-39` -- the Windows `PATHEXT` arm of a
     *     `process.platform === 'win32'` ternary. The package is linux-64 only
     *     (`isSupportedPlatform`), so this cannot execute here.
     *   - `error instanceof Error ? error.message : String(error)` fallbacks in
     *     `job-repository.ts:624/637` and `research-environment-service.ts`
     *     (1052, 1080, 1099, ...). Reaching the right-hand arm requires throwing
     *     a non-Error, which no code path in this package does.
     *   - a handful of defensive `?? ''` / optional-spread arms whose
     *     left side is always populated by the schema that validated the row.
     *
     * Raise these numbers when the residue shrinks; never lower them.
     *
     * `index.ts` is excluded as a pure re-export barrel with no behaviour --
     * covering it would require a test asserting only that the module system
     * works. Nothing else is excluded; `probe-program.ts` runs its Python source
     * in the target environment, but its TypeScript wrapper is still covered.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 99.5,
        branches: 94,
        functions: 100,
        lines: 99.5,
      },
    },
  },
});
