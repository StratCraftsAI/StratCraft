/**
 * C++20 Module Interface Unit
 *
 * TICKET_175 Phase 10: C++20 Modules
 *
 * This file defines the module interface for StratCraft.executor
 * When C++20 modules are fully supported by the build system,
 * this replaces the traditional header includes.
 *
 * Build with: -fmodules-ts -std=c++23
 *
 * modernc_quant.md references:
 * - #100 C++20 Modules
 *
 * NOTE: This is a preparatory file. Full module migration requires
 * CMake 3.28+ with CMAKE_CXX_MODULE_STD=ON and compatible compilers.
 */

module;

// Global module fragment - include standard library headers
#include <cstdint>
#include <cstddef>
#include <span>
#include <vector>
#include <string>
#include <string_view>
#include <optional>
#include <expected>
#include <memory>
#include <functional>
#include <atomic>
#include <coroutine>

export module StratCraft.executor;

// =============================================================================
// Export Module Partitions (Future)
// =============================================================================

// export import :types;
// export import :data_source;
// export import :config;
// export import :result;
// export import :simd;
// export import :lockfree;
// export import :coroutine;
// export import :parallel;

// =============================================================================
// Inline Namespace for ABI Versioning
// =============================================================================

export namespace StratCraft::executor::inline v1 {

// =============================================================================
// Strong Types (from types.hpp)
// =============================================================================

/**
 * Price - monetary value per unit
 */
class Price {
public:
    constexpr Price() noexcept = default;
    constexpr explicit Price(double value) noexcept : value_(value) {}
    [[nodiscard]] constexpr double value() const noexcept { return value_; }
private:
    double value_ = 0.0;
};

/**
 * Volume - trading volume
 */
class Volume {
public:
    constexpr Volume() noexcept = default;
    constexpr explicit Volume(double value) noexcept : value_(value) {}
    [[nodiscard]] constexpr double value() const noexcept { return value_; }
private:
    double value_ = 0.0;
};

/**
 * Timestamp - milliseconds since epoch
 */
class Timestamp {
public:
    constexpr Timestamp() noexcept = default;
    constexpr explicit Timestamp(int64_t value) noexcept : value_(value) {}
    [[nodiscard]] constexpr int64_t value() const noexcept { return value_; }
private:
    int64_t value_ = 0;
};

// =============================================================================
// Data Structures
// =============================================================================

/**
 * OHLCV Bar
 */
struct OHLCVBar {
    int64_t timestamp;
    double open;
    double high;
    double low;
    double close;
    double volume;
};

/**
 * DataFrame - columnar market data
 */
class DataFrame {
public:
    std::string symbol;
    std::string interval;
    std::vector<int64_t> timestamps;
    std::vector<double> open;
    std::vector<double> high;
    std::vector<double> low;
    std::vector<double> close;
    std::vector<double> volume;

    [[nodiscard]] size_t size() const noexcept { return timestamps.size(); }
    [[nodiscard]] bool empty() const noexcept { return timestamps.empty(); }

    void reserve(size_t n) {
        timestamps.reserve(n);
        open.reserve(n);
        high.reserve(n);
        low.reserve(n);
        close.reserve(n);
        volume.reserve(n);
    }

    [[nodiscard]] std::span<const double> closeView() const noexcept {
        return std::span<const double>(close);
    }
};

// =============================================================================
// Error Handling
// =============================================================================

enum class ErrorCode : uint32_t {
    Ok = 0,
    DataFileNotFound = 100,
    DataEmpty = 103,
    ConfigParseError = 201,
    StrategyFileNotFound = 300,
    PythonRuntimeError = 402,
};

struct Error {
    ErrorCode code;
    std::string message;
};

template<typename T>
using Expected = std::expected<T, Error>;

// =============================================================================
// Backtest Results
// =============================================================================

struct BacktestMetrics {
    double totalPnl = 0.0;
    double totalReturn = 0.0;
    double sharpeRatio = 0.0;
    double maxDrawdown = 0.0;
    double winRate = 0.0;
    int totalTrades = 0;
};

struct BacktestResult {
    bool success = false;
    std::string errorMessage;
    BacktestMetrics metrics;
    int64_t executionTimeMs = 0;
};

// =============================================================================
// Executor Interface
// =============================================================================

/**
 * Progress callback type
 */
using ProgressCallback = std::function<void(double percent, const std::string& message)>;

/**
 * Executor configuration
 */
struct ExecutorConfig {
    std::string strategyPath;
    std::string outputDir;
    std::string dataPath;
    std::string symbol;
    std::string interval;
    int64_t startTime = 0;
    int64_t endTime = 0;
};

} // namespace StratCraft::executor::inline v1

// =============================================================================
// Module Implementation Notes
// =============================================================================

/*
 * Migration Plan:
 *
 * 1. Keep existing headers for backward compatibility
 * 2. This module file imports and re-exports from headers
 * 3. New code can use: import StratCraft.executor;
 * 4. Old code continues using: #include <quantnexus/executor/xxx.hpp>
 *
 * Build System Requirements:
 * - CMake 3.28+ with CXX_MODULE_STD
 * - GCC 14+ / Clang 18+ / MSVC 19.34+
 * - Ninja generator recommended for module dependency scanning
 *
 * Example CMakeLists.txt:
 *   target_sources(StratCraft_executor
 *       PUBLIC FILE_SET CXX_MODULES FILES
 *       include/quantnexus/executor/executor.cppm
 *   )
 */
