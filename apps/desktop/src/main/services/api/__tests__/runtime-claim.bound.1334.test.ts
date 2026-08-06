/**
 * TICKET_1334 P0 / AC5 -- the acquisition attempt BOUND.
 *
 * Separate from `runtime-claim.1334.test.ts` because it is the one property that
 * cannot be observed against a real filesystem: "at most two O_EXCL creates per
 * call" requires counting the syscalls, which needs a mocked `node:fs`. Every
 * other claim property is a genuine kernel property and is tested against the
 * real filesystem in that file -- this file deliberately does NOT re-test them
 * against the mock, where the assertion would be about the mock's semantics.
 *
 * WHY THE BOUND MATTERS: the reap exists so one SIGKILL cannot permanently brick
 * every future runtime start. Unbounded, the reap becomes its own hazard -- two
 * hosts could reap and re-claim from each other forever, so a start would hang
 * instead of failing loudly. `CLAIM_ACQUIRE_ATTEMPTS = 2` is what makes the
 * pathological case terminate in a refusal (TICKET_857), matching
 * `sweep-run-registry.ts:191`.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: (): string => '/tmp/qnx-1334-bound', getPath: (): string => '/tmp/qnx-1334-bound' },
}));

vi.mock('../../../utils/logger', () => ({
  appLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Counts O_EXCL create attempts; every create loses (permanent EEXIST), and the
 *  claim always reads back as held by a DEAD holder -- the worst case, in which
 *  an unbounded implementation would reap/retry forever. */
let openAttempts = 0;
const DEAD_PID = 0x7ffffffe;
const STALE_CLAIM = JSON.stringify({ host: 'headless', pid: DEAD_PID, claimedAtMs: 1 });

vi.mock('node:fs', () => ({
  existsSync: (): boolean => true,
  mkdirSync: (): undefined => undefined,
  readFileSync: (): string => STALE_CLAIM,
  rmSync: (): undefined => undefined,
  closeSync: (): undefined => undefined,
  writeSync: (): number => 0,
  openSync: (): number => {
    openAttempts += 1;
    const error = new Error('EEXIST') as NodeJS.ErrnoException;
    error.code = 'EEXIST';
    throw error;
  },
}));

const { acquireRuntimeClaim } = await import('../runtime-claim');

describe('acquireRuntimeClaim attempt bound', () => {
  it('makes AT MOST two O_EXCL creates and terminates with a refusal', () => {
    openAttempts = 0;
    const result = acquireRuntimeClaim({ host: 'electron', pid: process.pid, nowMs: 1 });

    // Bounded: the initial attempt plus exactly one post-reap retry.
    expect(openAttempts).toBe(2);
    // Terminal branch names the holder rather than hanging or throwing.
    expect(result.acquired).toBe(false);
    if (result.acquired) return;
    expect(result.incumbent.pid).toBe(DEAD_PID);
    expect(result.reason).toContain('Service API already served by');
  });
});
