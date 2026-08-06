/**
 * Ranges Utilities - Lazy Data Transforms for Quantitative Analysis
 *
 * TICKET_470 Phase 1.3: std::ranges-based zero-allocation data transforms
 *
 * Provides lazy views for common quant operations:
 * - returns: log or simple returns from price series
 * - pct_change: percentage change between adjacent elements
 * - normalize: z-score normalization
 * - window: sliding window view
 * - cumsum: cumulative sum (materialized)
 *
 * All views are lazy (zero allocation) unless explicitly materialized.
 *
 * modernc_quant.md references:
 * - #42 std::ranges: Lazy pipelines
 * - #40 std::span: Zero-copy input
 */

#pragma once

#include <ranges>
#include <span>
#include <cmath>
#include <vector>
#include <numeric>
#include <algorithm>
#include <cstddef>

namespace StratCraft::executor::ranges {

// =============================================================================
// Simple Returns View
// =============================================================================

/**
 * Compute simple returns: (p[i] - p[i-1]) / p[i-1]
 *
 * Returns a lazy view with n-1 elements (first element has no predecessor).
 * Zero allocation.
 *
 * Usage:
 *   auto rets = ranges::simple_returns(df.closeView());
 *   for (double r : rets) { ... }
 */
[[nodiscard]] inline auto simple_returns(std::span<const double> prices) noexcept {
    return std::views::iota(size_t{1}, prices.size())
         | std::views::transform([prices](size_t i) noexcept -> double {
               return (prices[i] - prices[i - 1]) / prices[i - 1];
           });
}

// =============================================================================
// Log Returns View
// =============================================================================

/**
 * Compute log returns: ln(p[i] / p[i-1])
 *
 * Preferred for multi-period aggregation (additive property).
 * Zero allocation.
 */
[[nodiscard]] inline auto log_returns(std::span<const double> prices) noexcept {
    return std::views::iota(size_t{1}, prices.size())
         | std::views::transform([prices](size_t i) noexcept -> double {
               return std::log(prices[i] / prices[i - 1]);
           });
}

// =============================================================================
// Percentage Change View
// =============================================================================

/**
 * Compute percentage change: (p[i] - p[i-1]) / p[i-1] * 100
 * Zero allocation.
 */
[[nodiscard]] inline auto pct_change(std::span<const double> data) noexcept {
    return std::views::iota(size_t{1}, data.size())
         | std::views::transform([data](size_t i) noexcept -> double {
               return (data[i] - data[i - 1]) / data[i - 1] * 100.0;
           });
}

// =============================================================================
// Diff View
// =============================================================================

/**
 * First difference: d[i] = data[i] - data[i-1]
 * Zero allocation.
 */
[[nodiscard]] inline auto diff(std::span<const double> data) noexcept {
    return std::views::iota(size_t{1}, data.size())
         | std::views::transform([data](size_t i) noexcept -> double {
               return data[i] - data[i - 1];
           });
}

// =============================================================================
// Cumulative Sum (Materialized)
// =============================================================================

/**
 * Cumulative sum: out[i] = sum(data[0..i])
 *
 * Materialized (allocates) because cumsum has data dependency chain.
 */
[[nodiscard]] inline std::vector<double> cumsum(std::span<const double> data) {
    std::vector<double> result(data.size());
    if (!data.empty()) {
        std::partial_sum(data.begin(), data.end(), result.begin());
    }
    return result;
}

// =============================================================================
// Rolling Window View
// =============================================================================

/**
 * Sliding window of fixed size over data.
 *
 * Returns a range of std::span<const double> windows.
 * Zero allocation.
 *
 * Usage:
 *   for (auto window : ranges::sliding_window(prices, 20)) {
 *       double avg = simd::sum(window) / window.size();
 *   }
 */
[[nodiscard]] inline auto sliding_window(
    std::span<const double> data,
    size_t window_size
) noexcept {
    const size_t count = (data.size() >= window_size) ? (data.size() - window_size + 1) : 0;
    return std::views::iota(size_t{0}, count)
         | std::views::transform([data, window_size](size_t i) noexcept -> std::span<const double> {
               return data.subspan(i, window_size);
           });
}

// =============================================================================
// Scale / Normalize View
// =============================================================================

/**
 * Scale data to [0, 1] range (min-max normalization).
 * Zero allocation.
 *
 * @param min_val Pre-computed minimum value
 * @param max_val Pre-computed maximum value
 */
[[nodiscard]] inline auto scale(
    std::span<const double> data,
    double min_val,
    double max_val
) noexcept {
    const double range = (max_val - min_val != 0.0) ? (max_val - min_val) : 1.0;
    return data
         | std::views::transform([min_val, range](double x) noexcept -> double {
               return (x - min_val) / range;
           });
}

// =============================================================================
// Materialize Helper
// =============================================================================

/**
 * Materialize any range into std::vector<double>
 *
 * Usage:
 *   auto rets_vec = ranges::materialize(ranges::simple_returns(prices));
 */
template<std::ranges::range R>
[[nodiscard]] inline std::vector<double> materialize(R&& range) {
    std::vector<double> result;
    if constexpr (std::ranges::sized_range<R>) {
        result.reserve(std::ranges::size(range));
    }
    for (auto&& val : range) {
        result.push_back(static_cast<double>(val));
    }
    return result;
}

} // namespace StratCraft::executor::ranges
