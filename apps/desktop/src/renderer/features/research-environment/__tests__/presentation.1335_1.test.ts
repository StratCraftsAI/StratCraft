/**
 * TICKET_1335_1 Phase 3 -- presentation decisions.
 *
 * What is asserted here is the behaviour AC3/AC4/AC7/AC8/AC15 name, not markup:
 *
 * - a card is blamed ONLY by the structured `capability` field, never by text;
 * - PySR's two layers are separable, and an unreached layer never reads ready;
 * - every one of the ten shared failure categories has a distinct, total
 *   presentation mapping, driven off the shared tuple so a new category cannot
 *   be forgotten;
 * - a declined approval is not an environment failure;
 * - elapsed time is null rather than a fabricated zero when unmeasurable.
 *
 * The exhaustive loops iterate the shared runtime tuples rather than hand-listed
 * literals. That is the point: if TICKET_1335 adds a capability or a failure
 * category, these tests widen automatically instead of passing while silently
 * covering less.
 */

import { describe, expect, it } from 'vitest';
import {
  RESEARCH_CAPABILITIES,
  RESEARCH_ENVIRONMENT_FAILURE_CATEGORIES,
  RESEARCH_ENVIRONMENT_JOB_STATES,
  RESEARCH_ENVIRONMENT_OPERATIONS,
  RESEARCH_ENVIRONMENT_STATES,
  type ResearchCapability,
  type ResearchCapabilityStatus,
  type ResearchEnvironmentFailure,
} from '@StratCraft/types';

import {
  APPROVAL_DECLINED_CODE,
  FAILURE_TONE,
  PYSR_CAPABILITY,
  PYSR_LAYERS,
  blamesCapability,
  capabilityFailure,
  environmentAnnouncement,
  failureTone,
  formatElapsed,
  isApprovalDeclined,
  jobElapsedMs,
  pysrLayerState,
} from '../presentation';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function capabilityStatus(
  state: ResearchCapabilityStatus['state'],
  installed?: string,
): ResearchCapabilityStatus {
  return { expected: '1.0.0', state, ...(installed ? { installed } : {}) };
}

/**
 * One legal failure per shared category.
 *
 * Every entry is a legal combination of the discriminated union, so these
 * fixtures could survive `parseResearchEnvironmentFailure` -- a fixture that
 * could not cross the boundary would prove nothing about what the UI receives.
 */
const FAILURE_BY_CATEGORY: {
  [K in ResearchEnvironmentFailure['category']]: Extract<
    ResearchEnvironmentFailure,
    { category: K }
  >
} = {
  unsupported_platform: {
    category: 'unsupported_platform',
    stage: 'admission',
    cause: 'unsupported',
    message: 'This platform is not supported.',
    remediation: 'Use a supported platform.',
  },
  pixi_missing: {
    category: 'pixi_missing',
    stage: 'admission',
    cause: 'missing_executable',
    message: 'Pixi was not found.',
    remediation: 'Install Pixi.',
  },
  lock_missing: {
    category: 'lock_missing',
    stage: 'admission',
    cause: 'missing_lock',
    message: 'pixi.lock is missing.',
    remediation: 'Restore the lock file.',
  },
  lock_drift: {
    category: 'lock_drift',
    stage: 'admission',
    cause: 'manifest_drift',
    message: 'The manifest and lock disagree.',
    remediation: 'Regenerate the lock.',
  },
  lifecycle_coordination_failed: {
    category: 'lifecycle_coordination_failed',
    stage: 'admission',
    cause: 'database',
    message: 'The environment record could not be updated.',
    remediation: 'Retry the operation.',
  },
  network_failed: {
    category: 'network_failed',
    stage: 'install',
    cause: 'network',
    message: 'A download failed.',
    remediation: 'Check the connection and retry.',
  },
  install_failed: {
    category: 'install_failed',
    stage: 'install',
    cause: 'process_exit',
    message: 'Pixi exited with status 1.',
    remediation: 'Retry the installation.',
  },
  repair_failed: {
    category: 'repair_failed',
    stage: 'repair',
    cause: 'process_exit',
    message: 'Repair exited with status 1.',
    remediation: 'Retry the repair.',
  },
  uninstall_failed: {
    category: 'uninstall_failed',
    stage: 'uninstall',
    cause: 'process_exit',
    message: 'Uninstall exited with status 1.',
    remediation: 'Retry the uninstall.',
  },
  workload_active: {
    category: 'workload_active',
    stage: 'admission',
    cause: 'active',
    message: 'A research workload is active.',
    remediation: 'Wait for it to finish.',
  },
  operation_interrupted: {
    category: 'operation_interrupted',
    stage: 'install',
    cause: 'process_lost',
    message: 'The process ended unexpectedly.',
    remediation: 'Retry the operation.',
  },
  verification_failed: {
    category: 'verification_failed',
    stage: 'python_verify',
    cause: 'import',
    capability: 'duckdb',
    message: 'duckdb could not be imported.',
    remediation: 'Repair the environment.',
  },
};

function verificationFailure(
  capability: ResearchCapability,
  stage: 'python_verify' | 'julia_verify',
  cause: 'import' | 'probe' | 'backend_init',
): ResearchEnvironmentFailure {
  return {
    category: 'verification_failed',
    stage,
    cause,
    capability,
    message: `${capability} failed.`,
    remediation: 'Repair the environment.',
  };
}

// -----------------------------------------------------------------------------
// Capability blame (AC3, AC7, AC15)
// -----------------------------------------------------------------------------

describe('capability blame', () => {
  it('blames only the capability the structured failure names', () => {
    const failure = verificationFailure('gplearn', 'python_verify', 'import');
    for (const capability of RESEARCH_CAPABILITIES) {
      expect(blamesCapability(failure, capability)).toBe(capability === 'gplearn');
    }
  });

  it('blames no capability when there is no failure', () => {
    for (const capability of RESEARCH_CAPABILITIES) {
      expect(blamesCapability(null, capability)).toBe(false);
      expect(capabilityFailure(null, capability)).toBeNull();
    }
  });

  /**
   * The load-bearing half of AC7: an environment-level failure must not be
   * redrawn as a package problem. `pixi_missing` means the tool is absent, which
   * says nothing about DuckDB -- attributing it to a card would send the user to
   * repair a package that is fine.
   */
  it('never blames a capability for an environment-level failure', () => {
    for (const category of RESEARCH_ENVIRONMENT_FAILURE_CATEGORIES) {
      if (category === 'verification_failed') continue;
      const failure = FAILURE_BY_CATEGORY[category];
      for (const capability of RESEARCH_CAPABILITIES) {
        expect(blamesCapability(failure, capability)).toBe(false);
        expect(capabilityFailure(failure, capability)).toBeNull();
      }
    }
  });

  it('returns the narrowed variant so the cause can be read without a cast', () => {
    const failure = verificationFailure('pandas_ta', 'python_verify', 'probe');
    const blamed = capabilityFailure(failure, 'pandas_ta');
    expect(blamed?.cause).toBe('probe');
    expect(blamed?.capability).toBe('pandas_ta');
  });
});

// -----------------------------------------------------------------------------
// PySR split readiness (AC8)
// -----------------------------------------------------------------------------

describe('PySR split readiness', () => {
  it('reports both layers ready only when the capability is ready', () => {
    const ready = capabilityStatus('ready', '1.0.0');
    for (const layer of PYSR_LAYERS) {
      expect(pysrLayerState(ready, null, layer)).toBe('ready');
    }
  });

  it('reports neither layer ready before verification has run', () => {
    for (const state of ['absent', 'installing', 'repairing', 'verifying'] as const) {
      for (const layer of PYSR_LAYERS) {
        expect(pysrLayerState(capabilityStatus(state), null, layer)).toBe('pending');
      }
    }
  });

  /**
   * The exact defect AC8 names. A Python-stage failure means the Julia backend
   * was never reached, so it must read `pending` -- reporting it `ready` would
   * claim a backend passed a check that never ran.
   */
  it('leaves Julia unreached, never ready, when the Python stage failed', () => {
    const failure = verificationFailure(PYSR_CAPABILITY, 'python_verify', 'import');
    const status = capabilityStatus('failed');
    expect(pysrLayerState(status, failure, 'python')).toBe('failed');
    expect(pysrLayerState(status, failure, 'julia')).toBe('pending');
    expect(pysrLayerState(status, failure, 'julia')).not.toBe('ready');
  });

  /**
   * The inverse: a Julia-stage failure proves Python imported successfully,
   * because `julia_verify` only runs after `python_verify` passed.
   */
  it('credits Python as ready when only the Julia backend failed', () => {
    const failure = verificationFailure(PYSR_CAPABILITY, 'julia_verify', 'backend_init');
    const status = capabilityStatus('failed');
    expect(pysrLayerState(status, failure, 'python')).toBe('ready');
    expect(pysrLayerState(status, failure, 'julia')).toBe('failed');
  });

  /**
   * A ready-looking capability status cannot override a live backend failure.
   * This is the mutation that would reintroduce "PySR: ready" over a broken
   * Julia depot.
   */
  it('cannot show a ready backend while a backend failure is reported', () => {
    const failure = verificationFailure(PYSR_CAPABILITY, 'julia_verify', 'backend_init');
    expect(pysrLayerState(capabilityStatus('ready', '1.0.0'), failure, 'julia'))
      .toBe('failed');
  });

  it('ignores a failure that blames a different capability', () => {
    const failure = verificationFailure('duckdb', 'python_verify', 'import');
    const ready = capabilityStatus('ready', '1.0.0');
    for (const layer of PYSR_LAYERS) {
      expect(pysrLayerState(ready, failure, layer)).toBe('ready');
    }
  });
});

// -----------------------------------------------------------------------------
// Failure tone (AC7)
// -----------------------------------------------------------------------------

describe('failure tone', () => {
  /**
   * Totality is the assertion. A category missing from the map would render
   * `undefined` and fall back to a generic panel, which is precisely the
   * "no distinct actionable state" defect AC7 forbids.
   */
  it('maps every shared failure category to a tone', () => {
    for (const category of RESEARCH_ENVIRONMENT_FAILURE_CATEGORIES) {
      expect(FAILURE_TONE[category]).toBeDefined();
      expect(['blocked', 'recoverable']).toContain(failureTone(category));
    }
    expect(Object.keys(FAILURE_TONE).sort())
      .toEqual([...RESEARCH_ENVIRONMENT_FAILURE_CATEGORIES].sort());
  });

  /**
   * These five cannot be fixed by pressing the button again -- the platform is
   * wrong, the tool is absent, or the lock is missing/drifted. Marking them
   * recoverable would invite a retry loop that fails identically every time.
   */
  it('marks configuration-level categories blocked rather than retryable', () => {
    for (const category of [
      'unsupported_platform',
      'pixi_missing',
      'lock_missing',
      'lock_drift',
      'lifecycle_coordination_failed',
    ] as const) {
      expect(failureTone(category)).toBe('blocked');
    }
  });

  it('marks transient and package categories recoverable', () => {
    for (const category of [
      'network_failed',
      'install_failed',
      'repair_failed',
      'operation_interrupted',
      'verification_failed',
    ] as const) {
      expect(failureTone(category)).toBe('recoverable');
    }
  });

  /**
   * AC7's no-parsing rule, asserted directly: identical structured fields must
   * produce an identical decision no matter what the human text says.
   */
  it('decides tone from the category alone, not from the message text', () => {
    const base = FAILURE_BY_CATEGORY.install_failed;
    const reworded: ResearchEnvironmentFailure = {
      ...base,
      message: 'unsupported platform network lock drift pixi missing',
      remediation: 'unsupported',
    };
    expect(failureTone(reworded.category)).toBe(failureTone(base.category));
  });
});

// -----------------------------------------------------------------------------
// Approval decline (AC5)
// -----------------------------------------------------------------------------

describe('approval decline', () => {
  it('recognizes the code Main returns when the human declined', () => {
    expect(isApprovalDeclined({ code: APPROVAL_DECLINED_CODE })).toBe(true);
  });

  /**
   * A declined dialog and a broken environment must not look alike: nothing was
   * attempted and nothing changed, so this is a notice, not an alert.
   */
  it('treats every other request error as a real error', () => {
    expect(isApprovalDeclined(null)).toBe(false);
    expect(isApprovalDeclined({ code: 'renderer/bridge-unavailable' })).toBe(false);
    expect(isApprovalDeclined({ code: 'renderer/request-failed' })).toBe(false);
    expect(isApprovalDeclined({ code: 'renderer/invalid-payload' })).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Elapsed time (D5)
// -----------------------------------------------------------------------------

describe('elapsed time', () => {
  it('formats a span as mm:ss with hours rolling into minutes', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(9_000)).toBe('00:09');
    expect(formatElapsed(65_000)).toBe('01:05');
    expect(formatElapsed(3_671_000)).toBe('61:11');
  });

  it('clamps a negative span rather than rendering negative time', () => {
    expect(formatElapsed(-5_000)).toBe('00:00');
  });

  it('counts up from the start while a job is running', () => {
    const started = Date.parse('2026-07-30T12:00:00.000Z');
    expect(jobElapsedMs({ state: 'running', startedAt: '2026-07-30T12:00:00.000Z' }, started + 30_000))
      .toBe(30_000);
  });

  /**
   * A terminal job's span is fixed by its own timestamps. Without this, a
   * finished install would keep counting up forever behind a completed job.
   */
  it('freezes a terminal job at its own finish timestamp', () => {
    const job = {
      state: 'succeeded',
      startedAt: '2026-07-30T12:00:00.000Z',
      finishedAt: '2026-07-30T12:02:00.000Z',
    };
    const farLater = Date.parse('2026-07-30T18:00:00.000Z');
    expect(jobElapsedMs(job, farLater)).toBe(120_000);
  });

  it('freezes a failed job the same way as a succeeded one', () => {
    const job = {
      state: 'failed',
      startedAt: '2026-07-30T12:00:00.000Z',
      finishedAt: '2026-07-30T12:00:30.000Z',
    };
    expect(jobElapsedMs(job, Date.parse('2026-07-30T14:00:00.000Z'))).toBe(30_000);
  });

  /**
   * Null rather than zero: zero is a measurement, and showing one that was never
   * taken is the same small fabrication D5 forbids for progress percentages.
   */
  it('returns null when there is no usable start timestamp', () => {
    expect(jobElapsedMs({ state: 'running' }, Date.now())).toBeNull();
    expect(jobElapsedMs({ state: 'running', startedAt: 'not-a-date' }, Date.now()))
      .toBeNull();
  });

  it('returns null when a terminal finish timestamp is unparseable', () => {
    expect(jobElapsedMs(
      { state: 'succeeded', startedAt: '2026-07-30T12:00:00.000Z', finishedAt: 'nope' },
      Number.NaN,
    )).toBeNull();
  });

  /**
   * A terminal job with no finish timestamp cannot occur across the boundary --
   * the shared schema rejects it -- but the fallback keeps the display honest
   * rather than crashing if one ever did.
   */
  it('falls back to now for a terminal job missing its finish timestamp', () => {
    const started = Date.parse('2026-07-30T12:00:00.000Z');
    expect(jobElapsedMs(
      { state: 'succeeded', startedAt: '2026-07-30T12:00:00.000Z' },
      started + 45_000,
    )).toBe(45_000);
  });
});

// -----------------------------------------------------------------------------
// Live-region announcement (AC11)
// -----------------------------------------------------------------------------

describe('environmentAnnouncement', () => {
  /**
   * The whole point of the region. A screen-reader user gets no state badge
   * flipping colour and no progress panel vanishing, so a multi-minute install
   * ENDING has to be spoken -- and it must be spoken here, because the panel
   * that announces stages has already unmounted by then.
   */
  it.each(RESEARCH_ENVIRONMENT_OPERATIONS)(
    'announces a succeeded %s job, naming the operation',
    (operation) => {
      const announcement = environmentAnnouncement(
        { state: 'ready' },
        { operation, state: 'succeeded' },
      );
      expect(announcement).toEqual({
        key: 'researchEnvironment.announce.succeeded',
        values: { operation: `researchEnvironment.progress.${operation}` },
      });
    },
  );

  it.each(RESEARCH_ENVIRONMENT_OPERATIONS)(
    'announces a failed %s job, naming the operation',
    (operation) => {
      const announcement = environmentAnnouncement(
        { state: 'failed' },
        { operation, state: 'failed' },
      );
      expect(announcement).toEqual({
        key: 'researchEnvironment.announce.failed',
        values: { operation: `researchEnvironment.progress.${operation}` },
      });
    },
  );

  /**
   * AC6a in the audio channel: a repair that finishes must not be announced as
   * an installation. The operation name comes from the JOB, which is what the
   * service reports, so a reload mid-repair still speaks the truth.
   */
  it('does not relabel a finished repair as an install', () => {
    const announcement = environmentAnnouncement(
      { state: 'ready' },
      { operation: 'repair', state: 'succeeded' },
    );
    expect(announcement?.values?.operation)
      .toBe('researchEnvironment.progress.repair');
  });

  /**
   * The stage region inside `EnvironmentJobProgress` is already announcing
   * every stage advance while a job runs. If this region ALSO spoke during
   * those states, two polite regions would queue two utterances for one event
   * and the user would hear the same fact twice.
   */
  it.each(['queued', 'running'] as const)(
    'stays silent during a %s job, leaving the stage region to speak',
    (state) => {
      expect(environmentAnnouncement(
        { state: 'installing' },
        { operation: 'install', state },
      )).toBeNull();
    },
  );

  it.each(['absent', 'installing', 'repairing', 'verifying', 'ready'] as const)(
    'announces nothing for the %s state when no job is terminal',
    (state) => {
      expect(environmentAnnouncement({ state }, null)).toBeNull();
    },
  );

  /**
   * A failure can exist with NO job at all: `pixi_missing` is discovered by the
   * first `getStatus()` read. Without this branch a screen-reader user would
   * hear nothing and conclude the page was merely empty.
   */
  it('announces a failed environment discovered with no job', () => {
    expect(environmentAnnouncement({ state: 'failed' }, null)).toEqual({
      key: 'researchEnvironment.announce.failedState',
    });
  });

  /** Nothing is known yet before the first read resolves, so nothing is said. */
  it('announces nothing before status is known', () => {
    expect(environmentAnnouncement(null, null)).toBeNull();
  });

  /**
   * A terminal job outranks the environment state. A repair that just failed
   * must announce THE REPAIR, not the generic "the environment is failed" --
   * the former says what happened, the latter only what is now true.
   */
  it('prefers the terminal job over the failed environment state', () => {
    expect(environmentAnnouncement(
      { state: 'failed' },
      { operation: 'repair', state: 'failed' },
    )?.key).toBe('researchEnvironment.announce.failed');
  });

  /**
   * Exhaustive over the shared tuples rather than the handful of pairs above:
   * a state or job state added by parent TICKET_1335 must still produce either
   * a valid announcement or silence, never an undefined key.
   */
  it('produces a well-formed announcement or null for every contract pair', () => {
    for (const state of RESEARCH_ENVIRONMENT_STATES) {
      for (const jobState of RESEARCH_ENVIRONMENT_JOB_STATES) {
        for (const operation of RESEARCH_ENVIRONMENT_OPERATIONS) {
          const announcement = environmentAnnouncement(
            { state },
            { operation, state: jobState },
          );
          if (announcement === null) continue;
          expect(announcement.key).toMatch(/^researchEnvironment\.announce\.\w+$/);
          if (announcement.values) {
            expect(announcement.values.operation)
              .toBe(`researchEnvironment.progress.${operation}`);
          }
        }
      }
    }
  });
});
