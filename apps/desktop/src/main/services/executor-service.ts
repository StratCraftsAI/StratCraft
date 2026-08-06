/**
 * Executor Service
 *
 * TICKET_133 Phase 3: Main Process Simplification
 * TICKET_681 Phase 3: stratforge-runner direct spawn (single binary, no double-process hop)
 *
 * Manages the lifecycle of the strategy execution process.
 * Spawns stratforge-runner directly for C++ strategy compilation + backtest execution.
 * Falls back to legacy StratCraft-executor if stratforge-runner is not available.
 */

import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { sendToRenderer } from '../window';
import { createLogger, getLogDirectory } from '../utils/logger';
import { EventEmitter } from 'events';
import { getDatabaseManager } from '../database/db-manager';
import { EXECUTOR_TASK_CLEANUP_DELAY_MS } from '../../shared/constants/timing';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import { BacktestResultService } from '../database/services/backtest-result-service';
import { BacktestTelemetryService, type BuilderMode, type FailureReason } from '../database/services/backtest-telemetry-service';
import { getAccessToken, getDesktopApiUrl } from '../utils/api-request';
import type { FeedPlan, FeedSpec } from '@StratCraft/types';
import {
  CorrectiveStore,
  type CorrectiveConfigV1,
  type PopArtifactManifestV1,
} from '@StratCraft/corrective-ai-core';
import type { BacktestExecutorAdapter, BacktestRunResult } from '@StratCraft/corrective-ai-core';
import { getDataRoot } from '../utils/data-root';

const executorLog = createLogger('EXECUTOR');

// =============================================================================
// Types
// =============================================================================

/**
 * TICKET_248 Phase 2: Data feed for multi-timeframe support
 */
export interface DataFeedConfig {
  interval: string;   // e.g., '1d', '1h'
  dataPath: string;   // Path to parquet file
}

export interface ExecutorConfig {
  // TICKET_681: Plugin selection (default: "cpp_backtest", Python removed)
  pluginName?: 'cpp_backtest' | 'live' | string;
  // TICKET_681: Language is always 'cpp' (pybind11 removed)
  language?: 'cpp';
  taskId?: string;  // TICKET_176: Task identifier for checkpoint
  strategyPath: string;
  strategyName?: string;  // TICKET_163: User-provided name for backtest result
  frameworkPath: string;
  outputDir: string;
  compilerPath?: string;
  runnerPath?: string;
  cppIncludePaths?: string[];
  cppStrategyArtifactPath?: string;
  cppHardening?: {
    enableSandbox?: boolean;
    runnerCpuTimeSeconds?: number;
    runnerMemoryLimitMb?: number;
    enableArtifactCache?: boolean;
    artifactCacheDir?: string;
    pchPath?: string;
  };
  data: {
    symbol: string;
    interval: string;
    startTime: number;
    endTime: number;
    dataPath: string;
    dataSourceType: string;
  };
  // TICKET_248 Phase 2: Multi-timeframe data feeds (legacy; prefer feedPlan)
  dataFeeds?: DataFeedConfig[];
  // TICKET_1225 P4: Opaque feed plan from the code generator
  feedPlan?: FeedPlan;
  execution: {
    initialCapital: number;
    commission: number;
    slippage: number;
    allowShort: boolean;
    maxPositionSize: number;
    // Order size configuration
    orderSize?: number;
    orderSizeUnit?: 'cash' | 'percent' | 'shares';
    // TICKET_1130: Total symbol count for equal-weight sizing
    symbolCount?: number;
    // TICKET_1130 Phase 2: scale position size by signal confidence
    confidenceWeightedSizing?: boolean;
  };
  strategy: {
    params: Record<string, unknown>;
  };
  // TICKET_176: Checkpoint configuration
  checkpoint?: {
    enabled?: boolean;
    interval?: number;
    maxCount?: number;
    warmupPeriod?: number;
    cleanupOnComplete?: boolean;
  };
  // TICKET_176: Resume configuration
  resume?: {
    enabled: boolean;
    taskId: string;
    fromBar?: number;
  };
  // TICKET_225: Kronos API configuration for online backtest
  kronosApi?: {
    enabled: boolean;
    endpoint: string;
    token: string;
  };
  // TICKET_1010: Builder mode for telemetry tracking
  builderMode?: string;
  // TICKET_1361 AC15: Injected corrective config for comparison runs.
  // When set, bypasses the store read in buildCorrectiveRunnerConfig().
  correctiveOverride?: {
    config: CorrectiveConfigV1;
    artifact: PopArtifactManifestV1 | null;
  };
}

export interface ExecutorProgress {
  percent: number;
  message: string;
  taskId: string;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * TICKET_783_6 Scope 3: per-signal Bayesian shrinkage summary surfaced by the
 * Alpha Factory combinator. Mirrored from the Tier 0 ConfidenceSummary in
 * plugins/data-plugin/.../types/executor.ts -- the main process cannot import
 * from a Tier 1 plugin so the shape is duplicated and kept in sync via the
 * comment trail and the renderer-side test. Field is optional: older runner
 * builds and non-workflow runs simply omit it.
 */
export interface ConfidenceSummaryEntry {
  chip_name: string;
  lambda_stat_final: number;
  n_rolling_final: number;
}

export interface ConfidenceSummary {
  lambda_warmup_final: number;
  per_signal: ConfidenceSummaryEntry[];
}

export interface ExecutorResult {
  success: boolean;
  errorMessage?: string;
  startTime: number;
  endTime: number;
  executionTimeMs: number;
  metrics: {
    totalPnl: number;
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    profitFactor: number;
  };
  equityCurve: Array<{
    timestamp: number;
    equity: number;
    drawdown: number;
  }>;
  trades: Array<{
    entryTime: number;
    exitTime: number;
    symbol: string;
    side: string;
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    pnl: number;
    commission: number;
    reason: string;
  }>;
  candles: Candle[];  // TICKET_152: OHLCV data for K-line chart
  // TICKET_398: Dry run info from executor
  dryRunInfo?: {
    isDryRun: boolean;
    totalBars: number;
    totalLlmCalls: number;
    llmCalls: Array<{ label: string; count: number }>;
  };
  /**
   * TICKET_783_6 Scope 3: optional Bayesian shrinkage summary from the
   * combinator (Alpha Factory workflow runs only). Producer lives in
   * stratforge-runner; until that ships the field is always undefined and
   * the renderer hides the confidence panel.
   */
  confidence_summary?: ConfidenceSummary;
  /**
   * TICKET_1225 P5: epoch-ms timestamp of the first next() bar (when all
   * feeds satisfied their warmup). Zero / absent for older runner builds.
   */
  warmupEndTimestamp?: number;
  /**
   * TICKET_1225 P5: per-feed bar counts from the engine run.
   * Index 0 is always the execution (master) feed.
   */
  feedBarCounts?: Array<{ index: number; interval?: string; bars: number }>;
}

export interface ExecutorTask {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  config: ExecutorConfig;
  result?: ExecutorResult;
  process?: ChildProcess;
  startTime?: number;
  endTime?: number;
  /** TICKET_322: Throttle progress IPC - last percent sent to renderer */
  lastReportedPercent?: number;
  /** TICKET_327: Track last emitted phase for late-subscriber replay */
  lastPhase?: string;
  /**
   * TICKET_789 step 5: monotonic seq from the most recent [INCREMENT_V2]
   * observed on stdout. Used to populate the executor:completed payload so
   * the renderer can verify lastAppliedSeq >= finalSeq.
   */
  lastObservedSeq?: number;
  /**
   * TICKET_789 step 5: seq carried by the [FINAL_SEQ] sentinel emitted by
   * stratforge-runner after Cerebro::run() returns. Set only on the happy
   * path; left undefined on crash / cancel.
   */
  finalSeq?: number;
}

// TICKET_155: Incremental result for realtime chart updates
// TICKET_789: V2 wire shape carries a monotonic `seq` per flush and an
// `isFinal` terminal sentinel from the upstream IncrementBatcher.
export interface IncrementalResult {
  /**
   * TICKET_789: monotonic flush sequence number starting at 1. Emitted by
   * stratforge::IncrementBatcher in the order Cerebro produces bars.
   */
  seq: number;
  /**
   * TICKET_789: true on the final snapshot emitted by IncrementBatcher
   * before the [FINAL_SEQ] sentinel. Used as a defensive check on the
   * runner exit path.
   */
  isFinal?: boolean;
  /**
   * TICKET_789: bars dropped by the batcher between flushes (e.g., when an
   * onFlush callback throws). Should normally be 0; non-zero is a signal
   * for diagnostics, not for renderer logic.
   */
  droppedSinceLastFlush?: number;
  // TICKET_155: Candles for K-line (sent on first increment)
  newCandles: Candle[];
  newTrades: Array<{
    entryTime: number;
    exitTime: number;
    symbol: string;
    side: string;
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    pnl: number;
    commission: number;
    reason: string;
  }>;
  newEquityPoints: Array<{
    timestamp: number;
    equity: number;
    drawdown: number;
  }>;
  currentMetrics: {
    totalPnl: number;
    totalReturn: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    totalTrades: number;
    winningTrades?: number;
    losingTrades?: number;
    winRate: number;
  };
  processedBars: number;
  totalBars: number;

  newCandidates?: Array<{
    candidateId: number;
    asOfTimestampNs: number;
    symbolId: number;
    side: string;
    proposedSize: number;
    finalSize: number;
    featureVector: number[];
    featureSchemaHash: number;
    gateVerdict: number;
    calibratedProbability: number;
  }>;
  newOutcomes?: Array<{
    candidateId: number;
    outcomeType: number;
    entryTimestampNs: number;
    exitTimestampNs: number;
    holdingIntervalBars: number;
    grossPnl: number;
    commission: number;
    slippage: number;
    netPnl: number;
    completionStatus: number;
    profitLabel: number;
  }>;
}

// =============================================================================
// TICKET_1361 P5: Serialize corrective config + artifact into flat runner keys
// =============================================================================

const CORRECTIVE_ARTIFACT_DIR = 'corrective/artifacts';

function serializeCorrectiveRunnerConfig(
  config: CorrectiveConfigV1,
  artifact: PopArtifactManifestV1 | null,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    corrective_state: config.state,
  };

  if (config.state === 'disabled') return flat;

  flat.corrective_mode = config.mode;
  flat.corrective_threshold = config.threshold;
  flat.corrective_sizing_exponent = config.sizingExponent;

  if (config.state === 'collect_only' || !artifact) return flat;

  const modelPath = join(getDataRoot(), CORRECTIVE_ARTIFACT_DIR, artifact.modelFilename);
  flat.corrective_model_path = modelPath;
  flat.corrective_content_hash = artifact.contentHash;
  flat.corrective_feature_schema_hash = parseInt(artifact.featureSchemaHash, 16);
  flat.corrective_feature_count = artifact.featureManifest.length;

  const cal = artifact.calibrationParams;
  flat.corrective_calibration_method = cal.method;
  if (cal.method === 'platt') {
    flat.corrective_platt_a = cal.parameters['plattA'] ?? 0;
    flat.corrective_platt_b = cal.parameters['plattB'] ?? 0;
  } else {
    const breakpoints = Object.entries(cal.parameters)
      .filter(([k]) => k.startsWith('bp_x_'))
      .sort(([a], [b]) => a.localeCompare(b));
    if (breakpoints.length > 0) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [k, v] of breakpoints) {
        xs.push(v);
        const yKey = k.replace('bp_x_', 'bp_y_');
        ys.push(cal.parameters[yKey] ?? 0);
      }
      flat.corrective_bp_x = xs.join(',');
      flat.corrective_bp_y = ys.join(',');
    }
  }

  const gv = artifact.goldenVector;
  flat.corrective_gv_features = gv.inputFeatures.join(',');
  flat.corrective_gv_expected_prob = gv.expectedProbability;
  flat.corrective_gv_expected_verdict = gv.expectedVerdict;

  return flat;
}

// =============================================================================
// Executor Service
// =============================================================================

class ExecutorService extends EventEmitter {
  private tasks: Map<string, ExecutorTask> = new Map();
  /** TICKET_352: Track all active (running) tasks for multi-task support */
  private activeTasks: Map<string, ExecutorTask> = new Map();

  /**
   * TICKET_681 Phase 3: Use stratforge-runner directly (single binary, no double-process hop).
   * Falls back to StratCraft-executor for backward compatibility.
   */
  private getExecutorBinaryName(): string {
    return process.platform === 'win32' ? 'stratforge-runner.exe' : 'stratforge-runner';
  }

  private getFallbackExecutorBinaryName(): string {
    return process.platform === 'win32' ? 'StratCraft-executor.exe' : 'StratCraft-executor';
  }


  /**
   * Get path to runner binary.
   * TICKET_681 Phase 3: Prefers stratforge-runner, falls back to StratCraft-executor.
   */
  private getExecutorPath(): string {
    const runnerBinary = this.getExecutorBinaryName();

    if (app.isPackaged) {
      // Packaged app: runner in resources
      const runnerPath = join(process.resourcesPath, 'executor', runnerBinary);
      if (existsSync(runnerPath)) return runnerPath;
      // Fallback: legacy executor
      return join(process.resourcesPath, 'executor', this.getFallbackExecutorBinaryName());
    }

    // Development: check build-parquet first (Parquet-enabled, production format)
    const devRunnerPathParquet = join(app.getAppPath(), '../../../nonabackTrader/build-parquet/runner', runnerBinary);
    if (existsSync(devRunnerPathParquet)) return devRunnerPathParquet;

    // Development: fallback to plain build (CSV-only)
    const devRunnerPath = join(app.getAppPath(), '../../../nonabackTrader/build/runner', runnerBinary);
    if (existsSync(devRunnerPath)) return devRunnerPath;

    // Fallback: legacy executor
    const legacyPath = join(app.getAppPath(), '../../packages/executor/build', this.getFallbackExecutorBinaryName());
    if (existsSync(legacyPath)) return legacyPath;

    // Return primary path (will fail with clear error)
    return devRunnerPath;
  }

  /**
   * TICKET_1361 P5: Read corrective config + resolved artifact from the store
   * and serialize into the flat keys the C++ runner expects.
   */
  private buildCorrectiveRunnerConfig(): Record<string, unknown> {
    try {
      const db = getDatabaseManager().getDb();
      const store = new CorrectiveStore(db);
      const config = store.readConfig();

      if (config.state === 'disabled') {
        return { corrective_state: 'disabled' };
      }

      let artifact: PopArtifactManifestV1 | null = null;
      if (config.state === 'enabled' && config.modelArtifactId) {
        artifact = store.getArtifact(config.modelArtifactId);
      }

      return serializeCorrectiveRunnerConfig(config, artifact);
    } catch (error) {
      executorLog.warn('[TICKET_1361] Failed to build corrective config, defaulting to disabled:', error);
      return { corrective_state: 'disabled' };
    }
  }

  /**
   * TICKET_681 Phase 3: Check if using stratforge-runner (vs legacy executor)
   */
  private isNonabtRunner(executorPath: string): boolean {
    return executorPath.includes('stratforge-runner');
  }

  /**
   * TICKET_789_2: log the SHA + build time of the runner that is about to
   * be spawned, so wire-shape / behaviour regressions can be diagnosed
   * against the exact stratforge source that produced the binary.
   *
   * Reads BUILD_INFO.json that the runner's CMake emits next to the
   * binary. If the file is missing or malformed (older runner builds,
   * legacy StratCraft-executor fallback), logs the path with
   * sha=unknown rather than failing -- identity logging must never
   * block backtest execution.
   */
  private logRunnerIdentity(executorPath: string): void {
    const buildInfoPath = join(executorPath, '..', 'BUILD_INFO.json');
    try {
      const raw = readFileSync(buildInfoPath, 'utf-8');
      const info = JSON.parse(raw) as {
        sha?: string;
        sha_short?: string;
        dirty?: string;
        built_at?: string;
        build_type?: string;
      };
      executorLog.info(
        `runner=${executorPath} sha=${info.sha_short ?? 'unknown'} ` +
        `dirty=${info.dirty ?? 'unknown'} built=${info.built_at ?? 'unknown'} ` +
        `type=${info.build_type ?? 'unknown'}`
      );
    } catch {
      executorLog.info(`runner=${executorPath} sha=unknown (no BUILD_INFO.json)`);
    }
  }


  /**
   * Generate unique task ID (TICKET_352: crypto.randomUUID for uniqueness)
   */
  private generateTaskId(): string {
    return randomUUID();
  }

  /**
   * Run a backtest with the given configuration
   */
  async runBacktest(config: ExecutorConfig): Promise<string> {
    // TICKET_352: Use pre-assigned taskId from queue if present, else generate
    const taskId = config.taskId || this.generateTaskId();

    // TICKET_176: Ensure taskId is set in config for checkpoint support
    // TICKET_681: All execution is C++ only (pybind11 removed)
    config.taskId = taskId;
    config.pluginName = 'cpp_backtest';
    config.language = 'cpp';

    const task: ExecutorTask = {
      id: taskId,
      status: 'pending',
      config,
      startTime: Date.now(),
    };

    this.tasks.set(taskId, task);

    // TICKET_1010: Record telemetry start event
    if (config.builderMode) {
      try {
        const db = getDatabaseManager();
        const telemetry = new BacktestTelemetryService(db);
        telemetry.recordStart(taskId, config.builderMode as BuilderMode, {
          strategyName: config.strategyName || 'unknown',
          symbol: config.data.symbol,
          timeframe: config.data.interval,
        });
      } catch (err) {
        executorLog.error('[TICKET_1010] Failed to record telemetry start:', err);
      }
    }

    // Start execution asynchronously
    this.executeTask(task).catch((error) => {
      executorLog.error(`Task ${taskId} failed:`, error);
      task.status = 'failed';
      task.result = {
        success: false,
        errorMessage: error.message,
        startTime: 0,
        endTime: 0,
        executionTimeMs: 0,
        metrics: {
          totalPnl: 0,
          totalReturn: 0,
          sharpeRatio: 0,
          maxDrawdown: 0,
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          profitFactor: 0,
        },
        equityCurve: [],
        trades: [],
        candles: [],
      };
      // TICKET_1010: Record telemetry failure
      this.recordTelemetryFailure(taskId, error.message);
      this.emit('task:failed', taskId, task.result);
      sendToRenderer('executor:error', { taskId, error: error.message });
    });

    return taskId;
  }

  /**
   * Execute a task
   */
  private async executeTask(task: ExecutorTask): Promise<void> {
    const executorPath = this.getExecutorPath();

    // Check if executor exists
    if (!existsSync(executorPath)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.executor.executorNotFound', { path: executorPath }));
    }

    // TICKET_789_2: emit runner identity so logs answer
    // "which stratforge source produced the binary we just spawned?"
    this.logRunnerIdentity(executorPath);

    // Ensure output directory exists
    mkdirSync(task.config.outputDir, { recursive: true });

    // TICKET_225: Inject Kronos API configuration for online backtest
    // Get current JWT token and API endpoint
    try {
      const token = await getAccessToken();
      if (token) {
        task.config.kronosApi = {
          enabled: true,
          endpoint: getDesktopApiUrl(),
          token: token,
        };
        executorLog.info(`[TICKET_225] Kronos API enabled for online backtest`);
      } else {
        executorLog.warn(`[TICKET_225] No auth token - Kronos API disabled`);
      }
    } catch (error) {
      executorLog.warn(`[TICKET_225] Failed to get auth token: ${error}`);
    }

    // Resolve top-level fields for stratforge-runner's BacktestConfigParser.
    // The flat parser only searches for top-level "data_file", "initial_cash",
    // "commission", "symbol" keys - it cannot traverse nested objects.
    const resolvedDataFile = task.config.data.dataPath
      || task.config.dataFeeds?.find(f => f.interval === task.config.data.interval)?.dataPath
      || task.config.dataFeeds?.[0]?.dataPath
      || '';

    const symbolCount = task.config.execution.symbolCount ?? 1;
    const sizerType = task.config.execution.orderSizeUnit === 'shares'
      ? 'fixed'
      : 'percent';
    const sizerParam = task.config.execution.orderSize ?? 100.0;

    // TICKET_1225 P4: Serialize feeds[] from the FeedPlan into the runner config.
    // The runner (P2) parses this flat array; `data_file` and `data.interval`
    // are back-compat for consumers that still read the old shape.
    const plan = task.config.feedPlan;
    let feeds: Array<Record<string, unknown>> | undefined;
    if (plan && plan.feeds.length > 0) {
      feeds = plan.feeds.map((spec: FeedSpec) => {
        const flat: Record<string, unknown> = {
          index: spec.index,
          interval: spec.interval,
          role: spec.role,
          source: spec.source.kind,
        };
        if (spec.source.kind === 'parquet') {
          flat.dataPath = spec.source.dataPath;
        } else {
          flat.base = spec.source.base;
        }
        return flat;
      });
    }

    // TICKET_1228_2: the runner config carries the flat feeds[] contract
    // only. Leaking the internal nested feedPlan made the runner's key scan
    // hit feedPlan.feeds first and read source="kind" from the object shape.
    const { feedPlan: _internalFeedPlan, ...taskConfigForRunner } = task.config;
    const configForRunner = {
      ...taskConfigForRunner,
      data_file: (plan?.feeds[0]?.source.kind === 'parquet' && plan.feeds[0].source.dataPath)
        ? plan.feeds[0].source.dataPath
        : resolvedDataFile,
      symbol: task.config.data.symbol,
      // TICKET_1225 P4: execution interval from the plan (finest TF)
      ...(plan ? { data: { ...task.config.data, interval: plan.executionInterval } } : {}),
      initial_cash: task.config.execution.initialCapital,
      commission: task.config.execution.commission,
      sizer_type: sizerType,
      sizer_param: sizerParam,
      symbol_count: symbolCount,
      // TICKET_1225 P4: feeds[] array consumed by the P2 runner
      ...(feeds ? { feeds } : {}),
      // TICKET_1361 P5/AC15: corrective layer config for C++ preflight/inference.
      // correctiveOverride is set by the comparison adapter to inject a specific
      // config (baseline disabled vs enabled) without touching the store.
      ...(task.config.correctiveOverride
        ? serializeCorrectiveRunnerConfig(task.config.correctiveOverride.config, task.config.correctiveOverride.artifact)
        : this.buildCorrectiveRunnerConfig()),
    };

    // Write config file
    const configPath = join(task.config.outputDir, 'config.json');
    writeFileSync(configPath, JSON.stringify(configForRunner, null, 2));

    executorLog.info(`Starting task ${task.id}`);
    executorLog.info(`  Config: ${configPath}`);
    executorLog.info(`  Output: ${task.config.outputDir}`);

    task.status = 'running';
    this.activeTasks.set(task.id, task);
    sendToRenderer('executor:started', { taskId: task.id });

    return new Promise((resolve, reject) => {
      // TICKET_681 Phase 3: Build args based on binary type
      const useNonabtRunner = this.isNonabtRunner(executorPath);
      const resultPath = join(task.config.outputDir, 'result.json');

      let spawnArgs: string[];
      if (useNonabtRunner) {
        // stratforge-runner: single binary, handles compilation + execution
        spawnArgs = [
          `--strategy-source=${task.config.strategyPath}`,
          `--config=${configPath}`,
          `--output=${resultPath}`,
        ];
        // Add include paths
        if (task.config.cppIncludePaths) {
          for (const inc of task.config.cppIncludePaths) {
            spawnArgs.push(`--include=${inc}`);
          }
        }
        // Add compiler path if specified
        if (task.config.compilerPath) {
          spawnArgs.push(`--compiler=${task.config.compilerPath}`);
        }
        // Add PCH path if specified
        if (task.config.cppHardening?.pchPath) {
          spawnArgs.push(`--pch=${task.config.cppHardening.pchPath}`);
        }
        // Add artifact cache dir if enabled
        if (task.config.cppHardening?.enableArtifactCache && task.config.cppHardening?.artifactCacheDir) {
          spawnArgs.push(`--cache-dir=${task.config.cppHardening.artifactCacheDir}`);
        }
        // Use pre-compiled artifact if available
        if (task.config.cppStrategyArtifactPath && existsSync(task.config.cppStrategyArtifactPath)) {
          // Override: use --strategy instead of --strategy-source
          spawnArgs[0] = `--strategy=${task.config.cppStrategyArtifactPath}`;
        }
        executorLog.info(`[TICKET_681] Using stratforge-runner (single binary)`);
      } else {
        // Legacy StratCraft-executor: double-process hop
        spawnArgs = [
          `--config=${configPath}`,
          `--output=${task.config.outputDir}`,
          '--verbose',
        ];
        executorLog.info(`[TICKET_681] Using legacy StratCraft-executor`);
      }

      const childProcess = spawn(executorPath, spawnArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          // Only inherit essential system variables
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USER: process.env.USER,
          LANG: process.env.LANG,
          TERM: process.env.TERM,
          DISPLAY: process.env.DISPLAY,
          XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
        },
      });

      task.process = childProcess;

      // TICKET_155: Line buffer for stdout (large JSON may be split across data events)
      let stdoutBuffer = '';

      // Parse stdout for progress and increments
      childProcess.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();

        // Process complete lines only
        const lines = stdoutBuffer.split('\n');
        // Keep the last incomplete line in buffer
        stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          const output = line.trim();
          if (!output) continue;

          executorLog.debug(`[${task.id}] ${output.substring(0, 200)}${output.length > 200 ? '...' : ''}`);

          // TICKET_321: Parse pipeline phase messages
          // TICKET_327: Store lastPhase for late-subscriber replay
          const phaseMatch = output.match(/\[PHASE\]\s*(\w+)/);
          if (phaseMatch) {
            const phase = phaseMatch[1];
            task.lastPhase = phase;
            executorLog.info(`[PHASE] ${phase} for task ${task.id}`);
            this.emit('task:phase', task.id, phase);
            sendToRenderer('executor:phase', { taskId: task.id, phase });
            continue;
          }

          // TICKET_387_P2: Parse loading sub-step status for tooltip display
          const loadingStatusMatch = output.match(/\[LOADING_STATUS\]\s*(.*)/);
          if (loadingStatusMatch) {
            const statusMessage = loadingStatusMatch[1];
            sendToRenderer('executor:phase', { taskId: task.id, phase: task.lastPhase || 'loading_data', message: statusMessage });
            continue;
          }

          // TICKET_398_2: Parse dry run LLM call counts (direct Python stdout, bypasses C++ struct)
          const dryRunLlmMatch = output.match(/\[DRY_RUN_LLM\]\s*(.*)/);
          if (dryRunLlmMatch) {
            try {
              const dryRunLlm = JSON.parse(dryRunLlmMatch[1]);
              sendToRenderer('executor:dryRunLlm', { taskId: task.id, dryRunLlm });
            } catch (e) {
              executorLog.error(`Failed to parse DRY_RUN_LLM: ${e}`);
            }
            continue;
          }

          // TICKET_789 step 5: Parse V2 progressive increment lines. The old
          // single-shot [INCREMENT] tag is removed in the same release as the
          // upstream IncrementBatcher (no dual-mode shim, per design doc
          // "Backward compatibility").
          const incrementMatch = output.match(/\[INCREMENT_V2\]\s*(.*)/);
          if (incrementMatch) {
            try {
              const increment = JSON.parse(incrementMatch[1]) as IncrementalResult;
              if (typeof increment.seq !== 'number' || increment.seq <= 0) {
                executorLog.error(`[INCREMENT_V2] missing or invalid seq: ${incrementMatch[1].slice(0, 200)}`);
                continue;
              }
              task.lastObservedSeq = increment.seq;
              // TICKET_155: Debug logging for candles and equity values
              const validEquity = increment.newEquityPoints?.filter((p) => Number.isFinite(p.equity)).length || 0;
              const firstEquity = increment.newEquityPoints?.[0]?.equity;
              executorLog.info(`[INCREMENT_V2] seq=${increment.seq}${increment.isFinal ? ' (final)' : ''} candles: ${increment.newCandles?.length || 0}, equity: ${increment.newEquityPoints?.length || 0} (valid: ${validEquity}, first: ${firstEquity}), trades: ${increment.newTrades?.length || 0}`);
              this.emit('task:increment', task.id, increment);
              sendToRenderer('executor:increment', {
                taskId: task.id,
                increment,
              });
            } catch (e) {
              executorLog.error(`Failed to parse increment: ${e}`);
            }
            continue;
          }

          // TICKET_789 step 5: Parse [FINAL_SEQ] sentinel. Emitted exactly once
          // after the last [INCREMENT_V2], before the runner returns control
          // to the OS. Stored on the task so the exit handler can forward it
          // via the executor:completed payload.
          const finalSeqMatch = output.match(/\[FINAL_SEQ\]\s*(.*)/);
          if (finalSeqMatch) {
            try {
              const parsed = JSON.parse(finalSeqMatch[1]) as { finalSeq?: number };
              if (typeof parsed.finalSeq !== 'number') {
                executorLog.error(`[FINAL_SEQ] missing finalSeq field: ${finalSeqMatch[1].slice(0, 200)}`);
              } else {
                task.finalSeq = parsed.finalSeq;
                executorLog.info(`[FINAL_SEQ] finalSeq=${parsed.finalSeq}, lastObservedSeq=${task.lastObservedSeq ?? 0}`);
              }
            } catch (e) {
              executorLog.error(`Failed to parse FINAL_SEQ: ${e}`);
            }
            continue;
          }

          // Parse progress: [XX.X%] message (TICKET_322: \s* for {:5.1f} leading spaces)
          const progressMatch = output.match(/\[\s*(\d+\.?\d*)%\]\s*(.*)/);
          if (progressMatch) {
            const percent = parseFloat(progressMatch[1]);
            const message = progressMatch[2];

            // TICKET_322: Throttle renderer updates - only send when percent changes by >= 1%
            // C++ emits ~10k progress lines; sending all overwhelms React re-renders
            const lastPercent = task.lastReportedPercent ?? -1;
            if (percent - lastPercent >= 1 || percent >= 100) {
              task.lastReportedPercent = percent;
              const progress: ExecutorProgress = {
                percent,
                message,
                taskId: task.id,
              };

              this.emit('task:progress', task.id, progress);
              sendToRenderer('executor:progress', progress);
            }
          }
        }
      });

      // Log stderr
      childProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString().trim();
        executorLog.error(`[${task.id}] ${output}`);
      });

      childProcess.on('error', (error: Error) => {
        executorLog.error(`Task ${task.id} process error:`, error);
        task.status = 'failed';
        this.activeTasks.delete(task.id);
        reject(error);
      });

      childProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        executorLog.info(`Task ${task.id} exited with code ${code}, signal ${signal}`);
        task.endTime = Date.now();
        this.activeTasks.delete(task.id);

        if (code === 0) {
          // Read results from output directory
          try {
            const resultPath = join(task.config.outputDir, 'result.json');
            if (existsSync(resultPath)) {
              // TICKET_385: Trace timing for pipeline lag investigation
              const t0 = Date.now();
              const resultData = readFileSync(resultPath, 'utf-8');
              const t1 = Date.now();
              const parsedResult = JSON.parse(resultData) as ExecutorResult;
              task.result = parsedResult;
              const t2 = Date.now();

              // TICKET_1228_2: a clean exit with success:false in result.json
              // is a FAILED run. Taking the completed path here showed a green
              // COMPLETED badge over 0 bars while the real error stayed buried
              // in result.json (TICKET_858 silent-failure violation).
              if (parsedResult.success === false) {
                const errorMessage = parsedResult.errorMessage
                  || 'Backtest failed (runner reported success=false without errorMessage)';
                executorLog.error(`Task ${task.id} runner reported failure: ${errorMessage}`);
                task.status = 'failed';
                this.recordTelemetryFailure(task.id, errorMessage);
                this.emit('task:failed', task.id);
                sendToRenderer('executor:error', {
                  taskId: task.id,
                  error: errorMessage,
                });
                reject(new Error(errorMessage));
                return;
              }

              task.status = 'completed';
              executorLog.info(`[TICKET_385_TRACE] readFile=${t1 - t0}ms, JSON.parse=${t2 - t1}ms, resultSize=${resultData.length}`);

              this.emit('task:completed', task.id, parsedResult);

              // TICKET_153: Persist result to database
              // TICKET_498: Dry run results now saved to DB with is_dry_run flag
              try {
                const db = getDatabaseManager();
                const service = new BacktestResultService(db);
                const t3 = Date.now();
                service.saveResult(task.id, task.config, parsedResult);
                const t4 = Date.now();
                executorLog.info(`[TICKET_385_TRACE] saveResult=${t4 - t3}ms`);
                executorLog.info(`[ExecutorService] Result saved to database: ${task.id}${parsedResult.dryRunInfo?.isDryRun ? ' (dry run)' : ''}`);
                // TICKET_1010: Record telemetry success
                this.recordTelemetrySuccess(task.id, parsedResult.executionTimeMs);
              } catch (dbError) {
                executorLog.error('[ExecutorService] Failed to save result to database:', dbError);
              }

              // TICKET_360 GAP-1: Deferred cleanup of completed tasks from memory
              // Result is persisted to DB; IPC handlers fall back to DB on memory miss
              this.scheduleCleanup();

              const t5 = Date.now();
              executorLog.info(`[TICKET_385_TRACE] totalBeforeIPC=${t5 - t0}ms, sending executor:completed`);
              // TICKET_398_1: Send lightweight metadata only (~1KB instead of ~23MB)
              // Candles, equityCurve, trades already delivered via onIncrement.
              // TICKET_789 step 5: finalSeq lets the renderer prove all
              // increments have been observed before applying terminal state.
              // On a clean exit stratforge-runner is contractually required
              // to emit [FINAL_SEQ]; if it is missing here log loudly so the
              // upstream regression is visible, then degrade to
              // lastObservedSeq so the renderer can still complete.
              if (task.finalSeq === undefined) {
                executorLog.error(`[TICKET_789] clean exit without [FINAL_SEQ] sentinel for task ${task.id}; falling back to lastObservedSeq=${task.lastObservedSeq ?? 0}`);
              }
              sendToRenderer('executor:completed', {
                taskId: task.id,
                result: {
                  success: parsedResult.success,
                  errorMessage: parsedResult.errorMessage,
                  startTime: parsedResult.startTime,
                  endTime: parsedResult.endTime,
                  executionTimeMs: parsedResult.executionTimeMs,
                  metrics: parsedResult.metrics,
                  dryRunInfo: parsedResult.dryRunInfo,
                  finalSeq: task.finalSeq ?? task.lastObservedSeq ?? 0,
                },
              });
              executorLog.info(`[TICKET_266] executor:completed sent successfully`);
              resolve();
            } else {
              throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.executor.resultFileNotFound'));
            }
          } catch (error) {
            task.status = 'failed';
            // TICKET_1010: Record telemetry failure
            this.recordTelemetryFailure(task.id, error instanceof Error ? error.message : String(error));
            // TICKET_352_1: Emit task:failed so queue decrements activeCount
            this.emit('task:failed', task.id);
            sendToRenderer('executor:error', {
              taskId: task.id,
              error: error instanceof Error ? error.message : String(error),
            });
            reject(error);
          }
        } else if (signal === 'SIGTERM') {
          task.status = 'cancelled';
          // TICKET_1010: Record telemetry cancellation
          if (task.config.builderMode) {
            try {
              const db = getDatabaseManager();
              const telemetry = new BacktestTelemetryService(db);
              const execMs = task.startTime ? Date.now() - task.startTime : null;
              telemetry.recordFailure(task.id, 'user_cancel', null, execMs);
            } catch (err) {
              executorLog.error('[TICKET_1010] Failed to record telemetry cancel:', err);
            }
          }
          this.emit('task:cancelled', task.id);
          sendToRenderer('executor:cancelled', { taskId: task.id });
          resolve();
        } else {
          task.status = 'failed';
          // TICKET_1010: Record telemetry failure
          this.recordTelemetryFailure(task.id, `Executor exited with code ${code}`);
          // TICKET_352_1: Emit task:failed so queue decrements activeCount
          this.emit('task:failed', task.id);
          sendToRenderer('executor:error', {
            taskId: task.id,
            error: `Executor exited with code ${code}`,
          });
          reject(new Error(`Executor exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Cancel a running task
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);

    if (!task) {
      executorLog.warn(`Task ${taskId} not found`);
      return false;
    }

    if (task.status !== 'running' || !task.process) {
      executorLog.warn(`Task ${taskId} is not running`);
      return false;
    }

    executorLog.info(`Cancelling task ${taskId}`);
    task.process.kill('SIGTERM');
    return true;
  }

  private recordTelemetrySuccess(taskId: string, executionTimeMs: number): void {
    const task = this.tasks.get(taskId);
    if (!task?.config.builderMode) return;
    try {
      const db = getDatabaseManager();
      const telemetry = new BacktestTelemetryService(db);
      telemetry.recordSuccess(taskId, executionTimeMs);
    } catch (err) {
      executorLog.error('[TICKET_1010] Failed to record telemetry success:', err);
    }
  }

  private recordTelemetryFailure(taskId: string, errorMessage: string): void {
    const task = this.tasks.get(taskId);
    if (!task?.config.builderMode) return;
    const executionTimeMs = task.startTime ? Date.now() - task.startTime : null;
    const failureReason = this.classifyFailureReason(errorMessage);
    try {
      const db = getDatabaseManager();
      const telemetry = new BacktestTelemetryService(db);
      telemetry.recordFailure(taskId, failureReason, errorMessage, executionTimeMs);
    } catch (err) {
      executorLog.error('[TICKET_1010] Failed to record telemetry failure:', err);
    }
  }

  private classifyFailureReason(errorMessage: string): FailureReason {
    const msg = errorMessage.toLowerCase();
    if (msg.includes('compilation') || msg.includes('compile') || msg.includes('g++') || msg.includes('clang')) {
      return 'compilation_error';
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'timeout';
    }
    if (msg.includes('data') || msg.includes('parquet') || msg.includes('no bars') || msg.includes('insufficient')) {
      return 'data_error';
    }
    return 'runtime_crash';
  }

  /**
   * Get task status
   */
  getTask(taskId: string): ExecutorTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get task result
   */
  getResult(taskId: string): ExecutorResult | undefined {
    return this.tasks.get(taskId)?.result;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): ExecutorTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * TICKET_352: Get number of currently active (running) tasks
   */
  getActiveCount(): number {
    return this.activeTasks.size;
  }

  /**
   * Check if any task is running
   */
  isRunning(): boolean {
    return this.activeTasks.size > 0;
  }

  /**
   * TICKET_352: Get all currently active tasks
   */
  getActiveTasks(): ExecutorTask[] {
    return Array.from(this.activeTasks.values());
  }

  /**
   * Get current running task (first active, for backward compatibility)
   */
  getCurrentTask(): ExecutorTask | null {
    if (this.activeTasks.size === 0) return null;
    return this.activeTasks.values().next().value ?? null;
  }

  /**
   * TICKET_360 GAP-1: Schedule deferred cleanup after task completion.
   * Aligned with ExecutorQueueService FINISHED_TASK_RETENTION_MS (60s).
   */
  private scheduleCleanup(): void {
    setTimeout(() => {
      this.cleanupOldTasks(EXECUTOR_TASK_CLEANUP_DELAY_MS);
    }, EXECUTOR_TASK_CLEANUP_DELAY_MS);
  }

  /**
   * Clean up completed/failed tasks older than specified age.
   * TICKET_360: Results are persisted to DB; IPC handlers fall back to DB on memory miss.
   */
  cleanupOldTasks(maxAgeMs: number = EXECUTOR_TASK_CLEANUP_DELAY_MS): void {
    const now = Date.now();
    for (const [taskId, task] of this.tasks) {
      if (
        (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') &&
        task.endTime &&
        now - task.endTime > maxAgeMs
      ) {
        this.tasks.delete(taskId);
        executorLog.info(`[TICKET_360] Cleaned up task ${taskId} from memory (age: ${Math.round((now - task.endTime) / 1000)}s)`);
      }
    }
  }
}

// =============================================================================
// TICKET_1361 AC15: BacktestExecutorAdapter for PoP comparison runs
// =============================================================================

export class CorrectiveBacktestAdapter implements BacktestExecutorAdapter {
  constructor(
    private readonly baseConfig: ExecutorConfig,
  ) {}

  async runBacktest(
    strategyArtifactId: string,
    correctiveConfig: CorrectiveConfigV1,
  ): Promise<BacktestRunResult> {
    const service = getExecutorService();

    let artifact: PopArtifactManifestV1 | null = null;
    if (correctiveConfig.state === 'enabled' && correctiveConfig.modelArtifactId) {
      const db = getDatabaseManager().getDb();
      const store = new CorrectiveStore(db);
      artifact = store.getArtifact(correctiveConfig.modelArtifactId);
    }

    const config: ExecutorConfig = {
      ...this.baseConfig,
      cppStrategyArtifactPath: strategyArtifactId,
      correctiveOverride: { config: correctiveConfig, artifact },
    };

    const taskId = await service.runBacktest(config);

    return new Promise<BacktestRunResult>((resolve, reject) => {
      const onCompleted = (completedId: string, result: ExecutorResult) => {
        if (completedId !== taskId) return;
        cleanup();

        const returns = result.trades.map(t => t.pnl);
        const wins = result.trades.filter(t => t.pnl > 0).length;

        resolve({
          runId: taskId,
          tradeCount: result.metrics.totalTrades,
          netReturn: result.metrics.totalReturn,
          returns,
          gatedCount: 0,
          resizedCount: 0,
          hitRate: result.metrics.totalTrades > 0 ? wins / result.metrics.totalTrades : 0,
          turnover: result.trades.reduce((s, t) => s + Math.abs(t.quantity * t.entryPrice), 0),
        });
      };

      const onFailed = (failedId: string) => {
        if (failedId !== taskId) return;
        cleanup();
        const task = service.getTask(taskId);
        reject(new Error(task?.result?.errorMessage || `Backtest ${taskId} failed`));
      };

      const onCancelled = (cancelledId: string) => {
        if (cancelledId !== taskId) return;
        cleanup();
        reject(new Error(`Backtest ${taskId} cancelled`));
      };

      const cleanup = () => {
        service.removeListener('task:completed', onCompleted);
        service.removeListener('task:failed', onFailed);
        service.removeListener('task:cancelled', onCancelled);
      };

      service.on('task:completed', onCompleted);
      service.on('task:failed', onFailed);
      service.on('task:cancelled', onCancelled);
    });
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let executorService: ExecutorService | null = null;

export function getExecutorService(): ExecutorService {
  if (!executorService) {
    executorService = new ExecutorService();
  }
  return executorService;
}

export function stopExecutorService(): void {
  if (executorService) {
    // TICKET_352: Cancel all active tasks (not just one)
    const activeTasks = executorService.getActiveTasks();
    for (const task of activeTasks) {
      executorService.cancelTask(task.id);
    }
    executorService = null;
  }
}
