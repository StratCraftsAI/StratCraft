/**
 * @file branch_hints.hpp
 * @brief Branch Prediction Hints for StratCraft Executor
 *
 * Macros to help CPU branch predictor optimize hot paths.
 * Mispredict penalty: ~15-20 cycles on modern CPUs.
 *
 * Usage:
 * - QNX_LIKELY: Condition is almost always true
 * - QNX_UNLIKELY: Condition is almost always false (error paths)
 * - QNX_ASSUME: Tell compiler a condition is always true
 * - QNX_UNREACHABLE: Mark code path as unreachable
 *
 * Guidelines:
 * - Use sparingly, only in hot paths
 * - Profile to verify branch is actually biased (>90%)
 * - Wrong hints are worse than no hints
 *
 * Reference: Quill Optimization Research
 */

#pragma once

#include <cstdlib>

namespace StratCraft::benchmark {

// ============================================================================
// Branch Prediction Macros
// ============================================================================

/// Hint that condition is likely true (hot path)
/// Use for: normal operation, success cases, common values
#if defined(__GNUC__) || defined(__clang__)
    #define QNX_LIKELY(x)   __builtin_expect(!!(x), 1)
#else
    #define QNX_LIKELY(x)   (x)
#endif

/// Hint that condition is unlikely true (cold path)
/// Use for: error handling, edge cases, rare conditions
#if defined(__GNUC__) || defined(__clang__)
    #define QNX_UNLIKELY(x) __builtin_expect(!!(x), 0)
#else
    #define QNX_UNLIKELY(x) (x)
#endif

// ============================================================================
// Compiler Assumptions
// ============================================================================

/// Tell compiler to assume condition is always true
/// WARNING: Undefined behavior if condition is false!
#if defined(__clang__)
    #define QNX_ASSUME(x) __builtin_assume(x)
#elif defined(__GNUC__) && __GNUC__ >= 13
    #define QNX_ASSUME(x) __attribute__((assume(x)))
#elif defined(_MSC_VER)
    #define QNX_ASSUME(x) __assume(x)
#else
    #define QNX_ASSUME(x) do { if (!(x)) __builtin_unreachable(); } while(0)
#endif

/// Mark code as unreachable (allows compiler to optimize)
#if defined(__GNUC__) || defined(__clang__)
    #define QNX_UNREACHABLE() __builtin_unreachable()
#elif defined(_MSC_VER)
    #define QNX_UNREACHABLE() __assume(0)
#else
    #define QNX_UNREACHABLE() std::abort()
#endif

// ============================================================================
// Function Attributes
// ============================================================================

/// Mark function as hot (frequently called, optimize aggressively)
#if defined(__GNUC__) || defined(__clang__)
    #define QNX_HOT __attribute__((hot))
#else
    #define QNX_HOT
#endif

/// Mark function as cold (rarely called, optimize for size)
#if defined(__GNUC__) || defined(__clang__)
    #define QNX_COLD __attribute__((cold))
#else
    #define QNX_COLD
#endif

/// Force function to be inlined
#if defined(__GNUC__) || defined(__clang__)
    #define QNX_FORCE_INLINE __attribute__((always_inline)) inline
#elif defined(_MSC_VER)
    #define QNX_FORCE_INLINE __forceinline
#else
    #define QNX_FORCE_INLINE inline
#endif

/// Prevent function from being inlined
#if defined(__GNUC__) || defined(__clang__)
    #define QNX_NOINLINE __attribute__((noinline))
#elif defined(_MSC_VER)
    #define QNX_NOINLINE __declspec(noinline)
#else
    #define QNX_NOINLINE
#endif

/// Mark function as pure (no side effects, only depends on args)
#if defined(__GNUC__) || defined(__clang__)
    #define QNX_PURE __attribute__((pure))
#else
    #define QNX_PURE
#endif

/// Mark function as const (pure + doesn't read global memory)
#if defined(__GNUC__) || defined(__clang__)
    #define QNX_CONST __attribute__((const))
#else
    #define QNX_CONST
#endif

// ============================================================================
// Loop Optimization Hints
// ============================================================================

/// Hint that loop will iterate many times
#if defined(__clang__)
    #define QNX_LOOP_VECTORIZE _Pragma("clang loop vectorize(enable)")
#elif defined(__GNUC__)
    #define QNX_LOOP_VECTORIZE _Pragma("GCC ivdep")
#else
    #define QNX_LOOP_VECTORIZE
#endif

/// Hint that loop iterations are independent
#if defined(__clang__)
    #define QNX_LOOP_INDEPENDENT _Pragma("clang loop vectorize(assume_safety)")
#elif defined(__GNUC__)
    #define QNX_LOOP_INDEPENDENT _Pragma("GCC ivdep")
#else
    #define QNX_LOOP_INDEPENDENT
#endif

/// Unroll loop N times
#if defined(__clang__)
    #define QNX_LOOP_UNROLL(n) _Pragma("clang loop unroll_count(" #n ")")
#elif defined(__GNUC__) && __GNUC__ >= 8
    #define QNX_LOOP_UNROLL(n) _Pragma("GCC unroll " #n)
#else
    #define QNX_LOOP_UNROLL(n)
#endif

// ============================================================================
// Memory Alignment Hints
// ============================================================================

/// Hint that pointer is aligned to N bytes
#if defined(__GNUC__) || defined(__clang__)
    #define QNX_ASSUME_ALIGNED(ptr, n) __builtin_assume_aligned((ptr), (n))
#else
    #define QNX_ASSUME_ALIGNED(ptr, n) (ptr)
#endif

// ============================================================================
// Restrict Pointer (no aliasing)
// ============================================================================

#if defined(__GNUC__) || defined(__clang__)
    #define QNX_RESTRICT __restrict__
#elif defined(_MSC_VER)
    #define QNX_RESTRICT __restrict
#else
    #define QNX_RESTRICT
#endif

// ============================================================================
// Common Patterns with Hints
// ============================================================================

/// Check for null pointer (cold path)
#define QNX_CHECK_NULL(ptr) \
    if (QNX_UNLIKELY((ptr) == nullptr))

/// Check for error (cold path)
#define QNX_CHECK_ERROR(cond) \
    if (QNX_UNLIKELY(cond))

/// Check for success (hot path)
#define QNX_CHECK_SUCCESS(cond) \
    if (QNX_LIKELY(cond))

/// Assert that should be optimized away in release
#define QNX_ASSERT(cond) \
    do { \
        if (QNX_UNLIKELY(!(cond))) { \
            QNX_UNREACHABLE(); \
        } \
    } while(0)

} // namespace StratCraft::benchmark

/*
Example Usage Patterns
======================

Example 1: Error handling (unlikely path)
-----------------------------------------
if (QNX_UNLIKELY(result < 0)) {
    return handle_error(result);  // Cold path
}
process_success(result);  // Hot path

Example 2: Common case optimization
-----------------------------------
if (QNX_LIKELY(order_type == OrderType::Market)) {
    handle_market_order();  // 90% of orders
} else if (QNX_UNLIKELY(order_type == OrderType::Stop)) {
    handle_stop_order();     // Rare
}

Example 3: Hot function
-----------------------
QNX_HOT QNX_FORCE_INLINE
void process_tick(const Tick& tick) {
    // Critical path code
}

Example 4: Vectorizable loop
----------------------------
QNX_LOOP_VECTORIZE
for (size_t i = 0; i < len; ++i) {
    sum += prices[i];
}
*/
