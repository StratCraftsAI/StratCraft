/**
 * Hardware Constants
 *
 * TICKET_476: Magic Number Elimination
 * TICKET_179: Unified Constants Management
 *
 * Centralized hardware-related constants for the executor module.
 * All cache, page, SIMD, and prefetch constants defined here.
 *
 * Categories:
 * - Cache: Cache line and cache level sizes
 * - Page: OS page sizes
 * - SIMD: Vector widths and padding
 * - Prefetch: Prefetch distances
 * - Memory: Arena and allocation sizes
 * - CPU: Core reservation
 */

#pragma once

#include <cstddef>

namespace StratCraft::executor::constants {

// =============================================================================
// Cache Constants
// =============================================================================

/// Standard cache line size (64 bytes on x86-64)
inline constexpr size_t CACHE_LINE_SIZE = 64;

/// L1 cache size estimate (32KB typical)
inline constexpr size_t L1_CACHE_SIZE = 32 * 1024;

/// L2 cache size estimate (256KB typical)
inline constexpr size_t L2_CACHE_SIZE = 256 * 1024;

// =============================================================================
// Page Size Constants
// =============================================================================

/// Standard OS page size (4KB)
inline constexpr size_t PAGE_SIZE = 4096;

/// Huge page size (2MB, for TLB optimization)
inline constexpr size_t HUGE_PAGE_SIZE = 2 * 1024 * 1024;

// =============================================================================
// SIMD Width Constants
// =============================================================================

/// AVX2 doubles per register (256-bit / 64-bit)
inline constexpr size_t AVX2_DOUBLE_WIDTH = 4;

/// AVX-512 doubles per register (512-bit / 64-bit)
inline constexpr size_t AVX512_DOUBLE_WIDTH = 8;

/// Extra padding for safe SIMD overread (64 bytes = AVX-512 register width)
inline constexpr size_t SIMD_PADDING = 64;

// =============================================================================
// SIMD Stride Constants (bytes per register)
// =============================================================================

/// AVX2 byte stride per register (256-bit = 32 bytes)
inline constexpr size_t AVX2_STRIDE = 32;

/// AVX-512 byte stride per register (512-bit = 64 bytes)
inline constexpr size_t AVX512_STRIDE = 64;

// =============================================================================
// Prefetch Distance Constants
// =============================================================================

/// Default prefetch distance (cache lines ahead)
inline constexpr size_t DEFAULT_PREFETCH_DISTANCE = 8;

/// Prefetch distance for AVX-512 operations (cache lines ahead)
inline constexpr size_t PREFETCH_DISTANCE_512 = 4;

// =============================================================================
// Memory Arena Constants
// =============================================================================

/// Default PMR arena capacity (64MB)
inline constexpr size_t ARENA_CAPACITY = 64 * 1024 * 1024;

// =============================================================================
// CPU Topology Constants
// =============================================================================

/// Number of cores reserved for OS/interrupts (cores 0 and 1)
inline constexpr int OS_RESERVED_CORES = 2;

} // namespace StratCraft::executor::constants
