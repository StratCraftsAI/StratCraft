import { describe, expect, it } from 'vitest';
import type { WorkloadParameterSpecification } from './index';
import {
  applyPrelaunchEdits,
  assertConfirmedPlanIntegrity,
  assertCurrentConfirmedPlan,
  confirmPrelaunchReview,
  resolvePrelaunchReview,
  WorkloadPrelaunchError,
} from './index';
import {
  FACTOR_MINING_PARAMETER_SPECIFICATION,
  editFactorMiningReview,
  resolveCurrentFactorMiningReview,
  resolveFactorMiningReview,
} from './factor-mining';
import { resolveMarketScope } from './market-scope';
import { WorkloadDateWindowError, toExecutionWindow } from './date-window';
import { WorkloadCoverageError, deriveCoverageWindow } from './coverage-window';

const specification: WorkloadParameterSpecification = {
  id: 'test.workload',
  version: '1.0.0',
  parameters: [
    { id: 'engine', label: 'Engine', required: true, editable: false, impact: ['cost'], defaultValue: 'gpquant', defaultSource: 'test:v1' },
    { id: 'symbols', label: 'Symbols', required: true, editable: true, impact: ['scope'], validationRequirements: 'At least one symbol.' },
    { id: 'threads', label: 'Threads', required: true, editable: true, impact: ['cost'], supportedChoices: [1, 2, 4] },
    { id: 'output', label: 'Output', required: true, editable: true, impact: ['output'] },
  ],
};

const validator = (values: Readonly<Record<string, unknown>>) => (
  Array.isArray(values.symbols) && values.symbols.length > 0 ? [] : [{
    code: 'SYMBOLS_EMPTY', parameterIds: ['symbols'], message: 'No symbols.', remediation: 'Add a symbol.',
  }]
);

describe('central workload pre-launch owner', () => {
  it('resolves every provenance source and reports missing and invalid values', () => {
    const review = resolvePrelaunchReview(specification, {
      explicit: { symbols: [], unknown: true },
      persisted: { threads: 2 },
      derived: { output: 'registry' },
      derivedContextVersion: 'ctx-1',
      estimatedWork: { cells: 0 },
    }, validator);
    expect(review.parameters.map(value => [value.id, value.provenance])).toEqual([
      ['engine', 'default'], ['symbols', 'explicit'], ['threads', 'persisted'], ['output', 'derived'],
    ]);
    expect(review.validationErrors.map(error => error.code)).toEqual(['UNKNOWN_PARAMETER', 'SYMBOLS_EMPTY']);
    expect(review.missingRequired).toEqual([]);
    expect(review.planFingerprint).toMatch(/^[a-f0-9]{64}$/);
    for (const parameter of review.parameters) {
      expect(parameter).toHaveProperty('control');
      expect(typeof parameter.control).toBe('string');
    }
    expect(review.parameters.find(value => value.id === 'engine')?.control).toBe('readonly');
    expect(review.parameters.find(value => value.id === 'threads')?.control).toBe('select');
  });

  it('keeps required fields without a value unresolved', () => {
    const review = resolvePrelaunchReview(specification, { derivedContextVersion: 'ctx-1' });
    expect(review.missingRequired.map(value => value.id)).toEqual(['symbols', 'threads', 'output']);
    for (const missing of review.missingRequired) {
      expect(missing).toHaveProperty('control');
      expect(typeof missing.control).toBe('string');
    }
    expect(review.missingRequired.find(value => value.id === 'threads')?.control).toBe('select');
    expect(review.missingRequired.find(value => value.id === 'symbols')?.control).toBe('text');
  });

  it('applies edits through the owner and changes the fingerprint', () => {
    const first = resolvePrelaunchReview(specification, {
      explicit: { symbols: ['EURUSD'], threads: 1, output: 'registry' },
      derivedContextVersion: 'ctx-1',
    });
    const edited = applyPrelaunchEdits(specification, first, { threads: 2 }, {
      derivedContextVersion: 'ctx-1',
    });
    expect(edited.parameters.find(value => value.id === 'threads')?.value).toBe(2);
    expect(edited.planFingerprint).not.toBe(first.planFingerprint);
    expect(() => applyPrelaunchEdits(specification, first, { engine: 'pysr' }, {
      derivedContextVersion: 'ctx-1',
    })).toThrowError(WorkloadPrelaunchError);
  });

  it('refuses incomplete or mismatched confirmation and confirms the exact review', () => {
    const incomplete = resolvePrelaunchReview(specification, { derivedContextVersion: 'ctx-1' });
    expect(() => confirmPrelaunchReview(specification, incomplete, {
      planFingerprint: incomplete.planFingerprint, specificationVersion: '1.0.0', confirmedAtUtc: '2026-08-04T00:00:00Z',
    })).toThrowError(/unresolved/);
    const review = resolvePrelaunchReview(specification, {
      explicit: { symbols: ['EURUSD'], threads: 1, output: 'registry' }, derivedContextVersion: 'ctx-1',
    });
    expect(() => confirmPrelaunchReview(specification, review, {
      planFingerprint: 'wrong', specificationVersion: '1.0.0', confirmedAtUtc: '2026-08-04T00:00:00Z',
    })).toThrowError(/does not identify/);
    const confirmed = confirmPrelaunchReview(specification, review, {
      planFingerprint: review.planFingerprint, specificationVersion: '1.0.0', confirmedAtUtc: '2026-08-04T00:00:00Z',
    });
    expect(confirmed.planFingerprint).toBe(review.planFingerprint);
    expect(Object.isFrozen(confirmed)).toBe(true);
  });

  it('accepts a current plan and rejects changed derived context or values', () => {
    const review = resolvePrelaunchReview(specification, {
      explicit: { symbols: ['EURUSD'], threads: 1, output: 'registry' }, derivedContextVersion: 'ctx-1',
    });
    const confirmed = confirmPrelaunchReview(specification, review, {
      planFingerprint: review.planFingerprint, specificationVersion: '1.0.0', confirmedAtUtc: '2026-08-04T00:00:00Z',
    });
    expect(() => assertCurrentConfirmedPlan(specification, confirmed, review)).not.toThrow();
    const fresh = resolvePrelaunchReview(specification, {
      explicit: { symbols: ['EURUSD'], threads: 2, output: 'registry' }, derivedContextVersion: 'ctx-2',
    });
    expect(() => assertCurrentConfirmedPlan(specification, confirmed, fresh)).toThrowError(/stale/);
    expect(() => assertConfirmedPlanIntegrity(specification, confirmed, 'ctx-1')).not.toThrow();
    expect(() => assertConfirmedPlanIntegrity(specification, {
      ...confirmed,
      parameters: confirmed.parameters.map(parameter => parameter.id === 'threads'
        ? { ...parameter, value: 4 }
        : parameter),
    }, 'ctx-1')).toThrowError(/changed/);
  });
});

describe('GPQuant factor mining integration', () => {
  const context = {
    version: 'cpu:4-memory:16000',
    concurrency: 2,
    blasThreads: 1,
    memoryBudgetMb: 12000,
    bindingConstraint: 'cpu' as const,
  };

  // TICKET_1370 R11/AC30+AC32: market scope and timeframes have authoritative
  // repository defaults, so they are no longer missing. The date window has no
  // repository default: it is derived from physical coverage, which is absent
  // in this context, so it stays blocking rather than being invented.
  it('does not invent a data window when coverage is unavailable', () => {
    const review = resolveFactorMiningReview({ engine: 'gpquant' }, context);
    expect(review.missingRequired.map(value => value.id)).toEqual(['startDate', 'endDate']);
    expect(review.validationErrors.map(error => error.code)).not.toContain('MINING_MARKET_SCOPE_INVALID');
    expect(review.parameters.find(value => value.id === 'engine')).toMatchObject({ value: 'gpquant', provenance: 'explicit' });
    expect(review.parameters.find(value => value.id === 'concurrency')).toMatchObject({ value: 2, provenance: 'derived' });
    expect(review.estimatedWork.bindingConstraint).toBe('cpu');
    expect(review.estimatedWork.bindingConstraint).not.toBe(review.derivedContextVersion);
  });

  it('returns a complete GPQuant review with authoritative defaults and geometry', () => {
    const review = resolveFactorMiningReview({
      engine: 'gpquant', marketScopeSource: 'custom', symbols: ['EURUSD'], timeframes: ['5m'],
      startDate: '2025-01-01', endDate: '2025-01-31',
    }, context);
    expect(review.missingRequired).toEqual([]);
    expect(review.validationErrors).toEqual([]);
    expect(review.parameters.find(value => value.id === 'gpquant.population')).toMatchObject({ value: 500, provenance: 'default' });
    expect(review.parameters.find(value => value.id === 'persistenceDestination')).toMatchObject({ value: 'canonical-factor-registry', provenance: 'default', editable: false });
  });

  it('rejects unresolvable scope, reversed window, non-GPQuant engine, and excess concurrency', () => {
    const review = resolveFactorMiningReview({
      engine: 'pysr', marketScopeSource: 'preset', timeframes: ['5m'],
      startDate: '2025-02-01', endDate: '2025-01-01', concurrency: 7,
    }, context);
    expect(review.validationErrors.map(error => error.code)).toEqual(expect.arrayContaining([
      'PARAMETER_NUMBER_ABOVE_MAXIMUM', 'MINING_ENGINE_NOT_GPQUANT',
      'MINING_WINDOW_INVALID', 'MINING_CONCURRENCY_INVALID',
    ]));
  });
});

// TICKET_1370 R9/AC21-AC23: market scope is ONE decision with two input modes.
// This supersedes the R4 `requiredGroup` either/or repair UI, which exposed the
// storage representation as two peer fields and let the runtime apply a
// preset-over-symbols precedence the validator never agreed to.
describe('TICKET_1370 R9 market scope', () => {
  const context = {
    version: 'ctx:v1', concurrency: 6, blasThreads: 1,
    memoryBudgetMb: 43288, bindingConstraint: 'memory' as const,
    coverage: {
      startUtc: '2020-01-01T00:00:00Z', endUtcExclusive: '2025-01-02T00:00:00Z',
      minimumDate: '2020-01-01', maximumDate: '2025-01-01', snapshotVersion: 'scope:snap:v1',
    },
  };
  const complete = { timeframes: ['1h'], startDate: '2020-01-01', endDate: '2025-01-01' } as const;

  // R11/AC30 supersedes the R9 "demand the source" assertion: the source now
  // defaults. What R9 still owns is that `preset` and `symbols` are never two
  // peer demands -- exactly one is meaningful, chosen by the source.
  it('never demands the two input modes as peer fields', () => {
    const review = resolveFactorMiningReview({ engine: 'gpquant' }, context);
    expect(review.missingRequired.map(item => item.id)).not.toContain('preset');
    expect(review.missingRequired.map(item => item.id)).not.toContain('symbols');
    expect(review.missingRequired.map(item => item.id)).not.toContain('marketScopeSource');
  });

  it('reveals only the selected mode via shared visibility metadata', () => {
    const review = resolveFactorMiningReview({
      engine: 'gpquant', marketScopeSource: 'preset', preset: 'g10-28', ...complete,
    }, context);
    const preset = review.parameters.find(item => item.id === 'preset');
    expect(preset?.visibleWhen).toEqual({ parameterId: 'marketScopeSource', equals: ['preset'] });
  });

  it('expands a preset to the canonical resolved universe', () => {
    const { scope } = resolveMarketScope({ marketScopeSource: 'preset', preset: 'g10-28' });
    expect(scope?.resolvedSymbols).toHaveLength(28);
    expect(scope?.resolvedSymbols).toContain('EURUSD');
    expect([...(scope?.resolvedSymbols ?? [])]).toEqual([...(scope?.resolvedSymbols ?? [])].sort());
  });

  it('canonicalizes custom symbols by case, order, and duplication', () => {
    const { scope } = resolveMarketScope({
      marketScopeSource: 'custom', symbols: [' gbpusd ', 'EURUSD', 'eurusd'],
    });
    expect(scope?.resolvedSymbols).toEqual(['EURUSD', 'GBPUSD']);
  });

  it('refuses an unknown preset and an empty custom list', () => {
    expect(resolveMarketScope({ marketScopeSource: 'preset', preset: 'nope' }).errors[0].code)
      .toBe('MINING_MARKET_SCOPE_INVALID');
    expect(resolveMarketScope({ marketScopeSource: 'custom', symbols: [] }).errors[0].code)
      .toBe('MINING_MARKET_SCOPE_INVALID');
  });

  it('estimates cells from the resolved universe, not the raw draft field', () => {
    const review = resolveFactorMiningReview({
      engine: 'gpquant', marketScopeSource: 'preset', preset: 'g10-28',
      timeframes: ['5m', '1h'], startDate: '2020-01-01', endDate: '2025-01-01',
    }, context);
    // 28 preset symbols x 2 timeframes. Before R9 `draft.symbols` was empty for
    // a preset launch, so the reviewed cost read 0 while 56 cells executed.
    expect(review.estimatedWork.cells).toBe(56);
  });

  it('drops the other mode when the source changes, so both can never coexist', () => {
    const first = resolveFactorMiningReview({
      engine: 'gpquant', marketScopeSource: 'custom', symbols: ['EURUSD'], ...complete,
    }, context);
    const edited = editFactorMiningReview(first, { marketScopeSource: 'preset', preset: 'g10-28' }, context);
    expect(edited.parameters.find(item => item.id === 'symbols')).toBeUndefined();
    expect(edited.validationErrors).toEqual([]);
  });

  it('clears the scope error through an edit round trip', () => {
    // An explicitly cleared preset under `preset` source is still an
    // unresolvable scope: R11 defaults the initial review, it does not make
    // the validator tolerant of a scope the user emptied.
    const first = resolveFactorMiningReview({
      engine: 'gpquant', marketScopeSource: 'custom', symbols: [], ...complete,
    }, context);
    expect(first.validationErrors.map(error => error.code)).toContain('MINING_MARKET_SCOPE_INVALID');
    const edited = editFactorMiningReview(first, { marketScopeSource: 'preset', preset: 'g10-28' }, context);
    expect(edited.validationErrors).toEqual([]);
    expect(edited.missingRequired).toEqual([]);
    expect(edited.planFingerprint).not.toBe(first.planFingerprint);
  });
});

// TICKET_1370 R10/AC25-AC29: one half-open window contract and storage-derived
// defaults. No layer may use a fixed date, host-clock lookback, or placeholder.
describe('TICKET_1370 R10 date window', () => {
  const context = {
    version: 'ctx:v1', concurrency: 6, blasThreads: 1,
    memoryBudgetMb: 43288, bindingConstraint: 'memory' as const,
  };

  it('converts an inclusive selected range to a half-open execution interval', () => {
    expect(toExecutionWindow('2025-01-01', '2025-01-31')).toMatchObject({
      startUtc: '2025-01-01T00:00:00Z', endUtcExclusive: '2025-02-01T00:00:00Z',
    });
  });

  it.each([
    ['below the lower bound', '2020-12-31', '2024-01-01'],
    ['above the upper bound', '2021-01-01', '2024-01-02'],
  ])('rejects a selected date %s with MINING_WINDOW_INVALID', (_label, startDate, endDate) => {
    const coverage = deriveCoverageWindow([
      { symbol: 'EURUSD', timeframe: '1h', firstTimestampMs: Date.UTC(2021, 0, 1), lastTimestampMs: Date.UTC(2024, 0, 1) },
    ], 'snap:bounds');
    const review = resolveFactorMiningReview({
      engine: 'gpquant', marketScopeSource: 'custom', symbols: ['EURUSD'], timeframes: ['1h'],
      startDate, endDate,
    }, { ...context, coverage });

    expect(review.validationErrors).toContainEqual(expect.objectContaining({
      code: 'MINING_WINDOW_INVALID',
      parameterIds: ['startDate', 'endDate'],
      message: expect.stringContaining('authoritative physical coverage'),
    }));
  });

  it('accepts the exact inclusive physical coverage boundaries', () => {
    const coverage = deriveCoverageWindow([
      { symbol: 'EURUSD', timeframe: '1h', firstTimestampMs: Date.UTC(2021, 0, 1), lastTimestampMs: Date.UTC(2024, 0, 1) },
    ], 'snap:inclusive');
    const review = resolveFactorMiningReview({
      engine: 'gpquant', marketScopeSource: 'custom', symbols: ['EURUSD'], timeframes: ['1h'],
      startDate: coverage.minimumDate, endDate: coverage.maximumDate,
    }, { ...context, coverage });

    expect(review.validationErrors.map(error => error.code)).not.toContain('MINING_WINDOW_INVALID');
  });

  it('handles month, year, and leap-day boundaries', () => {
    expect(toExecutionWindow('2024-02-29', '2024-02-29').endUtcExclusive).toBe('2024-03-01T00:00:00Z');
    expect(toExecutionWindow('2024-12-31', '2024-12-31').endUtcExclusive).toBe('2025-01-01T00:00:00Z');
  });

  it('refuses a reversed range and a non-existent calendar date', () => {
    expect(() => toExecutionWindow('2025-02-01', '2025-01-01')).toThrow(WorkloadDateWindowError);
    expect(() => toExecutionWindow('2025-02-30', '2025-03-01')).toThrow(WorkloadDateWindowError);
  });

  it('renders both window parameters as native date controls', () => {
    const review = resolveFactorMiningReview({ engine: 'gpquant' }, context);
    for (const id of ['startDate', 'endDate']) {
      expect(review.missingRequired.find(item => item.id === id)?.control).toBe('date');
    }
  });

  it('derives the maximal common window across cells and converts the last bar to an exclusive end', () => {
    const window = deriveCoverageWindow([
      { symbol: 'EURUSD', timeframe: '1h', firstTimestampMs: Date.UTC(2020, 0, 1), lastTimestampMs: Date.UTC(2025, 0, 1) },
      { symbol: 'GBPUSD', timeframe: '1h', firstTimestampMs: Date.UTC(2021, 0, 1), lastTimestampMs: Date.UTC(2024, 0, 1) },
    ], 'snap:v1');
    expect(window.startUtc).toBe('2021-01-01T00:00:00Z');
    // The narrowest cell's last 1h bar opens 2024-01-01T00:00Z and closes an
    // hour later; that close is the exclusive end.
    expect(window.endUtcExclusive).toBe('2024-01-01T01:00:00Z');
    expect(window.minimumDate).toBe('2021-01-01');
    expect(window.maximumDate).toBe('2024-01-01');
  });

  it('refuses missing coverage and a disjoint intersection instead of inventing dates', () => {
    expect(() => deriveCoverageWindow([], 'snap:v1')).toThrow(WorkloadCoverageError);
    expect(() => deriveCoverageWindow([
      { symbol: 'EURUSD', timeframe: '1h', firstTimestampMs: Date.UTC(2024, 0, 1), lastTimestampMs: Date.UTC(2025, 0, 1) },
      { symbol: 'GBPUSD', timeframe: '1h', firstTimestampMs: Date.UTC(2020, 0, 1), lastTimestampMs: Date.UTC(2021, 0, 1) },
    ], 'snap:v1')).toThrow(WorkloadCoverageError);
    expect(() => deriveCoverageWindow([
      { symbol: 'EURUSD', timeframe: '1h', firstTimestampMs: Number.NaN, lastTimestampMs: Date.UTC(2025, 0, 1) },
    ], 'snap:v1')).toThrow(WorkloadCoverageError);
  });

  it('pre-populates editable derived defaults and picker bounds from coverage', () => {
    const coverage = deriveCoverageWindow([
      { symbol: 'EURUSD', timeframe: '1h', firstTimestampMs: Date.UTC(2021, 0, 1), lastTimestampMs: Date.UTC(2024, 0, 1) },
    ], 'snap:v1');
    const review = resolveFactorMiningReview({
      engine: 'gpquant', marketScopeSource: 'custom', symbols: ['EURUSD'], timeframes: ['1h'],
    }, { ...context, coverage });
    const start = review.parameters.find(item => item.id === 'startDate');
    expect(start).toMatchObject({ value: '2021-01-01', provenance: 'derived' });
    expect(start?.dateBounds).toEqual({ minimumDate: '2021-01-01', maximumDate: '2024-01-01' });
    // AC27: the coverage snapshot participates in the fingerprint.
    expect(review.derivedContextVersion).toContain('snap:v1');
  });

  it('re-resolves a confirmed plan against the same complete coverage context', () => {
    const coverage = deriveCoverageWindow([
      { symbol: 'EURUSD', timeframe: '1h', firstTimestampMs: Date.UTC(2021, 0, 1), lastTimestampMs: Date.UTC(2024, 0, 1) },
    ], 'snap:v1');
    const currentContext = { ...context, coverage };
    const review = resolveFactorMiningReview({
      engine: 'gpquant', marketScopeSource: 'custom', symbols: ['EURUSD'], timeframes: ['1h'],
    }, currentContext);
    const confirmed = confirmPrelaunchReview(
      FACTOR_MINING_PARAMETER_SPECIFICATION,
      review,
      {
        planFingerprint: review.planFingerprint,
        specificationVersion: review.specificationVersion,
        confirmedAtUtc: '2026-08-06T00:00:00Z',
      },
    );

    const currentReview = resolveCurrentFactorMiningReview(confirmed, currentContext);

    expect(currentReview.planFingerprint).toBe(confirmed.planFingerprint);
    expect(currentReview.derivedContextVersion).toBe(confirmed.derivedContextVersion);
    expect(() => assertCurrentConfirmedPlan(
      FACTOR_MINING_PARAMETER_SPECIFICATION, confirmed, currentReview,
    )).not.toThrow();
  });

  it('reacquires derived coverage while retaining persisted parameter provenance', () => {
    const firstCoverage = deriveCoverageWindow([
      { symbol: 'EURUSD', timeframe: '1h', firstTimestampMs: Date.UTC(2021, 0, 1), lastTimestampMs: Date.UTC(2024, 0, 1) },
    ], 'snap:v1');
    const review = resolveFactorMiningReview({
      engine: 'gpquant', marketScopeSource: 'custom', symbols: ['EURUSD'], timeframes: ['1h'],
    }, { ...context, coverage: firstCoverage });
    const confirmed = confirmPrelaunchReview(
      FACTOR_MINING_PARAMETER_SPECIFICATION,
      review,
      {
        planFingerprint: review.planFingerprint,
        specificationVersion: review.specificationVersion,
        confirmedAtUtc: '2026-08-06T00:00:00Z',
      },
    );
    const serializedWithPersistedEngine = {
      ...confirmed,
      parameters: confirmed.parameters.map(parameter => parameter.id === 'engine'
        ? { ...parameter, provenance: 'persisted' as const }
        : parameter),
    };
    const changedCoverage = { ...firstCoverage, snapshotVersion: 'snap:v2' };

    const freshReview = resolveCurrentFactorMiningReview(
      serializedWithPersistedEngine,
      { ...context, coverage: changedCoverage },
    );

    expect(freshReview.parameters.find(parameter => parameter.id === 'engine'))
      .toMatchObject({ value: 'gpquant', provenance: 'persisted' });
    expect(freshReview.parameters.find(parameter => parameter.id === 'startDate'))
      .toMatchObject({ provenance: 'derived' });
    expect(freshReview.derivedContextVersion).toContain('snap:v2');
    expect(freshReview.planFingerprint).not.toBe(confirmed.planFingerprint);
  });

  it('surfaces a coverage failure as an actionable error with the window unresolved', () => {
    const review = resolveFactorMiningReview({
      engine: 'gpquant', marketScopeSource: 'custom', symbols: ['EURUSD'], timeframes: ['1h'],
    }, {
      ...context,
      coverageError: {
        code: 'MINING_COVERAGE_UNAVAILABLE', parameterIds: ['startDate', 'endDate'],
        message: 'no coverage', remediation: 'download data',
      },
    });
    expect(review.validationErrors.map(error => error.code)).toContain('MINING_COVERAGE_UNAVAILABLE');
    expect(review.parameters.find(item => item.id === 'startDate')).toBeUndefined();
  });
});

describe('optional parameter handling', () => {
  it('leaves an optional parameter absent from missingRequired', () => {
    const optionalSpec: WorkloadParameterSpecification = {
      id: 'test.optional', version: '1.0.0',
      parameters: [
        { id: 'kept', label: 'Kept', required: true, editable: true, impact: ['scope'], defaultValue: 1 },
        { id: 'loose', label: 'Loose', required: false, editable: true, impact: ['scope'] },
      ],
    };
    const review = resolvePrelaunchReview(optionalSpec, { derivedContextVersion: 'v1' });
    expect(review.missingRequired).toEqual([]);
    expect(review.parameters.map(p => p.id)).toEqual(['kept']);
  });
});
