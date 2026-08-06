/**
 * TICKET_1370 R12 / AC37-AC39 -- owner-side behaviour.
 *
 * The surface tests in `WorkloadPrelaunchReview.1370_R12.test.tsx` prove the
 * Guide WebUI renders what the owner produced. These prove the owner produces
 * it, and -- crucially for AC39 -- that formatting is inert with respect to the
 * confirmed plan.
 */
import { describe, expect, it } from 'vitest';
import {
  formatWorkloadMapAssignments,
  formatWorkloadScalar,
  isDisplayableMap,
} from './presentation';
import { resolveFactorMiningReview, editFactorMiningReview, type FactorMiningDerivedContext } from './factor-mining';
import type { FactorMiningDraft } from '@StratCraft/types';

const CONTEXT: FactorMiningDerivedContext = {
  version: 'ctx:v1',
  concurrency: 6,
  blasThreads: 1,
  memoryBudgetMb: 4000,
  bindingConstraint: 'memory',
  coverage: {
    startUtc: '2020-01-01T00:00:00.000Z',
    endUtcExclusive: '2025-01-02T00:00:00.000Z',
    minimumDate: '2020-01-01',
    maximumDate: '2025-01-01',
    snapshotVersion: 'snap:v1',
  },
};

const sparse = () => resolveFactorMiningReview({ engine: 'gpquant' } as FactorMiningDraft, CONTEXT);

describe('TICKET_1370 R12/AC38 -- every parameter carries an authoritative label', () => {
  it('resolves a label for every parameter and every declared gap', () => {
    const review = sparse();
    expect(review.parameters.length).toBeGreaterThan(0);
    for (const parameter of review.parameters) {
      expect(parameter.label, `${parameter.id} has no label`).toBeTruthy();
      expect(parameter.label).not.toBe(parameter.id);
    }
    for (const item of [...review.missingRequired, ...review.availableAlternatives]) {
      expect(item.label, `${item.id} has no label`).toBeTruthy();
    }
  });

  it('names market scope and the horizon map with their user-facing labels', () => {
    const byId = new Map(sparse().parameters.map(parameter => [parameter.id, parameter.label]));
    expect(byId.get('marketScopeSource')).toBe('Market scope');
    expect(byId.get('horizonByTimeframe')).toBe('Forecast horizon per timeframe');
    expect(byId.get('preset')).toBe('Symbol preset');
  });

  it('keeps the label out of the plan fingerprint', () => {
    // The fingerprint binds the confirmed VALUES. If a label edit could move
    // it, renaming a field would invalidate a plan the user already confirmed.
    const review = sparse();
    const relabelled = {
      ...review,
      parameters: review.parameters.map(parameter => ({ ...parameter, label: 'renamed' })),
    };
    expect(relabelled.planFingerprint).toBe(review.planFingerprint);
  });
});

describe('TICKET_1370 R12/AC37 -- the inactive input mode is published, not dropped', () => {
  it('offers the symbol list as an alternative while the source is preset', () => {
    const review = sparse();
    expect(review.parameters.map(p => p.id)).toContain('preset');
    expect(review.availableAlternatives.map(item => item.id)).toEqual(['symbols']);
    // It is an alternative, NOT a gap: a defaulted preset plan is complete.
    expect(review.missingRequired.map(item => item.id)).not.toContain('symbols');
  });

  it('carries the visibility condition the surface evaluates', () => {
    const symbols = sparse().availableAlternatives.find(item => item.id === 'symbols');
    expect(symbols?.visibleWhen).toEqual({ parameterId: 'marketScopeSource', equals: ['custom'] });
    expect(symbols?.control).toBe('tags');
  });

  it('offers the preset as the alternative once the source is custom', () => {
    const review = editFactorMiningReview(
      sparse(),
      { marketScopeSource: 'custom', symbols: ['EURUSD'] },
      CONTEXT,
    );
    expect(review.parameters.map(p => p.id)).toContain('symbols');
    expect(review.parameters.map(p => p.id)).not.toContain('preset');
    expect(review.availableAlternatives.map(item => item.id)).toEqual(['preset']);
  });

  it('never publishes the same mode as both a parameter and an alternative', () => {
    for (const review of [sparse(), editFactorMiningReview(sparse(), { marketScopeSource: 'custom', symbols: ['EURUSD'] }, CONTEXT)]) {
      const resolved = new Set(review.parameters.map(p => p.id));
      for (const alternative of review.availableAlternatives) {
        expect(resolved.has(alternative.id), `${alternative.id} is both resolved and alternative`).toBe(false);
      }
    }
  });
});

describe('TICKET_1370 R12/AC39 -- readable map formatting', () => {
  it('orders timeframe assignments by the repository sequence, not lexicographically', () => {
    const horizon = sparse().parameters.find(p => p.id === 'horizonByTimeframe');
    expect(formatWorkloadMapAssignments(horizon?.value as Record<string, number>)).toEqual([
      { key: '5m', value: '5' },
      { key: '15m', value: '5' },
      { key: '30m', value: '5' },
      { key: '1h', value: '1' },
    ]);
  });

  it('does not mutate or re-key the canonical map it formats', () => {
    const map = { '15m': 5, '1h': 1, '30m': 5, '5m': 5 };
    const before = JSON.stringify(map);
    formatWorkloadMapAssignments(map);
    expect(JSON.stringify(map)).toBe(before);
    expect(Object.keys(map)).toEqual(['15m', '1h', '30m', '5m']);
  });

  it('keeps an unrecognised key visible rather than dropping it', () => {
    // A reviewed value must never become invisible because presentation did
    // not recognise its key -- that would hide a value from confirmation.
    const assignments = formatWorkloadMapAssignments({ '5m': 5, '2w': 9 });
    expect(assignments.map(a => a.key)).toEqual(['5m', '2w']);
  });

  it('distinguishes a map from a list and from a scalar', () => {
    expect(isDisplayableMap({ '5m': 5 })).toBe(true);
    expect(isDisplayableMap(['5m'])).toBe(false);
    expect(isDisplayableMap(null)).toBe(false);
    expect(isDisplayableMap(42)).toBe(false);
  });

  it('renders a reviewed absence as legible text, not the literal null', () => {
    expect(formatWorkloadScalar(null)).toBe('not set');
    expect(formatWorkloadScalar(['5m', '1h'])).toBe('5m, 1h');
    expect(formatWorkloadScalar({ '5m': 5, '1h': 1 })).toBe('5m -> 5   1h -> 1');
  });
});
