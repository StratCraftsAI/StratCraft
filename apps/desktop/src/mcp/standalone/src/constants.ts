/**
 * MCP Server Constants
 *
 * TICKET_476: Magic Number Elimination
 *
 * Timeout and configuration constants for MCP server operations.
 */

/**
 * MCP Streamable HTTP default port.
 *
 * Canonical source: apps/desktop/src/shared/constants/network.ts
 * Duplicated here because MCP standalone has its own tsconfig with rootDir
 * scoped to this package and cannot import from shared/constants.
 */
export const MCP_STREAMABLE_HTTP_PORT = 7789;

/**
 * TICKET_1265_6 D6: Web Dashboard (Vite) dev-server port. The MCP HTTP server
 * accepts browser requests only from this origin on loopback hosts; every
 * other Origin is refused at the CORS layer rather than by a per-tool gate.
 * Canonical source: apps/web-dashboard/start-dev.sh (VITE_PORT=7790).
 */
export const WEB_DASHBOARD_PORT = 7790;

/**
 * TICKET_1265_6 D6: default bind address. Loopback-only by default -- the
 * webui (:7790) and the desktop app are same-host, so nothing legitimate
 * breaks. LAN exposure is an explicit opt-in (`--host <addr>` /
 * MCP_HTTP_HOST), and when enabled it requires a locally-issued pairing token
 * (X-Pairing-Token), NOT a stratcraft.ai identity.
 */
export const MCP_HTTP_DEFAULT_HOST = '127.0.0.1';

/** TICKET_1355_2B: host-owned durable research job observation cadence. */
export const RESEARCH_ENV_JOB_OBSERVATION_INTERVAL_MS = 2_000;

export const ARTIFACT_CANDIDATE_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const ARTIFACT_CANDIDATE_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const ARTIFACT_SECRET_SCAN_MAX_BYTES = ARTIFACT_CANDIDATE_MAX_FILE_BYTES;

// TICKET_1023_4: Domain URL constants re-exported from Tier 0 canonical source.
// @StratCraft/types resolves via Node module resolution (apps/desktop/node_modules/).
export { DESKTOP_API_BASE_URL, AUTH_SERVER_BASE_URL } from '@StratCraft/types';

// =============================================================================
// TICKET_1030_7: API route path constants
//
// Canonical source: packages/types/src/api-routes.ts
// TODO: Replace these duplicates with re-exports from @StratCraft/types
// (same pattern as DESKTOP_API_BASE_URL / AUTH_SERVER_BASE_URL above).
// =============================================================================

// Backtest
export const API_BACKTEST_LIST = '/api/v1/backtest/list' as const;
export const API_BACKTEST_RESULT = '/api/v1/backtest/result' as const;
export const API_BACKTEST_RUN = '/api/v1/backtest/run' as const;
export const API_BACKTEST_STATUS = '/api/v1/backtest/status' as const;
export const API_BACKTEST_CANCEL = '/api/v1/backtest/cancel' as const;
export const API_BACKTEST_QUEUE = '/api/v1/backtest/queue' as const;
export const API_BACKTEST_CANCEL_ALL = '/api/v1/backtest/cancel-all' as const;
export const API_BACKTEST_PHASE = '/api/v1/backtest/phase' as const;
export const API_BACKTEST_RESUME = '/api/v1/backtest/resume' as const;
export const API_BACKTEST_CANDLES = '/api/v1/backtest/candles' as const;

// Strategy
export const API_STRATEGY_LIST = '/api/v1/strategy/list' as const;
export const API_STRATEGY_GET = '/api/v1/strategy/get' as const;
export const API_STRATEGY_GENERATE = '/api/v1/strategy/generate' as const;
// TICKET_1306_4 (D6): persist an already-generated result via the Electron
// TICKET_761 pipeline (the MCP process cannot run compile/audit in-process).
export const API_STRATEGY_PERSIST = '/api/v1/strategy/persist' as const;
export const API_STRATEGY_GENERATE_ENTRY = '/api/v1/strategy/generate-entry' as const;
export const API_STRATEGY_GENERATE_EXIT = '/api/v1/strategy/generate-exit' as const;
export const API_STRATEGY_GENERATE_KRONOS = '/api/v1/strategy/generate-kronos' as const;
export const API_STRATEGY_GENERATE_AI_LIBERO = '/api/v1/strategy/generate-ai-libero' as const;
export const API_STRATEGY_GENERATE_AI_STUDIO = '/api/v1/strategy/generate-ai-studio' as const;
export const API_AI_STUDIO_SESSION_START = '/api/v1/ai-studio/session/start' as const;
export const API_AI_STUDIO_SESSION_CONTINUE = '/api/v1/ai-studio/session/continue' as const;
export const API_AI_STUDIO_SESSION_ACTION = '/api/v1/ai-studio/session/action' as const;
export const API_STRATEGY_DELETE = '/api/v1/strategy/delete' as const;

// Factor / Signal-Source / Persona
export const API_FACTOR_LIST = '/api/v1/factor/list' as const;
export const API_SIGNAL_SOURCE_LIST = '/api/v1/signal-source/list' as const;
export const API_PERSONA_LIST = '/api/v1/persona/list' as const;

// Signal Discovery
export const API_SIGNAL_DISCOVERY_TEMPLATES = '/api/v1/signal-discovery/templates' as const;
export const API_SIGNAL_DISCOVERY_DEFINITIONS = '/api/v1/signal-discovery/definitions' as const;
export const API_SIGNAL_DISCOVERY_SCOREBOARD = '/api/v1/signal-discovery/scoreboard' as const;
export const API_SIGNAL_DISCOVERY_QUALITY_METRICS = '/api/v1/signal-discovery/quality-metrics' as const;
export const API_SIGNAL_DISCOVERY_RUNS = '/api/v1/signal-discovery/runs' as const;
export const API_SIGNAL_DISCOVERY_START_SWEEP = '/api/v1/signal-discovery/start-sweep' as const;
export const API_SIGNAL_DISCOVERY_STOP_SWEEP = '/api/v1/signal-discovery/stop-sweep' as const;
export const API_SIGNAL_DISCOVERY_SWEEP_STATUS = '/api/v1/signal-discovery/sweep-status' as const;

// TICKET_1235_3: Strategy Builder compile/validate/persist/workspace
export const API_STRATEGY_COMPILE = '/api/v1/strategy/compile' as const;
export const API_STRATEGY_COMPILATION_STATUS = '/api/v1/strategy/compilation-status' as const;
export const API_STRATEGY_VALIDATION_REPORT = '/api/v1/strategy/validation-report' as const;
export const API_STRATEGY_TOOLCHAIN_STATUS = '/api/v1/strategy/toolchain-status' as const;
export const API_STRATEGY_SAVE = '/api/v1/strategy/save' as const;
export const API_STRATEGY_LOAD = '/api/v1/strategy/load' as const;
// TICKET_1235_3_1: Workflow strategy generation
export const API_STRATEGY_GENERATE_WORKFLOW = '/api/v1/strategy/generate-workflow' as const;
export const API_BATCH_GENERATION_STATE = '/api/v1/strategy/batch-generation/state' as const;
export const STRATEGY_RECYCLE_BIN_DEFAULT_LIMIT = 50;
export const STRATEGY_RECYCLE_BIN_MAX_LIMIT = 500;
export const STRATEGY_AUDIT_DEFAULT_LIMIT = 100;
export const STRATEGY_AUDIT_MAX_LIMIT = 500;
export const API_WORKSPACE_SYNC_STATUS = '/api/v1/workspace/sync-status' as const;
export const API_WORKSPACE_SYNC_EXPORT = '/api/v1/workspace/export' as const;
export const API_WORKSPACE_SYNC_IMPORT = '/api/v1/workspace/import' as const;

// TICKET_1281: System Monitor (web-dashboard sidebar panel)
export const API_SYSTEM_MONITOR = '/api/v1/system/monitor' as const;
export const API_WORKLOAD_QUEUE_GET = '/api/v1/system/workload-queue' as const;
export const API_WORKLOAD_QUEUE_ENQUEUE = '/api/v1/system/workload-queue/enqueue' as const;
export const API_WORKLOAD_QUEUE_DEQUEUE = '/api/v1/system/workload-queue/dequeue' as const;

// TICKET_1335: research environment. Re-exported rather than copied, which is
// the resolution this block's own TODO asks for and which the
// DESKTOP_API_BASE_URL re-export above already proves works from this module.
// A sixth through tenth hand-copied literal would add five more strings that can
// silently disagree with `packages/types/src/api-routes.ts`; a re-export cannot.
export {
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
} from '@StratCraft/types';

// TICKET_1235_5: Alpha Factory / Quant Lab
export const API_ALPHA_FACTORY_RUN = '/api/v1/alpha-factory/run' as const;
export const API_ALPHA_FACTORY_PROGRESS = '/api/v1/alpha-factory/progress' as const;
export const API_QUANT_LAB_REFRESH_SCOREBOARD = '/api/v1/quant-lab/refresh-scoreboard' as const;
export const API_QUANT_LAB_REROLLUP_VERDICT = '/api/v1/quant-lab/rerollup-verdict' as const;
export const API_QUANT_LAB_REFIT_ARTIFACT = '/api/v1/quant-lab/refit-artifact' as const;

// TICKET_1235_7: Plugin Lifecycle & Entitlement
export const API_PLUGIN_LIST = '/api/v1/plugin/list' as const;
export const API_PLUGIN_GET = '/api/v1/plugin/get' as const;
export const API_PLUGIN_GET_CONFIG = '/api/v1/plugin/get-config' as const;
export const API_PLUGIN_SET_CONFIG = '/api/v1/plugin/set-config' as const;
export const API_PLUGIN_ACTIVATE = '/api/v1/plugin/activate' as const;
export const API_PLUGIN_DEACTIVATE = '/api/v1/plugin/deactivate' as const;
export const API_PLUGIN_INSTALL = '/api/v1/plugin/install' as const;
export const API_PLUGIN_UNINSTALL = '/api/v1/plugin/uninstall' as const;
export const API_ENTITLEMENT_LIST = '/api/v1/entitlement/list' as const;
export const API_ENTITLEMENT_GET_PLUGIN = '/api/v1/entitlement/get-plugin' as const;
export const API_ENTITLEMENT_TOGGLE_SERVICE = '/api/v1/entitlement/toggle-service' as const;
export const API_MARKETPLACE_GET_REGISTRY = '/api/v1/marketplace/get-registry' as const;
export const API_MARKETPLACE_GET_PLUGIN_DETAILS = '/api/v1/marketplace/get-plugin-details' as const;
export const API_MARKETPLACE_CHECK_UPDATES = '/api/v1/marketplace/check-updates' as const;
export const API_MARKETPLACE_ACTIVATE_LICENSE = '/api/v1/marketplace/activate-license' as const;
export const API_MARKETPLACE_GET_LICENSE_STATUS = '/api/v1/marketplace/get-license-status' as const;
export const API_MARKETPLACE_REMOVE_LICENSE = '/api/v1/marketplace/remove-license' as const;
export const API_MARKETPLACE_CHECK_ENTITLEMENT = '/api/v1/marketplace/check-entitlement' as const;
export const API_MARKETPLACE_CHECK_ENTITLEMENTS_BATCH = '/api/v1/marketplace/check-entitlements-batch' as const;
export const API_ENTITLEMENT_GET_AUDIT_LOG = '/api/v1/entitlement/get-audit-log' as const;

// TICKET_1368 Phase 5: Sigma marketplace admitted routes
export const API_SIGMA_ELIGIBILITY = '/api/v1/marketplace/sigma/eligibility' as const;
export const API_SIGMA_INSTALL = '/api/v1/marketplace/sigma/install' as const;
export const API_SIGMA_INSTALL_STATUS = '/api/v1/marketplace/sigma/install-status' as const;

// TICKET_1235_8: Settings & Conversations
export const API_SETTINGS_GET = '/api/v1/settings/get' as const;
export const API_SETTINGS_SET_LOCALE = '/api/v1/settings/set-locale' as const;
export const API_SETTINGS_SET_MARKET_ROUTING = '/api/v1/settings/set-market-routing' as const;
export const API_SETTINGS_SET_PROVIDER_DEFAULTS = '/api/v1/settings/set-provider-defaults' as const;
export const API_SETTINGS_LIST_LLM_PROVIDERS = '/api/v1/settings/list-llm-providers' as const;
export const API_SETTINGS_SET_LLM_SELECTION = '/api/v1/settings/set-llm-selection' as const;
export const API_SETTINGS_SET_LLM_CREDENTIAL = '/api/v1/settings/set-llm-credential' as const;
export const API_SETTINGS_CHECK_LLM_CREDENTIAL = '/api/v1/settings/check-llm-credential' as const;
// TICKET_1265_6 D2: desktop LLM-access decision + server bearer for tool gates.
export const API_SETTINGS_GET_LLM_ACCESS = '/api/v1/settings/get-llm-access' as const;
export const API_CONVERSATION_LIST = '/api/v1/conversation/list' as const;
export const API_CONVERSATION_GET = '/api/v1/conversation/get' as const;
export const API_CONVERSATION_DELETE = '/api/v1/conversation/delete' as const;
export const CONVERSATION_LIST_DEFAULT_LIMIT = 50;
export const CONVERSATION_LIST_MAX_LIMIT = 200;
export const CONVERSATION_SEARCH_DEFAULT_LIMIT = 20;
export const CONVERSATION_SEARCH_MAX_LIMIT = 100;
export const STARTUP_AUDIT_LIST_DEFAULT_LIMIT = 20;
export const STARTUP_AUDIT_LIST_MAX_LIMIT = 200;

// TICKET_1237_1: Agent core -- conversation writes
export const API_CONVERSATION_CREATE = '/api/v1/conversation/create' as const;
export const API_CONVERSATION_ADD_MESSAGE = '/api/v1/conversation/add-message' as const;

// TICKET_1235_2: Data Management
export const API_DATA_LIST_PROVIDERS = '/api/v1/data/list-providers' as const;
export const API_DATA_SEARCH_SYMBOLS = '/api/v1/data/search-symbols' as const;
export const API_DATA_GET_SYMBOL_DATE_RANGE = '/api/v1/data/get-symbol-date-range' as const;
export const API_DATA_CHECK_COVERAGE = '/api/v1/data/check-coverage' as const;
export const API_DATA_LIST_SEGMENTS = '/api/v1/data/list-segments' as const;
export const API_DATA_GET_CACHE_STATS = '/api/v1/data/get-cache-stats' as const;
export const API_DATA_LIST_IMPORTED_PACKAGES = '/api/v1/data/list-imported-packages' as const;
export const API_DATA_CHECK_IMPORTED_PACKAGE_INTEGRITY = '/api/v1/data/check-imported-package-integrity' as const;
export const API_DATA_AUDIT_IMPORTED_PACKAGE_ORPHANS = '/api/v1/data/audit-imported-package-orphans' as const;
export const API_DATA_BUILD_COVERAGE_REPORT = '/api/v1/data/build-coverage-report' as const;
export const API_DATA_APPEND_TO_PACKAGE = '/api/v1/data/append-to-package' as const;
export const API_DATA_REVIEW_DOWNLOAD = '/api/v1/data/review-download' as const;
export const API_DATA_CONFIRM_DOWNLOAD = '/api/v1/data/confirm-download' as const;
export const API_DATA_QUEUE_DOWNLOAD = '/api/v1/data/queue-download' as const;
export const API_DATA_GET_DOWNLOAD_STATUS = '/api/v1/data/get-download-status' as const;
export const API_DATA_RETRY_FAILED = '/api/v1/data/retry-failed' as const;
export const API_DATA_CANCEL_DOWNLOAD = '/api/v1/data/cancel-download' as const;
export const API_DATA_GET_QUEUE_STATUS = '/api/v1/data/get-queue-status' as const;
export const API_DATA_DELETE_SEGMENTS = '/api/v1/data/delete-segments' as const;
export const API_DATA_IMPORT_PACKAGE = '/api/v1/data/import-package' as const;
export const API_DATA_REGISTER_PARQUET_DIR = '/api/v1/data/register-parquet-directory' as const;
export const API_DATA_REMOVE_PACKAGE = '/api/v1/data/remove-package' as const;
export const API_DATA_CLEAR_CACHE = '/api/v1/data/clear-cache' as const;

// TICKET_1235_10: Signal Generator Plugin
export const API_SIGNAL_GENERATOR_START = '/api/v1/signal-generator/start' as const;
export const API_SIGNAL_GENERATOR_STOP = '/api/v1/signal-generator/stop' as const;
export const API_SIGNAL_GENERATOR_STATUS = '/api/v1/signal-generator/status' as const;
export const API_SIGNAL_GENERATOR_HISTORY = '/api/v1/signal-generator/history' as const;
export const API_SIGNAL_GENERATOR_IMPORT_FACTORS = '/api/v1/signal-generator/import-factors' as const;
export const API_SIGNAL_GENERATOR_RUN_FACTOR_SWEEP = '/api/v1/signal-generator/run-factor-sweep' as const;

// TICKET_1235_5_2: Quant Lab remaining surface
export const API_SWEEP_QUEUE_GET = '/api/v1/quant-lab/sweep-queue' as const;
export const API_SWEEP_QUEUE_ENQUEUE = '/api/v1/quant-lab/sweep-queue-enqueue' as const;
export const API_SWEEP_QUEUE_CANCEL = '/api/v1/quant-lab/sweep-queue-cancel' as const;
export const API_SWEEP_QUEUE_CLEAR = '/api/v1/quant-lab/sweep-queue-clear' as const;
export const API_SIGNAL_RUN_DELETE = '/api/v1/quant-lab/signal-run-delete' as const;
export const API_SIGNAL_RUN_UPDATE = '/api/v1/quant-lab/signal-run-update' as const;
export const API_SWEEP_HISTORY = '/api/v1/quant-lab/sweep-history' as const;
export const API_SWEEP_COVERAGE = '/api/v1/quant-lab/sweep-coverage' as const;
export const API_LEADERBOARD = '/api/v1/quant-lab/leaderboard' as const;
export const API_DEFINITION_ROLLUP = '/api/v1/quant-lab/definition-rollup' as const;
export const API_CUSTOM_FACTOR_SAVE = '/api/v1/quant-lab/custom-factor-save' as const;
export const API_CUSTOM_FACTOR_DELETE = '/api/v1/quant-lab/custom-factor-delete' as const;
export const API_SIGNAL_SOURCE_GET = '/api/v1/quant-lab/signal-source-get' as const;
export const API_SIGNAL_SOURCE_DELETE = '/api/v1/quant-lab/signal-source-delete' as const;
export const API_SIGNAL_SOURCE_CONFIRM = '/api/v1/quant-lab/signal-source-confirm' as const;
export const API_REMEDIATION_FAMILY_BH = '/api/v1/quant-lab/recompute-family-bh' as const;
export const API_PROMOTION_REGISTER = '/api/v1/quant-lab/promotion-register' as const;
export const API_PROMOTION_STATUS = '/api/v1/quant-lab/promotion-status' as const;
export const API_ROSTER_GET_STATE = '/api/v1/quant-lab/roster-state' as const;
export const API_ROSTER_LIST = '/api/v1/quant-lab/roster-list' as const;
export const API_ROSTER_APPLY_TRANSITION = '/api/v1/quant-lab/roster-transition' as const;
export const API_ROSTER_REMOVE = '/api/v1/quant-lab/roster-remove' as const;
export const API_RELEGATION_GET_CONFIG = '/api/v1/quant-lab/relegation-config' as const;
export const API_RELEGATION_SET_CONFIG = '/api/v1/quant-lab/relegation-set-config' as const;
export const API_RELEGATION_RUN_CYCLE = '/api/v1/quant-lab/relegation-run-cycle' as const;
export const API_LSTM_GET_MANIFEST = '/api/v1/quant-lab/lstm-manifest' as const;
export const API_LSTM_SET_ACTIVE_VERSION = '/api/v1/quant-lab/lstm-set-active' as const;
export const API_LSTM_DELETE_VERSION = '/api/v1/quant-lab/lstm-delete-version' as const;
export const API_LSTM_LIST_SNAPSHOTS = '/api/v1/quant-lab/lstm-snapshots' as const;
export const API_LSTM_SAVE_SNAPSHOT = '/api/v1/quant-lab/lstm-save-snapshot' as const;
export const API_LSTM_RESTORE_SNAPSHOT = '/api/v1/quant-lab/lstm-restore-snapshot' as const;
export const API_LSTM_DELETE_SNAPSHOT = '/api/v1/quant-lab/lstm-delete-snapshot' as const;
export const API_LSTM_TRAINING_START = '/api/v1/quant-lab/lstm-training-start' as const;
export const API_LSTM_TRAINING_STATUS = '/api/v1/quant-lab/lstm-training-status' as const;
export const API_LSTM_TRAINING_CANCEL = '/api/v1/quant-lab/lstm-training-cancel' as const;
export const API_LSTM_TRAINING_HISTORY = '/api/v1/quant-lab/lstm-training-history' as const;
export const API_LSTM_FIT_QUALITY_REPORT = '/api/v1/quant-lab/lstm-fit-quality-report' as const;
export const API_ALPHA_FACTORY_SAVE_CONFIG = '/api/v1/alpha-factory/save-config' as const;
export const API_ALPHA_FACTORY_LOAD_CONFIG = '/api/v1/alpha-factory/load-config' as const;
export const API_ALPHA_FACTORY_CANCEL = '/api/v1/alpha-factory/cancel' as const;
export const API_ALPHA_FACTORY_CANCEL_UNIVERSE = '/api/v1/alpha-factory/cancel-universe' as const;
export const API_ALPHA_FACTORY_PROVIDER_WINDOW = '/api/v1/alpha-factory/provider-window' as const;
export const API_ALPHA_FACTORY_LAST_RESULT = '/api/v1/alpha-factory/last-result' as const;
export const API_CHIP_ALLOWED_REGIMES_GET = '/api/v1/alpha-factory/chip-regimes-get' as const;
export const API_CHIP_ALLOWED_REGIMES_SET = '/api/v1/alpha-factory/chip-regimes-set' as const;
export const API_FACTOR_MINING_START = '/api/v1/factor-mining/start' as const;
export const API_FACTOR_MINING_REVIEW = '/api/v1/factor-mining/review' as const;
export const API_FACTOR_MINING_EDIT = '/api/v1/factor-mining/edit' as const;
export const API_FACTOR_MINING_CONFIRM = '/api/v1/factor-mining/confirm' as const;
export const API_FACTOR_MINING_STATUS = '/api/v1/factor-mining/status' as const;
export const API_FACTOR_MINING_SESSIONS = '/api/v1/factor-mining/sessions' as const;
export {
  FACTOR_MINING_CORRELATION_HEADER,
  FACTOR_MINING_TOOL_HEADER,
  RUNTIME_COMPOSITION_HEADER,
} from '@StratCraft/types';
export const API_FACTOR_CATALOG_LIST = '/api/v1/factor-catalog/list' as const;
// TICKET_1335 D2: catalog activation replaces package install/uninstall.
export const API_FACTOR_CATALOG_ACTIVATE = '/api/v1/factor-catalog/activate' as const;
export const API_FACTOR_CATALOG_DEACTIVATE = '/api/v1/factor-catalog/deactivate' as const;
export const API_FACTOR_FORMULA_GENERATE = '/api/v1/factor-formula/generate' as const;
export const API_FACTOR_FORMULA_PERSIST = '/api/v1/factor-formula/persist' as const;

// TICKET_1235_9: Chart / Market Data
export const API_MARKET_GET_DATA = '/api/v1/market/get-data' as const;
export const API_MARKET_GET_SYMBOLS = '/api/v1/market/get-symbols' as const;
export const API_KRONOS_RUN_PREDICTION = '/api/v1/kronos/run-prediction' as const;
export const API_KRONOS_CANCEL_PREDICTION = '/api/v1/kronos/cancel-prediction' as const;
export const API_KRONOS_LIST_MODELS = '/api/v1/kronos/list-models' as const;

// Strategy Generation Legacy
export const API_START_MARKET_REGIME = '/api/start_market_regime_analysis' as const;
export const API_CHECK_MARKET_REGIME = '/api/check_market_regime_status' as const;
export const API_START_ENTRY_SIGNAL = '/api/start_regime_indicator_entry' as const;
export const API_CHECK_ENTRY_SIGNAL = '/api/check_regime_indicator_entry_status' as const;
export const API_START_EXIT_STRATEGY = '/api/start_exit_strategy' as const;
export const API_CHECK_EXIT_STRATEGY = '/api/check_exit_strategy_status' as const;

// Kronos
export const API_START_KRONOS = '/api/start_kronos_prediction' as const;
export const API_CHECK_KRONOS = '/api/check_kronos_status' as const;
export const API_KRONOS_HEALTH = '/api/kronos/health' as const;
export const API_KRONOS_PREDICT = '/api/kronos/predict' as const;
export const API_START_KRONOS_INDICATOR_ENTRY = '/api/start_kronos_indicator_entry' as const;
export const API_CHECK_KRONOS_INDICATOR_ENTRY = '/api/check_kronos_indicator_entry_status' as const;
export const API_KRONOS_LLM_ENTRY = '/api/kronos_llm_entry' as const;
export const API_CHECK_KRONOS_LLM_ENTRY = '/api/check_kronos_llm_entry_status' as const;

// AI / LLM Generation
export const API_START_LLM_LIBERO = '/api/start_llm_libero_analysis' as const;
export const API_CHECK_LLM_LIBERO = '/api/check_llm_libero_status' as const;
export const API_VIBING_CHAT = '/api/vibing_chat' as const;
export const API_CHECK_VIBING_CHAT = '/api/check_vibing_chat_status' as const;
export const API_LLM_TRADER = '/api/llm_trader' as const;
export const API_CHECK_LLM_TRADER = '/api/check_llm_trader_status' as const;

// Watchlist / Catalog
export const API_START_WATCHLIST = '/api/start_watchlist_operation' as const;
export const API_CHECK_WATCHLIST = '/api/check_watchlist_operation_status' as const;
export const API_GENERATE_CATALOG_STRATEGY = '/api/generate_catalog_strategy' as const;
export const API_CHECK_CATALOG_STRATEGY = '/api/check_catalog_strategy_status' as const;

// Persona (legacy, non-versioned)
export const API_PERSONA_LIST_LEGACY = '/api/persona/list' as const;

// Auth Proxy
export const API_AUTH_SEND_CODE = '/api/auth/send-code' as const;
export const API_AUTH_VERIFY_CODE = '/api/auth/verify-code' as const;
export const API_AUTH_LOGIN_PASSWORD = '/api/auth/login-password' as const;
// TICKET_1232 F2: same-origin proxy path for token refresh (web dashboard)
export const API_AUTH_REFRESH = '/api/auth/refresh' as const;
export const API_AUTH_SESSION = '/api/auth/session' as const;
export const API_AUTH_LOGOUT = '/api/auth/logout' as const;
export const BROWSER_AUTH_COOKIE_NAME = 'stratcraft_session' as const;
export const BROWSER_AUTH_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// TICKET_165: upstream refresh endpoint on the desktop-api Python tunnel --
// unlike the other auth endpoints it does NOT live on the WordPress auth server
export const API_V1_AUTH_REFRESH = '/api/v1/auth/refresh' as const;

/** HTTP 401 -- the presented bearer token was rejected (expired/revoked) */
export const HTTP_STATUS_UNAUTHORIZED = 401;

// Anonymous install token (TICKET_1229)
export const API_ANONYMOUS_REGISTER = '/api/anonymous/register' as const;

// nona_server health signature (TICKET_1229)
export const API_NONA_HEALTH = '/health' as const;
/** Expected `service` field in nona_server /health response */
export const NONA_SERVER_HEALTH_SERVICE = 'main_service' as const;
/** Startup nona_server health-check timeout (ms) */
export const NONA_HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Default info panel / iframe embed height (px) */
export const DEFAULT_INFO_PANEL_HEIGHT_PX = 600;

/** Standard API request timeout (ms) */
export const MCP_REQUEST_TIMEOUT_MS = 30000;

/** Extended timeout for LLM strategy generation (ms) — aligned with GenerationService */
export const MCP_GENERATION_TIMEOUT_MS = 180_000;
export const MCP_GENERATION_POLL_INTERVAL_MS = 500;

/** Extended timeout for backtest execution (ms) - TICKET_490 */
export const MCP_BACKTEST_TIMEOUT_MS = 300000;

/** Extended timeout for signal-discovery training handshake (ms) - TICKET_992_3 */
export const MCP_TRAINING_TIMEOUT_MS = 600000;

/** Extended timeout for Kronos prediction (ms) - TICKET_1235_9 */
export const MCP_KRONOS_TIMEOUT_MS = 120000;

/**
 * TICKET_1237_1 D8: engine-independent hard cap on tool calls per agent
 * turn. Guards any engine implementation against runaway loops; Engine A
 * adds its own iteration/token caps (TICKET_1237_2).
 */
export const AGENT_MAX_TOOL_CALLS_PER_TURN = 50;

/** TICKET_1237_1: max characters of the first user message used as a new conversation title. */
export const AGENT_CONVERSATION_TITLE_MAX_CHARS = 60;

/**
 * TICKET_1270 D2: max bytes of a single tool result fed back into the LLM
 * context. The FULL result still reaches the UI trace event; only the
 * LLM-context copy is bounded. When a result exceeds this cap it is
 * replaced with a head+tail excerpt plus an explicit `[truncated N bytes]`
 * marker so the model knows to re-query with narrower args (limit/filters).
 * This is a context-budget contract, not hidden data loss.
 */
export const AGENT_TOOL_RESULT_CONTEXT_MAX_BYTES = 8192;

/** Browser-facing normalized Agent event bounds (TICKET_1303_1_3). */
export const AGENT_EVENT_TEXT_MAX_CHARS = 32_768;
export const AGENT_EVENT_COMMAND_MAX_CHARS = 4_096;
export const AGENT_EVENT_DIFF_MAX_CHARS = 65_536;
export const AGENT_EVENT_COLLECTION_MAX_ITEMS = 100;
export const AGENT_EVENT_OBJECT_MAX_DEPTH = 6;
/** Bounded, redacted evidence attached to a canonical Agent outcome. */
export const AGENT_TOOL_OUTCOME_DIAGNOSTIC_MAX_CHARS = 512;
export const AGENT_TOOL_OUTCOME_DIAGNOSTIC_MAX_DEPTH = 4;
export const AGENT_TOOL_OUTCOME_DIAGNOSTIC_MAX_ITEMS = 20;
/** Prevent producer-controlled interpolation maps from becoming a data channel. */
export const AGENT_TOOL_OUTCOME_PARAMETER_MAX_ITEMS = 12;
export const AGENT_TOOL_OUTCOME_PARAMETER_MAX_CHARS = 256;
export const AGENT_PERMISSION_TTL_MS = 300_000;

/**
 * Bound the transport-level idempotency ledger for agent turn admission.
 * A browser retries `send_agent_message` with the same client request ID when
 * the HTTP response is lost after the server has already admitted the turn.
 */
export const AGENT_START_IDEMPOTENCY_MAX_ENTRIES = 512;

/** TICKET_1303_1_10 local human-origin authority ceremony bounds. */
export const AGENT_CONTROL_SESSION_TTL_MS = 30 * 60 * 1000;
export const AGENT_CONTROL_CEREMONY_TTL_MS = 2 * 60 * 1000;
export const AGENT_CONTROL_ACTIVATION_TTL_MS = 2 * 60 * 1000;
export const AGENT_CONTROL_CLAIM_LEASE_MS = 30 * 1000;
export const AGENT_CONTROL_ENROLLMENT_CODE_TTL_MS = 5 * 60 * 1000;
export const AGENT_CONTROL_CRYPTO_FAIL_WINDOW_MS = 60 * 1000;
export const AGENT_CONTROL_CRYPTO_FAIL_MAX = 5;

/**
 * TICKET_1303_1_10 AC15: upper bound on a single privileged recovery-IPC
 * request. The channel carries one small JSON command, so anything larger is a
 * malformed or hostile peer and is refused before parsing rather than buffered.
 */
export const RECOVERY_IPC_REQUEST_MAX_BYTES = 8 * 1024;

/**
 * TICKET_1303_1_10 AC15: bound on the synchronous liveness probe that
 * distinguishes a crashed server's stale socket from a live owner's. A local
 * unix-socket connect resolves in microseconds; this bound only stops a wedged
 * probe from blocking startup.
 */
export const RECOVERY_IPC_PROBE_TIMEOUT_MS = 2000;

/**
 * TICKET_1303_1_10_1 section 2.7: session-scoped decision trust policy bounds.
 *
 * The TTL governs both the operation trust grant and the human presence anchor
 * (section 2.5.2) -- deliberately one value, not two. The anchor is the weaker
 * boundary of the pair (it can be created by a `direct-only` assertion and then
 * authorize allowlisted operations), so giving it a longer window than a grant
 * would make the safer-looking path the more permissive one.
 *
 * Range is enforced by rejection, never clamping (section 2.6.2): a user who
 * asks for an 8-hour trust window has expressed an intent the policy refuses,
 * and silently storing 2 hours instead would misreport the security posture in
 * exactly the surface where they went to reason about it.
 */
export const TRUST_WINDOW_TTL_MS = 1_800_000;
export const TRUST_WINDOW_TTL_MIN_MS = 60_000;
export const TRUST_WINDOW_TTL_MAX_MS = 7_200_000;

/**
 * Sweep cadence for expired grants and anchors. Expiry is ALSO evaluated on
 * read (section 2.5.2), so this sweep bounds memory rather than correctness --
 * a call landing between two sweeps can never consume an expired record.
 */
export const TRUST_GRANT_CLEANUP_INTERVAL = 60_000;

/**
 * Lifetime of a policy-write WebAuthn challenge (section 2.6.1.1). Shorter than
 * the decision ceremony TTL: a policy write widens the auto-approval surface,
 * so the window in which a captured challenge is useful is kept minimal.
 */
export const POLICY_WRITE_CHALLENGE_TTL_MS = 60_000;

/**
 * TICKET_1278_1: bounded retry for the agent LLM fetch. Applies ONLY to
 * undici dispatch failures (TypeError 'fetch failed' -- the request never
 * reached the provider, so a retry is unconditionally safe); HTTP error
 * responses and mid-stream failures are never retried. Canonical trigger:
 * stale keep-alive socket reuse after a long tool-execution gap froze the
 * event loop (TICKET_1278 RC2).
 */
export const AGENT_LLM_FETCH_RETRIES = 2;

/** TICKET_1278_1: backoff before retry N is entry N-1; the last entry repeats. */
export const AGENT_LLM_FETCH_RETRY_BACKOFF_MS: readonly number[] = [250, 1000];

/**
 * TICKET_1358: pre-stream HTTP retry for transient LLM provider errors.
 * Applies ONLY before any completion stream content is consumed. HTTP 429,
 * 502, 503, 504 are retryable; all other statuses are permanent. This is a
 * separate budget from the dispatch-failure retry above (TICKET_1278_1);
 * both budgets are consumed from a shared attempt counter so the total
 * attempts never exceed the sum.
 */
export const LLM_PRESTREAM_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/** Maximum additional attempts after the first for pre-stream HTTP errors. */
export const LLM_PRESTREAM_MAX_RETRIES = 2;

/** Base delay in ms for exponential backoff (attempt 1 = base, attempt 2 = base*2, ...). */
export const LLM_PRESTREAM_BACKOFF_BASE_MS = 1_000;

/** Maximum delay for any single pre-stream retry wait. */
export const LLM_PRESTREAM_BACKOFF_CAP_MS = 10_000;

/** Maximum total wall-clock time (ms) the pre-stream retry loop may spend waiting. */
export const LLM_PRESTREAM_TOTAL_BUDGET_MS = 30_000;

/** Maximum Retry-After value (seconds) honored from the provider. */
export const LLM_PRESTREAM_RETRY_AFTER_CAP_S = 30;

/** Minimum Retry-After value (seconds) honored from the provider. */
export const LLM_PRESTREAM_RETRY_AFTER_FLOOR_S = 1;
