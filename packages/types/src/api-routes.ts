/**
 * API Route Path Constants (Tier 0)
 *
 * TICKET_1030_7: Centralized API route path definitions so all tiers
 * (apps, plugins, MCP standalone) can import without tier violations
 * or hardcoded string duplication.
 *
 * @see TICKET_179 - Unified Constants Management
 * @see TICKET_141 - API Routing Architecture
 */

// =============================================================================
// Backtest Routes
// =============================================================================

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

// =============================================================================
// Strategy Routes
// =============================================================================

export const API_STRATEGY_LIST = '/api/v1/strategy/list' as const;
export const API_STRATEGY_GET = '/api/v1/strategy/get' as const;
export const API_STRATEGY_GENERATE = '/api/v1/strategy/generate' as const;
// TICKET_1306_4 (D6): persist an already-generated regime-detector result
// through the Electron-owned TICKET_761 pipeline. Used by the MCP surface,
// which cannot run the compile/audit pipeline in-process.
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
export const API_STRATEGY_COMPILE = '/api/v1/strategy/compile' as const;
export const API_STRATEGY_COMPILATION_STATUS = '/api/v1/strategy/compilation-status' as const;
export const API_STRATEGY_VALIDATION_REPORT = '/api/v1/strategy/validation-report' as const;
export const API_STRATEGY_TOOLCHAIN_STATUS = '/api/v1/strategy/toolchain-status' as const;
export const API_STRATEGY_SAVE = '/api/v1/strategy/save' as const;
export const API_STRATEGY_LOAD = '/api/v1/strategy/load' as const;
export const API_STRATEGY_GENERATE_WORKFLOW = '/api/v1/strategy/generate-workflow' as const;
export const API_GENERATION_SESSION_START = '/api/v1/generation/session/start' as const;
export const API_GENERATION_SESSION_CANCEL = '/api/v1/generation/session/cancel' as const;
export const API_GENERATION_SESSION_STATE = '/api/v1/generation/session/state' as const;
export const API_STRATEGY_GENERATE_FROM_CATALOG = '/api/v1/strategy/generate-from-catalog' as const;
export const API_BATCH_GENERATION_START = '/api/v1/strategy/batch-generation/start' as const;
export const API_BATCH_GENERATION_CANCEL = '/api/v1/strategy/batch-generation/cancel' as const;
export const API_BATCH_GENERATION_STATE = '/api/v1/strategy/batch-generation/state' as const;
export const API_WORKSPACE_SYNC_STATUS = '/api/v1/workspace/sync-status' as const;
export const API_WORKSPACE_SYNC_EXPORT = '/api/v1/workspace/export' as const;
export const API_WORKSPACE_SYNC_IMPORT = '/api/v1/workspace/import' as const;

// =============================================================================
// Factor / Signal-Source / Persona Routes
// =============================================================================

export const API_FACTOR_LIST = '/api/v1/factor/list' as const;
export const API_FACTOR_START = '/api/factor/start' as const;
export const API_FACTOR_START_FROM_REPORTS = '/api/factor/start-from-reports' as const;
export const API_FACTOR_RESUME = '/api/factor/resume' as const;
export const API_SIGNAL_SOURCE_LIST = '/api/v1/signal-source/list' as const;
export const API_PERSONA_LIST = '/api/v1/persona/list' as const;

// =============================================================================
// Signal Discovery Routes
// =============================================================================

export const API_SIGNAL_DISCOVERY_TEMPLATES = '/api/v1/signal-discovery/templates' as const;
export const API_SIGNAL_DISCOVERY_DEFINITIONS = '/api/v1/signal-discovery/definitions' as const;
export const API_SIGNAL_DISCOVERY_SCOREBOARD = '/api/v1/signal-discovery/scoreboard' as const;
export const API_SIGNAL_DISCOVERY_QUALITY_METRICS = '/api/v1/signal-discovery/quality-metrics' as const;
export const API_SIGNAL_DISCOVERY_RUNS = '/api/v1/signal-discovery/runs' as const;
export const API_SIGNAL_DISCOVERY_START_SWEEP = '/api/v1/signal-discovery/start-sweep' as const;
export const API_SIGNAL_DISCOVERY_STOP_SWEEP = '/api/v1/signal-discovery/stop-sweep' as const;
export const API_SIGNAL_DISCOVERY_SWEEP_STATUS = '/api/v1/signal-discovery/sweep-status' as const;

// =============================================================================
// TICKET_1235_5: Alpha Factory / Quant Lab Routes
// =============================================================================

// TICKET_1281: System Monitor snapshot (web-dashboard sidebar panel)
export const API_SYSTEM_MONITOR = '/api/v1/system/monitor' as const;
export const API_WORKLOAD_QUEUE_GET = '/api/v1/system/workload-queue' as const;
export const API_WORKLOAD_QUEUE_ENQUEUE = '/api/v1/system/workload-queue/enqueue' as const;
export const API_WORKLOAD_QUEUE_DEQUEUE = '/api/v1/system/workload-queue/dequeue' as const;

export const API_ALPHA_FACTORY_RUN = '/api/v1/alpha-factory/run' as const;
export const API_ALPHA_FACTORY_PROGRESS = '/api/v1/alpha-factory/progress' as const;
export const API_QUANT_LAB_REFRESH_SCOREBOARD = '/api/v1/quant-lab/refresh-scoreboard' as const;
export const API_QUANT_LAB_REROLLUP_VERDICT = '/api/v1/quant-lab/rerollup-verdict' as const;
export const API_QUANT_LAB_REFIT_ARTIFACT = '/api/v1/quant-lab/refit-artifact' as const;

// =============================================================================
// TICKET_1335: Research Environment Routes
//
// The Service API is one of the three adapters over `ResearchEnvironmentService`
// (TICKET_1335 D2). Status and job reads are unauthenticated beyond the standard
// bearer token; install and repair additionally require a verified human-origin
// attestation, because the bearer token proves only that a local process could
// read the discovery file -- it is not evidence that a human approved a
// multi-gigabyte local mutation (D6).
// =============================================================================

export const API_RESEARCH_ENV_STATUS = '/api/v1/research-environment/status' as const;
export const API_RESEARCH_ENV_JOB = '/api/v1/research-environment/job' as const;
export const API_RESEARCH_ENV_INSTALL = '/api/v1/research-environment/install' as const;
export const API_RESEARCH_ENV_REPAIR = '/api/v1/research-environment/repair' as const;
export const API_RESEARCH_ENV_VERIFY = '/api/v1/research-environment/verify' as const;
export const API_RESEARCH_ENV_UNINSTALL = '/api/v1/research-environment/uninstall' as const;
export const API_RESEARCH_ENV_REMOVE_CAPABILITY = '/api/v1/research-environment/remove-capability' as const;

// =============================================================================
// TICKET_1235_5_2: Quant Lab Remaining Surface Routes
// =============================================================================

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
export const FACTOR_MINING_CORRELATION_HEADER = 'x-stratcraft-correlation-id' as const;
export const FACTOR_MINING_TOOL_HEADER = 'x-stratcraft-mcp-tool' as const;
export const RUNTIME_COMPOSITION_HEADER = 'x-stratcraft-runtime-composition' as const;
export const API_FACTOR_CATALOG_LIST = '/api/v1/factor-catalog/list' as const;
// TICKET_1335 D2: the old install/uninstall routes mutated Python packages via
// ambient pip. Replaced by catalog activation; no alias keeps the old wording.
export const API_FACTOR_CATALOG_ACTIVATE = '/api/v1/factor-catalog/activate' as const;
export const API_FACTOR_CATALOG_DEACTIVATE = '/api/v1/factor-catalog/deactivate' as const;
export const API_FACTOR_FORMULA_GENERATE = '/api/v1/factor-formula/generate' as const;
export const API_FACTOR_FORMULA_PERSIST = '/api/v1/factor-formula/persist' as const;

// =============================================================================
// TICKET_1235_2: Data Management Routes
// =============================================================================

export const API_DATA_LIST_PROVIDERS = '/api/v1/data/list-providers' as const;
export const API_DATA_SEARCH_SYMBOLS = '/api/v1/data/search-symbols' as const;
export const API_DATA_GET_SYMBOL_DATE_RANGE = '/api/v1/data/get-symbol-date-range' as const;
export const API_DATA_CHECK_COVERAGE = '/api/v1/data/check-coverage' as const;
export const API_DATA_LIST_SEGMENTS = '/api/v1/data/list-segments' as const;
export const API_DATA_GET_CACHE_STATS = '/api/v1/data/get-cache-stats' as const;
export const API_DATA_LIST_IMPORTED_PACKAGES = '/api/v1/data/list-imported-packages' as const;
export const API_DATA_LIST_IMPORTED_PACKAGE_SUMMARIES = '/api/v1/data/list-imported-package-summaries' as const;
export const API_DATA_CHECK_IMPORTED_PACKAGE_INTEGRITY = '/api/v1/data/check-imported-package-integrity' as const;
export const API_DATA_AUDIT_IMPORTED_PACKAGE_ORPHANS = '/api/v1/data/audit-imported-package-orphans' as const;
export const API_DATA_BUILD_COVERAGE_REPORT = '/api/v1/data/build-coverage-report' as const;
export const API_DATA_APPEND_TO_PACKAGE = '/api/v1/data/append-to-package' as const;
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

// =============================================================================
// TICKET_1364: HistData Forex Acquisition Routes
// =============================================================================

export const API_HISTDATA_REVIEW = '/api/v1/histdata/review' as const;
export const API_HISTDATA_CONFIRM = '/api/v1/histdata/confirm' as const;
export const API_HISTDATA_EXECUTE = '/api/v1/histdata/execute' as const;

// =============================================================================
// Plugin Marketplace Routes
// =============================================================================

export const API_PLUGINS_REGISTRY = '/api/v1/plugins/registry' as const;
export const API_PLUGINS_STATS = '/api/v1/plugins/stats' as const;
export const API_PLUGINS_ENTITLEMENTS = '/api/v1/plugins/entitlements' as const;

// =============================================================================
// TICKET_1235_7: Plugin Lifecycle & Entitlement Routes
// =============================================================================

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

// =============================================================================
// TICKET_1235_10: Signal Generator Plugin Routes
// =============================================================================

export const API_SIGNAL_GENERATOR_START = '/api/v1/signal-generator/start' as const;
export const API_SIGNAL_GENERATOR_STOP = '/api/v1/signal-generator/stop' as const;
export const API_SIGNAL_GENERATOR_STATUS = '/api/v1/signal-generator/status' as const;
export const API_SIGNAL_GENERATOR_HISTORY = '/api/v1/signal-generator/history' as const;
export const API_SIGNAL_GENERATOR_IMPORT_FACTORS = '/api/v1/signal-generator/import-factors' as const;
export const API_SIGNAL_GENERATOR_RUN_FACTOR_SWEEP = '/api/v1/signal-generator/run-factor-sweep' as const;

// =============================================================================
// TICKET_1235_8: Settings & Conversations Routes
// =============================================================================

export const API_SETTINGS_GET = '/api/v1/settings/get' as const;
export const API_SETTINGS_SET_LOCALE = '/api/v1/settings/set-locale' as const;
export const API_SETTINGS_SET_MARKET_ROUTING = '/api/v1/settings/set-market-routing' as const;
export const API_SETTINGS_SET_PROVIDER_DEFAULTS = '/api/v1/settings/set-provider-defaults' as const;
export const API_SETTINGS_LIST_LLM_PROVIDERS = '/api/v1/settings/list-llm-providers' as const;
export const API_SETTINGS_SET_LLM_SELECTION = '/api/v1/settings/set-llm-selection' as const;
export const API_SETTINGS_SET_LLM_CREDENTIAL = '/api/v1/settings/set-llm-credential' as const;
export const API_SETTINGS_CHECK_LLM_CREDENTIAL = '/api/v1/settings/check-llm-credential' as const;
/**
 * TICKET_1265_6 D2: desktop LLM-access decision + server bearer, sourced from
 * the desktop credential model (LLMKeyResolver + auth-service). The MCP
 * standalone server consumes this to gate LLM-consuming tools by the same
 * Plan>BYOK>none decision the desktop uses, and to source the server bearer
 * desktop-first -- no decision logic is duplicated on the MCP side.
 */
export const API_SETTINGS_GET_LLM_ACCESS = '/api/v1/settings/get-llm-access' as const;
export const API_CONVERSATION_LIST = '/api/v1/conversation/list' as const;
export const API_CONVERSATION_GET = '/api/v1/conversation/get' as const;
export const API_CONVERSATION_DELETE = '/api/v1/conversation/delete' as const;

// =============================================================================
// TICKET_1237_1: Agent core -- conversation writes
// =============================================================================

export const API_CONVERSATION_CREATE = '/api/v1/conversation/create' as const;
export const API_CONVERSATION_ADD_MESSAGE = '/api/v1/conversation/add-message' as const;

// =============================================================================
// User Routes
// =============================================================================

export const API_USER_CREDIT_STATUS = '/api/v1/user/credit-status' as const;

// =============================================================================
// TICKET_1302 U8: Configuration and database administration
// =============================================================================

export const API_CONFIG_RELOAD = '/api/v1/admin/config/reload' as const;

// TICKET_1304_15: the Service API is the only Guide WebUI commercial
// operation adapter. MCP bridges these routes and never imports package code.
export const API_COMMERCIAL_CAPABILITY = '/api/v1/commercial/capability' as const;
export const API_COMMERCIAL_EXECUTE = '/api/v1/commercial/execute' as const;
export const API_CONFIG_HEALTH = '/api/v1/admin/config/health' as const;
export const API_MACHINE_INFO = '/api/v1/admin/machine-info' as const;
export const API_DATABASE_BACKUP = '/api/v1/admin/database/backup' as const;
export const API_DATABASE_BACKUP_LIST = '/api/v1/admin/database/backups' as const;
export const API_DATABASE_RESTORE = '/api/v1/admin/database/restore' as const;

// =============================================================================
// TICKET_1368 Phase 5: Sigma marketplace admitted routes
// =============================================================================

export const API_SIGMA_ELIGIBILITY = '/api/v1/marketplace/sigma/eligibility' as const;
export const API_SIGMA_INSTALL = '/api/v1/marketplace/sigma/install' as const;
export const API_SIGMA_INSTALL_STATUS = '/api/v1/marketplace/sigma/install-status' as const;

// =============================================================================
// TICKET_1302 U7: Live Application State Routes
// =============================================================================

export const API_APP_RATE_LIMIT_STATUS = '/api/v1/app/rate-limit-status' as const;
export const API_APP_SERVER_STATUS = '/api/v1/app/server-status' as const;

// =============================================================================
// Dashboard Routes (non-versioned)
// =============================================================================

export const API_DASHBOARD_INTERPRET = '/api/dashboard/interpret' as const;
export const API_DASHBOARD_INTERPRET_STATUS = '/api/dashboard/interpret_status' as const;

// =============================================================================
// Strategy Generation Legacy Routes
// =============================================================================

export const API_START_MARKET_REGIME = '/api/start_market_regime_analysis' as const;
export const API_CHECK_MARKET_REGIME = '/api/check_market_regime_status' as const;
export const API_START_ENTRY_SIGNAL = '/api/start_regime_indicator_entry' as const;
export const API_CHECK_ENTRY_SIGNAL = '/api/check_regime_indicator_entry_status' as const;
export const API_START_EXIT_STRATEGY = '/api/start_exit_strategy' as const;
export const API_CHECK_EXIT_STRATEGY = '/api/check_exit_strategy_status' as const;

// =============================================================================
// Kronos Routes
// =============================================================================

export const API_START_KRONOS = '/api/start_kronos_prediction' as const;
export const API_CHECK_KRONOS = '/api/check_kronos_status' as const;
export const API_KRONOS_HEALTH = '/api/kronos/health' as const;
export const API_KRONOS_PREDICT = '/api/kronos/predict' as const;
export const API_START_KRONOS_INDICATOR_ENTRY = '/api/start_kronos_indicator_entry' as const;
export const API_CHECK_KRONOS_INDICATOR_ENTRY = '/api/check_kronos_indicator_entry_status' as const;
export const API_KRONOS_LLM_ENTRY = '/api/kronos_llm_entry' as const;
export const API_CHECK_KRONOS_LLM_ENTRY = '/api/check_kronos_llm_entry_status' as const;

// =============================================================================
// LLM Provider Routes
// =============================================================================

export const API_LLM_PROVIDERS_MODELS = '/api/llm/providers/models' as const;

// =============================================================================
// AI / LLM Generation Routes
// =============================================================================

export const API_START_LLM_LIBERO = '/api/start_llm_libero_analysis' as const;
export const API_CHECK_LLM_LIBERO = '/api/check_llm_libero_status' as const;
export const API_VIBING_CHAT = '/api/vibing_chat' as const;
export const API_CHECK_VIBING_CHAT = '/api/check_vibing_chat_status' as const;
export const API_LLM_TRADER = '/api/llm_trader' as const;
export const API_CHECK_LLM_TRADER = '/api/check_llm_trader_status' as const;

// =============================================================================
// Watchlist / Catalog Routes
// =============================================================================

export const API_START_WATCHLIST = '/api/start_watchlist_operation' as const;
export const API_CHECK_WATCHLIST = '/api/check_watchlist_operation_status' as const;
export const API_GENERATE_CATALOG_STRATEGY = '/api/generate_catalog_strategy' as const;
export const API_CHECK_CATALOG_STRATEGY = '/api/check_catalog_strategy_status' as const;

// =============================================================================
// Persona Routes (legacy, non-versioned)
// =============================================================================

export const API_PERSONA_LIST_LEGACY = '/api/persona/list' as const;

// =============================================================================
// Auth Proxy Routes
// =============================================================================

export const API_AUTH_SEND_CODE = '/api/auth/send-code' as const;
export const API_AUTH_VERIFY_CODE = '/api/auth/verify-code' as const;
export const API_AUTH_LOGIN_PASSWORD = '/api/auth/login-password' as const;

// =============================================================================
// TICKET_1235_9: Chart / Market Data Routes
// =============================================================================

export const API_MARKET_GET_DATA = '/api/v1/market/get-data' as const;
export const API_MARKET_GET_SYMBOLS = '/api/v1/market/get-symbols' as const;
export const API_KRONOS_RUN_PREDICTION = '/api/v1/kronos/run-prediction' as const;
export const API_KRONOS_CANCEL_PREDICTION = '/api/v1/kronos/cancel-prediction' as const;
export const API_KRONOS_LIST_MODELS = '/api/v1/kronos/list-models' as const;

// =============================================================================
// Aggregate type for all route paths
// =============================================================================

export type ApiRoute =
  | typeof API_COMMERCIAL_CAPABILITY
  | typeof API_COMMERCIAL_EXECUTE
  | typeof API_BACKTEST_LIST
  | typeof API_BACKTEST_RESULT
  | typeof API_BACKTEST_RUN
  | typeof API_BACKTEST_STATUS
  | typeof API_BACKTEST_CANCEL
  | typeof API_BACKTEST_QUEUE
  | typeof API_BACKTEST_CANCEL_ALL
  | typeof API_BACKTEST_PHASE
  | typeof API_BACKTEST_RESUME
  | typeof API_BACKTEST_CANDLES
  | typeof API_STRATEGY_LIST
  | typeof API_STRATEGY_GET
  | typeof API_STRATEGY_GENERATE
  | typeof API_STRATEGY_PERSIST
  | typeof API_STRATEGY_GENERATE_ENTRY
  | typeof API_STRATEGY_GENERATE_EXIT
  | typeof API_STRATEGY_GENERATE_KRONOS
  | typeof API_STRATEGY_GENERATE_AI_LIBERO
  | typeof API_STRATEGY_GENERATE_AI_STUDIO
  | typeof API_AI_STUDIO_SESSION_START
  | typeof API_AI_STUDIO_SESSION_CONTINUE
  | typeof API_AI_STUDIO_SESSION_ACTION
  | typeof API_STRATEGY_DELETE
  | typeof API_STRATEGY_COMPILE
  | typeof API_STRATEGY_COMPILATION_STATUS
  | typeof API_STRATEGY_VALIDATION_REPORT
  | typeof API_STRATEGY_TOOLCHAIN_STATUS
  | typeof API_STRATEGY_SAVE
  | typeof API_STRATEGY_LOAD
  | typeof API_STRATEGY_GENERATE_WORKFLOW
  | typeof API_GENERATION_SESSION_START
  | typeof API_GENERATION_SESSION_CANCEL
  | typeof API_GENERATION_SESSION_STATE
  | typeof API_STRATEGY_GENERATE_FROM_CATALOG
  | typeof API_BATCH_GENERATION_START
  | typeof API_BATCH_GENERATION_CANCEL
  | typeof API_WORKSPACE_SYNC_STATUS
  | typeof API_WORKSPACE_SYNC_EXPORT
  | typeof API_WORKSPACE_SYNC_IMPORT
  | typeof API_FACTOR_LIST
  | typeof API_FACTOR_START
  | typeof API_FACTOR_START_FROM_REPORTS
  | typeof API_FACTOR_RESUME
  | typeof API_SIGNAL_SOURCE_LIST
  | typeof API_PERSONA_LIST
  | typeof API_SIGNAL_DISCOVERY_TEMPLATES
  | typeof API_SIGNAL_DISCOVERY_DEFINITIONS
  | typeof API_SIGNAL_DISCOVERY_SCOREBOARD
  | typeof API_SIGNAL_DISCOVERY_QUALITY_METRICS
  | typeof API_SIGNAL_DISCOVERY_RUNS
  | typeof API_SIGNAL_DISCOVERY_START_SWEEP
  | typeof API_SIGNAL_DISCOVERY_STOP_SWEEP
  | typeof API_SIGNAL_DISCOVERY_SWEEP_STATUS
  | typeof API_PLUGINS_REGISTRY
  | typeof API_PLUGINS_STATS
  | typeof API_PLUGINS_ENTITLEMENTS
  | typeof API_USER_CREDIT_STATUS
  | typeof API_APP_RATE_LIMIT_STATUS
  | typeof API_APP_SERVER_STATUS
  | typeof API_DASHBOARD_INTERPRET
  | typeof API_DASHBOARD_INTERPRET_STATUS
  | typeof API_START_MARKET_REGIME
  | typeof API_CHECK_MARKET_REGIME
  | typeof API_START_ENTRY_SIGNAL
  | typeof API_CHECK_ENTRY_SIGNAL
  | typeof API_START_EXIT_STRATEGY
  | typeof API_CHECK_EXIT_STRATEGY
  | typeof API_START_KRONOS
  | typeof API_CHECK_KRONOS
  | typeof API_KRONOS_HEALTH
  | typeof API_KRONOS_PREDICT
  | typeof API_START_KRONOS_INDICATOR_ENTRY
  | typeof API_CHECK_KRONOS_INDICATOR_ENTRY
  | typeof API_KRONOS_LLM_ENTRY
  | typeof API_CHECK_KRONOS_LLM_ENTRY
  | typeof API_LLM_PROVIDERS_MODELS
  | typeof API_START_LLM_LIBERO
  | typeof API_CHECK_LLM_LIBERO
  | typeof API_VIBING_CHAT
  | typeof API_CHECK_VIBING_CHAT
  | typeof API_LLM_TRADER
  | typeof API_CHECK_LLM_TRADER
  | typeof API_START_WATCHLIST
  | typeof API_CHECK_WATCHLIST
  | typeof API_GENERATE_CATALOG_STRATEGY
  | typeof API_CHECK_CATALOG_STRATEGY
  | typeof API_PERSONA_LIST_LEGACY
  | typeof API_AUTH_SEND_CODE
  | typeof API_AUTH_VERIFY_CODE
  | typeof API_AUTH_LOGIN_PASSWORD
  | typeof API_SYSTEM_MONITOR
  | typeof API_WORKLOAD_QUEUE_GET
  | typeof API_WORKLOAD_QUEUE_ENQUEUE
  | typeof API_WORKLOAD_QUEUE_DEQUEUE
  | typeof API_ALPHA_FACTORY_RUN
  | typeof API_ALPHA_FACTORY_PROGRESS
  | typeof API_QUANT_LAB_REFRESH_SCOREBOARD
  | typeof API_QUANT_LAB_REROLLUP_VERDICT
  | typeof API_QUANT_LAB_REFIT_ARTIFACT
  | typeof API_RESEARCH_ENV_STATUS
  | typeof API_RESEARCH_ENV_JOB
  | typeof API_RESEARCH_ENV_INSTALL
  | typeof API_RESEARCH_ENV_REPAIR
  | typeof API_RESEARCH_ENV_VERIFY
  | typeof API_RESEARCH_ENV_UNINSTALL
  | typeof API_RESEARCH_ENV_REMOVE_CAPABILITY
  | typeof API_SWEEP_QUEUE_GET
  | typeof API_SWEEP_QUEUE_ENQUEUE
  | typeof API_SWEEP_QUEUE_CANCEL
  | typeof API_SWEEP_QUEUE_CLEAR
  | typeof API_SIGNAL_RUN_DELETE
  | typeof API_SIGNAL_RUN_UPDATE
  | typeof API_SWEEP_HISTORY
  | typeof API_SWEEP_COVERAGE
  | typeof API_LEADERBOARD
  | typeof API_DEFINITION_ROLLUP
  | typeof API_CUSTOM_FACTOR_SAVE
  | typeof API_CUSTOM_FACTOR_DELETE
  | typeof API_SIGNAL_SOURCE_GET
  | typeof API_SIGNAL_SOURCE_DELETE
  | typeof API_SIGNAL_SOURCE_CONFIRM
  | typeof API_REMEDIATION_FAMILY_BH
  | typeof API_PROMOTION_REGISTER
  | typeof API_PROMOTION_STATUS
  | typeof API_ROSTER_GET_STATE
  | typeof API_ROSTER_LIST
  | typeof API_ROSTER_APPLY_TRANSITION
  | typeof API_ROSTER_REMOVE
  | typeof API_RELEGATION_GET_CONFIG
  | typeof API_RELEGATION_SET_CONFIG
  | typeof API_RELEGATION_RUN_CYCLE
  | typeof API_LSTM_GET_MANIFEST
  | typeof API_LSTM_SET_ACTIVE_VERSION
  | typeof API_LSTM_DELETE_VERSION
  | typeof API_LSTM_LIST_SNAPSHOTS
  | typeof API_LSTM_SAVE_SNAPSHOT
  | typeof API_LSTM_RESTORE_SNAPSHOT
  | typeof API_LSTM_DELETE_SNAPSHOT
  | typeof API_LSTM_TRAINING_START
  | typeof API_LSTM_TRAINING_STATUS
  | typeof API_LSTM_TRAINING_CANCEL
  | typeof API_LSTM_TRAINING_HISTORY
  | typeof API_LSTM_FIT_QUALITY_REPORT
  | typeof API_ALPHA_FACTORY_SAVE_CONFIG
  | typeof API_ALPHA_FACTORY_LOAD_CONFIG
  | typeof API_ALPHA_FACTORY_CANCEL
  | typeof API_ALPHA_FACTORY_CANCEL_UNIVERSE
  | typeof API_ALPHA_FACTORY_PROVIDER_WINDOW
  | typeof API_ALPHA_FACTORY_LAST_RESULT
  | typeof API_CHIP_ALLOWED_REGIMES_GET
  | typeof API_CHIP_ALLOWED_REGIMES_SET
  | typeof API_FACTOR_MINING_START
  | typeof API_FACTOR_MINING_REVIEW
  | typeof API_FACTOR_MINING_EDIT
  | typeof API_FACTOR_MINING_CONFIRM
  | typeof API_FACTOR_MINING_STATUS
  | typeof API_FACTOR_MINING_SESSIONS
  | typeof API_FACTOR_CATALOG_LIST
  | typeof API_FACTOR_CATALOG_ACTIVATE
  | typeof API_FACTOR_CATALOG_DEACTIVATE
  | typeof API_FACTOR_FORMULA_GENERATE
  | typeof API_FACTOR_FORMULA_PERSIST
  | typeof API_DATA_LIST_PROVIDERS
  | typeof API_DATA_SEARCH_SYMBOLS
  | typeof API_DATA_GET_SYMBOL_DATE_RANGE
  | typeof API_DATA_CHECK_COVERAGE
  | typeof API_DATA_LIST_SEGMENTS
  | typeof API_DATA_GET_CACHE_STATS
  | typeof API_DATA_LIST_IMPORTED_PACKAGES
  | typeof API_DATA_LIST_IMPORTED_PACKAGE_SUMMARIES
  | typeof API_DATA_CHECK_IMPORTED_PACKAGE_INTEGRITY
  | typeof API_DATA_AUDIT_IMPORTED_PACKAGE_ORPHANS
  | typeof API_DATA_BUILD_COVERAGE_REPORT
  | typeof API_DATA_APPEND_TO_PACKAGE
  | typeof API_DATA_QUEUE_DOWNLOAD
  | typeof API_DATA_GET_DOWNLOAD_STATUS
  | typeof API_DATA_RETRY_FAILED
  | typeof API_DATA_CANCEL_DOWNLOAD
  | typeof API_DATA_GET_QUEUE_STATUS
  | typeof API_DATA_DELETE_SEGMENTS
  | typeof API_DATA_IMPORT_PACKAGE
  | typeof API_DATA_REGISTER_PARQUET_DIR
  | typeof API_DATA_REMOVE_PACKAGE
  | typeof API_DATA_CLEAR_CACHE
  | typeof API_HISTDATA_REVIEW
  | typeof API_HISTDATA_CONFIRM
  | typeof API_HISTDATA_EXECUTE
  | typeof API_PLUGIN_LIST
  | typeof API_PLUGIN_GET
  | typeof API_PLUGIN_GET_CONFIG
  | typeof API_PLUGIN_SET_CONFIG
  | typeof API_PLUGIN_ACTIVATE
  | typeof API_PLUGIN_DEACTIVATE
  | typeof API_PLUGIN_INSTALL
  | typeof API_PLUGIN_UNINSTALL
  | typeof API_ENTITLEMENT_LIST
  | typeof API_ENTITLEMENT_GET_PLUGIN
  | typeof API_ENTITLEMENT_TOGGLE_SERVICE
  | typeof API_MARKET_GET_DATA
  | typeof API_MARKET_GET_SYMBOLS
  | typeof API_KRONOS_RUN_PREDICTION
  | typeof API_KRONOS_CANCEL_PREDICTION
  | typeof API_KRONOS_LIST_MODELS
  | typeof API_SIGNAL_GENERATOR_START
  | typeof API_SIGNAL_GENERATOR_STOP
  | typeof API_SIGNAL_GENERATOR_STATUS
  | typeof API_SIGNAL_GENERATOR_HISTORY
  | typeof API_SIGNAL_GENERATOR_IMPORT_FACTORS
  | typeof API_SIGNAL_GENERATOR_RUN_FACTOR_SWEEP
  | typeof API_SETTINGS_LIST_LLM_PROVIDERS
  | typeof API_SETTINGS_SET_LLM_SELECTION;
