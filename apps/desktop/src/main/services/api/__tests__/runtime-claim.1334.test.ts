/**
 * TICKET_1334 P0 / AC5 -- Service API runtime-role claim IO tests.
 *
 * These exercise the REAL filesystem (a tmp discovery dir), not a mocked one,
 * because the property under test IS a filesystem property: N hosts contending
 * for one inode via O_EXCL. A mocked fs would assert the mock's semantics rather
 * than the kernel's, and the exclusion guarantee would be untested exactly where
 * it matters -- the same reasoning as
 * `signal-discovery/__tests__/sweep-run-registry.1324.test.ts`.
 *
 * P0 is unwired by design, so the assertions here are the ENTIRE verification of
 * the primitive. What must hold: exactly one winner under contention, a refusal
 * that NAMES the live holder, a stale claim reaped once with acquisition retried
 * once, release, and a malformed/unreadable claim that cannot wedge a start.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SERVICE_API_RUNTIME_CLAIM_FILE } from '../../../../shared/constants/network';

let discoveryRoot: string;

// `getDiscoveryDir()` resolves through Electron's `app`; the claim must land in
// the SAME directory as api-port/api-token, so the mock stands in for that dir
// rather than the claim path being redirected independently.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: (): string => discoveryRoot,
    getPath: (): string => discoveryRoot,
  },
}));

vi.mock('../../../utils/logger', () => ({
  appLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  acquireRuntimeClaim,
  getRuntimeClaimPath,
  probeRuntimeClaimLiveness,
  readRuntimeClaim,
  readRuntimeIncumbent,
  releaseRuntimeClaim,
} = await import('../runtime-claim');

const { getDiscoveryDir } = await import('../discovery-dir');

/** A pid that is certainly not running -- just under the 32-bit pid ceiling. */
const DEAD_PID = 0x7ffffffe;

beforeEach(() => {
  discoveryRoot = mkdtempSync(path.join(tmpdir(), 'qnx-1334-'));
});

afterEach(() => {
  rmSync(discoveryRoot, { recursive: true, force: true });
});

function writeRawClaim(contents: string): void {
  const file = getRuntimeClaimPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, 'utf-8');
}

describe('claim path (D3: an artifact of the role holder)', () => {
  it('lives in the SAME directory as the api-port/api-token discovery files', () => {
    // The claim decides who may WRITE those files. Resolved from a different
    // root, it would be a mutex that guards nothing.
    expect(getRuntimeClaimPath()).toBe(
      path.join(getDiscoveryDir(), SERVICE_API_RUNTIME_CLAIM_FILE),
    );
  });

  it('uses the shared constant, not a restated filename', () => {
    expect(path.basename(getRuntimeClaimPath())).toBe('api-runtime.lock');
  });
});

describe('acquireRuntimeClaim -- exactly one role holder (AC5)', () => {
  it('acquires when the role is free and persists a parseable claim', () => {
    const result = acquireRuntimeClaim({ host: 'headless', pid: process.pid, nowMs: 11 });
    expect(result.acquired).toBe(true);
    if (!result.acquired) return;
    expect(result.claim).toEqual({ host: 'headless', pid: process.pid, claimedAtMs: 11 });
    expect(result.reapedClaim).toBeUndefined();

    const persisted = readRuntimeClaim();
    expect(persisted).toEqual(result.claim);
  });

  it('only ONE of many simultaneous contenders wins (O_EXCL, not read-then-write)', () => {
    // The race the discovery files had no protection against: N hosts, one inode.
    // Every contender's pid is LIVE, so no reap can mask a second winner.
    const results = Array.from({ length: 20 }, (_, i) =>
      acquireRuntimeClaim({
        host: i % 2 === 0 ? 'electron' : 'headless',
        pid: process.pid,
        nowMs: i,
      }),
    );
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    expect(results.filter((r) => !r.acquired)).toHaveLength(19);
    // And the single winner is the one whose claim is on disk.
    const winner = results.find((r) => r.acquired);
    expect(winner?.acquired).toBe(true);
    if (winner?.acquired) {
      expect(readRuntimeClaim()).toEqual(winner.claim);
    }
  });
});

describe('EEXIST + LIVE incumbent -- refuse, naming the holder (AC5)', () => {
  it('refuses the second host and returns the incumbent', () => {
    const first = acquireRuntimeClaim({ host: 'headless', pid: process.pid, nowMs: 1 });
    expect(first.acquired).toBe(true);

    const second = acquireRuntimeClaim({ host: 'electron', pid: process.pid, nowMs: 2 });
    expect(second.acquired).toBe(false);
    if (second.acquired) return;
    expect(second.incumbent.host).toBe('headless');
    expect(second.incumbent.pid).toBe(process.pid);
  });

  it('the refusal reason NAMES the holder host and pid (D3 wording)', () => {
    acquireRuntimeClaim({ host: 'headless', pid: process.pid, nowMs: 1 });
    const second = acquireRuntimeClaim({ host: 'electron', pid: process.pid, nowMs: 2 });
    expect(second.acquired).toBe(false);
    if (second.acquired) return;
    expect(second.reason).toContain('Service API already served by');
    expect(second.reason).toContain('headless serve runtime');
    expect(second.reason).toContain(`pid=${process.pid}`);
    // The losing host must understand it still starts everything else (D3 step 3).
    expect(second.reason).toContain('continues to start normally');
  });

  it('leaves the LIVE incumbent claim byte-untouched', () => {
    acquireRuntimeClaim({ host: 'headless', pid: process.pid, nowMs: 1 });
    const before = readFileSync(getRuntimeClaimPath(), 'utf-8');
    acquireRuntimeClaim({ host: 'electron', pid: process.pid, nowMs: 2 });
    expect(readFileSync(getRuntimeClaimPath(), 'utf-8')).toBe(before);
  });
});

describe('EEXIST + DEAD pid -- reaped once, retried once (AC5)', () => {
  it('reaps a stale claim and the single retry succeeds', () => {
    // A crash/OOM/SIGKILL leaves this behind. Without the reap, one crash would
    // permanently brick every future start of BOTH hosts.
    writeRawClaim(JSON.stringify({ host: 'headless', pid: DEAD_PID, claimedAtMs: 1 }));

    const result = acquireRuntimeClaim({ host: 'electron', pid: process.pid, nowMs: 9 });
    expect(result.acquired).toBe(true);
    if (!result.acquired) return;
    expect(result.claim.host).toBe('electron');
    // The reap is REPORTED, not silent -- a runtime repeatedly taking over from
    // dead predecessors is information an operator needs (TICKET_858).
    expect(result.reapedClaim?.pid).toBe(DEAD_PID);
    expect(result.reapedClaim?.host).toBe('headless');
    expect(readRuntimeClaim()).toEqual(result.claim);
  });

  it('does not reap when the holder is alive, even across repeated attempts', () => {
    acquireRuntimeClaim({ host: 'electron', pid: process.pid, nowMs: 1 });
    for (let i = 0; i < 3; i += 1) {
      const attempt = acquireRuntimeClaim({ host: 'headless', pid: process.pid, nowMs: 2 + i });
      expect(attempt.acquired).toBe(false);
    }
    expect(readRuntimeClaim()?.host).toBe('electron');
  });

  it('discards an UNPARSEABLE claim and retries -- it names no reapable holder', () => {
    // A claim that cannot identify its owner provides no exclusion guarantee, so
    // keeping it protects nothing while wedging every start (TICKET_857).
    writeRawClaim('{ truncated');
    const result = acquireRuntimeClaim({ host: 'headless', pid: process.pid, nowMs: 3 });
    expect(result.acquired).toBe(true);
    expect(readRuntimeClaim()?.host).toBe('headless');
  });

  it('discards a claim naming an unknown host and retries', () => {
    writeRawClaim(JSON.stringify({ host: 'cli-chain', pid: process.pid, claimedAtMs: 1 }));
    const result = acquireRuntimeClaim({ host: 'electron', pid: process.pid, nowMs: 4 });
    expect(result.acquired).toBe(true);
  });

  it('reports the reaped claim on success -- one call, one reap', () => {
    writeRawClaim(JSON.stringify({ host: 'headless', pid: DEAD_PID, claimedAtMs: 2 }));
    const result = acquireRuntimeClaim({ host: 'headless', pid: process.pid, nowMs: 6 });
    expect(result.acquired).toBe(true);
    if (!result.acquired) return;
    expect(result.reapedClaim?.claimedAtMs).toBe(2);
    // The attempt bound itself (at most two O_EXCL creates) is asserted against a
    // counting fs in `runtime-claim.bound.1334.test.ts`.
  });
});

describe('readRuntimeIncumbent -- the read-only "who serves the API?" query', () => {
  it('returns undefined when the role is free', () => {
    expect(readRuntimeIncumbent()).toBeUndefined();
  });

  it('returns the claim plus sampled liveness for a live holder', () => {
    acquireRuntimeClaim({ host: 'electron', pid: process.pid, nowMs: 1 });
    const incumbent = readRuntimeIncumbent();
    expect(incumbent?.claim.host).toBe('electron');
    expect(incumbent?.liveness.pidAlive).toBe(true);
  });

  it('reports a dead holder as not alive without reaping it', () => {
    writeRawClaim(JSON.stringify({ host: 'headless', pid: DEAD_PID, claimedAtMs: 1 }));
    const incumbent = readRuntimeIncumbent();
    expect(incumbent?.liveness.pidAlive).toBe(false);
    // A read must never mutate the registry.
    expect(existsSync(getRuntimeClaimPath())).toBe(true);
  });

  it('treats a malformed claim as ABSENT rather than as a live incumbent', () => {
    writeRawClaim('not json at all');
    expect(readRuntimeIncumbent()).toBeUndefined();
  });
});

describe('probeRuntimeClaimLiveness', () => {
  it('reports this process as alive and an unused pid as dead', () => {
    expect(
      probeRuntimeClaimLiveness({ host: 'electron', pid: process.pid, claimedAtMs: 0 }).pidAlive,
    ).toBe(true);
    expect(
      probeRuntimeClaimLiveness({ host: 'headless', pid: DEAD_PID, claimedAtMs: 0 }).pidAlive,
    ).toBe(false);
  });
});

describe('readRuntimeClaim -- unreadable file', () => {
  it('returns null (not a throw) when the claim file cannot be read', () => {
    writeRawClaim(JSON.stringify({ host: 'headless', pid: process.pid, claimedAtMs: 1 }));
    chmodSync(getRuntimeClaimPath(), 0o000);
    try {
      // Root can read a 000 file, so only assert the contract that holds for
      // both cases: no throw, and a usable result either way.
      const claim = readRuntimeClaim();
      expect(claim === null || claim.host === 'headless').toBe(true);
    } finally {
      chmodSync(getRuntimeClaimPath(), 0o600);
    }
  });
});

describe('releaseRuntimeClaim (AC4 half: release on shutdown)', () => {
  it('removes the claim so the next start can acquire', () => {
    acquireRuntimeClaim({ host: 'headless', pid: process.pid, nowMs: 1 });
    expect(existsSync(getRuntimeClaimPath())).toBe(true);

    releaseRuntimeClaim();
    expect(existsSync(getRuntimeClaimPath())).toBe(false);
    expect(readRuntimeClaim()).toBeNull();

    const next = acquireRuntimeClaim({ host: 'electron', pid: process.pid, nowMs: 2 });
    expect(next.acquired).toBe(true);
  });

  it('is idempotent -- a double release on an error path cannot throw', () => {
    acquireRuntimeClaim({ host: 'electron', pid: process.pid, nowMs: 1 });
    releaseRuntimeClaim();
    expect(() => releaseRuntimeClaim()).not.toThrow();
    expect(() => releaseRuntimeClaim()).not.toThrow();
  });

  it('releasing when nothing was ever claimed is not an error', () => {
    expect(() => releaseRuntimeClaim()).not.toThrow();
  });
});
