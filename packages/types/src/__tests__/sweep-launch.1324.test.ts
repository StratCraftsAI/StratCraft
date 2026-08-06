/**
 * TICKET_1324 AC7 -- full-coverage tests for the shared sweep launch contract.
 *
 * Covers every changed decision path in `sweep-launch.ts`, including the
 * cross-path exclusion race (AC2), the fence requirement (AC3), preflight
 * (AC5), and the resume-marker format shared with `job-state.sh` (AC4).
 *
 * One lesson from TICKET_1329 sec.5.5 is applied throughout: a parity test that
 * compares a mirror against a *restatement* of the other side cannot detect
 * drift -- 1327's own test asserted "exactly 3 entries" against a 4-entry table
 * and passed while the mirror had already diverged. So the marker tests here
 * assert against the LITERAL grep prefix `job-state.sh:69` uses, and the
 * single-definition tests use object identity (`toBe`), not `toEqual`.
 */

import { describe, expect, it } from 'vitest';

import {
  bayesianStageKey,
  buildPreflightSpec,
  CHAIN_DONE_STAGE_KEY,
  decideSweepLaunch,
  describeSweepClaim,
  evaluatePreflight,
  formatStageMarker,
  gridStageKey,
  isStageDone,
  isSweepClaimStale,
  isSweepFenced,
  isSweepLauncher,
  normalizeSweepLaunchRequest,
  PREFLIGHT_PYTHON_MODULES,
  stageMarkerGrepPrefix,
  stageMarkerRelativePath,
  SWEEP_JOB_NAME,
  SWEEP_LAUNCHER_LABELS,
  SWEEP_LAUNCHERS,
  type PreflightProbe,
  type SweepFenceState,
  type SweepLaunchRequest,
  type SweepRunClaim,
} from '../sweep-launch';
import {
  resolveTrainingBarBudget,
  TRAINING_BARS_BATCH_DEFAULTS,
  TRAINING_BARS_PREVIEW_DEFAULT,
  TRAINING_BARS_PREVIEW_MAX,
  TRAINING_BARS_BATCH_MAX,
  TRAINING_BARS_MIN,
} from '../training-bar-budget';

const FENCED: SweepFenceState = { memoryMaxBytes: 2 * 1024 ** 3, source: 'test scope' };
const UNFENCED: SweepFenceState = { memoryMaxBytes: null, source: 'no fence' };

function okRequest(overrides: Partial<SweepLaunchRequest> = {}): SweepLaunchRequest {
  const result = normalizeSweepLaunchRequest({
    launcher: 'orchestrator',
    timeframe: '5m',
    template_id: 'catboost_return_v2',
    training_workload: 'batch',
  });
  if (!result.ok) throw new Error(`fixture must normalize: ${result.error}`);
  return { ...result.request, ...overrides };
}

function claim(overrides: Partial<SweepRunClaim> = {}): SweepRunClaim {
  return {
    launcher: 'cli-chain',
    unit: 'catboost-sweep',
    timeframe: '5m',
    templateId: 'catboost_return_v2',
    claimedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Launcher identity
// ---------------------------------------------------------------------------

describe('sweep launcher identity', () => {
  it('accepts exactly the known launchers', () => {
    for (const launcher of SWEEP_LAUNCHERS) {
      expect(isSweepLauncher(launcher)).toBe(true);
    }
  });

  it('rejects unknown / non-string launchers', () => {
    for (const bad of ['CLI-CHAIN', 'cli_chain', '', 'mcp', null, undefined, 7, {}]) {
      expect(isSweepLauncher(bad)).toBe(false);
    }
  });

  it('labels every launcher, so a refusal can always name the incumbent (AC2)', () => {
    for (const launcher of SWEEP_LAUNCHERS) {
      expect(SWEEP_LAUNCHER_LABELS[launcher]).toBeTruthy();
    }
    expect(Object.keys(SWEEP_LAUNCHER_LABELS).sort()).toEqual([...SWEEP_LAUNCHERS].sort());
  });
});

// ---------------------------------------------------------------------------
// Normalization + budget delegation (AC1, UAC4)
// ---------------------------------------------------------------------------

describe('normalizeSweepLaunchRequest', () => {
  it('maps snake_case and camelCase to the same canonical request', () => {
    const snake = normalizeSweepLaunchRequest({
      launcher: 'orchestrator',
      timeframe: '15m',
      template_id: 'catboost_return_v2',
      training_workload: 'batch',
      lookback_bars: 900,
    });
    const camel = normalizeSweepLaunchRequest({
      launcher: 'orchestrator',
      timeframe: '15m',
      templateId: 'catboost_return_v2',
      trainingWorkload: 'batch',
      lookbackBars: 900,
    });
    expect(snake.ok && camel.ok).toBe(true);
    if (!snake.ok || !camel.ok) return;
    expect(snake.request).toEqual(camel.request);
  });

  it('refuses an unknown launcher naming the accepted set', () => {
    const result = normalizeSweepLaunchRequest({ launcher: 'wat' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('cli-chain');
    expect(result.error).toContain('orchestrator');
  });

  it('refuses an unknown training workload rather than widening the ceiling', () => {
    const result = normalizeSweepLaunchRequest({
      launcher: 'cli-chain',
      training_workload: 'enormous',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('preview');
    expect(result.error).toContain('batch');
  });

  it('defaults an absent workload to the narrower preview bound (fail-closed)', () => {
    const result = normalizeSweepLaunchRequest({ launcher: 'cli-chain', timeframe: '5m' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.trainingWorkload).toBe('preview');
    expect(result.request.resolvedBars).toBe(TRAINING_BARS_PREVIEW_DEFAULT);
  });

  it('delegates the budget to resolveTrainingBarBudget -- keeps no literal of its own', () => {
    for (const timeframe of Object.keys(TRAINING_BARS_BATCH_DEFAULTS)) {
      const result = normalizeSweepLaunchRequest({
        launcher: 'cli-chain',
        timeframe,
        training_workload: 'batch',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      // Identity with the shared resolver's answer, not a restatement of the
      // table (TICKET_1329 sec.5.5 lesson 2).
      const expected = resolveTrainingBarBudget({ timeframe, workload: 'batch' });
      expect(result.request.resolvedBars).toBe(expected.bars as unknown as number);
    }
  });

  it('reports usedBudgetFallback for an unknown timeframe on batch', () => {
    const result = normalizeSweepLaunchRequest({
      launcher: 'cli-chain',
      timeframe: '3s',
      training_workload: 'batch',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.usedBudgetFallback).toBe(true);
  });

  it('does not report a fallback when the caller supplied an explicit override', () => {
    const result = normalizeSweepLaunchRequest({
      launcher: 'cli-chain',
      timeframe: '3s',
      training_workload: 'batch',
      lookback_bars: 4242,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.usedBudgetFallback).toBe(false);
    expect(result.request.resolvedBars).toBe(4242);
  });

  it('UAC4: the resolved default is never rejected by the override validator', () => {
    // The regression this program exists to prevent: an advertised default that
    // its own validator refuses (TICKET_1326's `1000` vs a 500 ceiling).
    for (const workload of ['preview', 'batch'] as const) {
      for (const timeframe of [...Object.keys(TRAINING_BARS_BATCH_DEFAULTS), '3s', undefined]) {
        const first = normalizeSweepLaunchRequest({
          launcher: 'cli-chain',
          timeframe,
          training_workload: workload,
        });
        expect(first.ok).toBe(true);
        if (!first.ok) continue;
        // Feed the resolved default back in AS an explicit override.
        const echoed = normalizeSweepLaunchRequest({
          launcher: 'cli-chain',
          timeframe,
          training_workload: workload,
          lookback_bars: first.request.resolvedBars,
        });
        expect(
          echoed.ok,
          `resolved default ${first.request.resolvedBars} for ${workload}/${String(timeframe)} must be accepted`,
        ).toBe(true);
      }
    }
  });

  it('rejects an out-of-range override naming the workload bounds', () => {
    const tooBig = normalizeSweepLaunchRequest({
      launcher: 'cli-chain',
      training_workload: 'preview',
      lookback_bars: TRAINING_BARS_PREVIEW_MAX + 1,
    });
    expect(tooBig.ok).toBe(false);
    if (tooBig.ok) return;
    expect(tooBig.error).toContain(String(TRAINING_BARS_PREVIEW_MAX));
    expect(tooBig.error).toContain('preview');

    const tooSmall = normalizeSweepLaunchRequest({
      launcher: 'cli-chain',
      training_workload: 'batch',
      lookback_bars: TRAINING_BARS_MIN - 1,
    });
    expect(tooSmall.ok).toBe(false);
  });

  it('admits a batch override that the preview ceiling would have rejected (1326 F2)', () => {
    const result = normalizeSweepLaunchRequest({
      launcher: 'cli-chain',
      timeframe: '5m',
      training_workload: 'batch',
      lookback_bars: 8000, // TICKET_1262's mandated value
    });
    expect(result.ok).toBe(true);
    expect(8000).toBeLessThanOrEqual(TRAINING_BARS_BATCH_MAX);
  });

  it('treats blank/whitespace strings as absent', () => {
    const result = normalizeSweepLaunchRequest({
      launcher: 'cli-chain',
      timeframe: '   ',
      template_id: '',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.timeframe).toBeUndefined();
    expect(result.request.templateId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Claim staleness (F2)
// ---------------------------------------------------------------------------

describe('isSweepClaimStale', () => {
  it('is stale when the only handle (pid) is dead', () => {
    expect(isSweepClaimStale(claim({ unit: undefined, pid: 4242 }), { pidAlive: false })).toBe(true);
  });

  it('is not stale when the pid is alive', () => {
    expect(isSweepClaimStale(claim({ unit: undefined, pid: 4242 }), { pidAlive: true })).toBe(false);
  });

  it('is stale when the only handle (unit) is inactive', () => {
    expect(isSweepClaimStale(claim({ pid: undefined }), { unitActive: false })).toBe(true);
  });

  it('keeps the claim when ANY handle is still alive', () => {
    const both = claim({ pid: 4242, unit: 'catboost-sweep' });
    expect(isSweepClaimStale(both, { pidAlive: false, unitActive: true })).toBe(false);
    expect(isSweepClaimStale(both, { pidAlive: true, unitActive: false })).toBe(false);
    expect(isSweepClaimStale(both, { pidAlive: false, unitActive: false })).toBe(true);
  });

  it('FAIL-CLOSED: unknown liveness is treated as alive, never reaped', () => {
    // Wrongly reaping a live claim restores the concurrent-unfenced-sweep
    // hazard; wrongly keeping a dead one produces a loud refusal. The
    // asymmetric cost dictates this direction.
    expect(isSweepClaimStale(claim({ pid: 4242, unit: undefined }), {})).toBe(false);
    expect(isSweepClaimStale(claim({ pid: undefined }), {})).toBe(false);
    expect(isSweepClaimStale(claim({ pid: 4242, unit: 'u' }), {})).toBe(false);
  });

  it('ignores liveness for a handle the claim does not carry', () => {
    // A unit-shaped claim must not be reaped because some unrelated pid is dead.
    expect(isSweepClaimStale(claim({ pid: undefined }), { pidAlive: false })).toBe(false);
  });
});

describe('describeSweepClaim (AC2 -- names launcher, timeframe, template)', () => {
  it('names the launcher, template, timeframe and unit', () => {
    const description = describeSweepClaim(claim());
    expect(description).toContain('CLI chain');
    expect(description).toContain('catboost_return_v2');
    expect(description).toContain('5m');
    expect(description).toContain('catboost-sweep');
  });

  it('falls back to pid when there is no unit', () => {
    const description = describeSweepClaim(claim({ unit: undefined, pid: 991 }));
    expect(description).toContain('pid=991');
  });

  it('omits absent optional fields without emitting "undefined"', () => {
    const description = describeSweepClaim({
      launcher: 'orchestrator',
      pid: 5,
      claimedAtMs: 0,
    });
    expect(description).not.toContain('undefined');
  });
});

// ---------------------------------------------------------------------------
// The fence (F3, AC3)
// ---------------------------------------------------------------------------

describe('isSweepFenced', () => {
  it('requires a finite positive memory.max', () => {
    expect(isSweepFenced({ memoryMaxBytes: 1, source: 's' })).toBe(true);
    expect(isSweepFenced({ memoryMaxBytes: 2 * 1024 ** 3, source: 's' })).toBe(true);
  });

  it('treats unbounded / unknown / absent as UNFENCED (matches cgroup-fence.sh:159)', () => {
    expect(isSweepFenced({ memoryMaxBytes: null, source: 's' })).toBe(false);
    expect(isSweepFenced({ memoryMaxBytes: 0, source: 's' })).toBe(false);
    expect(isSweepFenced({ memoryMaxBytes: Number.POSITIVE_INFINITY, source: 's' })).toBe(false);
    expect(isSweepFenced({ memoryMaxBytes: Number.NaN, source: 's' })).toBe(false);
    expect(isSweepFenced(null)).toBe(false);
    expect(isSweepFenced(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Preflight (F5, AC5)
// ---------------------------------------------------------------------------

describe('buildPreflightSpec', () => {
  it('requires a manifest + grid per timeframe, resolved from the SCRIPT dir', () => {
    const spec = buildPreflightSpec({
      scriptDir: '/repo/scripts/sweeps',
      researchDir: '/data/research',
      timeframes: ['5m', '1h'],
    });
    const files = spec.filter((r) => r.kind === 'file').map((r) => r.subject);
    expect(files).toEqual([
      '/repo/scripts/sweeps/manifest_histdata_forex_5m.json',
      '/repo/scripts/sweeps/catboost_grid_5m.yaml',
      '/repo/scripts/sweeps/manifest_histdata_forex_1h.json',
      '/repo/scripts/sweeps/catboost_grid_1h.yaml',
    ]);
    // The drift the ticket documented (sec.6): assets are NOT in RESEARCH_DIR.
    for (const file of files) expect(file).not.toContain('/data/research');
  });

  it('requires the research dir to be writable', () => {
    const spec = buildPreflightSpec({
      scriptDir: '/s',
      researchDir: '/data/research',
      timeframes: [],
    });
    const writable = spec.filter((r) => r.kind === 'writable-dir');
    expect(writable).toHaveLength(1);
    expect(writable[0].subject).toBe('/data/research');
  });

  it('requires the toolchain imports, defaulting to the shared module list', () => {
    const spec = buildPreflightSpec({ scriptDir: '/s', researchDir: '/r', timeframes: [] });
    const modules = spec.filter((r) => r.kind === 'python-import').map((r) => r.subject);
    expect(modules).toEqual([...PREFLIGHT_PYTHON_MODULES]);
  });

  it('honours an explicit module list', () => {
    const spec = buildPreflightSpec({
      scriptDir: '/s', researchDir: '/r', timeframes: [], pythonModules: ['lightgbm'],
    });
    expect(spec.filter((r) => r.kind === 'python-import').map((r) => r.subject)).toEqual(['lightgbm']);
  });

  it('gives every requirement a unique id so failures are attributable', () => {
    const spec = buildPreflightSpec({
      scriptDir: '/s', researchDir: '/r', timeframes: ['5m', '15m', '30m', '1h'],
    });
    expect(new Set(spec.map((r) => r.id)).size).toBe(spec.length);
  });
});

describe('evaluatePreflight', () => {
  const spec = buildPreflightSpec({
    scriptDir: '/s', researchDir: '/r', timeframes: ['5m'], pythonModules: ['catboost'],
  });
  const allSatisfied = (): PreflightProbe[] => spec.map((r) => ({ id: r.id, satisfied: true }));

  it('passes when every requirement is satisfied', () => {
    expect(evaluatePreflight(spec, allSatisfied())).toEqual({ ok: true });
  });

  it('names the SPECIFIC missing item, not a generic failure (AC5)', () => {
    const probes = allSatisfied();
    const target = spec.find((r) => r.id === 'grid:5m');
    probes[spec.findIndex((r) => r.id === 'grid:5m')] = {
      id: 'grid:5m', satisfied: false, detail: 'ENOENT',
    };
    const verdict = evaluatePreflight(spec, probes);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error).toContain('grid:5m');
    expect(verdict.error).toContain(target!.subject);
    expect(verdict.error).toContain('ENOENT');
  });

  it('reports EVERY failure in one pass, so one run lists all fixes', () => {
    const verdict = evaluatePreflight(spec, spec.map((r) => ({ id: r.id, satisfied: false })));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    for (const requirement of spec) expect(verdict.error).toContain(requirement.id);
    expect(verdict.error).toContain(`${spec.length} of ${spec.length}`);
  });

  it('FAIL-CLOSED: an un-probed requirement fails rather than passing', () => {
    const verdict = evaluatePreflight(spec, []);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error).toContain('not checked');
  });
});

// ---------------------------------------------------------------------------
// The launch decision (AC1, AC2, AC3, AC5)
// ---------------------------------------------------------------------------

describe('decideSweepLaunch', () => {
  it('admits a fenced launch with a free registry', () => {
    const decision = decideSweepLaunch({ request: okRequest(), fence: FENCED });
    expect(decision.admitted).toBe(true);
  });

  it('AC2: refuses when a live sweep is in flight, naming the incumbent', () => {
    const decision = decideSweepLaunch({
      request: okRequest(),
      incumbent: { claim: claim(), liveness: { unitActive: true } },
      fence: FENCED,
    });
    expect(decision.admitted).toBe(false);
    if (decision.admitted) return;
    expect(decision.code).toBe('sweep_already_running');
    expect(decision.error).toContain('CLI chain');
    expect(decision.error).toContain('catboost_return_v2');
    expect(decision.error).toContain('5m');
  });

  it('AC2 cross-path: an orchestrator launch is refused by a cli-chain incumbent', () => {
    const decision = decideSweepLaunch({
      request: okRequest({ launcher: 'orchestrator' }),
      incumbent: { claim: claim({ launcher: 'cli-chain' }), liveness: { unitActive: true } },
      fence: FENCED,
    });
    expect(decision.admitted).toBe(false);
  });

  it('AC2 cross-path, reverse: a cli-chain launch is refused by an orchestrator incumbent', () => {
    const decision = decideSweepLaunch({
      request: okRequest({ launcher: 'cli-chain' }),
      incumbent: {
        claim: claim({ launcher: 'orchestrator', unit: undefined, pid: 77 }),
        liveness: { pidAlive: true },
      },
      fence: FENCED,
    });
    expect(decision.admitted).toBe(false);
    if (decision.admitted) return;
    expect(decision.error).toContain('desktop orchestrator');
  });

  it('reaps a stale claim instead of refusing, and reports what it reaped', () => {
    const stale = claim({ unit: undefined, pid: 4242 });
    const decision = decideSweepLaunch({
      request: okRequest(),
      incumbent: { claim: stale, liveness: { pidAlive: false } },
      fence: FENCED,
    });
    expect(decision.admitted).toBe(true);
    if (!decision.admitted) return;
    expect(decision.reapedClaim).toBe(stale);
  });

  it('AC3: refuses an unfenced launch, naming why', () => {
    const decision = decideSweepLaunch({ request: okRequest(), fence: UNFENCED });
    expect(decision.admitted).toBe(false);
    if (decision.admitted) return;
    expect(decision.code).toBe('sweep_unfenced');
    expect(decision.error).toContain('no fence');
  });

  it('AC3: refuses when no fence state was supplied at all (fail-closed)', () => {
    const decision = decideSweepLaunch({ request: okRequest() });
    expect(decision.admitted).toBe(false);
    if (decision.admitted) return;
    expect(decision.code).toBe('sweep_unfenced');
  });

  it('checks exclusion BEFORE the fence, so the more actionable error wins', () => {
    const decision = decideSweepLaunch({
      request: okRequest(),
      incumbent: { claim: claim(), liveness: { unitActive: true } },
      fence: UNFENCED,
    });
    expect(decision.admitted).toBe(false);
    if (decision.admitted) return;
    expect(decision.code).toBe('sweep_already_running');
  });

  it('AC5: refuses on preflight failure with the specific item', () => {
    const spec = buildPreflightSpec({
      scriptDir: '/s', researchDir: '/r', timeframes: ['5m'], pythonModules: [],
    });
    const decision = decideSweepLaunch({
      request: okRequest(),
      fence: FENCED,
      preflight: { spec, probes: spec.map((r) => ({ id: r.id, satisfied: r.id !== 'grid:5m' })) },
    });
    expect(decision.admitted).toBe(false);
    if (decision.admitted) return;
    expect(decision.code).toBe('sweep_preflight_failed');
    expect(decision.error).toContain('grid:5m');
  });

  it('passes the normalized request through unchanged on admission', () => {
    const request = okRequest();
    const decision = decideSweepLaunch({ request, fence: FENCED });
    expect(decision.admitted).toBe(true);
    if (!decision.admitted) return;
    // Identity, not structural equality -- the decision must not rebuild it.
    expect(decision.request).toBe(request);
  });
});

// ---------------------------------------------------------------------------
// Resume markers (F4, AC4) -- pinned against the REAL bash reader
// ---------------------------------------------------------------------------

describe('stage markers: parity with scripts/research/job-state.sh', () => {
  it('formats the record exactly as mark_stage_done writes it', () => {
    expect(formatStageMarker('grid_5m', '2026-07-30T00:00:00Z')).toBe(
      '{"stage":"grid_5m","status":"done","ts":"2026-07-30T00:00:00Z"}',
    );
  });

  it('the grep prefix is the literal string job-state.sh:69 searches for', () => {
    // job-state.sh: grep -qF "{\"stage\":\"${key}\",\"status\":\"done\","
    expect(stageMarkerGrepPrefix('grid_5m')).toBe('{"stage":"grid_5m","status":"done",');
  });

  it('a formatted record contains its own grep prefix (writer/reader agree)', () => {
    for (const key of ['grid_5m', 'bayesian_1h', CHAIN_DONE_STAGE_KEY]) {
      expect(formatStageMarker(key, '2026-07-30T00:00:00Z')).toContain(
        stageMarkerGrepPrefix(key),
      );
    }
  });

  it('isStageDone matches only the exact key, avoiding substring false positives', () => {
    // The reason job-state.sh greps a structural prefix rather than the bare key.
    const contents = [
      formatStageMarker('grid_15m', '2026-07-30T00:00:00Z'),
      formatStageMarker('bayesian_5m', '2026-07-30T00:01:00Z'),
    ].join('\n');
    expect(isStageDone(contents, 'grid_15m')).toBe(true);
    expect(isStageDone(contents, 'bayesian_5m')).toBe(true);
    // '5m' is a substring of 'bayesian_5m' but is not itself a recorded stage.
    expect(isStageDone(contents, '5m')).toBe(false);
    expect(isStageDone(contents, 'grid_5m')).toBe(false);
    expect(isStageDone('', 'grid_5m')).toBe(false);
  });

  it('derives the stage keys the chain script uses', () => {
    expect(gridStageKey('5m')).toBe('grid_5m');
    expect(bayesianStageKey('1h')).toBe('bayesian_1h');
    expect(CHAIN_DONE_STAGE_KEY).toBe('chain_done');
  });

  it('derives the marker path job-state.sh computes', () => {
    // job-state.sh: <research_dir>/job-state/<job>/stages.jsonl
    expect(stageMarkerRelativePath(SWEEP_JOB_NAME)).toBe('job-state/catboost-sweep/stages.jsonl');
  });

  it('uses the job name the chain script passes at every call site', () => {
    expect(SWEEP_JOB_NAME).toBe('catboost-sweep');
  });
});
