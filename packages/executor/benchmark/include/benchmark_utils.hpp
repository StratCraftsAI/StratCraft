/**
 * @file benchmark_utils.hpp
 * @brief High-precision timing utilities for quantitative benchmarking
 *
 * Reference: TICKET_174 - C++ Executor Benchmark Framework
 * Reference: modernc_quant.md #98 - RDTSC Cycle Counting
 */

#pragma once

#include <chrono>
#include <cstdint>
#include <string>
#include <vector>
#include <algorithm>
#include <cmath>
#include <fstream>
#include <thread>
#include <sched.h>
#include <pthread.h>
#include <unistd.h>

namespace qnx::bench {

// ============================================================================
// RDTSC Timing Utilities
// ============================================================================

/**
 * @brief Basic RDTSC with lfence serialization
 */
inline uint64_t rdtsc() noexcept {
    uint64_t lo, hi;
    asm volatile ("lfence; rdtsc" : "=a"(lo), "=d"(hi));
    return (hi << 32) | lo;
}

/**
 * @brief Enhanced RDTSC with full pipeline serialization via cpuid
 * @warning cpuid can trigger VM Exit on virtualized servers (adds thousands of cycles)
 */
inline uint64_t rdtsc_precise() noexcept {
    uint32_t lo, hi;
    asm volatile (
        "cpuid\n\t"
        "rdtsc\n\t"
        : "=a"(lo), "=d"(hi)
        :
        : "%rbx", "%rcx"
    );
    return (static_cast<uint64_t>(hi) << 32) | lo;
}

/**
 * @brief VM-safe RDTSC using lfence instead of cpuid
 * @note Prefer this version on cloud/virtualized environments (AWS, GCP, Azure)
 */
inline uint64_t rdtsc_vm_safe() noexcept {
    uint64_t lo, hi;
    asm volatile (
        "lfence\n\t"
        "rdtsc\n\t"
        "lfence\n\t"
        : "=a"(lo), "=d"(hi)
    );
    return (hi << 32) | lo;
}

/**
 * @brief RDTSCP with processor ID (partial ordering guarantee)
 */
inline uint64_t rdtscp(uint32_t* aux = nullptr) noexcept {
    uint32_t lo, hi, aux_val;
    asm volatile ("rdtscp" : "=a"(lo), "=d"(hi), "=c"(aux_val));
    if (aux) *aux = aux_val;
    return (static_cast<uint64_t>(hi) << 32) | lo;
}

/**
 * @brief Auto-select best RDTSC based on environment
 */
inline uint64_t rdtsc_auto(bool is_virtualized = false) noexcept {
    return is_virtualized ? rdtsc_vm_safe() : rdtsc_precise();
}

/**
 * @brief Detect if running in virtualized environment
 */
inline bool is_virtualized() noexcept {
    std::ifstream cpuinfo("/proc/cpuinfo");
    std::string line;
    while (std::getline(cpuinfo, line)) {
        if (line.find("hypervisor") != std::string::npos) {
            return true;
        }
    }
    return false;
}

// ============================================================================
// Compiler Barriers
// ============================================================================

/**
 * @brief Prevent compiler reordering
 */
inline void compiler_barrier() noexcept {
    asm volatile("" ::: "memory");
}

/**
 * @brief Full memory fence
 */
inline void memory_fence() noexcept {
    asm volatile("mfence" ::: "memory");
}

// ============================================================================
// DoNotOptimize - Prevent Compiler Optimization
// Reference: TICKET_216 - Modern C++ Optimization Research
// ============================================================================

/**
 * @brief Prevent compiler from optimizing away a const value
 *
 * Use this to ensure the compiler doesn't eliminate computation
 * of a value that is only used for benchmarking purposes.
 *
 * Example:
 *   auto result = expensive_computation();
 *   doNotOptimize(result);  // Compiler must compute result
 */
template<typename T>
inline void doNotOptimize(T const& val) noexcept {
    asm volatile("" : : "r,m"(val) : "memory");
}

/**
 * @brief Prevent compiler from optimizing away a mutable value
 *
 * Use this for values that may be modified. The "+r,m" constraint
 * tells the compiler the value is both read and written.
 *
 * Example:
 *   int counter = 0;
 *   for (int i = 0; i < N; ++i) {
 *       counter += work();
 *       doNotOptimize(counter);  // Prevent loop optimization
 *   }
 */
template<typename T>
inline void doNotOptimize(T& val) noexcept {
    asm volatile("" : "+r,m"(val) : : "memory");
}

/**
 * @brief Escape a pointer to prevent compiler from tracking it
 *
 * Tells the compiler that the pointed-to memory may be accessed
 * by code it cannot see, preventing dead store elimination.
 */
inline void escape(void* p) noexcept {
    asm volatile("" : : "g"(p) : "memory");
}

/**
 * @brief Clobber all memory to prevent reordering
 *
 * Use between operations that must not be reordered.
 * Stronger than compiler_barrier() as it also prevents
 * the compiler from caching memory values across this point.
 */
inline void clobber() noexcept {
    asm volatile("" : : : "memory");
}

// ============================================================================
// CPU Affinity & Scheduling
// ============================================================================

/**
 * @brief Bind current thread to specific CPU core
 * Reference: modernc_quant.md #20 - CPU Isolation & Core Affinity
 */
inline bool bind_to_core(int core_id) noexcept {
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(core_id, &cpuset);
    return pthread_setaffinity_np(pthread_self(), sizeof(cpu_set_t), &cpuset) == 0;
}

/**
 * @brief Setup benchmark thread with CPU isolation and real-time priority
 * @note Requires CAP_SYS_NICE or root
 * @param core_id CPU core to pin to
 * @param priority Real-time priority (1-99, default 99)
 * @return true if both pinning and priority were set successfully
 */
inline bool setup_benchmark_thread(int core_id, int priority = 99) noexcept {
    if (!bind_to_core(core_id)) return false;

    struct sched_param param;
    param.sched_priority = priority;
    return sched_setscheduler(0, SCHED_FIFO, &param) == 0;
}

/**
 * @brief Get the current CPU core
 */
[[nodiscard]] inline int get_current_core() noexcept {
    return sched_getcpu();
}

/**
 * @brief Get number of available CPU cores
 */
[[nodiscard]] inline int get_num_cores() noexcept {
    return static_cast<int>(sysconf(_SC_NPROCESSORS_ONLN));
}

/**
 * @brief Set real-time scheduling priority (without core pinning)
 * @note Requires CAP_SYS_NICE or root
 */
[[nodiscard]] inline bool set_realtime_priority(int priority = 99) noexcept {
    struct sched_param param;
    param.sched_priority = priority;
    return sched_setscheduler(0, SCHED_FIFO, &param) == 0;
}

// ============================================================================
// RAII Timer Classes
// ============================================================================

/**
 * @brief RAII timer using std::chrono
 */
class ScopedTimer {
public:
    using Clock = std::chrono::steady_clock;

    explicit ScopedTimer(std::chrono::nanoseconds& output) noexcept
        : start_(Clock::now()), output_(output) {}

    ~ScopedTimer() {
        output_ = Clock::now() - start_;
    }

    ScopedTimer(const ScopedTimer&) = delete;
    ScopedTimer& operator=(const ScopedTimer&) = delete;

private:
    Clock::time_point start_;
    std::chrono::nanoseconds& output_;
};

/**
 * @brief RAII timer using RDTSC cycles
 */
class ScopedCycleTimer {
public:
    explicit ScopedCycleTimer(uint64_t& output, bool vm_safe = false) noexcept
        : start_(vm_safe ? rdtsc_vm_safe() : rdtsc_precise())
        , output_(output)
        , vm_safe_(vm_safe) {}

    ~ScopedCycleTimer() {
        output_ = (vm_safe_ ? rdtsc_vm_safe() : rdtsc_precise()) - start_;
    }

    ScopedCycleTimer(const ScopedCycleTimer&) = delete;
    ScopedCycleTimer& operator=(const ScopedCycleTimer&) = delete;

private:
    uint64_t start_;
    uint64_t& output_;
    bool vm_safe_;
};

// ============================================================================
// Statistics
// ============================================================================

/**
 * @brief Latency statistics container
 */
struct LatencyStats {
    double min_ns = 0;
    double max_ns = 0;
    double mean_ns = 0;
    double stddev_ns = 0;
    double p50_ns = 0;
    double p90_ns = 0;
    double p99_ns = 0;
    double p999_ns = 0;
    size_t sample_count = 0;

    void compute(std::vector<double>& samples) {
        if (samples.empty()) return;

        sample_count = samples.size();
        std::sort(samples.begin(), samples.end());

        min_ns = samples.front();
        max_ns = samples.back();

        double sum = 0;
        for (double s : samples) sum += s;
        mean_ns = sum / sample_count;

        double sq_sum = 0;
        for (double s : samples) sq_sum += (s - mean_ns) * (s - mean_ns);
        stddev_ns = std::sqrt(sq_sum / sample_count);

        p50_ns = samples[sample_count * 50 / 100];
        p90_ns = samples[sample_count * 90 / 100];
        p99_ns = samples[sample_count * 99 / 100];
        p999_ns = samples[std::min(sample_count - 1, sample_count * 999 / 1000)];
    }

    /**
     * @brief Serialize stats to JSON string for CI integration
     * Reference: TICKET_471_5 - JSON output for performance regression gate
     * @param name Benchmark name identifier
     */
    [[nodiscard]] std::string to_json(const std::string& name) const {
        // Manual JSON to avoid nlohmann_json dependency in header-only utils
        std::string json = "    {\n";
        json += "      \"name\": \"" + name + "\",\n";
        json += "      \"sample_count\": " + std::to_string(sample_count) + ",\n";
        json += "      \"min_ns\": " + std::to_string(min_ns) + ",\n";
        json += "      \"max_ns\": " + std::to_string(max_ns) + ",\n";
        json += "      \"mean_ns\": " + std::to_string(mean_ns) + ",\n";
        json += "      \"stddev_ns\": " + std::to_string(stddev_ns) + ",\n";
        json += "      \"p50_ns\": " + std::to_string(p50_ns) + ",\n";
        json += "      \"p50_ms\": " + std::to_string(p50_ns / 1e6) + ",\n";
        json += "      \"p90_ns\": " + std::to_string(p90_ns) + ",\n";
        json += "      \"p99_ns\": " + std::to_string(p99_ns) + ",\n";
        json += "      \"p99_ms\": " + std::to_string(p99_ns / 1e6) + ",\n";
        json += "      \"p999_ns\": " + std::to_string(p999_ns) + "\n";
        json += "    }";
        return json;
    }
};

/**
 * @brief Convert cycles to nanoseconds (approximate)
 * @param cycles CPU cycles
 * @param freq_ghz CPU frequency in GHz (default 3.0)
 */
inline double cycles_to_ns(uint64_t cycles, double freq_ghz = 3.0) noexcept {
    return static_cast<double>(cycles) / freq_ghz;
}

/**
 * @brief Get CPU frequency from /proc/cpuinfo (approximate)
 * @deprecated Use estimate_cpu_freq_ghz() for more accurate results
 */
inline double get_cpu_freq_ghz() noexcept {
    std::ifstream cpuinfo("/proc/cpuinfo");
    std::string line;
    while (std::getline(cpuinfo, line)) {
        if (line.find("cpu MHz") != std::string::npos) {
            size_t pos = line.find(':');
            if (pos != std::string::npos) {
                return std::stod(line.substr(pos + 1)) / 1000.0;
            }
        }
    }
    return 3.0;  // Default fallback
}

/**
 * @brief Estimate CPU frequency using RDTSC calibration
 *
 * More accurate than reading /proc/cpuinfo, especially on systems with
 * dynamic frequency scaling (Intel SpeedStep, AMD Cool'n'Quiet).
 *
 * Reference: TICKET_215 - Benchmark Framework Enhancement
 *
 * @param calibration_ms Calibration duration in milliseconds (default: 100ms)
 * @return CPU frequency in GHz
 */
[[nodiscard]] inline double estimate_cpu_freq_ghz(int calibration_ms = 100) noexcept {
    using namespace std::chrono;

    auto start_time = steady_clock::now();
    uint64_t start_cycles = rdtsc_vm_safe();

    std::this_thread::sleep_for(milliseconds(calibration_ms));

    uint64_t end_cycles = rdtsc_vm_safe();
    auto end_time = steady_clock::now();

    double elapsed_ns = static_cast<double>(
        duration_cast<nanoseconds>(end_time - start_time).count());
    double cycles = static_cast<double>(end_cycles - start_cycles);

    return cycles / elapsed_ns;  // GHz = cycles / ns
}

// ============================================================================
// Warmup Utilities
// ============================================================================

/**
 * @brief Execute warmup iterations to prime I-Cache
 * Reference: modernc_quant.md #22 - Instruction Cache Warming
 */
template <typename Func>
void warmup(Func&& func, size_t iterations = 1000) {
    for (size_t i = 0; i < iterations; ++i) {
        compiler_barrier();
        func();
        compiler_barrier();
    }
}

/**
 * @brief Run benchmark with warmup and collect statistics
 */
template <typename Func>
LatencyStats benchmark(Func&& func, size_t warmup_iterations = 1000,
                       size_t measure_iterations = 10000, bool vm_safe = false) {
    // Warmup phase
    warmup(func, warmup_iterations);

    // Measurement phase
    std::vector<double> samples;
    samples.reserve(measure_iterations);

    // Use calibrated frequency for accurate cycle-to-ns conversion
    double freq_ghz = estimate_cpu_freq_ghz();

    for (size_t i = 0; i < measure_iterations; ++i) {
        uint64_t start = vm_safe ? rdtsc_vm_safe() : rdtsc_precise();
        compiler_barrier();
        func();
        compiler_barrier();
        uint64_t end = vm_safe ? rdtsc_vm_safe() : rdtsc_precise();

        samples.push_back(cycles_to_ns(end - start, freq_ghz));
    }

    LatencyStats stats;
    stats.compute(samples);
    return stats;
}

}  // namespace qnx::bench
