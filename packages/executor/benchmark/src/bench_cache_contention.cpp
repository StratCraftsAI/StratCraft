/**
 * @file bench_cache_contention.cpp
 * @brief Cache contention and false sharing benchmark
 *
 * Reference: TICKET_174 - C++ Executor Benchmark Framework
 * Reference: modernc_quant.md #9 - Cache-line Alignment
 *
 * Benchmarks:
 * - False sharing detection
 * - Cache-line padding effectiveness
 * - L1/L2/LLC behavior
 * - Multi-threaded contention
 */

#include "benchmark_utils.hpp"
#include "perf_counters.hpp"

#include <iostream>
#include <iomanip>
#include <thread>
#include <vector>
#include <atomic>
#include <cstring>

using namespace qnx::bench;

// ============================================================================
// Configuration
// ============================================================================

struct BenchConfig {
    size_t iterations = 10000000;
    size_t numThreads = 4;
    size_t warmupIterations = 1000000;
    bool useVmSafe = false;
};

// ============================================================================
// Test Structures: False Sharing vs Padded
// ============================================================================

// BAD: Counters on same cache line cause false sharing
struct CountersBad {
    std::atomic<uint64_t> counter1{0};
    std::atomic<uint64_t> counter2{0};
    std::atomic<uint64_t> counter3{0};
    std::atomic<uint64_t> counter4{0};
};

// GOOD: Each counter on its own cache line
struct alignas(64) PaddedCounter {
    std::atomic<uint64_t> value{0};
    char padding[64 - sizeof(std::atomic<uint64_t>)];
};

struct CountersGood {
    PaddedCounter counter1;
    PaddedCounter counter2;
    PaddedCounter counter3;
    PaddedCounter counter4;
};

// ============================================================================
// Benchmark: False Sharing
// ============================================================================

struct FalseSharingResult {
    double badNsPerOp = 0;
    double goodNsPerOp = 0;
    double speedup = 0;
    uint64_t badL1Misses = 0;
    uint64_t goodL1Misses = 0;
};

void incrementWorkerBad(CountersBad* counters, int id, size_t iterations) {
    std::atomic<uint64_t>* counter = nullptr;
    switch (id % 4) {
        case 0: counter = &counters->counter1; break;
        case 1: counter = &counters->counter2; break;
        case 2: counter = &counters->counter3; break;
        case 3: counter = &counters->counter4; break;
    }

    for (size_t i = 0; i < iterations; ++i) {
        counter->fetch_add(1, std::memory_order_relaxed);
    }
}

void incrementWorkerGood(CountersGood* counters, int id, size_t iterations) {
    PaddedCounter* counter = nullptr;
    switch (id % 4) {
        case 0: counter = &counters->counter1; break;
        case 1: counter = &counters->counter2; break;
        case 2: counter = &counters->counter3; break;
        case 3: counter = &counters->counter4; break;
    }

    for (size_t i = 0; i < iterations; ++i) {
        counter->value.fetch_add(1, std::memory_order_relaxed);
    }
}

FalseSharingResult benchmarkFalseSharing(const BenchConfig& config) {
    FalseSharingResult result;

    double freqGhz = get_cpu_freq_ghz();

    // BAD: False sharing
    {
        CountersBad counters;
        std::vector<std::thread> threads;

        PerfCounterGroup perfCounters;
        perfCounters.add(PerfEvent::L1D_READ_MISS);

        uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        {
            ScopedPerfCounters scope(perfCounters);

            for (size_t i = 0; i < config.numThreads; ++i) {
                threads.emplace_back(incrementWorkerBad, &counters, static_cast<int>(i),
                                     config.iterations / config.numThreads);
            }

            for (auto& t : threads) {
                t.join();
            }
        }
        uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        double totalNs = cycles_to_ns(end - start, freqGhz);
        result.badNsPerOp = totalNs / config.iterations;

        auto results = perfCounters.read();
        for (const auto& r : results) {
            if (r.event == PerfEvent::L1D_READ_MISS) {
                result.badL1Misses = r.value;
            }
        }
    }

    // GOOD: Padded (no false sharing)
    {
        CountersGood counters;
        std::vector<std::thread> threads;

        PerfCounterGroup perfCounters;
        perfCounters.add(PerfEvent::L1D_READ_MISS);

        uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        {
            ScopedPerfCounters scope(perfCounters);

            for (size_t i = 0; i < config.numThreads; ++i) {
                threads.emplace_back(incrementWorkerGood, &counters, static_cast<int>(i),
                                     config.iterations / config.numThreads);
            }

            for (auto& t : threads) {
                t.join();
            }
        }
        uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        double totalNs = cycles_to_ns(end - start, freqGhz);
        result.goodNsPerOp = totalNs / config.iterations;

        auto results = perfCounters.read();
        for (const auto& r : results) {
            if (r.event == PerfEvent::L1D_READ_MISS) {
                result.goodL1Misses = r.value;
            }
        }
    }

    result.speedup = result.badNsPerOp / std::max(result.goodNsPerOp, 0.001);

    return result;
}

// ============================================================================
// Benchmark: Sequential Access vs Strided Access
// ============================================================================

struct StrideResult {
    double sequentialNsPerOp = 0;
    double stridedNsPerOp = 0;
    double slowdown = 0;
    uint64_t sequentialL1Misses = 0;
    uint64_t stridedL1Misses = 0;
};

StrideResult benchmarkStrideAccess(const BenchConfig& config) {
    StrideResult result;

    constexpr size_t ARRAY_SIZE = 64 * 1024 * 1024;  // 64MB
    std::vector<char> data(ARRAY_SIZE);

    // Initialize
    for (size_t i = 0; i < ARRAY_SIZE; ++i) {
        data[i] = static_cast<char>(i & 0xFF);
    }

    double freqGhz = get_cpu_freq_ghz();
    size_t iterations = config.iterations / 100;  // Fewer iterations for memory test

    // Sequential access
    {
        PerfCounterGroup perfCounters;
        perfCounters.add(PerfEvent::L1D_READ_MISS);

        uint64_t sum = 0;
        uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        {
            ScopedPerfCounters scope(perfCounters);

            for (size_t iter = 0; iter < iterations; ++iter) {
                for (size_t i = 0; i < 4096; ++i) {
                    sum += data[i];
                }
            }
        }
        uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        compiler_barrier();
        volatile uint64_t sink = sum;
        (void)sink;

        double totalNs = cycles_to_ns(end - start, freqGhz);
        result.sequentialNsPerOp = totalNs / (iterations * 4096);

        auto results = perfCounters.read();
        for (const auto& r : results) {
            if (r.event == PerfEvent::L1D_READ_MISS) {
                result.sequentialL1Misses = r.value;
            }
        }
    }

    // Strided access (cache-line stride = 64 bytes)
    {
        PerfCounterGroup perfCounters;
        perfCounters.add(PerfEvent::L1D_READ_MISS);

        uint64_t sum = 0;
        uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        {
            ScopedPerfCounters scope(perfCounters);

            for (size_t iter = 0; iter < iterations; ++iter) {
                for (size_t i = 0; i < 4096; ++i) {
                    sum += data[i * 64 % ARRAY_SIZE];  // Stride = 64 bytes
                }
            }
        }
        uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        compiler_barrier();
        volatile uint64_t sink = sum;
        (void)sink;

        double totalNs = cycles_to_ns(end - start, freqGhz);
        result.stridedNsPerOp = totalNs / (iterations * 4096);

        auto results = perfCounters.read();
        for (const auto& r : results) {
            if (r.event == PerfEvent::L1D_READ_MISS) {
                result.stridedL1Misses = r.value;
            }
        }
    }

    result.slowdown = result.stridedNsPerOp / std::max(result.sequentialNsPerOp, 0.001);

    return result;
}

// ============================================================================
// Benchmark: Structure Padding Verification
// ============================================================================

struct PaddingVerification {
    bool countersBadOnSameLine = false;
    bool countersGoodSeparate = false;
    size_t countersBadSize = 0;
    size_t countersGoodSize = 0;
};

PaddingVerification verifyPadding() {
    PaddingVerification result;

    result.countersBadSize = sizeof(CountersBad);
    result.countersGoodSize = sizeof(CountersGood);

    // Bad counters should fit in one or two cache lines
    result.countersBadOnSameLine = (sizeof(CountersBad) <= 64);

    // Good counters should have each on separate cache line
    result.countersGoodSeparate = (sizeof(PaddedCounter) == 64) &&
                                   (sizeof(CountersGood) == 4 * 64);

    return result;
}

// ============================================================================
// Report Generation
// ============================================================================

void printReport(const FalseSharingResult& falseSharing,
                 const StrideResult& stride,
                 const PaddingVerification& padding,
                 const BenchConfig& config) {
    std::cout << "\n";
    std::cout << "========================================================\n";
    std::cout << "         CACHE CONTENTION BENCHMARK REPORT\n";
    std::cout << "========================================================\n";
    std::cout << "\n";

    // Configuration
    std::cout << "Configuration:\n";
    std::cout << "  Iterations:       " << config.iterations << "\n";
    std::cout << "  Threads:          " << config.numThreads << "\n";
    std::cout << "  VM-safe RDTSC:    " << (config.useVmSafe ? "yes" : "no") << "\n";
    std::cout << "\n";

    // Structure Padding
    std::cout << "Structure Padding Verification:\n";
    std::cout << "  CountersBad size:     " << padding.countersBadSize << " bytes";
    std::cout << (padding.countersBadOnSameLine ? " (fits in 1 cache line - BAD)" : "") << "\n";
    std::cout << "  CountersGood size:    " << padding.countersGoodSize << " bytes";
    std::cout << (padding.countersGoodSeparate ? " (each on own cache line - GOOD)" : "") << "\n";
    std::cout << "  PaddedCounter size:   " << sizeof(PaddedCounter) << " bytes\n";
    std::cout << "\n";

    // False Sharing Results
    std::cout << std::fixed << std::setprecision(2);
    std::cout << "False Sharing Test:\n";
    std::cout << "  -----------------------------------------------------\n";
    std::cout << "  Metric              Unpadded        Padded       Ratio\n";
    std::cout << "  -----------------------------------------------------\n";
    std::cout << "  ns/op          " << std::setw(12) << falseSharing.badNsPerOp
              << "    " << std::setw(12) << falseSharing.goodNsPerOp
              << "    " << std::setw(6) << falseSharing.speedup << "x\n";
    std::cout << "  L1D misses     " << std::setw(12) << falseSharing.badL1Misses
              << "    " << std::setw(12) << falseSharing.goodL1Misses
              << "    " << std::setw(6) << (falseSharing.badL1Misses / std::max(falseSharing.goodL1Misses, 1UL)) << "x\n";
    std::cout << "  -----------------------------------------------------\n";
    std::cout << "\n";

    // Stride Access Results
    std::cout << "Stride Access Test:\n";
    std::cout << "  Sequential ns/op:     " << stride.sequentialNsPerOp << "\n";
    std::cout << "  Strided (64B) ns/op:  " << stride.stridedNsPerOp << "\n";
    std::cout << "  Slowdown:             " << stride.slowdown << "x\n";
    std::cout << "  Sequential L1 misses: " << stride.sequentialL1Misses << "\n";
    std::cout << "  Strided L1 misses:    " << stride.stridedL1Misses << "\n";
    std::cout << "\n";

    // Target Comparison
    std::cout << "Target Comparison:\n";
    std::cout << "  False sharing speedup: " << falseSharing.speedup << "x";
    std::cout << (falseSharing.speedup > 2.0 ? " [Padding effective]" : " [May need more testing]") << "\n";
    std::cout << "  Stride slowdown:       " << stride.slowdown << "x";
    std::cout << (stride.slowdown > 5.0 ? " [Striding hurts cache]" : " [Cache still effective]") << "\n";
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
    std::cerr << "  --iterations N  Iterations (default: 10000000)\n";
    std::cerr << "  --threads N     Thread count (default: 4)\n";
    std::cerr << "  --vm-safe       Use VM-safe RDTSC\n";
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
        } else if (arg == "--iterations" && i + 1 < argc) {
            config.iterations = std::stoull(argv[++i]);
        } else if (arg == "--threads" && i + 1 < argc) {
            config.numThreads = std::stoull(argv[++i]);
        } else if (arg == "--vm-safe") {
            config.useVmSafe = true;
        }
    }

    // Auto-detect virtualization
    if (!config.useVmSafe && is_virtualized()) {
        std::cout << "Note: Virtualized environment detected, using VM-safe RDTSC\n";
        config.useVmSafe = true;
    }

    // Run benchmarks
    std::cout << "Running cache contention benchmarks...\n";

    auto padding = verifyPadding();
    auto falseSharing = benchmarkFalseSharing(config);
    auto stride = benchmarkStrideAccess(config);

    // Print report
    printReport(falseSharing, stride, padding, config);

    return 0;
}
