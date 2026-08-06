/**
 * SIMD Benchmark
 *
 * TICKET_175 Phase 6: SIMD & Low-level Optimization
 *
 * Compares AVX2 vectorized vs scalar implementations:
 * - Moving average
 * - Sum reduction
 * - Standard deviation
 * - Element-wise operations
 */

#include "../include/benchmark_utils.hpp"

#include "quantnexus/executor/simd_math.hpp"
#include "quantnexus/executor/simd_avx512.hpp"

#include <iostream>
#include <iomanip>
#include <vector>
#include <random>
#include <chrono>
#include <numeric>
#include <cmath>

using namespace qnx::bench;
using namespace StratCraft::executor::simd;

// =============================================================================
// Configuration
// =============================================================================

struct BenchConfig {
    size_t dataSize = 100000;       // Number of elements
    size_t maPeriod = 20;           // Moving average period
    size_t warmupIters = 10;
    size_t measureIters = 100;
    bool vmSafe = false;
};

// =============================================================================
// Test Data Generation
// =============================================================================

std::vector<double> generateTestData(size_t n) {
    std::vector<double> data(n);
    std::mt19937_64 rng(42);  // Fixed seed for reproducibility
    std::uniform_real_distribution<double> dist(90.0, 110.0);

    for (size_t i = 0; i < n; ++i) {
        data[i] = dist(rng);
    }
    return data;
}

// =============================================================================
// Benchmark: Moving Average
// =============================================================================

struct MAResult {
    double scalarTimeNs;
    double avx2TimeNs;
    double speedup;
    bool correct;
};

MAResult benchmarkMovingAverage(const BenchConfig& config, const std::vector<double>& data) {
    MAResult result{};

    std::vector<double> outScalar(data.size(), 0.0);
    std::vector<double> outAVX2(data.size(), 0.0);

    // Warmup
    for (size_t i = 0; i < config.warmupIters; ++i) {
        fallback::moving_average(data.data(), data.size(), config.maPeriod, outScalar.data());
#if QNX_HAS_AVX2
        avx2::moving_average(data.data(), data.size(), config.maPeriod, outAVX2.data());
#endif
    }

    // Measure scalar
    std::vector<double> scalarTimes;
    scalarTimes.reserve(config.measureIters);

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        fallback::moving_average(data.data(), data.size(), config.maPeriod, outScalar.data());

        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        scalarTimes.push_back(cycles_to_ns(end - start));
    }

    std::sort(scalarTimes.begin(), scalarTimes.end());
    result.scalarTimeNs = scalarTimes[scalarTimes.size() / 2];

#if QNX_HAS_AVX2
    // Measure AVX2
    std::vector<double> avx2Times;
    avx2Times.reserve(config.measureIters);

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        avx2::moving_average(data.data(), data.size(), config.maPeriod, outAVX2.data());

        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        avx2Times.push_back(cycles_to_ns(end - start));
    }

    std::sort(avx2Times.begin(), avx2Times.end());
    result.avx2TimeNs = avx2Times[avx2Times.size() / 2];

    // Verify correctness
    result.correct = true;
    for (size_t i = config.maPeriod - 1; i < data.size(); ++i) {
        if (std::abs(outScalar[i] - outAVX2[i]) > 1e-10) {
            result.correct = false;
            break;
        }
    }
#else
    result.avx2TimeNs = result.scalarTimeNs;
    result.correct = true;
#endif

    result.speedup = result.scalarTimeNs / result.avx2TimeNs;
    return result;
}

// =============================================================================
// Benchmark: Sum Reduction
// =============================================================================

struct SumResult {
    double scalarTimeNs;
    double avx2TimeNs;
    double speedup;
    bool correct;
};

SumResult benchmarkSum(const BenchConfig& config, const std::vector<double>& data) {
    SumResult result{};

    volatile double sumScalar = 0;
    volatile double sumAVX2 = 0;

    // Warmup
    for (size_t i = 0; i < config.warmupIters; ++i) {
        sumScalar = fallback::sum(data.data(), data.size());
#if QNX_HAS_AVX2
        sumAVX2 = avx2::sum(data.data(), data.size());
#endif
    }

    // Measure scalar
    std::vector<double> scalarTimes;
    scalarTimes.reserve(config.measureIters);

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        sumScalar = fallback::sum(data.data(), data.size());

        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        scalarTimes.push_back(cycles_to_ns(end - start));
    }

    std::sort(scalarTimes.begin(), scalarTimes.end());
    result.scalarTimeNs = scalarTimes[scalarTimes.size() / 2];

#if QNX_HAS_AVX2
    // Measure AVX2
    std::vector<double> avx2Times;
    avx2Times.reserve(config.measureIters);

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        sumAVX2 = avx2::sum(data.data(), data.size());

        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        avx2Times.push_back(cycles_to_ns(end - start));
    }

    std::sort(avx2Times.begin(), avx2Times.end());
    result.avx2TimeNs = avx2Times[avx2Times.size() / 2];

    // Verify correctness (allow small floating point error)
    result.correct = std::abs(sumScalar - sumAVX2) < 1e-6 * std::abs(sumScalar);
#else
    result.avx2TimeNs = result.scalarTimeNs;
    result.correct = true;
#endif

    result.speedup = result.scalarTimeNs / result.avx2TimeNs;
    return result;
}

// =============================================================================
// Benchmark: Standard Deviation
// =============================================================================

struct StddevResult {
    double scalarTimeNs;
    double avx2TimeNs;
    double speedup;
    bool correct;
};

StddevResult benchmarkStddev(const BenchConfig& config, const std::vector<double>& data) {
    StddevResult result{};

    volatile double stdScalar = 0;
    volatile double stdAVX2 = 0;

    // Warmup
    for (size_t i = 0; i < config.warmupIters; ++i) {
        stdScalar = fallback::stddev(data.data(), data.size());
#if QNX_HAS_AVX2
        stdAVX2 = avx2::stddev(data.data(), data.size());
#endif
    }

    // Measure scalar
    std::vector<double> scalarTimes;
    scalarTimes.reserve(config.measureIters);

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        stdScalar = fallback::stddev(data.data(), data.size());

        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        scalarTimes.push_back(cycles_to_ns(end - start));
    }

    std::sort(scalarTimes.begin(), scalarTimes.end());
    result.scalarTimeNs = scalarTimes[scalarTimes.size() / 2];

#if QNX_HAS_AVX2
    // Measure AVX2
    std::vector<double> avx2Times;
    avx2Times.reserve(config.measureIters);

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        stdAVX2 = avx2::stddev(data.data(), data.size());

        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        avx2Times.push_back(cycles_to_ns(end - start));
    }

    std::sort(avx2Times.begin(), avx2Times.end());
    result.avx2TimeNs = avx2Times[avx2Times.size() / 2];

    // Verify correctness
    result.correct = std::abs(stdScalar - stdAVX2) < 1e-6 * std::abs(stdScalar);
#else
    result.avx2TimeNs = result.scalarTimeNs;
    result.correct = true;
#endif

    result.speedup = result.scalarTimeNs / result.avx2TimeNs;
    return result;
}

// =============================================================================
// Benchmark: Element-wise Operations
// =============================================================================

#if QNX_HAS_AVX2
struct ElementWiseResult {
    double addTimeNs;
    double mulTimeNs;
    double dotTimeNs;
    double addSpeedup;
    double mulSpeedup;
    double dotSpeedup;
};

ElementWiseResult benchmarkElementWise(const BenchConfig& config,
                                       const std::vector<double>& a,
                                       const std::vector<double>& b) {
    ElementWiseResult result{};
    std::vector<double> out(a.size());

    // Warmup
    for (size_t i = 0; i < config.warmupIters; ++i) {
        avx2::add(a.data(), b.data(), a.size(), out.data());
    }

    // Benchmark add
    std::vector<double> times;
    times.reserve(config.measureIters);

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        avx2::add(a.data(), b.data(), a.size(), out.data());
        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        times.push_back(cycles_to_ns(end - start));
    }
    std::sort(times.begin(), times.end());
    result.addTimeNs = times[times.size() / 2];

    // Benchmark mul
    times.clear();
    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        avx2::mul(a.data(), b.data(), a.size(), out.data());
        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        times.push_back(cycles_to_ns(end - start));
    }
    std::sort(times.begin(), times.end());
    result.mulTimeNs = times[times.size() / 2];

    // Benchmark dot
    times.clear();
    volatile double dotSink = 0;
    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        dotSink = avx2::dot(a.data(), b.data(), a.size());
        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        times.push_back(cycles_to_ns(end - start));
    }
    std::sort(times.begin(), times.end());
    result.dotTimeNs = times[times.size() / 2];
    (void)dotSink;  // Prevent optimization

    // Calculate throughput (elements per nanosecond)
    double elementsPerNs = static_cast<double>(a.size());
    result.addSpeedup = elementsPerNs / result.addTimeNs * 1e9 / 1e9;  // GElems/s
    result.mulSpeedup = elementsPerNs / result.mulTimeNs * 1e9 / 1e9;
    result.dotSpeedup = elementsPerNs / result.dotTimeNs * 1e9 / 1e9;

    return result;
}
#endif

// =============================================================================
// Report
// =============================================================================

void printReport(const BenchConfig& config,
                 const MAResult& maResult,
                 const SumResult& sumResult,
                 const StddevResult& stddevResult) {

    std::cout << "\n========================================================\n";
    std::cout << "              SIMD BENCHMARK REPORT\n";
    std::cout << "========================================================\n\n";

    std::cout << "Configuration:\n";
    std::cout << "  Data size:        " << config.dataSize << " elements\n";
    std::cout << "  MA period:        " << config.maPeriod << "\n";
    std::cout << "  Warmup iters:     " << config.warmupIters << "\n";
    std::cout << "  Measure iters:    " << config.measureIters << "\n";
    std::cout << "  VM-safe RDTSC:    " << (config.vmSafe ? "yes" : "no") << "\n";

    // SIMD capability detection
    auto simdLevel = get_simd_level();
    std::cout << "  SIMD Level:       " << simd_level_name(simdLevel) << "\n";
#if QNX_HAS_AVX512
    std::cout << "  AVX-512:          compiled (runtime: " << (cpu_has_avx512() ? "available" : "not available") << ")\n";
#else
    std::cout << "  AVX-512:          not compiled\n";
#endif
#if QNX_HAS_AVX2
    std::cout << "  AVX2:             compiled (runtime: " << (cpu_has_avx2() ? "available" : "not available") << ")\n\n";
#else
    std::cout << "  AVX2:             not compiled (fallback mode)\n\n";
#endif

    std::cout << std::fixed << std::setprecision(2);

    std::cout << "Moving Average (SMA-" << config.maPeriod << "):\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  Implementation    Time (us)      Speedup    Correct\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  Scalar            " << std::setw(10) << maResult.scalarTimeNs / 1000.0
              << "    (baseline)   -\n";
    std::cout << "  AVX2              " << std::setw(10) << maResult.avx2TimeNs / 1000.0
              << "    " << std::setw(6) << maResult.speedup << "x"
              << "      " << (maResult.correct ? "YES" : "NO") << "\n";
    std::cout << "  --------------------------------------------------------\n\n";

    std::cout << "Sum Reduction:\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  Implementation    Time (us)      Speedup    Correct\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  Scalar            " << std::setw(10) << sumResult.scalarTimeNs / 1000.0
              << "    (baseline)   -\n";
    std::cout << "  AVX2              " << std::setw(10) << sumResult.avx2TimeNs / 1000.0
              << "    " << std::setw(6) << sumResult.speedup << "x"
              << "      " << (sumResult.correct ? "YES" : "NO") << "\n";
    std::cout << "  --------------------------------------------------------\n\n";

    std::cout << "Standard Deviation:\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  Implementation    Time (us)      Speedup    Correct\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  Scalar            " << std::setw(10) << stddevResult.scalarTimeNs / 1000.0
              << "    (baseline)   -\n";
    std::cout << "  AVX2              " << std::setw(10) << stddevResult.avx2TimeNs / 1000.0
              << "    " << std::setw(6) << stddevResult.speedup << "x"
              << "      " << (stddevResult.correct ? "YES" : "NO") << "\n";
    std::cout << "  --------------------------------------------------------\n\n";

    // Throughput calculation
    double scalarThroughput = config.dataSize / (maResult.scalarTimeNs / 1e9) / 1e6;
    double avx2Throughput = config.dataSize / (maResult.avx2TimeNs / 1e9) / 1e6;

    std::cout << "Throughput (MA):\n";
    std::cout << "  Scalar:           " << std::setw(6) << scalarThroughput << " M elements/s\n";
    std::cout << "  AVX2:             " << std::setw(6) << avx2Throughput << " M elements/s\n\n";

    // Target comparison
    std::cout << "Target Comparison:\n";
    double avgSpeedup = (maResult.speedup + sumResult.speedup + stddevResult.speedup) / 3.0;
    std::cout << "  Average speedup:  " << std::setw(6) << avgSpeedup << "x ";
    if (avgSpeedup >= 2.0) {
        std::cout << "[PASS: >= 2x]\n";
    } else {
        std::cout << "[BELOW TARGET: 2x]\n";
    }

    std::cout << "\n========================================================\n";
}

// =============================================================================
// Main
// =============================================================================

int main(int argc, char* argv[]) {
    BenchConfig config;

    // Parse arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--vm-safe") {
            config.vmSafe = true;
        } else if (arg.starts_with("--size=")) {
            config.dataSize = std::stoul(arg.substr(7));
        } else if (arg.starts_with("--period=")) {
            config.maPeriod = std::stoul(arg.substr(9));
        } else if (arg.starts_with("--iterations=")) {
            config.measureIters = std::stoul(arg.substr(13));
        }
    }

    std::cout << "Running SIMD benchmarks...\n";

    // Generate test data
    auto data = generateTestData(config.dataSize);
    auto data2 = generateTestData(config.dataSize);

    // Run benchmarks
    auto maResult = benchmarkMovingAverage(config, data);
    auto sumResult = benchmarkSum(config, data);
    auto stddevResult = benchmarkStddev(config, data);

    // Print report
    printReport(config, maResult, sumResult, stddevResult);

#if QNX_HAS_AVX2
    // Additional element-wise benchmarks
    auto ewResult = benchmarkElementWise(config, data, data2);
    std::cout << "\nElement-wise Operations (AVX2):\n";
    std::cout << "  Add:  " << std::setw(8) << ewResult.addTimeNs / 1000.0 << " us\n";
    std::cout << "  Mul:  " << std::setw(8) << ewResult.mulTimeNs / 1000.0 << " us\n";
    std::cout << "  Dot:  " << std::setw(8) << ewResult.dotTimeNs / 1000.0 << " us\n";
#endif

    // Auto-dispatch benchmark (uses best available SIMD)
    std::cout << "\nAuto-Dispatch (best available SIMD):\n";
    std::cout << "  Using:     " << simd_level_name(get_simd_level()) << "\n";

    std::vector<double> autoTimes;
    autoTimes.reserve(config.measureIters);
    volatile double autoSink = 0;

    for (size_t iter = 0; iter < config.measureIters; ++iter) {
        uint64_t start = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        autoSink = auto_sum(data.data(), data.size());
        uint64_t end = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        autoTimes.push_back(cycles_to_ns(end - start));
    }
    (void)autoSink;

    std::sort(autoTimes.begin(), autoTimes.end());
    double autoTimeNs = autoTimes[autoTimes.size() / 2];
    std::cout << std::fixed << std::setprecision(2);
    std::cout << "  auto_sum:  " << std::setw(8) << autoTimeNs / 1000.0 << " us\n";

    return 0;
}
