/**
 * Concepts - Compile-time Interface Constraints
 *
 * TICKET_470 Phase 1.4: C++20 concepts for interface constraints
 *
 * Provides compile-time constraints for:
 * - DataSource: loadData + getName contract
 * - ExecutorPlugin: execute + cancel + progress contract
 * - Numeric: arithmetic operations on data
 * - DataFrame-like: columnar data access
 *
 * modernc_quant.md references:
 * - #8 Concepts for strategy constraints
 * - #32 Strong type concept (defined in types.hpp)
 */

#pragma once

#include <concepts>
#include <string>
#include <string_view>
#include <span>
#include <type_traits>
#include <cstdint>

namespace StratCraft::executor::concepts {

// =============================================================================
// Numeric Concepts
// =============================================================================

/**
 * Arithmetic type suitable for financial calculations
 */
template<typename T>
concept Numeric = std::is_arithmetic_v<T>;

/**
 * Floating-point type for price/indicator calculations
 */
template<typename T>
concept FloatingPoint = std::floating_point<T>;

// =============================================================================
// Data Source Concept
// =============================================================================

/**
 * Constraint for data source implementations
 *
 * Any type satisfying DataSourceLike can be used where IDataSource is expected.
 * Enables compile-time validation of data source implementations.
 *
 * Required interface:
 * - loadData(config) -> DataFrame-like
 * - getName() -> string-like
 */
template<typename T>
concept DataSourceLike = requires(T source) {
    { source.getName() } -> std::convertible_to<std::string>;
};

// =============================================================================
// Executor Plugin Concept
// =============================================================================

/**
 * Constraint for executor plugin implementations
 *
 * Required interface:
 * - name() -> string_view
 * - version() -> string_view
 * - cancel() noexcept
 * - cancelled() -> bool
 * - progress() -> float
 */
template<typename T>
concept ExecutorPluginLike = requires(T plugin) {
    { plugin.name() } -> std::convertible_to<std::string_view>;
    { plugin.version() } -> std::convertible_to<std::string_view>;
    { plugin.cancel() } noexcept;
    { plugin.cancelled() } -> std::same_as<bool>;
    { plugin.progress() } -> std::convertible_to<float>;
};

// =============================================================================
// Columnar Data Concept
// =============================================================================

/**
 * Constraint for columnar data structures (DataFrame-like)
 *
 * Required interface:
 * - size() -> size_t
 * - empty() -> bool
 * - closeView() -> span<const double>
 */
template<typename T>
concept ColumnarData = requires(const T data) {
    { data.size() } -> std::convertible_to<size_t>;
    { data.empty() } -> std::same_as<bool>;
    { data.closeView() } -> std::convertible_to<std::span<const double>>;
};

// =============================================================================
// Indicator Concept
// =============================================================================

/**
 * Constraint for indicator calculation functions
 *
 * An indicator takes a span of doubles and returns a double.
 */
template<typename F>
concept IndicatorFunc = requires(F func, std::span<const double> data) {
    { func(data) } -> std::convertible_to<double>;
};

// =============================================================================
// Progress Reportable Concept
// =============================================================================

/**
 * Constraint for types that can report execution progress
 */
template<typename T>
concept ProgressReportable = requires(T obj) {
    { obj.progress() } -> std::convertible_to<float>;
};

// =============================================================================
// Cancellable Concept
// =============================================================================

/**
 * Constraint for types that support cooperative cancellation
 */
template<typename T>
concept Cancellable = requires(T obj) {
    { obj.cancel() } noexcept;
    { obj.cancelled() } -> std::same_as<bool>;
};

} // namespace StratCraft::executor::concepts
