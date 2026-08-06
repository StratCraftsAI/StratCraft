/**
 * @file prefetch.hpp
 * @brief Prefetch Utilities for StratCraft Executor
 *
 * Hardware prefetching hints for reduced cache misses.
 * Use before accessing data in hot loops.
 *
 * Prefetch distance should be tuned per platform:
 * - Intel Xeon: 16-32 iterations
 * - AMD EPYC: 8-16 iterations
 * - Apple M-series: 32-64 iterations
 *
 * Reference: Quill Optimization Research
 */

#pragma once

#include <cstddef>
#include <cstdint>

#include "hardware_constants.hpp"

namespace StratCraft::executor {

// TICKET_476: Hardware constants centralized in hardware_constants.hpp
using constants::CACHE_LINE_SIZE;
using constants::L1_CACHE_SIZE;
using constants::L2_CACHE_SIZE;

// ============================================================================
// Prefetch Locality Hints
// ============================================================================

/// Prefetch temporal locality hints
enum class PrefetchLocality {
    None = 0,    // NTA - Non-temporal, minimize cache pollution
    Low = 1,     // T2 - Low temporal locality (L3 cache)
    Medium = 2,  // T1 - Medium temporal locality (L2 cache)
    High = 3     // T0 - High temporal locality (L1 cache)
};

// ============================================================================
// Prefetch Functions
// ============================================================================

/// Prefetch for read with high locality (L1 cache)
/// Use this for data that will be read multiple times
inline void prefetch_read(const void* ptr) noexcept {
    __builtin_prefetch(ptr, 0, 3);  // read=0, locality=3 (L1)
}

/// Prefetch for read with low locality (minimize cache pollution)
/// Use for streaming data that won't be reused
inline void prefetch_read_nta(const void* ptr) noexcept {
    __builtin_prefetch(ptr, 0, 0);  // read=0, locality=0 (NTA)
}

/// Prefetch for write with high locality (L1 cache)
/// Use when you know you'll write to this address soon
inline void prefetch_write(void* ptr) noexcept {
    __builtin_prefetch(ptr, 1, 3);  // write=1, locality=3 (L1)
}

/// Prefetch for write with low locality
inline void prefetch_write_nta(void* ptr) noexcept {
    __builtin_prefetch(ptr, 1, 0);  // write=1, locality=0 (NTA)
}

/// Prefetch with configurable locality
template<PrefetchLocality Locality = PrefetchLocality::High>
inline void prefetch(const void* ptr, bool for_write = false) noexcept {
    if (for_write) {
        if constexpr (Locality == PrefetchLocality::None) {
            __builtin_prefetch(ptr, 1, 0);
        } else if constexpr (Locality == PrefetchLocality::Low) {
            __builtin_prefetch(ptr, 1, 1);
        } else if constexpr (Locality == PrefetchLocality::Medium) {
            __builtin_prefetch(ptr, 1, 2);
        } else {
            __builtin_prefetch(ptr, 1, 3);
        }
    } else {
        if constexpr (Locality == PrefetchLocality::None) {
            __builtin_prefetch(ptr, 0, 0);
        } else if constexpr (Locality == PrefetchLocality::Low) {
            __builtin_prefetch(ptr, 0, 1);
        } else if constexpr (Locality == PrefetchLocality::Medium) {
            __builtin_prefetch(ptr, 0, 2);
        } else {
            __builtin_prefetch(ptr, 0, 3);
        }
    }
}

// ============================================================================
// Batch Prefetch Functions
// ============================================================================

/// Prefetch N cache lines starting from ptr
template<size_t NumCacheLines = 8>
inline void prefetch_range(const void* ptr) noexcept {
    const char* p = static_cast<const char*>(ptr);
    for (size_t i = 0; i < NumCacheLines; ++i) {
        prefetch_read(p + i * CACHE_LINE_SIZE);
    }
}

/// Prefetch ahead by specified number of bytes
inline void prefetch_ahead(const void* base, size_t byte_offset) noexcept {
    prefetch_read(static_cast<const char*>(base) + byte_offset);
}

/// Prefetch ahead by specified number of cache lines
inline void prefetch_ahead_lines(const void* base, size_t line_offset) noexcept {
    prefetch_read(static_cast<const char*>(base) + line_offset * CACHE_LINE_SIZE);
}

// ============================================================================
// Loop Prefetch Helpers
// ============================================================================

// TICKET_476: DEFAULT_PREFETCH_DISTANCE centralized in hardware_constants.hpp
using constants::DEFAULT_PREFETCH_DISTANCE;

/// Prefetch helper for array iteration
/// Call at the start of each loop iteration
template<typename T, size_t Distance = DEFAULT_PREFETCH_DISTANCE>
inline void prefetch_for_iteration(const T* array, size_t current_index, size_t array_size) noexcept {
    size_t prefetch_index = current_index + Distance;
    if (prefetch_index < array_size) {
        prefetch_read(&array[prefetch_index]);
    }
}

/// Prefetch helper that accounts for element size
template<typename T, size_t DistanceBytes = DEFAULT_PREFETCH_DISTANCE * CACHE_LINE_SIZE>
inline void prefetch_elements_ahead(const T* ptr) noexcept {
    constexpr size_t elements_ahead = DistanceBytes / sizeof(T);
    prefetch_read(ptr + elements_ahead);
}

// ============================================================================
// Software Prefetch Barrier
// ============================================================================

/// Memory fence to ensure prefetches are issued
inline void prefetch_fence() noexcept {
#if defined(__x86_64__) || defined(_M_X64)
    asm volatile("" ::: "memory");
#else
    __sync_synchronize();
#endif
}

// ============================================================================
// Cache Line Utilities
// ============================================================================

/// Round up size to cache line boundary
[[nodiscard]] inline constexpr size_t align_to_cache_line(size_t size) noexcept {
    return (size + CACHE_LINE_SIZE - 1) & ~(CACHE_LINE_SIZE - 1);
}

/// Check if pointer is cache-line aligned
[[nodiscard]] inline bool is_cache_aligned(const void* ptr) noexcept {
    return (reinterpret_cast<uintptr_t>(ptr) & (CACHE_LINE_SIZE - 1)) == 0;
}

/// Get cache line offset of pointer
[[nodiscard]] inline size_t cache_line_offset(const void* ptr) noexcept {
    return reinterpret_cast<uintptr_t>(ptr) & (CACHE_LINE_SIZE - 1);
}

// ============================================================================
// Prefetch Macros (for use in performance-critical code)
// ============================================================================

/// Prefetch for read with high locality
#define QNX_PREFETCH_READ(addr) __builtin_prefetch((addr), 0, 3)

/// Prefetch for read with low locality (streaming)
#define QNX_PREFETCH_READ_NTA(addr) __builtin_prefetch((addr), 0, 0)

/// Prefetch for write
#define QNX_PREFETCH_WRITE(addr) __builtin_prefetch((addr), 1, 3)

} // namespace StratCraft::executor

/*
Example Usage Patterns
======================

Example 1: Loop with prefetch
-----------------------------
for (size_t i = 0; i < n; ++i) {
    prefetch_for_iteration(data, i, n);  // Prefetch ahead
    process(data[i]);
}

Example 2: Prefetch range before processing
-------------------------------------------
prefetch_range<4>(buffer);  // Prefetch 4 cache lines
process_buffer(buffer, 256);

Example 3: Manual prefetch distance
-----------------------------------
for (size_t i = 0; i < n; ++i) {
    QNX_PREFETCH_READ(&prices[i + 16]);  // 16 elements ahead
    calculate_indicator(prices[i]);
}

Example 4: Write prefetch for output buffer
-------------------------------------------
for (size_t i = 0; i < n; ++i) {
    prefetch_write(&output[i + 8]);
    output[i] = transform(input[i]);
}
*/
