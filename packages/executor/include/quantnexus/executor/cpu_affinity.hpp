/**
 * @file cpu_affinity.hpp
 * @brief CPU Affinity Utility for StratCraft Executor
 *
 * Provides CPU core pinning for latency-sensitive threads.
 *
 * Benefits of CPU pinning:
 * - 15-25% P99 latency reduction (eliminates context switch jitter)
 * - Improved cache locality (L1/L2 remain hot)
 * - Predictable NUMA memory access
 * - Reduced OS scheduler interference
 *
 * Usage:
 *     // Pin current thread to core 2
 *     StratCraft::benchmark::CpuAffinity::pin_to_core(2);
 *
 *     // Pin using hash-based distribution
 *     StratCraft::benchmark::CpuAffinity::pin_by_hash(session_hash);
 *
 * Reference: Seastar Analysis
 */

#pragma once

#include <cstdint>
#include <vector>
#include <thread>
#include <atomic>
#include <string_view>

#include "hardware_constants.hpp"

#if defined(__linux__)
    #include <sched.h>
    #include <pthread.h>
    #include <unistd.h>
    #define QNX_HAS_CPU_AFFINITY 1
#elif defined(__APPLE__)
    #include <pthread.h>
    #include <mach/thread_policy.h>
    #include <mach/thread_act.h>
    #define QNX_HAS_CPU_AFFINITY 1
#else
    #define QNX_HAS_CPU_AFFINITY 0
#endif

namespace StratCraft::executor {

// ============================================================================
// CPU Affinity Configuration
// ============================================================================

/// Configuration for CPU affinity
struct CpuAffinityConfig {
    std::vector<int> allowed_cores;   // Cores available for executor threads
    bool isolate_from_system{true};   // Avoid cores 0-1 (often used by OS)
    int numa_node{-1};                // Preferred NUMA node (-1 = any)

    /// Create default config using cores beyond OS_RESERVED_CORES
    static CpuAffinityConfig default_config() noexcept {
        CpuAffinityConfig config;
        int num_cores = static_cast<int>(std::thread::hardware_concurrency());

        // Use cores OS_RESERVED_CORES+ for executor (leave 0-(N-1) for OS/interrupts)
        for (int i = constants::OS_RESERVED_CORES; i < num_cores; ++i) {
            config.allowed_cores.push_back(i);
        }

        // Fallback: use core 1 if only OS_RESERVED_CORES cores available
        if (config.allowed_cores.empty() && num_cores >= constants::OS_RESERVED_CORES) {
            config.allowed_cores.push_back(1);
        }
        // Last resort: use core 0
        if (config.allowed_cores.empty()) {
            config.allowed_cores.push_back(0);
        }

        return config;
    }
};

// ============================================================================
// CPU Affinity Result
// ============================================================================

/// Result of affinity operations
struct AffinityResult {
    bool success{false};
    int core_id{-1};         // Actual core pinned to
    int error_code{0};       // errno on failure

    explicit operator bool() const noexcept { return success; }
};

// ============================================================================
// CPU Affinity Manager
// ============================================================================

/// Thread-safe CPU affinity manager
class CpuAffinity {
public:
    // ========================================================================
    // Core Pinning
    // ========================================================================

    /// Pin current thread to a specific CPU core
    /// @param core_id The CPU core ID (0-based)
    /// @return Result with success status and actual core
    [[nodiscard]] static AffinityResult pin_to_core(int core_id) noexcept {
#if QNX_HAS_CPU_AFFINITY && defined(__linux__)
        cpu_set_t cpuset;
        CPU_ZERO(&cpuset);
        CPU_SET(core_id, &cpuset);

        int result = pthread_setaffinity_np(
            pthread_self(),
            sizeof(cpu_set_t),
            &cpuset
        );

        if (result == 0) {
            return AffinityResult{true, core_id, 0};
        }
        return AffinityResult{false, -1, result};

#elif QNX_HAS_CPU_AFFINITY && defined(__APPLE__)
        // macOS uses thread affinity hints (not strict binding)
        thread_affinity_policy_data_t policy = { core_id };
        kern_return_t result = thread_policy_set(
            pthread_mach_thread_np(pthread_self()),
            THREAD_AFFINITY_POLICY,
            reinterpret_cast<thread_policy_t>(&policy),
            THREAD_AFFINITY_POLICY_COUNT
        );

        if (result == KERN_SUCCESS) {
            return AffinityResult{true, core_id, 0};
        }
        return AffinityResult{false, -1, static_cast<int>(result)};

#else
        (void)core_id;
        return AffinityResult{false, -1, -1};  // Not supported
#endif
    }

    /// Pin current thread using hash value
    /// Distributes threads across available cores
    /// @param hash Hash value for core selection
    /// @param config Affinity configuration
    /// @return Result with success status and assigned core
    [[nodiscard]] static AffinityResult pin_by_hash(
        uint64_t hash,
        const CpuAffinityConfig& config = CpuAffinityConfig::default_config()) noexcept
    {
        if (config.allowed_cores.empty()) {
            return AffinityResult{false, -1, -1};
        }

        // Select core using hash modulo
        size_t index = hash % config.allowed_cores.size();
        int core_id = config.allowed_cores[index];

        return pin_to_core(core_id);
    }

    /// Calculate hash for core assignment using FNV-1a
    /// FNV_OFFSET and FNV_PRIME are standard FNV-1a algorithm constants (not magic numbers)
    [[nodiscard]] static uint64_t fnv1a_hash(std::string_view str) noexcept {
        constexpr uint64_t FNV_OFFSET = 14695981039346656037ULL;
        constexpr uint64_t FNV_PRIME = 1099511628211ULL;

        uint64_t hash = FNV_OFFSET;
        for (char c : str) {
            hash ^= static_cast<uint64_t>(c);
            hash *= FNV_PRIME;
        }
        return hash;
    }

    // ========================================================================
    // Core Information
    // ========================================================================

    /// Get the current CPU core the thread is running on
    [[nodiscard]] static int current_core() noexcept {
#if defined(__linux__)
        return sched_getcpu();
#else
        return -1;  // Not available
#endif
    }

    /// Get total number of CPU cores
    [[nodiscard]] static int core_count() noexcept {
        return static_cast<int>(std::thread::hardware_concurrency());
    }

    /// Get cores currently pinned to this thread
    [[nodiscard]] static std::vector<int> get_affinity() noexcept {
        std::vector<int> cores;

#if QNX_HAS_CPU_AFFINITY && defined(__linux__)
        cpu_set_t cpuset;
        CPU_ZERO(&cpuset);

        if (pthread_getaffinity_np(pthread_self(), sizeof(cpu_set_t), &cpuset) == 0) {
            int num_cores = core_count();
            for (int i = 0; i < num_cores && i < CPU_SETSIZE; ++i) {
                if (CPU_ISSET(i, &cpuset)) {
                    cores.push_back(i);
                }
            }
        }
#endif

        return cores;
    }

    /// Check if current thread is pinned to a single core
    [[nodiscard]] static bool is_pinned() noexcept {
        auto affinity = get_affinity();
        return affinity.size() == 1;
    }

    // ========================================================================
    // Thread Priority
    // ========================================================================

    /// Set real-time priority for current thread (requires CAP_SYS_NICE)
    /// @param priority 1-99 (99 = highest)
    /// @return true if successful
    [[nodiscard]] static bool set_realtime_priority([[maybe_unused]] int priority) noexcept {
#if defined(__linux__)
        struct sched_param param;
        param.sched_priority = priority;
        return pthread_setschedparam(pthread_self(), SCHED_FIFO, &param) == 0;
#else
        return false;
#endif
    }

    /// Set thread to high priority (doesn't require root)
    [[nodiscard]] static bool set_high_priority() noexcept {
#if defined(__linux__)
        struct sched_param param;
        param.sched_priority = 0;
        return pthread_setschedparam(pthread_self(), SCHED_BATCH, &param) == 0;
#else
        return false;
#endif
    }
};

// ============================================================================
// Session Core Mapper
// ============================================================================

/// Maps sessions/strategies to CPU cores for optimal distribution
class SessionCoreMapper {
public:
    explicit SessionCoreMapper(
        CpuAffinityConfig config = CpuAffinityConfig::default_config()) noexcept
        : config_{std::move(config)}
        , next_core_index_{0} {}

    /// Get next core in round-robin fashion
    [[nodiscard]] int next_core_round_robin() noexcept {
        if (config_.allowed_cores.empty()) return -1;

        size_t index = next_core_index_.fetch_add(1, std::memory_order_relaxed);
        return config_.allowed_cores[index % config_.allowed_cores.size()];
    }

    /// Get core for session based on ID hash
    [[nodiscard]] int core_for_session(std::string_view session_id) const noexcept {
        if (config_.allowed_cores.empty()) return -1;

        uint64_t hash = CpuAffinity::fnv1a_hash(session_id);
        size_t index = hash % config_.allowed_cores.size();
        return config_.allowed_cores[index];
    }

    /// Pin current thread for session
    [[nodiscard]] AffinityResult pin_for_session(std::string_view session_id) const noexcept {
        int core = core_for_session(session_id);
        if (core < 0) return AffinityResult{false, -1, -1};
        return CpuAffinity::pin_to_core(core);
    }

    /// Get configuration
    [[nodiscard]] const CpuAffinityConfig& config() const noexcept {
        return config_;
    }

private:
    CpuAffinityConfig config_;
    std::atomic<size_t> next_core_index_;
};

// ============================================================================
// RAII Core Pinning Guard
// ============================================================================

/// RAII guard for temporary core pinning
class ScopedCorePinning {
public:
    explicit ScopedCorePinning(int core_id) noexcept
        : original_affinity_{CpuAffinity::get_affinity()}
        , pinned_{CpuAffinity::pin_to_core(core_id).success} {}

    ~ScopedCorePinning() {
        if (pinned_ && !original_affinity_.empty()) {
#if QNX_HAS_CPU_AFFINITY && defined(__linux__)
            cpu_set_t cpuset;
            CPU_ZERO(&cpuset);
            for (int core : original_affinity_) {
                CPU_SET(core, &cpuset);
            }
            pthread_setaffinity_np(pthread_self(), sizeof(cpu_set_t), &cpuset);
#endif
        }
    }

    // Non-copyable
    ScopedCorePinning(const ScopedCorePinning&) = delete;
    ScopedCorePinning& operator=(const ScopedCorePinning&) = delete;

    // Move-only
    ScopedCorePinning(ScopedCorePinning&& other) noexcept
        : original_affinity_{std::move(other.original_affinity_)}
        , pinned_{other.pinned_} {
        other.pinned_ = false;
    }

    [[nodiscard]] bool is_pinned() const noexcept { return pinned_; }

private:
    std::vector<int> original_affinity_;
    bool pinned_;
};

} // namespace StratCraft::executor
