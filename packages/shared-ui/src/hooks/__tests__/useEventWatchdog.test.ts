import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createWatchdog,
  useEventWatchdog,
  type WatchdogTimer,
  type UseEventWatchdogParams,
} from '../useEventWatchdog';

describe('createWatchdog', () => {
  let wd: WatchdogTimer;

  beforeEach(() => {
    vi.useFakeTimers();
    wd = createWatchdog();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onTimeout after timeoutMs of silence', () => {
    const onTimeout = vi.fn();
    wd.beginSession(1000, onTimeout);

    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(wd.hasFired()).toBe(true);
  });

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

  it('endSession cancels a pending timer', () => {
    const onTimeout = vi.fn();
    wd.beginSession(1000, onTimeout);

    vi.advanceTimersByTime(500);
    wd.endSession();

    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(wd.hasFired()).toBe(false);
  });

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

  it('fires at most once per active session even on later resetWithin', () => {
    const onTimeout = vi.fn();
    wd.beginSession(1000, onTimeout);

    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    wd.resetWithin(1000, onTimeout);
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    wd.endSession();
    wd.beginSession(1000, onTimeout);
    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledTimes(2);
  });

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

describe('useEventWatchdog (type contract)', () => {
  it('exports the expected params shape and callable hook', () => {
    expect(typeof useEventWatchdog).toBe('function');

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
