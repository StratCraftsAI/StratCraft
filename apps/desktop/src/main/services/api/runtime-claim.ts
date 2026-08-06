/**
 * TICKET_1334 P0 -- the Service API runtime-role claim (IO side).
 *
 * The DECISION logic lives in `@StratCraft/types` `service-api-runtime.ts`
 * (`isServiceApiClaimStale`, `describeServiceApiClaim`,
 * `parseServiceApiRuntimeClaim`); this module is only its filesystem and
 * liveness-probe adapter. That split is the same one `sweep-run-registry.ts`
 * uses against `sweep-launch.ts`, and it is what lets the identical exclusion
 * decision be reached by the Electron main process and by the headless `serve`
 * runtime over the SAME file.
 *
 * WHAT IT PROTECTS:
 * `api-port` / `api-token` name a single `host:port`. Two hosts each starting a
 * Service API means the second silently overwrites the first's files and every
 * MCP client is pointed at whichever process wrote last. TICKET_1334 D3 audited
 * all other state the two hosts share and found this the ONLY real conflict --
 * SQLite is WAL multi-process by construction (`db-manager.ts:99`), sweep launch
 * already has the TICKET_1324 O_EXCL claim spanning both paths, memory has the
 * TICKET_1283 fence plus the TICKET_1071 concurrency cap, and training parquet
 * is read-only. So exactly one thing is mutexed: the runtime ROLE.
 *
 * WHY THE ROLE AND NOT THE PROCESS:
 * D3 rejected "if both hosts are up, disable Electron". Path A / Path B
 * coexistence is deliberate existing architecture --
 * `sweep-run-registry.ts:20-33` is built on it, and `systemd-run --user
 * --unit=catboost-sweep` has never been mutually exclusive with the desktop app.
 * A process mutex would overturn that, kill the working
 * use-the-app-while-a-sweep-runs pattern, invert priority in both directions (an
 * 8-hour training runtime killed by a freshly opened window, or the app locked
 * out by a background process), and be refuse-as-feature-shape (TICKET_860).
 * Mutexing the role makes the discovery files an ARTIFACT of the role holder
 * rather than an object of contention, which removes the whole
 * last-writer-wins class.
 *
 * WHERE THE FILE LIVES: next to `api-port` / `api-token`, via the shared
 * `getDiscoveryDir()` (`discovery-dir.ts`). Not re-derived -- a claim resolved
 * from a different root than the files it guards is a mutex that guards nothing.
 *
 * CONCURRENCY: acquisition is an O_EXCL create, atomic on POSIX filesystems, so
 * two simultaneous hosts cannot both win -- the kernel decides, not timing. The
 * loser reads the incumbent and names it in the refusal. Verbatim the primitive
 * proven for this problem class in `sweep-run-registry.ts:165-244`; TICKET_854
 * mandates the reuse and inventing a second locking mechanism would be
 * gratuitous inconsistency (D3).
 *
 * ACCEPTED LIMITATION (D3): `isPidAlive` can misjudge a live incumbent under pid
 * reuse. The repo already accepts this trade-off for the sweep claim; a
 * divergent mechanism for a hypothetical risk would be worse than the
 * inconsistency.
 *
 * WIRING (as of P1, `67e85cee9`): this module is LIVE. The claim gates
 * `listen()` inside `startApiServer()`, which is called from the shared
 * `runtime-services.ts:157` by both hosts -- Electron main (`main/index.ts`
 * Phase 2) and the headless `serve` entry point (`headless/serve.ts`, P2).
 * An earlier revision of this header described the module as UNWIRED; that was
 * true only for the P0 commit that introduced it.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';

import {
  describeServiceApiClaim,
  formatServiceApiRuntimeClaim,
  isServiceApiClaimStale,
  parseServiceApiRuntimeClaim,
  type ServiceApiClaimLiveness,
  type ServiceApiHost,
  type ServiceApiRuntimeClaim,
} from '@StratCraft/types';

// TICKET_854: the liveness probe is IMPORTED from its existing owner, never
// re-implemented. `sweep-run-registry.ts:125` already owns the
// `process.kill(pid, 0)` semantics -- including that EPERM means "alive but not
// ours". Two copies of a liveness predicate is exactly how the reap rule and the
// refusal rule drift apart.
import { isPidAlive } from '../../utils/process-liveness';
import { SERVICE_API_RUNTIME_CLAIM_FILE } from '../../../shared/constants/network';
import { appLog } from '../../utils/logger';
import { getDiscoveryDir } from './discovery-dir';

/**
 * How many acquisition attempts an `acquireRuntimeClaim` call makes.
 *
 * Exactly two, matching `sweep-run-registry.ts:191`: the first attempt, then --
 * if and only if the incumbent proved stale and was reaped -- one retry. Bounded
 * so a pathological reap/reclaim loop between two hosts cannot spin. The single
 * retry is MANDATORY, not an optimisation: without it one SIGKILL/OOM leaves a
 * stale claim that permanently bricks every future start of both hosts (D3
 * step 3).
 */
const CLAIM_ACQUIRE_ATTEMPTS = 2;

/** Absolute path of the claim file. Exported so a test (and, from P4, the
 *  renderer-facing role report) can pin the location against the discovery
 *  directory rather than restating it. */
export function getRuntimeClaimPath(): string {
  return path.join(getDiscoveryDir(), SERVICE_API_RUNTIME_CLAIM_FILE);
}

/**
 * Read and validate the claim file.
 *
 * Returns null when the file is absent, unreadable, or malformed. A malformed
 * claim is treated as ABSENT rather than as a live incumbent -- a corrupt file
 * must not permanently wedge every runtime start -- and is logged loudly
 * (TICKET_858), because it means something wrote a bad claim.
 */
export function readRuntimeClaim(): ServiceApiRuntimeClaim | null {
  const claimPath = getRuntimeClaimPath();
  if (!existsSync(claimPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(claimPath, 'utf-8');
  } catch (error) {
    appLog.error(
      `[TICKET_1334] Failed to read the Service API runtime claim ${claimPath}: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  const parsed = parseServiceApiRuntimeClaim(raw);
  if (!parsed) {
    appLog.error(
      `[TICKET_1334] Malformed Service API runtime claim at ${claimPath}; ` +
      `treating as absent. Contents: ${raw.slice(0, 200)}`,
    );
  }
  return parsed;
}

/** Sample the liveness of a claim's holder. The pure contract decides; this
 *  side does the probe (purity contract). */
export function probeRuntimeClaimLiveness(
  claim: ServiceApiRuntimeClaim,
): ServiceApiClaimLiveness {
  return { pidAlive: isPidAlive(claim.pid) };
}

/**
 * The incumbent claim plus its sampled liveness. Returns undefined when the role
 * is free (or the claim is unusable, which is the same thing for exclusion
 * purposes -- see `readRuntimeClaim`).
 *
 * This is the read-only query a host uses to answer "who serves the Service
 * API?" without attempting to take the role -- e.g. the desktop app labelling
 * its launch controls as served by an external runtime (D4 / AC5_1, wired in
 * P4).
 */
export function readRuntimeIncumbent():
  | { claim: ServiceApiRuntimeClaim; liveness: ServiceApiClaimLiveness }
  | undefined {
  const claim = readRuntimeClaim();
  if (!claim) return undefined;
  return { claim, liveness: probeRuntimeClaimLiveness(claim) };
}

/** Outcome of an acquisition attempt.
 *
 *  `reapedClaim` is reported on success so the caller can log that a dead
 *  holder's claim was cleared. Silently reaping would hide a crash
 *  (TICKET_858): a runtime that keeps taking over from dead predecessors is
 *  information an operator needs. */
export type RuntimeClaimResult =
  | { acquired: true; claim: ServiceApiRuntimeClaim; reapedClaim?: ServiceApiRuntimeClaim }
  | { acquired: false; incumbent: ServiceApiRuntimeClaim; reason: string };

/**
 * Atomically acquire the Service API runtime role.
 *
 * Uses an O_EXCL create so the win is decided by the kernel, not by a
 * read-then-write two hosts could interleave. On EEXIST the incumbent is re-read
 * and, if stale, reaped once and the acquisition retried exactly once.
 *
 * The caller's contract (D3 steps 2-3):
 *   - `acquired: true`  -> proceed to `listen()` and write the discovery files.
 *   - `acquired: false` -> do NOT start a second API server, but START THE REST
 *     OF THE HOST NORMALLY. The desktop app still opens its window and registers
 *     IPC; the refusal is not fatal. `reason` names the holder and is meant to be
 *     logged verbatim.
 *
 * `nowMs` is injected rather than read from `Date.now()` so the recorded claim
 * time is a caller-owned fact, matching `acquireSweepClaim`.
 */
export function acquireRuntimeClaim(input: {
  host: ServiceApiHost;
  pid: number;
  nowMs: number;
}): RuntimeClaimResult {
  const claim: ServiceApiRuntimeClaim = {
    host: input.host,
    pid: input.pid,
    claimedAtMs: input.nowMs,
  };

  let reapedClaim: ServiceApiRuntimeClaim | undefined;

  for (let attempt = 0; attempt < CLAIM_ACQUIRE_ATTEMPTS; attempt += 1) {
    if (tryCreateClaimFile(claim)) {
      appLog.info(
        `[TICKET_1334] Service API runtime role acquired by ` +
        `${describeServiceApiClaim(claim)}`,
      );
      return { acquired: true, claim, reapedClaim };
    }

    // Lost the create race, or a claim already existed. Ask the shared owner
    // whether the incumbent is stale.
    const incumbent = readRuntimeClaim();
    if (!incumbent) {
      // Two very different situations produce a null read, and conflating them
      // is a wedge: the file may have VANISHED (the holder released it between
      // our failed create and this read -- just retry), or it may EXIST but be
      // unparseable. An unparseable claim names no holder, so it can never be
      // validated or reaped and would block every future start of BOTH hosts
      // forever. Remove it and retry: a claim that cannot identify its owner
      // provides no exclusion guarantee, so keeping it protects nothing while
      // costing everything (TICKET_857 -- surface and clear the bad state rather
      // than deadlocking on it). Mirrors `sweep-run-registry.ts:213-221`.
      if (existsSync(getRuntimeClaimPath())) {
        appLog.warn(
          `[TICKET_1334] Discarding an unparseable Service API runtime claim at ` +
          `${getRuntimeClaimPath()} -- it names no holder, so it cannot be ` +
          `validated or reaped and would wedge every runtime start.`,
        );
        releaseRuntimeClaim();
      }
      continue;
    }

    if (!isServiceApiClaimStale(incumbent, probeRuntimeClaimLiveness(incumbent))) {
      const reason =
        `Service API already served by ${describeServiceApiClaim(incumbent)}; ` +
        `not starting a second server. This host continues to start normally.`;
      appLog.info(`[TICKET_1334] ${reason}`);
      return { acquired: false, incumbent, reason };
    }

    appLog.warn(
      `[TICKET_1334] Reaping stale Service API runtime claim held by ` +
      `${describeServiceApiClaim(incumbent)} -- holder is gone (crash/OOM/SIGKILL).`,
    );
    reapedClaim = incumbent;
    releaseRuntimeClaim();
  }

  // The retry also lost: another host won fair and square in between.
  const incumbent = readRuntimeClaim();
  if (incumbent) {
    const reason =
      `Service API already served by ${describeServiceApiClaim(incumbent)}; ` +
      `not starting a second server. This host continues to start normally.`;
    appLog.info(`[TICKET_1334] ${reason}`);
    return { acquired: false, incumbent, reason };
  }
  // Nothing holds the role, yet our creates failed -- surface rather than
  // silently proceeding to write discovery files unguarded (TICKET_857).
  throw new Error(
    `[TICKET_1334] Could not acquire the Service API runtime claim at ` +
    `${getRuntimeClaimPath()} and no incumbent is recorded. Refusing to start ` +
    `an unclaimed Service API server.`,
  );
}

/** O_EXCL create. Returns false on EEXIST; throws on any other IO error so a
 *  permissions problem is not mistaken for contention (TICKET_857). */
function tryCreateClaimFile(claim: ServiceApiRuntimeClaim): boolean {
  const claimPath = getRuntimeClaimPath();
  mkdirSync(path.dirname(claimPath), { recursive: true });
  let fd: number;
  try {
    // 'wx' = O_WRONLY | O_CREAT | O_EXCL -- the kernel decides the winner.
    fd = openSync(claimPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    writeSync(fd, formatServiceApiRuntimeClaim(claim));
    return true;
  } finally {
    closeSync(fd);
  }
}

/**
 * Release the claim.
 *
 * Idempotent -- releasing a claim that is already gone is not an error, so a
 * double-release on an error path cannot throw. Called from `stopApiServer()`
 * alongside the discovery files (AC4, wired in P1), mirroring
 * `releaseSweepClaim()`.
 */
export function releaseRuntimeClaim(): void {
  const claimPath = getRuntimeClaimPath();
  try {
    rmSync(claimPath, { force: true });
  } catch (error) {
    appLog.error(
      `[TICKET_1334] Failed to release the Service API runtime claim ${claimPath}: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
