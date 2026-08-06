/**
 * TICKET_1334 P0 -- the single owner of the Service API runtime-role contract.
 *
 * WHAT THE ROLE IS:
 * The Service API (`http-server.ts`) is the ONE transport both surfaces reach
 * the shared sweep/discovery operation through. Its liveness is advertised
 * out-of-band by two discovery files (`api-port`, `api-token`) that any MCP
 * client reads to find it. Those files name a single `host:port` -- so if two
 * hosts (the Electron desktop app and the headless `serve` runtime) both start a
 * server, the second silently overwrites the first's files and every MCP client
 * is pointed at whichever process wrote last. TICKET_1334 D3 audited every other
 * piece of state the two hosts share (SQLite is WAL multi-process by design, the
 * sweep launch already has the TICKET_1324 O_EXCL claim, memory has the
 * TICKET_1283 fence, training parquet is read-only) and found this to be the
 * only genuine conflict. So exactly ONE thing needs mutual exclusion: which
 * process holds the Service API runtime role.
 *
 * WHY NOT A PROCESS-LEVEL MUTEX:
 * D3 rejected "if both hosts are up, disable one". Path A (headless/CLI) and
 * Path B (Electron) coexistence is deliberate existing architecture --
 * `sweep-run-registry.ts` exists precisely because `systemd-run --user
 * --unit=catboost-sweep` has always been allowed to run alongside the desktop
 * app. A process mutex would overturn that, kill the working
 * use-the-app-while-a-sweep-runs pattern, and be refuse-as-feature-shape
 * (TICKET_860): a product limitation papering over a missing ownership concept.
 * Mutexing the ROLE instead makes the discovery files an ARTIFACT of the role
 * holder rather than an object of contention, which removes the entire
 * last-writer-wins failure class.
 *
 * WHY THIS FILE IS IN `@StratCraft/types`:
 * Same reason `sweep-launch.ts` is (TICKET_1329 sec.5.5): it is the only package
 * the plugin tier, the Electron main process, and the MCP standalone server all
 * already import. The record shape must validate identically in every host and
 * in any future surface that wants to report "who serves the API"; a shape only
 * one host can parse re-diverges the moment a third surface needs it.
 *
 * PURITY CONTRACT (inherited from `sweep-launch.ts`): every function here is
 * pure. No `fs`, no `process`. Liveness is a caller-sampled FACT passed in --
 * the filesystem and `process.kill` probing live in the Electron-side adapter
 * `main/services/api/runtime-claim.ts`, mirroring how `sweep-run-registry.ts`
 * adapts `sweep-launch.ts`. That split is what lets the identical decision be
 * reached by both hosts over the same file.
 */

// =============================================================================
// Host identity
// =============================================================================

/**
 * Which host process is holding / requesting the Service API runtime role.
 *
 * Named rather than boolean because the refusal must be able to NAME the
 * incumbent (TICKET_1334 D3 step 3: "log naming the holder"). A third host
 * extends this union instead of inverting a flag -- exactly the reasoning
 * `SWEEP_LAUNCHERS` records.
 */
export const SERVICE_API_HOSTS = ['electron', 'headless'] as const;
export type ServiceApiHost = (typeof SERVICE_API_HOSTS)[number];

/** Human-facing label for a host, used in refusal / status messages. */
export const SERVICE_API_HOST_LABELS: Readonly<Record<ServiceApiHost, string>> = {
  electron: 'Electron desktop app',
  headless: 'headless serve runtime',
} as const;

export function isServiceApiHost(v: unknown): v is ServiceApiHost {
  return typeof v === 'string' && (SERVICE_API_HOSTS as readonly string[]).includes(v);
}

// =============================================================================
// The claim record
// =============================================================================

/**
 * One Service API runtime-role claim, as persisted in `api-runtime.lock`.
 *
 * `pid` is MANDATORY here, unlike `SweepRunClaim.pid`. That difference is
 * deliberate and not an inconsistency: a sweep can be held by a systemd unit
 * whose pid the claimant does not know, so that record accepts either handle.
 * The Service API role, by contrast, is always held by the very process writing
 * the claim -- it has its own pid, always. Making it optional would admit a
 * claim with NO liveness evidence, which could never be distinguished from a
 * live holder and would permanently brick every future start after one
 * SIGKILL -- the exact wedge `sweep-run-registry.ts:99-103` guards against.
 */
export interface ServiceApiRuntimeClaim {
  /** Which host holds the role. */
  readonly host: ServiceApiHost;
  /** OS pid of the holder. The liveness evidence -- see above. */
  readonly pid: number;
  /** Claim time, epoch ms. Written by the claimant; read only for reporting. */
  readonly claimedAtMs: number;
}

/** Liveness facts the caller sampled about a claim's holder. The contract
 *  decides; the caller does the IO (purity contract). */
export interface ServiceApiClaimLiveness {
  /** Is `claim.pid` still a live process? `undefined` when not probed. */
  readonly pidAlive?: boolean;
}

/**
 * Is this claim stale (holder gone) and therefore reapable?
 *
 * FAIL-CLOSED, for the same asymmetric-cost reason as `isSweepClaimStale`:
 * unknown liveness counts as ALIVE, so a claim is never reaped on the strength
 * of a failed probe. Wrongly reaping a LIVE claim yields two API servers and
 * restores the last-writer-wins discovery-file defect this contract exists to
 * remove; wrongly retaining a DEAD claim yields a loud refusal naming the
 * holder, which an operator can resolve. Retain-on-doubt is the cheap error.
 */
export function isServiceApiClaimStale(
  claim: ServiceApiRuntimeClaim,
  liveness: ServiceApiClaimLiveness,
): boolean {
  if (liveness.pidAlive === undefined) return false;
  return !liveness.pidAlive;
}

/** Describe a claim for a refusal / status message. Names the host and the pid,
 *  per TICKET_1334 D3 ("Service API already served by <host> pid=<pid>"). */
export function describeServiceApiClaim(claim: ServiceApiRuntimeClaim): string {
  return `${SERVICE_API_HOST_LABELS[claim.host]} pid=${claim.pid}`;
}

/**
 * Parse + validate raw claim-file contents.
 *
 * Returns null when the text is not a well-formed claim. The IO adapter treats
 * null as ABSENT rather than as a live incumbent, matching
 * `readSweepClaim`/`acquireSweepClaim`: a claim that names no valid holder
 * provides no exclusion guarantee, so keeping it protects nothing while wedging
 * every future start (TICKET_857 -- clear the bad state, loudly, rather than
 * deadlocking on it).
 *
 * Pure, and exported, so the same validation runs in every host and is directly
 * testable without touching a filesystem.
 */
export function parseServiceApiRuntimeClaim(raw: string): ServiceApiRuntimeClaim | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (!isServiceApiHost(row.host)) return null;
  // pid is mandatory -- it is the only liveness evidence (see the interface).
  // A non-positive pid is rejected too: `process.kill(0, 0)` addresses the
  // caller's own process group, so a 0 pid would probe as spuriously ALIVE.
  if (typeof row.pid !== 'number' || !Number.isInteger(row.pid) || row.pid <= 0) return null;
  const claimedAtMs =
    typeof row.claimedAtMs === 'number' && Number.isFinite(row.claimedAtMs) ? row.claimedAtMs : 0;
  return { host: row.host, pid: row.pid, claimedAtMs };
}

/** Serialize a claim for the claim file. Owned here so both hosts (and the
 *  parser above) agree on one encoding. */
export function formatServiceApiRuntimeClaim(claim: ServiceApiRuntimeClaim): string {
  return `${JSON.stringify(claim, null, 2)}\n`;
}

// =============================================================================
// Runtime-role STATE -- what a surface needs to know (TICKET_1334 P4 / D4)
// =============================================================================

/**
 * TICKET_1334 P4 / D4 / AC5_1.
 *
 * D3 step 3 says a host that loses the claim "starts normally" -- the desktop app
 * still opens its window and registers IPC. That leaves a real cognitive gap: the
 * Quant Lab launch controls still work (they reach the shared operation through
 * the Service API, whichever process hosts it), but the user has no way to know
 * that the runtime answering them is a DIFFERENT process from the one whose
 * window they are looking at. D4 settled that as: keep the controls usable, and
 * LABEL them as served by an external runtime.
 *
 * D4 explicitly rejected the two alternatives, and this type is shaped by that
 * rejection:
 *   (a) silently operating the other process -- the cognitive-gap trap. Ruled out,
 *       so the state must carry enough to NAME the holder (host + pid), not just a
 *       boolean.
 *   (c) disabling the entries -- removes capability the user still has. Ruled out,
 *       so this type deliberately carries NO "disabled"/"available" flag. There is
 *       nothing here a surface could read as permission to gate a control, because
 *       the capability is present in every state below.
 *
 * WHY THE STATE LIVES IN `@StratCraft/types` AND NOT IN THE RENDERER:
 * CLAUDE.md's SURFACE-LAYER PARITY rule. "Who serves the Service API" is a domain
 * decision about runtime ownership, not a view concern. If the renderer derived it
 * -- e.g. by treating "the port file exists" or "my start call returned false" as
 * proxies -- then Electron and the Guide WebUI would each hold their own version
 * of the rule and would drift the first time the claim contract changed. The
 * decision is made ONCE here from facts the host samples, and every surface
 * renders the answer.
 */

/**
 * Who serves the Service API, from the point of view of the asking process.
 *
 *   - `holder`   -- THIS process holds the role and is listening. No labelling.
 *   - `external` -- another LIVE runtime holds it. Controls stay usable and are
 *                   labelled with the holder (D4).
 *   - `none`     -- nobody holds it. Distinct from `external` on purpose: it is
 *                   the honest answer after an incumbent dies, and conflating it
 *                   with `external` would keep a label pointing at a dead process
 *                   (TICKET_858 -- a stale claim about who is serving is a silent
 *                   failure of exactly the kind this label exists to prevent).
 */
export const SERVICE_API_ROLE_STATUSES = ['holder', 'external', 'none'] as const;
export type ServiceApiRoleStatus = (typeof SERVICE_API_ROLE_STATUSES)[number];

/** The renderer-facing runtime-role state. Serialized verbatim over IPC and held
 *  verbatim by the view store (TICKET_367 Layer 2). */
export interface ServiceApiRuntimeRoleState {
  readonly status: ServiceApiRoleStatus;
  /**
   * The holder, when one is known. Present for `holder` AND for `external` --
   * the asking process is itself a holder worth naming, and a surface that wants
   * to render "served by this app" gets the same shape as "served by <other>".
   * `undefined` only for `none`.
   */
  readonly holder?: ServiceApiRuntimeClaim;
  /** Bound port, present only when THIS process is the holder and listening. */
  readonly port?: number;
}

/**
 * The facts a host samples in order to answer "who serves the Service API?".
 *
 * Purity contract (inherited from the top of this file): the caller does every
 * bit of IO -- reading the claim file, probing the pid, asking its own runtime
 * services whether they are listening -- and the decision below is a pure
 * function of those facts. That is what makes the resolution identically
 * testable in every host without a filesystem.
 */
export interface ServiceApiRoleFacts {
  /** Does the ASKING process hold the role and have a live listener? */
  readonly selfHolds: boolean;
  /** Port the asking process is listening on, when `selfHolds`. */
  readonly selfPort?: number;
  /** The asking process's own claim, when `selfHolds`. */
  readonly selfClaim?: ServiceApiRuntimeClaim;
  /** The claim currently recorded on disk, if any and if parseable. */
  readonly incumbentClaim?: ServiceApiRuntimeClaim;
  /** Sampled liveness of `incumbentClaim`. */
  readonly incumbentLiveness?: ServiceApiClaimLiveness;
}

/**
 * Decide the runtime-role state from sampled facts.
 *
 * ORDER OF PRECEDENCE, and why:
 *
 * 1. `selfHolds` wins outright. It is a fact about a live in-process listener --
 *    strictly stronger evidence than anything read from a file, which could be
 *    mid-write or left by a predecessor. It also means the common case never
 *    depends on the filesystem at all.
 *
 * 2. Otherwise a recorded incumbent counts only if it is NOT stale, reusing
 *    `isServiceApiClaimStale` rather than re-deriving liveness. That reuse is the
 *    point: the rule that decides whether to REAP a claim and the rule that
 *    decides whether to LABEL a surface must be the same rule, or the app will
 *    label a runtime it has already reaped (TICKET_854).
 *
 * 3. A stale incumbent resolves to `none`, not `external`. The holder is gone; a
 *    label naming it would be a confident falsehood, which is worse than no
 *    label.
 */
export function resolveServiceApiRoleState(
  facts: ServiceApiRoleFacts,
): ServiceApiRuntimeRoleState {
  if (facts.selfHolds) {
    return { status: 'holder', holder: facts.selfClaim, port: facts.selfPort };
  }
  const incumbent = facts.incumbentClaim;
  if (incumbent && !isServiceApiClaimStale(incumbent, facts.incumbentLiveness ?? {})) {
    return { status: 'external', holder: incumbent };
  }
  return { status: 'none' };
}

/**
 * Are two role states the same fact?
 *
 * Exists so a host can broadcast ONLY on genuine change. The role is re-sampled
 * on a timer and on filesystem events, so without this every tick would push an
 * identical payload to the renderer and re-render the label -- noise that also
 * makes a real transition impossible to spot in a log. Compared field-by-field
 * rather than by JSON string because `claimedAtMs` ordering in the serialized
 * form is not something this contract wants to depend on.
 */
export function isSameServiceApiRoleState(
  a: ServiceApiRuntimeRoleState,
  b: ServiceApiRuntimeRoleState,
): boolean {
  if (a.status !== b.status) return false;
  if (a.port !== b.port) return false;
  if (!a.holder || !b.holder) return a.holder === b.holder;
  return (
    a.holder.host === b.holder.host &&
    a.holder.pid === b.holder.pid &&
    a.holder.claimedAtMs === b.holder.claimedAtMs
  );
}
