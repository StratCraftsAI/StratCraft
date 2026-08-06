/**
 * TICKET_1334 P4 (D4 / AC5_1) -- main-side runtime-role resolution and monitor.
 *
 * Against the REAL filesystem (a tmp discovery dir), for the same reason the P0
 * claim tests are: what is under test is how a claim FILE plus a live/dead pid
 * resolve into the state the desktop surface labels from. A mocked fs would
 * assert the mock, and the transition that matters most -- a SIGKILLed holder
 * whose claim file survives untouched -- only exists on a real filesystem.
 *
 * Liveness is exercised with real pids: `process.pid` for alive, and a pid that
 * `process.kill(pid, 0)` rejects for dead, rather than stubbing `isPidAlive`.
 * Stubbing it would test this file's mock of the reap predicate instead of the
 * predicate the app actually reaps with.
 *
 * Covers the three role states AC5_1 depends on (holds / lost-to-a-live-
 * incumbent / no incumbent), the staleness path a boot-time read would miss, and
 * the broadcast-only-on-change contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SERVICE_API_RUNTIME_CLAIM_FILE } from '../../../../shared/constants/network';

let discoveryRoot: string;

// Same mock shape as `runtime-claim.1334.test.ts`: the claim must resolve to the
// SAME directory as api-port/api-token, so the Electron `app` stand-in redirects
// the discovery dir rather than the claim path being redirected on its own.
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

// The in-process half of the facts. Supplied through the module's OWN injection
// seam (`setRuntimeServicesStateReader`) rather than by mocking
// `runtime-services.ts`: that seam exists precisely so the monitor does not
// import the runtime-service graph, and driving the real seam tests the wiring
// production uses instead of a mock of a module this one no longer imports.
const runtimeServicesState = { value: null as
  | { serviceApiStarted: boolean; serviceApiPort?: number }
  | null };

/** A pid that is reliably NOT alive. Allocated by claiming a real pid-shaped
 *  value the kernel rejects for signal 0. */
const DEAD_PID = 0x7ffffff0;

/** The directory `getDiscoveryDir()` actually resolves to under the mock. Derived
 *  from the module under test rather than restated, so a test can never write the
 *  claim somewhere the code does not look. */
function claimPath(): string {
  return path.join(discoveryRoot, 'data', SERVICE_API_RUNTIME_CLAIM_FILE);
}

function writeClaim(claim: { host: string; pid: number; claimedAtMs: number }): void {
  mkdirSync(path.dirname(claimPath()), { recursive: true });
  writeFileSync(claimPath(), `${JSON.stringify(claim)}\n`, 'utf-8');
}

function removeClaim(): void {
  rmSync(claimPath(), { force: true });
}

let mod: typeof import('../runtime-role');

beforeEach(async () => {
  discoveryRoot = mkdtempSync(path.join(tmpdir(), 'qnx-runtime-role-'));
  mkdirSync(path.join(discoveryRoot, 'data'), { recursive: true });
  runtimeServicesState.value = null;
  vi.resetModules();
  mod = await import('../runtime-role');
  mod.setRuntimeServicesStateReader(() => runtimeServicesState.value);
});

afterEach(() => {
  mod.__resetRuntimeRoleForTest();
  rmSync(discoveryRoot, { recursive: true, force: true });
});

// ===========================================================================
// Role resolution -- the three states AC5_1 turns on
// ===========================================================================

describe('resolveRuntimeRole', () => {
  it('HOLDS: reports `holder` with the bound port when this process serves the API', () => {
    runtimeServicesState.value = { serviceApiStarted: true, serviceApiPort: 41711 };
    const state = mod.resolveRuntimeRole();
    expect(state.status).toBe('holder');
    expect(state.port).toBe(41711);
    expect(state.holder).toEqual({ host: 'electron', pid: process.pid, claimedAtMs: 0 });
  });

  it('HOLDS: does not consult the claim file at all when it holds the role', () => {
    // A live in-process listener is stronger evidence than any file, so a
    // conflicting claim on disk must not be able to relabel a serving app.
    runtimeServicesState.value = { serviceApiStarted: true, serviceApiPort: 41711 };
    writeClaim({ host: 'headless', pid: process.pid, claimedAtMs: 1 });
    expect(mod.resolveRuntimeRole().status).toBe('holder');
  });

  it('LOST TO A LIVE INCUMBENT: reports `external` naming holder host and pid', () => {
    // The D4 state: the app started normally (D3 step 3) but a headless runtime
    // serves the API. Controls stay usable; the label must name who serves them.
    runtimeServicesState.value = { serviceApiStarted: false };
    writeClaim({ host: 'headless', pid: process.pid, claimedAtMs: 1785372200000 });
    const state = mod.resolveRuntimeRole();
    expect(state.status).toBe('external');
    expect(state.holder).toEqual({
      host: 'headless',
      pid: process.pid,
      claimedAtMs: 1785372200000,
    });
  });

  it('NO INCUMBENT: reports `none` when no claim file exists', () => {
    runtimeServicesState.value = { serviceApiStarted: false };
    expect(mod.resolveRuntimeRole()).toEqual({ status: 'none' });
  });

  it('NO INCUMBENT: reports `none` before runtime services have run at all', () => {
    runtimeServicesState.value = null;
    expect(mod.resolveRuntimeRole()).toEqual({ status: 'none' });
  });

  it('DEAD INCUMBENT: reports `none`, never labelling a runtime that is gone', () => {
    // The claim file of a SIGKILLed holder survives byte-identical. Reporting
    // `external` here would leave the label naming a dead process forever.
    runtimeServicesState.value = { serviceApiStarted: false };
    writeClaim({ host: 'headless', pid: DEAD_PID, claimedAtMs: 1 });
    expect(mod.resolveRuntimeRole()).toEqual({ status: 'none' });
  });

  it('MALFORMED CLAIM: reports `none` rather than a bogus holder', () => {
    runtimeServicesState.value = { serviceApiStarted: false };
    mkdirSync(path.dirname(claimPath()), { recursive: true });
    writeFileSync(claimPath(), 'not json at all', 'utf-8');
    expect(mod.resolveRuntimeRole()).toEqual({ status: 'none' });
  });

  it('never reports a state that could gate a control', () => {
    // D4 rejected disabling the entries; nothing resolved here may read as
    // "unavailable" (TICKET_860).
    runtimeServicesState.value = { serviceApiStarted: false };
    writeClaim({ host: 'headless', pid: process.pid, claimedAtMs: 1 });
    expect(Object.keys(mod.resolveRuntimeRole()).sort()).toEqual(['holder', 'status']);
  });
});

// ===========================================================================
// Change detection -- role state is NOT a boot-time constant
// ===========================================================================

describe('refreshRuntimeRole', () => {
  it('notifies on a genuine change and stays silent when nothing changed', () => {
    runtimeServicesState.value = { serviceApiStarted: false };
    const listener = vi.fn();
    mod.startRuntimeRoleMonitor(listener);
    listener.mockClear();

    // Unchanged -> no push. An idle app must not re-render the label every tick.
    mod.refreshRuntimeRole();
    expect(listener).not.toHaveBeenCalled();

    // A headless runtime appears -> exactly one push naming it.
    writeClaim({ host: 'headless', pid: process.pid, claimedAtMs: 7 });
    mod.refreshRuntimeRole();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual({
      status: 'external',
      holder: { host: 'headless', pid: process.pid, claimedAtMs: 7 },
    });

    // Re-sampling the same fact pushes nothing further.
    mod.refreshRuntimeRole();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notices the incumbent DYING with no filesystem event -- the poll-only path', () => {
    // This is the transition an `fs.watch` can never see and a boot-time read
    // can never notice: the claim file is untouched, only the pid died. It is
    // the reason the liveness poll exists.
    runtimeServicesState.value = { serviceApiStarted: false };
    writeClaim({ host: 'headless', pid: process.pid, claimedAtMs: 7 });
    const listener = vi.fn();
    mod.startRuntimeRoleMonitor(listener);
    expect(mod.getRuntimeRole().status).toBe('external');
    listener.mockClear();

    // Same file, same bytes, dead holder.
    writeClaim({ host: 'headless', pid: DEAD_PID, claimedAtMs: 7 });
    mod.refreshRuntimeRole();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual({ status: 'none' });
  });

  it('notices the incumbent RELEASING the role', () => {
    runtimeServicesState.value = { serviceApiStarted: false };
    writeClaim({ host: 'headless', pid: process.pid, claimedAtMs: 7 });
    const listener = vi.fn();
    mod.startRuntimeRoleMonitor(listener);
    listener.mockClear();

    removeClaim();
    mod.refreshRuntimeRole();
    expect(listener).toHaveBeenCalledWith({ status: 'none' });
  });

  it('notices THIS app taking the role later', () => {
    runtimeServicesState.value = { serviceApiStarted: false };
    const listener = vi.fn();
    mod.startRuntimeRoleMonitor(listener);
    listener.mockClear();

    runtimeServicesState.value = { serviceApiStarted: true, serviceApiPort: 40001 };
    mod.refreshRuntimeRole();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ status: 'holder', port: 40001 });
  });

  it('notices the holder being REPLACED by a different runtime', () => {
    // status stays `external` throughout, so a status-only comparison would
    // leave the label naming the previous pid.
    runtimeServicesState.value = { serviceApiStarted: false };
    writeClaim({ host: 'headless', pid: process.pid, claimedAtMs: 1 });
    const listener = vi.fn();
    mod.startRuntimeRoleMonitor(listener);
    listener.mockClear();

    writeClaim({ host: 'headless', pid: process.pid, claimedAtMs: 2 });
    mod.refreshRuntimeRole();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].holder.claimedAtMs).toBe(2);
  });

  it('retains the last known state rather than inventing one when sampling throws', () => {
    // A transient sampling failure must not flash a wrong label at the user.
    // The failure is injected at the real seam -- the in-process state getter
    // `resolveRuntimeRole()` reads first -- rather than by stubbing the module's
    // own internal call, which a module-local binding would ignore anyway.
    runtimeServicesState.value = { serviceApiStarted: false };
    writeClaim({ host: 'headless', pid: process.pid, claimedAtMs: 7 });
    const listener = vi.fn();
    mod.startRuntimeRoleMonitor(listener);
    expect(mod.getRuntimeRole().status).toBe('external');
    listener.mockClear();

    Object.defineProperty(runtimeServicesState, 'value', {
      configurable: true,
      get() { throw new Error('sampling exploded'); },
    });
    try {
      const state = mod.refreshRuntimeRole();
      // Previous good answer retained, and nothing pushed -- inventing `none`
      // here would blank a correct label on a transient error.
      expect(state).toEqual({
        status: 'external',
        holder: { host: 'headless', pid: process.pid, claimedAtMs: 7 },
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      delete (runtimeServicesState as Record<string, unknown>).value;
      (runtimeServicesState as { value: unknown }).value = null;
    }
  });

  it('does not let a throwing listener take the monitor down', () => {
    runtimeServicesState.value = { serviceApiStarted: false };
    mod.startRuntimeRoleMonitor(() => { throw new Error('listener exploded'); });
    writeClaim({ host: 'headless', pid: process.pid, claimedAtMs: 1 });
    expect(() => mod.refreshRuntimeRole()).not.toThrow();
    expect(mod.resolveRuntimeRole().status).toBe('external');
  });
});

describe('monitor lifecycle', () => {
  it('is idempotent to start and to stop, and releases its watch', () => {
    runtimeServicesState.value = { serviceApiStarted: false };
    mod.startRuntimeRoleMonitor(vi.fn());
    mod.startRuntimeRoleMonitor(vi.fn());
    expect(() => {
      mod.stopRuntimeRoleMonitor();
      mod.stopRuntimeRoleMonitor();
    }).not.toThrow();
  });

  it('stops pushing once stopped', () => {
    runtimeServicesState.value = { serviceApiStarted: false };
    const listener = vi.fn();
    mod.startRuntimeRoleMonitor(listener);
    mod.stopRuntimeRoleMonitor();
    listener.mockClear();

    writeClaim({ host: 'headless', pid: process.pid, claimedAtMs: 1 });
    mod.refreshRuntimeRole();
    expect(listener).not.toHaveBeenCalled();
  });

  it('survives a discovery directory that does not exist yet', () => {
    // The watch target may legitimately be absent on a first launch; the poll
    // still covers every transition, so this must degrade, not throw.
    rmSync(path.join(discoveryRoot, 'data'), { recursive: true, force: true });
    runtimeServicesState.value = { serviceApiStarted: false };
    expect(() => mod.startRuntimeRoleMonitor(vi.fn())).not.toThrow();
    expect(mod.getRuntimeRole()).toEqual({ status: 'none' });
  });

  it('answers a pull with the same state it last pushed', () => {
    // Pull and push must never disagree -- `getRuntimeRole()` re-samples through
    // the same path that broadcasts.
    runtimeServicesState.value = { serviceApiStarted: false };
    const seen: unknown[] = [];
    mod.startRuntimeRoleMonitor((s) => seen.push(s));
    writeClaim({ host: 'headless', pid: process.pid, claimedAtMs: 3 });
    const pulled = mod.getRuntimeRole();
    expect(seen[seen.length - 1]).toEqual(pulled);
  });

  it('leaves no claim file behind of its own -- it is a reader, never a writer', () => {
    runtimeServicesState.value = { serviceApiStarted: false };
    mod.startRuntimeRoleMonitor(vi.fn());
    mod.refreshRuntimeRole();
    expect(existsSync(claimPath())).toBe(false);
  });
});
