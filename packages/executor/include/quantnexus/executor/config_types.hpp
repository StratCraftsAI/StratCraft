/**
 * Executor Configuration Types
 *
 * TICKET_133 Phase 1: Executor Core Development
 *
 * Defines configuration structures for strategy execution.
 */

#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <optional>
#include <nlohmann/json.hpp>

#include "executor_constants.hpp"

namespace StratCraft::executor {

// =============================================================================
// Data Configuration
// =============================================================================

/**
 * Data source configuration
 */
struct DataConfig {
    std::string symbol;
    std::string interval;           // "1m", "5m", "1h", "1d"
    int64_t startTime;              // Unix timestamp (seconds)
    int64_t endTime;
    std::string dataPath;           // Path to data file (Parquet)
    std::string dataSourceType;     // "parquet", "mock"

    // TICKET_1292 Phase 3 (MC-07 window pushdown): number of rows the
    // reader must include *before* the first row at/after `startTime`, so
    // a stateful consumer (e.g. factor_eval's rolling indicator+reducer)
    // reaches the same warm state at `startTime` it would have under a
    // full-file read. Ignored when no window is requested
    // (startTime <= 0 && endTime <= 0) or when the source has no ordering.
    // The margin is a row COUNT, not a time span, so it is exact under
    // irregular bar spacing and NaN-skipping reducers.
    int64_t warmupBars = 0;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE(DataConfig,
        symbol, interval, startTime, endTime, dataPath, dataSourceType)
};

/**
 * TICKET_248 Phase 2: Multi-timeframe data feed
 *
 * Represents a single data feed for a specific timeframe.
 * Multiple DataFeed entries enable strategies to use different
 * timeframes for different algorithm stages.
 */
struct DataFeed {
    std::string interval;           // "1d", "1h", "15m", etc.
    std::string dataPath;           // Path to Parquet file for this timeframe

    NLOHMANN_DEFINE_TYPE_INTRUSIVE(DataFeed, interval, dataPath)
};

// =============================================================================
// Strategy Configuration
// =============================================================================

/**
 * Strategy parameters
 */
struct StrategyParams {
    nlohmann::json params;          // Arbitrary strategy parameters

    NLOHMANN_DEFINE_TYPE_INTRUSIVE(StrategyParams, params)
};

// =============================================================================
// Execution Configuration
// =============================================================================

/**
 * Backtest execution settings
 */
struct ExecutionConfig {
    double initialCapital = constants::DEFAULT_INITIAL_CAPITAL;
    double commission = constants::DEFAULT_COMMISSION_RATE;
    double slippage = constants::DEFAULT_SLIPPAGE_RATE;
    bool allowShort = true;
    double maxPositionSize = constants::DEFAULT_MAX_POSITION_SIZE;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE(ExecutionConfig,
        initialCapital, commission, slippage, allowShort, maxPositionSize)
};

// =============================================================================
// Checkpoint Configuration (TICKET_176)
// =============================================================================

/**
 * Checkpoint settings for backtest resume capability
 */
struct CheckpointSettings {
    bool enabled = true;
    int interval = constants::DEFAULT_CHECKPOINT_INTERVAL;
    int maxCount = constants::DEFAULT_CHECKPOINT_MAX_COUNT;
    int warmupPeriod = constants::DEFAULT_CHECKPOINT_WARMUP_PERIOD;
    bool cleanupOnComplete = true;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(CheckpointSettings,
        enabled, interval, maxCount, warmupPeriod, cleanupOnComplete)
};

// =============================================================================
// Resume Configuration (TICKET_176)
// =============================================================================

/**
 * Resume settings for continuing from checkpoint
 */
struct ResumeSettings {
    bool enabled = false;
    std::string taskId;
    int fromBar = 0;                 // Auto-calculated from checkpoint

    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(ResumeSettings,
        enabled, taskId, fromBar)
};

// =============================================================================
// Kronos API Configuration (TICKET_225)
// =============================================================================

/**
 * Kronos API configuration for online backtest
 *
 * Enables strategies to call real Kronos prediction API during backtest.
 * Token is injected at runtime from AuthService.
 */
struct KronosApiConfig {
    bool enabled = false;            // Enable Kronos API calls during backtest
    std::string endpoint;            // API endpoint (e.g., "https://desktop-api.silvonastream.com")
    std::string token;               // JWT access token for authentication

    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(KronosApiConfig,
        enabled, endpoint, token)
};

// =============================================================================
// C++ Strategy Hardening Configuration (NONABT_TICKET_010_3 Phase 4F)
// =============================================================================

/**
 * Security, resource-limit, and compile-performance controls for cpp_backtest.
 *
 * Defaults are intentionally conservative and can be overridden by generated
 * config.json or desktop settings once the toolchain UI exposes these knobs.
 */
struct CppHardeningConfig {
    bool enableSandbox = true;
    int runnerCpuTimeSeconds = 120;
    int runnerMemoryLimitMb = 1024;
    bool enableArtifactCache = true;
    std::string artifactCacheDir;
    std::string pchPath;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(CppHardeningConfig,
        enableSandbox, runnerCpuTimeSeconds, runnerMemoryLimitMb,
        enableArtifactCache, artifactCacheDir, pchPath)
};

// =============================================================================
// Executor Configuration (Top-level)
// =============================================================================

/**
 * Complete executor configuration
 *
 * This is loaded from config.json generated by Builder.
 */
struct ExecutorConfig {
    std::string pluginName;          // "backtest", "cpp_backtest", "live"
    std::string language = "python"; // "python" or "cpp"
    std::string taskId;              // Task identifier (TICKET_176, optional)
    std::string strategyPath;        // Path to main.py or strategy.cpp
    std::string frameworkPath;       // Path to framework module
    std::string outputDir;           // Output directory for results
    std::string compilerPath;        // Optional clang++ path for C++ strategies
    std::string runnerPath;          // Optional stratforge-runner path for C++ strategies
    std::vector<std::string> cppIncludePaths; // Optional include paths for C++ strategies
    std::string cppStrategyArtifactPath; // Optional precompiled C++ strategy library
    DataConfig data;                 // Legacy single-timeframe (backward compat)
    std::vector<DataFeed> dataFeeds; // TICKET_248 Phase 2: multi-timeframe data
    StrategyParams strategy;
    ExecutionConfig execution;
    CheckpointSettings checkpoint;   // TICKET_176 (optional, has defaults)
    ResumeSettings resume;           // TICKET_176 (optional, has defaults)
    KronosApiConfig kronosApi;       // TICKET_225 (optional, has defaults)
    CppHardeningConfig cppHardening; // NONABT_TICKET_010_3 Phase 4F

    /**
     * Load from JSON file
     */
    static ExecutorConfig LoadFromFile(const std::string& path);

    /**
     * Load from JSON string
     */
    static ExecutorConfig LoadFromString(const std::string& json);

    // Use WITH_DEFAULT to make taskId, pluginName, language, C++ paths, checkpoint,
    // resume, kronosApi, and dataFeeds optional.
    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(ExecutorConfig,
        pluginName, language, taskId, strategyPath, frameworkPath, outputDir,
        compilerPath, runnerPath, cppIncludePaths, cppStrategyArtifactPath, data, dataFeeds, strategy,
        execution, checkpoint, resume, kronosApi, cppHardening)
};

} // namespace StratCraft::executor
