import { useState, useEffect, useRef } from 'react';
import { BACKTEST_RESULT_TICK_INTERVAL_MS } from '@shared/constants/timing';

/**
 * TICKET_1253: Pure state machine for elapsed-time tracking.
 * Extracted so the logic is testable without a React/DOM environment.
 */
export class ElapsedTimerCore {
  private startMs: number | null = null;
  private frozenMs = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * Start or restart the timer.
   * @param anchorMs - epoch timestamp to anchor from (default: now)
   * @param onTick - called every BACKTEST_RESULT_TICK_INTERVAL_MS to drive re-renders
   */
  start(anchorMs: number | undefined, onTick: () => void): void {
    this.stop();
    this.startMs = anchorMs ?? Date.now();
    this.frozenMs = 0;
    this.intervalId = setInterval(onTick, BACKTEST_RESULT_TICK_INTERVAL_MS);
  }

  /** Freeze the current elapsed value and stop the interval. */
  stop(): void {
    if (this.startMs !== null) {
      this.frozenMs = Date.now() - this.startMs;
    }
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Current elapsed ms (render-period computation, not callback-driven). */
  // TICKET_403 constraint: elapsed value is computed during the render pass
  // (Date.now() - startMs), NOT in the setInterval callback. The interval
  // only forces a re-render. This prevents setInterval starvation from heavy
  // chart re-renders from freezing the display.
  read(isRunning: boolean): number {
    if (isRunning && this.startMs !== null) {
      return Date.now() - this.startMs;
    }
    return this.frozenMs;
  }

  get running(): boolean { return this.intervalId !== null; }
  get frozen(): number { return this.frozenMs; }
}

/**
 * TICKET_1253: Client-side elapsed timer that ticks independently of external
 * events (IPC, SSE, etc.).
 *
 * Returns milliseconds elapsed since `isRunning` became true.
 * Freezes at the last value when `isRunning` becomes false.
 * Resets to 0 on the next rising edge of `isRunning`.
 *
 * @param anchorStartMs - Optional epoch timestamp to anchor the start time.
 *   When provided (e.g. from a main-process startedAt on page-leave/return
 *   recovery), the rising edge uses this value instead of Date.now(), so the
 *   elapsed display resumes at the real wall-clock offset rather than zero.
 */
export function useElapsedTimer(isRunning: boolean, anchorStartMs?: number): number {
  const coreRef = useRef<ElapsedTimerCore | null>(null);
  if (coreRef.current === null) coreRef.current = new ElapsedTimerCore();
  const core = coreRef.current;
  const [, tick] = useState(0);

  useEffect(() => {
    if (isRunning) {
      core.start(anchorStartMs, () => tick((n) => n + 1));
      return () => core.stop();
    }
  }, [isRunning, anchorStartMs]);

  return core.read(isRunning);
}
