/**
 * @file bench_serialization.cpp
 * @brief JSON serialization benchmark
 *
 * Reference: TICKET_174 - C++ Executor Benchmark Framework
 * Reference: modernc_quant.md #83 - std::bit_cast
 *
 * Benchmarks:
 * - BacktestResult JSON serialization
 * - IncrementalResult JSON serialization
 * - Trade record serialization
 * - Large equity curve handling
 */

#include "benchmark_utils.hpp"
#include "memory_tracker.hpp"
#include "perf_counters.hpp"

#include <quantnexus/executor/result_types.hpp>

#include <iostream>
#include <iomanip>
#include <random>
#include <sstream>

using namespace qnx::bench;
using namespace StratCraft::executor;

// ============================================================================
// Configuration
// ============================================================================

struct BenchConfig {
    size_t tradeCount = 1000;
    size_t equityPoints = 10000;
    size_t candleCount = 10000;
    size_t warmupIterations = 100;
    size_t measureIterations = 1000;
    bool useVmSafe = false;
    int cpuCore = -1;
};

// ============================================================================
// Generate Test Data
// ============================================================================

BacktestResult generateBacktestResult(size_t tradeCount, size_t equityPoints,
                                       size_t candleCount) {
    BacktestResult result;
    result.success = true;
    result.startTime = 1609459200000;
    result.endTime = 1640995200000;
    result.executionTimeMs = 1234;

    result.metrics.totalPnl = 12345.67;
    result.metrics.totalReturn = 12.34;
    result.metrics.annualizedReturn = 24.68;
    result.metrics.sharpeRatio = 1.5;
    result.metrics.maxDrawdown = 5.5;
    result.metrics.totalTrades = static_cast<int>(tradeCount);
    result.metrics.winRate = 55.5;

    std::mt19937 rng(42);
    std::uniform_real_distribution<double> priceDist(100.0, 200.0);
    std::uniform_real_distribution<double> pnlDist(-100.0, 200.0);

    // Generate trades
    result.trades.reserve(tradeCount);
    int64_t timestamp = result.startTime;
    for (size_t i = 0; i < tradeCount; ++i) {
        Trade trade{
            .entryTime = timestamp,
            .exitTime = timestamp + 3600000,
            .symbol = "BTCUSDT",
            .side = (i % 2 == 0) ? "buy" : "sell",
            .entryPrice = priceDist(rng),
            .exitPrice = priceDist(rng),
            .quantity = 1.0,
            .pnl = pnlDist(rng),
            .commission = 0.1,
            .reason = "signal"
        };
        result.trades.push_back(trade);
        timestamp += 86400000;  // 1 day
    }

    // Generate equity curve
    result.equityCurve.reserve(equityPoints);
    timestamp = result.startTime;
    double equity = 100000.0;
    for (size_t i = 0; i < equityPoints; ++i) {
        equity *= (1.0 + pnlDist(rng) / 100000.0);
        EquityPoint point{
            .timestamp = timestamp,
            .equity = equity,
            .drawdown = std::max(0.0, 100000.0 - equity) / 100000.0 * 100
        };
        result.equityCurve.push_back(point);
        timestamp += 60000;  // 1 minute
    }

    // Generate candles
    result.candles.reserve(candleCount);
    timestamp = result.startTime;
    double price = 150.0;
    for (size_t i = 0; i < candleCount; ++i) {
        double change = pnlDist(rng) / 1000.0;
        Candle candle{
            .timestamp = timestamp,
            .open = price,
            .high = price * (1.0 + std::abs(change)),
            .low = price * (1.0 - std::abs(change)),
            .close = price + change,
            .volume = 1000.0 + pnlDist(rng) * 10
        };
        result.candles.push_back(candle);
        price = candle.close;
        timestamp += 60000;
    }

    return result;
}

IncrementalResult generateIncrementalResult(size_t tradeCount, size_t equityPoints,
                                             size_t candleCount) {
    IncrementalResult result;

    std::mt19937 rng(42);
    std::uniform_real_distribution<double> priceDist(100.0, 200.0);
    std::uniform_real_distribution<double> pnlDist(-100.0, 200.0);

    int64_t timestamp = 1609459200000;

    // New candles
    result.newCandles.reserve(candleCount);
    double price = 150.0;
    for (size_t i = 0; i < candleCount; ++i) {
        double change = pnlDist(rng) / 1000.0;
        Candle candle{
            .timestamp = timestamp,
            .open = price,
            .high = price * (1.0 + std::abs(change)),
            .low = price * (1.0 - std::abs(change)),
            .close = price + change,
            .volume = 1000.0
        };
        result.newCandles.push_back(candle);
        price = candle.close;
        timestamp += 60000;
    }

    // New trades
    result.newTrades.reserve(tradeCount);
    for (size_t i = 0; i < tradeCount; ++i) {
        Trade trade{
            .entryTime = timestamp,
            .exitTime = timestamp + 3600000,
            .symbol = "BTCUSDT",
            .side = "buy",
            .entryPrice = priceDist(rng),
            .exitPrice = priceDist(rng),
            .quantity = 1.0,
            .pnl = pnlDist(rng),
            .commission = 0.1,
            .reason = "signal"
        };
        result.newTrades.push_back(trade);
    }

    // New equity points
    result.newEquityPoints.reserve(equityPoints);
    double equity = 100000.0;
    for (size_t i = 0; i < equityPoints; ++i) {
        EquityPoint point{
            .timestamp = timestamp,
            .equity = equity,
            .drawdown = 0.0
        };
        result.newEquityPoints.push_back(point);
        timestamp += 60000;
    }

    result.currentMetrics.totalPnl = 1000.0;
    result.processedBars = 5000;
    result.totalBars = 10000;

    return result;
}

// ============================================================================
// Benchmark: BacktestResult Serialization
// ============================================================================

struct SerializationResult {
    LatencyStats stats;
    size_t jsonSize = 0;
    double mbPerSecond = 0;
};

SerializationResult benchmarkBacktestSerialization(const BenchConfig& config) {
    SerializationResult result;

    auto backtestResult = generateBacktestResult(
        config.tradeCount, config.equityPoints, config.candleCount);

    double freqGhz = get_cpu_freq_ghz();

    // Warmup
    for (size_t i = 0; i < config.warmupIterations; ++i) {
        std::string json = backtestResult.ToJson();
        compiler_barrier();
    }

    // Measure
    std::vector<double> samples;
    samples.reserve(config.measureIterations);

    for (size_t i = 0; i < config.measureIterations; ++i) {
        uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        compiler_barrier();
        std::string json = backtestResult.ToJson();
        compiler_barrier();
        uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        samples.push_back(cycles_to_ns(end - start, freqGhz));

        if (i == 0) {
            result.jsonSize = json.size();
        }
    }

    result.stats.compute(samples);

    // Calculate throughput
    double avgNs = result.stats.mean_ns;
    double avgSeconds = avgNs / 1e9;
    double bytesPerSecond = result.jsonSize / avgSeconds;
    result.mbPerSecond = bytesPerSecond / (1024 * 1024);

    return result;
}

// ============================================================================
// Benchmark: IncrementalResult Serialization
// ============================================================================

SerializationResult benchmarkIncrementalSerialization(const BenchConfig& config) {
    SerializationResult result;

    // Smaller batch for incremental updates
    auto incrementalResult = generateIncrementalResult(
        config.tradeCount / 10, config.equityPoints / 10, config.candleCount / 10);

    double freqGhz = get_cpu_freq_ghz();

    // Warmup
    for (size_t i = 0; i < config.warmupIterations; ++i) {
        std::string json = incrementalResult.ToJson();
        compiler_barrier();
    }

    // Measure
    std::vector<double> samples;
    samples.reserve(config.measureIterations);

    for (size_t i = 0; i < config.measureIterations; ++i) {
        uint64_t start = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();
        compiler_barrier();
        std::string json = incrementalResult.ToJson();
        compiler_barrier();
        uint64_t end = config.useVmSafe ? rdtsc_vm_safe() : rdtsc_precise();

        samples.push_back(cycles_to_ns(end - start, freqGhz));

        if (i == 0) {
            result.jsonSize = json.size();
        }
    }

    result.stats.compute(samples);

    double avgNs = result.stats.mean_ns;
    double avgSeconds = avgNs / 1e9;
    double bytesPerSecond = result.jsonSize / avgSeconds;
    result.mbPerSecond = bytesPerSecond / (1024 * 1024);

    return result;
}

// ============================================================================
// Benchmark: Hardware Counters
// ============================================================================

struct HwCounterResult {
    uint64_t cycles = 0;
    uint64_t instructions = 0;
    uint64_t cacheMisses = 0;
    double ipc = 0;
};

HwCounterResult benchmarkHwCounters(const BenchConfig& config) {
    HwCounterResult result;

    auto backtestResult = generateBacktestResult(
        config.tradeCount, config.equityPoints, config.candleCount);

    // Warmup
    for (size_t i = 0; i < config.warmupIterations; ++i) {
        std::string json = backtestResult.ToJson();
        compiler_barrier();
    }

    // Measure
    PerfCounterGroup counters;
    counters.add(PerfEvent::CPU_CYCLES);
    counters.add(PerfEvent::INSTRUCTIONS);
    counters.add(PerfEvent::CACHE_MISSES);

    {
        ScopedPerfCounters scope(counters);

        for (size_t i = 0; i < config.measureIterations; ++i) {
            std::string json = backtestResult.ToJson();
            compiler_barrier();
        }
    }

    auto results = counters.read();
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
            default:
                break;
        }
    }

    if (result.cycles > 0) {
        result.ipc = static_cast<double>(result.instructions) / result.cycles;
    }

    return result;
}

// ============================================================================
// Benchmark: Allocation During Serialization
// ============================================================================

struct AllocationResult {
    size_t allocations = 0;
    size_t bytesAllocated = 0;
};

AllocationResult benchmarkSerializationAllocations(const BenchConfig& config) {
    AllocationResult result;

    auto backtestResult = generateBacktestResult(
        config.tradeCount, config.equityPoints, config.candleCount);

    // Warmup
    for (size_t i = 0; i < config.warmupIterations; ++i) {
        std::string json = backtestResult.ToJson();
        compiler_barrier();
    }

    // Measure allocations
    {
        ScopedMemoryTracker tracker;

        for (size_t i = 0; i < 10; ++i) {
            std::string json = backtestResult.ToJson();
            compiler_barrier();
        }

        result.allocations = tracker.allocations();
        result.bytesAllocated = tracker.bytes_allocated();
    }

    return result;
}

// ============================================================================
// Report Generation
// ============================================================================

void printReport(const SerializationResult& backtest,
                 const SerializationResult& incremental,
                 const HwCounterResult& hw,
                 const AllocationResult& alloc,
                 const BenchConfig& config) {
    std::cout << "\n";
    std::cout << "========================================================\n";
    std::cout << "          SERIALIZATION BENCHMARK REPORT\n";
    std::cout << "========================================================\n";
    std::cout << "\n";

    // Configuration
    std::cout << "Configuration:\n";
    std::cout << "  Trade count:      " << config.tradeCount << "\n";
    std::cout << "  Equity points:    " << config.equityPoints << "\n";
    std::cout << "  Candle count:     " << config.candleCount << "\n";
    std::cout << "  Warmup iters:     " << config.warmupIterations << "\n";
    std::cout << "  Measure iters:    " << config.measureIterations << "\n";
    std::cout << "\n";

    // BacktestResult
    std::cout << std::fixed << std::setprecision(2);
    std::cout << "BacktestResult Serialization:\n";
    std::cout << "  JSON size:        " << (backtest.jsonSize / 1024.0) << " KB\n";
    std::cout << "  P50 latency:      " << (backtest.stats.p50_ns / 1e6) << " ms\n";
    std::cout << "  P99 latency:      " << (backtest.stats.p99_ns / 1e6) << " ms\n";
    std::cout << "  Throughput:       " << backtest.mbPerSecond << " MB/s\n";
    std::cout << "\n";

    // IncrementalResult
    std::cout << "IncrementalResult Serialization:\n";
    std::cout << "  JSON size:        " << (incremental.jsonSize / 1024.0) << " KB\n";
    std::cout << "  P50 latency:      " << (incremental.stats.p50_ns / 1e3) << " us\n";
    std::cout << "  P99 latency:      " << (incremental.stats.p99_ns / 1e3) << " us\n";
    std::cout << "  Throughput:       " << incremental.mbPerSecond << " MB/s\n";
    std::cout << "\n";

    // Hardware Counters
    std::cout << "Hardware Counters (BacktestResult, " << config.measureIterations << " iters):\n";
    std::cout << "  CPU Cycles:       " << hw.cycles << "\n";
    std::cout << "  Instructions:     " << hw.instructions << "\n";
    std::cout << "  IPC:              " << std::setprecision(3) << hw.ipc << "\n";
    std::cout << "  Cache Misses:     " << hw.cacheMisses << "\n";
    std::cout << "\n";

    // Allocation Stats
    std::cout << "Allocation Stats (10 iterations):\n";
    std::cout << "  Allocations:      " << alloc.allocations << "\n";
    std::cout << "  Bytes allocated:  " << (alloc.bytesAllocated / 1024.0) << " KB\n";
    std::cout << "\n";

    // Target Comparison
    std::cout << "Target Comparison:\n";
    double backtestMs = backtest.stats.p50_ns / 1e6;
    std::cout << "  BacktestResult P50: " << backtestMs << " ms";
    std::cout << (backtestMs < 10 ? " [PASS: < 10ms]" : " [FAIL: >= 10ms]") << "\n";

    double incrementalUs = incremental.stats.p50_ns / 1e3;
    std::cout << "  IncrementalResult P50: " << incrementalUs << " us";
    std::cout << (incrementalUs < 100 ? " [PASS: < 100us]" : " [FAIL: >= 100us]") << "\n";
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
    std::cerr << "  --trades N      Trade count (default: 1000)\n";
    std::cerr << "  --equity N      Equity points (default: 10000)\n";
    std::cerr << "  --candles N     Candle count (default: 10000)\n";
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
        } else if (arg == "--trades" && i + 1 < argc) {
            config.tradeCount = std::stoull(argv[++i]);
        } else if (arg == "--equity" && i + 1 < argc) {
            config.equityPoints = std::stoull(argv[++i]);
        } else if (arg == "--candles" && i + 1 < argc) {
            config.candleCount = std::stoull(argv[++i]);
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
    std::cout << "Running serialization benchmarks...\n";

    auto backtestResult = benchmarkBacktestSerialization(config);
    auto incrementalResult = benchmarkIncrementalSerialization(config);
    auto hwResult = benchmarkHwCounters(config);
    auto allocResult = benchmarkSerializationAllocations(config);

    // Print report
    printReport(backtestResult, incrementalResult, hwResult, allocResult, config);

    return 0;
}
