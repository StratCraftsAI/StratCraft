/**
 * TICKET_1324 F1 -- the single owner of the sweep launch contract.
 *
 * "Launch a sweep" is ONE business operation. Before this module it was two
 * unrelated implementations that happened to share a name:
 *
 *   Path A  `scripts/sweeps/run-catboost-chain.sh` -- cgroup fence (refuses to
 *           run unfenced), pre-arm admission gate, stage/arm resume markers,
 *           survives app exit. No programmatic session id, no Electron.
 *   Path B  Electron `startSweepAdmitted` -- in-process singleton
 *           `DiscoveryOrchestrator`, `getIsRunning()` mutex, in-memory event
 *           stream, sessionId. NO cgroup fence. Dies with Electron.
 *
 * Neither was a superset (TICKET_1324 sec.2.1). Which safety properties a
 * sweep got was decided by *how it was started*, not by what it was -- the
 * surface-layer rule inverted (CLAUDE.md / TICKET_1306).
 *
 * This module owns the surface-agnostic decisions so both paths reach the
 * same answer for the same inputs (TICKET_1329 UAC1):
 *
 *   - config normalization  -- one canonical shape; the snake_case/camelCase
 *                              split becomes an adapter concern, not a second
 *                              contract (`normalizeSweepLaunchRequest`)
 *   - resource policy       -- delegates to `resolveTrainingBarBudget`; this
 *                              module keeps NO budget literal of its own
 *   - asset preflight       -- the spec of what must exist, as data; the IO
 *                              stays with the caller (`buildPreflightSpec`)
 *   - the launch decision   -- admit / refuse, against the cross-path
 *                              registry (`decideSweepLaunch`)
 *
 * WHY `@StratCraft/types` AND NOT A NEW `packages/sweep-launch`:
 * TICKET_1329 sec.5.5 records the P1 lesson -- both P1 fixes had to land here
 * because it is the only package the plugin tier, the Electron main process,
 * and the MCP standalone server all already import. A new package would have
 * had to re-earn that property, and a launch decision that cannot be imported
 * by all three surfaces re-diverges the moment a third surface needs it. The
 * ticket named `packages/sweep-launch` as a location; the requirement it was
 * expressing is single-ownership-reachable-by-every-surface, which this file
 * satisfies. Nothing here may import from `apps/desktop` (PLUGIN_TICKET_009
 * tier rules) -- that is what keeps the property true.
 *
 * PURITY CONTRACT: every function here is pure. No `fs`, no `child_process`,
 * no `process.env`. Preflight and the registry are expressed as *specs* and
 * *decisions* over caller-sampled facts, exactly like the C++-owned resource
 * governance boundary (`resource-governance-runner.ts`: "the IO stays in the
 * caller"). That is what lets the identical decision run in the Electron main
 * process, in the MCP server, and -- via a thin JSON bridge -- in bash.
 */

import {
  resolveTrainingBarBudget,
  TRAINING_BAR_WORKLOAD_DEFAULT,
  isTrainingBarWorkload,
  validateTrainingBarOverride,
  type TrainingBarWorkload,
} from './training-bar-budget';

// =============================================================================
// Launcher identity
// =============================================================================

/**
 * Which implementation is holding / requesting the sweep.
 *
 * Named rather than boolean because the registry's whole purpose is that a
 * refusal can *name* the incumbent (AC2). A third launcher extends this union
 * instead of inverting a flag.
 */
export const SWEEP_LAUNCHERS = ['cli-chain', 'orchestrator'] as const;
export type SweepLauncher = (typeof SWEEP_LAUNCHERS)[number];

/** Human-facing label for a launcher, used in refusal messages. */
export const SWEEP_LAUNCHER_LABELS: Readonly<Record<SweepLauncher, string>> = {
  'cli-chain': 'CLI chain (run-catboost-chain.sh)',
  orchestrator: 'desktop orchestrator',
} as const;

export function isSweepLauncher(v: unknown): v is SweepLauncher {
  return typeof v === 'string' && (SWEEP_LAUNCHERS as readonly string[]).includes(v);
}

// =============================================================================
// Canonical launch request
// =============================================================================

/**
 * The canonical, surface-agnostic sweep launch request.
 *
 * This is the shape both paths agree on. Wire formats (MCP snake_case, IPC
 * camelCase, bash env vars) normalize INTO this; nothing downstream of
 * `normalizeSweepLaunchRequest` may read a wire field directly.
 */
export interface SweepLaunchRequest {
  /** Which surface is launching. Decides nothing about policy -- only identity
   *  and transport-inherent capabilities (session id, survives-app-exit). */
  readonly launcher: SweepLauncher;
  /** Bar interval, e.g. '5m'. Drives the batch training-bar table. */
  readonly timeframe?: string;
  /** Template under sweep, e.g. 'catboost_return_v2'. */
  readonly templateId?: string;
  /** Dispatch workload -- selects the training-bar bounds (TICKET_1326 F2). */
  readonly trainingWorkload: TrainingBarWorkload;
  /** Caller-supplied training-bar override; absent means "resolve the default". */
  readonly lookbackBars?: number;
  /** Resolved training-bar budget for `(timeframe, trainingWorkload)`. */
  readonly resolvedBars: number;
  /** True when `timeframe` was absent/unknown and the batch fallback applied.
   *  Surfaced so an agent can state the basis of the number it reports. */
  readonly usedBudgetFallback: boolean;
}

/** A rejected normalization -- the reason is caller-facing (TICKET_858). */
export interface SweepLaunchRequestError {
  readonly ok: false;
  readonly error: string;
}

export interface SweepLaunchRequestOk {
  readonly ok: true;
  readonly request: SweepLaunchRequest;
}

export type SweepLaunchRequestResult = SweepLaunchRequestOk | SweepLaunchRequestError;

/** Wire input: either MCP snake_case or IPC camelCase. Adapters pass their raw
 *  object; this function owns the mapping so neither surface re-derives it. */
export interface SweepLaunchWireInput {
  readonly launcher?: unknown;
  readonly timeframe?: unknown;
  readonly template_id?: unknown;
  readonly templateId?: unknown;
  readonly training_workload?: unknown;
  readonly trainingWorkload?: unknown;
  readonly lookback_bars?: unknown;
  readonly lookbackBars?: unknown;
}

function firstDefined(...values: readonly unknown[]): unknown {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function optionalTrimmedString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * TICKET_1324 F1 -- normalize any surface's wire input into the canonical
 * request, resolving the training-bar budget in the process.
 *
 * The budget resolution happens HERE, after `timeframe` and `trainingWorkload`
 * are both known, because that is the only point at which a correct default
 * exists. TICKET_1326's live defect was a call site substituting a literal
 * before that point (`signal-discovery-api.ts:56`, a `1000` that exceeded the
 * then-uniform 500 ceiling and so rejected every `start_sweep` that omitted
 * `lookback_bars`). Delegating to `resolveTrainingBarBudget` and keeping no
 * literal here is what stops that class of defect recurring (UAC4).
 */
export function normalizeSweepLaunchRequest(
  input: SweepLaunchWireInput,
): SweepLaunchRequestResult {
  const launcherRaw = input.launcher;
  if (!isSweepLauncher(launcherRaw)) {
    return {
      ok: false,
      error:
        `Unknown sweep launcher ${JSON.stringify(launcherRaw)}. ` +
        `Expected one of: ${SWEEP_LAUNCHERS.join(', ')}.`,
    };
  }

  const timeframe = optionalTrimmedString(input.timeframe);
  const templateId = optionalTrimmedString(firstDefined(input.templateId, input.template_id));

  // Fail-closed on an unrecognised workload rather than silently widening to
  // the batch ceiling (TICKET_856). An absent workload defaults to the
  // narrower `preview`, matching the validator.
  const workloadRaw = firstDefined(input.trainingWorkload, input.training_workload);
  let trainingWorkload: TrainingBarWorkload;
  if (workloadRaw === undefined) {
    trainingWorkload = TRAINING_BAR_WORKLOAD_DEFAULT;
  } else if (isTrainingBarWorkload(workloadRaw)) {
    trainingWorkload = workloadRaw;
  } else {
    return {
      ok: false,
      error:
        `Unknown training workload ${JSON.stringify(workloadRaw)}. ` +
        `Expected 'preview' or 'batch'.`,
    };
  }

  const budget = resolveTrainingBarBudget({ timeframe, workload: trainingWorkload });

  const overrideRaw = firstDefined(input.lookbackBars, input.lookback_bars);
  let resolvedBars: number = budget.bars;
  let lookbackBars: number | undefined;
  if (overrideRaw !== undefined) {
    const outOfRange = validateTrainingBarOverride(overrideRaw, trainingWorkload);
    if (outOfRange) {
      return {
        ok: false,
        error:
          `Lookback bars must be an integer between ${outOfRange.min} and ${outOfRange.max} ` +
          `for the '${trainingWorkload}' workload.`,
      };
    }
    lookbackBars = Number(overrideRaw);
    resolvedBars = lookbackBars;
  }

  return {
    ok: true,
    request: {
      launcher: launcherRaw,
      timeframe,
      templateId,
      trainingWorkload,
      lookbackBars,
      resolvedBars,
      usedBudgetFallback: overrideRaw === undefined && budget.usedFallback,
    },
  };
}

// =============================================================================
// F2 -- the cross-path run registry
// =============================================================================

/**
 * One active-sweep claim.
 *
 * TICKET_1324 F2 replaces two mutually invisible guards -- Path B's in-process
 * boolean (`orchestrator.getIsRunning()`) and Path A's systemd unit-name
 * uniqueness -- with this single on-disk record. Neither old guard was
 * observable to the other, so two sweeps could run concurrently each sized as
 * though alone; TICKET_1071 records the cost of violating sweep memory
 * assumptions (39GB, machine-wide OOM).
 *
 * `pid` and `unit` are both optional but AT LEAST ONE must be present, because
 * they are the liveness evidence: without one, a crashed holder's claim could
 * never be distinguished from a live one and would wedge every future launch.
 * `isSweepClaimStale` is the reaper.
 */
export interface SweepRunClaim {
  /** Which implementation holds the claim. */
  readonly launcher: SweepLauncher;
  /** OS pid of the holder, when the launcher is process-shaped (Path B). */
  readonly pid?: number;
  /** systemd unit name, when the launcher is unit-shaped (Path A). */
  readonly unit?: string;
  /** Bar interval under sweep -- named in the refusal so the operator knows
   *  what is running without consulting another surface (AC2). */
  readonly timeframe?: string;
  /** Template under sweep -- likewise named in the refusal (AC2). */
  readonly templateId?: string;
  /** Estimated peak RSS in MB, so admission can reason about the incumbent
   *  rather than assuming it is alone. */
  readonly estimatedPeakMB?: number;
  /** Claim time, epoch ms. Written by the claimant; read only for reporting. */
  readonly claimedAtMs: number;
}

/** Liveness facts the caller sampled about a claim's holder. The registry
 *  decides; the caller does the IO (purity contract). */
export interface SweepClaimLiveness {
  /** Is `claim.pid` still a live process? `undefined` when not checked
   *  (e.g. the claim is unit-shaped, so pid liveness is not the evidence). */
  readonly pidAlive?: boolean;
  /** Is `claim.unit` still an active systemd unit? `undefined` when not
   *  checked. */
  readonly unitActive?: boolean;
}

/**
 * Is this claim stale (holder gone) and therefore reapable?
 *
 * FAIL-CLOSED: unknown liveness is treated as ALIVE, so a claim is never
 * reaped on the strength of a failed probe. Wrongly reaping a live claim
 * re-creates exactly the concurrent-unfenced-sweep hazard this ticket exists
 * to close, whereas wrongly retaining a dead claim produces a loud, explicit
 * refusal naming the holder -- which an operator can resolve. The asymmetric
 * cost dictates the direction (TICKET_856: fallbacks preserve safety).
 */
export function isSweepClaimStale(
  claim: SweepRunClaim,
  liveness: SweepClaimLiveness,
): boolean {
  const evidence: boolean[] = [];
  if (claim.pid !== undefined && liveness.pidAlive !== undefined) {
    evidence.push(liveness.pidAlive);
  }
  if (claim.unit !== undefined && liveness.unitActive !== undefined) {
    evidence.push(liveness.unitActive);
  }
  // No usable evidence -> assume alive (fail-closed).
  if (evidence.length === 0) return false;
  // Any live evidence keeps the claim.
  return !evidence.some((alive) => alive);
}

/** Describe a claim for a refusal message: names launcher, timeframe, template
 *  and the liveness handle, per AC2. */
export function describeSweepClaim(claim: SweepRunClaim): string {
  const parts: string[] = [SWEEP_LAUNCHER_LABELS[claim.launcher]];
  if (claim.templateId) parts.push(`template=${claim.templateId}`);
  if (claim.timeframe) parts.push(`timeframe=${claim.timeframe}`);
  if (claim.unit) parts.push(`unit=${claim.unit}`);
  else if (claim.pid !== undefined) parts.push(`pid=${claim.pid}`);
  return parts.join(', ');
}

// =============================================================================
// F5 -- executable preflight spec
// =============================================================================

/** One thing that must hold before a sweep may launch. */
export interface PreflightRequirement {
  /** Stable id, so a failure names the specific item (AC5). */
  readonly id: string;
  /** What kind of check this is -- decides which IO the caller performs. */
  readonly kind: 'file' | 'python-import' | 'writable-dir';
  /** The subject: an absolute path, or a python module name. */
  readonly subject: string;
  /** Why it is required, surfaced in the failure message. */
  readonly reason: string;
}

/**
 * TICKET_1324 F5 -- the preflight requirements for a sweep launch, as data.
 *
 * Replaces a prose checklist that had ALREADY drifted: it recorded the 8
 * manifest/grid assets as living in `RESEARCH_DIR`, when they are resolved
 * from the script directory and `RESEARCH_DIR` contains none of them
 * (TICKET_1324 sec.6). A checklist that is prose drifts silently and produces
 * a false "assets missing" reading; the same facts as code cannot.
 *
 * The caller supplies the two roots it alone knows (`scriptDir` for assets,
 * `researchDir` for output) and performs the IO. Keeping the paths as inputs
 * rather than constants is deliberate -- hardcoding either would reintroduce
 * the drift this fix removes.
 */
export function buildPreflightSpec(input: {
  /** Directory holding the manifest/grid assets (Path A: `scripts/sweeps`). */
  readonly scriptDir: string;
  /** Research output root; must be writable. */
  readonly researchDir: string;
  /** Timeframes this launch will actually run. */
  readonly timeframes: readonly string[];
  /** Python modules the run imports. */
  readonly pythonModules?: readonly string[];
}): readonly PreflightRequirement[] {
  const requirements: PreflightRequirement[] = [];

  for (const tf of input.timeframes) {
    requirements.push({
      id: `manifest:${tf}`,
      kind: 'file',
      subject: `${input.scriptDir}/manifest_histdata_forex_${tf}.json`,
      reason: `bar manifest for the ${tf} stage`,
    });
    requirements.push({
      id: `grid:${tf}`,
      kind: 'file',
      subject: `${input.scriptDir}/catboost_grid_${tf}.yaml`,
      reason: `grid config for the ${tf} stage`,
    });
  }

  for (const moduleName of input.pythonModules ?? PREFLIGHT_PYTHON_MODULES) {
    requirements.push({
      id: `python:${moduleName}`,
      kind: 'python-import',
      subject: moduleName,
      reason: 'required by the sweep runner',
    });
  }

  requirements.push({
    id: 'research-dir',
    kind: 'writable-dir',
    subject: input.researchDir,
    reason: 'sweep results and resume markers are written here',
  });

  return requirements;
}

/** Python modules every CatBoost sweep run imports. Verified present
 *  2026-07-29 (`catboost 1.2.10`, `optuna 4.9.0`) -- TICKET_1324 sec.6. */
export const PREFLIGHT_PYTHON_MODULES: readonly string[] = ['catboost', 'optuna'] as const;

/** Result of the caller running one requirement's IO. */
export interface PreflightProbe {
  readonly id: string;
  readonly satisfied: boolean;
  /** Optional detail from the probe (e.g. an import error message). */
  readonly detail?: string;
}

/**
 * Evaluate probe results against the spec. Fails fast naming the SPECIFIC
 * missing item (AC5) -- never a generic "preflight failed".
 *
 * An un-probed requirement is a failure, not a pass: a caller that forgot to
 * check something must not thereby be admitted (fail-closed).
 */
export function evaluatePreflight(
  spec: readonly PreflightRequirement[],
  probes: readonly PreflightProbe[],
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  const byId = new Map(probes.map((p) => [p.id, p]));
  const failures: string[] = [];

  for (const requirement of spec) {
    const probe = byId.get(requirement.id);
    if (probe === undefined) {
      failures.push(
        `${requirement.id}: not checked (${requirement.kind} ${requirement.subject})`,
      );
      continue;
    }
    if (!probe.satisfied) {
      const detail = probe.detail ? ` -- ${probe.detail}` : '';
      failures.push(
        `${requirement.id}: ${requirement.subject} (${requirement.reason})${detail}`,
      );
    }
  }

  if (failures.length === 0) return { ok: true };
  return {
    ok: false,
    error:
      `Sweep preflight failed (${failures.length} of ${spec.length} requirements):\n` +
      failures.map((f) => `  - ${f}`).join('\n'),
  };
}

// =============================================================================
// F3 -- the fence requirement
// =============================================================================

/**
 * Fence state the caller sampled about the process that will run sweep work.
 *
 * Path A reads its own cgroup `memory.max` (`cgroup-fence.sh:153-158`); Path B
 * reads the limit it is about to apply to the transient scope it spawns into.
 * Both express the answer here.
 */
export interface SweepFenceState {
  /** Finite `memory.max` in bytes, or `null` when unbounded/unknown. */
  readonly memoryMaxBytes: number | null;
  /** Where the fence comes from, for the refusal message. */
  readonly source: string;
}

/**
 * TICKET_1324 F3 / AC3 -- is this launch fenced?
 *
 * "Fenced" means a FINITE `memory.max`, matching Path A's existing definition
 * verbatim: unbounded ("max") or unreadable/empty counts as UNFENCED
 * (`cgroup-fence.sh:159`). Path B previously had no fence at all, so the
 * TICKET_1283 governance program did not actually cover every sweep launch.
 *
 * Fail-closed: an unknown limit is unfenced. The fence is not optional for one
 * surface.
 */
export function isSweepFenced(state: SweepFenceState | null | undefined): boolean {
  if (!state) return false;
  const limit = state.memoryMaxBytes;
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0;
}

// =============================================================================
// The launch decision
// =============================================================================

/** Everything the decision needs, all caller-sampled. */
export interface SweepLaunchDecisionInput {
  /** The normalized request. */
  readonly request: SweepLaunchRequest;
  /** The incumbent claim, if the registry holds one. */
  readonly incumbent?: { readonly claim: SweepRunClaim; readonly liveness: SweepClaimLiveness };
  /** Fence state for the work this launch will run. */
  readonly fence?: SweepFenceState | null;
  /** Preflight spec + probe results. Omit both to skip (adapters that have
   *  already run preflight upstream), but never omit only one. */
  readonly preflight?: {
    readonly spec: readonly PreflightRequirement[];
    readonly probes: readonly PreflightProbe[];
  };
}

export type SweepLaunchRefusalCode =
  | 'sweep_already_running'
  | 'sweep_unfenced'
  | 'sweep_preflight_failed';

export type SweepLaunchDecision =
  | { readonly admitted: true; readonly request: SweepLaunchRequest; readonly reapedClaim?: SweepRunClaim }
  | { readonly admitted: false; readonly code: SweepLaunchRefusalCode; readonly error: string };

/**
 * TICKET_1324 AC1 -- the sole owner of the launch decision.
 *
 * Both surfaces call this; neither constructs sweep config or resource policy
 * independently. The three refusal reasons are checked in cost order --
 * exclusion first (cheapest and most likely), then the fence, then preflight
 * -- and every refusal carries an explicit, actionable message that names the
 * specific cause (TICKET_857 / TICKET_858).
 */
export function decideSweepLaunch(input: SweepLaunchDecisionInput): SweepLaunchDecision {
  // 1. Cross-path mutual exclusion (AC2). A stale claim is reaped rather than
  //    refused -- otherwise a crashed holder wedges every later launch.
  let reapedClaim: SweepRunClaim | undefined;
  if (input.incumbent) {
    const { claim, liveness } = input.incumbent;
    if (isSweepClaimStale(claim, liveness)) {
      reapedClaim = claim;
    } else {
      return {
        admitted: false,
        code: 'sweep_already_running',
        error:
          `A sweep is already running: ${describeSweepClaim(claim)}. ` +
          `Started by the ${SWEEP_LAUNCHER_LABELS[claim.launcher]}; ` +
          `wait for it to finish or stop it before launching another.`,
      };
    }
  }

  // 2. The fence applies to EVERY launch, whichever surface (AC3).
  if (!isSweepFenced(input.fence)) {
    const where = input.fence?.source ?? 'no fence state supplied';
    return {
      admitted: false,
      code: 'sweep_unfenced',
      error:
        `Refusing to launch an unfenced sweep (${where}). Every sweep must run ` +
        `inside a cgroup with a finite memory.max (TICKET_1283); an unfenced ` +
        `sweep repeats the TICKET_1071 machine-wide OOM.`,
    };
  }

  // 3. Preflight, naming the specific missing item (AC5).
  if (input.preflight) {
    const verdict = evaluatePreflight(input.preflight.spec, input.preflight.probes);
    if (!verdict.ok) {
      return { admitted: false, code: 'sweep_preflight_failed', error: verdict.error };
    }
  }

  return { admitted: true, request: input.request, reapedClaim };
}

// =============================================================================
// F4 -- resume markers
// =============================================================================

/**
 * TICKET_1324 F4 -- stage marker identity, shared by both paths.
 *
 * Path A already had stage/arm resume markers (`scripts/research/job-state.sh`,
 * `stages.jsonl`); Path B had none, so an orchestrator sweep that crashed
 * restarted from zero. The marker KEY derivation moves here so both paths
 * write and read the same keys against the same file -- which is what makes a
 * chain started on one path resumable from the other (AC4).
 *
 * The record shape is fixed by the existing on-disk format
 * (`{"stage":"<key>","status":"done","ts":"<iso>"}`) and its grep-prefix
 * reader (`job-state.sh:69`). Both are preserved verbatim: this is a
 * second reader/writer of an existing format, not a migration.
 */
export const SWEEP_JOB_NAME = 'catboost-sweep' as const;

/** Marker key for a grid stage. Mirrors `grid_<tf>` in run-catboost-chain.sh. */
export function gridStageKey(timeframe: string): string {
  return `grid_${timeframe}`;
}

/** Marker key for a Bayesian stage. Mirrors `bayesian_<tf>`. */
export function bayesianStageKey(timeframe: string): string {
  return `bayesian_${timeframe}`;
}

/** The terminal marker written by `job_complete`. */
export const CHAIN_DONE_STAGE_KEY = 'chain_done' as const;

/** Relative path of the marker file for a job, under the research dir.
 *  Mirrors `_job_state_file` (`job-state.sh:41-44`). */
export function stageMarkerRelativePath(jobName: string): string {
  return `job-state/${jobName}/stages.jsonl`;
}

/** Serialize one done-marker line in the established on-disk format. The
 *  reader is a fixed-string grep on `{"stage":"<key>","status":"done",` so
 *  field ORDER is load-bearing -- do not reorder. */
export function formatStageMarker(stageKey: string, isoTimestamp: string): string {
  return `{"stage":"${stageKey}","status":"done","ts":"${isoTimestamp}"}`;
}

/** The exact prefix `job-state.sh:69` greps for. Exported so a test can pin
 *  the writer against the bash reader (the P1 lesson: a parity test must
 *  compare against the REAL other side, not a restatement of it). */
export function stageMarkerGrepPrefix(stageKey: string): string {
  return `{"stage":"${stageKey}","status":"done",`;
}

/** Is this stage recorded done in the marker file's contents? Mirrors the bash
 *  reader's semantics exactly. */
export function isStageDone(markerFileContents: string, stageKey: string): boolean {
  return markerFileContents.includes(stageMarkerGrepPrefix(stageKey));
}

// =============================================================================
// TICKET_1325 -- the timeframe selection contract
// =============================================================================

/**
 * The timeframes the CatBoost chain can run, in the order a full run runs them.
 *
 * WHY THIS IS HERE and not in the chain script: the CatBoost chain script had
 * `TIMEFRAMES=(5m 15m 30m 1h)` as a literal with no argv, no getopts and no env
 * override, so "run the CatBoost sweep for 5m" was inexpressible through the
 * supported interface -- and the workaround that actually happened was
 * hand-editing a governance-critical tracked file per run (TICKET_1325 sec.2).
 * Making the list an input needs a whitelist, and the whitelist is a launch
 * contract: TICKET_1325 F4 requires the shared launch module to adopt the
 * selection shape as-is rather than the chain growing a second config surface.
 *
 * The membership is pinned to the per-timeframe assets that exist in
 * `scripts/sweeps/` (`catboost_grid_<tf>.yaml` +
 * `manifest_histdata_forex_<tf>.json`); `buildPreflightSpec` then proves each
 * selected one is actually present before any compute (F3). Adding a timeframe
 * here without adding both assets fails preflight, loudly -- which is the
 * intended direction.
 *
 * ORDER IS LOAD-BEARING (AC2): an omitted selection must run exactly
 * `5m 15m 30m 1h`, byte-identical to the pre-fix behavior.
 */
export const CHAIN_TIMEFRAMES = ['5m', '15m', '30m', '1h'] as const;
export type ChainTimeframe = (typeof CHAIN_TIMEFRAMES)[number];

export function isChainTimeframe(v: unknown): v is ChainTimeframe {
  return typeof v === 'string' && (CHAIN_TIMEFRAMES as readonly string[]).includes(v);
}

/**
 * Where the effective selection came from.
 *
 * Reported in the launch log (F5 / AC7) so `journalctl` distinguishes "the
 * operator asked for 5m" from "the operator asked for nothing and got the
 * default four" -- otherwise a 1-timeframe log line is indistinguishable from a
 * 4-timeframe run that died after its first stage.
 */
export type ChainTimeframeSource = 'default' | 'explicit';

export interface ChainTimeframeSelectionOk {
  readonly ok: true;
  /** The resolved list, deduplicated and in canonical order. */
  readonly timeframes: readonly ChainTimeframe[];
  readonly source: ChainTimeframeSource;
}

export interface ChainTimeframeSelectionError {
  readonly ok: false;
  /** Caller-facing, names the offending value AND the accepted set (AC3). */
  readonly error: string;
}

export type ChainTimeframeSelectionResult =
  | ChainTimeframeSelectionOk
  | ChainTimeframeSelectionError;

/**
 * TICKET_1325 F1+F2 -- resolve an operator timeframe selection.
 *
 * Accepts the selection as raw tokens (positional args, or a whitespace/comma
 * separated `CHAIN_TIMEFRAMES` env value already split by the caller). An empty
 * selection is not an error -- it is the default (AC2).
 *
 * FAIL-FAST, NOT FILTER (F2): an unrecognised token is refused naming the value
 * and the accepted set. Silently dropping it would produce a run that looks
 * successful while having swept nothing the operator asked for -- and with a
 * single-token typo, a no-op chain that still writes `chain_done`.
 *
 * Duplicates collapse to canonical order rather than running a timeframe twice:
 * the stage keys are per-timeframe (`grid_<tf>`), so a repeated timeframe's
 * second pass would skip as already-done anyway, making the repeat a silent
 * no-op. Normalizing is the honest reading of the intent.
 */
export function resolveChainTimeframes(
  selection: readonly unknown[] | undefined,
): ChainTimeframeSelectionResult {
  const tokens = (selection ?? [])
    .map((t) => (typeof t === 'string' ? t.trim() : t))
    .filter((t) => t !== '' && t !== undefined && t !== null);

  if (tokens.length === 0) {
    return { ok: true, timeframes: CHAIN_TIMEFRAMES, source: 'default' };
  }

  const rejected = tokens.filter((t) => !isChainTimeframe(t));
  if (rejected.length > 0) {
    return {
      ok: false,
      error:
        `Unknown timeframe(s) ${rejected.map((t) => JSON.stringify(t)).join(', ')}. ` +
        `Accepted: ${CHAIN_TIMEFRAMES.join(', ')}.`,
    };
  }

  const selected = tokens as readonly ChainTimeframe[];
  // Canonical order, deduplicated. Filtering the whitelist (rather than
  // ordering the input) is what guarantees AC2's ordering for any subset.
  const timeframes = CHAIN_TIMEFRAMES.filter((tf) => selected.includes(tf));
  return { ok: true, timeframes, source: 'explicit' };
}

/** TICKET_1325 F5 -- the log line for an effective selection. Both surfaces
 *  emit the same sentence so a log is readable regardless of launcher. */
export function describeChainTimeframeSelection(
  resolved: ChainTimeframeSelectionOk,
): string {
  const origin =
    resolved.source === 'default'
      ? `default (all ${CHAIN_TIMEFRAMES.length})`
      : 'explicit selection';
  return `Timeframes: ${resolved.timeframes.join(' ')} [${origin}]`;
}
