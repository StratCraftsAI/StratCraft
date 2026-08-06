/**
 * RDTSC - Cycle-Accurate Benchmark Timing
 *
 * TICKET_470 Phase 2.4: RDTSC benchmark tooling
 *
 * Provides cycle-accurate timing for performance measurement:
 * - rdtsc_vm_safe(): VM-compatible cycle counter (lfence serialized)
 * - rdtsc_precise(): Full serialization (cpuid, bare metal only)
 * - ScopedTimer: RAII cycle measurement
 * - LatencyStats: P50/P90/P99/P999 percentile statistics
 * - CPU frequency estimation and cycle-to-ns conversion
 *
 * Source pattern: NexusFIX benchmark_utils.hpp
 *
 * Usage:
 *   auto freq = qnx::bench::estimate_cpu_freq_ghz();
 *   std::vector<uint64_t> samples(10000);
 *   for (auto& s : samples) {
 *       qnx::bench::ScopedTimer timer(s);
 *       execute_strategy();
 *   }
 *   qnx::bench::LatencyStats stats;
 *   stats.compute(samples, freq);
 */

#pragma once

#include <cstdint>
#include <vector>
#include <algorithm>
#include <numeric>
#include <cmath>
#include <chrono>
#include <thread>

#ifdef __linux__
#include <sched.h>
#include <pthread.h>
#endif

namespace StratCraft::executor::bench {

// =============================================================================
// RDTSC Timing (x86/x86-64)
// =============================================================================

#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)

/**
 * VM-safe RDTSC (lfence serialized)
 *
 * Uses lfence instead of cpuid to avoid VM Exit penalty.
 * Suitable for cloud/virtualized environments.
 */
[[nodiscard]] inline uint64_t rdtsc_vm_safe() noexcept {
    uint64_t lo, hi;
    asm volatile(
        "lfence\n\t"
        "rdtsc\n\t"
        "lfence\n\t"
        : "=a"(lo), "=d"(hi)
    );
    return (hi << 32) | lo;
}

/**
 * Precise RDTSC (cpuid serialized)
 *
 * Full pipeline serialization. More accurate but higher overhead.
 * Bare metal only (cpuid causes VM Exit on virtualized systems).
 */
[[nodiscard]] inline uint64_t rdtsc_precise() noexcept {
    uint32_t lo, hi;
    asm volatile(
        "cpuid\n\t"
        "rdtsc\n\t"
        : "=a"(lo), "=d"(hi)
        :
        : "%rbx", "%rcx"
    );
    return (static_cast<uint64_t>(hi) << 32) | lo;
}

/**
 * RDTSCP - includes partial ordering guarantee
 */
[[nodiscard]] inline uint64_t rdtscp() noexcept {
    uint32_t lo, hi, aux;
    asm volatile("rdtscp" : "=a"(lo), "=d"(hi), "=c"(aux));
    return (static_cast<uint64_t>(hi) << 32) | lo;
}

#else

// ARM/other: fallback to chrono
[[nodiscard]] inline uint64_t rdtsc_vm_safe() noexcept {
    return static_cast<uint64_t>(
        std::chrono::steady_clock::now().time_since_epoch().count()
    );
}

[[nodiscard]] inline uint64_t rdtsc_precise() noexcept {
    return rdtsc_vm_safe();
}

[[nodiscard]] inline uint64_t rdtscp() noexcept {
    return rdtsc_vm_safe();
}

#endif

// =============================================================================
// Compiler Barrier
// =============================================================================

inline void compiler_barrier() noexcept {
#if defined(__GNUC__) || defined(__clang__)
    asm volatile("" ::: "memory");
#elif defined(_MSC_VER)
    _ReadWriteBarrier();
#endif
}

// =============================================================================
// CPU Frequency Estimation
// =============================================================================

/**
 * Estimate CPU frequency in GHz (busy-wait for accuracy)
 *
 * Busy-waits to keep CPU at full speed, preventing frequency scaling.
 */
[[nodiscard]] inline double estimate_cpu_freq_ghz() noexcept {
    using namespace std::chrono;

    auto start_time = steady_clock::now();
    uint64_t start_cycles = rdtsc_vm_safe();

    // Busy-wait 100ms
    while (steady_clock::now() - start_time < milliseconds(100)) {
#if defined(__x86_64__) || defined(_M_X64)
        asm volatile("pause");
#elif defined(__aarch64__)
        asm volatile("yield");
#endif
    }

    uint64_t end_cycles = rdtsc_vm_safe();
    auto end_time = steady_clock::now();

    double elapsed_ns = duration<double, std::nano>(end_time - start_time).count();
    double cycles = static_cast<double>(end_cycles - start_cycles);

    return cycles / elapsed_ns;  // GHz
}

/**
 * Convert cycles to nanoseconds
 */
[[nodiscard]] inline double cycles_to_ns(uint64_t cycles, double freq_ghz) noexcept {
    return static_cast<double>(cycles) / freq_ghz;
}

// =============================================================================
// Latency Statistics
// =============================================================================

/**
 * Latency statistics with percentile analysis
 *
 * Computes min/max/mean/stddev and P50/P90/P99/P999 from cycle samples.
 */
struct LatencyStats {
    double min_ns{};
    double max_ns{};
    double mean_ns{};
    double stddev_ns{};
    double p50_ns{};
    double p90_ns{};
    double p99_ns{};
    double p999_ns{};
    size_t count{};

    /**
     * Compute statistics from cycle count samples
     *
     * @param cycles Vector of cycle counts (will be sorted in-place)
     * @param freq_ghz CPU frequency from estimate_cpu_freq_ghz()
     */
    void compute(std::vector<uint64_t>& cycles, double freq_ghz) {
        if (cycles.empty()) return;

        count = cycles.size();
        std::sort(cycles.begin(), cycles.end());

        auto to_ns = [freq_ghz](uint64_t c) { return cycles_to_ns(c, freq_ghz); };

        min_ns = to_ns(cycles.front());
        max_ns = to_ns(cycles.back());

        // Mean
        double s = 0.0;
        for (auto c : cycles) s += to_ns(c);
        mean_ns = s / static_cast<double>(count);

        // Stddev
        double sq_sum = 0.0;
        for (auto c : cycles) {
            double diff = to_ns(c) - mean_ns;
            sq_sum += diff * diff;
        }
        stddev_ns = std::sqrt(sq_sum / static_cast<double>(count));

        // Percentiles
        p50_ns  = to_ns(cycles[count / 2]);
        p90_ns  = to_ns(cycles[count * 90 / 100]);
        p99_ns  = to_ns(cycles[count * 99 / 100]);
        p999_ns = to_ns(cycles[count * 999 / 1000]);
    }

    /**
     * Compute statistics from nanosecond samples
     */
    void compute_from_ns(std::vector<double>& samples) {
        if (samples.empty()) return;

        count = samples.size();
        std::sort(samples.begin(), samples.end());

        min_ns = samples.front();
        max_ns = samples.back();

        mean_ns = std::accumulate(samples.begin(), samples.end(), 0.0)
                / static_cast<double>(count);

        double sq_sum = 0.0;
        for (auto s : samples) {
            double diff = s - mean_ns;
            sq_sum += diff * diff;
        }
        stddev_ns = std::sqrt(sq_sum / static_cast<double>(count));

        p50_ns  = samples[count / 2];
        p90_ns  = samples[count * 90 / 100];
        p99_ns  = samples[count * 99 / 100];
        p999_ns = samples[count * 999 / 1000];
    }
};

// =============================================================================
// Scoped Timer
// =============================================================================

/**
 * RAII cycle counter using RDTSC
 *
 * Usage:
 *   uint64_t cycles;
 *   {
 *       ScopedTimer timer(cycles);
 *       do_work();
 *   }
 *   double ns = cycles_to_ns(cycles, freq_ghz);
 */
class ScopedTimer {
public:
    explicit ScopedTimer(uint64_t& output) noexcept
        : output_(output), start_(rdtsc_vm_safe()) {}

    ~ScopedTimer() {
        output_ = rdtsc_vm_safe() - start_;
    }

    ScopedTimer(const ScopedTimer&) = delete;
    ScopedTimer& operator=(const ScopedTimer&) = delete;

private:
    uint64_t& output_;
    uint64_t start_;
};

// =============================================================================
// Warmup Utilities
// =============================================================================

/**
 * Warm up instruction cache by running function multiple times
 */
template<typename Func>
inline void warmup(Func&& func, size_t iterations = 10000) {
    for (size_t i = 0; i < iterations; ++i) {
        compiler_barrier();
        func();
        compiler_barrier();
    }
}

/**
 * Warm up data cache by touching memory at cache-line stride
 */
inline void warmup_dcache(const void* data, size_t size) noexcept {
    const volatile char* p = static_cast<const volatile char*>(data);
    for (size_t i = 0; i < size; i += 64) {
        (void)p[i];
    }
}

// =============================================================================
// Benchmark Core Pinning
// =============================================================================

/**
 * Pin current thread to a specific CPU core for stable benchmarks
 *
 * @return true if successful
 */
[[nodiscard]] inline bool pin_to_core(int core_id) noexcept {
#ifdef __linux__
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(core_id, &cpuset);
    return pthread_setaffinity_np(pthread_self(), sizeof(cpu_set_t), &cpuset) == 0;
#else
    (void)core_id;
    return false;
#endif
}

} // namespace StratCraft::executor::bench
