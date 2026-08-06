/**
 * @file bench_prefetch.cpp
 * @brief Prefetch distance tuning benchmark
 *
 * Reference: TICKET_174 - C++ Executor Benchmark Framework
 * Reference: modernc_quant.md #11 - Prefetch Tuning
 *
 * Benchmarks:
 * - Optimal prefetch distance for sequential access
 * - Prefetch effectiveness for different data sizes
 * - L1/L2/LLC prefetch behavior
 * - Software vs hardware prefetch comparison
 */

#include "benchmark_utils.hpp"
#include "perf_counters.hpp"

#include <iostream>
#include <iomanip>
#include <vector>
#include <random>
#include <cstring>

using namespace qnx::bench;

// ============================================================================
// Configuration
// ============================================================================

struct BenchConfig {
    size_t arraySizeMB = 64;
    size_t iterations = 100;
    bool useVmSafe = false;
    int cpuCore = -1;
};

// ============================================================================
// Prefetch Intrinsics
// ============================================================================

// Software prefetch hints
inline void prefetch_t0(const void* addr) noexcept {
    __builtin_prefetch(addr, 0, 3);  // Read, high temporal locality
}

inline void prefetch_t1(const void* addr) noexcept {
    __builtin_prefetch(addr, 0, 2);  // Read, moderate temporal locality
}

inline void prefetch_t2(const void* addr) noexcept {
    __builtin_prefetch(addr, 0, 1);  // Read, low temporal locality
}

inline void prefetch_nta(const void* addr) noexcept {
    __builtin_prefetch(addr, 0, 0);  // Read, non-temporal (bypass cache)
}

// ============================================================================
// Benchmark: Prefetch Distance
// ============================================================================

struct PrefetchDistanceResult {
    size_t distance;
    double nsPerElement;
    uint64_t l1Misses;
    uint64_t llcMisses;
};

PrefetchDistanceResult benchmarkPrefetchDistance(
    const std::vector<double>& data,
    size_t prefetchDistance,
    size_t iterations,
    bool useVmSafe
) {
    PrefetchDistanceResult result;
    result.distance = prefetchDistance;

    double freqGhz = get_cpu_freq_ghz();
    size_t dataSize = data.size();

    // Warmup
    volatile double sum = 0;
    for (size_t i = 0; i < std::min(dataSize, size_t(10000)); ++i) {
        sum += data[i];
    }

    // Measure with prefetch
    PerfCounterGroup counters;
    counters.add(PerfEvent::L1D_READ_MISS);
    counters.add(PerfEvent::LLC_READ_MISS);

    uint64_t totalCycles = 0;

    {
        ScopedPerfCounters scope(counters);

        for (size_t iter = 0; iter < iterations; ++iter) {
            uint64_t start = useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

            sum = 0;
            for (size_t i = 0; i < dataSize; ++i) {
                // Prefetch ahead
                if (i + prefetchDistance < dataSize) {
                    prefetch_t0(&data[i + prefetchDistance]);
                }
                sum += data[i];
            }

            uint64_t end = useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
            totalCycles += (end - start);
        }
    }

    compiler_barrier();
    volatile double sink = sum;
    (void)sink;

    double totalNs = cycles_to_ns(totalCycles, freqGhz);
    result.nsPerElement = totalNs / (iterations * dataSize);

    auto results = counters.read();
    for (const auto& r : results) {
        if (r.event == PerfEvent::L1D_READ_MISS) result.l1Misses = r.value;
        if (r.event == PerfEvent::LLC_READ_MISS) result.llcMisses = r.value;
    }

    return result;
}

// ============================================================================
// Benchmark: No Prefetch Baseline
// ============================================================================

PrefetchDistanceResult benchmarkNoPrefetch(
    const std::vector<double>& data,
    size_t iterations,
    bool useVmSafe
) {
    PrefetchDistanceResult result;
    result.distance = 0;

    double freqGhz = get_cpu_freq_ghz();
    size_t dataSize = data.size();

    // Warmup
    volatile double sum = 0;
    for (size_t i = 0; i < std::min(dataSize, size_t(10000)); ++i) {
        sum += data[i];
    }

    // Measure without prefetch
    PerfCounterGroup counters;
    counters.add(PerfEvent::L1D_READ_MISS);
    counters.add(PerfEvent::LLC_READ_MISS);

    uint64_t totalCycles = 0;

    {
        ScopedPerfCounters scope(counters);

        for (size_t iter = 0; iter < iterations; ++iter) {
            uint64_t start = useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

            sum = 0;
            for (size_t i = 0; i < dataSize; ++i) {
                sum += data[i];
            }

            uint64_t end = useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
            totalCycles += (end - start);
        }
    }

    compiler_barrier();
    volatile double sink = sum;
    (void)sink;

    double totalNs = cycles_to_ns(totalCycles, freqGhz);
    result.nsPerElement = totalNs / (iterations * dataSize);

    auto results = counters.read();
    for (const auto& r : results) {
        if (r.event == PerfEvent::L1D_READ_MISS) result.l1Misses = r.value;
        if (r.event == PerfEvent::LLC_READ_MISS) result.llcMisses = r.value;
    }

    return result;
}

// ============================================================================
// Benchmark: Prefetch Hint Comparison
// ============================================================================

struct PrefetchHintResult {
    const char* hint;
    double nsPerElement;
    uint64_t l1Misses;
};

template<void (*PrefetchFn)(const void*)>
PrefetchHintResult benchmarkPrefetchHint(
    const std::vector<double>& data,
    const char* hintName,
    size_t prefetchDistance,
    size_t iterations,
    bool useVmSafe
) {
    PrefetchHintResult result;
    result.hint = hintName;

    double freqGhz = get_cpu_freq_ghz();
    size_t dataSize = data.size();

    // Warmup
    volatile double sum = 0;
    for (size_t i = 0; i < std::min(dataSize, size_t(10000)); ++i) {
        sum += data[i];
    }

    // Measure
    PerfCounterGroup counters;
    counters.add(PerfEvent::L1D_READ_MISS);

    uint64_t totalCycles = 0;

    {
        ScopedPerfCounters scope(counters);

        for (size_t iter = 0; iter < iterations; ++iter) {
            uint64_t start = useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

            sum = 0;
            for (size_t i = 0; i < dataSize; ++i) {
                if (i + prefetchDistance < dataSize) {
                    PrefetchFn(&data[i + prefetchDistance]);
                }
                sum += data[i];
            }

            uint64_t end = useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
            totalCycles += (end - start);
        }
    }

    compiler_barrier();
    volatile double sink = sum;
    (void)sink;

    double totalNs = cycles_to_ns(totalCycles, freqGhz);
    result.nsPerElement = totalNs / (iterations * dataSize);

    auto results = counters.read();
    for (const auto& r : results) {
        if (r.event == PerfEvent::L1D_READ_MISS) result.l1Misses = r.value;
    }

    return result;
}

// ============================================================================
// Report Generation
// ============================================================================

void printReport(
    const std::vector<PrefetchDistanceResult>& distanceResults,
    const std::vector<PrefetchHintResult>& hintResults,
    const BenchConfig& config
) {
    std::cout << "\n";
    std::cout << "========================================================\n";
    std::cout << "           PREFETCH TUNING BENCHMARK REPORT\n";
    std::cout << "========================================================\n";
    std::cout << "\n";

    // Configuration
    std::cout << "Configuration:\n";
    std::cout << "  Array size:       " << config.arraySizeMB << " MB\n";
    std::cout << "  Iterations:       " << config.iterations << "\n";
    std::cout << "  VM-safe RDTSC:    " << (config.useVmSafe ? "yes" : "no") << "\n";
    std::cout << "\n";

    // Prefetch Distance Results
    std::cout << std::fixed << std::setprecision(3);
    std::cout << "Prefetch Distance Comparison:\n";
    std::cout << "  ---------------------------------------------------------\n";
    std::cout << "  Distance     ns/elem      L1 Misses      LLC Misses\n";
    std::cout << "  ---------------------------------------------------------\n";

    double baselineNs = distanceResults[0].nsPerElement;
    size_t optimalDistance = 0;
    double minNs = baselineNs;

    for (const auto& r : distanceResults) {
        std::cout << "  " << std::setw(8) << r.distance
                  << std::setw(12) << r.nsPerElement
                  << std::setw(15) << r.l1Misses
                  << std::setw(15) << r.llcMisses;

        if (r.distance == 0) {
            std::cout << "  (baseline)";
        } else if (r.nsPerElement < minNs) {
            minNs = r.nsPerElement;
            optimalDistance = r.distance;
        }
        std::cout << "\n";
    }

    std::cout << "  ---------------------------------------------------------\n";
    std::cout << "\n";

    // Optimal distance
    double improvement = (baselineNs - minNs) / baselineNs * 100;
    std::cout << "Optimal Prefetch Distance:\n";
    std::cout << "  Distance:         " << optimalDistance << " elements\n";
    std::cout << "  Bytes ahead:      " << (optimalDistance * sizeof(double)) << " bytes\n";
    std::cout << "  Cache lines:      " << (optimalDistance * sizeof(double) / 64) << "\n";
    std::cout << "  Improvement:      " << std::setprecision(1) << improvement << " %\n";
    std::cout << "\n";

    // Prefetch Hint Comparison
    std::cout << std::setprecision(3);
    std::cout << "Prefetch Hint Comparison (distance=" << optimalDistance << "):\n";
    std::cout << "  -----------------------------------------\n";
    std::cout << "  Hint          ns/elem      L1 Misses\n";
    std::cout << "  -----------------------------------------\n";

    for (const auto& r : hintResults) {
        std::cout << "  " << std::left << std::setw(12) << r.hint
                  << std::right << std::setw(12) << r.nsPerElement
                  << std::setw(15) << r.l1Misses
                  << "\n";
    }

    std::cout << "  -----------------------------------------\n";
    std::cout << "\n";

    // Target Comparison
    std::cout << "Target Comparison:\n";
    std::cout << "  Prefetch improvement: " << improvement << " %";
    std::cout << (improvement > 10 ? " [Prefetch effective]" : " [May not need prefetch]") << "\n";
    std::cout << "\n";
    std::cout << "========================================================\n";
}

// ============================================================================
// Main
// ============================================================================

void printUsage(const char* prog) {
    std::cerr << "Usage: " << prog << " [options]\n";
    std::cerr << "\n";
    std::cerr << "Options:\n";
    std::cerr << "  --size N        Array size in MB (default: 64)\n";
    std::cerr << "  --iterations N  Iterations (default: 100)\n";
    std::cerr << "  --vm-safe       Use VM-safe RDTSC\n";
    std::cerr << "  --cpu N         Bind to CPU core N\n";
    std::cerr << "  --help          Show this help\n";
}

int main(int argc, char* argv[]) {
    BenchConfig config;

    // Parse arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if (arg == "--help" || arg == "-h") {
            printUsage(argv[0]);
            return 0;
        } else if (arg == "--size" && i + 1 < argc) {
            config.arraySizeMB = std::stoull(argv[++i]);
        } else if (arg == "--iterations" && i + 1 < argc) {
            config.iterations = std::stoull(argv[++i]);
        } else if (arg == "--vm-safe") {
            config.useVmSafe = true;
        } else if (arg == "--cpu" && i + 1 < argc) {
            config.cpuCore = std::stoi(argv[++i]);
        }
    }

    // Auto-detect virtualization
    if (!config.useVmSafe && is_virtualized()) {
        std::cout << "Note: Virtualized environment detected, using VM-safe RDTSC\n";
        config.useVmSafe = true;
    }

    // CPU affinity
    if (config.cpuCore >= 0) {
        if (bind_to_core(config.cpuCore)) {
            std::cout << "Bound to CPU core " << config.cpuCore << "\n";
        } else {
            std::cerr << "Warning: Failed to bind to CPU core " << config.cpuCore << "\n";
        }
    }

    // Allocate test data
    size_t elementCount = config.arraySizeMB * 1024 * 1024 / sizeof(double);
    std::vector<double> data(elementCount);

    // Initialize with random data
    std::mt19937 rng(42);
    std::uniform_real_distribution<double> dist(0.0, 1.0);
    for (size_t i = 0; i < elementCount; ++i) {
        data[i] = dist(rng);
    }

    std::cout << "Running prefetch tuning benchmarks...\n";
    std::cout << "Array: " << elementCount << " elements (" << config.arraySizeMB << " MB)\n";

    // Test different prefetch distances
    std::vector<PrefetchDistanceResult> distanceResults;

    // Baseline (no prefetch)
    distanceResults.push_back(benchmarkNoPrefetch(data, config.iterations, config.useVmSafe));

    // Various distances (in elements, 8 bytes each)
    std::vector<size_t> distances = {8, 16, 32, 64, 128, 256, 512, 1024};
    for (size_t d : distances) {
        distanceResults.push_back(
            benchmarkPrefetchDistance(data, d, config.iterations, config.useVmSafe));
    }

    // Find optimal distance
    size_t optimalDistance = 64;  // Default
    double minNs = distanceResults[0].nsPerElement;
    for (const auto& r : distanceResults) {
        if (r.distance > 0 && r.nsPerElement < minNs) {
            minNs = r.nsPerElement;
            optimalDistance = r.distance;
        }
    }

    // Test different prefetch hints with optimal distance
    std::vector<PrefetchHintResult> hintResults;
    hintResults.push_back(
        benchmarkPrefetchHint<prefetch_t0>(data, "T0 (L1)", optimalDistance, config.iterations, config.useVmSafe));
    hintResults.push_back(
        benchmarkPrefetchHint<prefetch_t1>(data, "T1 (L2)", optimalDistance, config.iterations, config.useVmSafe));
    hintResults.push_back(
        benchmarkPrefetchHint<prefetch_t2>(data, "T2 (L3)", optimalDistance, config.iterations, config.useVmSafe));
    hintResults.push_back(
        benchmarkPrefetchHint<prefetch_nta>(data, "NTA", optimalDistance, config.iterations, config.useVmSafe));

    // Print report
    printReport(distanceResults, hintResults, config);

    return 0;
}
