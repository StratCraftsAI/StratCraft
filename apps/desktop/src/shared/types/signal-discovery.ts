/**
 * Signal Discovery Types
 *
 * TICKET_568_1: LLM-Driven Hypothesis-Testing Signal Discovery
 * Single source of truth for all signal discovery types shared across main/renderer/plugin.
 */

import type { TrainingBars, TrainingBarWorkload } from '@StratCraft/types';
import type { FACTOR_COMBINATOR_METHODS } from '@StratCraft/types';

// =============================================================================
// Enums & Literals
// =============================================================================

/** Signal layers define the abstraction level of statistical patterns */
export type SignalLayer = 'layer_1' | 'layer_2' | 'layer_3';

/**
 * TICKET_568_5_1: Data layer discriminator for a discovered signal.
 *
 * - `'price'`     -- Layer 1 / Layer 2 signals derived from OHLCV. No PIT
 *                    contract required (price is honest).
 * - `'alternative'` -- Layer 3 signals derived from an alternative-data
 *                      provider. The persistence path enforces that the
 *                      provider declares `vintage_supported: true`; otherwise
 *                      the signal is refused with a pointer to TICKET_196_7_7.
 */
export type DataLayer = 'price' | 'alternative';

/**
 * TICKET_568_5_1: Layer 3 alternative-data factor categories.
 *
 * Phase 1 lands the type only. Only `'macro'` will have a provider
 * implementation in Phase 3 (FRED + ALFRED vintage archive); the remaining
 * three categories are visible-but-disabled in the UI until their respective
 * follow-up tickets (a/b/c) ship.
 */
export type AlternativeFactorCategory = 'macro' | 'sentiment' | 'fund_flow' | 'on_chain';

/**
 * TICKET_568_5_1: Row shape every Layer 3 alternative-data provider MUST
 * emit. The key invariant is the `event_time` / `knowledge_time` pair --
 * historical joins for backtests must key on `knowledge_time <= bar_time`,
 * never on `event_time`. Look-ahead bias is the most insidious failure mode
 * for alt-data (right-looking timestamp, wrong-looking data).
 */
export interface AlternativeFactorRow {
  /** Top-level category (matches `IAlternativeDataProvider.source`) */
  category: AlternativeFactorCategory;
  /** Provider-specific factor identifier (e.g. `'vix_term_structure'`) */
  factor_name: string;
  /** Symbol the row pertains to; omitted for market-wide series (e.g. VIX) */
  symbol?: string;
  /** ISO8601 -- when the underlying event occurred */
  event_time: string;
  /** ISO8601 -- when the value first became knowable to the investor */
  knowledge_time: string;
  /** Numeric factor value */
  value: number;
  /**
   * Optional revision identifier. Present iff the source provider declares
   * `vintage_supported: true`. Macro series (GDP, CPI, ...) get revised after
   * first publication; backtests need the value the investor actually saw at
   * the time, not the latest-revision value most APIs return by default.
   */
  vintage_id?: string;
  /** Provider id, e.g. `'fred'`, `'glassnode'` */
  source_provider: string;
}

/**
 * TICKET_568_5_1: Historical fetch request for an alt-data provider.
 * `vintage_as_of` (when set + supported by provider) requests the as-of
 * snapshot of the series at that knowledge time.
 */
export interface AlternativeDataRequest {
  /** Optional symbol; omit for market-wide series */
  symbol?: string;
  /** Top-level category (must match the provider's `source`) */
  category: AlternativeFactorCategory;
  /** Provider-specific factor identifier */
  factor_name: string;
  /** ISO8601 inclusive lower bound on `event_time` */
  start_time: string;
  /** ISO8601 inclusive upper bound on `event_time` */
  end_time: string;
  /**
   * ISO8601. When set on a `vintage_supported: true` provider, returns the
   * series as it was known at this knowledge time. Ignored on providers
   * without vintage support.
   */
  vintage_as_of?: string;
}

/** Signal categories within Layer 1 (Price Statistical Patterns) */
export type SignalCategory =
  | 'mean_reversion'
  | 'momentum_decay'
  | 'volatility_clustering'
  | 'serial_correlation'
  | 'distribution_anomaly'
  | 'regime_detection';

/** Discovery round index (1-based) */
export type DiscoveryRound = 1 | 2 | 3 | 4;

/** Human-readable round names */
export type DiscoveryRoundName =
  | 'hypothesis_generation'
  | 'test_code_generation'
  | 'statistical_validation'
  | 'signal_assembly';

/** Round execution status */
export type DiscoveryRoundStatus = 'pending' | 'started' | 'completed' | 'failed' | 'skipped';

/** Overall discovery session status */
export type DiscoveryStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'error';

// =============================================================================
// User Input
// =============================================================================

/** Configuration provided by the user to start a discovery session */
export interface DiscoveryConfig {
  /** Signal layer (Phase 1: layer_1 only) */
  signalLayer: SignalLayer;
  /** Selected signal categories to explore */
  categories: SignalCategory[];
  /** Whether to run statistical validation against real data (Round 3) */
  enableValidation?: boolean;
  /** Target asset symbol for validation (required when enableValidation=true) */
  symbol?: string;
  /**
   * TICKET_927_1_2_A: data provider id that owns `symbol` (single-symbol
   * modes: hypothesis, factor combo, single-asset sweep). The producer
   * needs this to construct the `trainingUniverse` descriptor threaded
   * into `persistSignal()` so `nona_signal.market_scope` is written at
   * INSERT time via the tier-0 `staticInstrumentRegistry` (TICKET_927_1_1).
   *
   * Universe-mode runs ignore this -- `universe.provider` / `universe.sleeves`
   * are the canonical source for those paths. Omitted on a single-symbol
   * run that reaches `persistSignal` triggers a fail-fast refuse
   * (TICKET_857); never a silent default to "all markets" (TICKET_860).
   */
  provider?: string;
  /** Data timeframe for validation (e.g., "1d", "1h") */
  timeframe?: string;
  /**
   * Training-bar budget for one dispatch (TICKET_846 + TICKET_842 line 766).
   *
   * UNIT: bars (NOT days). The slider in `ToolSweepTab.tsx` is labelled
   * "Training bars"; the host converts to a calendar window via
   * `trainingBarsToCalendarMs(bars, timeframe, assetClass)` from
   * `shared/constants/signal-discovery.ts`. Direct arithmetic like
   * `lookbackBars * 86400000` is a TYPE ERROR (the brand blocks it) and
   * was the regression vector fixed by TICKET_846.
   *
   * Construct via `asTrainingBars(n)` at every boundary (slider onChange,
   * IPC deserialise, SQLite rehydrate) so non-integer / negative values
   * never reach the orchestrator.
   */
  lookbackBars?: TrainingBars;
  /**
   * TICKET_1326 F2: which workload this dispatch is, and therefore which
   * training-bar bounds apply to `lookbackBars`.
   *
   * The budget is a function of `(timeframe, workload)` -- before this field
   * existed, one Preview-tuned ceiling (500) was applied to batch dispatch as
   * well, which made the per-timeframe batch table and TICKET_1262's mandated
   * 8000 unreachable through any path running `validateConfig`.
   *
   *   `preview`  interactive Tool Sweep run (slider-driven, operator waiting).
   *              Keeps the 500 ceiling from TICKET_870 / TICKET_871_1.
   *   `batch`    sweep / scheduler / programmatic dispatch (no slider).
   *
   * Omitted defaults to `preview` -- the narrower bound -- so an un-migrated
   * caller gets a loud rejection rather than a silently oversized window
   * (TICKET_856). Bounds and defaults both resolve from
   * `resolveTrainingBarBudget` in `@StratCraft/types`; no surface keeps a
   * literal.
   */
  trainingWorkload?: TrainingBarWorkload;
  /** Number of hypotheses to generate per category (3-10) */
  hypothesesCount: number;
  /** Significance level for statistical tests (default 0.05) */
  significanceLevel?: number;
  /** LLM provider for API calls */
  llmProvider?: string;
  /** LLM model for API calls */
  llmModel?: string;
  /** TICKET_568_3: Number of signals to generate per batch (1-20) */
  batchSize?: number;
  /** TICKET_568_8 Phase 2: Enable walk-forward validation (multiple sliding windows) */
  enableWalkForward?: boolean;
  /** TICKET_568_8 Phase 2: Number of walk-forward windows (default 5) */
  walkForwardWindows?: number;
  /** TICKET_568_8 Phase 2: Enable smoke test (run code against noise data) */
  enableSmokeTest?: boolean;
  /** TICKET_568_8 Phase 2: Enable cross-signal correlation check post-batch */
  enableCorrelationCheck?: boolean;
  /**
   * TICKET_196_7_5 Phase 2: Discovery mode.
   * - 'hypothesis' (default): legacy 4-round LLM hypothesis-testing loop.
   * - 'tool_sweep': client-side parameter sweep over a tool template (HMM / n-gram / ...).
   *   When set, `templateId` + `paramGrid` are required; `categories` is unused.
   * - 'tool_sweep_bayesian' (TICKET_1171): Optuna TPE-driven hyperparameter
   *   optimization. Uses `bayesianSearchSpace` instead of `paramGrid`.
   */
  mode?: 'hypothesis' | 'tool_sweep' | 'tool_sweep_bayesian';
  /**
   * TICKET_196_7_5: Tool Sweep -- template id (e.g. 'hmm_regime_v1'). One of
   * `templateId` or `templateIds` is required when mode='tool_sweep'.
   *
   * TICKET_821: When the renderer dispatches a multi-template fan-out (the
   * Persona A core-tier default OR a Persona B curated multi-select), it
   * sends `templateIds` instead. `templateId` is the legacy single-template
   * path -- still honoured for backwards compat with explicit picks. Exactly
   * one of the two must be set; the validator rejects "both" or "neither".
   */
  templateId?: string;
  /**
   * TICKET_821: explicit multi-template fan-out. Each entry must be a
   * registered template id; the orchestrator dispatches one arm per entry
   * (replications expanded per `getReplicationCount`). Mutually exclusive
   * with `templateId`. An empty array is a validator error -- the renderer
   * disables Run rather than dispatching empty.
   */
  templateIds?: string[];
  /**
   * TICKET_196_7_5: Tool Sweep -- discrete parameter grid. Each key maps to a list of
   * candidate values; orchestrator builds the cartesian product (capped at 256 points).
   */
  paramGrid?: Record<string, Array<string | number | boolean>>;
  /**
   * TICKET_1171: Bayesian search space definition for `tool_sweep_bayesian`.
   * Each entry defines a dimension: float/int range, categorical, or fixed.
   */
  bayesianSearchSpace?: Array<{
    name: string;
    type: 'float' | 'int' | 'categorical' | 'fixed';
    low?: number;
    high?: number;
    log?: boolean;
    choices?: Array<string | number | boolean>;
    value?: string | number | boolean;
  }>;
  /** TICKET_1171: max TPE trials (default 200). */
  bayesianMaxTrials?: number;
  /** TICKET_1171: TPE random startup trials before surrogate kicks in (default 10). */
  bayesianStartupTrials?: number;
  /** TICKET_1171: path to JSONL warm-start file (grid sweep results). */
  bayesianWarmStartFile?: string;
  /**
   * TICKET_887_4 Phase 5: custom algorithm formula strings. Maps
   * `custom_<name>` template IDs to the user's raw formula string
   * (e.g. `"(close - SMA(close, 20)) / STD(close, 20)"`). The
   * orchestrator passes the formula to `factor_eval_fallback.py
   * --engine custom --formula <string>`. Only present when the user
   * has added custom algorithms via the "+ New" modal.
   */
  customFormulas?: Record<string, string>;
  /**
   * TICKET_196_7_5_2_1 P3: Universe-based Tool Sweep -- when set on
   * `mode === 'tool_sweep'`, the orchestrator resolves N per-symbol parquets,
   * writes a `manifest.json`, and spawns `fit_universe.py` per grid point
   * instead of `fit_one.py`. `universe` and `symbol` are XOR on tool_sweep
   * mode (P4 validator enforces this; the orchestrator throws as
   * defense-in-depth). `singleAssetMode` UX flag from P5 maps to setting
   * `symbol` instead of `universe`.
   */
  universe?: UniverseSpec;
  // TICKET_568_5_3 S3: Layer 2 multi-factor combinator + threshold params.
  // Only consulted when `signalLayer === 'layer_2'` AND `factorIds.length >= 1`.
  // Defaults applied in validateConfig (signal-discovery-handlers.ts).
  /** Selected TA-Lib factor_ids (one or more). */
  factorIds?: string[];
  /** Combinator method (default 'equal_weight'). Accepts built-in methods
   *  from FACTOR_COMBINATOR_METHODS or plugin-registered fusion IDs (TICKET_987 Phase 4). */
  factorCombinator?: (typeof FACTOR_COMBINATOR_METHODS)[number] | (string & {});
  /** Factor evaluation lookback in bars (default 730). */
  factorLookback?: number;
  /** Upper z-score threshold for BUY signal (default +0.5). Range [0, 3.0]. */
  factorSignalUpperThreshold?: number;
  /** Lower z-score threshold for SELL signal (default -0.5). Range [-3.0, 0]. */
  factorSignalLowerThreshold?: number;
  /** Rolling-sigma lookback window in bars (default 252). Range [60, 1000]. */
  factorSignalSigmaLookback?: number;

  // TICKET_196_7_7_1: Layer 3 alt-data discovery payload. Only consulted when
  // `signalLayer === 'layer_3'`. Validator (signal-discovery-handlers.ts)
  // requires `altDataCategory` on Layer 3 and enforces provider registration;
  // `altReducer` / `altReducerLookback` are LLM-driven per candidate and
  // default in validateConfig when omitted (see ALT_DATA_REDUCER_DEFAULT /
  // ALT_DATA_REDUCER_LOOKBACK_DEFAULT in constants/signal-discovery.ts).
  /** Selected alt-data category. Required on Layer 3. */
  altDataCategory?: AlternativeFactorCategory;
  /** Reducer kernel for the live alt-data template. Default `'zscore'`. */
  altReducer?: 'raw' | 'zscore' | 'rank';
  /** Reducer lookback in observations. Default `20`. Range `[2, 1000]`. */
  altReducerLookback?: number;

  /**
   * TICKET_804_1 S7: structured IS/OOS / embargo / walk-forward envelope
   * for Tool Sweep dispatches. When omitted the orchestrator substitutes
   * {@link DEFAULT_DATA_SNAPSHOT_SPEC} -- Medallion-grade default
   * (WF=5, expanding, embargo='auto'). When supplied verbatim, drives the
   * fan-out: a single Run click expands into walk_forward_folds rows
   * per arm sharing one replication_group_id, distinguished by
   * wf_fold_index. See {@link DataSnapshotSpec}.
   */
  dataSnapshotSpec?: DataSnapshotSpec;

  /**
   * TICKET_912 Phase 3: renderer-assigned sidebar run ID echoed back in
   * `complete` / `error` events so the fan-out loop can route each
   * terminal event to the correct sidebar entry instead of relying on
   * the stale `currentRunIdRef`.
   */
  rendererRunId?: string;
}

// =============================================================================
// TICKET_196_7_5_2_1 P3: Universe-based Tool Sweep -- shared payload
// =============================================================================

/**
 * Per-symbol normalization mode applied to the per-symbol observable before
 * pooling. Wire-aligned with `nona_algorithm.signal_sweep._normalize.NORMALIZATION_MODES`
 * (D10: zscore is the default; fracdiff is rejected for the sweep path).
 */
export type UniverseNormalization = 'zscore' | 'rank' | 'none';

/**
 * TICKET_196_7_5_2_3_3_1 Phase 4: cross-market normalisation stance for
 * pooled universes. Controls how factor scores are normalised BEFORE the
 * unified cross-sectional ranking and IC computation.
 *
 * - `pool_vol_adjusted` (default): Option C -- divide by per-sleeve rolling
 *    realized vol, then pool and rank. Removes liquidity-driven amplitude
 *    differences (Amihud 2002).
 * - `within_sleeve`: Option A -- rank within each sleeve independently, then
 *    pool the per-sleeve ranks into one cross-section. Severs the shared
 *    macro signal by forcing each sleeve to contribute equally.
 * - `pool_zscore`: Option B -- z-score normalise per sleeve, then pool and
 *    rank. Removes mean/scale but not fat-tail dominance.
 */
export type PooledNormalisationStance =
  | 'pool_vol_adjusted'
  | 'within_sleeve'
  | 'pool_zscore';

/**
 * Universe selection payload for a tool_sweep run. The renderer's P5
 * UniverseSelector emits this object; the orchestrator turns it into a
 * `manifest.json` for `fit_universe.py`.
 *
 * - `universeId` is the curated list slug (`sp500_top50`, `crypto_top50`,
 *   `g10_fx`, `us_sector_etfs`) or `custom:<hash>` for user lists.
 * - `symbols` is the resolved ticker list (Phase 1: shipped as-is by the
 *   curated list registry; custom-list pre-flight runs in P5).
 * - `normalization` defaults to `zscore` per D10; the orchestrator does not
 *   default this -- the validator (P4) does.
 */
/**
 * TICKET_196_7_5_2_3_3_1 D4: sleeve definition for pooled universes,
 * carried through IPC so the orchestrator knows how to acquire data
 * per provider and how to invoke the pooling materializer.
 */
export interface UniverseSleeveSpec {
  assetClass: string;
  provider: string;
  symbols: string[];
}

export interface UniverseSpec {
  universeId: string;
  symbols: string[];
  normalization: UniverseNormalization;
  /**
   * TICKET_802: data provider that produced `symbols`. The orchestrator
   * forwards this to `ensureUniverse` so the right backend serves data
   * (yfinance for equity, CCXT for crypto, etc.); the manifest records
   * it for reproduction; the dedup hash includes it so swapping provider
   * on the same universe slug produces a new run (correct -- different
   * exchanges = different price prints = different fit results).
   * Required on tool_sweep universe runs; the IPC validator rejects
   * payloads that omit it.
   */
  provider: string;
  /**
   * TICKET_880_5_11: overselection target size. `symbols` is the full
   * candidate pool; `targetSize` is the desired post-filter count.
   * The orchestrator downloads all candidates, ranks by data quality
   * (bar count), and slices to the top `targetSize`. `null` = use all
   * candidates (no overselection). The symbol-cap gate checks
   * `targetSize` (not `symbols.length`) so the overselection buffer
   * does NOT count against the compute-cost cap.
   */
  targetSize: number | null;
  /**
   * TICKET_196_7_5_2_4: when set, the factor path acquires data and
   * computes IC on this wider training universe instead of `symbols`.
   * Portfolio construction still uses `symbols` (trading basket).
   */
  trainingUniverseId?: string;
  /**
   * TICKET_196_7_5_2_4: resolved symbol list for the training universe.
   * Must be the training universe's symbols for the SAME provider as
   * `provider`. Sent by the renderer alongside `trainingUniverseId`.
   */
  trainingSymbols?: string[];
  /**
   * TICKET_196_7_5_2_3_3_1 D3: universe type discriminator.
   * `'single_provider'` (default/absent) = existing single-provider path.
   * `'pooled'` = multi-sleeve cross-market universe.
   */
  type?: 'single_provider' | 'pooled';
  /**
   * TICKET_196_7_5_2_3_3_1 D4: sleeve definitions for pooled universes.
   * Present only when `type === 'pooled'`.
   */
  sleeves?: UniverseSleeveSpec[];
  /**
   * TICKET_196_7_5_2_3_3_1 Phase 4: cross-market normalisation stance.
   * Present only when `type === 'pooled'`. Defaults to `'pool_vol_adjusted'`
   * (Option C) when absent.
   */
  pooledNormalisationStance?: PooledNormalisationStance;
}

// =============================================================================
// TICKET_196_7_5 Phase 3: Tool Sweep template schema (mirrors Python PARAM_SCHEMA)
// =============================================================================

/** One parameter declaration inside a template's PARAM_SCHEMA. */
export interface ToolSweepParamSpec {
  /** Param name (e.g. `n_states`). */
  name: string;
  /** Wire type for grid editor rendering: `int`, `float`, `enum`. */
  type: 'int' | 'float' | 'enum';
  /** Discrete candidate values; mutually exclusive with `range`. */
  choices?: Array<string | number | boolean>;
  /** `[min, max]` for `int`/`float` params with no fixed `choices`. */
  range?: [number, number];
  /** Default value to pre-select when the grid editor renders. */
  default: string | number | boolean;
  /** UI group for sectioned rendering (e.g. `model`, `optimization`). */
  group?: string;
}

/** A single template's metadata as exposed by Python `list_templates`. */
export interface ToolSweepTemplate {
  /** Template id (e.g. `hmm_regime_v1`). */
  template_id: string;
  /**
   * TICKET_804 S3: when `true`, an identical (fingerprint,
   * data_snapshot_id, replication_index) re-dispatch is served from the
   * cache (`createCachedSignalRun`) without spawning Python. When `false`,
   * every dispatch produces a genuinely new fit -- the orchestrator
   * expands to REPLICATION_COUNT_DEFAULT replications sharing one
   * `replication_group_id` so the (mean, stddev) rollup over the batch is
   * meaningful. Defaults to `false` (safe side) if the field is missing
   * on an older Python build; the new field is required for every
   * Phase-1 template per ticket section 3.4.
   */
  deterministic?: boolean;
  /**
   * TICKET_804 S3: when `true` AND the user dispatches Run without an
   * explicit `selectedTemplateId`, this template is included in the
   * multi-template fan-out matrix. Defaults to `false` (safe side) for
   * older Python builds; every shipped Phase-1 template ships `true`
   * per ticket section 3.5.
   */
  included_in_default_fanout?: boolean;
  /** Python PARAM_SCHEMA payload. */
  param_schema: {
    template_id: string;
    params: ToolSweepParamSpec[];
  };
  /**
   * TICKET_196_7_5_3_4_2: factor-only authoritative warmup_bars from the
   * cross-walk JSON row. Present on every `factor_talib_*` /
   * `factor_alpha158_*` template synthesised from a `mapped` cross-walk
   * row; absent on Python ML templates (which use
   * `signal-source-floors.generated.ts` instead). Consumed by the host
   * floor resolver `resolveFactorMinimumTrainingBars` and propagated
   * onto `FanoutTemplateEntry.factorWarmupBars`.
   */
  warmup_bars?: number;
  /**
   * TICKET_887_4 Phase 1: whether this factor template has a compiled C++
   * indicator in StratForge. `true` routes to the fast C++ `factor_eval`
   * plugin; `false` routes to the Python `factor_eval_fallback` slow path.
   * Absent (undefined) on Python ML templates (HMM / n-gram / sklearn).
   */
  hasCppIndicator?: boolean;
  /**
   * TICKET_821: cold-start fan-out tier. 'core' = deterministic,
   * orthogonal, cheap (HMM / n-gram / Ridge); 'extended' =
   * non-deterministic or minutes-scale (XGB / MLP / TA signals).
   */
  default_fanout_tier?: 'core' | 'extended';
  /**
   * TICKET_975_5: curated default param grid from the fan-out registry.
   * Present on every template with `included_in_default_fanout === true`.
   * The renderer uses this to show per-template arm counts in the
   * pre-Run summary and to pre-fill the GridEditor when the user
   * expands Advanced mode on the cold-start fan-out path.
   */
  default_fanout_params?: Record<string, Array<string | number | boolean>>;
  /**
   * TICKET_887_5: user-defined formula for `custom_*` templates.
   * Persisted in `nona_factors.formula`; returned by `listTemplates`
   * so the renderer can seed the `customFormulas` store on mount.
   */
  formula?: string;
}

/** IPC payload returned by `signalDiscovery.listTemplates()`. */
export interface ListTemplatesResult {
  /** Whether enumeration succeeded. */
  success: boolean;
  /** Available templates (empty when `success === false`). */
  templates: ToolSweepTemplate[];
  /** Error message when `success === false`. */
  error?: string;
}

// =============================================================================
// TICKET_803_1 S2: Quick Start recommendation history wire contract
// =============================================================================

/**
 * One row from the user's local sweep history, as projected by
 * `listSweepHistory`. Reconstructed from `nona_signal` filtered by
 * `signal_source LIKE 'tool_sweep_%'`. The `universeId` slot may be
 * null for legacy single-asset rows whose `strategy_name` lacks the
 * `@<universeId>` suffix -- the recommender treats those as
 * universe-agnostic on the affinity axis.
 *
 * Per TICKET_803_1 section 3.9 the `fingerprint` field is the canonical
 * sha256 identity from the production `computeSweepFingerprint` --
 * used by the renderer-side `detectExplored` to flag schema-default
 * candidates as already-run.
 */
export interface SweepHistoryEntry {
  signalId: number;
  signalName: string;
  templateId: string;
  universeId: string | null;
  fingerprint: string;
  /**
   * TICKET_842 Phase A2: bar interval the row was trained at. Null for
   * pre-A2 legacy rows whose `metadata` JSON did not carry the field.
   * The renderer-side `detectExplored` uses this to reconstruct the
   * host's barInterval-aware fingerprint identity per
   * `computeSweepFingerprint` in discovery-persistence.ts.
   */
  barInterval: string | null;
  createdAt: number;
}

export interface ListSweepHistoryResult {
  success: boolean;
  entries: SweepHistoryEntry[];
  error?: string;
}

// =============================================================================
// TICKET_803 Phase 1: Coverage panel wire contract
// =============================================================================

/**
 * One persisted sweep point for the coverage panel. The `params` slot
 * holds the param dict parsed back out of the `signal_name` slug --
 * values are strings (the slug encoding lost type info), so heatmap
 * matching is done by string equality, not by JSON deep-equal.
 *
 * `score` is joined from `signal_scoreboard` when present (no entry
 * for warmup signals); the panel renders a neutral cell in that case.
 */
export interface SweepCoveragePoint {
  fingerprint: string;
  params: Record<string, string>;
  signalName: string;
  signalId: number;
  createdAt: number;
  score?: number;
}

export interface SweepCoverageResult {
  templateId: string;
  universeId: string;
  provider: string | null;
  points: SweepCoveragePoint[];
  totalPersisted: number;
}

export interface ListSweepCoverageResult {
  success: boolean;
  result: SweepCoverageResult | null;
  error?: string;
}

// =============================================================================
// TICKET_804_1 S7: Data-snapshot spec IPC contract
//
// Renderer -> Main payload describing the IS / OOS / embargo / WF
// validation envelope for a Tool Sweep dispatch. Field-for-field mirror
// of ticket section 3.2's canonical JSON, in TS snake_case so the wire
// payload stays grep-friendly across the IPC + Python boundary.
//
// The Main process is the boundary that resolves the `"auto"` sentinel
// (see `embargo_bars` below) by spawning
// `python -m nona_algorithm.signal_sweep.resolve_embargo`. The renderer
// never sees the resolved int unless the user explicitly overrode it.
// =============================================================================

/**
 * Sentinel for "let the orchestrator derive embargo per-template". When
 * the user has not overridden the embargo control in the Validation
 * section, the Main process resolves this to an int via
 * `auto_embargo(template_id, params)` BEFORE the snapshot hash is
 * computed -- so two arms in the same fan-out get independently
 * appropriate embargoes (HMM=24, n-gram=6) and persist as distinct
 * `signal_run` rows.
 */
export type EmbargoSpec = number | 'auto';

/**
 * Walk-forward scheme. `null` is the legacy 70/30 single-split mode
 * (`walk_forward_folds === 1`). Sliding is reserved for a Phase-2
 * follow-up that compares stationary vs adapting strategies; only
 * `expanding` is wired today.
 */
export type WalkForwardScheme = 'expanding' | 'sliding' | null;

/**
 * TICKET_849 Phase B -- top-level cross-validation scheme.
 *
 * - `walk_forward` (default): legacy K-fold expanding-window walk-
 *   forward. Single backtest path, K = `walk_forward_folds`.
 * - `cpcv`: Combinatorial Purged K-Fold (Lopez de Prado AFML Ch. 7).
 *   Uses `cpcv_total_segments` (N) and `cpcv_test_segments` (k);
 *   produces C(N, k) backtest paths per arm.
 *
 * Selection lives on `DataSnapshotSpec` so it folds into the
 * snapshot hash and a re-run with a different scheme produces a
 * fresh `signal_run` row (rather than colliding with the cached
 * walk-forward output).
 */
export type CvScheme = 'walk_forward' | 'cpcv';

/** Optional regime exclusion window (covid-2020-03, svb-2023-03, ...). */
export interface RegimeExclusionSpec {
  /** Stable label used as the row key in the renderer; e.g. `covid-2020-03`. */
  label: string;
  /** Epoch ms, inclusive. */
  start: number;
  /** Epoch ms, exclusive. */
  end: number;
}

/**
 * Validation envelope on a Tool Sweep discovery start request. Carried
 * on the IPC payload as `dataSnapshotSpec`; the Main process expands
 * this into N per-fold snapshot specs via `applyDefaultSnapshotSpec`
 * (S3) before persisting each fold as a `signal_run` row.
 *
 * Defaults reflect the Medallion-grade policy from ticket section 3.3:
 * 5-fold purged expanding-window WF with auto-derived embargo. The
 * renderer's Validation section pre-populates these so a Run click with
 * no user changes ships the safe default.
 */
export interface DataSnapshotSpec {
  /**
   * Walk-forward fold count. `1` is the explicit single-split escape
   * hatch (70/30, still with auto-embargo). UI slider range 1..10.
   */
  walk_forward_folds: number;
  /** WF scheme. NULL iff `walk_forward_folds === 1`. */
  walk_forward_scheme: WalkForwardScheme;
  /**
   * Embargo width in bars OR the `'auto'` sentinel (default). Main
   * resolves `'auto'` per arm via the Python `resolve_embargo` CLI
   * before computing the snapshot hash.
   */
  embargo_bars: EmbargoSpec;
  /**
   * Optional excluded regime windows. Field present so the snapshot
   * hash already accounts for it once the regime picker lands; UI for
   * adding rows ships in TICKET_804_3.
   */
  excluded_regimes?: RegimeExclusionSpec[];

  /**
   * TICKET_849 Phase B -- top-level cross-validation scheme. Default
   * `'walk_forward'` (bit-identical back-compat with pre-849 dispatch).
   * When set to `'cpcv'`, the orchestrator routes pull / split / refuse
   * through the contract's CPCV branch instead of walk-forward; the UI
   * surfaces this via the Advanced "Cross-validation scheme" select
   * (TICKET_849 Phase B D1). Omitted on the wire is equivalent to
   * `'walk_forward'`.
   */
  cv_scheme?: CvScheme;
  /**
   * TICKET_849 Phase B -- CPCV total segments N (4..12). Only consulted
   * when `cv_scheme === 'cpcv'`; the walk-forward path ignores this
   * field and continues to use `walk_forward_folds`. Default `6`.
   */
  cpcv_total_segments?: number;
  /**
   * TICKET_849 Phase B -- CPCV test segments per path k (1..3). Only
   * consulted when `cv_scheme === 'cpcv'`. Default `2`. Must satisfy
   * `1 <= k < N`.
   */
  cpcv_test_segments?: number;
}

/**
 * Medallion-grade default for new dispatches per ticket section 3.3.
 * Re-exported from a single point so renderer Zustand init, orchestrator
 * fallback, and IPC schema docs all read the same constant.
 */
export const DEFAULT_DATA_SNAPSHOT_SPEC: DataSnapshotSpec = {
  walk_forward_folds: 5,
  walk_forward_scheme: 'expanding',
  embargo_bars: 'auto',
  excluded_regimes: [],
};

// =============================================================================
// TICKET_196_7_6_5: Factor availability (Layer 2 picker filter)
// =============================================================================

/** Factor engine identifier used by Signal Discovery Layer 2. */
export type FactorEngine = 'talib' | 'alpha158' | 'alpha101' | 'alpha191' | 'jkp';

/**
 * Availability status for a single factor entry.
 *   - `'mapped'`      -- backed by a C++ stratforge indicator, runnable today.
 *   - `'deferred'`    -- present in the cross-walk catalog but not yet wired
 *                        (e.g. `multi_output`, `no_cpp_impl`). The catalog
 *                        carries `defer_reason` / `defer_note` for tooltips.
 *   - `'phase_gated'` -- engine is not yet enabled at all in this phase
 *                        (Alpha158 / Alpha101 in Phase 1).
 */
export type FactorAvailabilityStatus = 'mapped' | 'deferred' | 'phase_gated';

/**
 * Per-factor availability record produced by
 * `signalDiscovery:getFactorAvailability`. The renderer turns this into the
 * chip enabled/disabled state and tooltip in the Layer 2 picker.
 */
export interface FactorAvailability {
  /** Stable factor identifier (e.g. `ta_rsi_14`, `a158_kmid`, `alpha101_001`). */
  factor_id: string;
  /** Engine the factor belongs to. */
  engine: FactorEngine;
  /** Phase-aware availability status (see `FactorAvailabilityStatus`). */
  status: FactorAvailabilityStatus;
  /**
   * Cross-walk `defer_reason` for `deferred` TA-Lib entries (e.g.
   * `'multi_output'`, `'no_cpp_impl'`). Stable string for i18n.
   */
  defer_reason?: string;
  /**
   * Human-readable note from the cross-walk's `defer_note`. Free-form
   * English, suitable for tooltip body but not localized.
   */
  defer_note?: string;
}

/** IPC payload returned by `signalDiscovery.getFactorAvailability()`. */
export interface GetFactorAvailabilityResult {
  /** Whether the catalog read succeeded. */
  success: boolean;
  /** Availability records across all engines. Empty on failure. */
  factors: FactorAvailability[];
  /** Error message when `success === false`. */
  error?: string;
}

/** Result returned when starting a discovery session */
export interface DiscoveryStartResult {
  /** Whether the request was accepted */
  success: boolean;
  /** Validation or launch error when success=false */
  error?: string;
  /** Non-fatal warnings such as clamped inputs */
  warnings?: string[];
  /** Effective values used after input normalization/clamping */
  effectiveConfig?: {
    hypothesesCount: number;
    batchSize: number;
  };
}

// =============================================================================
// Round 1: Hypothesis Generation
// =============================================================================

/** A single hypothesis generated by LLM in Round 1 */
export interface Hypothesis {
  /** Unique ID within session (e.g., "H1", "H2") */
  id: string;
  /** Human-readable description of the hypothesis */
  description: string;
  /** Statistical method to test this hypothesis */
  statisticalMethod: string;
  /** Expected direction of the pattern */
  expectedDirection: string;
  /** Python libraries required for the test */
  requiredLibraries: string[];
  /** Parameters for the statistical test */
  parameters: Record<string, unknown>;
}

// =============================================================================
// Round 3: Statistical Validation Results
// =============================================================================

// =============================================================================
// TICKET_568_8 Phase 2: Walk-Forward Validation
// =============================================================================

/** Result of a single walk-forward validation window */
export interface WalkForwardWindowResult {
  /** Window index (0-based) */
  windowIndex: number;
  /** In-sample p-value for this window */
  isPValue: number;
  /** Out-of-sample p-value for this window */
  oosPValue: number;
  /** Whether this window passed significance */
  passed: boolean;
}

// =============================================================================
// TICKET_568_8 Phase 2: Smoke Test
// =============================================================================

/** Result of running test code against synthetic noise data */
export interface SmokeTestResult {
  /** Whether the code passed (no false positives on noise) */
  passed: boolean;
  /** Number of hypotheses that falsely reported significance on noise */
  falsePositiveCount: number;
  /** Total number of hypotheses tested */
  totalTests: number;
}

// =============================================================================
// TICKET_568_8 Phase 2: Cross-Signal Correlation Filtering
// =============================================================================

/** A pair of signals with high correlation */
export interface CorrelationPair {
  /** Name of the first signal */
  signal1Name: string;
  /** Name of the second signal */
  signal2Name: string;
  /** Pearson correlation coefficient */
  correlation: number;
  /** Name of the signal kept (better metrics) */
  keptSignal: string;
  /** Name of the signal recommended for removal */
  droppedSignal: string;
}

/** Result of cross-signal correlation check */
export interface CorrelationCheckResult {
  /** All redundant pairs found */
  pairs: CorrelationPair[];
  /** Number of signals recommended for removal */
  droppedCount: number;
}

// =============================================================================
// Round 3: Statistical Validation Results
// =============================================================================

/** Result of testing a single hypothesis */
export interface HypothesisResult {
  /** ID matching the hypothesis (e.g., "H1") */
  hypothesisId: string;
  /** Name of the statistical test performed */
  testName: string;
  /** p-value from the test (BH-adjusted when correction applied) */
  pValue: number;
  /** Original p-value before Benjamini-Hochberg correction */
  rawPValue?: number;
  /** Out-of-sample p-value (undefined when OOS split not available) */
  oosPValue?: number;
  /** Whether out-of-sample validation passed */
  oosSignificant?: boolean;
  /** Test statistic value */
  testStatistic: number;
  /** Effect size measure */
  effectSize: number;
  /** Whether the result is statistically significant (final gate: BH + effect size + OOS) */
  isSignificant: boolean;
  /** Human-readable summary of the result */
  summary: string;
  /** Additional parameters from the test */
  parameters: Record<string, unknown>;
  /** TICKET_568_8 Phase 2: Walk-forward pass rate (fraction 0.0-1.0) */
  walkForwardPassRate?: number;
  /** TICKET_568_8 Phase 2: Per-window walk-forward results */
  walkForwardWindows?: WalkForwardWindowResult[];
  /** TICKET_1165_1: Rolling per-bar scores from sub-window computation. */
  perBarScores?: number[];
  /**
   * TICKET_822_1_1: absolute path to the per-hypothesis canonical
   * sidecar (`canonical_output.json`) emitted by the hypothesis canonical
   * adapter. Present when `statistical-validator.ts::validate` succeeded
   * in writing per-bar canonical rows; absent when the adapter step
   * failed (logged warning, but result still surfaces with scalar
   * statistics). Consumed by the orchestrator's Round 4 persistence path
   * so the Combinator strict-gate sees a canonical row series for this
   * hypothesis.
   */
  canonicalOutputPath?: string;
  /** TICKET_822_1_1: row count claimed by the adapter. */
  canonicalOutputRows?: number;
}

// =============================================================================
// Progress & Events (Main -> Renderer)
// =============================================================================

/** Progress event sent during discovery */
export interface DiscoveryProgress {
  /** Current round (1-4) */
  round: DiscoveryRound;
  /** Round name */
  roundName: DiscoveryRoundName;
  /** Status of this round */
  status: DiscoveryRoundStatus;
  /** Optional detail message */
  detail?: string;
}

/** Round result event sent after each round completes */
export interface DiscoveryRoundResult {
  /** Which round completed */
  round: DiscoveryRound;
  /** Round name */
  roundName: DiscoveryRoundName;
  /** Round 1: generated hypotheses */
  hypotheses?: Hypothesis[];
  /** Round 2: generated test code (Python source) */
  testCode?: string;
  /** Round 3: statistical test results */
  testResults?: HypothesisResult[];
  /** Round 4: final signal code (Python source) */
  signalCode?: string;
}

/**
 * Final completion event for the hypothesis-discovery flow.
 *
 * TICKET_817: discriminator `mode` is optional and defaults to
 * 'hypothesis' so existing emit sites that pre-date the union remain
 * type-compatible. Sweep paths must set `mode: 'tool_sweep'` explicitly.
 */
export interface DiscoveryCompleteHypothesis {
  mode?: 'hypothesis';
  /** Total hypotheses generated */
  totalHypotheses: number;
  /** Number that passed significance test */
  significantCount: number;
  /** The final SignalSourceBase Python code */
  signalCode: string;
  /** Signal name/class name */
  signalName: string;
  /** Summary of the discovery process */
  summary: string;
  /** All hypothesis results for display */
  testResults: HypothesisResult[];
  /** TICKET_568_3: Auto-persistence result */
  persistenceResult?: PersistenceResult;
  /** TICKET_912 Phase 3: renderer-assigned sidebar run ID echoed from config */
  rendererRunId?: string;
}

/**
 * TICKET_817: Final completion event for the Tool Sweep flow
 * (universe / single-asset / fan-out). Sweep persists per-arm rows via
 * `run-created` + `run-group-rolled-up` events, so the terminal event
 * carries aggregate batch counters rather than a single signal payload.
 */
export interface DiscoveryCompleteSweep {
  mode: 'tool_sweep' | 'tool_sweep_bayesian';
  /** Template id for single-template sweeps, '__fanout__' for fan-out dispatch */
  templateId: string;
  /** Present in universe-mode dispatch */
  universeId?: string;
  /** Present in single-asset debug-mode dispatch */
  symbol?: string;
  /** Total grid points (or arms, for fan-out) dispatched */
  gridPoints: number;
  /** Per-arm batch outcome counters */
  succeeded: number;
  duplicates: number;
  errors: number;
  /**
   * TICKET_958_7: cells skipped pre-fit because their fingerprint already
   * resolved to a persisted `nona_signal` row (crash/restart resume). These
   * incurred no `fit_universe.py` spawn; they are distinct from `duplicates`
   * (which are post-fit dedups that DID pay the fit cost) so a resumed run is
   * not mistaken for a from-scratch run (TICKET_858).
   */
  resumedSkipped?: number;
  /**
   * TICKET_1147 Phase 2: arms parked by ASHA rung-0 screening (fold 0
   * evaluated, ranked below the keep cut; persisted as `screened_fold0`).
   * Absence, not evidence -- excluded from BH/leaderboards, revivable
   * via SWEEP_ASHA_REVIVE=1.
   */
  screened?: number;
  /** Arms refused before compute because dispatch preconditions were not met */
  refused?: number;
  /** Machine-readable aggregate refusal reason when all work was refused */
  refusalReason?: string;
  /** Structured refusal details for UI diagnostics */
  refusalPayload?: Record<string, unknown>;
  /** TICKET_912 Phase 3: renderer-assigned sidebar run ID echoed from config */
  rendererRunId?: string;
  /** C++ scheduler decision that produced the terminal dispatch envelope. */
  schedulerDecisionId?: string;
  /** Versioned scheduler envelope consumed by Main, persistence, and UI. */
  schedulerEnvelopeVersion?: 'qnx.scheduler-plan-envelope/1.0.0';
}

/** Final completion event (hypothesis or sweep flow) */
export type DiscoveryComplete =
  | DiscoveryCompleteHypothesis
  | DiscoveryCompleteSweep;

/**
 * TICKET_827: per-signal canonical-score coverage status emitted after a
 * Tool Sweep grid point successfully writes its score rows. The renderer
 * uses this to render the "new | extended | up to date | backfilled |
 * failed" status line under the Tool Sweep results panel.
 */
export type SignalCoverageStatus =
  | 'new'
  | 'extended'
  | 'up_to_date'
  | 'backfilled'
  | 'failed';

export interface SignalCoverageEvent {
  /** `nona_signal.id` -- the canonical score identity. */
  signalId: number;
  /** Display name shown in the status row (matches nona_signal.strategy_name). */
  signalName: string;
  /** Status pill rendered in the UI. */
  status: SignalCoverageStatus;
  /** Rows added by this Run Sweep dispatch. */
  rowsAdded: number;
  /**
   * Bars already present that the dispatch skipped (Strategy A immutable
   * write). 0 for a brand-new signal; > 0 once any prior bar exists.
   */
  rowsSkipped: number;
  /** MIN(ts) for this signal AFTER the write. -1 if signal has no rows. */
  coverageStart: number;
  /** MAX(ts) for this signal AFTER the write. -1 if signal has no rows. */
  coverageEnd: number;
  /** COUNT(*) for this signal AFTER the write. */
  barCount: number;
  /** Optional human-readable note (e.g., "Backfilled 500 of 1000 (provider cap)"). */
  note?: string;
  /**
   * TICKET_827: the recipe identity that produced this signal, carried on
   * the event so the renderer can offer a [Backfill N bars] button without
   * round-tripping the DB. Single-asset Tool Sweep only -- universe / fan-
   * out dispatches set this to `null` (their backfill story is out of
   * scope until TICKET_826).
   */
  recipe: {
    templateId: string;
    params: Record<string, unknown>;
    symbol: string;
    timeframe: string;
  } | null;
}

// =============================================================================
// TICKET_568_3: Deduplication & Auto-Persistence
// =============================================================================

/** Summary of an existing signal for exclusion context */
export interface ExistingSignalSummary {
  /** Algorithm DB id */
  id: number;
  /** Strategy name */
  strategy_name: string;
  /** Description */
  description: string;
  /** Sub-domain (e.g., "ou_half_life") */
  sub_domain: string;
  /** Python class name */
  class_name: string;
}

/** Result of auto-persisting a signal after Round 4 */
export interface PersistenceResult {
  /** Whether persistence succeeded */
  success: boolean;
  /** Inserted algorithm ID (when success=true and not duplicate) */
  algorithmId?: number;
  /** Whether signal was a duplicate */
  isDuplicate: boolean;
  /** Name of existing signal if duplicate */
  duplicateOf?: string;
  /** Error message if persistence failed */
  error?: string;
}

/** Batch progress event for multi-signal generation */
export interface BatchProgress {
  /** Current batch iteration (1-based) */
  batchCurrent: number;
  /** Total batch iterations */
  batchTotal: number;
  /** Number of signals successfully persisted */
  succeeded: number;
  /** Number of duplicates skipped */
  duplicates: number;
  /**
   * TICKET_958_7: cells skipped pre-fit on resume (fingerprint already
   * persisted; no fit spawned). Distinct from post-fit `duplicates`.
   */
  resumedSkipped?: number;
  /**
   * TICKET_1147 Phase 2: arms parked (killed) by ASHA rung-0 screening
   * in this batch so far.
   */
  screened?: number;
  /** Number of errors */
  errors: number;
  /** Most recent error messages (capped at 5) for inline display */
  lastErrorMessages?: string[];
  /** TICKET_894_2: ms since sweep started */
  elapsedMs?: number;
  /** TICKET_894_2: which phase is active */
  currentPhase?: 'factor_eval' | 'model_fit';
  /** TICKET_894_2: arms done within current phase */
  phaseArmsDone?: number;
  /** TICKET_894_2: total arms in current phase */
  phaseArmsTotal?: number;
  /** C++ scheduler decision projected without reconstructing scheduler state. */
  schedulerDecisionId?: string;
  schedulerEnvelopeVersion?: 'qnx.scheduler-plan-envelope/1.0.0';
}

/** Duplicate detection event */
export interface DiscoveryDuplicate {
  /** Human-readable message */
  message: string;
  /** Name of the existing signal that matches */
  existingSignalName: string;
  /** SHA-256 fingerprint that matched */
  fingerprint: string;
}

/**
 * TICKET_782_1: Round 4.5 compile-gate result event.
 * Emitted after Round 4 LLM assembly, before SHA-256 dedup / persistence.
 * On `success === false`, the signal is dropped (not persisted).
 */
export interface DiscoveryCompileGateResult {
  /** Name of the signal that ran through the gate */
  signalName: string;
  /** Whether the wrapped TU passed `-fsyntax-only` */
  success: boolean;
  /**
   * Compiler diagnostics (one line per entry) when `success === false`.
   * Empty when `success === true`.
   */
  diagnostics: string[];
}

// =============================================================================
// TICKET_568_7: Semantic Dedup & Saturation Detection
// =============================================================================

/** Saturation level indicating how exhausted a category is */
export type SaturationLevel = 'green' | 'yellow' | 'orange' | 'red';

/** Result of AST + LSH similarity analysis for a single signal */
export interface SimilarityResult {
  /** AST structural fingerprint (SHA-256 of normalized AST) */
  astFingerprint: string;
  /** Name of existing signal if AST fingerprint is an exact match */
  astDuplicateOf: string | null;
  /** Candidate signal names from LSH near-duplicate check */
  lshCandidates: string[];
  /** Maximum Jaccard similarity score among LSH candidates */
  maxSimilarity: number;
  /** Whether this signal is considered a duplicate (AST match or LSH above threshold) */
  isDuplicate: boolean;
  /** Reason for rejection (null if not duplicate) */
  rejectReason: string | null;
}

/** Similarity check event sent to renderer for UI display */
export interface DiscoverySimilarityCheck {
  /** Name of the signal being checked */
  signalName: string;
  /** Which dedup layer caught it: 'sha256' | 'ast' | 'lsh' | 'novel' */
  matchLayer: 'sha256' | 'ast' | 'lsh' | 'novel';
  /** Name of the most similar existing signal (if any) */
  mostSimilar?: string;
  /** Current saturation level for this category */
  saturationLevel: SaturationLevel;
}

/** Rolling-window metrics for category saturation detection */
export interface SaturationMetrics {
  /** Current saturation level */
  level: SaturationLevel;
  /** Ratio of rejected signals in recent window */
  rejectionRate: number;
  /** Average similarity score in recent window */
  avgSimilarity: number;
  /** Number of duplicates in recent window */
  recentDuplicates: number;
  /** Total attempts in recent window */
  recentAttempts: number;
}

/** Error event */
export interface DiscoveryError {
  /** Error message */
  message: string;
  /** Which round failed (if applicable) */
  round?: DiscoveryRound;
  /** Round name (if applicable) */
  roundName?: DiscoveryRoundName;
  /** TICKET_912 Phase 3: renderer-assigned sidebar run ID echoed from config */
  rendererRunId?: string;
  /**
   * TICKET_919_5: Structured error code used by the renderer to switch
   * from the generic "Something went wrong" banner to a typed card.
   * Absent for plain (string-only) errors. New codes are added here as
   * the orchestrator learns to surface more failure modes structurally.
   */
  code?:
    | 'IMPORTED_PACKAGE_INTERVAL_UNAVAILABLE'
    | 'QNX_FAMILY_STATISTICAL_EVALUATION_FAILED';
  /**
   * TICKET_919_5: Structured payload accompanying `code`. The shape is
   * a discriminated union; today only one variant exists. Renderers
   * MUST switch on `code` and treat unknown codes as the generic string
   * path (forward-compatible).
   */
  details?: {
    code: 'IMPORTED_PACKAGE_INTERVAL_UNAVAILABLE';
    package: string;
    requestedInterval: string;
    availableIntervals: string[];
    symbolCount: number;
    universeId?: string;
  };
}

// =============================================================================
// TICKET_568_2_2_2: Round 2 Per-Hypothesis Code Generation
// =============================================================================

/** Per-hypothesis code generation result (Round 2) */
export interface HypothesisCodeResult {
  /** Hypothesis ID (e.g., "H1") */
  hypothesisId: string;
  /**
   * Generated C++23 test code, null if generation failed.
   *
   * Each code block defines a `test_<func_suffix>(std::span<const stratforge::Bar>)`
   * free function returning `std::vector<stratforge::stats::HypothesisResult>`
   * per the backend Round 2 prompt contract (TICKET_758).
   */
  code: string | null;
  /** Error message if generation failed */
  error?: string;
}

/** Round 2 progress event for per-hypothesis generation */
export interface Round2HypothesisProgress {
  /** Index of completed hypothesis (1-based) */
  current: number;
  /** Total hypotheses count */
  total: number;
  /** Hypothesis ID just completed */
  hypothesisId: string;
  /** Whether this hypothesis succeeded */
  success: boolean;
  /** TICKET_568_3_2: Generated test code for this hypothesis (success path only) */
  code?: string;
}

// =============================================================================
// TICKET_804_3: Definition rollup (alpha decay / robustness)
// =============================================================================

/**
 * One row of the `signal_definition_rollup` SQL VIEW (migration v57).
 *
 * Read-only aggregate over `signal_run` per `nona_signal_definition`. All
 * sharpe / stddev / median fields are NULL until at least one ok-status
 * run with a non-NULL `oos_sharpe` has been persisted for the definition.
 */
export interface DefinitionRollup {
  definitionId: number;
  userId: string;
  templateId: string;
  universeId: string | null;
  fingerprint: string;
  displayName: string | null;
  runCount: number;
  significantRuns: number;
  meanOosSharpe: number | null;
  minOosSharpe: number | null;
  maxOosSharpe: number | null;
  stddevOosSharpe: number | null;
  firstRunAt: number | null;
  lastRunAt: number | null;
  latestOosSharpe: number | null;
  historicalMedianOosSharpe: number | null;
}

/**
 * Alpha-decay classification for a definition. Computed from the rollup
 * row by `computeAlphaDecayStatus()`. Read-path only -- not persisted.
 *
 * Per ticket section 3.2:
 *   decaying    -- latest < 0.5 * historical_median
 *   improving   -- latest > 1.2 * historical_median
 *   stable      -- latest within +/- 20% of historical median
 *   insufficient -- fewer than 3 ok runs with OOS sharpe
 */
export type AlphaDecayStatus = 'decaying' | 'stable' | 'improving' | 'insufficient';

/**
 * Robustness classification for a definition. Computed from the rollup
 * row by `computeRobustnessStatus()`. Coefficient of variation
 * (stddev / |mean|) thresholds per ticket section 3.3:
 *   robust       -- cv < 0.3
 *   variable     -- 0.3 <= cv < 0.7
 *   fragile      -- cv >= 0.7
 *   insufficient -- fewer than 3 ok runs with OOS sharpe
 */
export type RobustnessStatus = 'robust' | 'variable' | 'fragile' | 'insufficient';

/**
 * TICKET_804_3 S6: Run-over-run alpha-decay regression alert.
 *
 * Emitted by the orchestrator after a run completes for a definition whose
 * rollup satisfies BOTH of the following (ticket section 3.6):
 *
 *   - `runCount >= ROLLUP_MIN_RUNS_FOR_CLASSIFICATION` (default 3), AND
 *   - `latestOosSharpe < ALPHA_DECAY_RATIO_DECAY * historicalMedianOosSharpe`
 *     (default ratio 0.5; both numbers non-null and median > 0).
 *
 * Carried over IPC as a non-blocking renderer notification -- never blocks
 * `signalDiscovery.startDiscovery` resolution, never mutates state.
 *
 * `message` is composed in the main process so the renderer toast handler
 * is a one-liner; localisation belongs upstream in the renderer once a
 * localised template is added (Phase 2 follow-up).
 */
export interface AlphaDecayWarning {
  definitionId: number;
  displayName: string | null;
  latestSharpe: number;
  historicalMedian: number;
  runCount: number;
  message: string;
}

/** Filter for `listDefinitionRollups`. All fields optional / additive. */
export interface DefinitionRollupFilter {
  userId?: string;
  templateId?: string;
  universeId?: string;
  /** If set, computed alpha-decay status must match this value. */
  alphaDecay?: AlphaDecayStatus;
  /** If set, computed robustness status must match this value. */
  robustness?: RobustnessStatus;
  /** Cap on returned rows; default 500. */
  limit?: number;
}

// =============================================================================
// TICKET_804_3 S4: Family-level Benjamini-Hochberg
// =============================================================================

/**
 * Statistical verdict literal -- mirrors the CHECK constraint on
 * `signal_run.statistical_verdict` / `statistical_verdict_family`.
 *
 * Single source of truth so the family-BH service and any future renderer
 * filter use the exact same string set.
 */
export type StatisticalVerdict =
  | 'significant'
  | 'marginal'
  | 'not_significant'
  | 'insufficient_data';

/**
 * Family scope discriminated union for `recomputeFamilyBH`.
 *
 * Per TICKET_804_3 section 3.4 the three supported scopes are:
 *   - `template`            -- all runs whose definition shares a templateId
 *   - `universe`            -- all runs whose definition shares a universeId
 *   - `template_universe`   -- intersection of the two
 *
 * Rows outside the matched scope are NOT touched: the service is incremental
 * and idempotent within the scope, NEVER global. An accidental global
 * recompute would be expensive and is rejected by the orchestrator hook.
 */
export type FamilyScope =
  | { scope: 'template'; templateId: string }
  | { scope: 'universe'; universeId: string }
  | { scope: 'template_universe'; templateId: string; universeId: string };

/**
 * Return shape from `recomputeFamilyBH`. Counts feed the orchestrator log
 * and the renderer "Recompute family significance" button's confirmation
 * toast. `rowsConsidered` includes only runs with non-NULL p_value (the
 * BH input set); `rowsUpdated` includes the rows whose adjusted p-value
 * or verdict changed value-for-value compared to the previous state.
 */
export interface RecomputeFamilyBHResult {
  scope: FamilyScope;
  rowsConsidered: number;
  rowsUpdated: number;
  significantCount: number;
  marginalCount: number;
  notSignificantCount: number;
}

// =============================================================================
// TICKET_804_3 S7: IPC wire payloads (rollup + classification chips)
// =============================================================================

/**
 * One rollup row plus the two derived classification chips computed from it.
 * The renderer uses this directly to render a definition card without needing
 * to know the threshold semantics -- those live in `definition-rollup.ts`.
 */
export interface DefinitionRollupWithStatus {
  rollup: DefinitionRollup;
  alphaDecay: AlphaDecayStatus;
  robustness: RobustnessStatus;
}

/** IPC payload returned by `signalDiscovery.getDefinitionRollup`. */
export interface GetDefinitionRollupResult {
  success: boolean;
  /** Present when `success === true`; null when no definition with that id. */
  rollup: DefinitionRollupWithStatus | null;
  error?: string;
}

/** IPC payload returned by `signalDiscovery.listDefinitionRollups`. */
export interface ListDefinitionRollupsResult {
  success: boolean;
  /** Empty when `success === false`; capped at `filter.limit` otherwise. */
  rollups: DefinitionRollupWithStatus[];
  error?: string;
}

/** IPC payload returned by `signalDiscovery.recomputeFamilyBH`. */
export interface RecomputeFamilyBHIPCResult {
  success: boolean;
  /** Present when `success === true`. */
  result?: RecomputeFamilyBHResult;
  error?: string;
}

// =============================================================================
// TICKET_975_1: Top-K leaderboard for sweep signal ranking
// =============================================================================

export interface LeaderboardGroup {
  templateId: string;
  templateDisplayName: string;
  universeId: string | null;
  barInterval: string;
  provider: string | null;
  totalVariants: number;
  survivors: number;
  bestIc: number | null;
  medianIc: number | null;
  latestCreatedAt: number;
}

export type LeaderboardVerdict = 'significant' | 'marginal' | 'not_significant' | 'insufficient_data' | null;

export interface LeaderboardEntry {
  signalId: number;
  paramsCanonical: string;
  paramsDiff: Record<string, string | number>;
  score: number | null;
  sharpeLong: number | null;
  hitRate: number | null;
  trades: number | null;
  computedAt: number;
  /** Latest confirmatory-authority verdict; null = confirmatory evaluation pending (TICKET_1066_2). */
  verdict: LeaderboardVerdict;
  /** Latest diagnostic-authority (training-time) verdict; separate axis from `verdict`, never merged (TICKET_1066_2). */
  diagnosticVerdict: LeaderboardVerdict;
  /**
   * TICKET_1147 Phase 2: ASHA screening lifecycle. 'screened_fold0' = the
   * arm was parked at rung 0 (fold 0 only evaluated; absence, not
   * evidence). Screened rows are EXCLUDED from the leaderboard by default
   * (AC7); they only appear when the query opts in via includeScreened,
   * carrying this marker so the UI can badge them (pending-badge pattern,
   * TICKET_1066_2).
   */
  screeningStatus: string | null;
}

export interface LeaderboardDetailPage {
  entries: LeaderboardEntry[];
  totalCount: number;
  /** Row count without the verdict filter, so the UI can report hidden rows (TICKET_1066_2). */
  totalUnfilteredCount: number;
  pageSize: number;
  offset: number;
  hasMore: boolean;
  varyingKeys: string[];
}

export interface LeaderboardGroupsPage {
  groups: LeaderboardGroup[];
  totalCount: number;
  pageSize: number;
  offset: number;
  hasMore: boolean;
}

export interface GetLeaderboardGroupsResult {
  success: boolean;
  page: LeaderboardGroupsPage | null;
  error?: string;
}

export interface GetLeaderboardDetailResult {
  success: boolean;
  page: LeaderboardDetailPage | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// TICKET_1008_1: Batch-add top-N signals by threshold
// ---------------------------------------------------------------------------

export interface LeaderboardBatchAddRequest {
  templateId: string;
  universeId: string | null;
  barInterval: string;
  minIc?: number;
  minSharpe?: number;
  minHitRate?: number;
  topN: number;
  excludeIds: string[];
}

export interface LeaderboardBatchAddResult {
  success: boolean;
  signalIds: number[];
  error?: string;
}

// ---------------------------------------------------------------------------
// TICKET_978: Background sweep execution -- session state types
// ---------------------------------------------------------------------------

export interface SweepSessionPersisted {
  sessionId: string;
  startedAt: number;
  config: DiscoveryConfig;
  timeframes: string[];
  totalArmsPerTimeframe: number;
  totalArms: number;
}

export interface SweepSessionState {
  sessionId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  startedAt: number;
  totalArms: number;
  completedArms: number;
  succeeded: number;
  resumedSkipped: number;
  errors: number;
  duplicates: number;
  pipelinePhase: 'idle' | 'downloading' | 'running';
  phaseArmsDone: number;
  phaseArmsTotal: number;
  elapsedMs: number;
  etaDisplay: string | null;
  armsPerMin: number;
  cpuPercent: number;
  memUsedGB: number;
  appMemUsedGB: number;
  completionSummary: SweepCompletionSummary | null;
}

export interface SweepCompletionSummary {
  succeeded: number;
  resumedSkipped: number;
  errors: number;
  total: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// TICKET_978_1: Sweep queue -- serial multi-session scheduling
// ---------------------------------------------------------------------------

export type SweepQueueEntryStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SweepQueueEntry {
  queueId: string;
  session: SweepSessionPersisted;
  status: SweepQueueEntryStatus;
  enqueuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  summary: SweepCompletionSummary | null;
}

export interface SweepPersistentState {
  runningEntry: SweepQueueEntry | null;
  queue: SweepQueueEntry[];
  completed: SweepQueueEntry[];
}

// ---------------------------------------------------------------------------
// TICKET_991_1: LSTM Combinator Model Version Management
// ---------------------------------------------------------------------------

export interface LstmModelVersion {
  id: string;
  filename: string;
  trainedAt: number;
  modelType: string;
  signalIds: number[];
  signalCount: number;
  lookbackBars: number;
  meanValSharpe: number;
  valSharpes: number[];
  compatible: boolean;
  // TICKET_1277_2 F1: the registration outcome that produced this version --
  // 'registered' (it became the active champion at creation) or 'held' (the
  // gate held it behind the incumbent). Retention needs this to distinguish a
  // held challenger (audit trail the gate's AC2 promise depends on) from a
  // former champion (genuine history). Absent on manifests written before
  // TICKET_1277_2 -> read as 'registered', matching pre-1277 behaviour where
  // every stored version was active at creation.
  registration?: 'registered' | 'held';
  // TICKET_1272_1 W3: shared-encoder ONNX tensor dims. Present only for
  // modelType='shared_encoder' so the C++ inference side constructs the
  // two-input (scores (1,N,T,dInput) + metadata (1,N,dMeta)) tensors
  // without guessing. Absent for legacy lstm/lstm_attention (single-input).
  dEmbed?: number;
  dInput?: number;
  dMeta?: number;
}

export interface LstmModelManifest {
  activeVersion: string | null;
  enabled: boolean;
  maxVersions: number;
  versions: LstmModelVersion[];
  lineageEpoch?: number;
}

// ---------------------------------------------------------------------------
// TICKET_1000: LSTM Model Snapshot & Fresh Training
// ---------------------------------------------------------------------------

export interface LstmSnapshot {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  versionCount: number;
  activeVersionId: string | null;
  meanValSharpe: number | null;
  signalIds: number[];
  signalCount: number;
  totalSizeBytes: number;
}

export interface LstmSnapshotEntry {
  id: string;
  name: string;
  createdAt: number;
  // TICKET_1277_3 AC10: a snapshot row summarises a frozen COLLECTION, so the
  // version count belongs in the authoritative list entry. Without it the
  // Renderer would need one `getSnapshotVersions` call per row (prohibited
  // N+1 fanout). Legacy indexes written before this field are upgraded from
  // the authoritative `snapshot.json` metadata on read.
  versionCount: number;
  activeVersionId: string | null;
  meanValSharpe: number | null;
  signalCount: number;
  totalSizeBytes: number;
}

export interface LstmSnapshotIndex {
  snapshots: LstmSnapshotEntry[];
  maxSnapshots: number;
}

// ---------------------------------------------------------------------------
// TICKET_1000_1: LSTM Training Signal Selection Gate
// ---------------------------------------------------------------------------

export interface LstmTrainingCandidate {
  signalId: number;
  displayName: string;
  compositionTier: 'lifting' | 'neutral' | 'dragging' | 'unmeasured';
  stabilityVerdict: string;
  ic: number | null;
  meanForwardReturn: number | null;
  defaultSelected: boolean;
}

// ---------------------------------------------------------------------------
// TICKET_991_2: Backtest trace row for LSTM training data persistence
// ---------------------------------------------------------------------------

export interface BacktestTraceRow {
  ts: number;
  symbol: string;
  raw_score: number;
  confidence: number;
  r_next: number;
  roster_state: 'active' | 'bench';
  state_weight: number;
}
