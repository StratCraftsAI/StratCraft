/**
 * Error Types - Deterministic Error Handling
 *
 * TICKET_175 Phase 3: Execution Determinism
 *
 * Provides std::expected-based error handling for hot paths:
 * - No exceptions thrown on hot path (modernc_quant #26)
 * - Compile-time error type checking
 * - Zero-overhead error propagation
 *
 * Usage:
 *   Expected<DataFrame> result = loadData(config);
 *   if (!result) {
 *       log_error(result.error().message);
 *       return result.error();
 *   }
 *   auto& df = *result;
 */

#pragma once

#include <expected>
#include <string>
#include <string_view>
#include <source_location>
#include <format>

namespace StratCraft::executor {

// =============================================================================
// Error Codes (Compile-time enumerable)
// =============================================================================

enum class ErrorCode : uint32_t {
    // Success (not an error)
    Ok = 0,

    // Data errors (100-199)
    DataFileNotFound = 100,
    DataFileCorrupt = 101,
    DataColumnMissing = 102,
    DataEmpty = 103,
    DataInvalidRange = 104,
    DataTooLarge = 105,

    // Config errors (200-299)
    ConfigFileNotFound = 200,
    ConfigParseError = 201,
    ConfigInvalidValue = 202,
    ConfigMissingField = 203,

    // Strategy errors (300-399)
    StrategyFileNotFound = 300,
    StrategyLoadError = 301,
    StrategyExecutionError = 302,

    // Python errors (400-499)
    PythonInitFailed = 400,
    PythonImportError = 401,
    PythonRuntimeError = 402,

    // System errors (500-599)
    MemoryAllocationFailed = 500,
    IOError = 501,

    // Unknown
    Unknown = 999,
};

/**
 * Convert error code to string (constexpr for compile-time)
 */
[[nodiscard]] constexpr std::string_view error_code_name(ErrorCode code) noexcept {
    switch (code) {
        case ErrorCode::Ok: return "Ok";
        case ErrorCode::DataFileNotFound: return "DataFileNotFound";
        case ErrorCode::DataFileCorrupt: return "DataFileCorrupt";
        case ErrorCode::DataColumnMissing: return "DataColumnMissing";
        case ErrorCode::DataEmpty: return "DataEmpty";
        case ErrorCode::DataInvalidRange: return "DataInvalidRange";
        case ErrorCode::DataTooLarge: return "DataTooLarge";
        case ErrorCode::ConfigFileNotFound: return "ConfigFileNotFound";
        case ErrorCode::ConfigParseError: return "ConfigParseError";
        case ErrorCode::ConfigInvalidValue: return "ConfigInvalidValue";
        case ErrorCode::ConfigMissingField: return "ConfigMissingField";
        case ErrorCode::StrategyFileNotFound: return "StrategyFileNotFound";
        case ErrorCode::StrategyLoadError: return "StrategyLoadError";
        case ErrorCode::StrategyExecutionError: return "StrategyExecutionError";
        case ErrorCode::PythonInitFailed: return "PythonInitFailed";
        case ErrorCode::PythonImportError: return "PythonImportError";
        case ErrorCode::PythonRuntimeError: return "PythonRuntimeError";
        case ErrorCode::MemoryAllocationFailed: return "MemoryAllocationFailed";
        case ErrorCode::IOError: return "IOError";
        case ErrorCode::Unknown: return "Unknown";
        default: return "Unknown";
    }
}

// =============================================================================
// Error Type
// =============================================================================

/**
 * Error information with code, message, and source location
 * (modernc_quant #26: std::expected errors)
 */
struct Error {
    ErrorCode code;
    std::string message;
    std::source_location location;

    /**
     * Create error with code and message
     */
    Error(ErrorCode c, std::string msg,
          std::source_location loc = std::source_location::current()) noexcept
        : code(c)
        , message(std::move(msg))
        , location(loc)
    {}

    /**
     * Create error with code only (message auto-generated)
     */
    explicit Error(ErrorCode c,
                   std::source_location loc = std::source_location::current()) noexcept
        : code(c)
        , message(std::string(error_code_name(c)))
        , location(loc)
    {}

    /**
     * Get formatted error string
     */
    [[nodiscard]] std::string format() const {
        return std::format("[{}] {} ({}:{})",
            error_code_name(code),
            message,
            location.file_name(),
            location.line());
    }

    /**
     * Check if this is a specific error code
     */
    [[nodiscard]] bool is(ErrorCode c) const noexcept {
        return code == c;
    }
};

// =============================================================================
// Expected Type Alias
// =============================================================================

/**
 * Expected result type for functions that may fail
 *
 * Usage:
 *   Expected<int> divide(int a, int b) {
 *       if (b == 0) return std::unexpected(Error(ErrorCode::InvalidValue, "Division by zero"));
 *       return a / b;
 *   }
 */
template<typename T>
using Expected = std::expected<T, Error>;

/**
 * Unexpected error factory (shorthand)
 */
[[nodiscard]] inline std::unexpected<Error> make_error(
    ErrorCode code,
    std::string message,
    std::source_location loc = std::source_location::current()
) {
    return std::unexpected(Error(code, std::move(message), loc));
}

[[nodiscard]] inline std::unexpected<Error> make_error(
    ErrorCode code,
    std::source_location loc = std::source_location::current()
) {
    return std::unexpected(Error(code, loc));
}

// =============================================================================
// Error Propagation Macros
// =============================================================================

/**
 * TRY macro - propagate errors automatically
 *
 * Usage:
 *   Expected<DataFrame> loadAndProcess() {
 *       auto df = QNX_TRY(loadData(config));
 *       auto processed = QNX_TRY(processData(df));
 *       return processed;
 *   }
 */
#define QNX_TRY(expr) \
    ({ \
        auto&& _result = (expr); \
        if (!_result) [[unlikely]] { \
            return std::unexpected(_result.error()); \
        } \
        std::move(*_result); \
    })

/**
 * TRY_VOID macro - for void-returning functions
 */
#define QNX_TRY_VOID(expr) \
    do { \
        auto&& _result = (expr); \
        if (!_result) [[unlikely]] { \
            return std::unexpected(_result.error()); \
        } \
    } while (false)

// =============================================================================
// Result Checking Utilities
// =============================================================================

/**
 * Check if result is successful
 */
template<typename T>
[[nodiscard]] constexpr bool succeeded(const Expected<T>& result) noexcept {
    return result.has_value();
}

/**
 * Check if result is an error
 */
template<typename T>
[[nodiscard]] constexpr bool failed(const Expected<T>& result) noexcept {
    return !result.has_value();
}

/**
 * Get value or default
 */
template<typename T>
[[nodiscard]] constexpr T value_or(const Expected<T>& result, T default_value) noexcept {
    return result.value_or(std::move(default_value));
}

} // namespace StratCraft::executor
