/**
 * @file deferred_processor.hpp
 * @brief Deferred Processing Pattern for Hot Path Optimization
 *
 * Reference: TICKET_216 - Modern C++ Optimization Research
 * Source: NanoLog deferred logging pattern
 *
 * Key Principle: Move expensive work off the hot path
 *
 * HOT PATH (~20ns):
 *   - Serialize data to buffer
 *   - Record timestamp
 *   - Push to queue
 *   - Return immediately
 *
 * COLD PATH (background thread):
 *   - Full parsing/validation
 *   - Persistence (disk I/O)
 *   - Callbacks/notifications
 *
 * Expected Gain: 10-100x hot path reduction
 */

#pragma once

#include "benchmark_utils.hpp"
#include "memory_pool.hpp"

#include <atomic>
#include <array>
#include <cstring>
#include <functional>
#include <thread>
#include <span>

namespace qnx::bench {

// ============================================================================
// SPSC Queue for Deferred Processing
// ============================================================================

/**
 * @brief Lock-free Single Producer Single Consumer queue
 *
 * Optimizations:
 * - Cache-line aligned head/tail to prevent false sharing
 * - Cached indices to reduce atomic loads
 * - Power-of-2 capacity for fast modulo
 */
template <typename T, size_t Capacity>
class alignas(CACHE_LINE_SIZE) SPSCQueue {
    static_assert((Capacity & (Capacity - 1)) == 0, "Capacity must be power of 2");

public:
    SPSCQueue() = default;

    // Non-copyable, non-movable
    SPSCQueue(const SPSCQueue&) = delete;
    SPSCQueue& operator=(const SPSCQueue&) = delete;

    /**
     * @brief Try to push an item (producer only)
     * @return true if successful, false if queue is full
     */
    [[nodiscard]] bool try_push(const T& item) noexcept {
        const size_t head = head_.load(std::memory_order_relaxed);
        const size_t next_head = (head + 1) & MASK;

        // Check if full (use cached tail first)
        if (next_head == cached_tail_) {
            cached_tail_ = tail_.load(std::memory_order_acquire);
            if (next_head == cached_tail_) {
                return false;  // Queue full
            }
        }

        buffer_[head] = item;
        head_.store(next_head, std::memory_order_release);
        return true;
    }

    /**
     * @brief Try to pop an item (consumer only)
     * @return true if successful, false if queue is empty
     */
    [[nodiscard]] bool try_pop(T& item) noexcept {
        const size_t tail = tail_.load(std::memory_order_relaxed);

        // Check if empty (use cached head first)
        if (tail == cached_head_) {
            cached_head_ = head_.load(std::memory_order_acquire);
            if (tail == cached_head_) {
                return false;  // Queue empty
            }
        }

        item = buffer_[tail];
        tail_.store((tail + 1) & MASK, std::memory_order_release);
        return true;
    }

    /**
     * @brief Check if queue is empty
     */
    [[nodiscard]] bool empty() const noexcept {
        return head_.load(std::memory_order_acquire) ==
               tail_.load(std::memory_order_acquire);
    }

    /**
     * @brief Get approximate size
     */
    [[nodiscard]] size_t size_approx() const noexcept {
        const size_t head = head_.load(std::memory_order_relaxed);
        const size_t tail = tail_.load(std::memory_order_relaxed);
        return (head - tail) & MASK;
    }

    [[nodiscard]] static constexpr size_t capacity() noexcept { return Capacity; }

private:
    static constexpr size_t MASK = Capacity - 1;

    alignas(CACHE_LINE_SIZE) std::atomic<size_t> head_{0};
    alignas(CACHE_LINE_SIZE) size_t cached_tail_{0};  // Producer's cached tail
    alignas(CACHE_LINE_SIZE) std::atomic<size_t> tail_{0};
    alignas(CACHE_LINE_SIZE) size_t cached_head_{0};  // Consumer's cached head
    alignas(CACHE_LINE_SIZE) std::array<T, Capacity> buffer_{};
};

// ============================================================================
// Message Buffer for Deferred Processing
// ============================================================================

/**
 * @brief Fixed-size message buffer with timestamp
 */
struct alignas(CACHE_LINE_SIZE) DeferredMessage {
    static constexpr size_t MAX_DATA_SIZE = 256;

    uint64_t timestamp{0};           // RDTSC timestamp
    uint32_t size{0};                // Actual data size
    uint32_t id{0};                  // Message ID (for tracking)
    std::array<char, MAX_DATA_SIZE> data{};

    void set(const void* src, size_t len, uint32_t msg_id) noexcept {
        timestamp = rdtsc_vm_safe();
        size = static_cast<uint32_t>(std::min(len, MAX_DATA_SIZE));
        id = msg_id;
        std::memcpy(data.data(), src, size);
    }
};

// ============================================================================
// Deferred Processor
// ============================================================================

/**
 * @brief Hot/Cold path separator using SPSC queue
 *
 * Usage:
 *   DeferredProcessor proc;
 *   proc.set_handler([](const DeferredMessage& msg) {
 *       // Expensive processing here (cold path)
 *   });
 *   proc.start();
 *
 *   // Hot path - returns in ~20ns
 *   proc.submit(data, size);
 *
 *   proc.stop();
 */
template <size_t QueueCapacity = 65536>
class DeferredProcessor {
public:
    using Handler = std::function<void(const DeferredMessage&)>;

    DeferredProcessor() = default;

    ~DeferredProcessor() {
        stop();
    }

    // Non-copyable, non-movable
    DeferredProcessor(const DeferredProcessor&) = delete;
    DeferredProcessor& operator=(const DeferredProcessor&) = delete;

    /**
     * @brief Set the handler for processing messages
     */
    void set_handler(Handler handler) {
        handler_ = std::move(handler);
    }

    /**
     * @brief Start the background processing thread
     */
    void start() {
        if (running_.load(std::memory_order_relaxed)) return;

        running_.store(true, std::memory_order_release);
        worker_ = std::thread([this] { process_loop(); });
    }

    /**
     * @brief Stop the background thread
     */
    void stop() {
        if (!running_.load(std::memory_order_relaxed)) return;

        running_.store(false, std::memory_order_release);
        if (worker_.joinable()) {
            worker_.join();
        }
    }

    /**
     * @brief Submit data for deferred processing (HOT PATH)
     *
     * This is the critical hot path - should complete in ~20ns
     *
     * @return true if submitted, false if queue full
     */
    [[nodiscard]] bool submit(const void* data, size_t size) noexcept {
        DeferredMessage msg;
        msg.set(data, size, next_id_.fetch_add(1, std::memory_order_relaxed));
        return queue_.try_push(msg);
    }

    /**
     * @brief Submit with pre-built message
     */
    [[nodiscard]] bool submit(const DeferredMessage& msg) noexcept {
        return queue_.try_push(msg);
    }

    /**
     * @brief Get queue statistics
     */
    struct Stats {
        size_t submitted;
        size_t processed;
        size_t queue_size;
        size_t dropped;
    };

    [[nodiscard]] Stats stats() const noexcept {
        return Stats{
            .submitted = submitted_.load(std::memory_order_relaxed),
            .processed = processed_.load(std::memory_order_relaxed),
            .queue_size = queue_.size_approx(),
            .dropped = dropped_.load(std::memory_order_relaxed)
        };
    }

    /**
     * @brief Check if processor is running
     */
    [[nodiscard]] bool is_running() const noexcept {
        return running_.load(std::memory_order_relaxed);
    }

private:
    void process_loop() {
        DeferredMessage msg;

        while (running_.load(std::memory_order_relaxed)) {
            if (queue_.try_pop(msg)) {
                if (handler_) {
                    handler_(msg);
                }
                processed_.fetch_add(1, std::memory_order_relaxed);
            } else {
                // No work - yield or spin
                std::this_thread::yield();
            }
        }

        // Drain remaining messages
        while (queue_.try_pop(msg)) {
            if (handler_) {
                handler_(msg);
            }
            processed_.fetch_add(1, std::memory_order_relaxed);
        }
    }

    SPSCQueue<DeferredMessage, QueueCapacity> queue_;
    Handler handler_;
    std::thread worker_;
    std::atomic<bool> running_{false};
    std::atomic<uint32_t> next_id_{0};
    std::atomic<size_t> submitted_{0};
    std::atomic<size_t> processed_{0};
    std::atomic<size_t> dropped_{0};
};

// ============================================================================
// Benchmark Helper: Measure Hot Path Latency
// ============================================================================

/**
 * @brief Measure deferred processing hot path latency
 */
struct DeferredBenchResult {
    double hot_path_ns;      // Median hot path latency
    double p99_ns;           // 99th percentile
    double throughput_mps;   // Million operations per second
    size_t total_submitted;
    size_t total_processed;
};

/**
 * @brief Benchmark the hot path submit latency
 */
inline DeferredBenchResult benchmark_deferred_hot_path(
    size_t iterations = 10000,
    size_t warmup = 1000
) {
    DeferredProcessor<8192> proc;

    // Dummy handler - just count
    std::atomic<size_t> count{0};
    proc.set_handler([&count](const DeferredMessage&) {
        count.fetch_add(1, std::memory_order_relaxed);
    });
    proc.start();

    // Test data
    char data[64] = "test message for deferred processing benchmark";

    // Warmup
    for (size_t i = 0; i < warmup; ++i) {
        (void)proc.submit(data, sizeof(data));
    }

    // Wait for warmup to process
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    // Measure hot path
    std::vector<double> latencies;
    latencies.reserve(iterations);

    double freq_ghz = estimate_cpu_freq_ghz(50);

    for (size_t i = 0; i < iterations; ++i) {
        uint64_t start = rdtsc_vm_safe();
        compiler_barrier();

        (void)proc.submit(data, sizeof(data));

        compiler_barrier();
        uint64_t end = rdtsc_vm_safe();

        latencies.push_back(static_cast<double>(end - start) / freq_ghz);

        // Periodically let processor catch up
        if (i % 1000 == 0) {
            std::this_thread::sleep_for(std::chrono::microseconds(100));
        }
    }

    // Wait for processing to complete
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    proc.stop();

    // Calculate statistics
    if (latencies.empty()) {
        return DeferredBenchResult{0, 0, 0, 0, 0};
    }

    std::sort(latencies.begin(), latencies.end());

    DeferredBenchResult result;
    size_t n = latencies.size();
    result.hot_path_ns = latencies[n / 2];  // Median
    result.p99_ns = latencies[std::min(n - 1, n * 99 / 100)];
    result.total_submitted = iterations + warmup;
    result.total_processed = count.load();

    double total_ns = 0;
    for (double l : latencies) total_ns += l;
    result.throughput_mps = static_cast<double>(n) / (total_ns / 1e9) / 1e6;

    return result;
}

}  // namespace qnx::bench
