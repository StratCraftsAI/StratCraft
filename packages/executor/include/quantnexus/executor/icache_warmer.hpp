/**
 * I-Cache Warmup - Pre-warm Instruction Cache Before Execution
 *
 * TICKET_473_7: Reduce first-iteration latency by 30-50%
 *
 * Provides:
 * - warm_icache(): execute a callable N times to populate instruction cache
 * - atomic_signal_fence to prevent compiler from optimizing away warmup calls
 * - WarmupStats: timing statistics for warmup iterations
 *
 * Adapted for StratCraft: warm indicator calculations, data loading,
 * PnL computation paths before real backtest execution.
 *
 * Usage:
 *   // Warm up indicator calculation path
 *   auto stats = warm_icache([&]() {
 *       calculate_sma(dummy_data, period);
 *       calculate_rsi(dummy_data, period);
 *   });
 *
 *   // Warm up with custom iteration count
 *   auto stats = warm_icache(my_func, 500);
 *
 */

#pragma once

#include "rdtsc.hpp"

#include <atomic>
#include <cstddef>
#include <cstdint>

namespace StratCraft::executor {

// =============================================================================
// Warmup Statistics
// =============================================================================

/**
 * Statistics from an I-cache warmup pass.
 */
struct WarmupStats {
    size_t iterations{0};       // Number of warmup iterations executed
    uint64_t total_cycles{0};   // Total RDTSC cycles for all iterations
    uint64_t min_cycles{0};     // Minimum cycle count for a single iteration
    uint64_t max_cycles{0};     // Maximum cycle count for a single iteration

    /// Average cycles per iteration
    [[nodiscard]] double avg_cycles() const noexcept {
        return iterations > 0
            ? static_cast<double>(total_cycles) / static_cast<double>(iterations)
            : 0.0;
    }

    /// Average nanoseconds per iteration (requires CPU frequency)
    [[nodiscard]] double avg_ns(double freq_ghz) const noexcept {
        return bench::cycles_to_ns(
            static_cast<uint64_t>(avg_cycles()), freq_ghz);
    }
};

// =============================================================================
// I-Cache Warmup
// =============================================================================

/**
 * Default warmup iteration count (full L1 i-cache warmup).
 * 1000 iterations is sufficient to fully populate L1 instruction cache
 * for typical indicator/strategy code paths.
 *
 * NOTE: LIGHT_WARMUP_ITERATIONS (100) is used by warm_icache_light()
 * for non-critical paths (L2/L3 only, not full L1).
 */
inline constexpr size_t DEFAULT_WARMUP_ITERATIONS = 1000;

/// Light warmup iteration count for non-critical paths (L2/L3 only)
inline constexpr size_t LIGHT_WARMUP_ITERATIONS = 100;

/**
 * Warm the instruction cache by executing a callable multiple times.
 *
 * Uses atomic_signal_fence to prevent the compiler from:
 * - Optimizing away the warmup calls
 * - Reordering warmup calls with real execution
 * - Hoisting invariant computations out of the loop
 *
 * @tparam Func Callable type (lambda, function pointer, etc.)
 * @param func The function to warm up
 * @param iterations Number of warmup iterations (default: 1000)
 * @return WarmupStats with timing information
 */
template<typename Func>
[[nodiscard]] WarmupStats warm_icache(Func&& func, size_t iterations = DEFAULT_WARMUP_ITERATIONS) noexcept {
    WarmupStats stats;
    stats.iterations = iterations;
    stats.min_cycles = UINT64_MAX;
    stats.max_cycles = 0;
    stats.total_cycles = 0;

    for (size_t i = 0; i < iterations; ++i) {
        // Prevent compiler from optimizing away the call
        std::atomic_signal_fence(std::memory_order_seq_cst);

        uint64_t start = bench::rdtsc_vm_safe();

        func();

        uint64_t end = bench::rdtsc_vm_safe();

        // Prevent compiler from reordering past the measurement
        std::atomic_signal_fence(std::memory_order_seq_cst);

        uint64_t elapsed = end - start;
        stats.total_cycles += elapsed;

        if (elapsed < stats.min_cycles) stats.min_cycles = elapsed;
        if (elapsed > stats.max_cycles) stats.max_cycles = elapsed;
    }

    return stats;
}

/**
 * Warm up multiple code paths in sequence.
 *
 * Convenience wrapper that warms each callable independently
 * and returns an array of stats.
 *
 * @tparam Funcs Callable types
 * @param iterations Warmup iterations per function
 * @param funcs Functions to warm up
 */
template<typename... Funcs>
void warm_icache_all(size_t iterations, Funcs&&... funcs) noexcept {
    (warm_icache(std::forward<Funcs>(funcs), iterations), ...);
}

/**
 * Light warmup: fewer iterations, suitable for non-critical paths.
 * 100 iterations to bring code into L2/L3 without full L1 warmth.
 */
template<typename Func>
[[nodiscard]] WarmupStats warm_icache_light(Func&& func) noexcept {
    return warm_icache(std::forward<Func>(func), LIGHT_WARMUP_ITERATIONS);
}

} // namespace StratCraft::executor
