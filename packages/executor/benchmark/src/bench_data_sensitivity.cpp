/**
 * @file bench_data_sensitivity.cpp
 * @brief Data distribution sensitivity benchmark
 *
 * Reference: TICKET_174 - C++ Executor Benchmark Framework
 * Reference: modernc_quant.md #17 - Columnar Storage
 *
 * Benchmarks:
 * - Performance with different data distributions
 * - Trending vs mean-reverting vs random
 * - Signal density impact
 * - Edge case handling
 */

#include "benchmark_utils.hpp"
#include "perf_counters.hpp"

#include <iostream>
#include <iomanip>
#include <vector>
#include <random>
#include <cmath>

using namespace qnx::bench;

// ============================================================================
// Configuration
// ============================================================================

struct BenchConfig {
    size_t barCount = 100000;
    size_t warmupIterations = 100;
    size_t measureIterations = 1000;
    bool useVmSafe = false;
    int cpuCore = -1;
};

// ============================================================================
// Data Distribution Types
// ============================================================================

enum class Distribution {
    RANDOM_WALK,      // Standard random walk
    TRENDING_UP,      // Strong upward trend
    TRENDING_DOWN,    // Strong downward trend
    MEAN_REVERTING,   // Mean-reverting oscillation
    HIGH_VOLATILITY,  // High volatility, no trend
    LOW_VOLATILITY,   // Low volatility, stable
    SPARSE_SIGNALS,   // Few trading signals
    DENSE_SIGNALS,    // Many trading signals
};

const char* distributionName(Distribution d) {
    switch (d) {
        case Distribution::RANDOM_WALK: return "Random Walk";
        case Distribution::TRENDING_UP: return "Trending Up";
        case Distribution::TRENDING_DOWN: return "Trending Down";
        case Distribution::MEAN_REVERTING: return "Mean Reverting";
        case Distribution::HIGH_VOLATILITY: return "High Volatility";
        case Distribution::LOW_VOLATILITY: return "Low Volatility";
        case Distribution::SPARSE_SIGNALS: return "Sparse Signals";
        case Distribution::DENSE_SIGNALS: return "Dense Signals";
        default: return "Unknown";
    }
}

// ============================================================================
// Data Generator
// ============================================================================

struct TestData {
    std::vector<double> close;
    std::vector<double> volume;
};

TestData generateData(size_t barCount, Distribution dist, uint32_t seed = 42) {
    TestData data;
    data.close.reserve(barCount);
    data.volume.reserve(barCount);

    std::mt19937 rng(seed);
    std::normal_distribution<double> noise(0.0, 1.0);

    double price = 100.0;
    double mean = 100.0;

    for (size_t i = 0; i < barCount; ++i) {
        double change = 0.0;

        switch (dist) {
            case Distribution::RANDOM_WALK:
                change = noise(rng) * 0.01;
                break;

            case Distribution::TRENDING_UP:
                change = 0.0001 + noise(rng) * 0.005;  // Bias upward
                break;

            case Distribution::TRENDING_DOWN:
                change = -0.0001 + noise(rng) * 0.005;  // Bias downward
                break;

            case Distribution::MEAN_REVERTING:
                change = (mean - price) * 0.01 + noise(rng) * 0.005;
                break;

            case Distribution::HIGH_VOLATILITY:
                change = noise(rng) * 0.05;  // 5% volatility
                break;

            case Distribution::LOW_VOLATILITY:
                change = noise(rng) * 0.001;  // 0.1% volatility
                break;

            case Distribution::SPARSE_SIGNALS:
                // Long periods of stability, occasional jumps
                if (rng() % 100 == 0) {
                    change = noise(rng) * 0.1;  // Rare large move
                } else {
                    change = noise(rng) * 0.0001;  // Very small noise
                }
                break;

            case Distribution::DENSE_SIGNALS:
                // Oscillating, many crossovers
                change = std::sin(i * 0.1) * 0.01 + noise(rng) * 0.005;
                break;
        }

        price = price * (1.0 + change);
        price = std::max(price, 1.0);  // Floor at $1

        data.close.push_back(price);
        data.volume.push_back(1000.0 + std::abs(noise(rng)) * 500);
    }

    return data;
}

// ============================================================================
// Mock Strategy (Same as bench_execution.cpp)
// ============================================================================

class MockIndicatorEngine {
public:
    explicit MockIndicatorEngine(size_t smaWindow = 20)
        : smaWindow_(smaWindow) {}

    void reset() {
        smaSum_ = 0;
        smaBuffer_.clear();
        smaBuffer_.reserve(smaWindow_);
        position_ = 0;
        signalCount_ = 0;
    }

    double processBar(double close, [[maybe_unused]] double volume) noexcept {
        compiler_barrier();

        // SMA calculation
        smaBuffer_.push_back(close);
        smaSum_ += close;
        if (smaBuffer_.size() > smaWindow_) {
            smaSum_ -= smaBuffer_[smaBuffer_.size() - smaWindow_ - 1];
        }
        double sma = smaBuffer_.size() >= smaWindow_
            ? smaSum_ / smaWindow_
            : close;

        // Simple crossover signal
        double signal = 0;
        if (close > sma * 1.001) {  // 0.1% above SMA
            if (position_ <= 0) {
                signal = 1.0;
                position_ = 1;
                signalCount_++;
            }
        } else if (close < sma * 0.999) {  // 0.1% below SMA
            if (position_ >= 0) {
                signal = -1.0;
                position_ = -1;
                signalCount_++;
            }
        }

        compiler_barrier();
        return signal;
    }

    size_t signalCount() const { return signalCount_; }

private:
    size_t smaWindow_;
    double smaSum_ = 0;
    std::vector<double> smaBuffer_;
    int position_ = 0;
    size_t signalCount_ = 0;
};

// ============================================================================
// Benchmark: Distribution Sensitivity
// ============================================================================

struct DistributionResult {
    Distribution distribution;
    LatencyStats stats;
    size_t signalCount = 0;
    double signalDensity = 0;  // Signals per 1000 bars
    uint64_t branchMisses = 0;
    double branchMissRate = 0;
};

DistributionResult benchmarkDistribution(Distribution dist, const BenchConfig& config) {
    DistributionResult result;
    result.distribution = dist;

    auto data = generateData(config.barCount, dist);
    MockIndicatorEngine engine;

    double freqGhz = get_cpu_freq_ghz();

    // Warmup
    for (size_t i = 0; i < config.warmupIterations; ++i) {
        engine.reset();
        for (size_t j = 0; j < data.close.size(); ++j) {
            engine.processBar(data.close[j], data.volume[j]);
        }
    }

    // Measure latency
    std::vector<double> samples;
    samples.reserve(config.measureIterations);

    for (size_t iter = 0; iter < config.measureIterations; ++iter) {
        engine.reset();

        uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        for (size_t i = 0; i < data.close.size(); ++i) {
            engine.processBar(data.close[i], data.volume[i]);
        }
        uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        samples.push_back(cycles_to_ns(end - start, freqGhz) / data.close.size());

        if (iter == 0) {
            result.signalCount = engine.signalCount();
        }
    }

    result.stats.compute(samples);
    result.signalDensity = static_cast<double>(result.signalCount) / config.barCount * 1000;

    // Measure branch misses
    {
        PerfCounterGroup counters;
        counters.add(PerfEvent::BRANCH_INSTRUCTIONS);
        counters.add(PerfEvent::BRANCH_MISSES);

        uint64_t branchInsns = 0;

        {
            ScopedPerfCounters scope(counters);

            for (size_t iter = 0; iter < 100; ++iter) {
                engine.reset();
                for (size_t i = 0; i < data.close.size(); ++i) {
                    engine.processBar(data.close[i], data.volume[i]);
                }
            }
        }

        auto results = counters.read();
        for (const auto& r : results) {
            if (r.event == PerfEvent::BRANCH_INSTRUCTIONS) branchInsns = r.value;
            if (r.event == PerfEvent::BRANCH_MISSES) result.branchMisses = r.value;
        }

        if (branchInsns > 0) {
            result.branchMissRate = 100.0 * result.branchMisses / branchInsns;
        }
    }

    return result;
}

// ============================================================================
// Report Generation
// ============================================================================

void printReport(const std::vector<DistributionResult>& results,
                 const BenchConfig& config) {
    std::cout << "\n";
    std::cout << "========================================================\n";
    std::cout << "        DATA SENSITIVITY BENCHMARK REPORT\n";
    std::cout << "========================================================\n";
    std::cout << "\n";

    // Configuration
    std::cout << "Configuration:\n";
    std::cout << "  Bar count:        " << config.barCount << "\n";
    std::cout << "  Warmup iters:     " << config.warmupIterations << "\n";
    std::cout << "  Measure iters:    " << config.measureIterations << "\n";
    std::cout << "\n";

    // Results Table
    std::cout << std::fixed << std::setprecision(2);
    std::cout << "Distribution Comparison:\n";
    std::cout << "  -------------------------------------------------------------------------\n";
    std::cout << "  Distribution          P50 ns/bar  P99 ns/bar  Signals/1K  BranchMiss%\n";
    std::cout << "  -------------------------------------------------------------------------\n";

    double minP50 = results[0].stats.p50_ns;
    double maxP50 = results[0].stats.p50_ns;

    for (const auto& r : results) {
        std::cout << "  " << std::left << std::setw(20) << distributionName(r.distribution)
                  << std::right
                  << std::setw(10) << r.stats.p50_ns
                  << std::setw(12) << r.stats.p99_ns
                  << std::setw(12) << r.signalDensity
                  << std::setw(12) << r.branchMissRate
                  << "\n";

        minP50 = std::min(minP50, r.stats.p50_ns);
        maxP50 = std::max(maxP50, r.stats.p50_ns);
    }

    std::cout << "  -------------------------------------------------------------------------\n";
    std::cout << "\n";

    // Analysis
    double variance = (maxP50 - minP50) / minP50 * 100;
    std::cout << "Analysis:\n";
    std::cout << "  Min P50:          " << minP50 << " ns\n";
    std::cout << "  Max P50:          " << maxP50 << " ns\n";
    std::cout << "  Variance:         " << variance << " %\n";
    std::cout << "\n";

    // Target Comparison
    std::cout << "Target Comparison:\n";
    std::cout << "  Latency variance:  " << variance << " %";
    std::cout << (variance < 20 ? " [PASS: < 20% variation]" : " [INVESTIGATE: >= 20% variation]") << "\n";

    // Find worst branch miss rate
    double worstBranchMiss = 0;
    const char* worstDist = "";
    for (const auto& r : results) {
        if (r.branchMissRate > worstBranchMiss) {
            worstBranchMiss = r.branchMissRate;
            worstDist = distributionName(r.distribution);
        }
    }
    std::cout << "  Worst branch miss: " << worstBranchMiss << " % (" << worstDist << ")";
    std::cout << (worstBranchMiss < 2 ? " [PASS: < 2%]" : " [INVESTIGATE: >= 2%]") << "\n";
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
    std::cerr << "  --bars N        Bar count (default: 100000)\n";
    std::cerr << "  --warmup N      Warmup iterations (default: 100)\n";
    std::cerr << "  --measure N     Measurement iterations (default: 1000)\n";
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
        } else if (arg == "--bars" && i + 1 < argc) {
            config.barCount = std::stoull(argv[++i]);
        } else if (arg == "--warmup" && i + 1 < argc) {
            config.warmupIterations = std::stoull(argv[++i]);
        } else if (arg == "--measure" && i + 1 < argc) {
            config.measureIterations = std::stoull(argv[++i]);
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

    // Run benchmarks
    std::cout << "Running data sensitivity benchmarks...\n";

    std::vector<DistributionResult> results;
    results.push_back(benchmarkDistribution(Distribution::RANDOM_WALK, config));
    results.push_back(benchmarkDistribution(Distribution::TRENDING_UP, config));
    results.push_back(benchmarkDistribution(Distribution::TRENDING_DOWN, config));
    results.push_back(benchmarkDistribution(Distribution::MEAN_REVERTING, config));
    results.push_back(benchmarkDistribution(Distribution::HIGH_VOLATILITY, config));
    results.push_back(benchmarkDistribution(Distribution::LOW_VOLATILITY, config));
    results.push_back(benchmarkDistribution(Distribution::SPARSE_SIGNALS, config));
    results.push_back(benchmarkDistribution(Distribution::DENSE_SIGNALS, config));

    // Print report
    printReport(results, config);

    return 0;
}
