import type {
  ConfirmedWorkloadPlan,
  StructuredWorkloadValidationError,
  WorkloadPrelaunchErrorResult,
  WorkloadPrelaunchReview,
  WorkloadJsonValue,
} from './workload-prelaunch';
import { WORKLOAD_PRELAUNCH_ERROR_CODES } from './workload-prelaunch';

export const FACTOR_MINING_PLAN_SPECIFICATION_ID = 'quantnexus.factor-mining' as const;
export const FACTOR_MINING_PLAN_SPECIFICATION_VERSION = '1.0.0' as const;
export const FACTOR_MINING_ENGINES = ['gplearn', 'gpquant', 'pysr'] as const;
export type FactorMiningEngine = typeof FACTOR_MINING_ENGINES[number];

export const FACTOR_MINING_TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1d'] as const;
export type FactorMiningTimeframe = typeof FACTOR_MINING_TIMEFRAMES[number];

export const FACTOR_MINING_PRESETS = ['g10-28'] as const;
export type FactorMiningPreset = typeof FACTOR_MINING_PRESETS[number];

/**
 * TICKET_1370 R11/AC30: the repository's authoritative mining defaults. These
 * remove avoidable missing-field dead ends from the initial review while
 * remaining ordinary editable high-impact parameters -- a default is never an
 * implicit confirmation or launch.
 */
export const FACTOR_MINING_DEFAULT_MARKET_SCOPE_SOURCE = 'preset' as const;
export const FACTOR_MINING_DEFAULT_PRESET: FactorMiningPreset = 'g10-28';
export const FACTOR_MINING_DEFAULT_TIMEFRAMES: readonly FactorMiningTimeframe[] =
  ['5m', '15m', '30m', '1h'];
export const FACTOR_MINING_DEFAULT_SCOPE_SOURCE_REF = 'TICKET_1239:mining-universe-convention';
export const FACTOR_MINING_DEFAULT_TIMEFRAMES_SOURCE_REF = 'TICKET_1262:sweep-config-parity';

/**
 * TICKET_1370 R11/AC33: the normalized per-timeframe forecast horizon. A single
 * global scalar could silently replace the timeframe-dependent rule for a mixed
 * batch -- forcing the `1h` cells to use the `5m` horizon -- so the reviewed,
 * fingerprinted, and executed plan carries one assignment per selected
 * timeframe instead.
 */
export type FactorMiningHorizonMap = { readonly [timeframe: string]: number };

/**
 * TICKET_1370 R11/AC33: the one authoritative timeframe-to-horizon rule.
 * `scripts/factor_mining/universe.py:get_horizon` is the same mapping; Python
 * consumes the confirmed map at execution time rather than re-deriving it, and
 * a cross-language contract test asserts the two agree.
 */
export const FACTOR_MINING_INTRADAY_HORIZON = 5;
export const FACTOR_MINING_SLOW_HORIZON = 1;
export const FACTOR_MINING_INTRADAY_TIMEFRAMES: readonly FactorMiningTimeframe[] =
  ['5m', '15m', '30m'];
export const FACTOR_MINING_HORIZON_SOURCE_REF = 'scripts/factor_mining/universe.py:get_horizon:v1';

/**
 * TICKET_1370 R9/AC21: the user makes one market-scope decision with two input
 * modes. Storage and the CLI keep `preset`/`symbols` as their representation,
 * but neither the surface nor the runtime may choose between them -- exactly
 * one is meaningful, selected by this source.
 */
/**
 * TICKET_1370 R9/AC22: the one authoritative `g10-28` expansion. Python's
 * `scripts/factor_mining/universe.py:G10_28` is the same list in the same
 * order; a cross-language contract test asserts byte-for-byte equality after
 * canonical serialization so the two cannot drift.
 */
export const FACTOR_MINING_PRESET_SYMBOLS: Readonly<Record<FactorMiningPreset, readonly string[]>> = {
  'g10-28': [
    'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD',
    'EURJPY', 'EURGBP', 'EURAUD', 'EURCAD', 'EURCHF', 'EURNZD',
    'GBPJPY', 'GBPAUD', 'GBPCAD', 'GBPCHF', 'GBPNZD',
    'AUDJPY', 'AUDCAD', 'AUDCHF', 'AUDNZD',
    'NZDJPY', 'NZDCAD', 'NZDCHF',
    'CADJPY', 'CADCHF', 'CHFJPY',
  ],
};

export const FACTOR_MINING_MARKET_SCOPE_SOURCES = ['preset', 'custom'] as const;
export type FactorMiningMarketScopeSource = typeof FACTOR_MINING_MARKET_SCOPE_SOURCES[number];

/**
 * TICKET_1370 R9/AC22: the canonical normalized execution universe. Every
 * downstream layer -- estimated work, fingerprint, confirmation, admission,
 * child-process arguments, persistence, status -- consumes this list. No layer
 * re-expands a preset or applies preset-over-symbols precedence.
 */
export interface FactorMiningMarketScope {
  readonly source: FactorMiningMarketScopeSource;
  readonly preset?: FactorMiningPreset;
  readonly symbols?: readonly string[];
  readonly resolvedSymbols: readonly string[];
}

/**
 * TICKET_1370 R10/AC26: the canonical half-open execution interval. The user
 * selects inclusive calendar dates; this is what every owning layer and the
 * Python parquet predicate consume. The runtime uses `< endUtcExclusive`,
 * never `<=` against the same instant.
 */
export interface FactorMiningExecutionWindow {
  readonly selectedStartDate: string;
  readonly selectedEndDate: string;
  readonly startUtc: string;
  readonly endUtcExclusive: string;
}

/** TICKET_1370 R10/AC27: physical coverage for one symbol x timeframe cell. */
export interface FactorMiningCoverageCell {
  readonly symbol: string;
  readonly timeframe: string;
  readonly firstTimestampMs: number;
  readonly lastTimestampMs: number;
}

/**
 * TICKET_1370 R10/AC27: the maximal common executable interval across every
 * selected cell, plus the picker bounds derived from it. `snapshotVersion`
 * participates in `derivedContextVersion` and therefore the plan fingerprint,
 * so a coverage change invalidates a confirmed plan.
 */
export interface FactorMiningCoverageWindow {
  readonly startUtc: string;
  readonly endUtcExclusive: string;
  readonly minimumDate: string;
  readonly maximumDate: string;
  readonly snapshotVersion: string;
}

export interface GpquantMiningConfiguration {
  readonly engine: 'gpquant';
  readonly generations: number;
  readonly population: number;
  readonly runs: number;
  readonly hallOfFame: number;
  readonly seed: number;
  readonly minIc: number;
  readonly maxCorrelation: number;
  readonly oosRatio: number;
  readonly maxTrainBars: number | null;
}

export interface FactorMiningDraft {
  readonly engine?: FactorMiningEngine;
  readonly marketScopeSource?: FactorMiningMarketScopeSource;
  readonly symbols?: readonly string[];
  readonly preset?: string;
  readonly timeframes?: readonly string[];
  /**
   * TICKET_1370 R11/AC33: an optional EXPLICIT per-timeframe override. Omitted
   * in the ordinary case, where the shared owner derives the map from the
   * selected timeframes. A batch-wide scalar is deliberately not accepted --
   * it is what let a mixed-timeframe plan be silently flattened.
   */
  readonly horizonByTimeframe?: FactorMiningHorizonMap;
  // TICKET_1370 R10/AC25: inclusive user-selected calendar dates. The canonical
  // half-open `[startUtc, endUtcExclusive)` execution interval is derived by
  // the shared date adapter and never typed by the user.
  readonly startDate?: string;
  readonly endDate?: string;
  readonly gpquant?: Partial<Omit<GpquantMiningConfiguration, 'engine'>>;
  readonly concurrency?: number;
  readonly blasThreads?: number;
  readonly memoryBudgetMb?: number;
  readonly persistenceDestination?: 'canonical-factor-registry';
}

export interface FactorMiningResourceGeometry {
  readonly decisionId: string;
  readonly effectiveCpu: number;
  readonly effectiveMemoryMb: number;
  readonly concurrency: number;
  readonly blasThreads: number;
  readonly memoryBudgetMb: number;
  readonly bindingConstraint: 'cpu' | 'memory' | 'repository-cap';
  readonly cgroupCpuQuota: number | null;
  readonly cgroupMemoryLimitMb: number | null;
}

export interface FactorMiningLaunchRequest {
  readonly confirmedPlan: ConfirmedWorkloadPlan;
}

export type FactorMiningTaskState =
  | 'queued' | 'running' | 'completed' | 'completed-no-candidate' | 'failed' | 'cancelled';

export const FACTOR_MINING_ERROR_CODES = [
  ...WORKLOAD_PRELAUNCH_ERROR_CODES,
  'GPQUANT_CAPABILITY_UNAVAILABLE',
  // TICKET_1370 R10/AC28: coverage could not derive a window. Structured and
  // actionable -- never substituted with a fixed date, host-clock lookback,
  // placeholder, or full-history scan.
  'MINING_COVERAGE_UNAVAILABLE',
  'WORKLOAD_ADMISSION_REFUSED',
  'MINING_PROCESS_LAUNCH_FAILED',
  'MINING_EXECUTION_FAILED',
  'MINING_PERSISTENCE_FAILED',
] as const;
export type FactorMiningErrorCode = typeof FACTOR_MINING_ERROR_CODES[number];

export interface FactorMiningLaunchSuccess {
  readonly ok: true;
  readonly taskId: string;
  readonly engine: 'gpquant';
  readonly state: 'queued' | 'running';
  readonly normalizedPlan: ConfirmedWorkloadPlan;
  readonly planFingerprint: string;
  readonly specificationVersion: typeof FACTOR_MINING_PLAN_SPECIFICATION_VERSION;
  readonly resourceDecision: FactorMiningResourceGeometry;
  readonly governanceDecisionId: string;
  readonly requestId: string;
}

export interface FactorMiningFailure extends Omit<WorkloadPrelaunchErrorResult, 'code'> {
  readonly ok: false;
  readonly code: FactorMiningErrorCode;
  readonly requestId: string;
  readonly governanceDecisionId?: string;
  readonly resourceDecisionId?: string;
}

export type FactorMiningLaunchResult = FactorMiningLaunchSuccess | FactorMiningFailure;

export interface FactorMiningTaskStatus {
  readonly taskId: string;
  readonly engine: 'gpquant';
  readonly state: FactorMiningTaskState;
  readonly normalizedPlan: ConfirmedWorkloadPlan;
  readonly planFingerprint: string;
  readonly specificationVersion: typeof FACTOR_MINING_PLAN_SPECIFICATION_VERSION;
  readonly resourceDecision: FactorMiningResourceGeometry;
  readonly governanceDecisionId: string;
  readonly requestId: string;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
  readonly processId?: number;
  readonly systemdUnit?: string;
  readonly exitCode?: number;
  readonly result?: Readonly<Record<string, WorkloadJsonValue>>;
  readonly failure?: FactorMiningFailure;
}

export interface FactorMiningReviewResult {
  readonly review: WorkloadPrelaunchReview;
  readonly domainErrors: readonly StructuredWorkloadValidationError[];
}
