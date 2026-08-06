import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /**
     * TICKET_1361 P0: 100 percent coverage mandate (TICKET_494).
     *
     * functions held at true 100. statements/branches/lines held just below:
     *
     *   - `validation.ts:99-103` -- the CorrectiveError throw inside
     *     `validateStateTransition` is unreachable because the v1 state machine
     *     is fully connected (every state can reach every other). The guard
     *     exists for future schema versions that may restrict transitions. The
     *     `isValidStateTransition` call accesses the transition map which
     *     throws TypeError on unknown keys before our throw can run.
     *
     * Raise these numbers when the residue shrinks; never lower them.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/operations.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 99,
        branches: 98,
        functions: 100,
        lines: 99,
      },
    },
  },
});
