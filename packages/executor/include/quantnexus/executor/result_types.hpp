/**
 * Executor Result Types
 *
 * TICKET_133 Phase 1: Executor Core Development
 *
 * Defines result structures for backtest execution.
 */

#pragma once

#include <string>
#include <vector>
#include <array>
#include <cstdint>
#include <functional>
#include <nlohmann/json.hpp>

namespace StratCraft::executor {

// =============================================================================
// Trade Record
// =============================================================================

/**
 * Single trade record
 */
struct Trade {
    int64_t entryTime;              // Unix timestamp (ms)
    int64_t exitTime;
    std::string symbol;
    std::string side;               // "buy" or "sell"
    double entryPrice;
    double exitPrice;
    double quantity;
    double pnl;
    double commission;
    std::string reason;             // Entry/exit reason

    NLOHMANN_DEFINE_TYPE_INTRUSIVE(Trade,
        entryTime, exitTime, symbol, side, entryPrice, exitPrice,
        quantity, pnl, commission, reason)
};

// =============================================================================
// Equity Point
// =============================================================================

/**
 * Point on equity curve
 */
struct EquityPoint {
    int64_t timestamp;              // Unix timestamp (ms)
    double equity;
    double drawdown;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE(EquityPoint, timestamp, equity, drawdown)
};

// =============================================================================
// Candle (OHLCV)
// =============================================================================

/**
 * OHLCV candle for K-line chart display
 *
 * TICKET_152: Added to BacktestResult for dual-chart UI
 */
struct Candle {
    int64_t timestamp;              // Unix timestamp (ms)
    double open;
    double high;
    double low;
    double close;
    double volume;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE(Candle,
        timestamp, open, high, low, close, volume)
};

// =============================================================================
// Performance Metrics
// =============================================================================

/**
 * Aggregated performance metrics
 */
struct PerformanceMetrics {
    // Returns
    double totalPnl = 0.0;
    double totalReturn = 0.0;        // Percentage
    double annualizedReturn = 0.0;
    double sharpeRatio = 0.0;
    double sortinoRatio = 0.0;
    double calmarRatio = 0.0;

    // Drawdown
    double maxDrawdown = 0.0;
    double maxDrawdownDuration = 0;  // Days

    // Trade statistics
    int totalTrades = 0;
    int winningTrades = 0;
    int losingTrades = 0;
    double winRate = 0.0;
    double averageWin = 0.0;
    double averageLoss = 0.0;
    double profitFactor = 0.0;
    double expectancy = 0.0;

    // Risk metrics
    double volatility = 0.0;
    double valueAtRisk95 = 0.0;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE(PerformanceMetrics,
        totalPnl, totalReturn, annualizedReturn, sharpeRatio, sortinoRatio,
        calmarRatio, maxDrawdown, maxDrawdownDuration, totalTrades,
        winningTrades, losingTrades, winRate, averageWin, averageLoss,
        profitFactor, expectancy, volatility, valueAtRisk95)
};

// =============================================================================
// TICKET_398: Dry Run Info
// =============================================================================

/**
 * Single LLM call source info for dry run estimation
 */
struct LlmCallInfo {
    std::string label;
    int count = 0;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(LlmCallInfo, label, count)
};

/**
 * Dry run result containing LLM call estimates
 */
struct DryRunInfo {
    bool isDryRun = false;
    int totalBars = 0;
    int totalLlmCalls = 0;
    std::vector<LlmCallInfo> llmCalls;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(DryRunInfo,
        isDryRun, totalBars, totalLlmCalls, llmCalls)
};

// =============================================================================
// Backtest Result
// =============================================================================

/**
 * Complete backtest result
 *
 * This is written to result.json in the output directory.
 */
struct BacktestResult {
    // Status
    bool success = false;
    std::string errorMessage;

    // Timing
    int64_t startTime = 0;           // Backtest period start
    int64_t endTime = 0;             // Backtest period end
    int64_t executionTimeMs = 0;     // Wall clock time
    uint64_t executionCycles = 0;    // TICKET_473: RDTSC cycle count

    // Metrics
    PerformanceMetrics metrics;

    // Equity curve (sampled)
    std::vector<EquityPoint> equityCurve;

    // Trade history
    std::vector<Trade> trades;

    // OHLCV candles for K-line chart (TICKET_152)
    std::vector<Candle> candles;

    // TICKET_398: Dry run LLM call estimation info
    DryRunInfo dryRunInfo;

    /**
     * Save to JSON file
     */
    void SaveToFile(const std::string& path) const;

    /**
     * Convert to JSON string
     */
    std::string ToJson() const;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(BacktestResult,
        success, errorMessage, startTime, endTime, executionTimeMs, executionCycles,
        metrics, equityCurve, trades, candles, dryRunInfo)
};

// =============================================================================
// TICKET_1361 P2: Corrective layer increment PODs
// =============================================================================

inline constexpr std::size_t kPopFeatureCountV1 = 14;

struct CandidateIncrement {
    std::uint64_t candidateId = 0;
    std::uint64_t asOfTimestampNs = 0;
    std::uint32_t symbolId = 0;
    std::string   side;
    double        proposedSize = 0.0;
    double        finalSize = 0.0;
    std::array<float, kPopFeatureCountV1> featureVector{};
    std::uint32_t featureSchemaHash = 0;
    int           gateVerdict = 3;
    float         calibratedProbability = -1.0f;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(CandidateIncrement,
        candidateId, asOfTimestampNs, symbolId, side,
        proposedSize, finalSize, featureVector, featureSchemaHash,
        gateVerdict, calibratedProbability)
};

struct OutcomeIncrement {
    std::uint64_t candidateId = 0;
    int           outcomeType = 0;
    std::uint64_t entryTimestampNs = 0;
    std::uint64_t exitTimestampNs = 0;
    std::uint32_t holdingIntervalBars = 0;
    double        grossPnl = 0.0;
    double        commission = 0.0;
    double        slippage = 0.0;
    double        netPnl = 0.0;
    int           completionStatus = 0;
    int           profitLabel = -1;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(OutcomeIncrement,
        candidateId, outcomeType, entryTimestampNs, exitTimestampNs,
        holdingIntervalBars, grossPnl, commission, slippage, netPnl,
        completionStatus, profitLabel)
};

// =============================================================================
// Incremental Result (TICKET_154: Realtime Chart Update)
// =============================================================================

struct IncrementalResult {
    std::vector<Candle> newCandles;
    std::vector<Trade> newTrades;
    std::vector<EquityPoint> newEquityPoints;
    PerformanceMetrics currentMetrics;
    int processedBars = 0;
    int totalBars = 0;

    std::vector<CandidateIncrement> newCandidates;
    std::vector<OutcomeIncrement> newOutcomes;

    std::string ToJson() const {
        nlohmann::json j;
        j["newCandles"] = newCandles;
        j["newTrades"] = newTrades;
        j["newEquityPoints"] = newEquityPoints;
        j["currentMetrics"] = currentMetrics;
        j["processedBars"] = processedBars;
        j["totalBars"] = totalBars;
        j["newCandidates"] = newCandidates;
        j["newOutcomes"] = newOutcomes;
        return j.dump();
    }

    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(IncrementalResult,
        newCandles, newTrades, newEquityPoints, currentMetrics,
        processedBars, totalBars, newCandidates, newOutcomes)
};

// =============================================================================
// Increment Callback (TICKET_154)
// =============================================================================

/**
 * Callback for incremental result updates during backtest execution
 *
 * TICKET_154: Enables realtime chart updates during backtest.
 */
using IncrementCallback = std::function<void(const IncrementalResult&)>;

} // namespace StratCraft::executor
