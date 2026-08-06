/**
 * TICKET_1335_1 Phase 2 -- renderer store for the research environment.
 *
 * WHAT IT IS FOR:
 * Parent TICKET_1335 owns the locked `pixi.toml` + `pixi.lock` pair, the
 * `ResearchEnvironmentService`, install exclusion, durable jobs, and exact
 * interpreter verification. This store owns none of that. It holds the shared
 * status/job payloads VERBATIM and exposes selectors over them, so the page can
 * render without re-deciding anything the service already decided.
 *
 * TICKET_367 LAYER 2 -- why Zustand and not `useState` in the page:
 * AC6 requires that starting an install, navigating to another view, and coming
 * back restores the same job and its progress. A `useState` in
 * `ResearchEnvironmentPage` dies with the page on unmount, so the job would be
 * "lost" the moment the user looked at anything else -- the exact defect AC6
 * names. The active job is cross-cutting state that outlives any one mount.
 *
 * WHY THIS STORE POLLS (and `useServiceApiRoleStore` does not):
 * That store has a push channel; this one does not. All five channels in
 * `RESEARCH_ENVIRONMENT_CHANNELS` are invoke/await -- the landed
 * `research-environment-handlers.ts` contains no `webContents.send`. Rather
 * than add a second producer of environment state outside the parent's IPC
 * contract, the renderer polls `getJob` while a job is in flight and stops at
 * the terminal state. See `RESEARCH_ENVIRONMENT_JOB_POLL_MS`.
 *
 * WHAT THIS STORE DELIBERATELY DOES NOT DO:
 * - It does not parse `failure.message` or `failure.remediation`. AC7 requires
 *   presentation be selected from `category`/`stage`/`cause`/`capability`; the
 *   human text is displayed, never branched on.
 * - It does not re-derive readiness from anything. `state === 'ready'` is the
 *   service's verdict, already constrained by the shared schema's `superRefine`
 *   to carry an interpreter, a verification time, and a version per capability.
 * - It has no per-package install action and no arbitrary package input (AC4).
 * - It sends no argument with `install`/`repair`. The preload methods take
 *   none, because Main owns the native dialog and constructs the approval from
 *   what it observed (AC5 / TICKET_1335 D6). There is deliberately nothing here
 *   a renderer could use to fake consent.
 */

import { create } from 'zustand';
import {
  RESEARCH_CAPABILITIES,
  parseResearchEnvironmentJob,
  parseResearchEnvironmentStatus,
  type ResearchCapability,
  type ResearchCapabilityStatus,
  type ResearchEnvironmentFailure,
  type ResearchEnvironmentJob,
  type ResearchEnvironmentOperation,
  type ResearchEnvironmentStatus,
} from '@StratCraft/types';
import { RESEARCH_ENVIRONMENT_JOB_POLL_MS } from '@shared/constants/timing';

// -----------------------------------------------------------------------------
// Preload surface
// -----------------------------------------------------------------------------

/** Envelope every research-environment IPC handler returns. */
interface ResearchEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

interface ResearchEnvironmentBridge {
  getStatus(): Promise<ResearchEnvelope<ResearchEnvironmentStatus>>;
  getJob(jobId: string): Promise<ResearchEnvelope<ResearchEnvironmentJob>>;
  verify(): Promise<ResearchEnvelope<{ jobId: string }>>;
  install(): Promise<ResearchEnvelope<{ jobId: string }>>;
  repair(): Promise<ResearchEnvelope<{ jobId: string }>>;
  uninstall(): Promise<ResearchEnvelope<{ jobId: string }>>;
  removeGpquant(): Promise<ResearchEnvelope<{ jobId: string }>>;
}

/**
 * Resolved per call rather than captured at module load.
 *
 * The page also mounts in renderer test environments where `electronAPI` is
 * absent. Absence is reported as a request error rather than treated as an
 * empty environment: TICKET_858 forbids a silent failure, and "the bridge is
 * missing" must never render as "nothing is installed".
 */
function getBridge(): ResearchEnvironmentBridge | null {
  return (window as unknown as {
    electronAPI?: { researchEnvironment?: ResearchEnvironmentBridge };
  }).electronAPI?.researchEnvironment ?? null;
}

// -----------------------------------------------------------------------------
// Error shape
// -----------------------------------------------------------------------------

/**
 * A failed REQUEST, which is not the same thing as a failed ENVIRONMENT.
 *
 * `ResearchEnvironmentFailure` describes an environment that admitted a job and
 * then failed; this describes a call that never got that far -- IPC unavailable,
 * a rejected invoke, a malformed payload, or an approval the human declined.
 * Collapsing the two would let "you cancelled the dialog" render as "your
 * environment is broken".
 */
export interface ResearchRequestError {
  code: string;
  message: string;
}

/** Codes this store originates (handler codes pass through untouched). */
export const RESEARCH_REQUEST_ERROR_CODES = {
  BRIDGE_UNAVAILABLE: 'renderer/bridge-unavailable',
  INVALID_PAYLOAD: 'renderer/invalid-payload',
  REQUEST_FAILED: 'renderer/request-failed',
} as const;

const UNKNOWN_ERROR_MESSAGE = 'The request failed without a reported reason.';

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

export interface ResearchEnvironmentState {
  /**
   * Last validated status, or null before the first read resolves.
   *
   * Null is "not yet known", NEVER "absent". `absent` is a real, actionable
   * environment state that offers Install; rendering it before the first read
   * would flash a wrong answer and invite a click on a question that has not
   * been answered yet.
   */
  status: ResearchEnvironmentStatus | null;
  /** The active or most recently observed job, or null when none is known. */
  job: ResearchEnvironmentJob | null;
  /** Non-null when the last request failed. Cleared when a new one starts. */
  requestError: ResearchRequestError | null;
  /** True while a poll loop is following a non-terminal job. */
  isPolling: boolean;
}

interface ResearchEnvironmentActions {
  hydrate(): Promise<void>;
  requestInstall(): Promise<void>;
  requestRepair(): Promise<void>;
  requestVerify(): Promise<void>;
  requestUninstall(): Promise<void>;
  requestRemoveGpquant(): Promise<void>;
  clearRequestError(): void;
  reset(): void;
}

const INITIAL: ResearchEnvironmentState = {
  status: null,
  job: null,
  requestError: null,
  isPolling: false,
};

// -----------------------------------------------------------------------------
// Poll scheduling
// -----------------------------------------------------------------------------

/**
 * Module-scoped so a poll loop survives the page unmounting -- that is the whole
 * point of AC6. Kept out of the store's state because a timer handle is not
 * view state and must not trigger a re-render.
 */
let pollTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Monotonic token identifying the newest poll loop.
 *
 * Without it, a `verify` started while an `install` poll was mid-flight would
 * leave two loops writing to `job`, and the older one could overwrite the newer
 * job's progress. Every loop checks its token before writing and stops if it
 * has been superseded.
 */
let pollGeneration = 0;

function stopPolling(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  pollGeneration += 1;
}

// -----------------------------------------------------------------------------
// Store
// -----------------------------------------------------------------------------

export const useResearchEnvironmentStore = create<
  ResearchEnvironmentState & ResearchEnvironmentActions
>((set, get) => {
  /** Read status once, validate it, and store it. Returns it, or null. */
  async function readStatus(): Promise<ResearchEnvironmentStatus | null> {
    const bridge = getBridge();
    if (!bridge) {
      set({
        requestError: {
          code: RESEARCH_REQUEST_ERROR_CODES.BRIDGE_UNAVAILABLE,
          message: 'The desktop bridge is unavailable in this window.',
        },
      });
      return null;
    }

    let envelope: ResearchEnvelope<ResearchEnvironmentStatus>;
    try {
      envelope = await bridge.getStatus();
    } catch (error) {
      set({
        requestError: {
          code: RESEARCH_REQUEST_ERROR_CODES.REQUEST_FAILED,
          message: error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE,
        },
      });
      return null;
    }

    if (!envelope.success || !envelope.data) {
      set({
        requestError: {
          code: envelope.code ?? RESEARCH_REQUEST_ERROR_CODES.REQUEST_FAILED,
          message: envelope.error ?? UNKNOWN_ERROR_MESSAGE,
        },
      });
      return null;
    }

    // Validated even though it crossed a typed preload boundary: TypeScript is
    // erased at runtime and this payload came from another process. The shared
    // schema is the same one the service serialized against.
    let status: ResearchEnvironmentStatus;
    try {
      status = parseResearchEnvironmentStatus(envelope.data);
    } catch (error) {
      set({
        requestError: {
          code: RESEARCH_REQUEST_ERROR_CODES.INVALID_PAYLOAD,
          message: error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE,
        },
      });
      return null;
    }

    set({ status });
    return status;
  }

  /** Read one job by id, validate it, and store it. Returns it, or null. */
  async function readJob(jobId: string): Promise<ResearchEnvironmentJob | null> {
    const bridge = getBridge();
    if (!bridge) return null;

    let envelope: ResearchEnvelope<ResearchEnvironmentJob>;
    try {
      envelope = await bridge.getJob(jobId);
    } catch (error) {
      set({
        requestError: {
          code: RESEARCH_REQUEST_ERROR_CODES.REQUEST_FAILED,
          message: error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE,
        },
      });
      return null;
    }

    if (!envelope.success || !envelope.data) {
      set({
        requestError: {
          code: envelope.code ?? RESEARCH_REQUEST_ERROR_CODES.REQUEST_FAILED,
          message: envelope.error ?? UNKNOWN_ERROR_MESSAGE,
        },
      });
      return null;
    }

    let job: ResearchEnvironmentJob;
    try {
      job = parseResearchEnvironmentJob(envelope.data);
    } catch (error) {
      set({
        requestError: {
          code: RESEARCH_REQUEST_ERROR_CODES.INVALID_PAYLOAD,
          message: error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE,
        },
      });
      return null;
    }

    // The job carries the authoritative status for its own moment in time, so
    // storing both together keeps the summary and the progress panel from
    // disagreeing mid-install.
    set({ job, status: job.status });
    return job;
  }

  /**
   * Follow one job to its terminal state.
   *
   * Reads immediately rather than waiting one interval, so returning to the
   * page shows progress at once instead of after a blank tick.
   */
  function startPolling(jobId: string): void {
    stopPolling();
    const generation = pollGeneration;
    set({ isPolling: true });

    const tick = async (): Promise<void> => {
      const job = await readJob(jobId);
      // Checked AFTER the await, and only here: `stopPolling` clears the
      // pending timeout, so a superseded loop can never be re-entered from the
      // timer -- the sole way to arrive here stale is to have been in flight
      // across the await when a newer operation started. A second check before
      // the await would be unreachable, and unreachable code is untestable
      // code (TICKET_494).
      if (generation !== pollGeneration) return;

      const terminal = job === null
        || job.state === 'succeeded'
        || job.state === 'failed';

      if (terminal) {
        set({ isPolling: false });
        // One final status read so the summary reflects the settled
        // environment rather than the status embedded in the last job frame.
        await readStatus();
        return;
      }

      pollTimer = setTimeout(() => { void tick(); }, RESEARCH_ENVIRONMENT_JOB_POLL_MS);
    };

    void tick();
  }

  /**
   * Shared body of the three mutations.
   *
   * All three go through one path so a future operation cannot accidentally
   * skip error clearing or job following. No argument is forwarded to the
   * bridge -- see the file header on AC5.
   */
  async function runOperation(
    operation: 'install' | 'repair' | 'verify' | 'uninstall' | 'removeGpquant',
  ): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      set({
        requestError: {
          code: RESEARCH_REQUEST_ERROR_CODES.BRIDGE_UNAVAILABLE,
          message: 'The desktop bridge is unavailable in this window.',
        },
      });
      return;
    }

    set({ requestError: null });

    let envelope: ResearchEnvelope<{ jobId: string }>;
    try {
      envelope = await bridge[operation]();
    } catch (error) {
      set({
        requestError: {
          code: RESEARCH_REQUEST_ERROR_CODES.REQUEST_FAILED,
          message: error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE,
        },
      });
      return;
    }

    if (!envelope.success || !envelope.data?.jobId) {
      // Reaches here when the human declined the native dialog, among other
      // reasons. Surfaced with the handler's own code so the page can tell a
      // declined approval from a broken environment.
      set({
        requestError: {
          code: envelope.code ?? RESEARCH_REQUEST_ERROR_CODES.REQUEST_FAILED,
          message: envelope.error ?? UNKNOWN_ERROR_MESSAGE,
        },
      });
      return;
    }

    startPolling(envelope.data.jobId);
  }

  return {
    ...INITIAL,

    /**
     * First mount AND post-reload reconnect, deliberately the same path.
     *
     * AC6 (navigate away and back) and AC6a (reload during a repair) are one
     * problem, not two: both ask "what is running right now?", and the shared
     * schema guarantees an in-flight status carries `activeJobId` plus
     * `activeOperation`. Because the operation identity is read back from the
     * service rather than remembered locally, a repair cannot be relabelled an
     * install by a reload.
     */
    hydrate: async () => {
      set({ requestError: null });
      const status = await readStatus();
      if (!status) return;

      if (status.activeJobId) {
        startPolling(status.activeJobId);
      } else {
        stopPolling();
        set({ isPolling: false });
      }
    },

    requestInstall: () => runOperation('install'),
    requestRepair: () => runOperation('repair'),
    requestVerify: () => runOperation('verify'),
    requestUninstall: () => runOperation('uninstall'),
    requestRemoveGpquant: () => runOperation('removeGpquant'),

    clearRequestError: () => set({ requestError: null }),

    reset: () => {
      stopPolling();
      set({ ...INITIAL });
      void get; // `get` is part of the create signature; state reads go through selectors.
    },
  };
});

// -----------------------------------------------------------------------------
// Selectors
// -----------------------------------------------------------------------------

/** One capability card, in the order the shared runtime tuple defines. */
export interface ResearchCapabilityCardModel {
  capability: ResearchCapability;
  status: ResearchCapabilityStatus;
}

/**
 * Stable empty list.
 *
 * A fresh `[]` per call is a NEW REFERENCE, which is the same defect the cache
 * below exists to prevent -- it would loop the page for the entire pre-hydrate
 * window, before any status arrives.
 */
const NO_CAPABILITY_CARDS: readonly ResearchCapabilityCardModel[] = Object.freeze([]);

/**
 * Identity cache for the derived card list, keyed on the capabilities object it
 * is derived from.
 *
 * Zustand v5 subscribes through `useSyncExternalStore`, which decides "did this
 * change?" by `Object.is` on the selector's RETURN VALUE. A selector that maps
 * into fresh objects therefore reports a change on every store read, React
 * re-renders, the selector runs again, and the page dies with React error #185
 * (maximum update depth exceeded) the moment it mounts.
 *
 * This was invisible to the Phase 5 coverage run because every test calls
 * `selectCapabilityCards(state())` as a plain function and compares with
 * `toEqual`, which is deep equality -- it cannot observe reference identity, and
 * no test rendered the selector through React at all. 100 percent branch
 * coverage was true and the page still could not mount.
 *
 * Keyed on the `capabilities` object rather than a counter or a deep hash: the
 * store replaces `status` wholesale on every read, so when the capabilities
 * payload is genuinely new the key differs and the list is rebuilt, and when the
 * service reports the same object the previous array is returned unchanged.
 * The alternative -- `useShallow` at each call site -- was rejected because it
 * puts the correctness burden on every future consumer of this selector, and
 * one that forgets reintroduces exactly this crash.
 */
let cachedCapabilitiesKey: ResearchEnvironmentStatus['capabilities'] | null = null;
let cachedCapabilityCards: readonly ResearchCapabilityCardModel[] = NO_CAPABILITY_CARDS;

/**
 * Card list for the page.
 *
 * Iterates `RESEARCH_CAPABILITIES` rather than `Object.keys(capabilities)`, so
 * card order is the contract's order rather than object-key order, and a
 * capability added to the shared tuple appears here without an edit (AC3). The
 * schema guarantees every tuple member is present, so no member can be missing.
 *
 * Returns a referentially STABLE array for a stable input -- see the cache note
 * above. Callers must treat the result as read-only.
 */
export const selectCapabilityCards = (
  state: ResearchEnvironmentState,
): readonly ResearchCapabilityCardModel[] => {
  const capabilities = state.status?.capabilities;
  if (!capabilities) {
    cachedCapabilitiesKey = null;
    cachedCapabilityCards = NO_CAPABILITY_CARDS;
    return NO_CAPABILITY_CARDS;
  }
  if (capabilities === cachedCapabilitiesKey) return cachedCapabilityCards;
  cachedCapabilitiesKey = capabilities;
  cachedCapabilityCards = Object.freeze(
    RESEARCH_CAPABILITIES.map((capability) => ({
      capability,
      status: capabilities[capability],
    })),
  );
  return cachedCapabilityCards;
};

/**
 * The single environment-level action offered for the current state (AC4).
 *
 * Null means no action: an unsupported platform offers nothing to click, and
 * an in-flight job is already doing the thing. `failed` maps to `repair` and
 * NOT `install` -- a failed environment exists and must be revalidated in
 * place, not reinstalled over.
 */
export const selectPrimaryAction = (
  state: ResearchEnvironmentState,
): ResearchEnvironmentOperation | null => {
  const status = state.status;
  if (!status || !status.supportedPlatform) return null;
  switch (status.state) {
    case 'absent':
      return 'install';
    case 'ready':
      return 'verify';
    case 'failed':
      return 'repair';
    case 'installing':
    case 'repairing':
    case 'verifying':
    case 'uninstalling':
      return null;
  }
};

/** The structured failure, passed through untouched for AC7 presentation. */
export const selectFailure = (
  state: ResearchEnvironmentState,
): ResearchEnvironmentFailure | null => state.status?.failure ?? null;

/**
 * The operation actually running, or null.
 *
 * Read from the service's `activeOperation` rather than remembered from
 * whichever button was pressed, which is what keeps AC6a true across a reload
 * that this renderer did not witness.
 */
export const selectActiveOperation = (
  state: ResearchEnvironmentState,
): ResearchEnvironmentOperation | null => state.status?.activeOperation ?? null;

/** True while an environment operation is in flight. */
export const selectIsBusy = (state: ResearchEnvironmentState): boolean => {
  const environmentState = state.status?.state;
  return environmentState === 'installing'
    || environmentState === 'repairing'
    || environmentState === 'verifying'
    || environmentState === 'uninstalling';
};
