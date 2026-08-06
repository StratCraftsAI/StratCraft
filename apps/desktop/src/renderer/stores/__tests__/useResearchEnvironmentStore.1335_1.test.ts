/**
 * TICKET_1335_1 Phase 2 -- research environment store.
 *
 * What is asserted here is the behaviour AC6/AC6a/AC7 name, not the shape of
 * the reducer:
 *
 * - "not yet known" never renders as `absent` (a wrong, CLICKABLE answer);
 * - hydrate is the single path serving first mount AND post-reload reconnect,
 *   so a repair cannot come back relabelled as an install;
 * - every one of the ten shared failure categories survives to the selector
 *   without the store parsing any human text;
 * - `failed` offers repair, never install;
 * - a superseded poll loop cannot overwrite a newer job's progress.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESEARCH_CAPABILITIES,
  RESEARCH_ENVIRONMENT_FAILURE_CATEGORIES,
  type ResearchCapability,
  type ResearchCapabilityStatus,
  type ResearchEnvironmentFailure,
  type ResearchEnvironmentJob,
  type ResearchEnvironmentStatus,
} from '@StratCraft/types';
// Namespace import so the boundary parsers can be spied on: the non-Error
// branch of each catch is only reachable by making the parser throw a
// non-Error, which no malformed payload can do on its own.
import * as schema from '@StratCraft/types';

import { RESEARCH_ENVIRONMENT_JOB_POLL_MS } from '@shared/constants/timing';
import {
  RESEARCH_REQUEST_ERROR_CODES,
  selectActiveOperation,
  selectCapabilityCards,
  selectFailure,
  selectIsBusy,
  selectPrimaryAction,
  useResearchEnvironmentStore,
} from '../useResearchEnvironmentStore';

// -----------------------------------------------------------------------------
// Fixtures -- built to satisfy the shared schema's superRefine, not hand-waved.
// -----------------------------------------------------------------------------

const VERIFIED_AT = '2026-07-30T12:00:00.000Z';
const SHA = 'a'.repeat(64);

function capabilities(
  state: ResearchCapabilityStatus['state'],
  withVersion: boolean,
): Record<ResearchCapability, ResearchCapabilityStatus> {
  return Object.fromEntries(
    RESEARCH_CAPABILITIES.map((capability) => [
      capability,
      {
        expected: '1.0.0',
        ...(withVersion ? { installed: '1.0.0' } : {}),
        state,
      } satisfies ResearchCapabilityStatus,
    ]),
  ) as Record<ResearchCapability, ResearchCapabilityStatus>;
}

const BASE: Omit<ResearchEnvironmentStatus, 'state' | 'capabilities'> = {
  schemaVersion: 2,
  profile: 'research-default',
  projection: 'default',
  supportedPlatform: true,
  platform: 'linux',
  architecture: 'x64',
};

const ABSENT: ResearchEnvironmentStatus = {
  ...BASE,
  state: 'absent',
  capabilities: capabilities('absent', false),
};

const READY: ResearchEnvironmentStatus = {
  ...BASE,
  state: 'ready',
  interpreterPath: '/home/u/.pixi/envs/research-default/bin/python',
  lastVerifiedAt: VERIFIED_AT,
  pixiVersion: '0.41.0',
  manifestSha256: SHA,
  lockSha256: SHA,
  capabilities: capabilities('ready', true),
};

function inFlight(
  state: 'installing' | 'repairing' | 'uninstalling' | 'verifying',
  operation: 'install' | 'repair' | 'uninstall' | 'verify',
  jobId: string,
): ResearchEnvironmentStatus {
  return {
    ...BASE,
    state,
    activeJobId: jobId,
    activeOperation: operation,
    capabilities: capabilities(state, false),
  };
}

const INSTALL_FAILURE: ResearchEnvironmentFailure = {
  category: 'install_failed',
  stage: 'install',
  cause: 'process_exit',
  message: 'Pixi exited with status 1.',
  remediation: 'Retry the installation.',
};

function failed(
  failure: ResearchEnvironmentFailure = INSTALL_FAILURE,
): ResearchEnvironmentStatus {
  return {
    ...BASE,
    state: 'failed',
    capabilities: capabilities('failed', false),
    failure,
  };
}

function job(
  overrides: Partial<ResearchEnvironmentJob> & Pick<ResearchEnvironmentJob, 'status'>,
): ResearchEnvironmentJob {
  return {
    jobId: 'job-1',
    profile: 'research-default',
    operation: 'install',
    state: 'running',
    startedAt: VERIFIED_AT,
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Bridge double
// -----------------------------------------------------------------------------

interface BridgeDouble {
  getStatus: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  repair: ReturnType<typeof vi.fn>;
  uninstall: ReturnType<typeof vi.fn>;
}

/**
 * This vitest project runs `environment: 'node'`, so there is no DOM `window`.
 * Renderer suites here assign `globalThis.window` themselves (as
 * `useProviderList` and `usePluginAuth` do); the store resolves the bridge per
 * call rather than at module load precisely so this works.
 */
function installBridge(bridge: Partial<BridgeDouble>): BridgeDouble {
  const full: BridgeDouble = {
    getStatus: vi.fn().mockResolvedValue({ success: true, data: ABSENT }),
    getJob: vi.fn(),
    verify: vi.fn(),
    install: vi.fn(),
    repair: vi.fn(),
    uninstall: vi.fn(),
    ...bridge,
  };
  (globalThis as { window?: unknown }).window = {
    electronAPI: { researchEnvironment: full },
  };
  return full;
}

beforeEach(() => {
  vi.useFakeTimers();
  useResearchEnvironmentStore.getState().reset();
  // A window with no `electronAPI` is the "bridge missing" case under test.
  (globalThis as { window?: unknown }).window = {};
});

afterEach(() => {
  useResearchEnvironmentStore.getState().reset();
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
});

const state = () => useResearchEnvironmentStore.getState();

// -----------------------------------------------------------------------------

describe('initial state', () => {
  it('starts UNKNOWN rather than absent', () => {
    // `absent` offers an Install button. Rendering it before the first read
    // would invite a click on an unanswered question (TICKET_858).
    expect(state().status).toBeNull();
    expect(selectPrimaryAction(state())).toBeNull();
    expect(selectCapabilityCards(state())).toEqual([]);
    expect(selectIsBusy(state())).toBe(false);
  });
});

describe('hydrate', () => {
  it('stores a validated status', async () => {
    installBridge({});
    await state().hydrate();
    expect(state().status).toEqual(ABSENT);
    expect(state().requestError).toBeNull();
  });

  it('reports a missing bridge instead of rendering an empty environment', async () => {
    await state().hydrate();
    expect(state().status).toBeNull();
    expect(state().requestError?.code).toBe(
      RESEARCH_REQUEST_ERROR_CODES.BRIDGE_UNAVAILABLE,
    );
  });

  it('rejects a malformed payload rather than storing it', async () => {
    // A status claiming `ready` without an interpreter violates the shared
    // schema. Storing it would let the page display a ready environment that
    // cannot be run.
    installBridge({
      getStatus: vi.fn().mockResolvedValue({
        success: true,
        data: { ...READY, interpreterPath: undefined },
      }),
    });
    await state().hydrate();
    expect(state().status).toBeNull();
    expect(state().requestError?.code).toBe(
      RESEARCH_REQUEST_ERROR_CODES.INVALID_PAYLOAD,
    );
  });

  it('propagates a handler error code verbatim', async () => {
    installBridge({
      getStatus: vi.fn().mockResolvedValue({
        success: false, error: 'service down', code: 'service/unavailable',
      }),
    });
    await state().hydrate();
    expect(state().requestError).toEqual({
      code: 'service/unavailable', message: 'service down',
    });
  });

  it('surfaces a rejected invoke instead of swallowing it', async () => {
    installBridge({ getStatus: vi.fn().mockRejectedValue(new Error('EPIPE')) });
    await state().hydrate();
    expect(state().requestError?.message).toBe('EPIPE');
  });
});

describe('reconnect to an active job (AC6 / AC6a)', () => {
  // Each in-flight state must come back as ITSELF after a reload the renderer
  // did not witness -- the operation identity is read from the service, never
  // remembered locally.
  const cases = [
    ['installing', 'install'],
    ['repairing', 'repair'],
    ['verifying', 'verify'],
  ] as const;

  for (const [environmentState, operation] of cases) {
    it(`reconnects to an in-flight ${operation} without relabelling it`, async () => {
      const status = inFlight(environmentState, operation, 'job-42');
      installBridge({
        getStatus: vi.fn().mockResolvedValue({ success: true, data: status }),
        getJob: vi.fn().mockResolvedValue({
          success: true,
          data: job({ jobId: 'job-42', operation, status }),
        }),
      });

      await state().hydrate();
      await vi.advanceTimersByTimeAsync(0);

      expect(state().job?.jobId).toBe('job-42');
      expect(state().job?.operation).toBe(operation);
      expect(selectActiveOperation(state())).toBe(operation);
      expect(selectIsBusy(state())).toBe(true);
      // In flight means the primary action is withheld -- it is already running.
      expect(selectPrimaryAction(state())).toBeNull();
    });
  }

  it('does not poll when no job is active', async () => {
    const bridge = installBridge({});
    await state().hydrate();
    expect(bridge.getJob).not.toHaveBeenCalled();
    expect(state().isPolling).toBe(false);
  });
});

describe('polling', () => {
  it('follows a job to success and then re-reads settled status', async () => {
    const running = inFlight('installing', 'install', 'job-7');
    const getJob = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        data: job({ jobId: 'job-7', status: running }),
      })
      .mockResolvedValueOnce({
        success: true,
        data: job({
          jobId: 'job-7', state: 'succeeded', finishedAt: VERIFIED_AT, status: READY,
        }),
      });
    const getStatus = vi.fn()
      .mockResolvedValueOnce({ success: true, data: running })
      .mockResolvedValue({ success: true, data: READY });
    installBridge({ getStatus, getJob });

    await state().hydrate();
    await vi.advanceTimersByTimeAsync(0);
    expect(state().isPolling).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);

    expect(state().isPolling).toBe(false);
    expect(state().job?.state).toBe('succeeded');
    // The settled status came from the final getStatus, not the job frame.
    expect(state().status).toEqual(READY);
    expect(selectPrimaryAction(state())).toBe('verify');
  });

  it('stops polling when the job fails and keeps the failure actionable', async () => {
    const failedStatus = failed();
    installBridge({
      getStatus: vi.fn()
        .mockResolvedValueOnce({
          success: true, data: inFlight('installing', 'install', 'job-9'),
        })
        .mockResolvedValue({ success: true, data: failedStatus }),
      getJob: vi.fn().mockResolvedValue({
        success: true,
        data: job({
          jobId: 'job-9', state: 'failed', finishedAt: VERIFIED_AT, status: failedStatus,
        }),
      }),
    });

    await state().hydrate();
    await vi.advanceTimersByTimeAsync(0);

    expect(state().isPolling).toBe(false);
    expect(selectFailure(state())).toEqual(INSTALL_FAILURE);
    expect(selectPrimaryAction(state())).toBe('repair');
  });

  it('a superseded poll loop cannot overwrite the newer job', async () => {
    // The race this guards is narrow, so it has to be staged deliberately: the
    // OLD loop must still be suspended inside its `getJob` await at the moment
    // the new operation starts. With immediately-resolving mocks the two loops
    // never overlap and the bug is invisible, so the old read is held open on a
    // deferred promise and released only after `verify` has taken over.
    const running = inFlight('installing', 'install', 'old');
    let releaseOldRead: ((value: unknown) => void) | undefined;

    installBridge({
      getStatus: vi.fn().mockResolvedValue({ success: true, data: running }),
      getJob: vi.fn().mockImplementation((jobId: string) => {
        const frame = {
          success: true,
          data: job({
            jobId,
            operation: jobId === 'old' ? 'install' : 'verify',
            status: running,
          }),
        };
        if (jobId === 'old' && !releaseOldRead) {
          return new Promise((resolve) => { releaseOldRead = resolve; })
            .then(() => frame);
        }
        return Promise.resolve(frame);
      }),
      verify: vi.fn().mockResolvedValue({ success: true, data: { jobId: 'new' } }),
    });

    // Old loop starts and parks inside its await -- nothing written yet.
    await state().hydrate();
    await vi.advanceTimersByTimeAsync(0);
    expect(state().job).toBeNull();

    // Newer operation supersedes it and lands its own job.
    await state().requestVerify();
    await vi.advanceTimersByTimeAsync(0);
    expect(state().job?.jobId).toBe('new');

    // Now let the stale read complete. It must recognise it was superseded and
    // write nothing, rather than clobbering the verify with an install frame.
    releaseOldRead?.(undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state().job?.jobId).toBe('new');
    expect(state().job?.operation).toBe('verify');
  });

  it('stops polling on reset so an unmounted page leaves no timer', async () => {
    const bridge = installBridge({
      getStatus: vi.fn().mockResolvedValue({
        success: true, data: inFlight('installing', 'install', 'job-1'),
      }),
      getJob: vi.fn().mockResolvedValue({
        success: true,
        data: job({ status: inFlight('installing', 'install', 'job-1') }),
      }),
    });
    await state().hydrate();
    await vi.advanceTimersByTimeAsync(0);
    expect(state().isPolling).toBe(true);

    state().reset();
    expect(state().isPolling).toBe(false);
    expect(state().job).toBeNull();

    // A tick may already be SCHEDULED when reset lands. Draining the timers
    // proves the loop checks it has been superseded BEFORE issuing another
    // read -- without that check, a reset store would silently repopulate
    // itself with the job the user just navigated away from.
    const callsAtReset = bridge.getJob.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(bridge.getJob).toHaveBeenCalledTimes(callsAtReset);
    expect(state().job).toBeNull();
  });
});

describe('operations (AC4 / AC5)', () => {
  it('install/repair/uninstall/verify are invoked with NO arguments', async () => {
    // Structural half of AC5: there is no parameter through which a renderer
    // could pass a confirmation boolean or an approval object.
    const bridge = installBridge({
      install: vi.fn().mockResolvedValue({ success: true, data: { jobId: 'j' } }),
      repair: vi.fn().mockResolvedValue({ success: true, data: { jobId: 'j' } }),
      uninstall: vi.fn().mockResolvedValue({ success: true, data: { jobId: 'j' } }),
      verify: vi.fn().mockResolvedValue({ success: true, data: { jobId: 'j' } }),
      getJob: vi.fn().mockResolvedValue({
        success: true,
        data: job({ state: 'succeeded', finishedAt: VERIFIED_AT, status: READY }),
      }),
    });

    await state().requestInstall();
    await state().requestRepair();
    await state().requestUninstall();
    await state().requestVerify();

    expect(bridge.install).toHaveBeenCalledWith();
    expect(bridge.repair).toHaveBeenCalledWith();
    expect(bridge.uninstall).toHaveBeenCalledWith();
    expect(bridge.verify).toHaveBeenCalledWith();
  });

  it('a declined approval is a request error, not a broken environment', async () => {
    installBridge({
      getStatus: vi.fn().mockResolvedValue({ success: true, data: ABSENT }),
      install: vi.fn().mockResolvedValue({
        success: false, error: 'Declined.', code: 'approval/declined',
      }),
    });
    await state().hydrate();
    await state().requestInstall();

    expect(state().requestError?.code).toBe('approval/declined');
    // The environment itself is untouched -- still absent, still installable.
    expect(state().status?.state).toBe('absent');
    expect(selectFailure(state())).toBeNull();
    expect(state().isPolling).toBe(false);
  });
});

describe('selectPrimaryAction (AC4)', () => {
  it('offers repair -- NOT install -- for a failed environment', async () => {
    installBridge({
      getStatus: vi.fn().mockResolvedValue({ success: true, data: failed() }),
    });
    await state().hydrate();
    expect(selectPrimaryAction(state())).toBe('repair');
  });

  it('offers install only when absent, and verify when ready', async () => {
    installBridge({});
    await state().hydrate();
    expect(selectPrimaryAction(state())).toBe('install');

    installBridge({
      getStatus: vi.fn().mockResolvedValue({ success: true, data: READY }),
    });
    await state().hydrate();
    expect(selectPrimaryAction(state())).toBe('verify');
  });

  it('offers nothing on an unsupported platform', async () => {
    const unsupported: ResearchEnvironmentStatus = {
      ...BASE,
      supportedPlatform: false,
      state: 'failed',
      platform: 'aix',
      capabilities: capabilities('absent', false),
      failure: {
        category: 'unsupported_platform',
        stage: 'admission',
        cause: 'unsupported',
        message: 'This platform is not supported.',
        remediation: 'Use a supported platform.',
      },
    };
    installBridge({
      getStatus: vi.fn().mockResolvedValue({ success: true, data: unsupported }),
    });
    await state().hydrate();
    expect(selectPrimaryAction(state())).toBeNull();
  });
});

describe('failure categories (AC7)', () => {
  // One representative per shared category. The point is coverage of the
  // discriminated union: every category must reach the selector intact so the
  // page can branch on structure without reading `message`.
  const FAILURES: ResearchEnvironmentFailure[] = [
    { category: 'pixi_missing', stage: 'admission', cause: 'missing_executable', message: 'm', remediation: 'r' },
    { category: 'lock_missing', stage: 'admission', cause: 'missing_lock', message: 'm', remediation: 'r' },
    { category: 'lock_drift', stage: 'admission', cause: 'manifest_drift', message: 'm', remediation: 'r' },
    { category: 'lifecycle_coordination_failed', stage: 'admission', cause: 'lock_io', message: 'm', remediation: 'r' },
    { category: 'network_failed', stage: 'install', cause: 'network', message: 'm', remediation: 'r' },
    { category: 'install_failed', stage: 'install', cause: 'process_exit', message: 'm', remediation: 'r' },
    { category: 'repair_failed', stage: 'repair', cause: 'process_exit', message: 'm', remediation: 'r' },
    { category: 'uninstall_failed', stage: 'uninstall', cause: 'process_exit', message: 'm', remediation: 'r' },
    { category: 'workload_active', stage: 'admission', cause: 'active', message: 'm', remediation: 'r' },
    { category: 'operation_interrupted', stage: 'install', cause: 'process_lost', message: 'm', remediation: 'r' },
    { category: 'verification_failed', stage: 'julia_verify', cause: 'backend_init', capability: 'pysr', message: 'm', remediation: 'r' },
  ];

  for (const failure of FAILURES) {
    it(`carries ${failure.category} through to the selector intact`, async () => {
      installBridge({
        getStatus: vi.fn().mockResolvedValue({
          success: true, data: failed(failure),
        }),
      });
      await state().hydrate();
      // Same object: no reshaping, no message parsing, nothing dropped.
      expect(selectFailure(state())).toEqual(failure);
    });
  }

  it('covers every shared failure category (unsupported_platform included)', () => {
    // Guards against a category being added to the contract with no coverage
    // here. `unsupported_platform` is exercised in its own test above, because
    // it is the one category that also forces `supportedPlatform: false`.
    const covered = new Set<string>([
      ...FAILURES.map((f) => f.category),
      'unsupported_platform',
    ]);
    expect([...covered].sort())
      .toEqual([...RESEARCH_ENVIRONMENT_FAILURE_CATEGORIES].sort());
  });
});

describe('selectCapabilityCards (AC3)', () => {
  it('renders one card per capability in the contract tuple order', async () => {
    installBridge({
      getStatus: vi.fn().mockResolvedValue({ success: true, data: READY }),
    });
    await state().hydrate();

    const cards = selectCapabilityCards(state());
    // Tuple order, NOT object-key order -- card order is the contract's.
    expect(cards.map((c) => c.capability)).toEqual([...RESEARCH_CAPABILITIES]);
    expect(cards).toHaveLength(RESEARCH_CAPABILITIES.length);
    for (const card of cards) {
      expect(card.status.installed).toBe('1.0.0');
    }
  });

  it('includes pandas_ta as a first-class card', async () => {
    installBridge({
      getStatus: vi.fn().mockResolvedValue({ success: true, data: READY }),
    });
    await state().hydrate();
    // AC15: this card is the only surface reporting pandas-ta readiness.
    expect(selectCapabilityCards(state()).some((c) => c.capability === 'pandas_ta'))
      .toBe(true);
  });

  /**
   * AC2/AC11 regression -- the page could not mount before this held.
   *
   * Zustand v5 subscribes via `useSyncExternalStore`, which compares the
   * selector's return value with `Object.is`. When this selector built a fresh
   * array of fresh objects per call, every store read looked like a change:
   * React re-rendered, the selector ran again, and the live app died with React
   * error #185 (maximum update depth exceeded) the instant the rail button was
   * clicked.
   *
   * Every other test in this block uses `toEqual`, which is DEEP equality and
   * structurally blind to this -- which is why 100 percent branch coverage was
   * accurate and the page still crashed. These assert identity with `toBe`.
   */
  it('returns a referentially stable array across repeated reads', async () => {
    installBridge({
      getStatus: vi.fn().mockResolvedValue({ success: true, data: READY }),
    });
    await state().hydrate();

    const first = selectCapabilityCards(state());
    const second = selectCapabilityCards(state());
    expect(second).toBe(first);
    // The card objects themselves must be stable too: a stable outer array
    // holding fresh members still breaks any memoized child comparison.
    expect(second[0]).toBe(first[0]);
  });

  it('returns a referentially stable empty list before hydration', () => {
    // The pre-hydrate window is not exempt: a fresh `[]` per call loops the
    // page for as long as no status has arrived.
    expect(selectCapabilityCards(state())).toBe(selectCapabilityCards(state()));
  });

  it('rebuilds the array when the capabilities payload genuinely changes', async () => {
    installBridge({
      getStatus: vi.fn().mockResolvedValue({ success: true, data: READY }),
    });
    await state().hydrate();
    const first = selectCapabilityCards(state());

    // A different capabilities object must NOT be served from cache -- the
    // stability fix must not turn into a staleness bug.
    installBridge({
      getStatus: vi.fn().mockResolvedValue({
        success: true,
        data: { ...READY, capabilities: { ...READY.capabilities } },
      }),
    });
    await state().hydrate();
    const second = selectCapabilityCards(state());

    expect(second).not.toBe(first);
    expect(second.map((c) => c.capability)).toEqual([...RESEARCH_CAPABILITIES]);
  });
});

// -----------------------------------------------------------------------------
// TICKET_1335_1 Phase 5 -- AC14 coverage of the error-propagation paths.
//
// Every branch below is a way the environment read can fail AFTER the first
// status read succeeded, which is exactly when the page is already showing an
// environment and a silent failure would leave stale progress on screen
// (TICKET_858: no error may be logging-only).
//
// `readStatus`'s four failure modes were already covered by the `hydrate`
// block. Its `readJob` and `runOperation` twins were NOT: they only run once a
// job exists, so no earlier test reached them. They are covered here rather
// than excluded, because each is reachable in production.
// -----------------------------------------------------------------------------

describe('job read failures (AC7 / AC14)', () => {
  /**
   * Drive hydrate to the point where a job read is attempted, using a status
   * that declares an active job. Whatever `getJob` is given decides the branch.
   */
  async function hydrateWithJobRead(getJob: ReturnType<typeof vi.fn>): Promise<void> {
    installBridge({
      getStatus: vi.fn().mockResolvedValue({
        success: true, data: inFlight('installing', 'install', 'job-9'),
      }),
      getJob,
    });
    await state().hydrate();
    // `startPolling` launches its first read with `void tick()`, so hydrate
    // resolves BEFORE the job read settles. Flush the pending tick.
    await vi.advanceTimersByTimeAsync(0);
  }

  it('surfaces a rejected getJob invoke instead of polling in silence', async () => {
    await hydrateWithJobRead(vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    expect(state().requestError).toEqual({
      code: RESEARCH_REQUEST_ERROR_CODES.REQUEST_FAILED,
      message: 'ECONNRESET',
    });
    // A failed read is terminal for the loop: continuing to poll a job the
    // renderer cannot read would spin forever behind a frozen progress panel.
    expect(state().isPolling).toBe(false);
  });

  it('reports a non-Error rejection with the shared unknown-reason message', async () => {
    // `throw 'boom'` is legal JavaScript and reaches the same catch. Without the
    // instanceof branch this would render `undefined` to the user.
    await hydrateWithJobRead(vi.fn().mockRejectedValue('boom'));

    expect(state().requestError?.message)
      .toBe('The request failed without a reported reason.');
  });

  it('propagates a getJob handler error code verbatim', async () => {
    await hydrateWithJobRead(vi.fn().mockResolvedValue({
      success: false, error: 'no such job', code: 'job/not-found',
    }));

    expect(state().requestError).toEqual({
      code: 'job/not-found', message: 'no such job',
    });
  });

  it('falls back to the shared code and message when the envelope carries neither', async () => {
    // An unsuccessful envelope is not obliged to explain itself. The store must
    // still produce a displayable error rather than `{code: undefined}`.
    await hydrateWithJobRead(vi.fn().mockResolvedValue({ success: false }));

    expect(state().requestError).toEqual({
      code: RESEARCH_REQUEST_ERROR_CODES.REQUEST_FAILED,
      message: 'The request failed without a reported reason.',
    });
  });

  it('rejects a malformed job rather than storing it', async () => {
    // A job claiming `succeeded` with no `finishedAt` violates the shared
    // schema. Storing it would let the progress panel count elapsed time
    // against a job that never declared when it stopped.
    await hydrateWithJobRead(vi.fn().mockResolvedValue({
      success: true,
      data: { ...job({ state: 'succeeded', status: READY }), finishedAt: undefined },
    }));

    expect(state().job).toBeNull();
    expect(state().requestError?.code).toBe(
      RESEARCH_REQUEST_ERROR_CODES.INVALID_PAYLOAD,
    );
  });
});

describe('operation request failures (AC5 / AC14)', () => {
  it('reports a missing bridge instead of appearing to start an install', async () => {
    // No `installBridge` call: `window` has no `electronAPI` (see beforeEach).
    // The button was pressed and nothing can happen -- the user must be told,
    // or they will wait for progress that will never arrive.
    await state().requestInstall();

    expect(state().requestError?.code).toBe(
      RESEARCH_REQUEST_ERROR_CODES.BRIDGE_UNAVAILABLE,
    );
    expect(state().isPolling).toBe(false);
    expect(state().job).toBeNull();
  });

  it('surfaces a rejected mutation invoke', async () => {
    installBridge({ repair: vi.fn().mockRejectedValue(new Error('EPIPE')) });
    await state().requestRepair();

    expect(state().requestError).toEqual({
      code: RESEARCH_REQUEST_ERROR_CODES.REQUEST_FAILED,
      message: 'EPIPE',
    });
    expect(state().isPolling).toBe(false);
  });

  it('reports a non-Error mutation rejection with the shared unknown-reason message', async () => {
    installBridge({ verify: vi.fn().mockRejectedValue('boom') });
    await state().requestVerify();

    expect(state().requestError?.message)
      .toBe('The request failed without a reported reason.');
  });

  it('treats an admitted-but-jobless envelope as a failure, not a silent success', async () => {
    // `success: true` with no `jobId` is a broken handler contract. Starting a
    // poll on `undefined` would be worse than reporting it.
    const bridge = installBridge({
      install: vi.fn().mockResolvedValue({ success: true, data: {} }),
      getJob: vi.fn(),
    });
    await state().requestInstall();

    expect(state().requestError?.code).toBe(
      RESEARCH_REQUEST_ERROR_CODES.REQUEST_FAILED,
    );
    expect(bridge.getJob).not.toHaveBeenCalled();
    expect(state().isPolling).toBe(false);
  });

  it('clears a prior request error when a new operation is admitted', async () => {
    const bridge = installBridge({
      install: vi.fn()
        .mockResolvedValueOnce({ success: false, error: 'Declined.', code: 'approval/declined' })
        .mockResolvedValueOnce({ success: true, data: { jobId: 'job-3' } }),
      getJob: vi.fn().mockResolvedValue({
        success: true,
        data: job({ jobId: 'job-3', state: 'succeeded', finishedAt: VERIFIED_AT, status: READY }),
      }),
    });

    await state().requestInstall();
    expect(state().requestError?.code).toBe('approval/declined');

    // Retrying must not leave the declined notice on screen next to live
    // progress -- the second attempt answers the same question.
    await state().requestInstall();
    expect(state().requestError).toBeNull();
    expect(bridge.install).toHaveBeenCalledTimes(2);
  });
});

describe('clearRequestError', () => {
  it('dismisses a request error without touching environment truth', async () => {
    installBridge({
      getStatus: vi.fn().mockResolvedValue({ success: true, data: failed() }),
      repair: vi.fn().mockResolvedValue({
        success: false, error: 'Declined.', code: 'approval/declined',
      }),
    });
    await state().hydrate();
    await state().requestRepair();
    expect(state().requestError).not.toBeNull();

    state().clearRequestError();

    expect(state().requestError).toBeNull();
    // Dismissing the notice must NOT dismiss the failure: the environment is
    // still broken, and `selectFailure` is the surface that says so.
    expect(selectFailure(state())?.category).toBe('install_failed');
    expect(state().status?.state).toBe('failed');
  });
});

describe('selectActiveOperation', () => {
  it('is null for a settled environment that declares no active operation', async () => {
    installBridge({
      getStatus: vi.fn().mockResolvedValue({ success: true, data: READY }),
    });
    await state().hydrate();

    // Distinct from the unknown-status case: the status IS known, and it says
    // nothing is running. Reporting a stale operation here would keep a
    // "View Progress" action on a finished environment.
    expect(state().status).not.toBeNull();
    expect(selectActiveOperation(state())).toBeNull();
    expect(selectIsBusy(state())).toBe(false);
  });
});

describe('status read fallbacks (AC7 / AC14)', () => {
  it('reports a non-Error getStatus rejection with the shared unknown-reason message', async () => {
    installBridge({ getStatus: vi.fn().mockRejectedValue('boom') });
    await state().hydrate();

    expect(state().requestError?.message)
      .toBe('The request failed without a reported reason.');
  });

  it('falls back to the shared code and message when getStatus explains nothing', async () => {
    installBridge({ getStatus: vi.fn().mockResolvedValue({ success: false }) });
    await state().hydrate();

    expect(state().requestError).toEqual({
      code: RESEARCH_REQUEST_ERROR_CODES.REQUEST_FAILED,
      message: 'The request failed without a reported reason.',
    });
  });

  it('reports a non-Error parse failure with the shared unknown-reason message', async () => {
    // The parser throws whatever it throws; the store must not assume Error.
    vi.spyOn(schema, 'parseResearchEnvironmentStatus').mockImplementation(() => {
      throw 'not an Error';
    });
    installBridge({});
    await state().hydrate();

    expect(state().status).toBeNull();
    expect(state().requestError).toEqual({
      code: RESEARCH_REQUEST_ERROR_CODES.INVALID_PAYLOAD,
      message: 'The request failed without a reported reason.',
    });
  });

  it('reports a non-Error job parse failure with the shared unknown-reason message', async () => {
    vi.spyOn(schema, 'parseResearchEnvironmentJob').mockImplementation(() => {
      throw 'not an Error';
    });
    installBridge({
      getStatus: vi.fn().mockResolvedValue({
        success: true, data: inFlight('installing', 'install', 'job-9'),
      }),
      getJob: vi.fn().mockResolvedValue({
        success: true, data: job({ jobId: 'job-9', status: READY }),
      }),
    });
    await state().hydrate();
    await vi.advanceTimersByTimeAsync(0);

    expect(state().job).toBeNull();
    expect(state().requestError).toEqual({
      code: RESEARCH_REQUEST_ERROR_CODES.INVALID_PAYLOAD,
      message: 'The request failed without a reported reason.',
    });
  });

  it('reports the bridge vanishing mid-poll instead of freezing the progress panel', async () => {
    // The bridge is resolved per call, so renderer teardown between polls is
    // reachable. What must hold is observable: the user is told, and the loop
    // stops. Which internal read reports it is deliberately NOT asserted --
    // `readJob` returning null makes the tick terminal, and the terminal
    // `readStatus()` finds the same missing bridge, so the two are
    // indistinguishable from outside the store and only one can be tested.
    const inFlightStatus = inFlight('installing', 'install', 'job-9');
    installBridge({
      getStatus: vi.fn().mockResolvedValue({ success: true, data: inFlightStatus }),
      getJob: vi.fn().mockResolvedValue({
        success: true, data: job({ jobId: 'job-9', status: inFlightStatus }),
      }),
    });
    await state().hydrate();
    await vi.advanceTimersByTimeAsync(0);
    expect(state().isPolling).toBe(true);
    expect(state().requestError).toBeNull();

    (globalThis as { window?: unknown }).window = {};
    await vi.advanceTimersByTimeAsync(RESEARCH_ENVIRONMENT_JOB_POLL_MS);

    expect(state().requestError?.code).toBe(
      RESEARCH_REQUEST_ERROR_CODES.BRIDGE_UNAVAILABLE,
    );
    // The loop must not keep spinning against a bridge that is gone.
    expect(state().isPolling).toBe(false);
  });
});
