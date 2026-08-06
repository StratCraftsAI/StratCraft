/**
 * @file bench_execution.cpp
 * @brief Execution loop benchmark
 *
 * Reference: TICKET_174 - C++ Executor Benchmark Framework
 * Reference: modernc_quant.md #98 - RDTSC Cycle Counting
 *
 * Benchmarks:
 * - Per-bar execution latency
 * - Hot path allocation audit
 * - Branch misprediction on hot path
 * - Cold vs warm execution
 */

#include "benchmark_utils.hpp"
#include "memory_tracker.hpp"
#include "perf_counters.hpp"

#include <quantnexus/executor/data_source.hpp>
#include <quantnexus/executor/config_types.hpp>

#include <iostream>
#include <iomanip>
#include <vector>
#include <cmath>
#include <random>

using namespace qnx::bench;
using namespace StratCraft::executor;

// ============================================================================
// Configuration
// ============================================================================

struct BenchConfig {
    size_t barCount = 100000;
    size_t warmupIterations = 1000;
    size_t measureIterations = 10000;
    bool useVmSafe = false;
    int cpuCore = -1;
};

// ============================================================================
// Mock Strategy Loop (Pure C++ for measuring C++ overhead)
// ============================================================================

/**
 * Simulates typical indicator calculations without Python
 * This measures pure C++ execution overhead
 */
class MockIndicatorEngine {
public:
    explicit MockIndicatorEngine(size_t smaWindow = 20, size_t emaWindow = 12)
        : smaWindow_(smaWindow)
        , emaWindow_(emaWindow)
        , emaMultiplier_(2.0 / (emaWindow + 1)) {}

    void reset() {
        smaSum_ = 0;
        smaBuffer_.clear();
        smaBuffer_.reserve(smaWindow_);
        emaValue_ = 0;
        emaInitialized_ = false;
        position_ = 0;
    }

    /**
     * Process one bar - typical hot path operations
     */
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

        // EMA calculation
        if (!emaInitialized_) {
            emaValue_ = close;
            emaInitialized_ = true;
        } else {
            emaValue_ = (close - emaValue_) * emaMultiplier_ + emaValue_;
        }

        // Simple crossover signal
        double signal = 0;
        if (close > sma && emaValue_ > sma) {
            if (position_ <= 0) {
                signal = 1.0;  // Buy
                position_ = 1;
            }
        } else if (close < sma && emaValue_ < sma) {
            if (position_ >= 0) {
                signal = -1.0;  // Sell
                position_ = -1;
            }
        }

        compiler_barrier();
        return signal;
    }

private:
    size_t smaWindow_;
    size_t emaWindow_;
    double emaMultiplier_;

    double smaSum_ = 0;
    std::vector<double> smaBuffer_;
    double emaValue_ = 0;
    bool emaInitialized_ = false;
    int position_ = 0;
};

// ============================================================================
// Generate Test Data
// ============================================================================

DataFrame generateTestData(size_t barCount) {
    DataFrame df;
    df.symbol = "BENCH";
    df.interval = "1m";
    df.reserve(barCount);

    std::mt19937 rng(42);  // Fixed seed for reproducibility
    std::normal_distribution<double> returns(0.0, 0.001);

    double price = 100.0;
    int64_t timestamp = 1609459200000;  // 2021-01-01

    for (size_t i = 0; i < barCount; ++i) {
        double ret = returns(rng);
        double open = price;
        double change = open * ret;
        double close = open + change;
        double high = std::max(open, close) * (1.0 + std::abs(returns(rng)));
        double low = std::min(open, close) * (1.0 - std::abs(returns(rng)));
        double volume = 1000.0 + std::abs(returns(rng)) * 10000;

        df.timestamps.push_back(timestamp);
        df.open.push_back(open);
        df.high.push_back(high);
        df.low.push_back(low);
        df.close.push_back(close);
        df.volume.push_back(volume);

        price = close;
        timestamp += 60000;  // 1 minute
    }

    return df;
}

// ============================================================================
// Benchmark: Per-bar Latency
// ============================================================================

struct PerBarResult {
    LatencyStats stats;
    double cyclesPerBar = 0;
    size_t signalsGenerated = 0;
};

PerBarResult benchmarkPerBarLatency(const BenchConfig& config) {
    PerBarResult result;

    auto df = generateTestData(config.barCount);
    MockIndicatorEngine engine;

    double freqGhz = get_cpu_freq_ghz();

    // Warmup
    for (size_t i = 0; i < config.warmupIterations; ++i) {
        engine.reset();
        for (size_t j = 0; j < std::min(size_t(1000), df.size()); ++j) {
            engine.processBar(df.close[j], df.volume[j]);
        }
    }

    // Measure individual bar latencies
    std::vector<double> samples;
    samples.reserve(config.measureIterations);

    uint64_t totalCycles = 0;

    for (size_t iter = 0; iter < config.measureIterations; ++iter) {
        engine.reset();

        uint64_t iterStart = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        for (size_t i = 0; i < df.size(); ++i) {
            double signal = engine.processBar(df.close[i], df.volume[i]);
            if (signal != 0) result.signalsGenerated++;
        }

        uint64_t iterEnd = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        uint64_t iterCycles = iterEnd - iterStart;
        totalCycles += iterCycles;

        double nsPerBar = cycles_to_ns(iterCycles, freqGhz) / df.size();
        samples.push_back(nsPerBar);
    }

    result.stats.compute(samples);
    result.cyclesPerBar = static_cast<double>(totalCycles) /
                          (config.measureIterations * df.size());

    return result;
}

// ============================================================================
// Benchmark: Hot Path Allocation Audit
// ============================================================================

struct AllocationResult {
    size_t allocations = 0;
    size_t bytes = 0;
    bool passed = false;
};

AllocationResult benchmarkHotPathAllocations(const BenchConfig& config) {
    AllocationResult result;

    auto df = generateTestData(config.barCount);
    MockIndicatorEngine engine;

    // Warmup (allocations allowed here)
    engine.reset();
    for (size_t i = 0; i < df.size(); ++i) {
        engine.processBar(df.close[i], df.volume[i]);
    }

    // Hot path audit - no allocations should happen after warmup
    {
        ScopedHotPathAudit audit;

        for (size_t iter = 0; iter < 10; ++iter) {
            // Note: We're NOT calling reset() here to test true hot path
            // After warmup, all buffers should be sized correctly
            for (size_t i = 0; i < df.size(); ++i) {
                engine.processBar(df.close[i], df.volume[i]);
            }
        }

        result.allocations = audit.violation_count();
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
    uint64_t branchMisses = 0;
    uint64_t cacheMisses = 0;
    double ipc = 0;
    double branchMissRate = 0;
};

HwCounterResult benchmarkHwCounters(const BenchConfig& config) {
    HwCounterResult result;

    auto df = generateTestData(config.barCount);
    MockIndicatorEngine engine;

    // Warmup
    for (size_t i = 0; i < config.warmupIterations; ++i) {
        engine.reset();
        for (size_t j = 0; j < df.size(); ++j) {
            engine.processBar(df.close[j], df.volume[j]);
        }
    }

    // Measure with hardware counters
    PerfCounterGroup counters;
    counters.add(PerfEvent::CPU_CYCLES);
    counters.add(PerfEvent::INSTRUCTIONS);
    counters.add(PerfEvent::BRANCH_INSTRUCTIONS);
    counters.add(PerfEvent::BRANCH_MISSES);
    counters.add(PerfEvent::CACHE_MISSES);

    {
        ScopedPerfCounters scope(counters);

        for (size_t iter = 0; iter < config.measureIterations; ++iter) {
            engine.reset();
            for (size_t i = 0; i < df.size(); ++i) {
                engine.processBar(df.close[i], df.volume[i]);
            }
        }
    }

    auto results = counters.read();
    uint64_t branchInsns = 0;

    for (const auto& r : results) {
        switch (r.event) {
            case PerfEvent::CPU_CYCLES:
                result.cycles = r.value;
                break;
            case PerfEvent::INSTRUCTIONS:
                result.instructions = r.value;
                break;
            case PerfEvent::BRANCH_INSTRUCTIONS:
                branchInsns = r.value;
                break;
            case PerfEvent::BRANCH_MISSES:
                result.branchMisses = r.value;
                break;
            case PerfEvent::CACHE_MISSES:
                result.cacheMisses = r.value;
                break;
            default:
                break;
        }
    }

    if (result.cycles > 0) {
        result.ipc = static_cast<double>(result.instructions) / result.cycles;
    }
    if (branchInsns > 0) {
        result.branchMissRate = 100.0 * result.branchMisses / branchInsns;
    }

    return result;
}

// ============================================================================
// Benchmark: Cold vs Warm
// ============================================================================

struct ColdWarmResult {
    LatencyStats coldStats;
    LatencyStats warmStats;
    double ratio = 0;
};

ColdWarmResult benchmarkColdWarm(const BenchConfig& config) {
    ColdWarmResult result;

    auto df = generateTestData(config.barCount);
    double freqGhz = get_cpu_freq_ghz();

    // Cold measurements (fresh engine each time)
    {
        std::vector<double> samples;
        samples.reserve(100);

        for (size_t i = 0; i < 100; ++i) {
            MockIndicatorEngine engine;  // Fresh instance
            engine.reset();

            uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
            for (size_t j = 0; j < df.size(); ++j) {
                engine.processBar(df.close[j], df.volume[j]);
            }
            uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

            samples.push_back(cycles_to_ns(end - start, freqGhz) / df.size());
        }

        result.coldStats.compute(samples);
    }

    // Warm measurements (reused engine)
    {
        MockIndicatorEngine engine;

        // Warmup phase
        for (size_t i = 0; i < config.warmupIterations; ++i) {
            engine.reset();
            for (size_t j = 0; j < df.size(); ++j) {
                engine.processBar(df.close[j], df.volume[j]);
            }
        }

        // Measure
        std::vector<double> samples;
        samples.reserve(100);

        for (size_t i = 0; i < 100; ++i) {
            engine.reset();

            uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
            for (size_t j = 0; j < df.size(); ++j) {
                engine.processBar(df.close[j], df.volume[j]);
            }
            uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

            samples.push_back(cycles_to_ns(end - start, freqGhz) / df.size());
        }

        result.warmStats.compute(samples);
    }

    result.ratio = result.coldStats.p99_ns / std::max(result.warmStats.p99_ns, 0.001);

    return result;
}

// ============================================================================
// Report Generation
// ============================================================================

void printReport(const PerBarResult& perBar, const AllocationResult& alloc,
                 const HwCounterResult& hw, const ColdWarmResult& coldWarm,
                 const BenchConfig& config) {
    std::cout << "\n";
    std::cout << "========================================================\n";
    std::cout << "           EXECUTION LOOP BENCHMARK REPORT\n";
    std::cout << "========================================================\n";
    std::cout << "\n";

    // Configuration
    std::cout << "Configuration:\n";
    std::cout << "  Bar count:        " << config.barCount << "\n";
    std::cout << "  Warmup iters:     " << config.warmupIterations << "\n";
    std::cout << "  Measure iters:    " << config.measureIterations << "\n";
    std::cout << "  VM-safe RDTSC:    " << (config.useVmSafe ? "yes" : "no") << "\n";
    std::cout << "\n";

    // Per-bar Latency
    std::cout << std::fixed << std::setprecision(2);
    std::cout << "Per-bar Latency (nanoseconds):\n";
    std::cout << "  Min:          " << perBar.stats.min_ns << " ns\n";
    std::cout << "  P50:          " << perBar.stats.p50_ns << " ns\n";
    std::cout << "  P99:          " << perBar.stats.p99_ns << " ns\n";
    std::cout << "  P99.9:        " << perBar.stats.p999_ns << " ns\n";
    std::cout << "  Max:          " << perBar.stats.max_ns << " ns\n";
    std::cout << "  Cycles/bar:   " << perBar.cyclesPerBar << "\n";
    std::cout << "  Signals:      " << perBar.signalsGenerated << "\n";
    std::cout << "\n";

    // Cold vs Warm
    std::cout << "Cold vs Warm (P99 per-bar ns):\n";
    std::cout << "  Cold P99:     " << coldWarm.coldStats.p99_ns << " ns\n";
    std::cout << "  Warm P99:     " << coldWarm.warmStats.p99_ns << " ns\n";
    std::cout << "  Ratio:        " << coldWarm.ratio << "x\n";
    std::cout << "\n";

    // Allocation Audit
    std::cout << "Hot Path Allocation Audit:\n";
    std::cout << "  Allocations:  " << alloc.allocations << "\n";
    std::cout << "  Status:       " << (alloc.passed ? "PASSED" : "FAILED") << "\n";
    std::cout << "\n";

    // Hardware Counters
    std::cout << "Hardware Counters:\n";
    std::cout << "  CPU Cycles:       " << hw.cycles << "\n";
    std::cout << "  Instructions:     " << hw.instructions << "\n";
    std::cout << "  IPC:              " << std::setprecision(3) << hw.ipc << "\n";
    std::cout << "  Branch Misses:    " << hw.branchMisses << "\n";
    std::cout << "  Branch Miss Rate: " << std::setprecision(2) << hw.branchMissRate << " %\n";
    std::cout << "  Cache Misses:     " << hw.cacheMisses << "\n";
    std::cout << "\n";

    // Target Comparison
    std::cout << "Target Comparison:\n";
    std::cout << "  Per-bar latency:      " << perBar.stats.p50_ns << " ns";
    std::cout << (perBar.stats.p50_ns < 1000 ? " [PASS: < 1us]" : " [FAIL: >= 1us]") << "\n";
    std::cout << "  Cold/warm ratio:      " << coldWarm.ratio << "x";
    std::cout << (coldWarm.ratio < 10 ? " [PASS: < 10x]" : " [FAIL: >= 10x]") << "\n";
    std::cout << "  Branch miss rate:     " << hw.branchMissRate << " %";
    std::cout << (hw.branchMissRate < 1 ? " [PASS: < 1%]" : " [FAIL: >= 1%]") << "\n";
    std::cout << "  Hot path allocations: " << alloc.allocations;
    std::cout << (alloc.passed ? " [PASS: 0]" : " [FAIL: > 0]") << "\n";
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
    std::cerr << "  --bars N        Number of bars to generate (default: 100000)\n";
    std::cerr << "  --warmup N      Warmup iterations (default: 1000)\n";
    std::cerr << "  --measure N     Measurement iterations (default: 10000)\n";
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
    std::cout << "Running execution loop benchmarks...\n";

    auto perBarResult = benchmarkPerBarLatency(config);
    auto allocResult = benchmarkHotPathAllocations(config);
    auto hwResult = benchmarkHwCounters(config);
    auto coldWarmResult = benchmarkColdWarm(config);

    // Print report
    printReport(perBarResult, allocResult, hwResult, coldWarmResult, config);

    // Return non-zero if any critical target failed
    bool passed = allocResult.passed &&
                  perBarResult.stats.p50_ns < 1000 &&
                  coldWarmResult.ratio < 10;

    return passed ? 0 : 1;
}
