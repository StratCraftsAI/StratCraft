/**
 * Memory Pool Benchmark
 *
 * TICKET_175 Phase 2: Memory Sovereignty
 *
 * Benchmarks PMR monotonic buffer vs standard allocator:
 * - Allocation throughput
 * - Cache behavior
 * - Memory fragmentation
 */

#include "../include/benchmark_utils.hpp"
#include "../include/memory_tracker.hpp"
#include "../include/perf_counters.hpp"

#include "quantnexus/executor/memory_pool.hpp"

#include <iostream>
#include <iomanip>
#include <vector>
#include <memory_resource>
#include <chrono>
#include <numeric>

using namespace qnx::bench;
using namespace StratCraft::executor;

// =============================================================================
// Configuration
// =============================================================================

struct BenchConfig {
    size_t arenaSize = 256 * 1024 * 1024;  // 256MB arena (larger for PMR)
    size_t vectorCount = 100;               // Number of vectors to allocate
    size_t elementsPerVector = 10000;       // Elements per vector
    size_t warmupIters = 5;
    size_t measureIters = 50;
    bool vmSafe = false;
};

// =============================================================================
// Benchmark: Standard Allocator
// =============================================================================

struct AllocResult {
    double allocTimeNs;
    double accessTimeNs;
    double deallocTimeNs;
    size_t totalBytes;
    uint64_t l1Misses;
};

AllocResult benchmarkStdAllocator(const BenchConfig& config) {
    AllocResult result{};

    std::vector<std::vector<double>> vectors;
    vectors.reserve(config.vectorCount);

    // Warmup
    for (size_t i = 0; i < config.warmupIters; ++i) {
        vectors.clear();
        for (size_t j = 0; j < config.vectorCount; ++j) {
            vectors.emplace_back(config.elementsPerVector, 1.0);
        }
    }

    // Measure allocation
    std::vector<double> allocTimes;
    allocTimes.reserve(config.measureIters);

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        vectors.clear();

        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        for (size_t j = 0; j < config.vectorCount; ++j) {
            vectors.emplace_back(config.elementsPerVector, 1.0);
        }

        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        allocTimes.push_back(cycles_to_ns(end - start));
    }

    std::sort(allocTimes.begin(), allocTimes.end());
    result.allocTimeNs = allocTimes[allocTimes.size() / 2];  // P50

    // Measure access (sequential sum)
    std::vector<double> accessTimes;
    accessTimes.reserve(config.measureIters);

    PerfCounterGroup counters;
    counters.add(PerfEvent::L1D_READ_MISS);
    counters.start();

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        volatile double sum = 0;

        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        for (const auto& vec : vectors) {
            for (double val : vec) {
                sum += val;
            }
        }

        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        accessTimes.push_back(cycles_to_ns(end - start));
    }

    counters.stop();
    std::sort(accessTimes.begin(), accessTimes.end());
    result.accessTimeNs = accessTimes[accessTimes.size() / 2];
    auto counterResults = counters.read();
    result.l1Misses = counterResults.empty() ? 0 : counterResults[0].value;

    // Calculate total bytes
    result.totalBytes = config.vectorCount * config.elementsPerVector * sizeof(double);

    return result;
}

// =============================================================================
// Benchmark: PMR Monotonic Buffer
// =============================================================================

AllocResult benchmarkPMRAllocator(const BenchConfig& config) {
    AllocResult result{};

    // Measure allocation
    std::vector<double> allocTimes;
    allocTimes.reserve(config.measureIters);

    // Warmup
    for (size_t i = 0; i < config.warmupIters; ++i) {
        MemoryArena arena(config.arenaSize, true);
        std::vector<std::pmr::vector<double>> vectors;
        vectors.reserve(config.vectorCount);
        for (size_t j = 0; j < config.vectorCount; ++j) {
            vectors.emplace_back(config.elementsPerVector, 1.0, &arena.pool());
        }
    }

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        MemoryArena arena(config.arenaSize, true);
        std::vector<std::pmr::vector<double>> vectors;
        vectors.reserve(config.vectorCount);

        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        for (size_t j = 0; j < config.vectorCount; ++j) {
            vectors.emplace_back(config.elementsPerVector, 1.0, &arena.pool());
        }

        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        allocTimes.push_back(cycles_to_ns(end - start));
    }

    std::sort(allocTimes.begin(), allocTimes.end());
    result.allocTimeNs = allocTimes[allocTimes.size() / 2];

    // For access test, create fresh arena and vectors
    MemoryArena arena(config.arenaSize, true);
    std::vector<std::pmr::vector<double>> vectors;
    vectors.reserve(config.vectorCount);
    for (size_t j = 0; j < config.vectorCount; ++j) {
        vectors.emplace_back(config.elementsPerVector, 1.0, &arena.pool());
    }

    // Measure access
    std::vector<double> accessTimes;
    accessTimes.reserve(config.measureIters);

    PerfCounterGroup counters;
    counters.add(PerfEvent::L1D_READ_MISS);
    counters.start();

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        volatile double sum = 0;

        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        for (const auto& vec : vectors) {
            for (double val : vec) {
                sum += val;
            }
        }

        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        accessTimes.push_back(cycles_to_ns(end - start));
    }

    counters.stop();
    std::sort(accessTimes.begin(), accessTimes.end());
    result.accessTimeNs = accessTimes[accessTimes.size() / 2];
    auto counterResults2 = counters.read();
    result.l1Misses = counterResults2.empty() ? 0 : counterResults2[0].value;

    result.totalBytes = config.vectorCount * config.elementsPerVector * sizeof(double);

    return result;
}

// =============================================================================
// Benchmark: Cache-Aligned Allocator
// =============================================================================

AllocResult benchmarkCacheAligned(const BenchConfig& config) {
    AllocResult result{};

    std::vector<CacheAlignedVector<double>> vectors;
    vectors.reserve(config.vectorCount);

    // Warmup
    for (size_t i = 0; i < config.warmupIters; ++i) {
        vectors.clear();
        for (size_t j = 0; j < config.vectorCount; ++j) {
            vectors.emplace_back(config.elementsPerVector, 1.0);
        }
    }

    // Measure allocation
    std::vector<double> allocTimes;
    allocTimes.reserve(config.measureIters);

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        vectors.clear();

        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        for (size_t j = 0; j < config.vectorCount; ++j) {
            vectors.emplace_back(config.elementsPerVector, 1.0);
        }

        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        allocTimes.push_back(cycles_to_ns(end - start));
    }

    std::sort(allocTimes.begin(), allocTimes.end());
    result.allocTimeNs = allocTimes[allocTimes.size() / 2];

    // Measure access
    std::vector<double> accessTimes;
    accessTimes.reserve(config.measureIters);

    PerfCounterGroup counters3;
    counters3.add(PerfEvent::L1D_READ_MISS);
    counters3.start();

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        volatile double sum = 0;

        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        for (const auto& vec : vectors) {
            for (double val : vec) {
                sum += val;
            }
        }

        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        accessTimes.push_back(cycles_to_ns(end - start));
    }

    counters3.stop();
    std::sort(accessTimes.begin(), accessTimes.end());
    result.accessTimeNs = accessTimes[accessTimes.size() / 2];
    auto counterResults3 = counters3.read();
    result.l1Misses = counterResults3.empty() ? 0 : counterResults3[0].value;

    result.totalBytes = config.vectorCount * config.elementsPerVector * sizeof(double);

    return result;
}

// =============================================================================
// Main
// =============================================================================

void printReport(const BenchConfig& config,
                 const AllocResult& stdResult,
                 const AllocResult& pmrResult,
                 const AllocResult& alignedResult) {

    std::cout << "\n========================================================\n";
    std::cout << "           MEMORY POOL BENCHMARK REPORT\n";
    std::cout << "========================================================\n\n";

    std::cout << "Configuration:\n";
    std::cout << "  Arena size:         " << config.arenaSize / (1024*1024) << " MB\n";
    std::cout << "  Vector count:       " << config.vectorCount << "\n";
    std::cout << "  Elements/vector:    " << config.elementsPerVector << "\n";
    std::cout << "  Total data:         " << stdResult.totalBytes / (1024*1024) << " MB\n";
    std::cout << "  Warmup iters:       " << config.warmupIters << "\n";
    std::cout << "  Measure iters:      " << config.measureIters << "\n";
    std::cout << "  VM-safe RDTSC:      " << (config.vmSafe ? "yes" : "no") << "\n\n";

    std::cout << std::fixed << std::setprecision(2);

    std::cout << "Allocation Time Comparison:\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  Allocator           Time (ms)        Speedup\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  std::allocator      " << std::setw(10) << stdResult.allocTimeNs / 1e6
              << "         (baseline)\n";
    std::cout << "  PMR monotonic       " << std::setw(10) << pmrResult.allocTimeNs / 1e6
              << "         " << std::setw(6) << stdResult.allocTimeNs / pmrResult.allocTimeNs << "x\n";
    std::cout << "  Cache-aligned       " << std::setw(10) << alignedResult.allocTimeNs / 1e6
              << "         " << std::setw(6) << stdResult.allocTimeNs / alignedResult.allocTimeNs << "x\n";
    std::cout << "  --------------------------------------------------------\n\n";

    std::cout << "Access Time Comparison:\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  Allocator           Time (ms)    L1 Misses     Speedup\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  std::allocator      " << std::setw(10) << stdResult.accessTimeNs / 1e6
              << "  " << std::setw(10) << stdResult.l1Misses << "    (baseline)\n";
    std::cout << "  PMR monotonic       " << std::setw(10) << pmrResult.accessTimeNs / 1e6
              << "  " << std::setw(10) << pmrResult.l1Misses
              << "    " << std::setw(6) << stdResult.accessTimeNs / pmrResult.accessTimeNs << "x\n";
    std::cout << "  Cache-aligned       " << std::setw(10) << alignedResult.accessTimeNs / 1e6
              << "  " << std::setw(10) << alignedResult.l1Misses
              << "    " << std::setw(6) << stdResult.accessTimeNs / alignedResult.accessTimeNs << "x\n";
    std::cout << "  --------------------------------------------------------\n\n";

    // Calculate throughput
    double stdThroughput = stdResult.totalBytes / (stdResult.allocTimeNs / 1e9) / (1024*1024*1024);
    double pmrThroughput = stdResult.totalBytes / (pmrResult.allocTimeNs / 1e9) / (1024*1024*1024);

    std::cout << "Throughput:\n";
    std::cout << "  std::allocator:     " << std::setw(6) << stdThroughput << " GB/s\n";
    std::cout << "  PMR monotonic:      " << std::setw(6) << pmrThroughput << " GB/s\n\n";

    // Target comparison
    double pmrSpeedup = stdResult.allocTimeNs / pmrResult.allocTimeNs;
    std::cout << "Target Comparison:\n";
    std::cout << "  PMR speedup:        " << std::setw(6) << pmrSpeedup << "x ";
    if (pmrSpeedup > 2.0) {
        std::cout << "[PMR effective]\n";
    } else {
        std::cout << "[May need tuning]\n";
    }

    std::cout << "\n========================================================\n";
}

int main(int argc, char* argv[]) {
    BenchConfig config;

    // Parse arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--vm-safe") {
            config.vmSafe = true;
        } else if (arg.starts_with("--vectors=")) {
            config.vectorCount = std::stoul(arg.substr(10));
        } else if (arg.starts_with("--elements=")) {
            config.elementsPerVector = std::stoul(arg.substr(11));
        } else if (arg.starts_with("--iterations=")) {
            config.measureIters = std::stoul(arg.substr(13));
        }
    }

    std::cout << "Running memory pool benchmarks...\n";

    // Run benchmarks
    auto stdResult = benchmarkStdAllocator(config);
    auto pmrResult = benchmarkPMRAllocator(config);
    auto alignedResult = benchmarkCacheAligned(config);

    // Print report
    printReport(config, stdResult, pmrResult, alignedResult);

    return 0;
}
