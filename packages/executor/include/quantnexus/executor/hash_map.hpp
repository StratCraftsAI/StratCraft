/**
 * Hash Map - Conditional High-Performance Hash Table
 *
 * TICKET_470 Phase 2.3: Abseil Swiss Tables integration
 *
 * Provides centralized hash map type aliases:
 * - When QNX_HAS_ABSEIL: absl::flat_hash_map (SIMD-accelerated probing, 31% faster)
 * - Fallback: std::unordered_map
 *
 * Usage:
 *   qnx::HashMap<std::string, double> symbol_prices;
 *   qnx::HashSet<int> active_tags;
 *
 * Source pattern: NexusFIX Abseil integration (TICKET_216)
 */

#pragma once

#include <string>
#include <functional>

#if defined(QNX_HAS_ABSEIL) && QNX_HAS_ABSEIL
#include <absl/container/flat_hash_map.h>
#include <absl/container/flat_hash_set.h>
#include <absl/hash/hash.h>
#define QNX_ABSEIL_ENABLED 1
#else
#include <unordered_map>
#include <unordered_set>
#define QNX_ABSEIL_ENABLED 0
#endif

namespace StratCraft::executor {

// =============================================================================
// Conditional Type Aliases
// =============================================================================

#if QNX_ABSEIL_ENABLED

/**
 * High-performance hash map (Abseil Swiss Tables)
 *
 * Features vs std::unordered_map:
 * - SIMD-accelerated probing (parallel group matching)
 * - Flat memory layout (better cache locality)
 * - 87.5% max load factor (vs 50% for std::unordered_map)
 * - ~31% faster lookups on average
 */
template<typename K, typename V,
         typename Hash = absl::Hash<K>,
         typename Eq = std::equal_to<K>>
using HashMap = absl::flat_hash_map<K, V, Hash, Eq>;

/**
 * High-performance hash set (Abseil Swiss Tables)
 */
template<typename K,
         typename Hash = absl::Hash<K>,
         typename Eq = std::equal_to<K>>
using HashSet = absl::flat_hash_set<K, Hash, Eq>;

#else

/**
 * Standard hash map (fallback when Abseil not available)
 */
template<typename K, typename V,
         typename Hash = std::hash<K>,
         typename Eq = std::equal_to<K>>
using HashMap = std::unordered_map<K, V, Hash, Eq>;

/**
 * Standard hash set (fallback)
 */
template<typename K,
         typename Hash = std::hash<K>,
         typename Eq = std::equal_to<K>>
using HashSet = std::unordered_set<K, Hash, Eq>;

#endif

// =============================================================================
// Compile-time Info
// =============================================================================

/**
 * Check if Abseil Swiss Tables are active
 */
[[nodiscard]] inline constexpr bool has_abseil() noexcept {
    return QNX_ABSEIL_ENABLED != 0;
}

[[nodiscard]] inline const char* hash_map_backend() noexcept {
#if QNX_ABSEIL_ENABLED
    return "absl::flat_hash_map (Swiss Tables)";
#else
    return "std::unordered_map";
#endif
}

} // namespace StratCraft::executor
