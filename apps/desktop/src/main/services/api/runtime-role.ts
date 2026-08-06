/**
 * TICKET_1334 P4 (D4 / AC5_1) -- the main-process owner of "who serves the
 * Service API right now", and the only place that answer is produced.
 *
 * WHY THIS MODULE EXISTS:
 * D3 step 3 requires that a host which LOSES the runtime claim still "starts
 * normally" -- the desktop app opens its window and registers IPC as usual. That
 * is the right call (the alternatives were audited and rejected in D3), but it
 * leaves the user in front of a fully working Quant Lab whose launch controls are
 * being answered by a DIFFERENT process. D4 settled the UX: the controls stay
 * usable and are LABELLED as served by an external runtime. This module produces
 * the state that label is rendered from.
 *
 * WHAT IT IS *NOT*:
 * It is not a second source of truth. It samples facts from the two existing
 * owners -- `runtime-services.ts` (does THIS process hold the role and on what
 * port) and `runtime-claim.ts` (who does the claim file name, and is that pid
 * alive) -- and hands them to `resolveServiceApiRoleState()` in
 * `@StratCraft/types`, which makes the decision. Adding a rule here that the pure
 * contract does not know would put the "who serves it" decision in two places and
 * is precisely what CLAUDE.md's SURFACE-LAYER PARITY rule forbids; the same
 * reasoning is why the renderer gets the resolved state rather than the raw facts.
 *
 * WHY IT WATCHES INSTEAD OF READING ONCE:
 * The role is NOT a boot-time constant, and treating it as one is the failure
 * this ticket exists to remove in a different guise. Three transitions happen
 * with the app already open:
 *
 *   1. The headless daemon is stopped or crashes -> `external` becomes `none`.
 *      A label still naming a dead pid is a confident falsehood, and the whole
 *      point of D4 is that the user knows who is serving them.
 *   2. A headless daemon is started while the app is up but did not hold the role
 *      -> `none` becomes `external`.
 *   3. The app itself takes the role later (it lost the boot race, the incumbent
 *      exits, and a subsequent `initializeRuntimeServices()` succeeds).
 *
 * Detection is two independent mechanisms, and both are load-bearing:
 *   - `fs.watch` on the discovery directory catches claim CREATE/DELETE within
 *     milliseconds. It is the fast path, and it covers transitions 1 and 2 when
 *     the holder exits gracefully.
 *   - A liveness POLL is still mandatory, because the transition that matters
 *     most produces NO filesystem event at all: a holder killed by SIGKILL or the
 *     OOM reaper leaves its claim file behind, byte-identical, with a dead pid.
 *     Nothing changes on disk, so only re-probing `process.kill(pid, 0)` can
 *     notice. A watcher alone would leave the label permanently wrong after
 *     exactly the crash it most needs to report.
 *
 * Both paths funnel through `refreshRuntimeRole()`, which broadcasts ONLY on a
 * genuine change (`isSameServiceApiRoleState`) so an idle app is silent.
 */

import { watch, type FSWatcher } from 'node:fs';

import {
  isSameServiceApiRoleState,
  resolveServiceApiRoleState,
  type ServiceApiRuntimeRoleState,
} from '@StratCraft/types';

import { SERVICE_API_ROLE_LIVENESS_POLL_MS } from '../../../shared/constants/timing';
import { appLog } from '../../utils/logger';
import { getDiscoveryDir } from './discovery-dir';
import { readRuntimeIncumbent } from './runtime-claim';

/**
 * The in-process half of the facts: does THIS process hold the role, and on what
 * port. Owned by `runtime-services.ts`.
 *
 * INJECTED rather than imported, and that is a dependency direction, not a
 * convenience. `runtime-services.ts` must be able to stop this monitor during
 * shutdown, so a static import here would close a genuine module cycle -- and
 * the lazy `require()` that would paper over it does not resolve a `.ts`
 * specifier under vitest, which means the cycle would be discovered as a
 * shutdown crash rather than as a compile error. Inverting it instead: this
 * module knows nothing about runtime services beyond a getter it is handed, and
 * `runtime-services.ts` keeps the single static import.
 */
export type RuntimeServicesStateReader = () => {
  serviceApiStarted: boolean;
  serviceApiPort?: number;
} | null;

let readServicesState: RuntimeServicesStateReader = () => null;

/** Install the reader. Called once by `runtime-services.ts`, which owns the
 *  state being read. */
export function setRuntimeServicesStateReader(reader: RuntimeServicesStateReader): void {
  readServicesState = reader;
}

/**
 * Resolve the current runtime-role state.
 *
 * Pure-ish: it does the IO (claim read + pid probe + in-process state read) and
 * delegates every DECISION to the shared contract. Exported and side-effect-free
 * so the IPC pull handler, the watcher and a test all get their answer from the
 * identical call rather than three near-copies.
 *
 * `selfClaim` is synthesized from this process's own identity rather than read
 * back from the claim file: when we hold the role we ARE the holder, and reading
 * our own claim off disk to learn our own pid would make the answer depend on a
 * file that could have been tampered with or removed underneath us.
 */
export function resolveRuntimeRole(): ServiceApiRuntimeRoleState {
  const services = readServicesState();
  const selfHolds = services?.serviceApiStarted === true;

  // Only pay for the claim read + pid probe when we are NOT the holder. When we
  // hold the role the in-process listener is strictly stronger evidence than the
  // file (see `resolveServiceApiRoleState`), so the file cannot change the answer.
  const incumbent = selfHolds ? undefined : readRuntimeIncumbent();

  return resolveServiceApiRoleState({
    selfHolds,
    selfPort: services?.serviceApiPort,
    selfClaim: selfHolds
      ? { host: 'electron', pid: process.pid, claimedAtMs: 0 }
      : undefined,
    incumbentClaim: incumbent?.claim,
    incumbentLiveness: incumbent?.liveness,
  });
}

/** How the monitor pushes a changed state out. Injected rather than importing
 *  `sendToRenderer` directly so this module stays testable without Electron and
 *  so a second surface could subscribe without this file learning about it. */
export type RuntimeRoleListener = (state: ServiceApiRuntimeRoleState) => void;

let listener: RuntimeRoleListener | null = null;
let watcher: FSWatcher | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let lastState: ServiceApiRuntimeRoleState | null = null;

/**
 * Re-sample the role and notify the listener if -- and only if -- it changed.
 *
 * Returns the current state either way, so the pull handler can reuse this and
 * keep `lastState` in step with what the renderer was last told. Never throws:
 * it runs on a timer and from a filesystem callback, where an exception would
 * either kill the process or silently stop the monitor. A failure to sample is
 * logged loudly (TICKET_858) and the previous state retained -- retaining a
 * known-good answer beats inventing `none` from a transient read error and
 * flashing a wrong label at the user.
 */
export function refreshRuntimeRole(): ServiceApiRuntimeRoleState {
  let next: ServiceApiRuntimeRoleState;
  try {
    next = resolveRuntimeRole();
  } catch (error) {
    appLog.error(
      `[TICKET_1334] Failed to resolve the Service API runtime role: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
    return lastState ?? { status: 'none' };
  }

  if (lastState && isSameServiceApiRoleState(lastState, next)) return next;

  const previous = lastState;
  lastState = next;
  if (previous) {
    appLog.info(
      `[TICKET_1334] Service API runtime role changed: ${previous.status} -> ` +
      `${next.status}${next.holder ? ` (holder ${next.holder.host} pid=${next.holder.pid})` : ''}`,
    );
  }
  if (listener) {
    try {
      listener(next);
    } catch (error) {
      // A broken listener must not take the monitor down with it.
      appLog.error(
        `[TICKET_1334] Runtime-role listener threw: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return next;
}

/** The state the renderer was last told about, or a freshly sampled one on the
 *  first call. This is what the IPC pull handler answers with, so pull and push
 *  can never disagree. */
export function getRuntimeRole(): ServiceApiRuntimeRoleState {
  return refreshRuntimeRole();
}

/**
 * Start watching for role changes.
 *
 * Idempotent -- a second call replaces the listener and leaves the single
 * watcher/timer pair in place, so a re-registration (e.g. a reloaded renderer)
 * cannot accumulate duplicate timers.
 */
export function startRuntimeRoleMonitor(next: RuntimeRoleListener): void {
  listener = next;
  if (watcher || pollTimer) return;

  // Fast path: claim file created/removed. Watching the DIRECTORY, not the file:
  // the interesting events are the file coming into and going out of existence,
  // and a watch on a path that does not exist yet cannot be established at all.
  try {
    watcher = watch(getDiscoveryDir(), () => { refreshRuntimeRole(); });
    watcher.on('error', (error) => {
      // Non-fatal: the poll below still covers every transition, just more
      // slowly. Logged rather than swallowed so a permanently broken watch is
      // visible instead of silently degrading responsiveness (TICKET_858).
      appLog.warn(
        `[TICKET_1334] Discovery-directory watch failed; runtime-role changes ` +
        `will be detected by liveness polling only: ${error.message}`,
      );
    });
  } catch (error) {
    appLog.warn(
      `[TICKET_1334] Could not watch the discovery directory for runtime-role ` +
      `changes; falling back to liveness polling only: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Mandatory second path: a SIGKILLed holder leaves its claim file untouched,
  // so no filesystem event will ever fire for the one transition the label most
  // needs to report. See the module header.
  pollTimer = setInterval(() => { refreshRuntimeRole(); }, SERVICE_API_ROLE_LIVENESS_POLL_MS);
  // Do not keep the process alive purely to poll a label.
  pollTimer.unref?.();

  refreshRuntimeRole();
}

/** Stop watching. Idempotent, and safe to call on a shutdown path. */
export function stopRuntimeRoleMonitor(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  listener = null;
  lastState = null;
}

/** Test-only reset, matching the `__reset*ForTest` convention already used by
 *  `runtime-services.ts` and `compute-environment.ts`. */
export function __resetRuntimeRoleForTest(): void {
  stopRuntimeRoleMonitor();
}
