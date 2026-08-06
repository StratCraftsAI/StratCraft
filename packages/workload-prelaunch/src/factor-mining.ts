import type {
  ConfirmedWorkloadPlan,
  FactorMiningCoverageWindow,
  FactorMiningDraft,
  FactorMiningResourceGeometry,
  ResolvedWorkloadParameter,
  StructuredWorkloadValidationError,
  WorkloadJsonValue,
  WorkloadPrelaunchReview,
} from '@StratCraft/types';
import {
  FACTOR_MINING_DEFAULT_MARKET_SCOPE_SOURCE,
  FACTOR_MINING_DEFAULT_PRESET,
  FACTOR_MINING_DEFAULT_SCOPE_SOURCE_REF,
  FACTOR_MINING_DEFAULT_TIMEFRAMES,
  FACTOR_MINING_DEFAULT_TIMEFRAMES_SOURCE_REF,
  FACTOR_MINING_ENGINES,
  FACTOR_MINING_HORIZON_SOURCE_REF,
  FACTOR_MINING_MARKET_SCOPE_SOURCES,
  FACTOR_MINING_PLAN_SPECIFICATION_ID,
  FACTOR_MINING_PLAN_SPECIFICATION_VERSION,
  FACTOR_MINING_PRESETS,
  FACTOR_MINING_TIMEFRAMES,
} from '@StratCraft/types';
import {
  assertEditableParameters,
  resolvePrelaunchReview,
  type WorkloadParameterSpecification,
  type WorkloadResolutionInput,
} from './index';
import { resolveMarketScope } from './market-scope';
import { resolveHorizonByTimeframe } from './horizon';
import { WorkloadDateWindowError, toExecutionWindow } from './date-window';
import { validateWorkloadParameters } from './validation';

export const FACTOR_MINING_DEFAULT_SOURCE = 'scripts/factor_mining/tf_params.py:ENGINE_DEFAULTS:v1';
export const FACTOR_MINING_MAX_CONCURRENCY = 6;
export const FACTOR_MINING_PERSISTENCE_DESTINATION = 'canonical-factor-registry';
export const FACTOR_MINING_COVERAGE_DEFAULT_SOURCE = 'factor-mining-physical-coverage';

export const FACTOR_MINING_PARAMETER_SPECIFICATION: WorkloadParameterSpecification = {
  id: FACTOR_MINING_PLAN_SPECIFICATION_ID,
  version: FACTOR_MINING_PLAN_SPECIFICATION_VERSION,
  parameters: [
    { id: 'engine', label: 'Mining engine', required: true, editable: true, impact: ['cost', 'duration'], control: 'select', supportedChoices: [...FACTOR_MINING_ENGINES] },
    // TICKET_1370 R9/AC21: one required market-scope decision, with the two
    // input modes revealed conditionally. Neither input is `required`: the
    // source decides which one is meaningful, so demanding both would
    // contradict the domain model.
    // TICKET_1370 R11/AC30: the repository's authoritative universe convention
    // is the default, so a sparse review is actionable instead of dead-ending
    // on a missing field. It stays an editable high-impact parameter and is
    // marked `default` provenance -- the user still confirms it (AC31).
    { id: 'marketScopeSource', label: 'Market scope', required: true, editable: true, impact: ['scope', 'cost', 'duration'], control: 'select', supportedChoices: [...FACTOR_MINING_MARKET_SCOPE_SOURCES], defaultValue: FACTOR_MINING_DEFAULT_MARKET_SCOPE_SOURCE, defaultSource: FACTOR_MINING_DEFAULT_SCOPE_SOURCE_REF },
    { id: 'preset', label: 'Symbol preset', required: false, editable: true, impact: ['scope', 'cost', 'duration'], control: 'select', supportedChoices: [...FACTOR_MINING_PRESETS], visibleWhen: { parameterId: 'marketScopeSource', equals: ['preset'] }, defaultValue: FACTOR_MINING_DEFAULT_PRESET, defaultSource: FACTOR_MINING_DEFAULT_SCOPE_SOURCE_REF },
    { id: 'symbols', label: 'Symbols', required: false, editable: true, impact: ['scope', 'cost', 'duration'], control: 'tags', visibleWhen: { parameterId: 'marketScopeSource', equals: ['custom'] } },
    { id: 'timeframes', label: 'Timeframes', required: true, editable: true, impact: ['scope', 'cost', 'duration'], control: 'multi-select', supportedChoices: [...FACTOR_MINING_TIMEFRAMES], defaultValue: [...FACTOR_MINING_DEFAULT_TIMEFRAMES], defaultSource: FACTOR_MINING_DEFAULT_TIMEFRAMES_SOURCE_REF },
    // TICKET_1370 R11/AC33: the forecast horizon is a derived per-timeframe
    // map, never a required global scalar. It is not user-editable through the
    // card: editing the timeframes re-derives it, which is the only way an
    // assignment can change without desynchronizing from what executes.
    { id: 'horizonByTimeframe', label: 'Forecast horizon per timeframe', required: true, editable: false, impact: ['scope'], control: 'readonly', defaultSource: FACTOR_MINING_HORIZON_SOURCE_REF },
    { id: 'gpquant.generations', label: 'GPQuant generations', required: true, editable: true, impact: ['cost', 'duration'], control: 'number', validation: { minimum: 1, step: 1 }, defaultValue: 15, defaultSource: FACTOR_MINING_DEFAULT_SOURCE },
    { id: 'gpquant.population', label: 'GPQuant population', required: true, editable: true, impact: ['cost', 'duration'], control: 'number', validation: { minimum: 10, step: 1 }, defaultValue: 500, defaultSource: FACTOR_MINING_DEFAULT_SOURCE },
    { id: 'gpquant.runs', label: 'GPQuant runs', required: true, editable: true, impact: ['cost', 'duration'], control: 'number', validation: { minimum: 1, step: 1 }, defaultValue: 10, defaultSource: FACTOR_MINING_DEFAULT_SOURCE },
    { id: 'gpquant.hallOfFame', label: 'GPQuant hall of fame', required: true, editable: true, impact: ['cost', 'output'], control: 'number', validation: { minimum: 1, step: 1 }, defaultValue: 30, defaultSource: FACTOR_MINING_DEFAULT_SOURCE },
    { id: 'gpquant.seed', label: 'Random seed', required: true, editable: true, impact: ['output'], control: 'number', validation: { step: 1 }, defaultValue: 42, defaultSource: FACTOR_MINING_DEFAULT_SOURCE },
    { id: 'gpquant.minIc', label: 'Minimum IC', required: true, editable: true, impact: ['output'], control: 'number', validation: { minimum: 0, maximum: 1, step: 0.01 }, defaultValue: 0.02, defaultSource: 'scripts/factor_mining/cli.py:v1' },
    { id: 'gpquant.maxCorrelation', label: 'Maximum correlation', required: true, editable: true, impact: ['output'], control: 'number', validation: { minimum: 0, maximum: 1, step: 0.01 }, defaultValue: 0.7, defaultSource: 'scripts/factor_mining/cli.py:v1' },
    { id: 'gpquant.oosRatio', label: 'OOS ratio', required: true, editable: true, impact: ['scope', 'output'], control: 'number', validation: { minimum: 0, maximum: 1, step: 0.01 }, defaultValue: 0.2, defaultSource: 'scripts/factor_mining/cli.py:v1' },
    { id: 'gpquant.maxTrainBars', label: 'Maximum train bars', required: true, editable: true, impact: ['scope', 'cost', 'duration'], control: 'number', validation: { minimum: 1, step: 1 }, nullable: true, defaultValue: null, defaultSource: FACTOR_MINING_DEFAULT_SOURCE },
    { id: 'concurrency', label: 'Process concurrency', required: true, editable: true, impact: ['cost', 'duration', 'safety'], control: 'number', validation: { minimum: 1, maximum: FACTOR_MINING_MAX_CONCURRENCY, step: 1 } },
    { id: 'blasThreads', label: 'BLAS threads per process', required: true, editable: true, impact: ['cost', 'duration', 'safety'], control: 'number', validation: { minimum: 1, step: 1 } },
    { id: 'memoryBudgetMb', label: 'Memory budget', required: true, editable: true, impact: ['cost', 'safety'], control: 'number', validation: { minimum: 1000, step: 1 } },
    { id: 'persistenceDestination', label: 'Persistence destination', required: true, editable: false, impact: ['output'], control: 'readonly', defaultValue: FACTOR_MINING_PERSISTENCE_DESTINATION, defaultSource: 'TICKET_1239:registry-owner' },
    // TICKET_1370 R10/AC25: native date pickers on both surfaces. The user
    // selects inclusive calendar dates; `toExecutionWindow` owns the
    // conversion to the canonical half-open UTC interval.
    { id: 'startDate', label: 'Data window start', required: true, editable: true, impact: ['scope', 'cost', 'duration'], control: 'date' },
    { id: 'endDate', label: 'Data window end', required: true, editable: true, impact: ['scope', 'cost', 'duration'], control: 'date' },
  ],
};

function flattenDraft(draft: FactorMiningDraft): Record<string, WorkloadJsonValue | undefined> {
  return {
    engine: draft.engine,
    marketScopeSource: draft.marketScopeSource,
    symbols: draft.symbols,
    preset: draft.preset,
    timeframes: draft.timeframes,
    startDate: draft.startDate,
    endDate: draft.endDate,
    'gpquant.generations': draft.gpquant?.generations,
    'gpquant.population': draft.gpquant?.population,
    'gpquant.runs': draft.gpquant?.runs,
    'gpquant.hallOfFame': draft.gpquant?.hallOfFame,
    'gpquant.seed': draft.gpquant?.seed,
    'gpquant.minIc': draft.gpquant?.minIc,
    'gpquant.maxCorrelation': draft.gpquant?.maxCorrelation,
    'gpquant.oosRatio': draft.gpquant?.oosRatio,
    'gpquant.maxTrainBars': draft.gpquant?.maxTrainBars,
    concurrency: draft.concurrency,
    blasThreads: draft.blasThreads,
    memoryBudgetMb: draft.memoryBudgetMb,
    persistenceDestination: draft.persistenceDestination,
  };
}

export interface FactorMiningDerivedContext {
  readonly version: string;
  readonly concurrency: number;
  readonly blasThreads: number;
  readonly memoryBudgetMb: number;
  readonly bindingConstraint: FactorMiningResourceGeometry['bindingConstraint'];
  /**
   * TICKET_1370 R10/AC27: physical coverage for the currently selected cells.
   * Supplied by the storage owner, which is the only layer permitted to read
   * it. Absent while the market scope or timeframes are still unresolved --
   * there is nothing to derive a window from yet.
   */
  readonly coverage?: FactorMiningCoverageWindow;
  /**
   * TICKET_1370 R10/AC28: why coverage could not be derived. Surfaced as an
   * actionable structured error; the window is left unresolved rather than
   * filled with an invented default.
   */
  readonly coverageError?: StructuredWorkloadValidationError;
}

export interface FactorMiningParameterValidationResult {
  readonly valid: boolean;
  readonly errors: readonly StructuredWorkloadValidationError[];
}

function contextualSpecification(
  context: FactorMiningDerivedContext,
): WorkloadParameterSpecification {
  const dateBounds = context.coverage === undefined ? undefined : {
    minimumDate: context.coverage.minimumDate,
    maximumDate: context.coverage.maximumDate,
  };
  return {
    ...FACTOR_MINING_PARAMETER_SPECIFICATION,
    parameters: FACTOR_MINING_PARAMETER_SPECIFICATION.parameters.map(definition => (
      definition.id === 'startDate' || definition.id === 'endDate'
        ? {
          ...definition,
          dateBounds,
          defaultSource: context.coverage === undefined
            ? undefined
            : `${FACTOR_MINING_COVERAGE_DEFAULT_SOURCE}:${context.coverage.snapshotVersion}`,
          defaultRole: context.coverage === undefined ? undefined : 'calculated-from-coverage' as const,
        }
        : definition
    )),
  };
}

function miningError(
  code: string,
  parameterIds: readonly string[],
  message: string,
  remediation: string,
): StructuredWorkloadValidationError {
  return { code, parameterIds, message, remediation };
}

/** The only complete factor-mining parameter validation operation. */
export function validateFactorMiningParameters(
  parameters: readonly ResolvedWorkloadParameter[],
  currentContext: FactorMiningDerivedContext,
): FactorMiningParameterValidationResult {
  const errors = [...validateWorkloadParameters(contextualSpecification(currentContext), parameters)];
  const values = Object.fromEntries(parameters.map(parameter => [parameter.id, parameter.value]));
  errors.push(...resolveMarketScope(values).errors);

  const horizon = resolveHorizonByTimeframe(values.timeframes, values.horizonByTimeframe);
  errors.push(...horizon.errors);
  if (values.engine !== 'gpquant') {
    errors.push(miningError('MINING_ENGINE_NOT_GPQUANT', ['engine'], 'This launch contract requires engine gpquant.', 'Select gpquant for this operation.'));
  }

  if (typeof values.startDate === 'string' && typeof values.endDate === 'string') {
    try {
      toExecutionWindow(values.startDate, values.endDate);
      if (currentContext.coverage !== undefined
        && (values.startDate < currentContext.coverage.minimumDate
          || values.endDate > currentContext.coverage.maximumDate)) {
        errors.push(miningError(
          'MINING_WINDOW_INVALID', ['startDate', 'endDate'],
          `The selected data window ${values.startDate} through ${values.endDate} is outside the authoritative physical coverage ${currentContext.coverage.minimumDate} through ${currentContext.coverage.maximumDate}.`,
          'Select inclusive start and end dates within the advertised physical coverage bounds.',
        ));
      }
    } catch (reason) {
      errors.push(miningError(
        'MINING_WINDOW_INVALID', ['startDate', 'endDate'],
        reason instanceof Error ? reason.message : String(reason),
        reason instanceof WorkloadDateWindowError ? reason.remediation : 'Select a valid calendar date range.',
      ));
    }
  }

  for (const id of ['startDate', 'endDate'] as const) {
    const parameter = parameters.find(item => item.id === id);
    if (parameter?.provenance === 'derived' && currentContext.coverage !== undefined) {
      const expectedSource = `${FACTOR_MINING_COVERAGE_DEFAULT_SOURCE}:${currentContext.coverage.snapshotVersion}`;
      if (parameter.defaultRole !== 'calculated-from-coverage' || parameter.defaultSource !== expectedSource) {
        errors.push(miningError('MINING_COVERAGE_DEFAULT_METADATA_INVALID', [id], `Calculated coverage default metadata for '${id}' is invalid.`, 'Resolve a fresh review from the physical coverage owner.'));
      }
    }
  }

  const population = values['gpquant.population'];
  const hallOfFame = values['gpquant.hallOfFame'];
  if (typeof population === 'number' && typeof hallOfFame === 'number' && hallOfFame > population) {
    errors.push(miningError('MINING_HALL_OF_FAME_INVALID', ['gpquant.hallOfFame', 'gpquant.population'], 'Hall of fame cannot exceed the GPQuant population.', 'Reduce hall of fame or increase the population.'));
  }
  if (values['gpquant.oosRatio'] === 1) {
    errors.push(miningError('MINING_OOS_RATIO_INVALID', ['gpquant.oosRatio'], 'OOS ratio must leave at least part of the data for training.', 'Use an OOS ratio below 1.'));
  }

  const concurrency = values.concurrency;
  const blasThreads = values.blasThreads;
  const memoryBudgetMb = values.memoryBudgetMb;
  if (typeof concurrency === 'number' && concurrency > currentContext.concurrency) {
    errors.push(miningError('MINING_CONCURRENCY_INVALID', ['concurrency'], `Concurrency exceeds the current limit ${currentContext.concurrency}.`, 'Use the current resource geometry returned by the owner.'));
  }
  if (typeof blasThreads === 'number' && blasThreads > currentContext.blasThreads) {
    errors.push(miningError('MINING_BLAS_THREADS_INVALID', ['blasThreads'], `BLAS threads exceed the current limit ${currentContext.blasThreads}.`, 'Use the current resource geometry returned by the owner.'));
  }
  if (typeof concurrency === 'number' && typeof blasThreads === 'number'
    && concurrency * blasThreads > currentContext.concurrency * currentContext.blasThreads) {
    errors.push(miningError('MINING_CPU_GEOMETRY_INVALID', ['concurrency', 'blasThreads'], 'Process and BLAS thread demand exceeds the current CPU geometry.', 'Reduce process concurrency or BLAS threads.'));
  }
  if (typeof memoryBudgetMb === 'number' && memoryBudgetMb > currentContext.memoryBudgetMb) {
    errors.push(miningError('MINING_MEMORY_BUDGET_INVALID', ['memoryBudgetMb'], `Memory budget exceeds the current limit ${currentContext.memoryBudgetMb} MB.`, 'Use a memory budget within the current resource geometry.'));
  }
  if (values.persistenceDestination !== FACTOR_MINING_PERSISTENCE_DESTINATION) {
    errors.push(miningError('MINING_PERSISTENCE_DESTINATION_INVALID', ['persistenceDestination'], 'Factor output must use the canonical factor registry.', 'Resolve a fresh review with the authoritative persistence destination.'));
  }
  return { valid: errors.length === 0, errors };
}

/** Recover the immutable reviewed validation context without surface logic. */
export function factorMiningValidationContextFromReview(
  review: WorkloadPrelaunchReview,
): FactorMiningDerivedContext {
  const byId = new Map(review.parameters.map(parameter => [parameter.id, parameter]));
  const bounds = byId.get('startDate')?.dateBounds ?? byId.get('endDate')?.dateBounds;
  const minimumDate = bounds?.minimumDate;
  const maximumDate = bounds?.maximumDate;
  const coverage = minimumDate === undefined || maximumDate === undefined
    ? undefined
    : {
      ...toExecutionWindow(minimumDate, maximumDate),
      minimumDate,
      maximumDate,
      snapshotVersion: (byId.get('startDate')?.defaultSource ?? byId.get('endDate')?.defaultSource
        ?? review.derivedContextVersion).replace(`${FACTOR_MINING_COVERAGE_DEFAULT_SOURCE}:`, ''),
    };
  const numeric = (id: string): number => {
    const value = byId.get(id)?.value;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  const binding = review.estimatedWork.bindingConstraint;
  return {
    version: review.derivedContextVersion,
    concurrency: numeric('concurrency'),
    blasThreads: numeric('blasThreads'),
    memoryBudgetMb: numeric('memoryBudgetMb'),
    bindingConstraint: binding === 'cpu' || binding === 'memory' || binding === 'repository-cap'
      ? binding
      : 'repository-cap',
    coverage: coverage === undefined ? undefined : {
      startUtc: coverage.startUtc,
      endUtcExclusive: coverage.endUtcExclusive,
      minimumDate: coverage.minimumDate,
      maximumDate: coverage.maximumDate,
      snapshotVersion: coverage.snapshotVersion,
    },
  };
}

/**
 * TICKET_1370 AC27 / TICKET_1382 AC15: one owner composes the complete
 * factor-mining derived-context identity for review, edit, and launch. The
 * physical coverage snapshot is deliberately part of this value because it
 * determines the reviewed executable window.
 */
export function factorMiningDerivedContextVersion(
  context: Pick<FactorMiningDerivedContext, 'version' | 'coverage'>,
): string {
  return context.coverage === undefined
    ? context.version
    : `${context.version}:${context.coverage.snapshotVersion}`;
}

/**
 * TICKET_1370 R9/AC22: the resolved universe drives estimated work. Before R9
 * this multiplied `draft.symbols.length`, which was zero for every preset
 * launch -- the reviewed cell count silently disagreed with what executed.
 */
export function factorMiningEstimatedCells(
  values: Readonly<Record<string, WorkloadJsonValue>>,
): number {
  const scope = resolveMarketScope(values).scope;
  const timeframes = Array.isArray(values.timeframes) ? values.timeframes.length : 0;
  return (scope?.resolvedSymbols.length ?? 0) * timeframes;
}

/**
 * TICKET_1370 R11/AC33: the timeframes that will actually be reviewed, which is
 * what the horizon map must be derived from. `explicit` wins where the caller
 * supplied it; otherwise the specification default applies -- the same
 * precedence `resolvePrelaunchReview` uses, so the derived map can never
 * describe a different timeframe set than the one the card displays.
 */
function effectiveTimeframes(
  explicit: Readonly<Record<string, WorkloadJsonValue | undefined>>,
): WorkloadJsonValue | undefined {
  return explicit.timeframes ?? [...FACTOR_MINING_DEFAULT_TIMEFRAMES];
}

function resolutionInput(
  context: FactorMiningDerivedContext,
  explicit: Readonly<Record<string, WorkloadJsonValue | undefined>>,
): Omit<WorkloadResolutionInput, 'explicit'> {
  const horizon = resolveHorizonByTimeframe(
    effectiveTimeframes(explicit),
    explicit.horizonByTimeframe,
  );
  return {
    derived: {
      horizonByTimeframe: horizon.horizonByTimeframe,
      concurrency: context.concurrency,
      blasThreads: context.blasThreads,
      memoryBudgetMb: context.memoryBudgetMb,
      // TICKET_1370 R10/AC27: both dates are pre-populated from the derived
      // common coverage range and carry `provenance: derived`, but stay
      // editable within the advertised bounds.
      startDate: context.coverage === undefined ? undefined : context.coverage.minimumDate,
      endDate: context.coverage === undefined ? undefined : context.coverage.maximumDate,
    },
    // AC27: the coverage snapshot version participates in the derived context
    // version, so re-deriving a different window invalidates the fingerprint.
    derivedContextVersion: factorMiningDerivedContextVersion(context),
  };
}

function withCoverageMetadata(
  review: WorkloadPrelaunchReview,
  context: FactorMiningDerivedContext,
): WorkloadPrelaunchReview {
  const bounds = context.coverage === undefined
    ? undefined
    : { minimumDate: context.coverage.minimumDate, maximumDate: context.coverage.maximumDate };
  return {
    ...review,
    parameters: review.parameters.map(parameter => (
      bounds !== undefined && (parameter.id === 'startDate' || parameter.id === 'endDate')
        ? {
          ...parameter,
          dateBounds: bounds,
          defaultSource: parameter.provenance === 'derived'
            ? `${FACTOR_MINING_COVERAGE_DEFAULT_SOURCE}:${context.coverage?.snapshotVersion}`
            : parameter.defaultSource,
          defaultRole: parameter.provenance === 'derived'
            ? 'calculated-from-coverage' as const
            : undefined,
        }
        : parameter
    )),
  };
}

function withFactorMiningValidation(
  review: WorkloadPrelaunchReview,
  context: FactorMiningDerivedContext,
): WorkloadPrelaunchReview {
  const validation = validateFactorMiningParameters(review.parameters, context);
  const combined = [
    ...review.validationErrors,
    ...validation.errors,
    ...(context.coverageError === undefined ? [] : [context.coverageError]),
  ];
  const seen = new Set<string>();
  return {
    ...review,
    validationErrors: combined.filter(item => {
      const identity = `${item.code}:${item.parameterIds.join(',')}:${item.message}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }),
  };
}

/**
 * TICKET_1370 R11/AC31+AC35: recompute the reviewed work summary from the
 * RESOLVED parameter values -- the ones the card actually displays, including
 * defaults -- rather than from the caller's sparse input. A defaulted preset
 * launch previously reported 0 cells because nothing explicit was supplied,
 * which is precisely the reviewed-versus-executed disagreement TICKET_1363
 * forbids. The summary is what the surface renders as the high-impact review
 * prompt: universe size, timeframes, and cell count.
 */
function withReviewSummary(
  review: WorkloadPrelaunchReview,
  context: FactorMiningDerivedContext,
): WorkloadPrelaunchReview {
  const values = Object.fromEntries(review.parameters.map(parameter => [parameter.id, parameter.value]));
  const timeframes = Array.isArray(values.timeframes) ? values.timeframes as readonly WorkloadJsonValue[] : [];
  return {
    ...review,
    estimatedWork: {
      cells: factorMiningEstimatedCells(values),
      resolvedSymbolCount: resolveMarketScope(values).scope?.resolvedSymbols.length ?? 0,
      timeframes: [...timeframes],
      bindingConstraint: context.bindingConstraint,
      // AC31: defaults are shown, never silently accepted. The surface renders
      // this prompt so the user knows the high-impact values are pre-populated
      // and that changing them re-derives the whole plan (AC35).
      reviewPrompt: 'Review market scope and timeframes before launch. Changing either re-derives the data window, forecast horizons, estimated work, and plan fingerprint.',
    },
  };
}

export function resolveFactorMiningReview(
  draft: FactorMiningDraft,
  context: FactorMiningDerivedContext,
): WorkloadPrelaunchReview {
  const explicit = flattenDraft(draft);
  const review = resolvePrelaunchReview(contextualSpecification(context), {
    ...resolutionInput(context, { ...explicit, horizonByTimeframe: draft.horizonByTimeframe }),
    explicit,
  });
  return withFactorMiningValidation(withCoverageMetadata(withReviewSummary(review, context), context), context);
}

/**
 * Re-resolve a serialized confirmed plan against the current derived context.
 * Existing explicit and persisted choices remain choices; defaults and
 * derived values are reacquired from their authoritative owners. This is the
 * launch-time half of TICKET_1370 AC27 and also supplies the actionable fresh
 * review required when physical coverage changed after confirmation.
 */
export function resolveCurrentFactorMiningReview(
  confirmedPlan: ConfirmedWorkloadPlan,
  context: FactorMiningDerivedContext,
): WorkloadPrelaunchReview {
  const explicit = Object.fromEntries(confirmedPlan.parameters
    .filter(parameter => parameter.provenance === 'explicit')
    .map(parameter => [parameter.id, parameter.value]));
  const persisted = Object.fromEntries(confirmedPlan.parameters
    .filter(parameter => parameter.provenance === 'persisted')
    .map(parameter => [parameter.id, parameter.value]));
  const review = resolvePrelaunchReview(contextualSpecification(context), {
    ...resolutionInput(context, { ...persisted, ...explicit }),
    explicit,
    persisted,
  });
  return withFactorMiningValidation(withCoverageMetadata(withReviewSummary(review, context), context), context);
}

export function editFactorMiningReview(
  review: WorkloadPrelaunchReview,
  edits: Readonly<Record<string, WorkloadJsonValue>>,
  context: FactorMiningDerivedContext,
): WorkloadPrelaunchReview {
  // AC6: a user edit to a non-editable parameter is refused here, against the
  // caller's own keys, because the normalization below legitimately rewrites
  // owner-derived parameters the user may not edit directly.
  assertEditableParameters(FACTOR_MINING_PARAMETER_SPECIFICATION, edits);
  // TICKET_1370 R9/AC21: switching the market-scope source drops the other
  // mode's input, so an edit cannot leave both a preset and a custom list in
  // the plan for a later layer to choose between.
  const normalized: Record<string, WorkloadJsonValue | undefined> = { ...edits };
  if (edits.marketScopeSource === 'preset') normalized.symbols = undefined as unknown as WorkloadJsonValue;
  if (edits.marketScopeSource === 'custom') normalized.preset = undefined as unknown as WorkloadJsonValue;
  // TICKET_1370 R11/AC35: clear the previous horizon map so the freshly derived
  // one is what resolves. `applyPrelaunchEdits` carries every current value
  // forward as `explicit`, which outranks `derived` -- without this the map
  // would keep describing the timeframes the user just replaced.
  normalized.horizonByTimeframe = undefined as unknown as WorkloadJsonValue;
  if (edits.marketScopeSource !== undefined || edits.preset !== undefined
    || edits.symbols !== undefined || edits.timeframes !== undefined) {
    if (edits.startDate === undefined) normalized.startDate = undefined;
    if (edits.endDate === undefined) normalized.endDate = undefined;
  }
  // TICKET_1370 R11/AC35: the horizon map is derived from the POST-edit
  // timeframes. Deriving it from the pre-edit review would confirm a plan whose
  // horizons describe the timeframe set the user just replaced.
  const priorExplicit = Object.fromEntries(review.parameters
    .filter(parameter => parameter.provenance === 'explicit')
    .map(parameter => [parameter.id, parameter.value]));
  const persisted = Object.fromEntries(review.parameters
    .filter(parameter => parameter.provenance === 'persisted')
    .map(parameter => [parameter.id, parameter.value]));
  const explicit = { ...priorExplicit, ...normalized };
  const edited = resolvePrelaunchReview(contextualSpecification(context), {
    ...resolutionInput(context, { ...persisted, ...explicit }),
    explicit,
    persisted,
  });
  // AC29/AC35: changing market scope or timeframes re-derives estimated work,
  // the resolved universe, and the horizon map as part of the same replacement
  // review the user confirms.
  return withFactorMiningValidation(withCoverageMetadata(withReviewSummary(edited, context), context), context);
}
