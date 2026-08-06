/**
 * Lock-free Data Structures Benchmark
 *
 * TICKET_175 Phase 7: Lock-free Data Structures
 *
 * Benchmarks:
 * - SPSC queue throughput
 * - MPSC queue throughput
 * - Atomic counter performance
 * - Comparison with mutex-based alternatives
 */

#include "../include/benchmark_utils.hpp"

#include "quantnexus/executor/lockfree_queue.hpp"

#include <iostream>
#include <iomanip>
#include <thread>
#include <vector>
#include <mutex>
#include <queue>
#include <chrono>
#include <numeric>

using namespace qnx::bench;
using namespace StratCraft::executor::lockfree;

// =============================================================================
// Configuration
// =============================================================================

struct BenchConfig {
    size_t numOperations = 1000000;
    size_t numProducers = 4;
    size_t warmupOps = 10000;
    bool vmSafe = false;
};

// =============================================================================
// Test Data
// =============================================================================

struct MarketTick {
    int64_t timestamp;
    double price;
    double volume;
    uint32_t flags;
};

// =============================================================================
// Benchmark: SPSC Queue Throughput
// =============================================================================

struct SPSCResult {
    double opsPerSecond;
    double avgLatencyNs;
    size_t successful;
    size_t failed;
};

SPSCResult benchmarkSPSC(const BenchConfig& config) {
    SPSCResult result{};

    SPSCQueue<MarketTick, 8192> queue;
    std::atomic<bool> done{false};
    std::atomic<size_t> consumed{0};

    // Consumer thread
    std::thread consumer([&]() {
        while (!done.load(std::memory_order_relaxed) ||
               !queue.empty()) {
            if (auto tick = queue.pop()) {
                consumed.fetch_add(1, std::memory_order_relaxed);
            }
        }
    });

    // Warmup
    for (size_t i = 0; i < config.warmupOps; ++i) {
        MarketTick tick{static_cast<int64_t>(i), 100.0 + i * 0.01, 1000.0, 0};
        while (!queue.push(tick)) {
            std::this_thread::yield();
        }
    }

    // Wait for warmup to complete
    while (consumed.load() < config.warmupOps) {
        std::this_thread::yield();
    }
    consumed.store(0);

    // Measure
    auto start = std::chrono::high_resolution_clock::now();

    for (size_t i = 0; i < config.numOperations; ++i) {
        MarketTick tick{static_cast<int64_t>(i), 100.0 + i * 0.01, 1000.0, 0};
        if (queue.push(tick)) {
            result.successful++;
        } else {
            result.failed++;
            // Retry
            while (!queue.push(tick)) {
                std::this_thread::yield();
            }
            result.successful++;
        }
    }

    // Wait for all to be consumed
    while (consumed.load() < config.numOperations) {
        std::this_thread::yield();
    }

    auto end = std::chrono::high_resolution_clock::now();
    done.store(true);
    consumer.join();

    auto durationNs = std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    result.opsPerSecond = config.numOperations * 1e9 / durationNs;
    result.avgLatencyNs = static_cast<double>(durationNs) / config.numOperations;

    return result;
}

// =============================================================================
// Benchmark: Mutex Queue (Baseline)
// =============================================================================

template<typename T>
class MutexQueue {
public:
    void push(const T& value) {
        std::lock_guard<std::mutex> lock(mutex_);
        queue_.push(value);
    }

    std::optional<T> pop() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (queue_.empty()) return std::nullopt;
        T value = std::move(queue_.front());
        queue_.pop();
        return value;
    }

    bool empty() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return queue_.empty();
    }

private:
    mutable std::mutex mutex_;
    std::queue<T> queue_;
};

SPSCResult benchmarkMutexQueue(const BenchConfig& config) {
    SPSCResult result{};

    MutexQueue<MarketTick> queue;
    std::atomic<bool> done{false};
    std::atomic<size_t> consumed{0};

    // Consumer thread
    std::thread consumer([&]() {
        while (!done.load(std::memory_order_relaxed) ||
               !queue.empty()) {
            if (auto tick = queue.pop()) {
                consumed.fetch_add(1, std::memory_order_relaxed);
            }
        }
    });

    // Warmup
    for (size_t i = 0; i < config.warmupOps; ++i) {
        MarketTick tick{static_cast<int64_t>(i), 100.0 + i * 0.01, 1000.0, 0};
        queue.push(tick);
    }

    while (consumed.load() < config.warmupOps) {
        std::this_thread::yield();
    }
    consumed.store(0);

    // Measure
    auto start = std::chrono::high_resolution_clock::now();

    for (size_t i = 0; i < config.numOperations; ++i) {
        MarketTick tick{static_cast<int64_t>(i), 100.0 + i * 0.01, 1000.0, 0};
        queue.push(tick);
        result.successful++;
    }

    while (consumed.load() < config.numOperations) {
        std::this_thread::yield();
    }

    auto end = std::chrono::high_resolution_clock::now();
    done.store(true);
    consumer.join();

    auto durationNs = std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    result.opsPerSecond = config.numOperations * 1e9 / durationNs;
    result.avgLatencyNs = static_cast<double>(durationNs) / config.numOperations;

    return result;
}

// =============================================================================
// Benchmark: Atomic Counter
// =============================================================================

struct CounterResult {
    double opsPerSecond;
    double avgLatencyNs;
};

CounterResult benchmarkAtomicCounter(const BenchConfig& config) {
    CounterResult result{};

    AtomicCounter counter;
    std::vector<std::thread> threads;

    auto start = std::chrono::high_resolution_clock::now();

    // Multiple threads incrementing
    for (size_t t = 0; t < config.numProducers; ++t) {
        threads.emplace_back([&, opsPerThread = config.numOperations / config.numProducers]() {
            for (size_t i = 0; i < opsPerThread; ++i) {
                counter.increment();
            }
        });
    }

    for (auto& t : threads) {
        t.join();
    }

    auto end = std::chrono::high_resolution_clock::now();

    auto durationNs = std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    result.opsPerSecond = config.numOperations * 1e9 / durationNs;
    result.avgLatencyNs = static_cast<double>(durationNs) / config.numOperations;

    return result;
}

// =============================================================================
// Benchmark: Mutex Counter (Baseline)
// =============================================================================

class MutexCounter {
public:
    void increment() {
        std::lock_guard<std::mutex> lock(mutex_);
        count_++;
    }

    uint64_t get() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return count_;
    }

private:
    mutable std::mutex mutex_;
    uint64_t count_ = 0;
};

CounterResult benchmarkMutexCounter(const BenchConfig& config) {
    CounterResult result{};

    MutexCounter counter;
    std::vector<std::thread> threads;

    auto start = std::chrono::high_resolution_clock::now();

    for (size_t t = 0; t < config.numProducers; ++t) {
        threads.emplace_back([&, opsPerThread = config.numOperations / config.numProducers]() {
            for (size_t i = 0; i < opsPerThread; ++i) {
                counter.increment();
            }
        });
    }

    for (auto& t : threads) {
        t.join();
    }

    auto end = std::chrono::high_resolution_clock::now();

    auto durationNs = std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    result.opsPerSecond = config.numOperations * 1e9 / durationNs;
    result.avgLatencyNs = static_cast<double>(durationNs) / config.numOperations;

    return result;
}

// =============================================================================
// Benchmark: MPSC Queue
// =============================================================================

SPSCResult benchmarkMPSC(const BenchConfig& config) {
    SPSCResult result{};

    MPSCQueue<MarketTick> queue;
    std::atomic<bool> done{false};
    std::atomic<size_t> consumed{0};
    std::atomic<size_t> produced{0};

    // Consumer thread
    std::thread consumer([&]() {
        while (!done.load(std::memory_order_relaxed) ||
               consumed.load() < config.numOperations) {
            if (auto tick = queue.pop()) {
                consumed.fetch_add(1, std::memory_order_relaxed);
            }
        }
    });

    auto start = std::chrono::high_resolution_clock::now();

    // Multiple producer threads
    std::vector<std::thread> producers;
    size_t opsPerProducer = config.numOperations / config.numProducers;

    for (size_t p = 0; p < config.numProducers; ++p) {
        producers.emplace_back([&, p, opsPerProducer]() {
            for (size_t i = 0; i < opsPerProducer; ++i) {
                MarketTick tick{
                    static_cast<int64_t>(p * opsPerProducer + i),
                    100.0 + i * 0.01,
                    1000.0,
                    static_cast<uint32_t>(p)
                };
                queue.push(tick);
                produced.fetch_add(1, std::memory_order_relaxed);
            }
        });
    }

    for (auto& t : producers) {
        t.join();
    }

    // Wait for all to be consumed
    while (consumed.load() < config.numOperations) {
        std::this_thread::yield();
    }

    auto end = std::chrono::high_resolution_clock::now();
    done.store(true);
    consumer.join();

    result.successful = consumed.load();
    auto durationNs = std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
    result.opsPerSecond = config.numOperations * 1e9 / durationNs;
    result.avgLatencyNs = static_cast<double>(durationNs) / config.numOperations;

    return result;
}

// =============================================================================
// Report
// =============================================================================

void printReport(const BenchConfig& config,
                 const SPSCResult& spscResult,
                 const SPSCResult& mutexQueueResult,
                 const SPSCResult& mpscResult,
                 const CounterResult& atomicResult,
                 const CounterResult& mutexCounterResult) {

    std::cout << "\n========================================================\n";
    std::cout << "          LOCK-FREE BENCHMARK REPORT\n";
    std::cout << "========================================================\n\n";

    std::cout << "Configuration:\n";
    std::cout << "  Operations:       " << config.numOperations << "\n";
    std::cout << "  Producers:        " << config.numProducers << "\n";
    std::cout << "  Warmup ops:       " << config.warmupOps << "\n\n";

    std::cout << std::fixed << std::setprecision(2);

    std::cout << "Queue Throughput (1 Producer, 1 Consumer):\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  Implementation      M ops/s       Latency ns    Speedup\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  Mutex Queue         " << std::setw(8) << mutexQueueResult.opsPerSecond / 1e6
              << "      " << std::setw(8) << mutexQueueResult.avgLatencyNs
              << "    (baseline)\n";
    std::cout << "  SPSC Lock-free      " << std::setw(8) << spscResult.opsPerSecond / 1e6
              << "      " << std::setw(8) << spscResult.avgLatencyNs
              << "    " << std::setw(6) << spscResult.opsPerSecond / mutexQueueResult.opsPerSecond << "x\n";
    std::cout << "  --------------------------------------------------------\n\n";

    std::cout << "MPSC Queue (" << config.numProducers << " Producers, 1 Consumer):\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  MPSC Lock-free      " << std::setw(8) << mpscResult.opsPerSecond / 1e6
              << "      " << std::setw(8) << mpscResult.avgLatencyNs << "\n";
    std::cout << "  --------------------------------------------------------\n\n";

    std::cout << "Counter Throughput (" << config.numProducers << " threads):\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  Implementation      M ops/s       Latency ns    Speedup\n";
    std::cout << "  --------------------------------------------------------\n";
    std::cout << "  Mutex Counter       " << std::setw(8) << mutexCounterResult.opsPerSecond / 1e6
              << "      " << std::setw(8) << mutexCounterResult.avgLatencyNs
              << "    (baseline)\n";
    std::cout << "  Atomic Counter      " << std::setw(8) << atomicResult.opsPerSecond / 1e6
              << "      " << std::setw(8) << atomicResult.avgLatencyNs
              << "    " << std::setw(6) << atomicResult.opsPerSecond / mutexCounterResult.opsPerSecond << "x\n";
    std::cout << "  --------------------------------------------------------\n\n";

    // Target comparison
    std::cout << "Target Comparison:\n";
    double queueSpeedup = spscResult.opsPerSecond / mutexQueueResult.opsPerSecond;
    std::cout << "  SPSC vs Mutex:      " << std::setw(6) << queueSpeedup << "x ";
    std::cout << (queueSpeedup > 2.0 ? "[PASS: > 2x]" : "[BELOW TARGET]") << "\n";

    std::cout << "  Throughput:         " << std::setw(6) << spscResult.opsPerSecond / 1e6 << " M ops/s ";
    std::cout << (spscResult.opsPerSecond > 10e6 ? "[PASS: > 10M]" : "[BELOW TARGET]") << "\n";

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
        } else if (arg.starts_with("--ops=")) {
            config.numOperations = std::stoul(arg.substr(6));
        } else if (arg.starts_with("--producers=")) {
            config.numProducers = std::stoul(arg.substr(12));
        }
    }

    std::cout << "Running lock-free benchmarks...\n";

    // Run benchmarks
    auto mutexQueueResult = benchmarkMutexQueue(config);
    auto spscResult = benchmarkSPSC(config);
    auto mpscResult = benchmarkMPSC(config);
    auto mutexCounterResult = benchmarkMutexCounter(config);
    auto atomicResult = benchmarkAtomicCounter(config);

    // Print report
    printReport(config, spscResult, mutexQueueResult, mpscResult,
                atomicResult, mutexCounterResult);

    return 0;
}
