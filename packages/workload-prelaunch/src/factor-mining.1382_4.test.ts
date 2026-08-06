import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedWorkloadParameter, WorkloadJsonValue } from '@StratCraft/types';
import {
  editFactorMiningReview,
  factorMiningValidationContextFromReview,
  FACTOR_MINING_PARAMETER_SPECIFICATION,
  formatWorkloadCalendarDate,
  resolveFactorMiningReview,
  resolveWorkloadFormattingLocale,
  validateFactorMiningParameters,
  validateWorkloadParameters,
  type FactorMiningDerivedContext,
} from './index';

const CONTEXT: FactorMiningDerivedContext = {
  version: 'resources:v1', concurrency: 4, blasThreads: 2,
  memoryBudgetMb: 16_000, bindingConstraint: 'cpu',
  coverage: {
    startUtc: '2020-03-04T00:00:00Z', endUtcExclusive: '2026-06-27T00:00:00Z',
    minimumDate: '2020-03-04', maximumDate: '2026-06-26', snapshotVersion: 'coverage:snap:v7',
  },
};

function readyReview() {
  return resolveFactorMiningReview({
    engine: 'gpquant', marketScopeSource: 'custom', symbols: ['EURUSD'],
    timeframes: ['5m', '1h'],
  }, CONTEXT);
}

function replace(
  parameters: readonly ResolvedWorkloadParameter[],
  edits: Readonly<Record<string, WorkloadJsonValue>>,
): readonly ResolvedWorkloadParameter[] {
  return parameters.map(parameter => parameter.id in edits
    ? { ...parameter, value: edits[parameter.id] }
    : parameter);
}

describe('TICKET_1382_4 coverage defaults', () => {
  it('publishes both physical coverage endpoints as calculated editable defaults', () => {
    const review = readyReview();
    expect(review.missingRequired).toEqual([]);
    for (const [id, value] of [['startDate', '2020-03-04'], ['endDate', '2026-06-26']] as const) {
      expect(review.parameters.find(parameter => parameter.id === id)).toMatchObject({
        value, provenance: 'derived', editable: true, control: 'date',
        defaultRole: 'calculated-from-coverage',
        defaultSource: 'factor-mining-physical-coverage:coverage:snap:v7',
        dateBounds: { minimumDate: '2020-03-04', maximumDate: '2026-06-26' },
      });
    }
  });

  it('replaces both dates and the fingerprint when scope coverage changes', () => {
    const first = readyReview();
    const nextContext: FactorMiningDerivedContext = {
      ...CONTEXT,
      coverage: {
        startUtc: '2022-01-01T00:00:00Z', endUtcExclusive: '2025-01-01T00:00:00Z',
        minimumDate: '2022-01-01', maximumDate: '2024-12-31', snapshotVersion: 'coverage:snap:v8',
      },
    };
    const edited = editFactorMiningReview(first, { symbols: ['USDJPY'] }, nextContext);
    expect(edited.parameters.find(parameter => parameter.id === 'startDate')).toMatchObject({
      value: '2022-01-01', provenance: 'derived',
      defaultSource: 'factor-mining-physical-coverage:coverage:snap:v8',
    });
    expect(edited.parameters.find(parameter => parameter.id === 'endDate')?.value).toBe('2024-12-31');
    expect(edited.planFingerprint).not.toBe(first.planFingerprint);
  });
});

describe('TICKET_1382_4 locale-only presentation', () => {
  const originalTimezone = process.env.TZ;
  afterEach(() => { process.env.TZ = originalTimezone; });

  it.each([
    ['en-US', '06/26/2026'], ['en-GB', '26/06/2026'], ['de-DE', '26.06.2026'],
    ['zh-CN', '2026/06/26'], ['ja-JP', '2026/06/26'],
  ])('formats one canonical date for %s', (locale, expected) => {
    expect(formatWorkloadCalendarDate('2026-06-26', locale)).toBe(expected);
  });

  it('preserves the matching runtime region only when the app locale has none', () => {
    expect(resolveWorkloadFormattingLocale('en', 'en-GB')).toBe('en-GB');
    expect(resolveWorkloadFormattingLocale('en_US', 'en-GB')).toBe('en-US');
    expect(resolveWorkloadFormattingLocale('bad_locale_!', 'de-DE')).toBe('de-DE');
    expect(resolveWorkloadFormattingLocale('de', 'en-GB')).toBe('de-DE');
    expect(resolveWorkloadFormattingLocale(undefined, undefined)).toBe('en-US');
  });

  it('cannot shift a calendar date under UTC-12 or UTC+14 hosts', () => {
    for (const timezone of ['Etc/GMT+12', 'Pacific/Kiritimati']) {
      process.env.TZ = timezone;
      expect(formatWorkloadCalendarDate('2026-06-26', 'en-GB')).toBe('26/06/2026');
    }
  });
});

describe('TICKET_1382_4 complete shared validation', () => {
  it('reports structural, type, choice, range, step, empty, and date-bound errors', () => {
    const valid = readyReview().parameters;
    const malformed = [
      ...replace(valid, {
        engine: 'unknown', timeframes: [], symbols: [],
        startDate: '2019-02-30', endDate: '2027-01-01',
        'gpquant.generations': 1.5, 'gpquant.population': Number.NaN as WorkloadJsonValue,
        blasThreads: 'two', memoryBudgetMb: 999,
      }),
      { ...valid.find(parameter => parameter.id === 'gpquant.runs')!, label: 'Drifted label' },
      valid[0],
      { ...valid[0], id: 'unknown.parameter' },
    ];
    const codes = validateWorkloadParameters(
      {
        ...FACTOR_MINING_PARAMETER_SPECIFICATION,
        parameters: FACTOR_MINING_PARAMETER_SPECIFICATION.parameters.map(definition => (
          definition.id === 'startDate' || definition.id === 'endDate'
            ? { ...definition, dateBounds: { minimumDate: '2020-03-04', maximumDate: '2026-06-26' } }
            : definition
        )),
      },
      malformed,
    ).map(error => error.code);
    expect(codes).toEqual(expect.arrayContaining([
      'UNKNOWN_PARAMETER', 'DUPLICATE_PARAMETER', 'PARAMETER_CHOICE_UNSUPPORTED',
      'PARAMETER_METADATA_MISMATCH', 'PARAMETER_VALUE_EMPTY', 'PARAMETER_TYPE_INVALID',
      'PARAMETER_NUMBER_BELOW_MINIMUM', 'PARAMETER_NUMBER_STEP_INVALID',
      'PARAMETER_NUMBER_NON_FINITE', 'PARAMETER_DATE_INVALID', 'PARAMETER_DATE_ABOVE_MAXIMUM',
    ]));
  });

  it('reports every factor-specific contract violation in one result', () => {
    const invalid = replace(readyReview().parameters, {
      engine: 'pysr', marketScopeSource: 'preset', preset: 'g10-28',
      horizonByTimeframe: { '5m': 0 }, startDate: '2026-06-26', endDate: '2020-03-04',
      'gpquant.population': 10, 'gpquant.hallOfFame': 11, 'gpquant.oosRatio': 1,
      concurrency: 5, blasThreads: 3, memoryBudgetMb: 17_000,
      persistenceDestination: 'elsewhere',
    });
    const result = validateFactorMiningParameters(invalid, CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.errors.map(error => error.code)).toEqual(expect.arrayContaining([
      'HIDDEN_PARAMETER_PRESENT', 'MINING_ENGINE_NOT_GPQUANT', 'MINING_HORIZON_INVALID',
      'MINING_WINDOW_INVALID', 'MINING_HALL_OF_FAME_INVALID', 'MINING_OOS_RATIO_INVALID',
      'MINING_CONCURRENCY_INVALID', 'MINING_BLAS_THREADS_INVALID',
      'MINING_CPU_GEOMETRY_INVALID', 'MINING_MEMORY_BUDGET_INVALID',
      'MINING_PERSISTENCE_DESTINATION_INVALID',
    ]));
  });

  it('reports lower and upper coverage violations as separate field errors', () => {
    const result = validateFactorMiningParameters(replace(readyReview().parameters, {
      startDate: '2020-03-03', endDate: '2026-06-27',
    }), CONTEXT);
    expect(result.errors.map(error => error.code)).toEqual(expect.arrayContaining([
      'PARAMETER_DATE_BELOW_MINIMUM', 'PARAMETER_DATE_ABOVE_MAXIMUM',
    ]));
  });

  it('rejects drifted calculated-default source metadata', () => {
    const parameters = readyReview().parameters.map(parameter => parameter.id === 'startDate'
      ? { ...parameter, defaultSource: 'factor-mining-physical-coverage:stale' }
      : parameter);
    expect(validateFactorMiningParameters(parameters, CONTEXT).errors.map(error => error.code))
      .toContain('MINING_COVERAGE_DEFAULT_METADATA_INVALID');
  });

  it('recovers the reviewed coverage and resource context for confirmation', () => {
    expect(factorMiningValidationContextFromReview(readyReview())).toMatchObject({
      concurrency: 4, blasThreads: 2, memoryBudgetMb: 16_000, bindingConstraint: 'cpu',
      coverage: {
        minimumDate: '2020-03-04', maximumDate: '2026-06-26',
        snapshotVersion: 'coverage:snap:v7',
      },
    });
    const unresolved = resolveFactorMiningReview({ engine: 'gpquant' }, {
      version: 'no-coverage', concurrency: 1, blasThreads: 1,
      memoryBudgetMb: 4000, bindingConstraint: 'memory',
    });
    const malformed = {
      ...unresolved,
      parameters: unresolved.parameters.map(parameter => parameter.id === 'concurrency'
        ? { ...parameter, value: 'bad' }
        : parameter),
      estimatedWork: { ...unresolved.estimatedWork, bindingConstraint: 'bad' },
    };
    expect(factorMiningValidationContextFromReview(malformed)).toMatchObject({
      concurrency: 0, coverage: undefined, bindingConstraint: 'repository-cap',
    });
  });
});
