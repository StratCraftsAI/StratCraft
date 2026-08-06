/**
 * TICKET_1335_1 Phase 3 -- every presentation DECISION the page makes.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE COMPONENTS:
 * AC14 requires 100 percent coverage of changed branches, and AC7 requires
 * proof that presentation is selected from `category`/`stage`/`cause`/
 * `capability` and never from parsed human text. Both are claims about
 * DECISIONS, not about markup. This repository's vitest config is
 * `environment: 'node'` with `include: ['src/**\/*.test.ts']` and carries no
 * jsdom or React Testing Library dependency, so a `.test.tsx` rendering assertion
 * would not run at all here.
 *
 * Rather than add a DOM test stack for the whole repository from inside this
 * child ticket -- a change that would touch every suite's configuration and is
 * owned by nothing in TICKET_1335_1 -- the branching logic is lifted OUT of the
 * components into these pure functions. The components then contain layout and
 * no decisions worth a branch, and the decisions are covered exhaustively here.
 *
 * That is not a coverage dodge: it is the honest split. A test asserting that a
 * badge has a particular Tailwind class proves nothing about correctness, while
 * these functions are exactly where "which card is blamed" and "does `failed`
 * offer repair or install" are actually decided.
 */

import type {
  ResearchCapability,
  ResearchCapabilityStatus,
  ResearchEnvironmentFailure,
  ResearchEnvironmentFailureCategory,
} from '@StratCraft/types';

// -----------------------------------------------------------------------------
// Capability blame
// -----------------------------------------------------------------------------

/**
 * True when this structured failure blames THIS capability.
 *
 * Only the `verification_failed` variant carries a `capability` field -- the
 * shared schema spells its union out per variant precisely so an admission-stage
 * failure such as `pixi_missing` cannot claim to be a package problem. Every
 * other category is environment-level and belongs to the failure panel, not to
 * a card.
 */
export function blamesCapability(
  failure: ResearchEnvironmentFailure | null,
  capability: ResearchCapability,
): boolean {
  return failure?.category === 'verification_failed'
    && failure.capability === capability;
}

/**
 * The blamed failure narrowed to its capability-bearing variant, or null.
 *
 * Returning the narrowed variant rather than a boolean lets the card read
 * `cause` without re-testing the discriminant or asserting a type.
 */
export function capabilityFailure(
  failure: ResearchEnvironmentFailure | null,
  capability: ResearchCapability,
): Extract<ResearchEnvironmentFailure, { category: 'verification_failed' }> | null {
  if (failure?.category === 'verification_failed' && failure.capability === capability) {
    return failure;
  }
  return null;
}

// -----------------------------------------------------------------------------
// PySR split readiness (AC8)
// -----------------------------------------------------------------------------

/** The capability with two runtime layers, and so the only split card. */
export const PYSR_CAPABILITY: ResearchCapability = 'pysr';

export const PYSR_LAYERS = ['python', 'julia'] as const;

export type PysrLayer = (typeof PYSR_LAYERS)[number];

export type PysrLayerState = 'ready' | 'failed' | 'pending';

/**
 * Readiness of one PySR layer, derived from the structured failure only.
 *
 * PySR is the only capability with two runtime layers: the Python wheel
 * installing proves nothing about the backend, because the Julia dependencies
 * install on first import -- TICKET_1335's D0 execution record shows that import
 * driving a 1.4 GB Julia depot download. A single combined "PySR: ready" could
 * therefore claim ready while the backend was broken, which AC8 forbids.
 *
 * The ordering rule is what makes the split honest. `julia_verify` runs after
 * `python_verify`, so:
 * - a failure at `julia_verify` proves Python got far enough to import, hence
 *   `python: ready`;
 * - a failure at `python_verify` leaves the Julia layer UNREACHED, hence
 *   `julia: pending` and never `ready`. Reporting an unreached layer as ready
 *   would be the AC8 defect wearing a different mask.
 */
export function pysrLayerState(
  status: ResearchCapabilityStatus,
  failure: ResearchEnvironmentFailure | null,
  layer: PysrLayer,
): PysrLayerState {
  const blamed = capabilityFailure(failure, PYSR_CAPABILITY);
  if (blamed) {
    if (blamed.stage === 'python_verify') {
      return layer === 'python' ? 'failed' : 'pending';
    }
    return layer === 'python' ? 'ready' : 'failed';
  }
  return status.state === 'ready' ? 'ready' : 'pending';
}

// -----------------------------------------------------------------------------
// Failure tone (AC7)
// -----------------------------------------------------------------------------

/**
 * How urgently a category reads, chosen from the category alone.
 *
 * `blocked` means the environment cannot proceed on this machine as configured
 * -- retrying the same action would fail identically, so the panel must not
 * invite a retry. `recoverable` means the action can sensibly be attempted
 * again.
 *
 * Typed as a total `Record` over the shared category tuple on purpose: a
 * category added upstream fails to COMPILE here rather than silently falling
 * through to a generic "something went wrong", which is the shape AC7's
 * "distinct actionable state per category" requirement exists to prevent.
 */
export type FailureTone = 'blocked' | 'recoverable';

export const FAILURE_TONE: Record<ResearchEnvironmentFailureCategory, FailureTone> = {
  unsupported_platform: 'blocked',
  pixi_missing: 'blocked',
  lock_missing: 'blocked',
  lock_drift: 'blocked',
  lifecycle_coordination_failed: 'blocked',
  network_failed: 'recoverable',
  install_failed: 'recoverable',
  repair_failed: 'recoverable',
  uninstall_failed: 'recoverable',
  workload_active: 'blocked',
  operation_interrupted: 'recoverable',
  verification_failed: 'recoverable',
};

export function failureTone(
  category: ResearchEnvironmentFailureCategory,
): FailureTone {
  return FAILURE_TONE[category];
}

// -----------------------------------------------------------------------------
// Request-error presentation
// -----------------------------------------------------------------------------

/**
 * The handler code Main returns when the human dismissed the native dialog.
 *
 * `research-environment-handlers.ts` returns this when
 * `requestResearchEnvironmentApproval` yields null -- the human pressed Cancel,
 * dismissed the dialog, or there was no window to host it.
 */
export const APPROVAL_DECLINED_CODE = 'approval_declined';

/**
 * True when the last request failed because nobody approved it.
 *
 * Kept distinct from every other request error because a declined approval is
 * not a fault: nothing was attempted and nothing changed. Telling a user their
 * environment is broken because they pressed Cancel would be a lie, and
 * announcing it through `role="alert"` would interrupt a screen reader to
 * report that nothing happened. This is the renderer's half of the store's
 * "a failed REQUEST is not a failed ENVIRONMENT" separation.
 */
export function isApprovalDeclined(
  requestError: { code: string } | null,
): boolean {
  return requestError?.code === APPROVAL_DECLINED_CODE;
}

// -----------------------------------------------------------------------------
// Elapsed time
// -----------------------------------------------------------------------------

/** `mm:ss` from a millisecond span; hours roll into the minutes field. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Elapsed span for a job, or null when it cannot be computed honestly.
 *
 * A terminal job's span is fixed by its own timestamps so the display stops
 * moving, rather than counting up forever behind a finished install. Null is
 * returned rather than `00:00` when there is no usable start timestamp: zero is
 * a measurement, and showing one we did not take would be a small fabrication of
 * exactly the kind D5 forbids for progress percentages.
 */
export function jobElapsedMs(
  job: {
    state: string;
    startedAt?: string;
    finishedAt?: string;
  },
  now: number,
): number | null {
  if (!job.startedAt) return null;
  const started = Date.parse(job.startedAt);
  if (Number.isNaN(started)) return null;

  const terminal = job.state === 'succeeded' || job.state === 'failed';
  const end = terminal && job.finishedAt ? Date.parse(job.finishedAt) : now;
  if (Number.isNaN(end)) return null;
  return end - started;
}

// -----------------------------------------------------------------------------
// Live-region announcement (AC11)
// -----------------------------------------------------------------------------

/**
 * What the page's `aria-live` region should currently say, as a translation key
 * plus its interpolation values -- or null when there is nothing to announce.
 *
 * WHY A KEY AND NOT A SENTENCE:
 * Returning `{ key, values }` keeps this a DECISION (which announcement, from
 * which structured fields) and leaves the wording to the locale bundles, so this
 * function stays coverable in this repository's node-only test environment and
 * the announcement is localized like every other string (AC12).
 *
 * THE DIVISION OF LABOUR BETWEEN THE TWO LIVE REGIONS:
 * `EnvironmentJobProgress` already announces every STAGE advance, politely, for
 * as long as the panel is mounted. This region must therefore NOT also announce
 * that an operation started -- two polite regions firing on the same change
 * queue two utterances for one event, and the user hears the same fact twice.
 * What the stage region cannot announce is the moment it UNMOUNTS: when a job
 * reaches `succeeded` or `failed`, `selectIsBusy` goes false, the panel is
 * removed, and the single most important moment in this page's life would pass
 * in silence. That gap is exactly what this region covers.
 *
 * The `failed` ENVIRONMENT state is announced separately from a failed JOB
 * because a failure can be present with no job at all -- an `absent` install
 * blocked by `pixi_missing` is discovered by `getStatus()` on mount, and a
 * screen-reader user must not have to go hunting for the alert panel to learn
 * the page is not merely empty.
 *
 * `absent` and `ready` announce nothing: a live region describes TRANSITIONS,
 * and narrating a resting state on mount would speak over the heading the
 * screen reader is already reading.
 */
export interface EnvironmentAnnouncement {
  key: string;
  /**
   * Interpolation values that are themselves translation KEYS, resolved by the
   * caller. Kept as keys here so this function performs no translation and can
   * be asserted without an i18n runtime.
   */
  values?: { operation: string };
}

export function environmentAnnouncement(
  status: { state: string } | null,
  job: { operation: string; state: string } | null,
): EnvironmentAnnouncement | null {
  if (job && (job.state === 'succeeded' || job.state === 'failed')) {
    return {
      key: `researchEnvironment.announce.${job.state}`,
      values: { operation: `researchEnvironment.progress.${job.operation}` },
    };
  }

  if (status?.state === 'failed') {
    return { key: 'researchEnvironment.announce.failedState' };
  }

  return null;
}
