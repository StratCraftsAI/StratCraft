/**
 * TICKET_1335 L3: heartbeat scheduler tests.
 *
 * Timers are injected rather than faked globally so each tick is driven
 * explicitly -- the behaviour that matters is what happens on the tick where the
 * claim is already gone, and that is a control-flow property, not a timing one.
 */

import { describe, expect, it, vi } from 'vitest';
import { ResearchEnvironmentHeartbeat } from './heartbeat';
import { RESEARCH_ENV_HEARTBEAT_INTERVAL_MS } from './constants';
import type { ResearchEnvironmentJobRepository } from './job-repository';

interface Harness {
  beat: ResearchEnvironmentHeartbeat;
  tick: () => void;
  heartbeat: ReturnType<typeof vi.fn<[string], boolean>>;
  onClaimLost: ReturnType<typeof vi.fn<[string], void>>;
  cleared: unknown[];
  intervals: number[];
}

function harness(heartbeatResults: boolean[] = [true]): Harness {
  let callback: (() => void) | undefined;
  let handleCounter = 0;
  const cleared: unknown[] = [];
  const intervals: number[] = [];

  let index = 0;
  const heartbeat = vi.fn<[string], boolean>(() => {
    const result = heartbeatResults[Math.min(index, heartbeatResults.length - 1)];
    index += 1;
    return result;
  });
  const onClaimLost = vi.fn<[string], void>();

  const repository = { heartbeat } as unknown as ResearchEnvironmentJobRepository;

  const beat = new ResearchEnvironmentHeartbeat(repository, {
    setInterval: (fn, ms) => {
      callback = fn;
      intervals.push(ms);
      return `handle-${++handleCounter}`;
    },
    clearInterval: handle => { cleared.push(handle); },
    onClaimLost,
  });

  return {
    beat,
    tick: () => callback?.(),
    heartbeat,
    onClaimLost,
    cleared,
    intervals,
  };
}

describe('ResearchEnvironmentHeartbeat', () => {
  it('heartbeats the started job on each tick', () => {
    const h = harness([true]);
    h.beat.start('job-1');
    expect(h.beat.jobId).toBe('job-1');
    h.tick();
    h.tick();
    expect(h.heartbeat).toHaveBeenCalledTimes(2);
    expect(h.heartbeat).toHaveBeenCalledWith('job-1');
  });

  it('uses the shared constant interval by default', () => {
    const h = harness();
    h.beat.start('job-1');
    expect(h.intervals).toEqual([RESEARCH_ENV_HEARTBEAT_INTERVAL_MS]);
  });

  it('honours an injected interval', () => {
    let captured = 0;
    const beat = new ResearchEnvironmentHeartbeat(
      { heartbeat: () => true } as unknown as ResearchEnvironmentJobRepository,
      {
        setInterval: (_fn, ms) => { captured = ms; return 'h'; },
        clearInterval: () => {},
        intervalMs: 123,
        onClaimLost: () => {},
      },
    );
    beat.start('job-1');
    expect(captured).toBe(123);
  });

  // Two live heartbeats would mean this process believed it owned two active
  // jobs, which the single-active-job invariant forbids.
  it('stops the previous timer when a second job starts', () => {
    const h = harness();
    h.beat.start('job-1');
    h.beat.start('job-2');
    expect(h.cleared).toEqual(['handle-1']);
    h.tick();
    expect(h.heartbeat).toHaveBeenCalledWith('job-2');
  });

  it('is idempotent on stop and does not tick afterwards', () => {
    const h = harness();
    h.beat.start('job-1');
    h.beat.stop();
    h.beat.stop();
    expect(h.cleared).toEqual(['handle-1']);
    expect(h.beat.jobId).toBeUndefined();
    h.tick();
    expect(h.heartbeat).not.toHaveBeenCalled();
  });

  it('does nothing when stopped before ever starting', () => {
    const h = harness();
    h.beat.stop();
    expect(h.cleared).toEqual([]);
  });

  // TICKET_858: losing the claim must reach the caller, not be swallowed. The
  // owner has to abandon the operation, because another instance may now hold
  // the profile and two writers into `.pixi` is the hazard D4 exists to prevent.
  it('reports a lost claim and stops heartbeating', () => {
    const h = harness([false]);
    h.beat.start('job-1');
    h.tick();
    expect(h.onClaimLost).toHaveBeenCalledWith('job-1');
    expect(h.cleared).toEqual(['handle-1']);
    expect(h.beat.jobId).toBeUndefined();
  });

  // The callback may start recovery work, so it must not observe a scheduler
  // still claiming the job it just lost.
  it('has already stopped by the time the callback observes it', () => {
    let observed: string | undefined = 'unset';
    let queued: (() => void) | undefined;
    const repository = { heartbeat: () => false } as unknown as ResearchEnvironmentJobRepository;
    const beat: ResearchEnvironmentHeartbeat = new ResearchEnvironmentHeartbeat(repository, {
      setInterval: fn => { queued = fn; return 'h'; },
      clearInterval: () => {},
      onClaimLost: () => { observed = beat.jobId; },
    });
    beat.start('job-1');
    queued!();
    expect(observed).toBeUndefined();
  });

  it('reports the lost claim only once', () => {
    const h = harness([false, false]);
    h.beat.start('job-1');
    h.tick();
    h.tick();
    expect(h.onClaimLost).toHaveBeenCalledTimes(1);
  });
});
