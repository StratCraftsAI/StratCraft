/**
 * Timing Constants
 *
 * TICKET_179: Unified Constants Management
 *
 * All timing-related constants: delays, intervals, timeouts.
 */

// =============================================================================
// Poll Intervals
// =============================================================================

/** Strategy generation poll interval (ms) */
export const STRATEGY_GEN_POLL_INTERVAL_MS = 2000;

/** Strategy generation max poll attempts */
export const STRATEGY_GEN_MAX_POLL_ATTEMPTS = 60;

/** Plugin startup poll interval (ms) */
export const PLUGIN_STARTUP_POLL_INTERVAL_MS = 1000;

/** Python server startup poll interval (ms) */
export const PYTHON_SERVER_STARTUP_POLL_MS = 1000;

// =============================================================================
// Connection Delays
// =============================================================================

/** gRPC readiness check delay (ms) */
export const GRPC_READINESS_CHECK_DELAY_MS = 500;

/** gRPC connection retry delay (ms) */
export const GRPC_CONNECTION_RETRY_DELAY_MS = 500;

/** OAuth loopback server shutdown delay (ms) */
export const OAUTH_LOOPBACK_SHUTDOWN_DELAY_MS = 1000;

// =============================================================================
// Timeouts
// =============================================================================

/** SQLite busy timeout (ms) */
export const SQLITE_BUSY_TIMEOUT_MS = 5000;

/** ClickHouse request timeout (ms) */
export const CLICKHOUSE_REQUEST_TIMEOUT_MS = 30000;

/** gRPC request timeout (ms) */
export const GRPC_REQUEST_TIMEOUT_MS = 30000;

/** React Query stale time (ms) */
export const REACT_QUERY_STALE_TIME_MS = 5000;

// =============================================================================
// Retry Counts
// =============================================================================

/** gRPC connection max retries */
export const GRPC_CONNECTION_MAX_RETRIES = 10;

/** gRPC max reconnect attempts */
export const GRPC_MAX_RECONNECT_ATTEMPTS = 10;

/** Python server max retries */
export const PYTHON_SERVER_MAX_RETRIES = 30;

/** React Query default retry count */
export const REACT_QUERY_DEFAULT_RETRY = 1;

// =============================================================================
// TICKET_476: Additional Timing Constants
// =============================================================================

// TICKET_1335 D2 (R8/TICKET_524): PIP_INSTALL_TIMEOUT_MS and
// PIP_UNINSTALL_TIMEOUT_MS were deleted with their only consumer, the
// factor-engine `execSync('pip install ...')` path. Package installation is
// owned by the locked pixi manifest, so no timeout for an ambient pip belongs
// in this layer. Retaining zero-consumer timeouts would imply the app still
// shells out to pip.

/** Default API request timeout (ms) */
export const API_REQUEST_DEFAULT_TIMEOUT_MS = 30000;

/** API key validation timeout (ms) -- AbortController-based, may be ignored
 * by undici under socket-pool edge cases (see TICKET_809 follow-up). */
export const API_KEY_VALIDATION_TIMEOUT_MS = 10000;

/** API key validation hard timeout (ms) -- Promise.race fallback that fires
 * even if AbortController.abort() does not propagate to the in-flight fetch.
 * Must be slightly larger than API_KEY_VALIDATION_TIMEOUT_MS so the abort
 * path gets its chance first and we keep its richer error code. */
export const API_KEY_VALIDATION_HARD_TIMEOUT_MS = 11000;

/** API key validation IPC outer timeout (ms) -- last-resort guard at the
 * IPC handler boundary so the renderer always receives a response. Must be
 * larger than the hard timeout so inner errors are reported with full
 * context before this fires. */
export const API_KEY_VALIDATION_IPC_TIMEOUT_MS = 13000;

/** Kronos poll max attempts */
export const KRONOS_POLL_MAX_ATTEMPTS = 120;

/** Kronos poll interval (ms) */
export const KRONOS_POLL_INTERVAL_MS = 2000;

/** Auth query stale time (ms) */
export const AUTH_QUERY_STALE_TIME_MS = 30000;

/** Task poll interval for backtest results (ms) */
export const TASK_POLL_INTERVAL_MS = 2000;

/** Health check refetch interval (ms) */
export const HEALTH_CHECK_INTERVAL_MS = 30000;

/** WebSocket reconnect interval (ms) */
export const WS_RECONNECT_INTERVAL_MS = 3000;

/** WebSocket max reconnect attempts */
export const WS_MAX_RECONNECT_ATTEMPTS = 5;

/** TICKET_568_2_2: Signal Discovery LLM call timeout - 120s (ms)
 * LLM hypothesis generation requires longer than the default 30s API timeout.
 * Backend call chain: auth -> entitlement -> credit check -> LLM call -> parse.
 * Observed LLM response times: 60-120s for hypothesis generation prompts. */
export const SIGNAL_DISCOVERY_LLM_TIMEOUT_MS = 120000;

/** TICKET_1170: Round 4 (Signal Assembly) timeout - 200s (ms).
 * Round 4 generates a full SignalSourceBase C++ file from all hypotheses,
 * which is significantly heavier than Round 1/2 hypothesis generation.
 * 6 consecutive runs timed out at 120s; 200s accommodates the larger payload. */
export const SIGNAL_DISCOVERY_ROUND4_TIMEOUT_MS = 200_000;

/** TICKET_895: Per-arm executor timeout for signal discovery sweeps - 120s (ms).
 * Applies to C++ StratCraft-executor spawns. Python spawns (fit_one.py,
 * fit_universe.py) use heartbeat-based liveness instead (TICKET_976_4 Layer 2):
 * the Python process emits stdout heartbeat lines during EM fitting; the TS
 * spawner resets a per-heartbeat liveness timer on each line. Only a true hang
 * (no stdout activity for PYTHON_FIT_HEARTBEAT_LIVENESS_MS) triggers a kill. */
export const PER_ARM_EXECUTOR_TIMEOUT_MS = 120_000;

/** TICKET_1292_09 (MC-09): timeout for the C++ StratCraft-executor
 * --strategy-admission command. Admission drives a short-lived clang++
 * subprocess (-fsyntax-only + a temp .so compile) plus source-only analysis;
 * 30s covers a cold compile of a single generated strategy translation unit
 * with the SDK headers. Source-only invocations (no compilerPath) finish in
 * milliseconds -- this bound is for the compile-enabled path. */
export const STRATEGY_ADMISSION_TIMEOUT_MS = 30_000;

/** TICKET_1292_11 (MC-11): timeout for the C++ StratCraft-executor
 * --planning-geometry command. Planning geometry is pure integer/window
 * arithmetic (CV sizing, embargo derivation, bar sufficiency, snapshot
 * windows) with no compile or IO; a request resolves in single-digit
 * milliseconds. The 10s bound is a generous ceiling that only guards
 * against a wedged process, never a slow computation. */
export const PLANNING_GEOMETRY_TIMEOUT_MS = 10_000;

/** TICKET_1292_15 (MC-15): timeout for the C++ --code-version command. The
 * command is a bounded static import-closure scan + SHA-256 aggregation over a
 * few dozen small source files plus one lockfile -- single-digit milliseconds in
 * practice. The 10s bound only guards against a wedged process, never a slow
 * computation (TICKET_855). */
export const CODE_VERSION_TIMEOUT_MS = 10_000;

/** TICKET_1099_1 R4: per-symbol budget for Python batch predict_only timeout.
 * Total timeout = symbolCount * this + PYTHON_BATCH_TIMEOUT_BASE_MS.
 * 3s/symbol covers vectorized feature build + parquet write at 5m scale. */
export const PYTHON_BATCH_TIMEOUT_PER_SYMBOL_MS = 3_000;

/** TICKET_1099_1 R4: base overhead for Python batch predict (model load, startup). */
export const PYTHON_BATCH_TIMEOUT_BASE_MS = 30_000;

/** TICKET_976_4 Layer 2: Python fit process heartbeat liveness timeout - 180s (ms).
 * If a Python fit_one.py / fit_universe.py process produces no stdout output
 * (neither a heartbeat line nor the final JSON envelope) for this duration,
 * the spawner concludes the process is hung and SIGTERM's it.
 * Raised from 90s to 180s: XGBoost n_estimators=500 x max_depth=6 on a
 * 28-symbol 5m universe can legitimately train for >90s between heartbeats
 * when running 3-4 concurrent workers. 180s still catches true hangs within
 * 3 minutes while eliminating false-positive kills on heavy cells. */
export const PYTHON_FIT_HEARTBEAT_LIVENESS_MS = 180_000;

/** TICKET_795_1_1 / TICKET_802: Factor formula generation timeout - 180s (ms)
 * Locked in TICKET_795_1_1 section 3 decision 7. Higher than Round 1/2/4
 * because reasoning models (o3, deepseek-r1, claude-opus-thinking) on
 * multi-formula JSON synthesis routinely take 90-150s. Backend
 * LLMProviderConfig.timeout_seconds for the resolved provider MUST be <= 180. */
export const FACTOR_FORMULA_LLM_TIMEOUT_MS = 180000;

// =============================================================================
// TICKET_755: UI Watchdog Timeouts
// =============================================================================
// Maximum time a UI may show a "running" / "loading" state without ANY
// backend event before forcing transition to error state. Last line of
// defense against backend hangs and IPC channel drops.
// See TICKET_755 for policy rationale, TICKET_976_4 for liveness semantic.

/** Single-shot LLM generation flows (Strategy Builder, Vibing Chat).
 *  Should exceed SIGNAL_DISCOVERY_LLM_TIMEOUT_MS by a margin to allow the
 *  HTTP-level timeout to fire and propagate first. */
export const UI_WATCHDOG_GENERATION_MS = SIGNAL_DISCOVERY_LLM_TIMEOUT_MS + 60_000;

/** TICKET_976_4: liveness timeout -- fires when the backend has produced
 *  zero events of any kind (run-created, run-group-rolled-up,
 *  batch-progress, etc.) for this duration. NOT a "time since last arm
 *  completed" gate.
 *  @deprecated Phase 2 replaces this with UI_WATCHDOG_LIVENESS_MS for signal
 *  discovery. Retained for non-sweep consumers (if any). */
export const UI_WATCHDOG_BATCH_PROGRESS_MS = SIGNAL_DISCOVERY_LLM_TIMEOUT_MS + 60_000;

/** TICKET_976_4 Phase 2: heartbeat-driven liveness timeout for signal
 *  discovery. The Main process forwards Python stdout heartbeats (~30s
 *  interval) as `sweep-liveness` IPC events. 90s = 3x heartbeat interval;
 *  cannot false-positive unless the IPC channel is genuinely broken.
 *  NOT a workload-duration guess -- see TICKET_976_4 design doc. */
export const UI_WATCHDOG_LIVENESS_MS = 90_000;

/** Backtest execution. Reset on each progress event. Absolute ceiling between
 *  progress events; backtests may legitimately run for many minutes. */
export const UI_WATCHDOG_BACKTEST_PROGRESS_MS = 5 * 60_000;

/** Focus delay after view transition (ms) */
export const FOCUS_DELAY_MS = 100;

/** Auth required highlight animation duration (ms) */
export const AUTH_HIGHLIGHT_DURATION_MS = 2000;

/** Search field blur delay for dropdown dismissal (ms) */
export const SEARCH_BLUR_DELAY_MS = 200;

/** Tab state persistence debounce (ms) */
export const PERSIST_DEBOUNCE_MS = 2000;

// =============================================================================
// TICKET_179: Service-Level Timing Constants
// =============================================================================

/** Lifecycle script execution timeout - 5 minutes (ms) */
export const LIFECYCLE_SCRIPT_TIMEOUT_MS = 300000;

/** Token refresh buffer - refresh 5 min before expiry (ms) */
export const TOKEN_REFRESH_BUFFER_MS = 300000;

/** Credential refresh buffer - refresh 1 hour before expiration (ms) */
export const CREDENTIAL_REFRESH_BUFFER_MS = 3600000;

/** License validation cache TTL - 1 hour (ms) */
export const LICENSE_VALIDATION_CACHE_TTL_MS = 3600000;

/** TICKET_551: Entitlement poll interval after purchase (ms) */
export const ENTITLEMENT_POLL_INTERVAL_MS = 5000;

/** TICKET_551: Entitlement poll max attempts (5s * 60 = 5 minutes) */
export const ENTITLEMENT_POLL_MAX_ATTEMPTS = 60;

/** Plugin market registry cache TTL - 5 minutes (ms) */
export const PLUGIN_MARKET_CACHE_TTL_MS = 300000;

/** ClickHouse credential expiry buffer - 5 minutes (ms) */
export const CLICKHOUSE_CREDENTIAL_EXPIRY_BUFFER_MS = 300000;

/** Executor task cleanup delay after completion (ms) */
export const EXECUTOR_TASK_CLEANUP_DELAY_MS = 60000;

/** Finished task retention window before memory removal (ms) */
export const FINISHED_TASK_RETENTION_MS = 60000;

/** Slow query detection threshold for plugin DB operations (ms) */
export const DATABASE_SLOW_QUERY_THRESHOLD_MS = 1000;

/** Toast success message auto-dismiss duration (ms) */
export const MESSAGE_DURATION_SUCCESS_MS = 3000;

/** Toast warning message auto-dismiss duration (ms) */
export const MESSAGE_DURATION_WARNING_MS = 5000;

/** Toast error message auto-dismiss duration (ms) */
export const MESSAGE_DURATION_ERROR_MS = 8000;

/** Toast info message auto-dismiss duration (ms) */
export const MESSAGE_DURATION_INFO_MS = 4000;

/** Copy-to-clipboard feedback display duration (ms) */
export const COPY_FEEDBACK_DURATION_MS = 2000;

/** Default info panel / iframe embed height (px) */
export const DEFAULT_INFO_PANEL_HEIGHT_PX = 600;

// =============================================================================
// TICKET_179: Time Unit Conversion Constants
// =============================================================================

/** Milliseconds per second */
export const MS_PER_SECOND = 1000;

/** Milliseconds per minute */
export const MS_PER_MINUTE = 60_000;

/** Milliseconds per hour */
export const MS_PER_HOUR = 3_600_000;

/** Milliseconds per day */
export const MS_PER_DAY = 86_400_000;

// =============================================================================
// TICKET_704: Free-Tier BYOK Rate Limiting
// =============================================================================

/** Free tier: max requests per minute */
export const FREE_TIER_RATE_LIMIT_PER_MINUTE = 1;

/** Free tier: max requests per hour */
export const FREE_TIER_RATE_LIMIT_PER_HOUR = 15;

/** Free tier: sliding window duration for per-minute limit (ms) */
export const FREE_TIER_RATE_LIMIT_MINUTE_WINDOW_MS = 60_000;

/** Free tier: sliding window duration for per-hour limit (ms) */
export const FREE_TIER_RATE_LIMIT_HOUR_WINDOW_MS = 3_600_000;

// =============================================================================
// TICKET_1023_7: C++ Toolchain & CLI Subprocess Timeouts
// =============================================================================

/** C++ smoke test compilation timeout - 30s (ms).
 *  Compiling a minimal C++23 program (`int main()`) to verify toolchain. */
export const CPP_SMOKE_TEST_TIMEOUT_MS = 30_000;

/** Toolchain archive extraction timeout - 2 minutes (ms).
 *  Extracting a bundled Clang/LLVM toolchain tar.gz can be large. */
export const TOOLCHAIN_EXTRACT_TIMEOUT_MS = 120_000;

/** Short CLI probe timeout - 5s (ms).
 *  Used for quick subprocess probes: `which clang++`, `clang++ --version`,
 *  `xcrun --show-sdk-path`, etc. */
export const CLI_PROBE_TIMEOUT_MS = 5_000;

/** Git rev-parse timeout - 2s (ms).
 *  Resolving HEAD commit SHA via `git rev-parse HEAD` for audit stamping. */
export const GIT_REV_PARSE_TIMEOUT_MS = 2_000;

// =============================================================================
// TICKET_1023_7: Vibing Chat Polling Timeouts
// =============================================================================

/** Vibing Chat poll interval (ms) */
export const VIBING_CHAT_POLL_INTERVAL_MS = 500;

/** Vibing Chat LLM generation timeout - 3 minutes (ms).
 *  Higher than SIGNAL_DISCOVERY_LLM_TIMEOUT_MS because vibing chat
 *  includes strategy code generation + rule extraction in a single
 *  server round-trip. */
export const VIBING_CHAT_TIMEOUT_MS = 180_000;

// =============================================================================
// TICKET_1023_7: Query Limits
// =============================================================================

/** Default limit for IPC list-query handlers (backtest history, task history,
 *  backtest runs). Caps the initial page size when the renderer omits an
 *  explicit `limit` parameter. */
export const IPC_LIST_QUERY_DEFAULT_LIMIT = 50;

/** Default limit for roster transition log queries */
export const ROSTER_TRANSITION_DEFAULT_LIMIT = 200;

/** Maximum limit for roster transition log queries.
 *  SQLite reads are cheap, but capped to avoid pathological renderer payloads. */
export const ROSTER_TRANSITION_MAX_LIMIT = 1000;

// =============================================================================
// TICKET_1023_8: UI Poll/Timer Constants
// =============================================================================

/** LSTM training monitor poll interval (ms).
 *  Used by TrainingMonitorPage and useLstmCombinatorData to poll training
 *  status when IPC event-driven updates are unavailable. */
export const TRAINING_MONITOR_POLL_INTERVAL_MS = 3000;

/** Backtest result elapsed-timer fallback tick interval (ms).
 *  Drives the elapsed-time display during idle phases (SPAWN/INITIALIZE)
 *  where no progress-driven re-renders occur. */
export const BACKTEST_RESULT_TICK_INTERVAL_MS = 500;

/** Secrets tab validation feedback auto-dismiss duration (ms).
 *  After an API key test fails, the error status resets to idle after
 *  this duration so the user can retry. */
export const SECRETS_FEEDBACK_DISMISS_MS = 5000;

/** Marketplace entitlement poll interval (ms).
 *  After a purchase, polls the entitlement endpoint at this interval
 *  until the server confirms the entitlement is active. */
export const MARKETPLACE_POLL_INTERVAL_MS = 5000;

/**
 * TICKET_1334 P4: Service API runtime-role liveness re-probe interval (ms).
 *
 * The role monitor's `fs.watch` on the discovery directory catches a claim being
 * created or removed within milliseconds, so this poll exists for exactly ONE
 * transition it cannot see: a role holder killed by SIGKILL or the OOM reaper
 * leaves its claim file behind byte-identical with a dead pid. Nothing changes on
 * disk, so only re-running `process.kill(pid, 0)` can notice.
 *
 * 5s matches the other background-state polls in this file
 * (`ENTITLEMENT_POLL_INTERVAL_MS`, `MARKETPLACE_POLL_INTERVAL_MS`). The work per
 * tick is one `existsSync` plus, at most, one small read and one signal-0 probe,
 * and only while this process does NOT hold the role -- when it does, the
 * in-process listener answers without touching the filesystem at all.
 */
export const SERVICE_API_ROLE_LIVENESS_POLL_MS = 5000;

/**
 * TICKET_1335_1 Phase 2: research-environment active-job poll interval (ms).
 *
 * WHY POLLING AT ALL: the parent's IPC surface
 * (`RESEARCH_ENVIRONMENT_CHANNELS`) is five invoke/await channels with no
 * `webContents.send`, so there is no progress event to subscribe to. Adding one
 * here would create a second producer of environment state outside the parent's
 * contract (TICKET_1335 owns that surface), so the renderer polls instead.
 *
 * This is NOT an ambient timer: it runs only while a job is non-terminal and
 * stops the moment the job reaches `succeeded` or `failed`. Durability across a
 * renderer reload comes from re-reading `getStatus()` on mount, not from this.
 *
 * 2s rather than the 5s used by the background-state polls above: those watch
 * for a state change the user did not initiate, whereas this one redraws a
 * progress panel the user is actively watching during a multi-minute install.
 * Each tick is one `getJob` invoke returning a bounded payload.
 */
export const RESEARCH_ENVIRONMENT_JOB_POLL_MS = 2000;
