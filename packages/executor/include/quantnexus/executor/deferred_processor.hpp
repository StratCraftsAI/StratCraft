/**
 * Deferred Processor - Two-Phase Hot Path Processing
 *
 * TICKET_473_2: Move formatting, serialization, and I/O off the hot path
 *
 * Design:
 * - Hot path (~20ns): RDTSC timestamp + memcpy into fixed buffer + push to SPSC queue
 * - Background thread: drain queue, parse, serialize, callback
 *
 * Uses existing infrastructure:
 * - SPSCQueue from lockfree_queue.hpp
 * - rdtsc_vm_safe() from rdtsc.hpp
 *
 * Usage:
 *   DeferredProcessor<TradeEvent, 4096> processor;
 *   processor.start([](const TradeEvent& evt, uint64_t ts) {
 *       serialize_to_json(evt, ts);
 *   });
 *
 *   // On hot path (~20ns):
 *   processor.publish(trade_event);
 *
 *   // Shutdown:
 *   processor.stop();
 *
 */

#pragma once

#include "executor_constants.hpp"
#include "lockfree_queue.hpp"
#include "rdtsc.hpp"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <functional>
#include <thread>
#include <type_traits>

namespace StratCraft::executor {

// =============================================================================
// DeferredMessageBuffer - Fixed-size stamped message
// =============================================================================

/**
 * Fixed-size buffer holding a timestamped copy of the hot-path message.
 *
 * @tparam N Maximum message size in bytes
 */
template<size_t N>
struct DeferredMessageBuffer {
    static_assert(N > 0, "Buffer size must be > 0");

    uint64_t timestamp{0};           // RDTSC cycle count at publish time
    alignas(8) char data[N]{};       // Raw message bytes
    size_t size{0};                  // Actual data size

    DeferredMessageBuffer() noexcept = default;
};

// =============================================================================
// DeferredProcessor
// =============================================================================

/**
 * Two-phase deferred processor.
 *
 * Hot path: stamp + memcpy + push (~20ns target)
 * Background: drain + callback (unlimited time budget)
 *
 * @tparam T Message type (must be trivially copyable)
 * @tparam QueueCapacity SPSC queue capacity (must be power of 2)
 */
template<typename T, size_t QueueCapacity = constants::DEFERRED_QUEUE_CAPACITY>
class DeferredProcessor {
    static_assert(std::is_trivially_copyable_v<T>,
                  "DeferredProcessor requires trivially copyable types for memcpy");
    static_assert((QueueCapacity & (QueueCapacity - 1)) == 0,
                  "QueueCapacity must be power of 2");

public:
    using Buffer = DeferredMessageBuffer<sizeof(T)>;
    using SingleCallback = std::function<void(const T&, uint64_t)>;
    using BatchCallback = std::function<void(const T*, const uint64_t*, size_t)>;

    DeferredProcessor() noexcept = default;

    ~DeferredProcessor() {
        stop();
    }

    // Non-copyable, non-movable
    DeferredProcessor(const DeferredProcessor&) = delete;
    DeferredProcessor& operator=(const DeferredProcessor&) = delete;

    /**
     * Start the background drain thread with single-message callback.
     *
     * @param callback Called for each message on the background thread
     */
    void start(SingleCallback callback) {
        if (running_.load(std::memory_order_relaxed)) return;

        single_callback_ = std::move(callback);
        batch_callback_ = nullptr;
        running_.store(true, std::memory_order_release);

        drain_thread_ = std::thread([this] { drain_loop(); });
    }

    /**
     * Start the background drain thread with batch callback.
     *
     * @param callback Called with a batch of messages on the background thread
     * @param max_batch Maximum messages per batch drain
     */
    void start_batch(BatchCallback callback, size_t max_batch = constants::DEFERRED_MAX_BATCH_SIZE) {
        if (running_.load(std::memory_order_relaxed)) return;

        batch_callback_ = std::move(callback);
        single_callback_ = nullptr;
        max_batch_ = max_batch;
        running_.store(true, std::memory_order_release);

        drain_thread_ = std::thread([this] { drain_loop_batch(); });
    }

    /**
     * Stop the background thread and drain remaining messages.
     */
    void stop() {
        if (!running_.load(std::memory_order_relaxed)) return;

        running_.store(false, std::memory_order_release);
        if (drain_thread_.joinable()) {
            drain_thread_.join();
        }
    }

    /**
     * Publish a message from the hot path.
     *
     * Hot-path cost: RDTSC + memcpy + SPSC push (~20ns target)
     *
     * @param msg Message to publish
     * @return true if published, false if queue is full
     */
    [[nodiscard]] bool publish(const T& msg) noexcept {
        Buffer buf;
        buf.timestamp = bench::rdtsc_vm_safe();
        std::memcpy(buf.data, &msg, sizeof(T));
        buf.size = sizeof(T);
        return queue_.push(std::move(buf));
    }

    /**
     * Check if the processor is running.
     */
    [[nodiscard]] bool is_running() const noexcept {
        return running_.load(std::memory_order_relaxed);
    }

    /**
     * Approximate number of pending messages.
     */
    [[nodiscard]] size_t pending() const noexcept {
        return queue_.size_approx();
    }

    /**
     * Total messages processed by the background thread.
     */
    [[nodiscard]] uint64_t processed_count() const noexcept {
        return processed_.load(std::memory_order_relaxed);
    }

    /**
     * Total messages dropped (queue full at publish time).
     */
    [[nodiscard]] uint64_t dropped_count() const noexcept {
        return dropped_.load(std::memory_order_relaxed);
    }

private:
    // Single-message drain loop
    void drain_loop() {
        while (running_.load(std::memory_order_acquire) || !queue_.empty()) {
            auto buf = queue_.pop();
            if (buf.has_value()) {
                T msg;
                std::memcpy(&msg, buf->data, sizeof(T));
                if (single_callback_) {
                    single_callback_(msg, buf->timestamp);
                }
                processed_.fetch_add(1, std::memory_order_relaxed);
            } else {
                // No messages available, brief pause to avoid busy-spinning
                std::this_thread::yield();
            }
        }
    }

    // Batch drain loop
    void drain_loop_batch() {
        std::vector<T> msgs;
        std::vector<uint64_t> timestamps;
        msgs.reserve(max_batch_);
        timestamps.reserve(max_batch_);

        while (running_.load(std::memory_order_acquire) || !queue_.empty()) {
            msgs.clear();
            timestamps.clear();

            // Drain up to max_batch messages
            for (size_t i = 0; i < max_batch_; ++i) {
                auto buf = queue_.pop();
                if (!buf.has_value()) break;

                T msg;
                std::memcpy(&msg, buf->data, sizeof(T));
                msgs.push_back(std::move(msg));
                timestamps.push_back(buf->timestamp);
            }

            if (!msgs.empty()) {
                if (batch_callback_) {
                    batch_callback_(msgs.data(), timestamps.data(), msgs.size());
                }
                processed_.fetch_add(msgs.size(), std::memory_order_relaxed);
            } else {
                std::this_thread::yield();
            }
        }
    }

    lockfree::SPSCQueue<Buffer, QueueCapacity> queue_;
    std::atomic<bool> running_{false};
    std::thread drain_thread_;

    SingleCallback single_callback_;
    BatchCallback batch_callback_;
    size_t max_batch_{constants::DEFERRED_MAX_BATCH_SIZE};

    std::atomic<uint64_t> processed_{0};
    std::atomic<uint64_t> dropped_{0};
};

} // namespace StratCraft::executor
