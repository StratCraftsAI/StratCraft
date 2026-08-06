/**
 * TICKET_1370 R11 -- reviewed repository defaults and timeframe-derived
 * forecast horizons.
 *
 * Test-plan items 19-23. Each behaviour was proven to fail when the code it
 * covers is inverted (see the ticket's R11 implementation note).
 */

import { describe, expect, it } from 'vitest';
import {
  FACTOR_MINING_DEFAULT_PRESET,
  FACTOR_MINING_DEFAULT_TIMEFRAMES,
} from '@StratCraft/types';
import { editFactorMiningReview, resolveFactorMiningReview } from './factor-mining';
import { horizonForTimeframe, resolveHorizonByTimeframe, serializeHorizonMap } from './horizon';
import { deriveCoverageWindow } from './coverage-window';
import { WorkloadPrelaunchError } from './index';

const context = {
  version: 'ctx:v1',
  concurrency: 6,
  blasThreads: 1,
  memoryBudgetMb: 43288,
  bindingConstraint: 'memory' as const,
};

const coverage = deriveCoverageWindow(
  ['5m', '15m', '30m', '1h'].map(timeframe => ({
    symbol: 'EURUSD', timeframe,
    firstTimestampMs: Date.UTC(2021, 0, 1),
    lastTimestampMs: Date.UTC(2024, 0, 1),
  })),
  'snap:v1',
);

function valueOf(review: { parameters: readonly { id: string; value: unknown }[] }, id: string): unknown {
  return review.parameters.find(parameter => parameter.id === id)?.value;
}

// Item 21: every supported timeframe, mixed plans, overrides, add/remove.
describe('TICKET_1370 R11 horizon owner', () => {
  it('applies the repository rule to every supported timeframe', () => {
    expect(horizonForTimeframe('5m')).toBe(5);
    expect(horizonForTimeframe('15m')).toBe(5);
    expect(horizonForTimeframe('30m')).toBe(5);
    expect(horizonForTimeframe('1h')).toBe(1);
    expect(horizonForTimeframe('4h')).toBe(1);
    expect(horizonForTimeframe('1d')).toBe(1);
  });

  it('derives a per-timeframe map for a mixed plan instead of one scalar', () => {
    const { horizonByTimeframe } = resolveHorizonByTimeframe(['5m', '15m', '30m', '1h']);
    // The defect R11 removes: a single global `horizon: 5` would have forced
    // the `1h` cells off their own rule for this exact plan.
    expect(horizonByTimeframe).toEqual({ '15m': 5, '1h': 1, '30m': 5, '5m': 5 });
  });

  it('produces a canonical key order independent of selection order', () => {
    const forward = resolveHorizonByTimeframe(['5m', '1h']).horizonByTimeframe;
    const reverse = resolveHorizonByTimeframe(['1h', '5m']).horizonByTimeframe;
    expect(Object.keys(forward ?? {})).toEqual(Object.keys(reverse ?? {}));
  });

  it('honours an explicit per-timeframe override and leaves siblings on the rule', () => {
    const { horizonByTimeframe } = resolveHorizonByTimeframe(['5m', '1h'], { '1h': 3 });
    expect(horizonByTimeframe).toEqual({ '1h': 3, '5m': 5 });
  });

  it('refuses an override naming a timeframe the plan will not execute', () => {
    const { errors } = resolveHorizonByTimeframe(['5m'], { '1h': 3 });
    expect(errors.map(error => error.code)).toEqual(['MINING_HORIZON_INVALID']);
  });

  it('refuses a non-positive, non-integer, or scalar override', () => {
    expect(resolveHorizonByTimeframe(['5m'], { '5m': 0 }).errors).toHaveLength(1);
    expect(resolveHorizonByTimeframe(['5m'], { '5m': 1.5 }).errors).toHaveLength(1);
    expect(resolveHorizonByTimeframe(['5m'], 5).errors).toHaveLength(1);
  });

  it('refuses an empty or unsupported timeframe selection', () => {
    expect(resolveHorizonByTimeframe([]).errors).toHaveLength(1);
    expect(resolveHorizonByTimeframe(undefined).errors).toHaveLength(1);
    expect(resolveHorizonByTimeframe(['2m']).errors[0].message).toContain('2m');
  });

  it('serializes the map in canonical order for the Python CLI', () => {
    expect(serializeHorizonMap({ '1h': 1, '5m': 5, '15m': 5 })).toBe('15m=5,1h=1,5m=5');
  });
});

// Item 19: a sparse review is complete except for the storage-derived window.
describe('TICKET_1370 R11/AC30+AC31 reviewed defaults', () => {
  it('defaults market scope and timeframes with default provenance', () => {
    const review = resolveFactorMiningReview({ engine: 'gpquant' }, { ...context, coverage });
    expect(review.parameters.find(p => p.id === 'marketScopeSource'))
      .toMatchObject({ value: 'preset', provenance: 'default' });
    expect(review.parameters.find(p => p.id === 'preset'))
      .toMatchObject({ value: FACTOR_MINING_DEFAULT_PRESET, provenance: 'default' });
    expect(review.parameters.find(p => p.id === 'timeframes'))
      .toMatchObject({ value: [...FACTOR_MINING_DEFAULT_TIMEFRAMES], provenance: 'default' });
  });

  it('leaves nothing missing and no scope, timeframe, or horizon error', () => {
    const review = resolveFactorMiningReview({ engine: 'gpquant' }, { ...context, coverage });
    expect(review.missingRequired).toEqual([]);
    expect(review.validationErrors).toEqual([]);
    // AC31: the scalar horizon is gone from the review entirely.
    expect(review.parameters.map(p => p.id)).not.toContain('horizon');
    expect(review.missingRequired.map(p => p.id)).not.toContain('horizon');
  });

  it('never auto-confirms: the defaulted plan still requires confirmation', () => {
    const review = resolveFactorMiningReview({ engine: 'gpquant' }, { ...context, coverage });
    expect(review.confirmationRequired).toBe(true);
  });

  it('shows the review prompt, resolved universe, timeframes, and cell count', () => {
    const review = resolveFactorMiningReview({ engine: 'gpquant' }, { ...context, coverage });
    expect(review.estimatedWork.reviewPrompt).toContain('Review market scope and timeframes before launch');
    expect(review.estimatedWork.resolvedSymbolCount).toBe(28);
    expect(review.estimatedWork.timeframes).toEqual([...FACTOR_MINING_DEFAULT_TIMEFRAMES]);
    expect(review.estimatedWork.cells).toBe(28 * 4);
  });

  // AC32: defaults resolve the scope, but the window is still storage-derived.
  // Without coverage it stays blocking -- no fixed or clock-based fallback.
  it('keeps the window blocking when coverage is unavailable', () => {
    const review = resolveFactorMiningReview({ engine: 'gpquant' }, context);
    expect(review.missingRequired.map(p => p.id)).toEqual(['startDate', 'endDate']);
    expect(valueOf(review, 'startDate')).toBeUndefined();
  });

  it('pre-populates the window from coverage driven by the DEFAULTED scope', () => {
    const review = resolveFactorMiningReview({ engine: 'gpquant' }, { ...context, coverage });
    expect(review.parameters.find(p => p.id === 'startDate'))
      .toMatchObject({ value: '2021-01-01', provenance: 'derived' });
  });
});

// Item 21+23: the derived map lives in the review, the fingerprint, and moves
// together with every other derived value when timeframes change.
describe('TICKET_1370 R11/AC33+AC35 derived horizon in the review', () => {
  const complete = { engine: 'gpquant' as const, startDate: '2021-01-01', endDate: '2024-01-01' };

  it('resolves horizonByTimeframe as a derived, non-editable parameter', () => {
    const review = resolveFactorMiningReview(complete, { ...context, coverage });
    const horizon = review.parameters.find(p => p.id === 'horizonByTimeframe');
    expect(horizon).toMatchObject({ provenance: 'derived', editable: false });
    expect(horizon?.value).toEqual({ '15m': 5, '1h': 1, '30m': 5, '5m': 5 });
  });

  it('re-derives the map, cells, and fingerprint together when timeframes change', () => {
    const first = resolveFactorMiningReview(complete, { ...context, coverage });
    const edited = editFactorMiningReview(first, { timeframes: ['1h', '4h'] }, { ...context, coverage });
    expect(valueOf(edited, 'horizonByTimeframe')).toEqual({ '1h': 1, '4h': 1 });
    expect(edited.estimatedWork.cells).toBe(28 * 2);
    expect(edited.planFingerprint).not.toBe(first.planFingerprint);
    expect(edited.validationErrors).toEqual([]);
  });

  it('adds an assignment when a timeframe is added and drops one when removed', () => {
    const first = resolveFactorMiningReview({ ...complete, timeframes: ['1h'] }, { ...context, coverage });
    expect(valueOf(first, 'horizonByTimeframe')).toEqual({ '1h': 1 });
    const added = editFactorMiningReview(first, { timeframes: ['1h', '5m'] }, { ...context, coverage });
    expect(valueOf(added, 'horizonByTimeframe')).toEqual({ '1h': 1, '5m': 5 });
    const removed = editFactorMiningReview(added, { timeframes: ['5m'] }, { ...context, coverage });
    expect(valueOf(removed, 'horizonByTimeframe')).toEqual({ '5m': 5 });
  });

  it('changes the fingerprint when only a horizon assignment changes', () => {
    const derived = resolveFactorMiningReview({ ...complete, timeframes: ['1h'] }, { ...context, coverage });
    const overridden = resolveFactorMiningReview(
      { ...complete, timeframes: ['1h'], horizonByTimeframe: { '1h': 7 } },
      { ...context, coverage },
    );
    expect(valueOf(overridden, 'horizonByTimeframe')).toEqual({ '1h': 7 });
    expect(overridden.planFingerprint).not.toBe(derived.planFingerprint);
  });

  it('re-derives the scope and window when market scope changes', () => {
    const first = resolveFactorMiningReview(complete, { ...context, coverage });
    const edited = editFactorMiningReview(
      first,
      { marketScopeSource: 'custom', symbols: ['EURUSD', 'GBPUSD'] },
      { ...context, coverage },
    );
    expect(edited.estimatedWork.resolvedSymbolCount).toBe(2);
    expect(edited.estimatedWork.cells).toBe(2 * 4);
    expect(valueOf(edited, 'symbols')).toEqual(['EURUSD', 'GBPUSD']);
    expect(valueOf(edited, 'preset')).toBeUndefined();
  });

  it('refuses a user edit of the owner-derived horizon map (AC6)', () => {
    const first = resolveFactorMiningReview(complete, { ...context, coverage });
    expect(() => editFactorMiningReview(
      first, { horizonByTimeframe: { '5m': 99 } }, { ...context, coverage },
    )).toThrow(WorkloadPrelaunchError);
  });
});
