/**
 * TICKET_1253: useElapsedTimer -- behavioral tests for ElapsedTimerCore.
 *
 * Tests exercise the pure state machine (start/stop/read/freeze/anchor)
 * using vi.useFakeTimers. React wiring is a thin wrapper; the core logic
 * is fully covered here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElapsedTimerCore } from '../useElapsedTimer';
import { BACKTEST_RESULT_TICK_INTERVAL_MS } from '@shared/constants/timing';

describe('ElapsedTimerCore', () => {
  let core: ElapsedTimerCore;
  const tickFn = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T10:00:00Z'));
    core = new ElapsedTimerCore();
    tickFn.mockClear();
  });

  afterEach(() => {
    core.stop();
    vi.useRealTimers();
  });

  it('reads 0 before start', () => {
    expect(core.read(false)).toBe(0);
    expect(core.read(true)).toBe(0);
  });

  it('tracks elapsed time after start', () => {
    core.start(undefined, tickFn);

    vi.advanceTimersByTime(3000);
    expect(core.read(true)).toBe(3000);
  });

  it('fires tick callback at BACKTEST_RESULT_TICK_INTERVAL_MS', () => {
    core.start(undefined, tickFn);

    vi.advanceTimersByTime(BACKTEST_RESULT_TICK_INTERVAL_MS);
    expect(tickFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(BACKTEST_RESULT_TICK_INTERVAL_MS);
    expect(tickFn).toHaveBeenCalledTimes(2);
  });

  it('freezes elapsed value on stop', () => {
    core.start(undefined, tickFn);
    vi.advanceTimersByTime(5000);
    core.stop();

    expect(core.read(false)).toBe(5000);
    expect(core.frozen).toBe(5000);
  });

  it('stop clears the interval (no more ticks)', () => {
    core.start(undefined, tickFn);
    vi.advanceTimersByTime(BACKTEST_RESULT_TICK_INTERVAL_MS);
    expect(tickFn).toHaveBeenCalledTimes(1);

    core.stop();
    tickFn.mockClear();

    vi.advanceTimersByTime(BACKTEST_RESULT_TICK_INTERVAL_MS * 10);
    expect(tickFn).not.toHaveBeenCalled();
  });

  it('frozen value persists across reads after stop', () => {
    core.start(undefined, tickFn);
    vi.advanceTimersByTime(2000);
    core.stop();

    vi.advanceTimersByTime(10000);
    expect(core.read(false)).toBe(2000);
  });

  it('resets on subsequent start (rising edge)', () => {
    core.start(undefined, tickFn);
    vi.advanceTimersByTime(5000);
    core.stop();
    expect(core.read(false)).toBe(5000);

    core.start(undefined, tickFn);
    vi.advanceTimersByTime(1000);
    expect(core.read(true)).toBe(1000);
  });

  it('rapid toggle: start -> immediate stop freezes near 0', () => {
    core.start(undefined, tickFn);
    core.stop();
    expect(core.frozen).toBe(0);
  });

  it('rapid toggle: start -> stop -> start resets cleanly', () => {
    core.start(undefined, tickFn);
    vi.advanceTimersByTime(3000);
    core.stop();
    core.start(undefined, tickFn);
    core.stop();
    expect(core.frozen).toBe(0);
  });

  it('double stop is safe', () => {
    core.start(undefined, tickFn);
    vi.advanceTimersByTime(2000);
    core.stop();
    const first = core.frozen;
    core.stop();
    expect(core.frozen).toBe(first);
  });

  it('anchorStartMs anchors to a past epoch', () => {
    const twoHoursAgo = Date.now() - 2 * 3600_000;
    core.start(twoHoursAgo, tickFn);
    expect(core.read(true)).toBe(2 * 3600_000);

    vi.advanceTimersByTime(5000);
    expect(core.read(true)).toBe(2 * 3600_000 + 5000);
  });

  it('anchorStartMs: freeze preserves real wall-clock elapsed', () => {
    const oneHourAgo = Date.now() - 3600_000;
    core.start(oneHourAgo, tickFn);
    vi.advanceTimersByTime(10_000);
    core.stop();

    expect(core.frozen).toBe(3600_000 + 10_000);
    expect(core.read(false)).toBe(3600_000 + 10_000);
  });

  it('anchorStartMs=undefined defaults to Date.now()', () => {
    core.start(undefined, tickFn);
    expect(core.read(true)).toBe(0);
    vi.advanceTimersByTime(1500);
    expect(core.read(true)).toBe(1500);
  });

  it('running property tracks interval state', () => {
    expect(core.running).toBe(false);
    core.start(undefined, tickFn);
    expect(core.running).toBe(true);
    core.stop();
    expect(core.running).toBe(false);
  });

  it('unmount while running: stop freezes correctly', () => {
    core.start(undefined, tickFn);
    vi.advanceTimersByTime(7500);
    core.stop();
    expect(core.frozen).toBe(7500);
    expect(core.running).toBe(false);
  });
});

describe('useElapsedTimer module export', () => {
  it('exports useElapsedTimer as a function', async () => {
    const mod = await import('../useElapsedTimer');
    expect(typeof mod.useElapsedTimer).toBe('function');
  });

  it('exports ElapsedTimerCore as a class', async () => {
    const mod = await import('../useElapsedTimer');
    expect(typeof mod.ElapsedTimerCore).toBe('function');
  });
});
