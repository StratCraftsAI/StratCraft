/**
 * TICKET_1335 L3: the long-held claim's liveness signal.
 *
 * The repository's reconciler can only distinguish a crashed owner from a slow
 * one by heartbeat freshness, so the claim is only as trustworthy as this timer.
 * It is separate from the child process's own output on purpose: a Pixi solve
 * can go minutes without printing a line, and treating output as liveness would
 * let a healthy install be reclaimed mid-write -- producing the two-writers state
 * TICKET_1335 D4 exists to prevent.
 */

import { RESEARCH_ENV_HEARTBEAT_INTERVAL_MS } from './constants';
import type { ResearchEnvironmentJobRepository } from './job-repository';

/** Injected so tests need no real timers and no wall-clock waiting. */
export interface HeartbeatSchedulerDeps {
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  intervalMs?: number;
  /**
   * Called when a tick finds the job no longer claimable by this instance --
   * reclaimed by reconciliation, or already terminal.
   *
   * The owner must react by abandoning the operation rather than continuing:
   * once another instance may hold the profile, this process writing to `.pixi`
   * is precisely the concurrent-materialization hazard. Surfacing it through a
   * callback rather than swallowing it satisfies TICKET_858.
   */
  onClaimLost: (jobId: string) => void;
}

export class ResearchEnvironmentHeartbeat {
  private handle: unknown;
  private activeJobId?: string;

  constructor(
    private readonly repository: ResearchEnvironmentJobRepository,
    private readonly deps: HeartbeatSchedulerDeps,
  ) {}

  /**
   * Begin heartbeating for a job. Starting a second job stops the first: one
   * process holds at most one claim per profile by construction, so two live
   * heartbeats would mean this process believed it owned two active jobs.
   */
  start(jobId: string): void {
    this.stop();
    this.activeJobId = jobId;
    this.handle = this.deps.setInterval(
      () => this.tick(),
      this.deps.intervalMs ?? RESEARCH_ENV_HEARTBEAT_INTERVAL_MS,
    );
  }

  /** Idempotent, so shutdown paths and terminal paths can both call it. */
  stop(): void {
    if (this.handle !== undefined) {
      this.deps.clearInterval(this.handle);
      this.handle = undefined;
    }
    this.activeJobId = undefined;
  }

  get jobId(): string | undefined {
    return this.activeJobId;
  }

  private tick(): void {
    const jobId = this.activeJobId;
    if (!jobId) return;
    if (!this.repository.heartbeat(jobId)) {
      // Stop before notifying: the callback may spawn recovery work, and it must
      // not observe a scheduler that is still claiming a job it just lost.
      this.stop();
      this.deps.onClaimLost(jobId);
    }
  }
}
