/**
 * @file bench_data_loading.cpp
 * @brief Data loading benchmark
 *
 * Reference: TICKET_174 - C++ Executor Benchmark Framework
 * Reference: modernc_quant.md #51 - Arrow Columnar Access
 *
 * Benchmarks:
 * - Parquet file loading latency
 * - Memory allocation during load
 * - Zero-copy efficiency
 */

#include "benchmark_utils.hpp"
#include "memory_tracker.hpp"
#include "perf_counters.hpp"

#include <quantnexus/executor/data_source.hpp>
#include <quantnexus/executor/config_types.hpp>

#include <iostream>
#include <iomanip>
#include <filesystem>
#include <cstdlib>

using namespace qnx::bench;
using namespace StratCraft::executor;

namespace fs = std::filesystem;

// ============================================================================
// Configuration
// ============================================================================

struct BenchConfig {
    std::string dataPath;
    size_t warmupIterations = 10;
    size_t measureIterations = 100;
    bool useVmSafe = false;
    int cpuCore = -1;  // -1 = no affinity
};

// ============================================================================
// Benchmark: Cold vs Warm Loading
// ============================================================================

struct LoadResult {
    LatencyStats coldStats;
    LatencyStats warmStats;
    size_t rowsLoaded = 0;
    size_t allocsDuringLoad = 0;
    size_t bytesDuringLoad = 0;
};

LoadResult benchmarkLoading(const BenchConfig& config) {
    LoadResult result;

    auto dataSource = createDataSource("parquet");

    DataConfig dataConfig{
        .symbol = "BENCHMARK",
        .interval = "1m",
        .startTime = 0,
        .endTime = 0,
        .dataPath = config.dataPath,
        .dataSourceType = "parquet"
    };

    // Cold load (first time, cache not primed)
    {
        std::vector<double> coldSamples;
        coldSamples.reserve(config.measureIterations);

        double freqGhz = get_cpu_freq_ghz();

        for (size_t i = 0; i < config.measureIterations; ++i) {
            // Drop page cache between iterations for true cold measurement
            // Note: Requires sudo, skip if not available
            if (i == 0) {
                [[maybe_unused]] int ret = std::system("sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null");
            }

            ScopedMemoryTracker memTrack;

            uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
            compiler_barrier();
            auto df = dataSource->loadData(dataConfig);
            compiler_barrier();
            uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

            coldSamples.push_back(cycles_to_ns(end - start, freqGhz));

            if (i == 0) {
                result.rowsLoaded = df.size();
                result.allocsDuringLoad = memTrack.allocations();
                result.bytesDuringLoad = memTrack.bytes_allocated();
            }
        }

        result.coldStats.compute(coldSamples);
    }

    // Warmup
    for (size_t i = 0; i < config.warmupIterations; ++i) {
        auto df = dataSource->loadData(dataConfig);
        compiler_barrier();
    }

    // Warm load (cache primed)
    {
        std::vector<double> warmSamples;
        warmSamples.reserve(config.measureIterations);

        double freqGhz = get_cpu_freq_ghz();

        for (size_t i = 0; i < config.measureIterations; ++i) {
            uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
            compiler_barrier();
            auto df = dataSource->loadData(dataConfig);
            compiler_barrier();
            uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

            warmSamples.push_back(cycles_to_ns(end - start, freqGhz));
        }

        result.warmStats.compute(warmSamples);
    }

    return result;
}

// ============================================================================
// Benchmark: Hot Path Allocation Audit
// ============================================================================

struct AllocationAuditResult {
    size_t hotPathAllocations = 0;
    size_t hotPathBytes = 0;
    bool passed = false;
};

AllocationAuditResult benchmarkHotPathAllocations(const BenchConfig& config) {
    AllocationAuditResult result;

    auto dataSource = createDataSource("parquet");

    DataConfig dataConfig{
        .symbol = "BENCHMARK",
        .interval = "1m",
        .startTime = 0,
        .endTime = 0,
        .dataPath = config.dataPath,
        .dataSourceType = "parquet"
    };

    // Warmup (allocations here are allowed)
    for (size_t i = 0; i < config.warmupIterations; ++i) {
        auto df = dataSource->loadData(dataConfig);
        compiler_barrier();
    }

    // Hot path audit
    {
        ScopedHotPathAudit audit;

        for (size_t i = 0; i < 10; ++i) {
            auto df = dataSource->loadData(dataConfig);
            compiler_barrier();
        }

        result.hotPathAllocations = audit.violation_count();
        result.passed = audit.passed();
    }

    return result;
}

// ============================================================================
// Benchmark: Hardware Counters
// ============================================================================

struct HwCounterResult {
    uint64_t cycles = 0;
    uint64_t instructions = 0;
    uint64_t cacheMisses = 0;
    uint64_t l1dMisses = 0;
    uint64_t dtlbMisses = 0;
    double ipc = 0;
    double cyclesPerBar = 0;
};

HwCounterResult benchmarkHwCounters(const BenchConfig& config) {
    HwCounterResult result;

    auto dataSource = createDataSource("parquet");

    DataConfig dataConfig{
        .symbol = "BENCHMARK",
        .interval = "1m",
        .startTime = 0,
        .endTime = 0,
        .dataPath = config.dataPath,
        .dataSourceType = "parquet"
    };

    // Warmup
    for (size_t i = 0; i < config.warmupIterations; ++i) {
        auto df = dataSource->loadData(dataConfig);
        compiler_barrier();
    }

    // Measure with hardware counters
    PerfCounterGroup counters;
    counters.add_standard_set();

    size_t totalBars = 0;

    {
        ScopedPerfCounters scope(counters);

        for (size_t i = 0; i < config.measureIterations; ++i) {
            auto df = dataSource->loadData(dataConfig);
            compiler_barrier();
            totalBars += df.size();
        }
    }

    auto results = counters.read();
    auto metrics = DerivedMetrics::compute(results);

    for (const auto& r : results) {
        switch (r.event) {
            case PerfEvent::CPU_CYCLES:
                result.cycles = r.value;
                break;
            case PerfEvent::INSTRUCTIONS:
                result.instructions = r.value;
                break;
            case PerfEvent::CACHE_MISSES:
                result.cacheMisses = r.value;
                break;
            case PerfEvent::L1D_READ_MISS:
                result.l1dMisses = r.value;
                break;
            case PerfEvent::DTLB_READ_MISS:
                result.dtlbMisses = r.value;
                break;
            default:
                break;
        }
    }

    result.ipc = metrics.ipc;
    result.cyclesPerBar = totalBars > 0
        ? static_cast<double>(result.cycles) / totalBars
        : 0;

    return result;
}

// ============================================================================
// Report Generation
// ============================================================================

void printReport(const LoadResult& load, const AllocationAuditResult& alloc,
                 const HwCounterResult& hw, const BenchConfig& config) {
    std::cout << "\n";
    std::cout << "========================================================\n";
    std::cout << "           DATA LOADING BENCHMARK REPORT\n";
    std::cout << "========================================================\n";
    std::cout << "\n";

    // Configuration
    std::cout << "Configuration:\n";
    std::cout << "  Data file:        " << config.dataPath << "\n";
    std::cout << "  Rows loaded:      " << load.rowsLoaded << "\n";
    std::cout << "  Warmup iters:     " << config.warmupIterations << "\n";
    std::cout << "  Measure iters:    " << config.measureIterations << "\n";
    std::cout << "  VM-safe RDTSC:    " << (config.useVmSafe ? "yes" : "no") << "\n";
    std::cout << "\n";

    // Cold vs Warm Latency
    std::cout << "Latency (nanoseconds):\n";
    std::cout << std::fixed << std::setprecision(2);
    std::cout << "  -------------------------------------------------------\n";
    std::cout << "  Metric          Cold            Warm           Ratio\n";
    std::cout << "  -------------------------------------------------------\n";
    std::cout << "  Min        " << std::setw(12) << load.coldStats.min_ns
              << "    " << std::setw(12) << load.warmStats.min_ns
              << "    " << std::setw(6) << (load.coldStats.min_ns / std::max(load.warmStats.min_ns, 0.001)) << "x\n";
    std::cout << "  P50        " << std::setw(12) << load.coldStats.p50_ns
              << "    " << std::setw(12) << load.warmStats.p50_ns
              << "    " << std::setw(6) << (load.coldStats.p50_ns / std::max(load.warmStats.p50_ns, 0.001)) << "x\n";
    std::cout << "  P99        " << std::setw(12) << load.coldStats.p99_ns
              << "    " << std::setw(12) << load.warmStats.p99_ns
              << "    " << std::setw(6) << (load.coldStats.p99_ns / std::max(load.warmStats.p99_ns, 0.001)) << "x\n";
    std::cout << "  Max        " << std::setw(12) << load.coldStats.max_ns
              << "    " << std::setw(12) << load.warmStats.max_ns
              << "    " << std::setw(6) << (load.coldStats.max_ns / std::max(load.warmStats.max_ns, 0.001)) << "x\n";
    std::cout << "  -------------------------------------------------------\n";
    std::cout << "\n";

    // Allocation Audit
    std::cout << "Allocation Audit:\n";
    std::cout << "  Hot path allocations: " << alloc.hotPathAllocations << "\n";
    std::cout << "  Status:               " << (alloc.passed ? "PASSED" : "FAILED") << "\n";
    std::cout << "\n";

    // Hardware Counters
    std::cout << "Hardware Counters (total across " << config.measureIterations << " iterations):\n";
    std::cout << "  CPU Cycles:       " << hw.cycles << "\n";
    std::cout << "  Instructions:     " << hw.instructions << "\n";
    std::cout << "  IPC:              " << std::setprecision(3) << hw.ipc << "\n";
    std::cout << "  Cache Misses:     " << hw.cacheMisses << "\n";
    std::cout << "  L1D Misses:       " << hw.l1dMisses << "\n";
    std::cout << "  dTLB Misses:      " << hw.dtlbMisses << "\n";
    std::cout << "  Cycles/Bar:       " << std::setprecision(2) << hw.cyclesPerBar << "\n";
    std::cout << "\n";

    // Targets
    std::cout << "Target Comparison:\n";
    double loadTimeMs = load.warmStats.p50_ns / 1e6;
    std::cout << "  Load time (1M bars):  " << loadTimeMs << " ms";
    if (load.rowsLoaded >= 1000000) {
        std::cout << (loadTimeMs < 100 ? " [PASS: < 100ms]" : " [FAIL: >= 100ms]");
    }
    std::cout << "\n";
    std::cout << "  Hot path mallocs:     " << alloc.hotPathAllocations
              << (alloc.passed ? " [PASS: 0]" : " [FAIL: > 0]") << "\n";
    std::cout << "\n";
    std::cout << "========================================================\n";
}

// ============================================================================
// Main
// ============================================================================

void printUsage(const char* prog) {
    std::cerr << "Usage: " << prog << " <parquet_file> [options]\n";
    std::cerr << "\n";
    std::cerr << "Options:\n";
    std::cerr << "  --warmup N      Warmup iterations (default: 10)\n";
    std::cerr << "  --measure N     Measurement iterations (default: 100)\n";
    std::cerr << "  --vm-safe       Use VM-safe RDTSC (lfence instead of cpuid)\n";
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
        } else if (arg == "--warmup" && i + 1 < argc) {
            config.warmupIterations = std::stoull(argv[++i]);
        } else if (arg == "--measure" && i + 1 < argc) {
            config.measureIterations = std::stoull(argv[++i]);
        } else if (arg == "--vm-safe") {
            config.useVmSafe = true;
        } else if (arg == "--cpu" && i + 1 < argc) {
            config.cpuCore = std::stoi(argv[++i]);
        } else if (arg[0] != '-') {
            config.dataPath = arg;
        }
    }

    if (config.dataPath.empty()) {
        std::cerr << "Error: No data file specified\n";
        printUsage(argv[0]);
        return 1;
    }

    if (!fs::exists(config.dataPath)) {
        std::cerr << "Error: File not found: " << config.dataPath << "\n";
        return 1;
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

    // Run benchmarks
    std::cout << "Running data loading benchmarks...\n";

    auto loadResult = benchmarkLoading(config);
    auto allocResult = benchmarkHotPathAllocations(config);
    auto hwResult = benchmarkHwCounters(config);

    // Print report
    printReport(loadResult, allocResult, hwResult, config);

    return allocResult.passed ? 0 : 1;
}
