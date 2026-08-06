/**
 * @file bench_gil_latency.cpp
 * @brief Python GIL latency benchmark
 *
 * Reference: TICKET_174 - C++ Executor Benchmark Framework
 * Reference: modernc_quant.md #47 - GIL Release
 * Reference: modernc_quant.md #48 - scoped_release
 *
 * Benchmarks:
 * - GIL acquire latency
 * - GIL hold duration
 * - Callback overhead
 * - C++ compute with GIL released
 */

#include "benchmark_utils.hpp"
#include "perf_counters.hpp"

#include <pybind11/pybind11.h>
#include <pybind11/embed.h>
#include <pybind11/numpy.h>

#include <iostream>
#include <iomanip>
#include <vector>
#include <thread>
#include <atomic>
#include <chrono>

namespace py = pybind11;
using namespace qnx::bench;

// ============================================================================
// Configuration
// ============================================================================

struct BenchConfig {
    size_t iterations = 10000;
    size_t computeIterations = 100000;
    bool useVmSafe = false;
    int cpuCore = -1;
};

// ============================================================================
// Benchmark: GIL Acquire Latency
// ============================================================================

struct GILAcquireResult {
    LatencyStats acquireStats;
    LatencyStats releaseStats;
    LatencyStats roundtripStats;
};

GILAcquireResult benchmarkGILAcquire(const BenchConfig& config) {
    GILAcquireResult result;

    double freqGhz = get_cpu_freq_ghz();

    std::vector<double> acquireSamples;
    std::vector<double> releaseSamples;
    std::vector<double> roundtripSamples;

    acquireSamples.reserve(config.iterations);
    releaseSamples.reserve(config.iterations);
    roundtripSamples.reserve(config.iterations);

    // Warmup
    for (size_t i = 0; i < 100; ++i) {
        py::gil_scoped_release release;
        {
            py::gil_scoped_acquire acquire;
        }
    }

    // Measure
    for (size_t i = 0; i < config.iterations; ++i) {
        // Release GIL, then measure acquire
        py::gil_scoped_release release;

        uint64_t t0 = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        {
            py::gil_scoped_acquire acquire;
            uint64_t t1 = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

            // Do minimal work while holding GIL
            compiler_barrier();

            uint64_t t2 = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

            acquireSamples.push_back(cycles_to_ns(t1 - t0, freqGhz));
            // Note: release is measured at destruction

            // Store hold duration
            uint64_t holdCycles = t2 - t1;
            (void)holdCycles;  // For now, not measuring hold separately
        }

        uint64_t t3 = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        roundtripSamples.push_back(cycles_to_ns(t3 - t0, freqGhz));
    }

    result.acquireStats.compute(acquireSamples);
    result.roundtripStats.compute(roundtripSamples);

    return result;
}

// ============================================================================
// Benchmark: GIL Hold Duration
// ============================================================================

struct GILHoldResult {
    double minHoldNs = 0;
    double maxHoldNs = 0;
    double avgHoldNs = 0;
    size_t callCount = 0;
};

GILHoldResult benchmarkGILHold(const BenchConfig& config) {
    GILHoldResult result;

    double freqGhz = get_cpu_freq_ghz();

    // Simulate Python callback scenario
    std::vector<double> holdDurations;
    holdDurations.reserve(config.iterations);

    // Warmup
    for (size_t i = 0; i < 100; ++i) {
        py::gil_scoped_release release;
        {
            py::gil_scoped_acquire acquire;
            // Simulate callback work
            volatile int x = 0;
            for (int j = 0; j < 100; ++j) x += j;
        }
    }

    // Measure hold durations during callbacks
    for (size_t i = 0; i < config.iterations; ++i) {
        py::gil_scoped_release release;
        {
            py::gil_scoped_acquire acquire;

            uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

            // Simulate typical callback work (progress update, small data transfer)
            py::dict d;
            d["progress"] = static_cast<double>(i) / config.iterations;
            d["message"] = "Processing...";

            uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

            holdDurations.push_back(cycles_to_ns(end - start, freqGhz));
        }
    }

    // Compute stats
    double sum = 0;
    result.minHoldNs = holdDurations[0];
    result.maxHoldNs = holdDurations[0];

    for (double d : holdDurations) {
        sum += d;
        result.minHoldNs = std::min(result.minHoldNs, d);
        result.maxHoldNs = std::max(result.maxHoldNs, d);
    }

    result.avgHoldNs = sum / holdDurations.size();
    result.callCount = config.iterations;

    return result;
}

// ============================================================================
// Benchmark: C++ Compute with GIL Released
// ============================================================================

struct ComputeResult {
    double withGilNs = 0;
    double withoutGilNs = 0;
    double speedup = 0;
};

void doCompute(size_t iterations) {
    volatile double sum = 0;
    for (size_t i = 0; i < iterations; ++i) {
        sum += std::sin(static_cast<double>(i)) * std::cos(static_cast<double>(i));
    }
    compiler_barrier();
}

ComputeResult benchmarkComputeWithGIL(const BenchConfig& config) {
    ComputeResult result;

    double freqGhz = get_cpu_freq_ghz();

    // Warmup
    doCompute(config.computeIterations / 10);

    // Measure with GIL held
    {
        uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        doCompute(config.computeIterations);
        uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        result.withGilNs = cycles_to_ns(end - start, freqGhz);
    }

    // Measure with GIL released
    {
        py::gil_scoped_release release;

        uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        doCompute(config.computeIterations);
        uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        result.withoutGilNs = cycles_to_ns(end - start, freqGhz);
    }

    result.speedup = result.withGilNs / std::max(result.withoutGilNs, 1.0);

    return result;
}

// ============================================================================
// Benchmark: NumPy Array Creation Overhead
// ============================================================================

struct NumPyResult {
    LatencyStats createStats;
    LatencyStats accessStats;
    size_t arraySize = 0;
};

NumPyResult benchmarkNumPyOverhead(const BenchConfig& config) {
    NumPyResult result;
    result.arraySize = 10000;

    double freqGhz = get_cpu_freq_ghz();

    std::vector<double> createSamples;
    std::vector<double> accessSamples;
    createSamples.reserve(config.iterations);
    accessSamples.reserve(config.iterations);

    // Source data
    std::vector<double> sourceData(result.arraySize);
    for (size_t i = 0; i < result.arraySize; ++i) {
        sourceData[i] = static_cast<double>(i);
    }

    // Warmup
    for (size_t i = 0; i < 100; ++i) {
        py::array_t<double> arr(result.arraySize);
        auto buf = arr.request();
        std::memcpy(buf.ptr, sourceData.data(), result.arraySize * sizeof(double));
    }

    // Measure array creation (with copy)
    for (size_t i = 0; i < config.iterations; ++i) {
        uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        py::array_t<double> arr(result.arraySize);
        auto buf = arr.request();
        std::memcpy(buf.ptr, sourceData.data(), result.arraySize * sizeof(double));

        uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        createSamples.push_back(cycles_to_ns(end - start, freqGhz));
    }

    // Measure zero-copy array access
    py::array_t<double> sharedArr(
        {static_cast<py::ssize_t>(result.arraySize)},
        sourceData.data(),
        py::cast(sourceData)  // Keep sourceData alive
    );

    for (size_t i = 0; i < config.iterations; ++i) {
        uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        auto buf = sharedArr.request();
        double* ptr = static_cast<double*>(buf.ptr);
        volatile double sum = 0;
        for (size_t j = 0; j < result.arraySize; ++j) {
            sum += ptr[j];
        }

        uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        accessSamples.push_back(cycles_to_ns(end - start, freqGhz));
    }

    result.createStats.compute(createSamples);
    result.accessStats.compute(accessSamples);

    return result;
}

// ============================================================================
// Report Generation
// ============================================================================

void printReport(const GILAcquireResult& gilAcquire,
                 const GILHoldResult& gilHold,
                 const ComputeResult& compute,
                 const NumPyResult& numpy,
                 const BenchConfig& config) {
    std::cout << "\n";
    std::cout << "========================================================\n";
    std::cout << "            GIL LATENCY BENCHMARK REPORT\n";
    std::cout << "========================================================\n";
    std::cout << "\n";

    // Configuration
    std::cout << "Configuration:\n";
    std::cout << "  Iterations:       " << config.iterations << "\n";
    std::cout << "  Compute iters:    " << config.computeIterations << "\n";
    std::cout << "  VM-safe RDTSC:    " << (config.useVmSafe ? "yes" : "no") << "\n";
    std::cout << "\n";

    // GIL Acquire Latency
    std::cout << std::fixed << std::setprecision(2);
    std::cout << "GIL Acquire Latency (nanoseconds):\n";
    std::cout << "  P50:              " << gilAcquire.acquireStats.p50_ns << " ns\n";
    std::cout << "  P99:              " << gilAcquire.acquireStats.p99_ns << " ns\n";
    std::cout << "  Max:              " << gilAcquire.acquireStats.max_ns << " ns\n";
    std::cout << "  Roundtrip P50:    " << gilAcquire.roundtripStats.p50_ns << " ns\n";
    std::cout << "\n";

    // GIL Hold Duration
    std::cout << "GIL Hold Duration (callback simulation):\n";
    std::cout << "  Min:              " << gilHold.minHoldNs << " ns\n";
    std::cout << "  Avg:              " << gilHold.avgHoldNs << " ns\n";
    std::cout << "  Max:              " << gilHold.maxHoldNs << " ns\n";
    std::cout << "  Calls:            " << gilHold.callCount << "\n";
    std::cout << "\n";

    // C++ Compute with GIL
    std::cout << "C++ Compute (" << config.computeIterations << " sin/cos ops):\n";
    std::cout << "  With GIL:         " << (compute.withGilNs / 1e6) << " ms\n";
    std::cout << "  Without GIL:      " << (compute.withoutGilNs / 1e6) << " ms\n";
    std::cout << "  Speedup:          " << compute.speedup << "x\n";
    std::cout << "\n";

    // NumPy Overhead
    std::cout << "NumPy Array Overhead (" << numpy.arraySize << " elements):\n";
    std::cout << "  Create+Copy P50:  " << (numpy.createStats.p50_ns / 1e3) << " us\n";
    std::cout << "  Create+Copy P99:  " << (numpy.createStats.p99_ns / 1e3) << " us\n";
    std::cout << "  Zero-copy access: " << (numpy.accessStats.p50_ns / 1e3) << " us\n";
    std::cout << "\n";

    // Target Comparison
    std::cout << "Target Comparison:\n";
    double acquireUs = gilAcquire.acquireStats.p50_ns / 1e3;
    std::cout << "  GIL acquire P50:  " << acquireUs << " us";
    std::cout << (acquireUs < 10 ? " [PASS: < 10us]" : " [FAIL: >= 10us]") << "\n";

    double holdUs = gilHold.avgHoldNs / 1e3;
    std::cout << "  GIL hold avg:     " << holdUs << " us";
    std::cout << (holdUs < 100 ? " [PASS: < 100us]" : " [FAIL: >= 100us]") << "\n";

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
    std::cerr << "  --iterations N  Iterations (default: 10000)\n";
    std::cerr << "  --compute N     Compute iterations (default: 100000)\n";
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
        } else if (arg == "--iterations" && i + 1 < argc) {
            config.iterations = std::stoull(argv[++i]);
        } else if (arg == "--compute" && i + 1 < argc) {
            config.computeIterations = std::stoull(argv[++i]);
        } else if (arg == "--vm-safe") {
            config.useVmSafe = true;
        } else if (arg == "--cpu" && i + 1 < argc) {
            config.cpuCore = std::stoi(argv[++i]);
        }
    }

    // Initialize Python interpreter
    py::scoped_interpreter guard{};

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
    std::cout << "Running GIL latency benchmarks...\n";

    auto gilAcquire = benchmarkGILAcquire(config);
    auto gilHold = benchmarkGILHold(config);
    auto compute = benchmarkComputeWithGIL(config);
    auto numpy = benchmarkNumPyOverhead(config);

    // Print report
    printReport(gilAcquire, gilHold, compute, numpy, config);

    // Check targets
    bool passed = (gilAcquire.acquireStats.p50_ns / 1e3 < 10) &&
                  (gilHold.avgHoldNs / 1e3 < 100);

    return passed ? 0 : 1;
}
