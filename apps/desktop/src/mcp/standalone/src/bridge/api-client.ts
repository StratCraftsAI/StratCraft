/**
 * Service API Client
 *
 * TICKET_425: Unified Service API Layer
 *
 * HTTP client for the Electron Service API loopback server.
 * Uses Node.js native fetch (available in Node 18+).
 */

import type {
  CommercialCapabilityProjection,
  CommercialOperationResult,
  FactorCatalogDeactivationAttestation,
  ResearchEnvironmentApprovalAttestation,
} from '@StratCraft/types';
import { ServiceApiConfig, removeStaleDiscoveryFiles } from './discovery';
import { collectErrorCodes } from '../fetch-errors';
import {
  API_GENERATION_SESSION_START,
  API_GENERATION_SESSION_CANCEL,
  API_GENERATION_SESSION_STATE,
  API_STRATEGY_GENERATE_FROM_CATALOG,
  API_BATCH_GENERATION_START,
  API_BATCH_GENERATION_CANCEL,
  API_APP_RATE_LIMIT_STATUS,
  API_APP_SERVER_STATUS,
  API_CONFIG_RELOAD,
  API_COMMERCIAL_CAPABILITY,
  API_COMMERCIAL_EXECUTE,
  API_CONFIG_HEALTH,
  API_MACHINE_INFO,
  API_DATABASE_BACKUP,
  API_DATABASE_BACKUP_LIST,
  API_DATABASE_RESTORE,
  type LstmFitQualityConstructionErrorPayload,
} from '@StratCraft/types';
import {
  MCP_REQUEST_TIMEOUT_MS,
  MCP_GENERATION_TIMEOUT_MS,
  MCP_BACKTEST_TIMEOUT_MS,
  API_BACKTEST_LIST,
  API_BACKTEST_RESULT,
  API_BACKTEST_RUN,
  API_BACKTEST_STATUS,
  API_BACKTEST_CANCEL,
  API_BACKTEST_QUEUE,
  API_BACKTEST_CANCEL_ALL,
  API_BACKTEST_PHASE,
  API_BACKTEST_RESUME,
  API_BACKTEST_CANDLES,
  API_STRATEGY_LIST,
  API_STRATEGY_GET,
  API_STRATEGY_GENERATE,
  API_STRATEGY_PERSIST,
  API_STRATEGY_GENERATE_ENTRY,
  API_STRATEGY_GENERATE_EXIT,
  API_STRATEGY_GENERATE_KRONOS,
  API_STRATEGY_GENERATE_AI_LIBERO,
  API_STRATEGY_GENERATE_AI_STUDIO,
  API_AI_STUDIO_SESSION_START,
  API_AI_STUDIO_SESSION_CONTINUE,
  API_AI_STUDIO_SESSION_ACTION,
  API_STRATEGY_DELETE,
  API_FACTOR_LIST,
  API_SIGNAL_SOURCE_LIST,
  API_PERSONA_LIST,
  API_SIGNAL_DISCOVERY_TEMPLATES,
  API_SIGNAL_DISCOVERY_DEFINITIONS,
  API_SIGNAL_DISCOVERY_SCOREBOARD,
  API_SIGNAL_DISCOVERY_QUALITY_METRICS,
  API_SIGNAL_DISCOVERY_RUNS,
  API_SIGNAL_DISCOVERY_START_SWEEP,
  API_SIGNAL_DISCOVERY_STOP_SWEEP,
  API_SIGNAL_DISCOVERY_SWEEP_STATUS,
  API_SYSTEM_MONITOR,
  API_WORKLOAD_QUEUE_GET,
  API_WORKLOAD_QUEUE_ENQUEUE,
  API_WORKLOAD_QUEUE_DEQUEUE,
  API_RESEARCH_ENV_STATUS,
  API_RESEARCH_ENV_JOB,
  API_RESEARCH_ENV_INSTALL,
  API_RESEARCH_ENV_REPAIR,
  API_RESEARCH_ENV_VERIFY,
  API_RESEARCH_ENV_UNINSTALL,
  API_RESEARCH_ENV_REMOVE_CAPABILITY,
  API_HISTDATA_REVIEW,
  API_HISTDATA_CONFIRM,
  API_HISTDATA_EXECUTE,
  API_ALPHA_FACTORY_RUN,
  API_ALPHA_FACTORY_PROGRESS,
  API_QUANT_LAB_REFRESH_SCOREBOARD,
  API_QUANT_LAB_REROLLUP_VERDICT,
  API_QUANT_LAB_REFIT_ARTIFACT,
  API_STRATEGY_COMPILE,
  API_STRATEGY_COMPILATION_STATUS,
  API_STRATEGY_VALIDATION_REPORT,
  API_STRATEGY_TOOLCHAIN_STATUS,
  API_STRATEGY_SAVE,
  API_STRATEGY_LOAD,
  API_STRATEGY_GENERATE_WORKFLOW,
  API_BATCH_GENERATION_STATE,
  API_WORKSPACE_SYNC_STATUS,
  API_WORKSPACE_SYNC_EXPORT,
  API_WORKSPACE_SYNC_IMPORT,
  API_DATA_LIST_PROVIDERS,
  API_DATA_SEARCH_SYMBOLS,
  API_DATA_GET_SYMBOL_DATE_RANGE,
  API_DATA_CHECK_COVERAGE,
  API_DATA_LIST_SEGMENTS,
  API_DATA_GET_CACHE_STATS,
  API_DATA_LIST_IMPORTED_PACKAGES,
  API_DATA_CHECK_IMPORTED_PACKAGE_INTEGRITY,
  API_DATA_AUDIT_IMPORTED_PACKAGE_ORPHANS,
  API_DATA_BUILD_COVERAGE_REPORT,
  API_DATA_APPEND_TO_PACKAGE,
  API_DATA_REVIEW_DOWNLOAD,
  API_DATA_CONFIRM_DOWNLOAD,
  API_DATA_QUEUE_DOWNLOAD,
  API_DATA_GET_DOWNLOAD_STATUS,
  API_DATA_RETRY_FAILED,
  API_DATA_CANCEL_DOWNLOAD,
  API_DATA_GET_QUEUE_STATUS,
  API_DATA_DELETE_SEGMENTS,
  API_DATA_IMPORT_PACKAGE,
  API_DATA_REGISTER_PARQUET_DIR,
  API_DATA_REMOVE_PACKAGE,
  API_DATA_CLEAR_CACHE,
  API_PLUGIN_LIST,
  API_PLUGIN_GET,
  API_PLUGIN_GET_CONFIG,
  API_PLUGIN_SET_CONFIG,
  API_PLUGIN_ACTIVATE,
  API_PLUGIN_DEACTIVATE,
  API_PLUGIN_INSTALL,
  API_PLUGIN_UNINSTALL,
  API_ENTITLEMENT_LIST,
  API_ENTITLEMENT_GET_PLUGIN,
  API_ENTITLEMENT_TOGGLE_SERVICE,
  API_MARKETPLACE_GET_REGISTRY,
  API_MARKETPLACE_GET_PLUGIN_DETAILS,
  API_MARKETPLACE_CHECK_UPDATES,
  API_MARKETPLACE_ACTIVATE_LICENSE,
  API_MARKETPLACE_GET_LICENSE_STATUS,
  API_MARKETPLACE_REMOVE_LICENSE,
  API_MARKETPLACE_CHECK_ENTITLEMENT,
  API_MARKETPLACE_CHECK_ENTITLEMENTS_BATCH,
  API_ENTITLEMENT_GET_AUDIT_LOG,
  API_SIGMA_ELIGIBILITY,
  API_SIGMA_INSTALL,
  API_SIGMA_INSTALL_STATUS,
  API_SETTINGS_GET,
  API_SETTINGS_SET_LOCALE,
  API_SETTINGS_SET_MARKET_ROUTING,
  API_SETTINGS_SET_PROVIDER_DEFAULTS,
  API_CONVERSATION_LIST,
  API_CONVERSATION_GET,
  API_CONVERSATION_DELETE,
  API_CONVERSATION_CREATE,
  API_CONVERSATION_ADD_MESSAGE,
  API_MARKET_GET_DATA,
  API_MARKET_GET_SYMBOLS,
  API_KRONOS_RUN_PREDICTION,
  API_KRONOS_CANCEL_PREDICTION,
  API_KRONOS_LIST_MODELS,
  MCP_KRONOS_TIMEOUT_MS,
  API_SIGNAL_GENERATOR_START,
  API_SIGNAL_GENERATOR_STOP,
  API_SIGNAL_GENERATOR_STATUS,
  API_SIGNAL_GENERATOR_HISTORY,
  API_SIGNAL_GENERATOR_IMPORT_FACTORS,
  API_SIGNAL_GENERATOR_RUN_FACTOR_SWEEP,
  MCP_TRAINING_TIMEOUT_MS,
  API_SWEEP_QUEUE_GET,
  API_SWEEP_QUEUE_ENQUEUE,
  API_SWEEP_QUEUE_CANCEL,
  API_SWEEP_QUEUE_CLEAR,
  API_SIGNAL_RUN_DELETE,
  API_SIGNAL_RUN_UPDATE,
  API_SWEEP_HISTORY,
  API_SWEEP_COVERAGE,
  API_LEADERBOARD,
  API_DEFINITION_ROLLUP,
  API_CUSTOM_FACTOR_SAVE,
  API_CUSTOM_FACTOR_DELETE,
  API_SIGNAL_SOURCE_GET,
  API_SIGNAL_SOURCE_DELETE,
  API_SIGNAL_SOURCE_CONFIRM,
  API_REMEDIATION_FAMILY_BH,
  API_PROMOTION_REGISTER,
  API_PROMOTION_STATUS,
  API_ROSTER_GET_STATE,
  API_ROSTER_LIST,
  API_ROSTER_APPLY_TRANSITION,
  API_ROSTER_REMOVE,
  API_RELEGATION_GET_CONFIG,
  API_RELEGATION_SET_CONFIG,
  API_RELEGATION_RUN_CYCLE,
  API_LSTM_GET_MANIFEST,
  API_LSTM_SET_ACTIVE_VERSION,
  API_LSTM_DELETE_VERSION,
  API_LSTM_LIST_SNAPSHOTS,
  API_LSTM_SAVE_SNAPSHOT,
  API_LSTM_RESTORE_SNAPSHOT,
  API_LSTM_DELETE_SNAPSHOT,
  API_LSTM_TRAINING_START,
  API_LSTM_TRAINING_STATUS,
  API_LSTM_TRAINING_CANCEL,
  API_LSTM_TRAINING_HISTORY,
  API_LSTM_FIT_QUALITY_REPORT,
  API_ALPHA_FACTORY_SAVE_CONFIG,
  API_ALPHA_FACTORY_LOAD_CONFIG,
  API_ALPHA_FACTORY_CANCEL,
  API_ALPHA_FACTORY_CANCEL_UNIVERSE,
  API_ALPHA_FACTORY_PROVIDER_WINDOW,
  API_ALPHA_FACTORY_LAST_RESULT,
  API_CHIP_ALLOWED_REGIMES_GET,
  API_CHIP_ALLOWED_REGIMES_SET,
  API_FACTOR_MINING_START,
  API_FACTOR_MINING_REVIEW,
  API_FACTOR_MINING_EDIT,
  API_FACTOR_MINING_CONFIRM,
  API_FACTOR_MINING_STATUS,
  API_FACTOR_MINING_SESSIONS,
  API_FACTOR_CATALOG_LIST,
  API_FACTOR_CATALOG_ACTIVATE,
  API_FACTOR_CATALOG_DEACTIVATE,
  API_FACTOR_FORMULA_GENERATE,
  API_FACTOR_FORMULA_PERSIST,
  API_SETTINGS_GET_LLM_ACCESS,
} from '../constants';

const REQUEST_TIMEOUT_MS = MCP_REQUEST_TIMEOUT_MS;

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  remediation?: string;
  retryable?: boolean;
  errorDetails?: LstmFitQualityConstructionErrorPayload;
  /**
   * TICKET_1265_4: true when the failure is connection-level (nothing
   * listening on the discovered port) -- the same topology as "Electron is
   * not running". Handlers must respond exactly as they do for a null
   * discoverServiceApi() result. Never set for HTTP errors or timeouts,
   * which prove Electron is alive.
   */
  unreachable?: boolean;
}

/**
 * Connection-level error codes proving the discovered endpoint is dead or
 * unroutable. Deliberately excludes ETIMEDOUT / abort: a slow Electron is
 * alive, and treating it as absent would silently mask genuine failures.
 */
const UNREACHABLE_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH']);

// TICKET_1278_1: cause-chain traversal (undici TypeError('fetch failed',
// { cause }) incl. AggregateError multi-address connect) now lives in the
// shared fetch-errors module; the unreachable code set stays local because
// its semantics (deliberately excluding ETIMEDOUT) are this client's.
function isUnreachableError(error: unknown): boolean {
  for (const code of collectErrorCodes(error)) {
    if (UNREACHABLE_ERROR_CODES.has(code)) return true;
  }
  return false;
}

/**
 * TICKET_1265_4: single failure path for every fetch in this client.
 * Classifies connection-level failures as `unreachable` and self-heals the
 * stale discovery files so subsequent discoverServiceApi() calls return null.
 */
function failureResponse(error: unknown, config: ServiceApiConfig): ApiResponse<never> {
  const message = error instanceof Error ? error.message : String(error);
  if (isUnreachableError(error)) {
    removeStaleDiscoveryFiles(config);
    return {
      success: false,
      unreachable: true,
      errorCode: 'service_api_owner_unreachable',
      error: message,
    };
  }
  return { success: false, error: message };
}

/**
 * Make a POST request to the Service API.
 */
async function request<T>(
  config: ServiceApiConfig,
  path: string,
  body: Record<string, unknown> = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse<T>;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

async function requestContract<T>(
  config: ServiceApiConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<T | ApiResponse<never>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    return await response.json() as T;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

// Domain-specific API functions

/**
 * TICKET_1265_6 D2: the desktop LLM-access decision + server bearer.
 * Mirrors the desktop `LLMAccessResult` (LLMKeyResolver) verbatim so the MCP
 * tool gates reuse the desktop Plan>BYOK>none decision instead of
 * reimplementing it. `bearer` is the persisted, auto-refreshed server token
 * from auth-service (null when the desktop has no active sign-in).
 */
export interface LlmAccessPayload {
  access: {
    allowed: boolean;
    source: 'platform' | 'byok' | 'none';
    reason: string;
    requiresBYOK: boolean;
    userTier: string | null;
    configuredProvider?: string;
  };
  bearer: string | null;
  selectedProvider: string | null;
  selectedModel: string | null;
}

export async function getLlmAccess(config: ServiceApiConfig): Promise<ApiResponse<LlmAccessPayload>> {
  return request<LlmAccessPayload>(config, API_SETTINGS_GET_LLM_ACCESS, {});
}

export async function getAppRateLimitStatus(
  config: ServiceApiConfig,
): Promise<ApiResponse> {
  return request(config, API_APP_RATE_LIMIT_STATUS, {});
}

export async function getAppServerStatus(
  config: ServiceApiConfig,
): Promise<ApiResponse> {
  return request(config, API_APP_SERVER_STATUS, {});
}

export async function listBacktestResults(config: ServiceApiConfig, limit: number = 20): Promise<ApiResponse> {
  return request(config, API_BACKTEST_LIST, { limit });
}

export async function getBacktestResult(config: ServiceApiConfig, taskId: string): Promise<ApiResponse> {
  return request(config, API_BACKTEST_RESULT, { task_id: taskId });
}

export async function listStrategies(config: ServiceApiConfig, limit: number = 50): Promise<ApiResponse> {
  return request(config, API_STRATEGY_LIST, { limit });
}

export async function getStrategy(config: ServiceApiConfig, id: number): Promise<ApiResponse> {
  return request(config, API_STRATEGY_GET, { id });
}

export async function deleteStrategy(
  config: ServiceApiConfig,
  params: { id?: number; strategy_type?: number; signal_source_prefix?: string },
): Promise<ApiResponse> {
  return request(config, API_STRATEGY_DELETE, params);
}

/**
 * TICKET_1306_4 (D6): Persist a regime-detector result the MCP surface already
 * generated, via the Electron-owned TICKET_761 pipeline. Persistence must run
 * where the compile/audit runtime lives (the Electron main process); the MCP
 * process must never persist a row that skips the pipeline (TICKET_860).
 */
export async function persistGeneratedStrategy(
  config: ServiceApiConfig,
  params: {
    regime: string;
    strategy_name: string;
    result: Record<string, unknown>;
    rules?: unknown[];
    llm_provider?: string;
    llm_model?: string;
    persona?: string;
    preference?: string;
  },
): Promise<ApiResponse> {
  return request(config, API_STRATEGY_PERSIST, params as Record<string, unknown>);
}

export async function listFactors(config: ServiceApiConfig, limit: number = 50): Promise<ApiResponse> {
  return request(config, API_FACTOR_LIST, { limit });
}

export async function listSignalSources(config: ServiceApiConfig, limit: number = 50): Promise<ApiResponse> {
  return request(config, API_SIGNAL_SOURCE_LIST, { limit });
}

export async function listPersonas(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_PERSONA_LIST);
}

// ── TICKET_992_3: Signal-discovery read-only API functions ──────────

export async function listSweepTemplates(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_SIGNAL_DISCOVERY_TEMPLATES);
}

export async function listSignalDefinitions(
  config: ServiceApiConfig,
  params: { limit: number; template_id?: string; provider?: string },
): Promise<ApiResponse> {
  return request(config, API_SIGNAL_DISCOVERY_DEFINITIONS, params);
}

export async function getSignalScoreboard(
  config: ServiceApiConfig,
  params: { limit: number; sort_by: string; template_id?: string; min_score?: number },
): Promise<ApiResponse> {
  return request(config, API_SIGNAL_DISCOVERY_SCOREBOARD, params);
}

export async function getSignalQualityMetrics(
  config: ServiceApiConfig,
  signalRunId: number,
): Promise<ApiResponse> {
  return request(config, API_SIGNAL_DISCOVERY_QUALITY_METRICS, { signal_run_id: signalRunId });
}

export async function listSignalRuns(
  config: ServiceApiConfig,
  params: { limit: number; signal_id?: number; template_id?: string; status?: string },
): Promise<ApiResponse> {
  return request(config, API_SIGNAL_DISCOVERY_RUNS, params);
}

/**
 * TICKET_490_2: Generate a Kronos prediction strategy via LLM backend.
 * Extended timeout (120s) as generation may take time.
 */
export async function generateKronosStrategy(
  config: ServiceApiConfig,
  params: {
    strategy_name: string;
    model?: string;
    lookback?: number;
    pred_len?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    sample_count?: number;
    time_range?: string;
    start_time?: string;
    llm_provider?: string;
    llm_model?: string;
  },
): Promise<ApiResponse> {
  const GENERATION_TIMEOUT_MS = MCP_GENERATION_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_STRATEGY_GENERATE_KRONOS}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TICKET_490: Generate an entry signal strategy via LLM backend.
 * Extended timeout (120s) as generation may take time.
 */
export async function generateEntrySignal(
  config: ServiceApiConfig,
  params: {
    strategy_name: string;
    entry_signal_base?: string;
    indicators: string[];
    preference?: string;
    auto_reverse?: boolean;
    llm_provider?: string;
    llm_model?: string;
  },
): Promise<ApiResponse> {
  const GENERATION_TIMEOUT_MS = MCP_GENERATION_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_STRATEGY_GENERATE_ENTRY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TICKET_490: Generate an exit strategy via LLM backend.
 * Extended timeout (120s) as generation may take time.
 */
export async function generateExitStrategy(
  config: ServiceApiConfig,
  params: {
    strategy_name: string;
    exit_rules: Array<{
      type: string;
      trigger_pnl_percent?: number;
      scope?: string;
      max_holding_hours?: number;
      max_drawdown_percent?: number;
      indicator?: string;
      condition?: string;
      threshold?: number;
      direction?: string;
    }>;
    max_loss_percent?: number;
    llm_provider?: string;
    llm_model?: string;
  },
): Promise<ApiResponse> {
  const GENERATION_TIMEOUT_MS = MCP_GENERATION_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_STRATEGY_GENERATE_EXIT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TICKET_490: Run a backtest on a stored algorithm.
 * Extended timeout (300s) as backtest execution may take time.
 */
export async function runBacktest(
  config: ServiceApiConfig,
  params: {
    algorithm_id: number;
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
  },
): Promise<ApiResponse> {
  const BACKTEST_TIMEOUT_MS = MCP_BACKTEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKTEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_BACKTEST_RUN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TICKET_490: Get backtest task status.
 */
export async function getBacktestStatus(
  config: ServiceApiConfig,
  taskId: string,
): Promise<ApiResponse> {
  return request(config, API_BACKTEST_STATUS, { task_id: taskId });
}

/**
 * TICKET_1235_4 F1: Cancel a backtest task.
 */
export async function cancelBacktest(
  config: ServiceApiConfig,
  taskId: string,
): Promise<ApiResponse> {
  return request(config, API_BACKTEST_CANCEL, { task_id: taskId });
}

/**
 * TICKET_1235_4 F2: Get backtest queue status.
 */
export async function getBacktestQueue(
  config: ServiceApiConfig,
): Promise<ApiResponse> {
  return request(config, API_BACKTEST_QUEUE);
}

/**
 * TICKET_1235_4 F3: Cancel all backtest tasks.
 */
export async function cancelAllBacktests(
  config: ServiceApiConfig,
): Promise<ApiResponse> {
  return request(config, API_BACKTEST_CANCEL_ALL);
}

export async function getBacktestPhase(
  config: ServiceApiConfig,
  taskId: string,
): Promise<ApiResponse> {
  return request(config, API_BACKTEST_PHASE, { task_id: taskId });
}

export async function resumeBacktest(
  config: ServiceApiConfig,
  taskId: string,
): Promise<ApiResponse> {
  return request(config, API_BACKTEST_RESUME, { task_id: taskId });
}

export async function getBacktestCandles(
  config: ServiceApiConfig,
  taskId: string,
): Promise<ApiResponse> {
  return request(config, API_BACKTEST_CANDLES, { task_id: taskId });
}

/**
 * TICKET_490_5: Generate an AI Libero standalone agent strategy via LLM backend.
 * Extended timeout (120s) as generation may take time.
 */
export async function generateAILiberoStrategy(
  config: ServiceApiConfig,
  params: {
    strategy_name: string;
    prompt: string;
    preset_mode?: string;
    indicators?: string[];
    analysis_interval?: number;
    warmup_period?: number;
    lookback_bars?: number;
    batch_size?: number;
    llm_provider?: string;
    llm_model?: string;
  },
): Promise<ApiResponse> {
  const GENERATION_TIMEOUT_MS = MCP_GENERATION_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_STRATEGY_GENERATE_AI_LIBERO}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TICKET_1315 Block A: Generate an AI Studio (vibing_chat) strategy via LLM backend.
 * 3-step batch: describe -> generate_code -> save_strategy, all server-side.
 */
export async function generateAIStudioStrategy(
  config: ServiceApiConfig,
  params: {
    strategy_name: string;
    description: string;
    indicators?: string[];
    llm_provider?: string;
    llm_model?: string;
  },
): Promise<ApiResponse> {
  const GENERATION_TIMEOUT_MS = MCP_GENERATION_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_STRATEGY_GENERATE_AI_STUDIO}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

// ── TICKET_1315 Block C: AI Studio session-scoped bridge functions ──

export async function startAIStudioSession(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_AI_STUDIO_SESSION_START, params, MCP_GENERATION_TIMEOUT_MS);
}

export async function continueAIStudioSession(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_AI_STUDIO_SESSION_CONTINUE, params, MCP_GENERATION_TIMEOUT_MS);
}

export async function runAIStudioAction(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_AI_STUDIO_SESSION_ACTION, params, MCP_GENERATION_TIMEOUT_MS);
}

// ── TICKET_1035: Signal-discovery sweep trigger API functions ──────

export async function startSweep(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  const SWEEP_TIMEOUT_MS = MCP_BACKTEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SWEEP_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_SIGNAL_DISCOVERY_START_SWEEP}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

export async function stopSweep(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_SIGNAL_DISCOVERY_STOP_SWEEP);
}

export async function getSweepStatus(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_SIGNAL_DISCOVERY_SWEEP_STATUS);
}

// TICKET_1304_15: MCP remains a pure bridge to the active Service API owner.
// It never imports, verifies or executes the signed commercial module itself.
export async function getCommercialCapability(
  config: ServiceApiConfig,
  operationId: string,
): Promise<CommercialCapabilityProjection | ApiResponse<never>> {
  return requestContract(config, API_COMMERCIAL_CAPABILITY, { operationId });
}

export async function executeCommercialOperation(
  config: ServiceApiConfig,
  operationRequest: Record<string, unknown>,
): Promise<CommercialOperationResult | ApiResponse<never>> {
  return requestContract(config, API_COMMERCIAL_EXECUTE, operationRequest);
}

// ── TICKET_1235_3: Strategy Builder compile/validate/persist/workspace ──────

export async function compileStrategy(
  config: ServiceApiConfig,
  params: { algorithm_id: number; source_code?: string; strategy_name?: string },
): Promise<ApiResponse> {
  const COMPILE_TIMEOUT_MS = MCP_GENERATION_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPILE_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_STRATEGY_COMPILE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

export async function getCompilationStatus(
  config: ServiceApiConfig,
  algorithmId: number,
): Promise<ApiResponse> {
  return request(config, API_STRATEGY_COMPILATION_STATUS, { algorithm_id: algorithmId });
}

export async function getValidationReport(
  config: ServiceApiConfig,
  algorithmId: number,
): Promise<ApiResponse> {
  return request(config, API_STRATEGY_VALIDATION_REPORT, { algorithm_id: algorithmId });
}

export async function getToolchainStatus(
  config: ServiceApiConfig,
): Promise<ApiResponse> {
  return request(config, API_STRATEGY_TOOLCHAIN_STATUS);
}

export async function saveStrategy(
  config: ServiceApiConfig,
  params: { name: string; code: string; params?: Record<string, unknown>; description?: string },
): Promise<ApiResponse> {
  return request(config, API_STRATEGY_SAVE, params);
}

export async function loadStrategy(
  config: ServiceApiConfig,
  name: string,
): Promise<ApiResponse> {
  return request(config, API_STRATEGY_LOAD, { name });
}

export async function getWorkspaceSyncStatus(
  config: ServiceApiConfig,
  targetDir: string,
): Promise<ApiResponse> {
  return request(config, API_WORKSPACE_SYNC_STATUS, { target_dir: targetDir });
}

export async function exportWorkspace(
  config: ServiceApiConfig,
  targetDir: string,
): Promise<ApiResponse> {
  return request(config, API_WORKSPACE_SYNC_EXPORT, { target_dir: targetDir });
}

export async function importWorkspace(
  config: ServiceApiConfig,
  params: { source_dir: string; confirm_payload?: string },
): Promise<ApiResponse> {
  return request(config, API_WORKSPACE_SYNC_IMPORT, params);
}

export async function generateWorkflowStrategy(
  config: ServiceApiConfig,
  params: { workflows: unknown[]; confidence_weighted_sizing?: boolean },
): Promise<ApiResponse> {
  return request(config, API_STRATEGY_GENERATE_WORKFLOW, params);
}

// ── TICKET_1302 U2: Strategy generation runtime lifecycle ──────────────

export interface GenerationSessionStartParams {
  page_id: string;
  strategy_name: string;
  start_endpoint: string;
  poll_endpoint: string;
  request_body: Record<string, unknown>;
  poll_interval_ms?: number;
  timeout_ms?: number;
}

export async function startGenerationSession(
  config: ServiceApiConfig,
  params: GenerationSessionStartParams,
): Promise<ApiResponse> {
  return request(config, API_GENERATION_SESSION_START, { ...params });
}

export async function cancelGenerationSession(
  config: ServiceApiConfig,
  pageId: string,
): Promise<ApiResponse> {
  return request(config, API_GENERATION_SESSION_CANCEL, { page_id: pageId });
}

export async function getGenerationState(
  config: ServiceApiConfig,
  pageId: string,
): Promise<ApiResponse> {
  return request(config, API_GENERATION_SESSION_STATE, { page_id: pageId });
}

export interface CatalogGenerationParams {
  catalog_id: string;
  strategy_name: string;
  llm_provider?: string;
  llm_model?: string;
  customization?: {
    preference?: string;
    timeframe?: string;
    risk_level?: string;
  };
}

export async function generateFromCatalog(
  config: ServiceApiConfig,
  params: CatalogGenerationParams,
): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_GENERATION_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}${API_STRATEGY_GENERATE_FROM_CATALOG}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }
    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

export interface BatchGenerationParams {
  regime: string;
  indicators: string[];
  quantity: number;
  preference?: string;
  persona?: string | null;
  llm_provider?: string;
  llm_model?: string;
}

export async function startBatchGeneration(
  config: ServiceApiConfig,
  params: BatchGenerationParams,
): Promise<ApiResponse> {
  return request(config, API_BATCH_GENERATION_START, { ...params });
}

export async function cancelBatchGeneration(
  config: ServiceApiConfig,
): Promise<ApiResponse> {
  return request(config, API_BATCH_GENERATION_CANCEL);
}

export async function getBatchGenerationState(
  config: ServiceApiConfig,
): Promise<ApiResponse> {
  return request(config, API_BATCH_GENERATION_STATE);
}

// ── TICKET_1235_5: Alpha Factory / Quant Lab API functions ───────────

/**
 * TICKET_1235_5 F1: Run an Alpha Factory multi-signal fused backtest.
 * Extended timeout (300s) as backtest execution may take time.
 */
export async function runAlphaFactoryBacktest(
  config: ServiceApiConfig,
  params: {
    signal_ids: number[];
    markets: Array<{ market: string; symbols: string[]; execution_interval: string }>;
    fusion_method?: string;
    construction_rule?: string;
    initial_capital?: number;
    start_date?: string;
    end_date?: string;
  },
): Promise<ApiResponse> {
  const BACKTEST_TIMEOUT_MS = MCP_BACKTEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKTEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_ALPHA_FACTORY_RUN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TICKET_1281: Poll the system-monitor snapshot (system CPU/mem/GPU +
 * per-workload attribution) for the web-dashboard sidebar panel.
 */
export async function getSystemMonitor(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_SYSTEM_MONITOR);
}

export async function getWorkloadQueue(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_WORKLOAD_QUEUE_GET);
}

export async function enqueueWorkload(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_WORKLOAD_QUEUE_ENQUEUE, params);
}

export async function dequeueWorkload(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_WORKLOAD_QUEUE_DEQUEUE, params);
}

// ---------------------------------------------------------------------------
// TICKET_1335: research environment
//
// The two mutating calls take the attestation as a distinct, typed parameter
// rather than folding it into a `params` bag. That is a deliberate shape: every
// other bridge function forwards a model-authored argument object, and if the
// attestation shared that channel, a model that emitted an `attestation` key
// would author its own proof-of-human. Here the handler can only supply it from
// what the authority attested, and the tool's public input schema has no such
// field at all (D6 item 3).
// ---------------------------------------------------------------------------

export async function getResearchEnvironmentStatus(
  config: ServiceApiConfig,
): Promise<ApiResponse> {
  return request(config, API_RESEARCH_ENV_STATUS);
}

export async function getResearchEnvironmentJob(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_RESEARCH_ENV_JOB, params);
}

export async function verifyResearchEnvironment(
  config: ServiceApiConfig,
): Promise<ApiResponse> {
  return request(config, API_RESEARCH_ENV_VERIFY);
}

export async function installResearchEnvironment(
  config: ServiceApiConfig,
  attestation: ResearchEnvironmentApprovalAttestation,
): Promise<ApiResponse> {
  return request(config, API_RESEARCH_ENV_INSTALL, { attestation });
}

export async function repairResearchEnvironment(
  config: ServiceApiConfig,
  attestation: ResearchEnvironmentApprovalAttestation,
): Promise<ApiResponse> {
  return request(config, API_RESEARCH_ENV_REPAIR, { attestation });
}

export async function uninstallResearchEnvironment(
  config: ServiceApiConfig,
  attestation: ResearchEnvironmentApprovalAttestation,
): Promise<ApiResponse> {
  return request(config, API_RESEARCH_ENV_UNINSTALL, { attestation });
}

export async function removeResearchEnvironmentCapability(
  config: ServiceApiConfig,
  attestation: ResearchEnvironmentApprovalAttestation,
): Promise<ApiResponse> {
  return request(config, API_RESEARCH_ENV_REMOVE_CAPABILITY, { attestation });
}

// ---------------------------------------------------------------------------
// TICKET_1364: HistData forex acquisition
// ---------------------------------------------------------------------------

export async function histdataReview(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_HISTDATA_REVIEW, params);
}

export async function histdataConfirm(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_HISTDATA_CONFIRM, params);
}

export async function histdataExecute(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_HISTDATA_EXECUTE, params);
}

/**
 * TICKET_1235_5_1: Poll Alpha Factory backtest progress.
 */
export async function getAlphaFactoryProgress(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_ALPHA_FACTORY_PROGRESS);
}

/**
 * TICKET_1235_5 F4: Refresh scoreboard recomputation.
 */
export async function refreshScoreboard(
  config: ServiceApiConfig,
  params: { mode?: string },
): Promise<ApiResponse> {
  return request(config, API_QUANT_LAB_REFRESH_SCOREBOARD, params);
}

/**
 * TICKET_1235_5 F4: Re-compute verdicts for stale sessions.
 */
export async function rerollupVerdict(
  config: ServiceApiConfig,
  params: { limit?: number },
): Promise<ApiResponse> {
  return request(config, API_QUANT_LAB_REROLLUP_VERDICT, params);
}

/**
 * TICKET_1235_5 F4: Re-fit missing model artifacts.
 */
export async function refitArtifact(
  config: ServiceApiConfig,
  params: {
    timeframe?: string;
    template_id?: string;
    verdict_filter?: string[];
    limit?: number;
    dry_run?: boolean;
  },
): Promise<ApiResponse> {
  return request(config, API_QUANT_LAB_REFIT_ARTIFACT, params);
}

// ── TICKET_1235_2: Data Management API functions ──────────────────────

export async function dataListProviders(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_DATA_LIST_PROVIDERS);
}

export async function dataSearchSymbols(config: ServiceApiConfig, params: { query: string; provider?: string }): Promise<ApiResponse> {
  return request(config, API_DATA_SEARCH_SYMBOLS, params);
}

export async function dataGetSymbolDateRange(config: ServiceApiConfig, params: { symbol: string; provider?: string }): Promise<ApiResponse> {
  return request(config, API_DATA_GET_SYMBOL_DATE_RANGE, params);
}

export async function dataCheckCoverage(config: ServiceApiConfig, params: { symbol: string; interval: string; start_date: string; end_date: string }): Promise<ApiResponse> {
  return request(config, API_DATA_CHECK_COVERAGE, params);
}

export async function dataListSegments(config: ServiceApiConfig, params: { provider?: string; symbol?: string; interval?: string; limit?: number; offset?: number }): Promise<ApiResponse> {
  return request(config, API_DATA_LIST_SEGMENTS, params);
}

export async function dataGetCacheStats(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_DATA_GET_CACHE_STATS);
}

export async function dataListImportedPackages(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_DATA_LIST_IMPORTED_PACKAGES);
}

export async function dataReviewDownload(config: ServiceApiConfig, params: Record<string, unknown>): Promise<ApiResponse> {
  return request(config, API_DATA_REVIEW_DOWNLOAD, params);
}

export async function dataConfirmDownload(config: ServiceApiConfig, params: Record<string, unknown>): Promise<ApiResponse> {
  return request(config, API_DATA_CONFIRM_DOWNLOAD, params);
}

export async function dataQueueDownload(config: ServiceApiConfig, params: { symbol: string; interval: string; provider?: string; start_date?: string; end_date?: string }): Promise<ApiResponse> {
  return request(config, API_DATA_QUEUE_DOWNLOAD, params);
}

export async function dataGetDownloadStatus(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_DATA_GET_DOWNLOAD_STATUS);
}

export async function dataRetryFailed(config: ServiceApiConfig, params: { symbol?: string }): Promise<ApiResponse> {
  return request(config, API_DATA_RETRY_FAILED, params);
}

export async function dataCancelDownload(config: ServiceApiConfig, params: { task_id?: string }): Promise<ApiResponse> {
  return request(config, API_DATA_CANCEL_DOWNLOAD, params);
}

export async function dataGetQueueStatus(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_DATA_GET_QUEUE_STATUS);
}

export async function dataDeleteSegments(config: ServiceApiConfig, params: { segment_ids: number[]; confirm: boolean }): Promise<ApiResponse> {
  return request(config, API_DATA_DELETE_SEGMENTS, params);
}

export async function dataImportPackage(config: ServiceApiConfig, params: { path: string; package_name?: string; adjust_mode?: string }): Promise<ApiResponse> {
  return request(config, API_DATA_IMPORT_PACKAGE, params);
}

export async function dataRegisterParquetDir(config: ServiceApiConfig, params: { package_name: string; adjust_mode?: string; source_dialect?: string; archival_cadence?: string }): Promise<ApiResponse> {
  return request(config, API_DATA_REGISTER_PARQUET_DIR, params);
}

export async function dataRemovePackage(config: ServiceApiConfig, params: { package_name: string; confirm: boolean }): Promise<ApiResponse> {
  return request(config, API_DATA_REMOVE_PACKAGE, params);
}

export async function dataCheckIntegrity(config: ServiceApiConfig, params: { package_name: string }): Promise<ApiResponse> {
  return request(config, API_DATA_CHECK_IMPORTED_PACKAGE_INTEGRITY, params);
}

export async function dataAuditOrphans(config: ServiceApiConfig, params: { package_name: string }): Promise<ApiResponse> {
  return request(config, API_DATA_AUDIT_IMPORTED_PACKAGE_ORPHANS, params);
}

export async function dataBuildCoverageReport(config: ServiceApiConfig, params: { package_name: string; format?: string }): Promise<ApiResponse> {
  return request(config, API_DATA_BUILD_COVERAGE_REPORT, params);
}

export async function dataAppendToPackage(config: ServiceApiConfig, params: { package_name: string; source_path: string; symbol_filter?: string[]; force?: boolean }): Promise<ApiResponse> {
  return request(config, API_DATA_APPEND_TO_PACKAGE, params);
}

export async function dataClearCache(config: ServiceApiConfig, params: { confirm: boolean }): Promise<ApiResponse> {
  return request(config, API_DATA_CLEAR_CACHE, params);
}

// ── TICKET_1235_7: Plugin Lifecycle & Entitlement API functions ──────

export async function pluginList(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_PLUGIN_LIST);
}

export async function pluginGet(config: ServiceApiConfig, params: { plugin_id: string }): Promise<ApiResponse> {
  return request(config, API_PLUGIN_GET, params);
}

export async function pluginGetConfig(config: ServiceApiConfig, params: { plugin_id: string }): Promise<ApiResponse> {
  return request(config, API_PLUGIN_GET_CONFIG, params);
}

export async function pluginSetConfig(config: ServiceApiConfig, params: { plugin_id: string; key: string; value: unknown }): Promise<ApiResponse> {
  return request(config, API_PLUGIN_SET_CONFIG, params);
}

export async function pluginActivate(config: ServiceApiConfig, params: { plugin_id: string }): Promise<ApiResponse> {
  return request(config, API_PLUGIN_ACTIVATE, params);
}

export async function pluginDeactivate(config: ServiceApiConfig, params: { plugin_id: string }): Promise<ApiResponse> {
  return request(config, API_PLUGIN_DEACTIVATE, params);
}

export async function pluginInstall(config: ServiceApiConfig, params: {
  plugin_id: string;
  version?: string;
  confirm: boolean;
}): Promise<ApiResponse> {
  return request(config, API_PLUGIN_INSTALL, params);
}

export async function pluginUninstall(config: ServiceApiConfig, params: { plugin_id: string; confirm: boolean }): Promise<ApiResponse> {
  return request(config, API_PLUGIN_UNINSTALL, params);
}

export async function entitlementList(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_ENTITLEMENT_LIST);
}

export async function entitlementGetPlugin(config: ServiceApiConfig, params: { plugin_id: string }): Promise<ApiResponse> {
  return request(config, API_ENTITLEMENT_GET_PLUGIN, params);
}

export async function entitlementToggleService(config: ServiceApiConfig, params: { plugin_id: string; service_id: string; enabled: boolean }): Promise<ApiResponse> {
  return request(config, API_ENTITLEMENT_TOGGLE_SERVICE, params);
}

export async function marketplaceGetRegistry(
  config: ServiceApiConfig,
  params: { force_refresh?: boolean },
): Promise<ApiResponse> {
  return request(config, API_MARKETPLACE_GET_REGISTRY, params);
}

export async function marketplaceGetPluginDetails(
  config: ServiceApiConfig,
  params: { plugin_id: string },
): Promise<ApiResponse> {
  return request(config, API_MARKETPLACE_GET_PLUGIN_DETAILS, params);
}

export async function marketplaceCheckUpdates(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_MARKETPLACE_CHECK_UPDATES);
}

export async function marketplaceActivateLicense(
  config: ServiceApiConfig,
  params: { plugin_id: string; license_key: string; confirm: boolean },
): Promise<ApiResponse> {
  return request(config, API_MARKETPLACE_ACTIVATE_LICENSE, params);
}

export async function marketplaceGetLicenseStatus(
  config: ServiceApiConfig,
  params: { plugin_ids: string[] },
): Promise<ApiResponse> {
  return request(config, API_MARKETPLACE_GET_LICENSE_STATUS, params);
}

export async function marketplaceRemoveLicense(
  config: ServiceApiConfig,
  params: { plugin_id: string; confirm: boolean },
): Promise<ApiResponse> {
  return request(config, API_MARKETPLACE_REMOVE_LICENSE, params);
}

export async function marketplaceCheckEntitlement(
  config: ServiceApiConfig,
  params: { plugin_id: string },
): Promise<ApiResponse> {
  return request(config, API_MARKETPLACE_CHECK_ENTITLEMENT, params);
}

export async function marketplaceCheckEntitlementsBatch(
  config: ServiceApiConfig,
  params: { plugin_ids: string[] },
): Promise<ApiResponse> {
  return request(config, API_MARKETPLACE_CHECK_ENTITLEMENTS_BATCH, params);
}

export async function entitlementGetAuditLog(
  config: ServiceApiConfig,
  params: { limit?: number },
): Promise<ApiResponse> {
  return request(config, API_ENTITLEMENT_GET_AUDIT_LOG, params);
}

export async function sigmaEligibility(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_SIGMA_ELIGIBILITY);
}

export async function sigmaInstall(
  config: ServiceApiConfig,
  params: {
    attestation_id: string;
    evidence_revision: string;
    dispatch_route: string;
  },
): Promise<ApiResponse> {
  return request(config, API_SIGMA_INSTALL, params);
}

export async function sigmaInstallStatus(
  config: ServiceApiConfig,
  params: { operation_instance_id: string },
): Promise<ApiResponse> {
  return request(config, API_SIGMA_INSTALL_STATUS, params);
}

/**
 * TICKET_426_1: Generate a strategy via LLM backend.
 * Extended timeout (120s) as generation may take time.
 */
export async function generateStrategy(
  config: ServiceApiConfig,
  params: {
    regime: string;
    indicators: string[];
    strategy_name: string;
    preference?: string;
    persona?: string;
    llm_provider?: string;
    llm_model?: string;
  },
): Promise<ApiResponse> {
  const GENERATION_TIMEOUT_MS = MCP_GENERATION_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_STRATEGY_GENERATE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

// ── TICKET_1235_8: Settings & Conversations ──────────────────────────────────

export async function settingsGet(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_SETTINGS_GET);
}

export async function settingsSetLocale(
  config: ServiceApiConfig,
  params: { locale: string },
): Promise<ApiResponse> {
  return request(config, API_SETTINGS_SET_LOCALE, params);
}

export async function settingsSetMarketRouting(
  config: ServiceApiConfig,
  params: { market: string; preference: string[] },
): Promise<ApiResponse> {
  return request(config, API_SETTINGS_SET_MARKET_ROUTING, params);
}

export async function settingsSetProviderDefaults(
  config: ServiceApiConfig,
  params: { domain: string; provider_id: string | null },
): Promise<ApiResponse> {
  return request(config, API_SETTINGS_SET_PROVIDER_DEFAULTS, params);
}

// TICKET_1276 P1: the LLM settings bridge methods (settingsListLlmProviders /
// settingsSetLlmSelection / settingsSetLlmCredential / settingsCheckLlmCredential)
// were removed -- those operations are now served directly from the shared
// credential store + provider resolver in mcp-secure-credentials.ts. The route
// constants (API_SETTINGS_*_LLM_*) remain in the shared types for the Electron
// Service API server, which still exposes them for other consumers.

export async function conversationList(
  config: ServiceApiConfig,
  params: { limit?: number; offset?: number },
): Promise<ApiResponse> {
  return request(config, API_CONVERSATION_LIST, params);
}

export async function conversationGet(
  config: ServiceApiConfig,
  params: { id: number },
): Promise<ApiResponse> {
  return request(config, API_CONVERSATION_GET, params);
}

export async function conversationDelete(
  config: ServiceApiConfig,
  params: { id: number; confirm: boolean },
): Promise<ApiResponse> {
  return request(config, API_CONVERSATION_DELETE, params);
}

// ── TICKET_1237_1: Agent core -- conversation writes + agent execution mode ──

export async function conversationCreate(
  config: ServiceApiConfig,
  params: { title?: string; preview?: string },
): Promise<ApiResponse<{ id: number }>> {
  return request(config, API_CONVERSATION_CREATE, params);
}

export async function conversationAddMessage(
  config: ServiceApiConfig,
  params: {
    conversation_id: number;
    type: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: string;
    token_count?: number;
  },
): Promise<ApiResponse<{ id: number }>> {
  return request(config, API_CONVERSATION_ADD_MESSAGE, params);
}

// ── TICKET_1235_9: Chart / Market Data API functions ────────────────────

export async function marketGetData(
  config: ServiceApiConfig,
  params: { symbol: string; interval: string; start_date: string; end_date: string; provider?: string },
): Promise<ApiResponse> {
  return request(config, API_MARKET_GET_DATA, params);
}

export async function marketGetSymbols(
  config: ServiceApiConfig,
  params: { query?: string; provider?: string; limit?: number },
): Promise<ApiResponse> {
  return request(config, API_MARKET_GET_SYMBOLS, params);
}

/**
 * TICKET_1235_9 F2: Run a Kronos prediction.
 * Extended timeout (120s) as predictions may take time.
 */
export async function kronosRunPrediction(
  config: ServiceApiConfig,
  params: {
    symbol: string;
    timeframe: string;
    prediction_settings?: { lookback?: number; pred_len?: number; model_version?: string };
    advanced_settings?: { temperature?: number; top_p?: number; top_k?: number; sample_count?: number };
  },
): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_KRONOS_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_KRONOS_RUN_PREDICTION}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

export async function kronosCancelPrediction(
  config: ServiceApiConfig,
  params: { task_id: string },
): Promise<ApiResponse> {
  return request(config, API_KRONOS_CANCEL_PREDICTION, params);
}

export async function kronosListModels(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_KRONOS_LIST_MODELS);
}

// ── TICKET_1235_10: Signal Generator Plugin API functions ──────────────

export async function signalGeneratorStart(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_SIGNAL_GENERATOR_START, params);
}

export async function signalGeneratorStop(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_SIGNAL_GENERATOR_STOP);
}

export async function signalGeneratorStatus(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_SIGNAL_GENERATOR_STATUS);
}

export async function signalGeneratorHistory(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_SIGNAL_GENERATOR_HISTORY, params);
}

export async function signalGeneratorImportFactors(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  const IMPORT_TIMEOUT_MS = MCP_TRAINING_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_SIGNAL_GENERATOR_IMPORT_FACTORS}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

export async function signalGeneratorRunFactorSweep(
  config: ServiceApiConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_SIGNAL_GENERATOR_RUN_FACTOR_SWEEP, params);
}

// ── TICKET_1235_5_2: Quant Lab Remaining Surface API functions ──────────

export async function getSweepQueue(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_SWEEP_QUEUE_GET);
}

export async function enqueueSweepItem(config: ServiceApiConfig, params: { template_id: string; symbol: string; interval: string; provider?: string }): Promise<ApiResponse> {
  return request(config, API_SWEEP_QUEUE_ENQUEUE, params);
}

export async function cancelSweepItem(config: ServiceApiConfig, params: { item_id: string }): Promise<ApiResponse> {
  return request(config, API_SWEEP_QUEUE_CANCEL, params);
}

export async function clearSweepQueue(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_SWEEP_QUEUE_CLEAR);
}

export async function deleteSignalRun(config: ServiceApiConfig, params: { signal_run_id: number; confirm: boolean }): Promise<ApiResponse> {
  return request(config, API_SIGNAL_RUN_DELETE, params);
}

export async function updateSignalRun(config: ServiceApiConfig, params: { signal_run_id: number; verdict: string }): Promise<ApiResponse> {
  return request(config, API_SIGNAL_RUN_UPDATE, params);
}

export async function getSweepHistory(config: ServiceApiConfig, params: { limit?: number }): Promise<ApiResponse> {
  return request(config, API_SWEEP_HISTORY, params);
}

export async function getSweepCoverage(config: ServiceApiConfig, params: { template_id?: string }): Promise<ApiResponse> {
  return request(config, API_SWEEP_COVERAGE, params);
}

export async function getLeaderboard(config: ServiceApiConfig, params: { limit?: number; sort_by?: string; min_score?: number }): Promise<ApiResponse> {
  return request(config, API_LEADERBOARD, params);
}

export async function getDefinitionRollup(config: ServiceApiConfig, params: { signal_id: number }): Promise<ApiResponse> {
  return request(config, API_DEFINITION_ROLLUP, params);
}

export async function saveCustomFactor(config: ServiceApiConfig, params: { factor_id: string; formula: string }): Promise<ApiResponse> {
  return request(config, API_CUSTOM_FACTOR_SAVE, params);
}

export async function deleteCustomFactor(config: ServiceApiConfig, params: { factor_id: string; confirm: boolean }): Promise<ApiResponse> {
  return request(config, API_CUSTOM_FACTOR_DELETE, params);
}

export async function getSignalSource(config: ServiceApiConfig, params: { signal_id: number }): Promise<ApiResponse> {
  return request(config, API_SIGNAL_SOURCE_GET, params);
}

export async function deleteSignalSource(config: ServiceApiConfig, params: { signal_id: number; confirm: boolean }): Promise<ApiResponse> {
  return request(config, API_SIGNAL_SOURCE_DELETE, params);
}

export async function confirmSignalSource(config: ServiceApiConfig, params: { signal_id: number }): Promise<ApiResponse> {
  return request(config, API_SIGNAL_SOURCE_CONFIRM, params);
}

export async function recomputeFamilyBH(config: ServiceApiConfig, params: { family_id: string }): Promise<ApiResponse> {
  return request(config, API_REMEDIATION_FAMILY_BH, params);
}

export async function registerPromotion(config: ServiceApiConfig, params: { signal_id: number }): Promise<ApiResponse> {
  return request(config, API_PROMOTION_REGISTER, params);
}

export async function getPromotionStatus(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_PROMOTION_STATUS);
}

export async function getRosterState(config: ServiceApiConfig, params: { signal_id?: number }): Promise<ApiResponse> {
  return request(config, API_ROSTER_GET_STATE, params);
}

export async function listRoster(config: ServiceApiConfig, params: { status?: string; limit?: number }): Promise<ApiResponse> {
  return request(config, API_ROSTER_LIST, params);
}

export async function applyRosterTransition(config: ServiceApiConfig, params: { signal_id: number; transition: string; reason?: string }): Promise<ApiResponse> {
  return request(config, API_ROSTER_APPLY_TRANSITION, params);
}

export async function removeFromRoster(config: ServiceApiConfig, params: { signal_id: number; confirm: boolean }): Promise<ApiResponse> {
  return request(config, API_ROSTER_REMOVE, params);
}

export async function getRelegationConfig(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_RELEGATION_GET_CONFIG);
}

export async function setRelegationConfig(config: ServiceApiConfig, params: { enabled?: boolean; percentage?: number; cadence_bars?: number; window_bars?: number; min_library_size?: number }): Promise<ApiResponse> {
  return request(config, API_RELEGATION_SET_CONFIG, params);
}

export async function runRelegationCycle(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_RELEGATION_RUN_CYCLE);
}

export async function getLstmManifest(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_LSTM_GET_MANIFEST);
}

export async function setLstmActiveVersion(config: ServiceApiConfig, params: { version_id: string }): Promise<ApiResponse> {
  return request(config, API_LSTM_SET_ACTIVE_VERSION, params);
}

export async function deleteLstmVersion(config: ServiceApiConfig, params: { version_id: string; confirm: boolean }): Promise<ApiResponse> {
  return request(config, API_LSTM_DELETE_VERSION, params);
}

export async function listLstmSnapshots(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_LSTM_LIST_SNAPSHOTS);
}

export async function saveLstmSnapshot(config: ServiceApiConfig, params: { name: string; description?: string }): Promise<ApiResponse> {
  return request(config, API_LSTM_SAVE_SNAPSHOT, params);
}

export async function restoreLstmSnapshot(config: ServiceApiConfig, params: { snapshot_id: string; confirm: boolean }): Promise<ApiResponse> {
  return request(config, API_LSTM_RESTORE_SNAPSHOT, params);
}

export async function deleteLstmSnapshot(config: ServiceApiConfig, params: { snapshot_id: string; confirm: boolean }): Promise<ApiResponse> {
  return request(config, API_LSTM_DELETE_SNAPSHOT, params);
}

export async function startLstmTraining(config: ServiceApiConfig, params: Record<string, unknown>): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TRAINING_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_LSTM_TRAINING_START}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

export async function getLstmTrainingStatus(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_LSTM_TRAINING_STATUS);
}

export async function cancelLstmTraining(config: ServiceApiConfig, params: { run_id: string }): Promise<ApiResponse> {
  return request(config, API_LSTM_TRAINING_CANCEL, params);
}

export async function getLstmTrainingHistory(config: ServiceApiConfig, params: { limit?: number }): Promise<ApiResponse> {
  return request(config, API_LSTM_TRAINING_HISTORY, params);
}

export async function getLstmFitQualityReport(config: ServiceApiConfig, params: { limit?: number; include_incompatible?: boolean; include_process_state?: boolean }): Promise<ApiResponse> {
  return request(config, API_LSTM_FIT_QUALITY_REPORT, params);
}

export async function saveAlphaFactoryConfig(config: ServiceApiConfig, params: Record<string, unknown>): Promise<ApiResponse> {
  return request(config, API_ALPHA_FACTORY_SAVE_CONFIG, params);
}

export async function loadAlphaFactoryConfig(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_ALPHA_FACTORY_LOAD_CONFIG);
}

export async function cancelAlphaFactory(config: ServiceApiConfig, params: { task_id?: string }): Promise<ApiResponse> {
  return request(config, API_ALPHA_FACTORY_CANCEL, params);
}

export async function cancelUniverseRun(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_ALPHA_FACTORY_CANCEL_UNIVERSE);
}

export async function getProviderWindow(config: ServiceApiConfig, params: { providers: string[]; symbols: string[]; interval?: string }): Promise<ApiResponse> {
  return request(config, API_ALPHA_FACTORY_PROVIDER_WINDOW, params);
}

export async function getAlphaFactoryLastResult(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_ALPHA_FACTORY_LAST_RESULT);
}

export async function getChipAllowedRegimes(config: ServiceApiConfig, params: { signal_id: number }): Promise<ApiResponse> {
  return request(config, API_CHIP_ALLOWED_REGIMES_GET, params);
}

export async function setChipAllowedRegimes(config: ServiceApiConfig, params: { signal_id: number; regimes: string[] }): Promise<ApiResponse> {
  return request(config, API_CHIP_ALLOWED_REGIMES_SET, params);
}

export async function startFactorMining(config: ServiceApiConfig, params: Record<string, unknown>): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TRAINING_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${API_FACTOR_MINING_START}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as ApiResponse;
  } catch (error) {
    return failureResponse(error, config);
  } finally {
    clearTimeout(timer);
  }
}

export async function reviewFactorMining(config: ServiceApiConfig, params: Record<string, unknown>): Promise<ApiResponse> {
  return request(config, API_FACTOR_MINING_REVIEW, params);
}

export async function editFactorMiningReview(config: ServiceApiConfig, params: Record<string, unknown>): Promise<ApiResponse> {
  return request(config, API_FACTOR_MINING_EDIT, params);
}

export async function confirmFactorMining(config: ServiceApiConfig, params: Record<string, unknown>): Promise<ApiResponse> {
  return request(config, API_FACTOR_MINING_CONFIRM, params);
}

export async function getFactorMiningStatus(config: ServiceApiConfig, params: { task_id: string }): Promise<ApiResponse> {
  return request(config, API_FACTOR_MINING_STATUS, params);
}

export async function listFactorSessions(config: ServiceApiConfig, params: { status?: string; resumable_only?: boolean }): Promise<ApiResponse> {
  return request(config, API_FACTOR_MINING_SESSIONS, params);
}

export async function listFactorCatalogs(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_FACTOR_CATALOG_LIST);
}

// TICKET_1335 D2: no `confirm` parameter on the deactivate client. D6 rejects a
// caller-supplied boolean as approval; authority is the internal
// LocalMutationApproval established by the mutation controller.
export async function activateFactorCatalog(config: ServiceApiConfig, params: { engine_id: string }): Promise<ApiResponse> {
  return request(config, API_FACTOR_CATALOG_ACTIVATE, params);
}

/**
 * TICKET_1335 AC12b: deactivation carries the human-origin attestation.
 *
 * The attestation is transported; the approval is not. The Electron host reads
 * the catalog revision itself and builds the internal approval from this
 * evidence, so a replayed attestation still cannot delete factors against a
 * catalog state the human never saw.
 */
export async function deactivateFactorCatalog(
  config: ServiceApiConfig,
  params: { engine_id: string; attestation: FactorCatalogDeactivationAttestation },
): Promise<ApiResponse> {
  return request(config, API_FACTOR_CATALOG_DEACTIVATE, params);
}

export async function generateFactorFormula(config: ServiceApiConfig, params: { prompt: string; dsl?: string; count?: number; llm_provider?: string; llm_model?: string }): Promise<ApiResponse> {
  return request(config, API_FACTOR_FORMULA_GENERATE, params);
}

export async function persistFactorFormula(config: ServiceApiConfig, params: Record<string, unknown>): Promise<ApiResponse> {
  return request(config, API_FACTOR_FORMULA_PERSIST, params);
}

export async function reloadSystemConfig(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_CONFIG_RELOAD);
}

export async function getSystemConfigHealth(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_CONFIG_HEALTH);
}

export async function getMachineInfo(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_MACHINE_INFO);
}

export async function backupDatabase(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_DATABASE_BACKUP);
}

export async function listDatabaseBackups(config: ServiceApiConfig): Promise<ApiResponse> {
  return request(config, API_DATABASE_BACKUP_LIST);
}

export async function restoreDatabase(
  config: ServiceApiConfig,
  params: { backup_id: string; confirm: boolean },
): Promise<ApiResponse> {
  return request(config, API_DATABASE_RESTORE, params);
}
