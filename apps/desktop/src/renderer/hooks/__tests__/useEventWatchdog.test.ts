/**
 * useEventWatchdog tests -- TICKET_755_1 Phase 1.
 *
 * Tests `createWatchdog` (the framework-agnostic core) directly. The hook
 * itself is a thin React wrapper; the codebase does not depend on
 * `@testing-library/react`, so React-render-based tests are not possible
 * (see Phase 0 verification log). All 7 test cases from TICKET_755 "Test
 * Cases" section are exercised against the core timer behavior plus a
 * compile-time check of the hook's exported types.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createWatchdog,
  useEventWatchdog,
  type WatchdogTimer,
  type UseEventWatchdogParams,
} from '@StratCraft/shared-ui';

describe('createWatchdog', () => {
  let wd: WatchdogTimer;

  beforeEach(() => {
    vi.useFakeTimers();
    wd = createWatchdog();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Case 1: fires after timeoutMs of silence
  // -------------------------------------------------------------------------
  it('fires onTimeout after timeoutMs of silence', () => {
    const onTimeout = vi.fn();
    wd.beginSession(1000, onTimeout);

    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(wd.hasFired()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Case 2: resetWithin extends the deadline
  // -------------------------------------------------------------------------
  it('resetWithin restarts the countdown', () => {
    const onTimeout = vi.fn();
    wd.beginSession(1000, onTimeout);

    vi.advanceTimersByTime(800);
    wd.resetWithin(1000, onTimeout);

    vi.advanceTimersByTime(800);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Case 3: endSession clears the timer without firing
  // -------------------------------------------------------------------------
  it('endSession cancels a pending timer', () => {
    const onTimeout = vi.fn();
    wd.beginSession(1000, onTimeout);

    vi.advanceTimersByTime(500);
    wd.endSession();

    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(wd.hasFired()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Case 4: a fresh watchdog (proxy for unmount-then-remount) does not
  //          inherit pending timers from a discarded instance
  // -------------------------------------------------------------------------
  it('a discarded watchdog instance does not fire after endSession', () => {
    const onTimeout = vi.fn();
    wd.beginSession(1000, onTimeout);
    wd.endSession();

    const fresh = createWatchdog();
    const onTimeoutFresh = vi.fn();
    fresh.beginSession(1000, onTimeoutFresh);

    vi.advanceTimersByTime(2000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onTimeoutFresh).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Case 5: once per session -- resetWithin after fire does NOT re-arm
  // -------------------------------------------------------------------------
  it('fires at most once per active session even on later resetWithin', () => {
    const onTimeout = vi.fn();
    wd.beginSession(1000, onTimeout);

    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    // Simulate a stale dep-change after the timeout already fired -- the
    // hook's effect would call resetWithin; the watchdog must not re-fire
    // because the active session has not ended.
    wd.resetWithin(1000, onTimeout);
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    // A new session (after endSession) is eligible to fire again.
    wd.endSession();
    wd.beginSession(1000, onTimeout);
    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Case 6: latest onTimeout closure is honored (caller controls identity)
  // -------------------------------------------------------------------------
  it('uses the onTimeout passed to the latest arm call', () => {
    const first = vi.fn();
    const second = vi.fn();
    wd.beginSession(1000, first);

    vi.advanceTimersByTime(500);
    wd.resetWithin(1000, second);

    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Case 7: changing timeoutMs mid-session uses the new value
  // -------------------------------------------------------------------------
  it('changing timeoutMs mid-session uses the new value', () => {
    const onTimeout = vi.fn();
    wd.beginSession(5000, onTimeout);

    vi.advanceTimersByTime(100);
    wd.resetWithin(500, onTimeout);

    vi.advanceTimersByTime(499);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Type-level sanity check for the hook's public contract.
// ---------------------------------------------------------------------------
describe('useEventWatchdog (type contract)', () => {
  it('exports the expected params shape and callable hook', () => {
    expect(typeof useEventWatchdog).toBe('function');

    // Compile-time exercise; not asserted at runtime.
    const params: UseEventWatchdogParams = {
      active: false,
      timeoutMs: 1000,
      resetSignals: [1, 'a', null],
      onTimeout: () => undefined,
    };
    expect(params.active).toBe(false);
    expect(params.timeoutMs).toBe(1000);
  });
});
