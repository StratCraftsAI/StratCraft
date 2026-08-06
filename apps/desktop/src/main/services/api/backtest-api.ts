/**
 * Backtest Service API
 *
 * TICKET_425: Unified Service API Layer
 * TICKET_490: Added runBacktest and getBacktestStatus for MCP E2E.
 *
 * Read operations wrapping BacktestResultService.
 * No ipcMain, no BrowserWindow, no sendToRenderer imports.
 */

import * as crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { mainT } from '../../i18n/main-strings';
import { getCurrentMainLocale } from '../locale-service';
import { getDatabaseManager } from '../../database/db-manager';
import { BacktestResultService, BacktestResultRecord } from '../../database/services/backtest-result-service';
import type { TaskHistoryRecord } from '../../database/services/backtest-task-history-service';
import { getBacktestQueue } from '../executor-queue-service';
import { enqueueAndAwait, getDataDownloadQueue } from '../data-download-queue';
import { getExecutorService } from '../executor-service';
import { getParquetCacheService } from '../parquet-cache-service';
import type { ExecutorConfig } from '../executor-service';
import {
  DEFAULT_INITIAL_CAPITAL,
  DEFAULT_COMMISSION_RATE,
  DEFAULT_SLIPPAGE_RATE,
  DEFAULT_MAX_POSITION_SIZE,
  CHECKPOINT_DEFAULT_INTERVAL,
  CHECKPOINT_DEFAULT_MAX_COUNT,
  CHECKPOINT_DEFAULT_WARMUP_PERIOD,
} from '../../../shared/constants';
import { INTERVAL_1d } from '../../../shared/constants/intervals';
import {
  PROVIDER_YFINANCE,
  INTERVAL_RANK,
  isIntervalFinerThan,
  ALL_INTERVALS,
  // TICKET_661_1 AC-10: the single shared C++ source-analysis owner. The former
  // local comment-blind copy is deleted; see cpp-source-analysis.ts.
  extractCppClassName,
} from '@StratCraft/types';
import {
  admitAlgorithmForExecution,
  describeAdmissionRefusal,
} from '../strategy-execution-admission-adapter';
import type { BarInterval, FeedPlan, FeedSpec, FeedSource } from '@StratCraft/types';
import { ApiResponse } from './types';
import {
  buildCompilableCppSource,
  getCppArtifactPath,
  getAlgorithmCompilationService,
  hashCppStrategySource,
  separateCppIncludes,
} from '../algorithm-compilation-service';
import { getCompilerResolver } from '../compiler-resolver';
import {
  deleteBacktestResult,
  type SqliteDatabase,
} from '@StratCraft/types';
import {
  loadBacktestResumeConfig,
  persistBacktestResumeConfig,
} from '../backtest-resume-config-service';

export async function listResults(limit: number = 50): Promise<ApiResponse<BacktestResultRecord[]>> {
  try {
    const db = getDatabaseManager();
    const service = new BacktestResultService(db);
    const records = service.getHistory(limit);
    return { success: true, data: records };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getResult(taskId: string): Promise<ApiResponse<BacktestResultRecord | null>> {
  try {
    const db = getDatabaseManager();
    const service = new BacktestResultService(db);
    const record = service.getByTaskId(taskId);
    return { success: true, data: record };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function deleteResult(taskId: string): Promise<ApiResponse<void>> {
  try {
    const db = getDatabaseManager();
    deleteBacktestResult(db as unknown as SqliteDatabase, taskId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// =============================================================================
// TICKET_490: Backtest Execution via MCP
// =============================================================================

export interface RunBacktestParams {
  algorithm_id: number;
  language?: 'cpp';
  workflow_components?: CppWorkflowComponent[];
  symbol?: string;
  interval?: string;
  start_date?: string;
  end_date?: string;
  initial_capital?: number;
  commission?: number;
  slippage?: number;
  allow_short?: boolean;
  data_source?: string;
  dry_run?: boolean;
  compiler_path?: string;
  runner_path?: string;
  cpp_include_paths?: string[];
  cpp_hardening?: ExecutorConfig['cppHardening'];
}

export interface CppWorkflowComponent {
  role: 'regime' | 'analysis' | 'entry' | 'step' | 'exit' | 'postCondition' | 'preCondition';
  name?: string;
  class_name?: string;
  code: string;
  // TICKET_1225 P3: per-slot timeframe from AlgorithmSelection.timeframe.
  // When present, the component is bound to the feed at this interval in the
  // FeedPlan; when absent, defaults to the execution (finest) TF.
  timeframe?: BarInterval;
  // TICKET_783_3: optional Bayesian prior carried from `nona_signal.cached_stats_json`
  // (Discovered chips) or `saved_strategy_components.parameters.cached_stats`
  // (workflow chips). Only consumed for `entry`-role components. NULL means
  // "no prior" -- the aggregator falls back to rolling-only behaviour and, if
  // rolling samples are also below the N_min hard floor, drops the signal
  // into per-signal equal-weight. Wired through the generator in Step A;
  // populated by the handler in Step C.
  cachedStats?: {
    sharpePrior: number;
    nPrior: number;
  };
  // TICKET_783_2: per-entry-component regime gate. When `signalMethod === 'regime_based'`,
  // the aggregator zeroes this component's weight on any bar whose `state_.regime`
  // is not in `allowedRegimes`. Empty / undefined means "all regimes allowed"
  // (no gating), which collapses regime_based to equal-weight majority vote for
  // un-annotated chip sets -- a documented backward-compat behaviour. Wire format
  // is the regime enum name (`"TrendingUp"`, etc.); unknown strings cause the
  // generator to throw a structured error so the chip metadata typo surfaces at
  // code-gen time, not at runtime. Only consumed for entry-role components.
  allowedRegimes?: string[];
}

const SECONDS_PER_DAY = 86400;

/**
 * TICKET_568_9 / TICKET_661_1: does this record self-declare as a Signal
 * Discovery Python research artifact?
 *
 * This selects which localized remedy a Python verdict receives -- the
 * Combinator-composition message rather than the C++-regeneration message. It
 * is deliberately NOT a language decision: the language verdict is owned solely
 * by `classifyStrategyLanguageEvidence()` via the admission operation, and a
 * `false` here never authorizes execution.
 */
function isPythonResearchArtifact(classificationMetadata: string | null): boolean {
  if (!classificationMetadata) return false;
  try {
    const meta: unknown = JSON.parse(classificationMetadata);
    return (
      meta !== null &&
      typeof meta === 'object' &&
      (meta as Record<string, unknown>).language === 'python'
    );
  } catch {
    // Non-JSON metadata cannot self-declare as a research artifact. It is NOT
    // treated as C++ here -- the admission operation already classified the
    // record; this only picks the remedy wording.
    return false;
  }
}

/**
 * Generate main.cpp wrapper from template for MCP-generated C++ strategies.
 * The template owns the QNX ABI exports; LLM output only supplies the strategy
 * class body for the single-strategy Phase 4D path.
 */
function generateMainCpp(strategyName: string, strategyClass: string, strategyCode: string): string {
  const templatePath = join(getFrameworkPath(), 'templates', 'main.cpp.template');
  let template = readFileSync(templatePath, 'utf-8');

  template = template.replace(/\{\{STRATEGY_NAME\}\}/g, strategyName);
  template = template.replace(/\{\{STRATEGY_CLASS\}\}/g, strategyClass);
  template = template.replace(/\{\{STRATEGY_CODE\}\}/g, strategyCode.trim());
  template = template.replace(/\{\{GENERATED_TIME\}\}/g, new Date().toISOString());

  return template;
}

// =============================================================================
// TICKET_686: Workflow Composer Adapter Layer
//
// Standalone nonabt strategies (RegimeDetectorStrategy, RegimeEntryStrategy, etc.)
// use `init() final` / `next() final` and cannot be pasted directly into the
// workflow template which expects qnx_workflow::RegimeComponent / EntryComponent
// / ExitComponent with `init(ComponentContext&)` + `on_bar(ComponentContext&)`.
//
// These utilities transform standalone strategy code into workflow component
// adapter classes at composition time (TypeScript string transformation).
// =============================================================================

/** Known standalone nonabt base classes that require adapter transformation. */
type NonabtBaseClass =
  | 'RegimeDetectorStrategy'
  | 'KronosDetectorStrategy'
  | 'RegimeEntryStrategy'
  | 'SignalEntryStrategy'
  | 'AISignalEntryStrategy'
  | 'ExitStrategy';

const NONABT_BASE_CLASSES: readonly NonabtBaseClass[] = [
  'RegimeDetectorStrategy',
  'KronosDetectorStrategy',
  'RegimeEntryStrategy',
  'SignalEntryStrategy',
  'AISignalEntryStrategy',
  'ExitStrategy',
];

/**
 * Detect the nonabt base class from a standalone strategy class definition.
 * Returns null if the code is already a workflow component or plain Strategy.
 */
export function extractCppBaseClass(code: string): NonabtBaseClass | null {
  const match = code.match(
    /class\s+\w+(?:\s+final)?\s*:\s*public\s+(?:stratforge::)?(\w+Strategy)\b/,
  );
  if (!match) return null;
  const candidate = match[1] as NonabtBaseClass;
  return NONABT_BASE_CLASSES.includes(candidate) ? candidate : null;
}

/**
 * Extract the body of a C++ method by brace-counting.
 * `methodPattern` should match up to (and including) the opening `{`.
 */
export function extractCppMethodBody(code: string, methodPattern: RegExp): string | null {
  const match = methodPattern.exec(code);
  if (!match) return null;

  let depth = 1;
  let pos = match.index + match[0].length;
  const start = pos;

  while (pos < code.length && depth > 0) {
    if (code[pos] === '{') depth++;
    else if (code[pos] === '}') depth--;
    if (depth > 0) pos++;
  }

  if (depth !== 0) return null;
  return code.slice(start, pos).trim();
}

/**
 * Extract private/protected member declarations (lines matching common C++ member patterns).
 */
export function extractCppClassMembers(code: string): string {
  const lines = code.split('\n');
  const memberLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Match typical member declarations: type name_; or type name_ = value;
    if (/^(?:(?:const\s+)?(?:std::)?[\w:<>, ]+)\s+\w+_(?:\s*=\s*[^;]+)?;/.test(trimmed)) {
      memberLines.push(`    ${trimmed}`);
    }
  }
  return memberLines.join('\n');
}

/**
 * Rewrite standalone data access calls to ComponentContext-based calls.
 * Order matters: rewrite `data()` first, then `close(` with negative lookbehind.
 *
 * TICKET_686_1: every rewrite below uses `(?<![.>\w])` to scope to
 * **standalone** identifiers (i.e. the backtrader-style call surface).
 * A bare `\b` boundary still matches after a `.`, so `vec.data()` (which
 * is `std::vector<double>::data()`, valid C++) was previously corrupted
 * into `vec.ctx.data` -- crashing the Round 4.5 compile gate. Same shape
 * for `buy()` / `sell()` / `position()` -- a chip-local helper of the
 * same name would have been silently rewritten.
 */
export function rewriteDataAccess(body: string): string {
  let result = body;
  // data() / data(0) -> ctx.data  (standalone only; not `vec.data()`)
  result = result.replace(/(?<![.>\w])data\(\s*0?\s*\)/g, 'ctx.data');
  // position() -> ctx.strategy.position()  (standalone only)
  result = result.replace(/(?<![.>\w])position\(\s*\)/g, 'ctx.strategy.position()');
  // buy( -> ctx.strategy.buy(  (standalone only)
  result = result.replace(/(?<![.>\w])buy\(/g, 'ctx.strategy.buy(');
  // sell( -> ctx.strategy.sell(  (standalone only)
  result = result.replace(/(?<![.>\w])sell\(/g, 'ctx.strategy.sell(');
  // close( -> ctx.strategy.close( but NOT .close( (e.g. ctx.data.close())
  result = result.replace(/(?<![.>\w])close\(/g, 'ctx.strategy.close(');
  // Strip set_minimum_period(...) calls
  result = result.replace(/\bset_minimum_period\s*\([^)]*\)\s*;/g, '');
  return result;
}

// Method extraction patterns (match through opening brace)
const METHOD_PATTERNS = {
  initialize_indicators: /\binitialize_indicators\s*\([^)]*\)\s*(?:override\s*)?(?:final\s*)?\{/,
  update_indicators: /\bupdate_indicators\s*\([^)]*\)\s*(?:override\s*)?(?:final\s*)?\{/,
  get_base_warmup_period: /\bget_base_warmup_period\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?(?:final\s*)?\{/,
  calculate_trend_strength: /\bcalculate_trend_strength\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?(?:final\s*)?\{/,
  calculate_range_strength: /\bcalculate_range_strength\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?(?:final\s*)?\{/,
  get_volatility_state: /\bget_volatility_state\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?(?:final\s*)?\{/,
  check_open_conditions: /\bcheck_open_conditions\s*\([^)]*\)\s*(?:override\s*)?(?:final\s*)?\{/,
  check_close_conditions: /\bcheck_close_conditions\s*\([^)]*\)\s*(?:override\s*)?(?:final\s*)?\{/,
  check_exit_signal: /\bcheck_exit_signal\s*\([^)]*\)\s*(?:override\s*)?(?:final\s*)?\{/,
} as const;

function extractMethod(code: string, name: keyof typeof METHOD_PATTERNS): string {
  return extractCppMethodBody(code, METHOD_PATTERNS[name]) ?? '';
}

/**
 * Estimate warmup period from indicator initialization code.
 * Extracts the largest integer literal (likely an indicator period parameter)
 * and adds 1 for safe [-1] access. Returns at least 2 when init code exists.
 */
function estimateWarmupFromInit(initCode: string): number {
  if (!initCode.trim()) return 1;
  const numbers = initCode.match(/\b(\d+)\b/g);
  if (!numbers) return 2;
  const maxPeriod = Math.max(...numbers.map(Number).filter(n => n >= 2 && n <= 500));
  return Number.isFinite(maxPeriod) ? maxPeriod + 1 : 2;
}

/**
 * Generate warmup_period() override for a workflow component adapter.
 * Uses get_base_warmup_period() if available, otherwise estimates from init code.
 */
function generateWarmupOverride(warmupBody: string, initBody: string): string {
  if (warmupBody) {
    return `\n    [[nodiscard]] std::size_t warmup_period() const override {\n        ${warmupBody}\n    }`;
  }
  const estimated = estimateWarmupFromInit(initBody);
  if (estimated > 1) {
    return `\n    [[nodiscard]] std::size_t warmup_period() const override { return ${estimated}; }`;
  }
  return '';
}

function rewriteRegimeSelfCalls(body: string, warmupValue: number): string {
  let result = body;
  result = result.replace(/(?<![.>\w])get_base_warmup_period\s*\(\s*\)/g, String(warmupValue));
  result = result.replace(/(?<![.>\w])calculate_trend_strength\s*\(\s*\)/g, 'trend');
  result = result.replace(/(?<![.>\w])calculate_range_strength\s*\(\s*\)/g, 'range');
  return result;
}

function generateRegimeAdapter(className: string, code: string): string {
  const initBody = rewriteDataAccess(extractMethod(code, 'initialize_indicators'));
  const updateBody = rewriteDataAccess(extractMethod(code, 'update_indicators'));
  const trendBody = extractMethod(code, 'calculate_trend_strength');
  const rangeBody = extractMethod(code, 'calculate_range_strength');
  const volBody = extractMethod(code, 'get_volatility_state');
  const warmupBody = extractMethod(code, 'get_base_warmup_period');
  const members = extractCppClassMembers(code);

  const warmupValue = warmupBody
    ? estimateWarmupFromInit(warmupBody)
    : estimateWarmupFromInit(initBody);

  const trendExpr = trendBody
    ? `[&]() -> double {\n            ${rewriteRegimeSelfCalls(rewriteDataAccess(trendBody), warmupValue)}\n        }()`
    : '0.0';
  const rangeExpr = rangeBody
    ? `[&]() -> double {\n            ${rewriteRegimeSelfCalls(rewriteDataAccess(rangeBody), warmupValue)}\n        }()`
    : '0.0';
  const volExpr = volBody
    ? `[&]() -> bool {\n            ${rewriteRegimeSelfCalls(rewriteDataAccess(volBody), warmupValue)}\n        }()`
    : 'false';
  const warmupOverride = generateWarmupOverride(warmupBody, initBody);

  return `class ${className}_WfAdapter : public qnx_workflow::RegimeComponent {
public:
    void init(qnx_workflow::ComponentContext& ctx) override {
        ${initBody || '// no initialization'}
    }
    void advance_indicators(qnx_workflow::ComponentContext& ctx) override {
        ${updateBody || '// no indicator update'}
    }
    qnx_workflow::Regime on_bar(qnx_workflow::ComponentContext& ctx) override {
        advance_indicators(ctx);
        double trend = ${trendExpr};
        double range = ${rangeExpr};
        bool high_vol = ${volExpr};
        if (high_vol) return qnx_workflow::Regime::HighVolatility;
        if (trend > range) return qnx_workflow::Regime::TrendingUp;
        if (range > trend) return qnx_workflow::Regime::Ranging;
        return qnx_workflow::Regime::LowVolatility;
    }${warmupOverride}
private:
${members || '    // no members'}
};`;
}

function generateEntryAdapter(className: string, code: string): string {
  const initBody = rewriteDataAccess(extractMethod(code, 'initialize_indicators'));
  const updateBody = rewriteDataAccess(extractMethod(code, 'update_indicators'));
  const closeBody = extractMethod(code, 'check_close_conditions');
  const openBody = extractMethod(code, 'check_open_conditions');
  const warmupBody = extractMethod(code, 'get_base_warmup_period');
  const members = extractCppClassMembers(code);

  const closeCheck = closeBody
    ? `if ([&]() -> bool {\n            ${rewriteDataAccess(closeBody)}\n        }()) {
            if (ctx.strategy.position().is_long()) return {.signal = qnx_workflow::Signal::ExitLong};
            if (ctx.strategy.position().is_short()) return {.signal = qnx_workflow::Signal::ExitShort};
        }`
    : '// no close check';

  const openCheck = openBody
    ? `{
            auto entry = [&]() -> stratforge::EntrySignal {\n                ${rewriteDataAccess(openBody)}\n            }();
            if (entry.long_signal) return {.signal = qnx_workflow::Signal::EnterLong};
            if (entry.short_signal) return {.signal = qnx_workflow::Signal::EnterShort};
        }`
    : '// no open check';

  const warmupOverride = generateWarmupOverride(warmupBody, initBody);

  return `class ${className}_WfAdapter : public qnx_workflow::EntryComponent {
public:
    void init(qnx_workflow::ComponentContext& ctx) override {
        ${initBody || '// no initialization'}
    }
    void advance_indicators(qnx_workflow::ComponentContext& ctx) override {
        ${updateBody || '// no indicator update'}
    }
    qnx_workflow::ComponentSignal on_bar(qnx_workflow::ComponentContext& ctx) override {
        advance_indicators(ctx);
        ${closeCheck}
        ${openCheck}
        return {.signal = qnx_workflow::Signal::Hold};
    }${warmupOverride}
private:
${members || '    // no members'}
};`;
}

function generateExitAdapter(className: string, code: string): string {
  const initBody = rewriteDataAccess(extractMethod(code, 'initialize_indicators'));
  const updateBody = rewriteDataAccess(extractMethod(code, 'update_indicators'));
  const exitBody = extractMethod(code, 'check_exit_signal');
  const warmupBody = extractMethod(code, 'get_base_warmup_period');
  const members = extractCppClassMembers(code);

  const exitCheck = exitBody
    ? `if ([&]() -> bool {\n            ${rewriteDataAccess(exitBody)}\n        }()) {
            if (ctx.strategy.position().is_long()) return {.signal = qnx_workflow::Signal::ExitLong};
            if (ctx.strategy.position().is_short()) return {.signal = qnx_workflow::Signal::ExitShort};
        }`
    : '// no exit check';

  const warmupOverride = generateWarmupOverride(warmupBody, initBody);

  return `class ${className}_WfAdapter : public qnx_workflow::ExitComponent {
public:
    void init(qnx_workflow::ComponentContext& ctx) override {
        ${initBody || '// no initialization'}
    }
    void advance_indicators(qnx_workflow::ComponentContext& ctx) override {
        ${updateBody || '// no indicator update'}
    }
    qnx_workflow::ComponentSignal on_bar(qnx_workflow::ComponentContext& ctx) override {
        advance_indicators(ctx);
        ${exitCheck}
        return {.signal = qnx_workflow::Signal::Hold};
    }${warmupOverride}
private:
${members || '    // no members'}
};`;
}

/**
 * Transform standalone strategy code into a workflow component adapter.
 * Returns the original code unchanged if it's already a workflow component.
 */
export function adaptStandaloneToWorkflowComponent(
  code: string,
  role: 'regime' | 'entry' | 'exit',
): { includes: string[]; adaptedCode: string; adapterClassName: string | null } {
  const { includes, body } = separateCppIncludes(code);
  const baseClass = extractCppBaseClass(body);

  if (!baseClass) {
    // Already a workflow component or plain Strategy -- return as-is
    return { includes, adaptedCode: body, adapterClassName: null };
  }

  const className = extractCppClassName(body);
  if (!className) {
    return { includes, adaptedCode: body, adapterClassName: null };
  }

  let adaptedCode: string;
  const adapterIncludes = [...includes];
  switch (baseClass) {
    case 'RegimeDetectorStrategy':
    case 'KronosDetectorStrategy':
      adaptedCode = generateRegimeAdapter(className, body);
      break;
    case 'RegimeEntryStrategy':
    case 'SignalEntryStrategy':
    case 'AISignalEntryStrategy':
      adaptedCode = generateEntryAdapter(className, body);
      if (!adapterIncludes.some(i => i.includes('entry_signal.hpp'))) {
        adapterIncludes.push('#include <stratforge/strategy/entry_signal.hpp>');
      }
      break;
    case 'ExitStrategy':
      adaptedCode = generateExitAdapter(className, body);
      break;
    default:
      return { includes, adaptedCode: body, adapterClassName: null };
  }

  return { includes: adapterIncludes, adaptedCode, adapterClassName: `${className}_WfAdapter` };
}

// TICKET_783_1: Allowed signalMethod values flowing from the Alpha Factory UI
// through `alpha-factory:run` into `generateWorkflowStrategyCpp`. `equal` is
// the only branch with real semantics in this ticket; the other three are
// reserved -- they currently fall through to `equal` and the IPC handler
// emits a one-time log line. UI gating to `equal`-only happens in TICKET_783_6
// once TICKET_783_2/4/5 ship the real branches.
export const WORKFLOW_SIGNAL_METHODS = [
  'equal',
  'sharpe_weighted',
  'correlation_adjusted',
  'regime_based',
] as const;
export type WorkflowSignalMethod = (typeof WORKFLOW_SIGNAL_METHODS)[number];

// TICKET_783_2: single source of truth for the regime enum names that may
// appear in chip metadata's `allowed_regimes` field. The list must stay in
// lock-step with the `qnx_workflow::Regime` enum declared in
// packages/builder-templates/templates/workflow.cpp.template -- if a new
// regime is added there, add the matching string here (and a generator test
// will fail loudly if you forget).
export const WORKFLOW_REGIME_NAMES = [
  'Unknown',
  'TrendingUp',
  'TrendingDown',
  'Ranging',
  'HighVolatility',
  'LowVolatility',
] as const;
export type WorkflowRegimeName = (typeof WORKFLOW_REGIME_NAMES)[number];

// TICKET_783_2: validate a raw `allowed_regimes` array (as carried by chip
// metadata) and return the de-duplicated subset that maps to real Regime enum
// values. Throws a structured error on any unknown / non-string entry so the
// failure surfaces at codegen, not at runtime. Empty input (or `undefined`)
// resolves to `[]`, which the generator emits as the "all regimes allowed"
// sentinel.
export function validateAllowedRegimes(
  raw: unknown,
  context: string,
): WorkflowRegimeName[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error(
      `${context}: allowed_regimes must be an array of regime names; got ${typeof raw}`,
    );
  }
  const seen = new Set<WorkflowRegimeName>();
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      throw new Error(
        `${context}: allowed_regimes entries must be strings; got ${typeof entry}`,
      );
    }
    if (!(WORKFLOW_REGIME_NAMES as readonly string[]).includes(entry)) {
      throw new Error(
        `${context}: allowed_regimes contains unknown regime '${entry}'; ` +
          `expected one of ${WORKFLOW_REGIME_NAMES.join(' | ')}`,
      );
    }
    seen.add(entry as WorkflowRegimeName);
  }
  return Array.from(seen);
}

export interface WorkflowGenOptions {
  signalMethod?: WorkflowSignalMethod;
  lookback?: number;
  voteThreshold?: number;
  // TICKET_783_3: per the unified formula
  //   SR_clipped_i = max(0, SR_posterior_i - SR_floor)
  // exposed as an IPC tunable; default 0 matches D2 (no extra floor on top of
  // the non-negativity clip). 783_4 / 783_5 may raise it per method.
  srFloor?: number;
  confidenceWeightedSizing?: boolean;
}

const DEFAULT_WORKFLOW_GEN_OPTIONS: Required<WorkflowGenOptions> = {
  signalMethod: 'equal',
  lookback: 60,
  voteThreshold: 0,
  srFloor: 0,
  confidenceWeightedSizing: false,
};

let _indicatorClassToHeader: Map<string, string> | undefined;

function getIndicatorClassToHeader(): Map<string, string> {
  if (_indicatorClassToHeader) return _indicatorClassToHeader;
  _indicatorClassToHeader = new Map();
  try {
    const sdkPath = join(getFrameworkPath(), 'data', 'stratforge_indicator_sdk.json');
    const sdk = JSON.parse(readFileSync(sdkPath, 'utf-8'));
    const indicators = sdk.indicators ?? {};
    for (const [, info] of Object.entries(indicators)) {
      const entry = info as { class_name?: string; header?: string };
      if (entry.class_name && entry.header) {
        _indicatorClassToHeader.set(entry.class_name, entry.header);
      }
    }
  } catch {
    // SDK file may not exist in packaged builds; includes will rely on component-level extraction
  }
  return _indicatorClassToHeader;
}

function ensureStratforgeIncludes(source: string): string {
  const existingIncludes = new Set<string>();
  for (const m of source.matchAll(/^\s*#include\s*<([^>]+)>\s*$/gm)) {
    existingIncludes.add(m[1]);
  }

  const classToHeader = getIndicatorClassToHeader();
  const missingIncludes: string[] = [];

  for (const [cls, header] of classToHeader) {
    const headerPath = `stratforge/indicators/${header}`;
    if (existingIncludes.has(headerPath)) continue;
    const pattern = new RegExp(`\\bstratforge::${cls}\\b`);
    if (pattern.test(source)) {
      missingIncludes.push(`#include <${headerPath}>`);
      existingIncludes.add(headerPath);
    }
  }

  if (source.includes('stratforge::EntrySignal') && !existingIncludes.has('stratforge/strategy/entry_signal.hpp')) {
    missingIncludes.push('#include <stratforge/strategy/entry_signal.hpp>');
  }

  if (missingIncludes.length === 0) return source;

  const lines = source.split('\n');
  let lastIncludeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#include\s/.test(lines[i])) lastIncludeIdx = i;
  }
  if (lastIncludeIdx >= 0) {
    lines.splice(lastIncludeIdx + 1, 0, ...missingIncludes);
  }
  return lines.join('\n');
}

// ============================================================================
// TICKET_1225 P3: FeedPlan builder
// ============================================================================

/**
 * Set of provider-native intervals whose parquet files exist on disk.
 * Passed in by the caller so the plan builder can distinguish native TFs
 * (loaded from parquet) from derived TFs (resampled in-engine).
 *
 * Default: ALL_INTERVALS (optimistic; the caller narrows when it knows
 * the provider's actual inventory).
 */
export type NativeIntervalSet = ReadonlySet<BarInterval>;

const DEFAULT_NATIVE_INTERVALS: NativeIntervalSet = new Set(ALL_INTERVALS as readonly BarInterval[]);

/**
 * Build a FeedPlan from a set of workflow components.
 *
 * Rules (Section 2.2 of the design doc):
 * - feeds[0] = execution feed = the finest TF among all components
 * - Context feeds sorted coarsest-last, deduplicated by interval
 * - Derived TFs (not in nativeIntervals) get source.kind='resample'
 *   with base = the finest provider-native TF already in the plan
 * - Native TFs get source.kind='parquet' with dataPath from resolveDataPath
 *
 * @param components  Workflow components (with optional .timeframe)
 * @param nativeIntervals  Set of intervals for which native parquet exists
 * @param resolveDataPath  Returns the absolute parquet path for a given interval
 */
export function buildFeedPlan(
  components: CppWorkflowComponent[],
  nativeIntervals: NativeIntervalSet = DEFAULT_NATIVE_INTERVALS,
  resolveDataPath: (interval: BarInterval) => string = () => '',
): FeedPlan {
  // Collect unique TFs from all components. Components without a timeframe
  // are bound to the execution (finest) TF, which is determined after
  // collecting all explicitly-declared TFs. If no component declares a TF,
  // there is exactly one feed at the caller's default (no-TF = single-feed).
  const declaredTFs = new Set<BarInterval>();
  for (const comp of components) {
    if (comp.timeframe && INTERVAL_RANK[comp.timeframe] !== undefined) {
      declaredTFs.add(comp.timeframe);
    }
  }

  // If no TFs are declared, return a single-feed degenerate plan.
  // The execution interval is left as '' — the caller (v3-handlers)
  // fills it from the run config's interval.
  if (declaredTFs.size === 0) {
    return {
      feeds: [{
        index: 0,
        interval: '' as BarInterval,
        role: 'execution',
        source: { kind: 'parquet', dataPath: '' },
      }],
      executionInterval: '' as BarInterval,
    };
  }

  // Sort TFs by rank (finest first).
  const sortedTFs = Array.from(declaredTFs).sort(
    (a, b) => (INTERVAL_RANK[a] ?? 99) - (INTERVAL_RANK[b] ?? 99),
  );

  // Execution feed = finest TF.
  const executionInterval = sortedTFs[0];

  // Find the finest native TF in the plan for resample base.
  const finestNative = sortedTFs.find(tf => nativeIntervals.has(tf));

  // Build feeds array.
  const feeds: FeedSpec[] = [];
  for (let i = 0; i < sortedTFs.length; i++) {
    const interval = sortedTFs[i];
    const role = i === 0 ? 'execution' : 'context';
    const isNative = nativeIntervals.has(interval);
    let source: FeedSource;
    if (isNative) {
      source = { kind: 'parquet', dataPath: resolveDataPath(interval) };
    } else {
      // Derived TF: resample from the finest native TF in the plan.
      const base = finestNative ?? executionInterval;
      source = { kind: 'resample', base };
    }
    feeds.push({
      index: i,
      interval,
      role: role as 'execution' | 'context',
      source,
    });
  }

  return { feeds, executionInterval };
}

/**
 * TICKET_1225 P3: Resolve the feed index for a component's timeframe
 * within the plan. Returns 0 (execution feed) if the component has no
 * explicit timeframe or the TF is not in the plan.
 */
function resolveFeedIndex(plan: FeedPlan, timeframe?: BarInterval): number {
  if (!timeframe) return 0;
  const feed = plan.feeds.find(f => f.interval === timeframe);
  return feed ? feed.index : 0;
}

export function generateWorkflowStrategyCpp(
  workflowName: string,
  components: CppWorkflowComponent[],
  workflowClass = `${toCppIdentifier(workflowName)}Workflow`,
  options: WorkflowGenOptions = {},
  feedPlan?: FeedPlan,
): string {
  // TICKET_880: an empty component set is a LEGAL "always-Hold" strategy, not an
  // error. It arises when every selected Alpha Factory signal is a factor
  // (universe cross-sectional) that was labelled-no-op'd at the dispatch boundary
  // (v3-handlers.ts) -- the run still executes and produces an honest flat
  // (no-trade) PnL. Every downstream builder already collapses cleanly at N=0:
  // the component maps produce empty strings, buildEntryUpdateBlock returns ''
  // (no entry block emitted), and buildCombineEntriesFn returns a Hold stub
  // (see :685-687, :971-979). So an empty set needs no special template path --
  // only this early throw had to be lifted. "Zero effective signals -> Hold" is
  // a well-defined system state, the purest form of TICKET_880's labelled no-op.

  const signalMethod: WorkflowSignalMethod = options.signalMethod ?? DEFAULT_WORKFLOW_GEN_OPTIONS.signalMethod;
  const voteThreshold = options.voteThreshold ?? DEFAULT_WORKFLOW_GEN_OPTIONS.voteThreshold;
  // TICKET_783_3: lookback is now consumed -- it sizes the per-component
  // RollingPnl<Lookback> shadow-PnL window. Default 60 (matches the UI default
  // and the WorkflowGenOptions default).
  const lookback = Number.isFinite(options.lookback) && (options.lookback as number) > 0
    ? Math.trunc(options.lookback as number)
    : DEFAULT_WORKFLOW_GEN_OPTIONS.lookback;
  const srFloor = Number.isFinite(options.srFloor)
    ? (options.srFloor as number)
    : DEFAULT_WORKFLOW_GEN_OPTIONS.srFloor;

  const normalized = components.map((component, index) => normalizeWorkflowComponent(component, index));
  const templatePath = join(getFrameworkPath(), 'templates', 'workflow.cpp.template');
  let template = readFileSync(templatePath, 'utf-8');

  // TICKET_1225 P3: default to a single-feed degenerate plan when no plan is
  // supplied. Existing callers (cpp-compile-gate, signal-evaluator-service,
  // fingerprint) pass no plan and get semantically identical code.
  const plan = feedPlan ?? { feeds: [{ index: 0, interval: '' as BarInterval, role: 'execution' as const, source: { kind: 'parquet' as const, dataPath: '' } }], executionInterval: '' as BarInterval };
  const isMultiFeed = plan.feeds.length > 1;

  // TICKET_686: Collect and deduplicate component includes, hoist after template includes
  const templateIncludes = new Set<string>();
  for (const line of template.split('\n')) {
    const trimmed = line.trim();
    if (/^#include\s/.test(trimmed)) {
      templateIncludes.add(trimmed);
    }
  }
  const componentIncludes: string[] = [];
  for (const comp of normalized) {
    for (const inc of comp.includes) {
      if (!templateIncludes.has(inc) && !componentIncludes.includes(inc)) {
        componentIncludes.push(inc);
      }
    }
  }
  if (componentIncludes.length > 0) {
    // Insert after last #include line in template
    const lines = template.split('\n');
    let lastIncludeIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*#include\s/.test(lines[i])) {
        lastIncludeIdx = i;
      }
    }
    if (lastIncludeIdx >= 0) {
      lines.splice(lastIncludeIdx + 1, 0, ...componentIncludes);
      template = lines.join('\n');
    }
  }

  const componentCode = normalized.map(component => component.code.trim()).join('\n\n');
  const componentMembers = normalized
    .map(component => `    ${component.className} ${component.memberName}_;`)
    .join('\n');

  // TICKET_1225 P3: each component's init uses the context bound to its feed.
  const componentInitCalls = normalized
    .map(component => {
      const fi = resolveFeedIndex(plan, component.timeframe);
      if (isMultiFeed && fi !== 0) {
        return `        { auto fctx = make_context(${fi}); ${component.memberName}_.init(fctx); }`;
      }
      return `        ${component.memberName}_.init(ctx);`;
    })
    .join('\n');

  const regimeCalls: string[] = [];
  // TICKET_783_3: each entry component now also carries its prior (if any).
  // The aggregator emits per-component kSharpePrior_i / kNPrior_i constants
  // and a RollingPnl<lookback> member; both indexed by the entry's position
  // in this list.
  // TICKET_783_2: each entry also carries its allowedRegimes list (possibly
  // empty = "all regimes allowed"). The aggregator emits a per-component
  // kAllowedRegimes_i constexpr std::array and the regime_based branch zeroes
  // weights whose component's array does not contain state_.regime.
  const entryComponents: Array<{
    memberName: string;
    cachedStats: { sharpePrior: number; nPrior: number } | undefined;
    allowedRegimes: WorkflowRegimeName[];
  }> = [];
  const exitCalls: string[] = [];
  let regimeComponentCount = 0;

  for (const component of normalized) {
    if (component.role === 'regime') {
      const fi = resolveFeedIndex(plan, component.timeframe);
      if (isMultiFeed) {
        // TICKET_1225 P3: level semantics -- run on_bar on new bar,
        // hold state_.regime otherwise.
        regimeCalls.push([
          `        if (feed_advanced(${fi})) {`,
          `            auto fctx = make_context(${fi});`,
          `            state_.regime = ${component.memberName}_.on_bar(fctx);`,
          '        }',
        ].join('\n'));
      } else {
        regimeCalls.push(`        state_.regime = ${component.memberName}_.on_bar(ctx);`);
      }
      regimeComponentCount += 1;
    } else if (component.role === 'entry') {
      entryComponents.push({
        memberName: component.memberName,
        cachedStats: component.cachedStats,
        allowedRegimes: component.allowedRegimes,
      });
    } else if (component.role === 'exit') {
      const fi = resolveFeedIndex(plan, component.timeframe);
      if (isMultiFeed) {
        // TICKET_1225 P3: edge semantics -- emit signal only on new bar,
        // otherwise hold.
        exitCalls.push([
          `        if (feed_advanced(${fi})) {`,
          `            auto fctx = make_context(${fi});`,
          `            auto signal = ${component.memberName}_.on_bar(fctx);`,
          '            state_.exit_signal = signal;',
          '            if (signal.signal == qnx_workflow::Signal::ExitLong || signal.signal == qnx_workflow::Signal::ExitShort) {',
          '                state_.signal = signal;',
          '            }',
          '        }',
        ].join('\n'));
      } else {
        exitCalls.push([
          '        {',
          `            auto signal = ${component.memberName}_.on_bar(ctx);`,
          '            state_.exit_signal = signal;',
          '            if (signal.signal == qnx_workflow::Signal::ExitLong || signal.signal == qnx_workflow::Signal::ExitShort) {',
          '                state_.signal = signal;',
          '            }',
          '        }',
        ].join('\n'));
      }
    }
  }

  // TICKET_1225 P3: per-feed warmup computation. For multi-feed plans,
  // each feed gets the max warmup of components bound to it. For single-feed
  // plans, the existing global-max behaviour is preserved.
  const warmupLines: string[] = [];
  if (isMultiFeed) {
    // Group components by feed index and compute per-feed max warmup.
    const feedWarmups = new Map<number, string[]>();
    for (const component of normalized) {
      const fi = resolveFeedIndex(plan, component.timeframe);
      if (!feedWarmups.has(fi)) feedWarmups.set(fi, []);
      feedWarmups.get(fi)!.push(component.memberName);
    }
    for (const [fi, members] of feedWarmups) {
      warmupLines.push(`        { std::size_t wp = 1;`);
      for (const m of members) {
        warmupLines.push(`          wp = std::max(wp, ${m}_.warmup_period());`);
      }
      warmupLines.push(`          set_minimum_period(${fi}, wp); }`);
    }
  } else {
    warmupLines.push('        std::size_t wp = 1;');
    for (const component of normalized) {
      warmupLines.push(`        wp = std::max(wp, ${component.memberName}_.warmup_period());`);
    }
    warmupLines.push('        set_minimum_period(wp);');
  }

  // TICKET_1225 P3: prenext calls -- advance component indicators only when
  // the component's feed has a new bar (multi-feed) or unconditionally (single-feed).
  const prenextCalls: string[] = [];
  for (const component of normalized) {
    const fi = resolveFeedIndex(plan, component.timeframe);
    if (isMultiFeed) {
      prenextCalls.push(
        `        if (feed_advanced(${fi})) { auto fctx = make_context(${fi}); ${component.memberName}_.advance_indicators(fctx); }`,
      );
    } else {
      prenextCalls.push(
        `        ${component.memberName}_.advance_indicators(ctx);`,
      );
    }
  }

  // TICKET_783_2: regime_based requires at least one regime-role component
  // (analysis chip) so state_.regime is actually driven by an upstream signal
  // rather than left at the default `Regime::Unknown`. Without a regime
  // detector, every per-component allowed_regimes check would compare against
  // Unknown -- silently zeroing every weight or, for un-annotated chips,
  // collapsing the result to majority vote regardless. Either is a confusing
  // failure mode; fail fast at codegen instead. The handler-layer guard runs
  // first (cleaner IPC error wording); this is defensive against any caller
  // that bypasses the handler.
  if (signalMethod === 'regime_based' && regimeComponentCount === 0 && entryComponents.length > 0) {
    throw new Error(
      `generateWorkflowStrategyCpp: signalMethod='regime_based' requires at least one ` +
        `regime/analysis-role component; received only ${entryComponents.length} entry component(s).`,
    );
  }

  // TICKET_783_1: collect entry signals into a fixed-size std::array<N> and
  // hand them to combine_entries(). For N=0 (no entry components -- e.g. a
  // regime-only or exit-only workflow) emit no entry block at all; the
  // previous template behaviour for that shape was also a no-op.
  // TICKET_1225 P3: pass per-entry feed indices for multi-feed edge semantics.
  const entryFeedIndices = normalized
    .filter(c => c.role === 'entry')
    .map(c => resolveFeedIndex(plan, c.timeframe));
  const entryUpdateBlock = buildEntryUpdateBlock(entryComponents.map(c => c.memberName), signalMethod, isMultiFeed, entryFeedIndices);
  const combineEntriesFn = buildCombineEntriesFn(entryComponents.length, signalMethod, entryComponents.map(c => c.allowedRegimes));
  const signalMethodConst = JSON.stringify(signalMethod);
  // TICKET_783_3: kept for ABI stability; lambda is now per-component via
  // lambda_schedule(n_rolling_i). The constant still gets emitted so reserved
  // methods can read it if they want a global override later.
  const lambdaWarmupConst = '1.0';
  const srFloorConst = `${srFloor}`;
  const voteThresholdConst = Number.isFinite(voteThreshold) ? `${voteThreshold}` : '0';
  const rollingLookbackConst = `${lookback}`;
  const confidenceWeightedSizing = options.confidenceWeightedSizing ?? DEFAULT_WORKFLOW_GEN_OPTIONS.confidenceWeightedSizing;
  const confidenceWeightedConst = confidenceWeightedSizing ? 'true' : 'false';

  // TICKET_783_3: per-entry-component prior constants + rolling-pnl members +
  // rolling-pnl update calls + prev_entry_signals_ member. For N=0 entries
  // these all collapse to comments so the placeholders are still consumed.
  const entryPriorsBlock = buildEntryPriorsBlock(entryComponents);
  const prevEntrySignalsMember = buildPrevEntrySignalsMember(entryComponents.length);
  const rollingPnlMembers = buildRollingPnlMembers(entryComponents.length);
  const rollingPnlUpdateCalls = buildRollingPnlUpdateCalls(entryComponents.length);
  // TICKET_783_5: rolling-vote buffers + correlation matrix cache. Emitted
  // only under `correlation_adjusted` so the other methods do not pay the
  // (small but non-zero) member-storage cost.
  const rollingVoteMembers = buildRollingVoteMembers(entryComponents.length, signalMethod);
  const corrMatrixMember = buildCorrMatrixMember(entryComponents.length, signalMethod);

  // TICKET_1225 P3: feed index constants and expected-feeds export.
  const feedIndexConstants = plan.feeds
    .map(f => `static constexpr std::size_t kFeedIndex_${f.index} = ${f.index};`)
    .join('\n');
  const expectedFeedsExport = `extern "C" int qnx_strategy_expected_feeds() { return ${plan.feeds.length}; }`;

  template = template.replace(/\{\{WORKFLOW_NAME\}\}/g, workflowName);
  template = template.replace(/\{\{WORKFLOW_CLASS\}\}/g, workflowClass);
  template = template.replace(/\{\{COMPONENT_CODE\}\}/g, componentCode);
  template = template.replace(/\{\{COMPONENT_MEMBERS\}\}/g, componentMembers);
  template = template.replace(/\{\{COMPONENT_INIT_CALLS\}\}/g, componentInitCalls);
  template = template.replace(/\{\{WARMUP_PERIOD_COMPUTATION\}\}/g, warmupLines.join('\n'));
  template = template.replace(/\{\{PRENEXT_CALLS\}\}/g, prenextCalls.join('\n'));
  template = template.replace(/\{\{REGIME_UPDATE_CALLS\}\}/g, regimeCalls.join('\n'));
  template = template.replace(/\{\{ENTRY_UPDATE_CALLS\}\}/g, entryUpdateBlock);
  template = template.replace(/\{\{EXIT_UPDATE_CALLS\}\}/g, exitCalls.join('\n'));
  template = template.replace(/\{\{SIGNAL_METHOD_CONST\}\}/g, signalMethodConst);
  template = template.replace(/\{\{LAMBDA_WARMUP_CONST\}\}/g, lambdaWarmupConst);
  template = template.replace(/\{\{SR_FLOOR_CONST\}\}/g, srFloorConst);
  template = template.replace(/\{\{VOTE_THRESHOLD_CONST\}\}/g, voteThresholdConst);
  template = template.replace(/\{\{ROLLING_LOOKBACK_CONST\}\}/g, rollingLookbackConst);
  template = template.replace(/\{\{ENTRY_PRIORS\}\}/g, entryPriorsBlock);
  template = template.replace(/\{\{COMBINE_ENTRIES_FN\}\}/g, combineEntriesFn);
  template = template.replace(/\{\{PREV_ENTRY_SIGNALS_MEMBER\}\}/g, prevEntrySignalsMember);
  template = template.replace(/\{\{ROLLING_PNL_MEMBERS\}\}/g, rollingPnlMembers);
  template = template.replace(/\{\{ROLLING_PNL_UPDATE_CALLS\}\}/g, rollingPnlUpdateCalls);
  template = template.replace(/\{\{ROLLING_VOTE_MEMBERS\}\}/g, rollingVoteMembers);
  template = template.replace(/\{\{CORR_MATRIX_MEMBER\}\}/g, corrMatrixMember);
  template = template.replace(/\{\{CONFIDENCE_WEIGHTED_SIZING\}\}/g, confidenceWeightedConst);
  template = template.replace(/\{\{FEED_INDEX_CONSTANTS\}\}/g, feedIndexConstants);
  template = template.replace(/\{\{EXPECTED_FEEDS_EXPORT\}\}/g, expectedFeedsExport);
  template = template.replace(/\{\{GENERATED_TIME\}\}/g, new Date().toISOString());

  template = ensureStratforgeIncludes(template);

  return template;
}

// TICKET_783_3: emit per-entry-component prior constants. Defaults to 0/0
// when no prior is supplied -- with n_prior=0, lambda_schedule still controls
// shrinkage off the rolling estimate, and the kNMin hard floor takes over
// when rolling samples are also scarce.
function buildEntryPriorsBlock(
  entries: Array<{ cachedStats: { sharpePrior: number; nPrior: number } | undefined }>,
): string {
  if (entries.length === 0) {
    return '// (no entry components in this workflow -- no priors emitted)';
  }
  const lines: string[] = [];
  entries.forEach((entry, idx) => {
    const sp = entry.cachedStats?.sharpePrior ?? 0;
    const np = entry.cachedStats?.nPrior ?? 0;
    lines.push(`constexpr double kSharpePrior_${idx} = ${formatCppDouble(sp)};`);
    lines.push(`constexpr std::int64_t kNPrior_${idx} = ${Math.trunc(np)};`);
  });
  return lines.join('\n');
}

// TICKET_783_3: emit prev_entry_signals_ workflow-class member; the array is
// zero-initialised so the first bar's update sees N x Hold (which it skips
// anyway because bar_index < 1).
function buildPrevEntrySignalsMember(entryCount: number): string {
  if (entryCount === 0) {
    return '    // (no entry components -- prev_entry_signals_ omitted)';
  }
  return `    std::array<qnx_workflow::ComponentSignal, ${entryCount}> prev_entry_signals_{};`;
}

// TICKET_783_3: emit per-entry-component RollingPnl<kRollingLookback> members.
function buildRollingPnlMembers(entryCount: number): string {
  if (entryCount === 0) {
    return '    // (no entry components -- rolling_pnl_ array omitted)';
  }
  return `    std::array<qnx_workflow::RollingPnl<kRollingLookback>, ${entryCount}> rolling_pnl_{};`;
}

// TICKET_783_3: push (sign(prev_vote_i) * bar_return) into each component's
// rolling-pnl window. was_active=false for Hold (return 0) so the window
// advances without inflating non_zero_count -- the denominator for SR_rolling.
function buildRollingPnlUpdateCalls(entryCount: number): string {
  if (entryCount === 0) {
    return '            // (no entry components -- rolling-PnL update is a no-op)';
  }
  const lines: string[] = [];
  for (let i = 0; i < entryCount; i++) {
    lines.push(`            {`);
    lines.push(`                const auto& prev = prev_entry_signals_[${i}];`);
    lines.push(`                double r = 0.0;`);
    lines.push(`                bool was_active = false;`);
    lines.push(`                if (prev.signal == qnx_workflow::Signal::EnterLong) {`);
    lines.push(`                    r = bar_return;`);
    lines.push(`                    was_active = true;`);
    lines.push(`                } else if (prev.signal == qnx_workflow::Signal::EnterShort) {`);
    lines.push(`                    r = -bar_return;`);
    lines.push(`                    was_active = true;`);
    lines.push(`                }`);
    lines.push(`                rolling_pnl_[${i}].push(r, was_active);`);
    lines.push(`            }`);
  }
  return lines.join('\n');
}

// TICKET_783_5: emit the per-entry-component RollingVote<kRollingLookback>
// array, but only under `correlation_adjusted`. The buffers store the last
// kRollingLookback bars of vote sign (+1/-1/0) as int8_t and feed
// rolling_corr for the pairwise vote-correlation matrix. Skipping emission
// under other methods keeps the strategy class layout unchanged for the
// vast majority of workflows.
function buildRollingVoteMembers(entryCount: number, signalMethod: WorkflowSignalMethod): string {
  if (signalMethod !== 'correlation_adjusted' || entryCount === 0) {
    return '    // (rolling-vote buffer omitted -- signalMethod is not correlation_adjusted)';
  }
  return `    std::array<qnx_workflow::RollingVote<kRollingLookback>, ${entryCount}> rolling_vote_{};`;
}

// TICKET_783_5: emit the N x N pairwise correlation matrix as a stack-
// allocated std::array<std::array<double, N>, N> on the workflow class.
// Recomputed every kCorrRefreshK bars from rolling_vote_; read by
// combine_entries' correlation_adjusted branch. Zero-initialised so the
// pre-warmup pass (rho == 0 for every pair) leaves the redundancy term at 0
// and the method collapses to sharpe_weighted -- the design-doc-mandated
// cold-start behaviour (T783-5b).
function buildCorrMatrixMember(entryCount: number, signalMethod: WorkflowSignalMethod): string {
  if (signalMethod !== 'correlation_adjusted' || entryCount === 0) {
    return '    // (correlation matrix omitted -- signalMethod is not correlation_adjusted)';
  }
  return `    std::array<std::array<double, ${entryCount}>, ${entryCount}> corr_matrix_{};`;
}

// TICKET_783_3: format a double in a way C++ accepts as a double literal --
// integer values get a trailing `.0` so they don't become int.
function formatCppDouble(v: number): string {
  if (!Number.isFinite(v)) {
    return '0.0';
  }
  const s = v.toString();
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

// TICKET_783_1: Emit the per-bar entry update block. Each entry component's
// on_bar() result lands in a std::array<ComponentSignal, N> and is reduced by
// combine_entries() to a single ComponentSignal that drives state_.signal.
// state_.entry_signal mirrors the combined output so any downstream consumer
// reading "the entry decision" still sees the aggregated result, not the
// last-component clobber the previous template produced.
//
// TICKET_783_3: combine_entries now also takes the rolling-pnl array so it
// can compute SR_rolling per component. After combining, the per-component
// votes are stashed into prev_entry_signals_ so the *next* bar's rolling-pnl
// update can attribute that bar's realised return to the right votes.
//
// TICKET_783_5: under `correlation_adjusted` we additionally
//   (a) push each component's vote into rolling_vote_[i] BEFORE calling
//       combine_entries -- the design doc explicitly requires the current
//       bar's vote to be visible inside the correlation matrix;
//   (b) refresh corr_matrix_ every kCorrRefreshK bars; intermediate bars
//       reuse the cached values;
//   (c) pass corr_matrix_ as a const ref into combine_entries.
// For any other method these steps collapse to no-ops so the emitted next()
// body is unchanged.
function buildEntryUpdateBlock(
  entryMemberNames: string[],
  signalMethod: WorkflowSignalMethod,
  isMultiFeed = false,
  feedIndices: number[] = [],
): string {
  if (entryMemberNames.length === 0) {
    return '';
  }
  const n = entryMemberNames.length;
  const useCorrelation = signalMethod === 'correlation_adjusted';
  const lines: string[] = [];
  lines.push('        {');
  lines.push(`            std::array<qnx_workflow::ComponentSignal, ${n}> entry_signals{};`);
  entryMemberNames.forEach((memberName, idx) => {
    const fi = feedIndices[idx] ?? 0;
    if (isMultiFeed) {
      // TICKET_1225 P3: edge semantics -- fire on_bar only when this
      // component's feed has a new bar; otherwise the zero-initialized
      // entry_signals[idx] (Hold) stands, which is the edge contract.
      lines.push(`            if (feed_advanced(${fi})) {`);
      lines.push(`                auto fctx = make_context(${fi});`);
      lines.push(`                entry_signals[${idx}] = ${memberName}_.on_bar(fctx);`);
      lines.push('            }');
    } else {
      lines.push(`            entry_signals[${idx}] = ${memberName}_.on_bar(ctx);`);
    }
  });
  if (useCorrelation) {
    // TICKET_783_5: push each component's current-bar vote sign into its
    // rolling buffer BEFORE the matrix refresh and combine -- per the design
    // doc, "update on every bar after the entry components vote (before
    // combine_entries consumes them)". EnterLong -> +1, EnterShort -> -1,
    // every other signal (Hold / Exit*) -> 0.
    lines.push(`            for (std::size_t i = 0; i < ${n}; ++i) {`);
    lines.push('                std::int8_t v = 0;');
    lines.push('                if (entry_signals[i].signal == qnx_workflow::Signal::EnterLong) v = 1;');
    lines.push('                else if (entry_signals[i].signal == qnx_workflow::Signal::EnterShort) v = -1;');
    lines.push('                rolling_vote_[i].push(v);');
    lines.push('            }');
    // Matrix refresh on bar indices that are multiples of kCorrRefreshK.
    // Diagonal stays at 1.0 by construction; pairwise rolling_corr is
    // symmetric so we only fill the upper triangle then mirror.
    lines.push('            if ((ctx.bar_index % kCorrRefreshK) == 0) {');
    lines.push(`                for (std::size_t i = 0; i < ${n}; ++i) {`);
    lines.push('                    corr_matrix_[i][i] = 1.0;');
    lines.push(`                    for (std::size_t j = i + 1; j < ${n}; ++j) {`);
    lines.push('                        const double rho = qnx_workflow::rolling_corr(rolling_vote_[i], rolling_vote_[j]);');
    lines.push('                        corr_matrix_[i][j] = rho;');
    lines.push('                        corr_matrix_[j][i] = rho;');
    lines.push('                    }');
    lines.push('                }');
    lines.push('            }');
    lines.push('            auto combined = combine_entries(entry_signals, rolling_pnl_, corr_matrix_, state_.regime);');
  } else {
    // TICKET_783_2: state_.regime is updated by REGIME_UPDATE_CALLS earlier in
    // next() so combine_entries reads the current bar's regime. Methods other
    // than regime_based consume the parameter via (void)regime and pay no
    // runtime cost.
    lines.push('            auto combined = combine_entries(entry_signals, rolling_pnl_, state_.regime);');
  }
  lines.push('            state_.entry_signal = combined;');
  lines.push('            state_.signal = combined;');
  lines.push('            prev_entry_signals_ = entry_signals;');
  lines.push('        }');
  return lines.join('\n');
}

// TICKET_783_1: Emit combine_entries() into the anonymous namespace declared
// by workflow.cpp.template. N is fixed at code-gen time so the function is a
// pure value-returning helper -- no per-bar allocation, no virtual dispatch.
//
// TICKET_783_3: the function body implements the unified formula's
// per-component layer:
//   1. n_total_i  = kNPrior_i + n_rolling_i
//   2. lambda_i   = lambda_schedule(n_rolling_i)
//   3. SR_post_i  = lambda_i * kSharpePrior_i + (1 - lambda_i) * SR_rolling_i
//   4. SR_clip_i  = max(0, SR_post_i - kSrFloor)
//   5. hard floor: if n_total_i < kNMin, the signal earns w_method_i = 1
//      regardless of method (D1: cold-start components contribute equally)
//   6. w_method_i = method-specific transform of SR_clip_i
//      -- `equal`                -> w_method_i = 1              (collapses to majority vote)
//      -- `sharpe_weighted`      -> w_method_i = SR_clip_i      (TICKET_783_4)
//      -- `regime_based`         -> w_method_i = 1, gated by allowed_regimes (TICKET_783_2)
//      -- `correlation_adjusted` -> w_method_i = SR_clip_i / (1 + sum_{j!=i} |rho_ij|)
//                                                              (TICKET_783_5)
//
// TICKET_783_4: after the per-component pass produces raw w_method values, a
// normalisation step divides every weight by their sum (when the sum is
// positive). Normalisation lives here -- the first place it is needed -- and
// applies to all weighted methods, so 783_5 (correlation_adjusted) inherits
// the same semantics. Two important corner cases:
//   * `equal` is invariant under normalisation (all weights = 1 -> all = 1/N
//     after the divide, dir-weighted score is identical in both forms up to a
//     scalar that cancels against weight_sum in the confidence ratio).
//   * `sharpe_weighted` with every SR_clip_i = 0 (e.g. all priors clipped to
//     0, no rolling) yields weight_sum = 0 -> all weights stay 0 -> score 0
//     -> Hold. This is the D2 contract: no positive-Sharpe signal => no trade.
//
// TICKET_783_5: `correlation_adjusted` divides w_raw by the redundancy
// denominator `(1 + sum_{j != i} |rho_ij|)` before normalisation. Cold-start
// rows still pin w_raw to 1.0 via the hard floor; the redundancy term is also
// 0 during warmup (corr_matrix_ is zero-initialised), so the cold-start
// behaviour collapses to sharpe_weighted exactly (T783-5b). For N=1 the
// inner sum has no terms -> denominator is 1, output identical to
// sharpe_weighted (T783-5d). Anti-correlation (rho = -1) is treated as
// redundancy via |rho|; this is the literature-standard absolute-value
// decorrelation, documented as an intentional product choice in the design
// doc rather than a bug.
//
// score is computed as a weighted sum of sign(signal_i); ties around
// kVoteThreshold map to Hold. confidence is normalised against the
// post-normalisation weight sum so it stays in [0, 1] and is interpretable as
// "fraction of total weight that agreed".
//
// kSignalMethod is still emitted as a runtime constant for observability /
// logging, but the branch on it is resolved at code-gen time -- the helper is
// specialised on the method choice, no per-bar string compare.
function buildCombineEntriesFn(
  entryCount: number,
  signalMethod: WorkflowSignalMethod,
  allowedRegimesPerEntry: WorkflowRegimeName[][],
): string {
  if (entryCount === 0) {
    // No entry components -> combine_entries is never called from the
    // generated next(). Emit a stub anyway so the placeholder is consumed
    // and the anonymous namespace still compiles.
    return [
      'inline qnx_workflow::ComponentSignal combine_entries() {',
      '    return qnx_workflow::ComponentSignal{};',
      '}',
    ].join('\n');
  }
  // Code-gen-time method dispatch. `sharpe_weighted` and `correlation_adjusted`
  // override w_raw = sr_clip; the latter also divides by the redundancy
  // denominator built from the cached pairwise vote-correlation matrix.
  // `equal` and `regime_based` keep w_raw = 1 (per-signal cold-start still
  // goes through the hard floor uniformly); `regime_based` additionally
  // zeroes w_raw on disallowed-regime components.
  const useSharpeWeights = signalMethod === 'sharpe_weighted';
  const useRegimeGating = signalMethod === 'regime_based';
  const useCorrelationAdjusted = signalMethod === 'correlation_adjusted';
  // TICKET_783_5: correlation_adjusted shares the sr_clip-based weight with
  // sharpe_weighted but adds the redundancy penalty; the per-component sr_clip
  // assignment is identical, so emit it under either flag.
  const usesSrClipWeight = useSharpeWeights || useCorrelationAdjusted;
  const reasonString = useCorrelationAdjusted
    ? 'correlation_adjusted'
    : useSharpeWeights
      ? 'sharpe_weighted'
      : useRegimeGating
        ? 'regime_based/majority-vote'
        : 'equal/majority-vote';
  const lines: string[] = [];
  // TICKET_783_2: emit per-entry kAllowedRegimes_i constexpr std::array. An
  // empty allowed-list means "all regimes allowed" -- regime_allowed() returns
  // true unconditionally for empty arrays, so empty == no gating. Always emit
  // these (even under non-regime methods) so the helper has well-defined
  // symbols to reference and tests can verify the shape; the regime branch
  // is the only consumer at runtime.
  allowedRegimesPerEntry.forEach((allowed, idx) => {
    if (allowed.length === 0) {
      lines.push(
        `constexpr std::array<qnx_workflow::Regime, 0> kAllowedRegimes_${idx}{};`,
      );
      return;
    }
    const entries = allowed
      .map(name => `qnx_workflow::Regime::${name}`)
      .join(', ');
    lines.push(
      `constexpr std::array<qnx_workflow::Regime, ${allowed.length}> kAllowedRegimes_${idx}{{ ${entries} }};`,
    );
  });
  // TICKET_783_2: regime_allowed() returns true when the allow-list is empty
  // (sentinel for "no gating, all regimes allowed") or contains the current
  // regime. Templated on the std::array size so the empty-array case still
  // type-checks. noexcept + constexpr-friendly so the compiler can fold the
  // call where regime is itself constant.
  lines.push('template <std::size_t K>');
  lines.push('[[nodiscard]] inline bool regime_allowed(');
  lines.push('    qnx_workflow::Regime regime,');
  lines.push('    const std::array<qnx_workflow::Regime, K>& allowed) noexcept {');
  lines.push('    if constexpr (K == 0) {');
  lines.push('        // Empty allow-list == "all regimes allowed" (default for un-annotated chips).');
  lines.push('        (void)regime;');
  lines.push('        (void)allowed;');
  lines.push('        return true;');
  lines.push('    } else {');
  lines.push('        for (auto r : allowed) {');
  lines.push('            if (r == regime) return true;');
  lines.push('        }');
  lines.push('        return false;');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('inline qnx_workflow::ComponentSignal combine_entries(');
  lines.push(`    const std::array<qnx_workflow::ComponentSignal, ${entryCount}>& signals,`);
  lines.push(`    const std::array<qnx_workflow::RollingPnl<kRollingLookback>, ${entryCount}>& rolling,`);
  if (useCorrelationAdjusted) {
    // TICKET_783_5: only correlation_adjusted needs the matrix. Keeping the
    // parameter out of the signature under other methods means the caller
    // shape stays exactly as it was for 783_1..4 and there's no template-class
    // member to drag around for chip sets that don't need decorrelation.
    lines.push(`    const std::array<std::array<double, ${entryCount}>, ${entryCount}>& corr_matrix,`);
  }
  lines.push('    qnx_workflow::Regime regime) {');
  // Per-component prior table -- C++23 doesn't have init-via-template-pack so
  // we emit a small std::array of {sharpe_prior, n_prior} pairs.
  lines.push(`    constexpr std::array<std::pair<double, std::int64_t>, ${entryCount}> priors{{`);
  for (let i = 0; i < entryCount; i++) {
    lines.push(`        {kSharpePrior_${i}, kNPrior_${i}}${i + 1 < entryCount ? ',' : ''}`);
  }
  lines.push('    }};');
  // Pass 1: compute raw w_method[i] + dir[i] per component. We have to buffer
  // both because TICKET_783_4's normalisation step needs the full vector
  // before any score accumulation can happen (sum of raw weights -> divisor).
  lines.push(`    std::array<double, ${entryCount}> w_method{};`);
  lines.push(`    std::array<double, ${entryCount}> dir{};`);
  lines.push('    double w_sum_raw = 0.0;');
  lines.push(`    for (std::size_t i = 0; i < ${entryCount}; ++i) {`);
  lines.push('        const auto& s = signals[i];');
  lines.push('        const auto [sharpe_prior, n_prior] = priors[i];');
  lines.push('        const std::int64_t n_rolling = rolling[i].non_zero_count();');
  lines.push('        const std::int64_t n_total = n_prior + n_rolling;');
  lines.push('        // Hard floor (TICKET_783 D1): below kNMin total samples, the');
  lines.push('        // signal cannot earn a method-specific weight -- it falls into');
  lines.push('        // per-signal equal-weight regardless of kSignalMethod. We pin');
  lines.push('        // w_method_i = 1.0 here; the normalisation pass below turns');
  lines.push('        // that into 1/N once divided by the sum.');
  lines.push('        double w_raw = 1.0;');
  lines.push('        if (n_total >= kNMin) {');
  lines.push('            const double lambda_i = lambda_schedule(n_rolling);');
  lines.push('            const double sr_rolling = rolling[i].sharpe();');
  lines.push('            const double sr_post = lambda_i * sharpe_prior');
  lines.push('                                 + (1.0 - lambda_i) * sr_rolling;');
  lines.push('            const double sr_clip = std::max(0.0, sr_post - kSrFloor);');
  if (usesSrClipWeight) {
    // TICKET_783_4 / 783_5: `sharpe_weighted` and `correlation_adjusted` use
    // sr_clip directly as the per-signal weight. Negative-prior signals
    // (sr_post < kSrFloor) are clipped to 0 and contribute no weight (D2
    // contract). correlation_adjusted then divides this by the redundancy
    // denominator in the post-loop pass below.
    lines.push('            w_raw = sr_clip;');
  } else {
    lines.push('            // `equal` / `regime_based` ignore sr_clip: w_raw stays at 1.0');
    lines.push('            // so the post-normalisation score is a pure majority vote');
    lines.push('            // (regime_based zeroes disallowed-regime weights separately');
    lines.push('            // below). sr_clip is consumed via (void) so -Wunused stays quiet');
    lines.push('            // while the Bayesian machinery is still computed.');
    lines.push('            (void)sr_clip;');
  }
  lines.push('        }');
  if (useRegimeGating) {
    // TICKET_783_2: regime gate. Applied after the cold-start floor so a
    // disallowed-regime component does not get its w_raw rescued back to 1
    // by the floor. Switch over `i` lets the compiler resolve the per-i
    // kAllowedRegimes_i lookup at codegen time -- the per-bar cost is one
    // small dispatch + at most K linear scans (K = allowed regimes for that
    // component, typically 1-2).
    lines.push('        // TICKET_783_2: regime gate -- zero w_raw when the current regime');
    lines.push('        // is not in this component\'s allow-list. Empty allow-list (the');
    lines.push('        // un-annotated default) is treated as "all regimes allowed" so');
    lines.push('        // regime_based collapses to equal-weight majority vote on chip sets');
    lines.push('        // without any allowed_regimes metadata.');
    lines.push('        switch (i) {');
    for (let i = 0; i < entryCount; i++) {
      lines.push(`        case ${i}:`);
      lines.push(`            if (!regime_allowed(regime, kAllowedRegimes_${i})) w_raw = 0.0;`);
      lines.push('            break;');
    }
    lines.push('        default:');
    lines.push('            break;');
    lines.push('        }');
  } else {
    // Suppress -Wunused-parameter for `regime` when this branch is inactive.
    // The if-constexpr-style guard keeps the parameter present in the signature
    // so the caller is identical across methods, which simplifies the caller
    // emission in buildEntryUpdateBlock.
    lines.push('        (void)regime;');
  }
  if (useCorrelationAdjusted) {
    // TICKET_783_5: redundancy penalty. corr_matrix is populated by the caller
    // every kCorrRefreshK bars from rolling_vote_ (zero-initialised until the
    // first refresh -- which is bar 0, so the first entries are always valid
    // even though rolling samples may be insufficient for a meaningful
    // correlation). |rho| is used so anti-correlated signals are treated as
    // redundant rather than as a hedge -- the literature-standard absolute-
    // value decorrelation, documented as an intentional product decision.
    // The j == i term is skipped: a component cannot make itself redundant.
    lines.push(`        double redundancy = 0.0;`);
    lines.push(`        for (std::size_t j = 0; j < ${entryCount}; ++j) {`);
    lines.push('            if (j == i) continue;');
    lines.push('            redundancy += std::abs(corr_matrix[i][j]);');
    lines.push('        }');
    lines.push('        w_raw /= (1.0 + redundancy);');
  }
  lines.push('        w_method[i] = w_raw;');
  lines.push('        w_sum_raw += w_raw;');
  lines.push('        if (s.signal == qnx_workflow::Signal::EnterLong) {');
  lines.push('            dir[i] = 1.0;');
  lines.push('        } else if (s.signal == qnx_workflow::Signal::EnterShort) {');
  lines.push('            dir[i] = -1.0;');
  lines.push('        }');
  lines.push('    }');
  // Pass 2: normalise. When w_sum_raw == 0 (only possible under
  // sharpe_weighted with every component clipped to 0) all weights stay 0,
  // which yields score 0 -> Hold via the threshold branch below. We
  // explicitly zero the array to keep "no positive-weight signal -> Hold"
  // an observable invariant rather than implicit FP behaviour.
  lines.push('    if (w_sum_raw > 0.0) {');
  lines.push(`        for (std::size_t i = 0; i < ${entryCount}; ++i) {`);
  lines.push('            w_method[i] /= w_sum_raw;');
  lines.push('        }');
  lines.push('    } else {');
  lines.push('        w_method.fill(0.0);');
  lines.push('    }');
  // Pass 3: score + weight_sum for confidence. After normalisation,
  // weight_sum == 1.0 in the non-degenerate case; the explicit accumulation
  // is left in so the degenerate (all-zero) case yields confidence 0.0.
  lines.push('    double score = 0.0;');
  lines.push('    double weight_sum = 0.0;');
  lines.push(`    for (std::size_t i = 0; i < ${entryCount}; ++i) {`);
  lines.push('        score += w_method[i] * dir[i];');
  lines.push('        weight_sum += w_method[i];');
  lines.push('    }');
  lines.push('    qnx_workflow::ComponentSignal out;');
  lines.push('    if (score > kVoteThreshold) {');
  lines.push('        out.signal = qnx_workflow::Signal::EnterLong;');
  lines.push('    } else if (score < -kVoteThreshold) {');
  lines.push('        out.signal = qnx_workflow::Signal::EnterShort;');
  lines.push('    } else {');
  lines.push('        out.signal = qnx_workflow::Signal::Hold;');
  lines.push('    }');
  lines.push('    out.confidence = (weight_sum > 0.0)');
  lines.push('        ? std::min(1.0, std::abs(score) / weight_sum)');
  lines.push('        : 0.0;');
  lines.push(`    out.reason = "${reasonString}";`);
  lines.push('    return out;');
  lines.push('}');
  return lines.join('\n');
}

function normalizeWorkflowComponent(component: CppWorkflowComponent, index: number): {
  role: 'regime' | 'entry' | 'exit';
  className: string;
  code: string;
  memberName: string;
  includes: string[];
  cachedStats?: { sharpePrior: number; nPrior: number };
  allowedRegimes: WorkflowRegimeName[];
  timeframe?: BarInterval;
} {
  const role = normalizeWorkflowRole(component.role);
  const rawCode = component.code || '';
  if (!rawCode.trim()) {
    throw new Error(`C++ workflow component ${index} has empty code`);
  }

  // TICKET_686: Transform standalone strategies into workflow component adapters
  const { includes, adaptedCode, adapterClassName } = adaptStandaloneToWorkflowComponent(rawCode, role);
  const code = adaptedCode;

  const className = adapterClassName || component.class_name || extractCppClassName(code);
  if (!className) {
    throw new Error(`C++ workflow component ${index} is missing a class name`);
  }

  // TICKET_783_3: only entry-role components carry cachedStats; defensively
  // strip it for regime / exit so a misconfigured save path can't leak into
  // the Bayesian backbone.
  const cachedStats = role === 'entry' && component.cachedStats
    && Number.isFinite(component.cachedStats.sharpePrior)
    && Number.isFinite(component.cachedStats.nPrior)
    ? {
      sharpePrior: component.cachedStats.sharpePrior,
      nPrior: component.cachedStats.nPrior,
    }
    : undefined;

  // TICKET_783_2: allowedRegimes is only consumed for entry-role components;
  // strip it for regime / exit (a regime detector gating itself would be a
  // logical loop, and exit-component gating is out of scope). validateAllowedRegimes
  // throws on unknown regime strings -- this is where T783-6c surfaces.
  const allowedRegimes = role === 'entry'
    ? validateAllowedRegimes(
      component.allowedRegimes,
      `C++ workflow component ${index} ('${component.name ?? className}')`,
    )
    : [];

  return {
    role,
    className,
    code,
    memberName: toCppIdentifier(`${role}_${index}_${component.name || className}`),
    includes,
    cachedStats,
    allowedRegimes,
    // TICKET_1225 P3: preserve the per-slot timeframe for feed binding.
    timeframe: component.timeframe,
  };
}

function normalizeWorkflowRole(role: CppWorkflowComponent['role']): 'regime' | 'entry' | 'exit' {
  if (role === 'regime' || role === 'analysis') {
    return 'regime';
  }
  if (role === 'entry' || role === 'step') {
    return 'entry';
  }
  if (role === 'exit' || role === 'postCondition' || role === 'preCondition') {
    return 'exit';
  }
  throw new Error(`Unsupported C++ workflow component role: ${role}`);
}

function toCppIdentifier(value: string): string {
  let identifier = value.trim().replace(/\W+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!identifier) {
    identifier = 'Workflow';
  }
  if (/^\d/.test(identifier)) {
    identifier = `_${identifier}`;
  }
  return identifier;
}

/**
 * Get framework path for Python imports (mirrors v3-handlers.ts::getFrameworkPath)
 */
function getFrameworkPath(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return join(app.getAppPath(), '..', '..', 'packages', 'builder-templates');
}

/**
 * Get output directory for a task (mirrors v3-handlers.ts::getTaskOutputDir)
 */
function getTaskOutputDir(taskId: string): string {
  const userDataPath = app.getPath('userData');
  return join(userDataPath, 'backtest-results', taskId);
}

/**
 * Run a backtest on a stored algorithm.
 * Looks up file_path from nona_algorithms, builds ExecutorConfig, enqueues.
 */
export async function runBacktest(
  params: RunBacktestParams,
): Promise<ApiResponse<{ taskId: string }>> {
  try {
    const db = getDatabaseManager();

    // Look up algorithm (include code column for file_path=null case)
    // TICKET_762 A3: read via v_algorithms_all so discovery signals
    // (nona_signal) and Builder algorithms (nona_algorithms) are both
    // resolvable by id. View already filters deleted_at IS NULL.
    const algorithm = db.prepare(
      `SELECT id, file_path, strategy_name, code, compile_status, compile_hash, compile_artifact_path, compile_error
       FROM v_algorithms_all WHERE id = ?`,
    ).get(params.algorithm_id) as {
      id: number;
      file_path: string | null;
      strategy_name: string;
      code: string | null;
      compile_status: string | null;
      compile_hash: string | null;
      compile_artifact_path: string | null;
      compile_error: string | null;
    } | undefined;

    if (!algorithm) {
      return { success: false, error: mainT(getCurrentMainLocale(), 'errors', 'main.backtestApi.algorithmNotFound', { id: params.algorithm_id }) };
    }

    // TICKET_690: All strategies are C++ only. Legacy Python strategies must be
    // regenerated as C++ before they can be backtested.
    let strategyPath = algorithm.file_path;

    // Check if existing strategyPath is a pre-generated main.cpp (UI-generated workflow)
    const isExistingMainCpp = strategyPath && existsSync(strategyPath)
      && strategyPath.endsWith('main.cpp');

    // TICKET_661_1 AC-6/AC-10: resolve language through the shared
    // execution-admission operation BEFORE any C++ wrapper generation.
    //
    // This replaces two ad-hoc guards that section 3.1 proved bypassable: a
    // `.py` suffix check that required a `file_path` existing on disk (a
    // code-only record has no path to test) and a
    // `classification_metadata.language === 'python'` check whose `catch` block
    // treated non-JSON metadata as C++ "backward compatible" -- assigning the
    // C++ default to exactly the class of old records most likely to be legacy
    // Python. Such a record reached `generateMainCpp()` and surfaced a compiler
    // syntax dump instead of the localized remedy.
    //
    // TICKET_762 A4: classification_metadata is read via v_algorithms_all
    // because the id may live in either parent table.
    {
      const metaRow = db.prepare(
        `SELECT classification_metadata FROM v_algorithms_all WHERE id = ?`,
      ).get(params.algorithm_id) as { classification_metadata: string | null } | undefined;

      // Workflow composition supplies its own C++ components rather than the
      // stored body, so the stored-record language decision does not apply.
      if (!params.workflow_components?.length) {
        const admission = admitAlgorithmForExecution({
          id: params.algorithm_id,
          code: algorithm.code,
          file_path: algorithm.file_path,
          classification_metadata: metaRow?.classification_metadata ?? null,
        }, {
          // TICKET_568_9: a Signal Discovery research artifact gets the
          // composition remedy rather than the regeneration remedy.
          researchArtifact: isPythonResearchArtifact(metaRow?.classification_metadata ?? null),
        });

        if (!admission.admitted) {
          return {
            success: false,
            error: describeAdmissionRefusal(admission.refusal, params.algorithm_id),
          };
        }
      }
    }

    if (isExistingMainCpp) {
      // UI-generated workflow strategy -- use as-is.
    } else {
      // MCP-generated or DB-only strategy -- need to generate a C++ entry wrapper.
      if (!algorithm.code && !params.workflow_components?.length) {
        // No code in DB and no valid file_path
        if (strategyPath && existsSync(strategyPath)) {
          // Has a file but it's a class file, read its code
          algorithm.code = readFileSync(strategyPath, 'utf-8');
        } else {
          return { success: false, error: mainT(getCurrentMainLocale(), 'errors', 'main.backtestApi.noFilePathNoCode', { id: params.algorithm_id }) };
        }
      }

      const userDataPath = app.getPath('userData');
      const taskDir = join(userDataPath, 'strategies', 'mcp-generated', `task_${Date.now()}`);
      mkdirSync(taskDir, { recursive: true });
      const sourceCode = algorithm.code || '';

      strategyPath = join(taskDir, 'main.cpp');
      if (params.workflow_components?.length) {
        writeFileSync(
          strategyPath,
          generateWorkflowStrategyCpp(algorithm.strategy_name || 'WorkflowStrategy', params.workflow_components),
        );
      } else {
        const className = extractCppClassName(sourceCode);
        if (!className) {
          return { success: false, error: mainT(getCurrentMainLocale(), 'errors', 'main.backtestApi.cannotExtractClassName', { id: params.algorithm_id }) };
        }
        writeFileSync(strategyPath, generateMainCpp(algorithm.strategy_name || className, className, sourceCode));
      }
    }

    if (!strategyPath) {
      return { success: false, error: mainT(getCurrentMainLocale(), 'errors', 'main.backtestApi.noStrategyPath', { id: params.algorithm_id }) };
    }

    // Generate task ID
    const taskId = `mcp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const outputDir = getTaskOutputDir(taskId);
    mkdirSync(outputDir, { recursive: true });

    // Parse dates (default: 2 years of data ending today)
    const now = new Date();
    const twoYearsAgo = new Date(now);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const startTime = params.start_date
      ? Math.floor(new Date(params.start_date).getTime() / 1000)
      : Math.floor(twoYearsAgo.getTime() / 1000);
    const endTime = params.end_date
      ? Math.floor(new Date(params.end_date).getTime() / 1000) + SECONDS_PER_DAY - 1
      : Math.floor(now.getTime() / 1000);

    // Download market data to parquet (mirrors UI data:ensure flow)
    const symbol = params.symbol || 'AAPL';
    const interval = params.interval || INTERVAL_1d;
    const startDateStr = params.start_date || twoYearsAgo.toISOString().split('T')[0];
    const endDateStr = params.end_date || now.toISOString().split('T')[0];
    const dataSource = params.data_source || PROVIDER_YFINANCE;

    const dataResult = await new Promise<{ dataPath?: string; error?: string }>((resolve, reject) => {
      getDataDownloadQueue().enqueue({
        symbol,
        interval,
        startDate: startDateStr,
        endDate: endDateStr,
        provider: dataSource,
        callerId: 'mcp-backtest',
        priority: 'normal',
      }, (result: any) => resolve(result), (error: any) => reject(error));
    });

    if (!dataResult.dataPath) {
      return { success: false, error: mainT(getCurrentMainLocale(), 'errors', 'main.backtestApi.dataDownloadFailed', { error: dataResult.error || 'no dataPath returned' }) };
    }

    // TICKET_650: Early error gate - fail fast when C++ compilation is known to have failed
    if (algorithm.compile_status === 'error' && algorithm.compile_error) {
      return {
        success: false,
        error: mainT(getCurrentMainLocale(), 'errors', 'main.backtestApi.compilationFailed', { error: algorithm.compile_error }),
      };
    }

    let cppStrategyArtifactPath: string | undefined;
    if (algorithm.code) {
      // Check cache first: hash match + artifact file exists
      if (algorithm.compile_status === 'success' && algorithm.compile_hash) {
        try {
          const compiledSource = buildCompilableCppSource(algorithm.code, algorithm.strategy_name);
          const resolvedIncludes = params.cpp_include_paths?.length
            ? params.cpp_include_paths
            : getCompilerResolver().resolve().info?.includes || [];
          const expectedHash = hashCppStrategySource(compiledSource, resolvedIncludes);
          const expectedArtifactPath = algorithm.compile_artifact_path || getCppArtifactPath(algorithm.id, expectedHash);
          if (expectedHash === algorithm.compile_hash && existsSync(expectedArtifactPath)) {
            cppStrategyArtifactPath = expectedArtifactPath;
          }
        } catch {
          // Hash check failed - fall through to compilation
        }
      }

      // TICKET_650 Phase 2: Cache miss or stale - trigger compilation (fail fast)
      if (!cppStrategyArtifactPath) {
        // TICKET_762 R4: runBacktest looks up algorithm.id from nona_algorithms
        // (see lookup at line 632), so the compile writeback targets that
        // table. When TICKET_762 A3/A4 switch this lookup to v_algorithms_all,
        // this site must resolve via resolveParentKind() instead.
        const compileResult = await getAlgorithmCompilationService().compileAlgorithm({
          algorithmId: algorithm.id,
          parentKind: 'algorithm',
          sourceCode: algorithm.code,
          strategyName: algorithm.strategy_name,
        });
        if (!compileResult.success) {
          return {
            success: false,
            error: `C++ pre-compilation failed: ${compileResult.error}`,
          };
        }
        cppStrategyArtifactPath = compileResult.artifactPath;
      }
    }

    // Build ExecutorConfig (mirrors v3-handlers.ts::registerBacktestHandlers)
    const config: ExecutorConfig = {
      taskId,
      language: 'cpp',
      strategyPath,
      strategyName: algorithm.strategy_name,
      frameworkPath: getFrameworkPath(),
      outputDir,
      compilerPath: params.compiler_path,
      runnerPath: params.runner_path,
      cppIncludePaths: params.cpp_include_paths,
      cppStrategyArtifactPath,
      cppHardening: params.cpp_hardening,
      data: {
        symbol,
        interval,
        startTime,
        endTime,
        dataPath: dataResult.dataPath,
        dataSourceType: 'parquet',
      },
      execution: {
        initialCapital: params.initial_capital || DEFAULT_INITIAL_CAPITAL,
        commission: params.commission || DEFAULT_COMMISSION_RATE,
        slippage: params.slippage || DEFAULT_SLIPPAGE_RATE,
        allowShort: params.allow_short ?? true,
        maxPositionSize: DEFAULT_MAX_POSITION_SIZE,
      },
      strategy: {
        params: {
          ...(params.dry_run ? { dry_run: true } : {}),
        },
      },
      checkpoint: {
        enabled: true,
        interval: CHECKPOINT_DEFAULT_INTERVAL,
        maxCount: CHECKPOINT_DEFAULT_MAX_COUNT,
        warmupPeriod: CHECKPOINT_DEFAULT_WARMUP_PERIOD,
        cleanupOnComplete: true,
      },
    };

    persistBacktestResumeConfig(config);

    // Register + enqueue
    const queue = getBacktestQueue();
    const registerResult = queue.registerPreparing(taskId, algorithm.strategy_name);
    if (!registerResult.success) {
      return { success: false, error: registerResult.error! };
    }

    const { taskId: queueTaskId, cancelled, error: enqueueError } = queue.enqueue(config);

    if (enqueueError) {
      return { success: false, error: enqueueError };
    }

    if (cancelled) {
      return { success: false, error: mainT(getCurrentMainLocale(), 'errors', 'main.backtestApi.taskCancelledDuringPrep') };
    }

    return { success: true, data: { taskId: queueTaskId } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Get backtest task status from queue or DB fallback.
 */
export async function getBacktestStatus(
  taskId: string,
): Promise<ApiResponse<{ status: string; strategyName?: string; errorMessage?: string }>> {
  try {
    // Check queue first
    const queue = getBacktestQueue();
    const task = queue.getTaskStatus(taskId);

    if (task) {
      return {
        success: true,
        data: {
          status: task.status,
          strategyName: task.strategyName,
          errorMessage: task.errorMessage,
        },
      };
    }

    // Fallback: check DB for terminal-state tasks (TICKET_360)
    const db = getDatabaseManager();
    const historyRecord = db.prepare(
      'SELECT * FROM desktop_backtest_task_history WHERE task_id = ?',
    ).get(taskId) as TaskHistoryRecord | undefined;

    if (historyRecord) {
      return {
        success: true,
        data: {
          status: historyRecord.status,
          strategyName: historyRecord.strategy_name,
          errorMessage: historyRecord.error_message || undefined,
        },
      };
    }

    // Check backtest results table
    const resultService = new BacktestResultService(db);
    const resultRecord = resultService.getByTaskId(taskId);

    if (resultRecord) {
      return {
        success: true,
        data: {
          status: 'completed',
          strategyName: resultRecord.strategy_name,
        },
      };
    }

    return { success: false, error: mainT(getCurrentMainLocale(), 'errors', 'main.backtestApi.taskNotFound', { taskId }) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * TICKET_1235_4 F1: Cancel a backtest task by ID.
 * Idempotent: cancelling a finished task returns its terminal state.
 */
export async function cancelBacktest(
  taskId: string,
): Promise<ApiResponse<{ taskId: string; status: string; wasAlreadyTerminal: boolean }>> {
  try {
    const queue = getBacktestQueue();
    const task = queue.getTaskStatus(taskId);

    if (task) {
      const isTerminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
      if (isTerminal) {
        return {
          success: true,
          data: { taskId, status: task.status, wasAlreadyTerminal: true },
        };
      }

      const cancelled = queue.cancel(taskId);
      if (cancelled) {
        return {
          success: true,
          data: { taskId, status: 'cancelled', wasAlreadyTerminal: false },
        };
      }
    }

    const { getExecutorService } = await import('../executor-service');
    const executorService = getExecutorService();
    const directCancelled = executorService.cancelTask(taskId);
    if (directCancelled) {
      return {
        success: true,
        data: { taskId, status: 'cancelled', wasAlreadyTerminal: false },
      };
    }

    return { success: false, error: mainT(getCurrentMainLocale(), 'errors', 'main.backtestApi.taskNotFound', { taskId }) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * TICKET_1235_4 F2: Get backtest queue status.
 */
export async function getBacktestQueueStatus(): Promise<ApiResponse<{
  tasks: Array<{ taskId: string; status: string; strategyName?: string; createdAt: number }>;
  activeCount: number;
  queuedCount: number;
}>> {
  try {
    const queue = getBacktestQueue();
    const status = queue.getStatus();
    return {
      success: true,
      data: {
        tasks: status.tasks.map((t) => ({
          taskId: t.taskId,
          status: t.status,
          strategyName: t.strategyName,
          createdAt: t.createdAt,
        })),
        activeCount: status.activeCount,
        queuedCount: status.queuedCount,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * TICKET_1235_4 F3: Cancel all backtest tasks.
 */
export async function cancelAllBacktests(): Promise<ApiResponse<{ cancelledCount: number }>> {
  try {
    const queue = getBacktestQueue();
    const beforeStatus = queue.getStatus();
    const activeBefore = beforeStatus.tasks.filter(
      (t) => t.status !== 'completed' && t.status !== 'failed' && t.status !== 'cancelled',
    ).length;
    queue.cancelAll();
    return {
      success: true,
      data: { cancelledCount: activeBefore },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getBacktestPhase(
  taskId: string,
): Promise<ApiResponse<{ taskId: string; phase: string | null }>> {
  try {
    const queueTask = getBacktestQueue().getTaskStatus(taskId);
    const executorTask = getExecutorService().getTask(taskId);
    if (!queueTask && !executorTask) {
      return {
        success: false,
        error: mainT(getCurrentMainLocale(), 'errors', 'main.backtestApi.taskNotFound', { taskId }),
      };
    }
    return {
      success: true,
      data: { taskId, phase: executorTask?.lastPhase ?? null },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function resumeBacktest(
  taskId: string,
  suppliedConfig?: ExecutorConfig,
): Promise<ApiResponse<{ taskId: string }>> {
  try {
    const queuedTask = getBacktestQueue().getTaskStatus(taskId);
    const originalConfig =
      suppliedConfig ??
      queuedTask?.config ??
      getExecutorService().getTask(taskId)?.config ??
      loadBacktestResumeConfig(taskId);
    if (!originalConfig) {
      return {
        success: false,
        error: `Backtest ${taskId} has a checkpoint but its executor configuration is unavailable`,
      };
    }

    const dbPath = join(app.getPath('userData'), 'data', 'checkpoints.db');
    if (!existsSync(dbPath)) {
      return { success: false, error: `Backtest checkpoint ${taskId} not found` };
    }
    const Database = (await import('better-sqlite3')).default;
    const checkpointDb = new Database(dbPath, { readonly: true });
    let checkpointBarIndex: number;
    try {
      const row = checkpointDb.prepare(
        'SELECT bar_index FROM checkpoints WHERE task_id = ? ORDER BY bar_index DESC LIMIT 1',
      ).get(taskId) as { bar_index: number } | undefined;
      if (!row) {
        return { success: false, error: `Backtest checkpoint ${taskId} not found` };
      }
      checkpointBarIndex = row.bar_index;
    } finally {
      checkpointDb.close();
    }

    const resumeConfig: ExecutorConfig = {
      ...originalConfig,
      taskId,
      checkpoint: {
        enabled: true,
        interval: originalConfig.checkpoint?.interval,
        maxCount: originalConfig.checkpoint?.maxCount,
        warmupPeriod: originalConfig.checkpoint?.warmupPeriod,
        cleanupOnComplete: originalConfig.checkpoint?.cleanupOnComplete,
      },
      resume: { enabled: true, taskId, fromBar: checkpointBarIndex },
    };
    const queued = getBacktestQueue().enqueue(resumeConfig);
    if (queued.error) return { success: false, error: queued.error };
    if (queued.cancelled) {
      return { success: false, error: `Backtest ${taskId} was cancelled before resume enqueue` };
    }
    return { success: true, data: { taskId: queued.taskId } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getBacktestCandles(params: {
  task_id: string;
} | {
  symbol: string;
  interval: string;
  start_date: string;
  end_date: string;
  data_path?: string;
}): Promise<ApiResponse<{ candles: unknown[] }>> {
  try {
    let symbol: string;
    let interval: string;
    let startDate: string;
    let endDate: string;
    let parquetPath: string | undefined;
    if ('task_id' in params) {
      const record = new BacktestResultService(getDatabaseManager()).getByTaskId(params.task_id);
      if (!record) {
        return { success: false, error: `Backtest result ${params.task_id} not found` };
      }
      symbol = record.symbol;
      interval = record.timeframe;
      startDate = record.start_date;
      endDate = record.end_date;
      parquetPath = record.data_path ?? undefined;
    } else {
      symbol = params.symbol;
      interval = params.interval;
      startDate = params.start_date;
      endDate = params.end_date;
      parquetPath = params.data_path;
    }

    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      return { success: false, error: 'Invalid backtest candle time window' };
    }

    if (!parquetPath || !existsSync(parquetPath)) {
      const result = await enqueueAndAwait({
        symbol,
        interval,
        startDate,
        endDate,
        provider: '',
        callerId: 'backtest-candles-api',
        priority: 'normal',
      });
      parquetPath = result.success ? result.dataPath : undefined;
    }
    if (!parquetPath) {
      return { success: false, error: `No market data found for ${symbol} ${interval}` };
    }

    const candles = await getParquetCacheService().readCacheInWindow(
      parquetPath,
      startMs / 1000,
      endMs / 1000,
    );
    return { success: true, data: { candles } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
