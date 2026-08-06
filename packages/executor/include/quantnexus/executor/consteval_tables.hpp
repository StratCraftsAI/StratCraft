/**
 * Consteval Tables - Compile-Time Lookup Tables
 *
 * TICKET_470 Phase 3.3: Compile-time tables eliminating runtime branches
 *
 * Provides constexpr/consteval lookup tables for:
 * - Interval to seconds conversion (1m -> 60, 1h -> 3600, etc.)
 * - Data source type validation
 * - Common trading constants
 *
 * Source pattern: NexusFIX 22 consteval tables eliminating 300+ runtime branches
 *
 * modernc_quant.md references:
 * - #1 consteval: Compile-time computation
 * - #5 NTTP: Non-type template parameters
 * - #34 consteval hardcoded limits
 */

#pragma once

#include <cstdint>
#include <cstddef>
#include <string_view>
#include <array>
#include <algorithm>

namespace StratCraft::executor::tables {

// =============================================================================
// Interval Lookup Table
// =============================================================================

/**
 * Compile-time interval-to-seconds mapping
 *
 * Replaces runtime switch/if-else chains for interval parsing.
 * O(1) lookup for known intervals, O(n) scan for custom intervals.
 */
struct IntervalEntry {
    std::string_view name;
    int64_t seconds;
};

inline constexpr std::array<IntervalEntry, 12> INTERVAL_TABLE = {{
    {"1s",  1},
    {"5s",  5},
    {"10s", 10},
    {"30s", 30},
    {"1m",  60},
    {"5m",  300},
    {"15m", 900},
    {"30m", 1800},
    {"1h",  3600},
    {"4h",  14400},
    {"1d",  86400},
    {"1w",  604800},
}};

/**
 * Convert interval string to seconds (constexpr)
 *
 * @param interval Interval string (e.g., "1m", "1h", "1d")
 * @return Seconds, or 0 if unknown
 */
[[nodiscard]] constexpr int64_t interval_to_seconds(std::string_view interval) noexcept {
    for (const auto& entry : INTERVAL_TABLE) {
        if (entry.name == interval) {
            return entry.seconds;
        }
    }
    return 0;  // Unknown interval
}

/**
 * Check if interval is valid (constexpr)
 */
[[nodiscard]] constexpr bool is_valid_interval(std::string_view interval) noexcept {
    return interval_to_seconds(interval) > 0;
}

/**
 * Get number of bars in a time range for given interval (constexpr)
 */
[[nodiscard]] constexpr int64_t bars_in_range(
    int64_t start_epoch,
    int64_t end_epoch,
    std::string_view interval
) noexcept {
    int64_t secs = interval_to_seconds(interval);
    if (secs == 0) return 0;
    return (end_epoch - start_epoch) / secs;
}

// =============================================================================
// Time Unit Constants Table
// =============================================================================

/**
 * Compile-time time unit conversion
 */
struct TimeUnit {
    std::string_view name;
    int64_t seconds;
    int64_t milliseconds;
};

inline constexpr std::array<TimeUnit, 5> TIME_UNITS = {{
    {"second", 1,       1000},
    {"minute", 60,      60000},
    {"hour",   3600,    3600000},
    {"day",    86400,   86400000},
    {"week",   604800,  604800000},
}};

// =============================================================================
// Data Source Type Table
// =============================================================================

struct DataSourceEntry {
    std::string_view type_id;
    std::string_view display_name;
};

inline constexpr std::array<DataSourceEntry, 3> DATA_SOURCE_TABLE = {{
    {"mock",    "MockDataSource"},
    {"parquet", "ParquetDataSource"},
    {"csv",     "CsvDataSource"},
}};

/**
 * Check if data source type is valid (constexpr)
 */
[[nodiscard]] constexpr bool is_valid_data_source(std::string_view type) noexcept {
    for (const auto& entry : DATA_SOURCE_TABLE) {
        if (entry.type_id == type) return true;
    }
    return false;
}

/**
 * Get display name for data source type (constexpr)
 */
[[nodiscard]] constexpr std::string_view data_source_display_name(std::string_view type) noexcept {
    for (const auto& entry : DATA_SOURCE_TABLE) {
        if (entry.type_id == type) return entry.display_name;
    }
    return "Unknown";
}

// =============================================================================
// Order Side Table
// =============================================================================

enum class Side : uint8_t {
    Buy = 0,
    Sell = 1,
};

struct SideEntry {
    std::string_view name;
    Side side;
    int sign;  // +1 for buy, -1 for sell
};

inline constexpr std::array<SideEntry, 4> SIDE_TABLE = {{
    {"buy",  Side::Buy,  +1},
    {"BUY",  Side::Buy,  +1},
    {"sell", Side::Sell, -1},
    {"SELL", Side::Sell, -1},
}};

[[nodiscard]] constexpr int side_sign(std::string_view side_str) noexcept {
    for (const auto& entry : SIDE_TABLE) {
        if (entry.name == side_str) return entry.sign;
    }
    return 0;
}

// =============================================================================
// Indicator Period Validation (consteval)
// =============================================================================

/**
 * Compile-time indicator period validation
 *
 * Prevents invalid indicator configuration at compile time.
 */
consteval bool validate_sma_period(int period) {
    if (period < 1 || period > 500) {
        throw "SMA period must be between 1 and 500";
    }
    return true;
}

consteval bool validate_ema_period(int period) {
    if (period < 1 || period > 500) {
        throw "EMA period must be between 1 and 500";
    }
    return true;
}

consteval bool validate_rsi_period(int period) {
    if (period < 2 || period > 100) {
        throw "RSI period must be between 2 and 100";
    }
    return true;
}

// =============================================================================
// Static Assertions (compile-time correctness verification)
// =============================================================================

static_assert(interval_to_seconds("1m") == 60, "1m should be 60 seconds");
static_assert(interval_to_seconds("1h") == 3600, "1h should be 3600 seconds");
static_assert(interval_to_seconds("1d") == 86400, "1d should be 86400 seconds");
static_assert(is_valid_interval("5m"), "5m should be valid");
static_assert(!is_valid_interval("2x"), "2x should be invalid");
static_assert(is_valid_data_source("parquet"), "parquet should be valid");
static_assert(!is_valid_data_source("unknown"), "unknown should be invalid");
static_assert(bars_in_range(0, 3600, "1m") == 60, "1 hour of 1m bars = 60");
static_assert(side_sign("buy") == +1, "buy should be +1");
static_assert(side_sign("sell") == -1, "sell should be -1");

} // namespace StratCraft::executor::tables
