/**
 * Lock-free Data Structures
 *
 * TICKET_175 Phase 7: Lock-free Data Structures
 *
 * Provides:
 * - SPSC (Single Producer Single Consumer) lock-free queue
 * - MPSC (Multi Producer Single Consumer) lock-free queue
 * - Atomic counters with cache-line padding
 * - Memory ordering utilities
 *
 * modernc_quant.md references:
 * - #64 Lock-free queue
 * - #65 Atomic operations
 * - #66-68 Memory ordering
 * - #71 Hazard pointers (future)
 */

#pragma once

#include <atomic>
#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <new>
#include <memory>
#include <type_traits>

#include "hardware_constants.hpp"

namespace StratCraft::executor::lockfree {

// TICKET_476: CACHE_LINE_SIZE centralized in hardware_constants.hpp
using StratCraft::executor::constants::CACHE_LINE_SIZE;

// =============================================================================
// Cache-line Padded Atomic (modernc_quant #65)
// =============================================================================

/**
 * Atomic value padded to cache line to prevent false sharing
 */
template<typename T>
struct alignas(CACHE_LINE_SIZE) PaddedAtomic {
    std::atomic<T> value{};
    char padding[CACHE_LINE_SIZE - sizeof(std::atomic<T>)];

    PaddedAtomic() noexcept = default;
    explicit PaddedAtomic(T initial) noexcept : value(initial) {}

    T load(std::memory_order order = std::memory_order_seq_cst) const noexcept {
        return value.load(order);
    }

    void store(T val, std::memory_order order = std::memory_order_seq_cst) noexcept {
        value.store(val, order);
    }

    T fetch_add(T arg, std::memory_order order = std::memory_order_seq_cst) noexcept {
        return value.fetch_add(arg, order);
    }

    T fetch_sub(T arg, std::memory_order order = std::memory_order_seq_cst) noexcept {
        return value.fetch_sub(arg, order);
    }

    bool compare_exchange_weak(T& expected, T desired,
                               std::memory_order order = std::memory_order_seq_cst) noexcept {
        return value.compare_exchange_weak(expected, desired, order);
    }

    bool compare_exchange_strong(T& expected, T desired,
                                 std::memory_order order = std::memory_order_seq_cst) noexcept {
        return value.compare_exchange_strong(expected, desired, order);
    }
};

// =============================================================================
// Atomic Counter with Statistics
// =============================================================================

/**
 * High-performance atomic counter for metrics
 * Uses relaxed ordering for maximum throughput
 */
class AtomicCounter {
public:
    AtomicCounter() noexcept = default;
    explicit AtomicCounter(uint64_t initial) noexcept : count_(initial) {}

    void increment() noexcept {
        count_.fetch_add(1, std::memory_order_relaxed);
    }

    void add(uint64_t n) noexcept {
        count_.fetch_add(n, std::memory_order_relaxed);
    }

    void decrement() noexcept {
        count_.fetch_sub(1, std::memory_order_relaxed);
    }

    [[nodiscard]] uint64_t get() const noexcept {
        return count_.load(std::memory_order_relaxed);
    }

    void reset() noexcept {
        count_.store(0, std::memory_order_relaxed);
    }

private:
    PaddedAtomic<uint64_t> count_{0};
};

// =============================================================================
// SPSC Lock-free Queue (modernc_quant #64)
// =============================================================================

/**
 * Single Producer Single Consumer lock-free bounded queue
 *
 * Properties:
 * - Wait-free for both push and pop
 * - Cache-line aligned to prevent false sharing
 * - Power-of-two capacity for fast modulo
 *
 * Usage:
 *   SPSCQueue<MarketData, 1024> queue;
 *   // Producer thread:
 *   queue.push(data);
 *   // Consumer thread:
 *   if (auto data = queue.pop()) { process(*data); }
 */
template<typename T, size_t Capacity>
class SPSCQueue {
    static_assert((Capacity & (Capacity - 1)) == 0, "Capacity must be power of 2");
    static_assert(Capacity >= 2, "Capacity must be at least 2");

public:
    SPSCQueue() noexcept {
        // Initialize all slots
        for (size_t i = 0; i < Capacity; ++i) {
            new (&storage_[i]) Slot();
        }
    }

    ~SPSCQueue() {
        // Destroy any remaining elements
        while (pop().has_value()) {}
    }

    // Non-copyable, non-movable
    SPSCQueue(const SPSCQueue&) = delete;
    SPSCQueue& operator=(const SPSCQueue&) = delete;
    SPSCQueue(SPSCQueue&&) = delete;
    SPSCQueue& operator=(SPSCQueue&&) = delete;

    /**
     * Push element (producer only)
     * @return true if successful, false if queue is full
     */
    template<typename U>
    [[nodiscard]] bool push(U&& value) noexcept {
        const size_t head = head_.load(std::memory_order_relaxed);
        const size_t nextHead = (head + 1) & mask_;

        // Check if full (head catching up to tail)
        if (nextHead == tail_.load(std::memory_order_acquire)) {
            return false;  // Queue full
        }

        // Construct element in place
        new (&storage_[head].data) T(std::forward<U>(value));

        // Publish the write (release ensures data is visible before head update)
        head_.store(nextHead, std::memory_order_release);
        return true;
    }

    /**
     * Pop element (consumer only)
     * @return element if available, nullopt if queue is empty
     */
    [[nodiscard]] std::optional<T> pop() noexcept {
        const size_t tail = tail_.load(std::memory_order_relaxed);

        // Check if empty
        if (tail == head_.load(std::memory_order_acquire)) {
            return std::nullopt;  // Queue empty
        }

        // Read the element
        T value = std::move(storage_[tail].data);

        // Destroy the element
        storage_[tail].data.~T();

        // Advance tail (release not needed, acquire on head is sufficient)
        tail_.store((tail + 1) & mask_, std::memory_order_release);
        return value;
    }

    /**
     * Check if queue is empty
     */
    [[nodiscard]] bool empty() const noexcept {
        return head_.load(std::memory_order_acquire) ==
               tail_.load(std::memory_order_acquire);
    }

    /**
     * Approximate size (may be inaccurate under concurrent access)
     */
    [[nodiscard]] size_t size_approx() const noexcept {
        const size_t head = head_.load(std::memory_order_relaxed);
        const size_t tail = tail_.load(std::memory_order_relaxed);
        return (head - tail) & mask_;
    }

    /**
     * Maximum capacity
     */
    [[nodiscard]] static constexpr size_t capacity() noexcept {
        return Capacity - 1;  // One slot always empty to distinguish full/empty
    }

private:
    static constexpr size_t mask_ = Capacity - 1;

    struct alignas(CACHE_LINE_SIZE) Slot {
        T data;
    };

    // Separate cache lines for head and tail to prevent false sharing
    alignas(CACHE_LINE_SIZE) std::atomic<size_t> head_{0};
    alignas(CACHE_LINE_SIZE) std::atomic<size_t> tail_{0};
    alignas(CACHE_LINE_SIZE) std::array<Slot, Capacity> storage_;
};

// =============================================================================
// MPSC Lock-free Queue (Multi Producer Single Consumer)
// =============================================================================

/**
 * Multi Producer Single Consumer lock-free queue
 *
 * Uses a linked-list with atomic operations
 * Suitable for event aggregation from multiple sources
 */
template<typename T>
class MPSCQueue {
public:
    MPSCQueue() noexcept {
        // Create stub node
        stub_ = new Node();
        head_.store(stub_, std::memory_order_relaxed);
        tail_.store(stub_, std::memory_order_relaxed);
    }

    ~MPSCQueue() {
        // Drain remaining elements
        while (pop().has_value()) {}
        delete stub_;
    }

    // Non-copyable, non-movable
    MPSCQueue(const MPSCQueue&) = delete;
    MPSCQueue& operator=(const MPSCQueue&) = delete;

    /**
     * Push element (any thread)
     */
    template<typename U>
    void push(U&& value) {
        Node* node = new Node(std::forward<U>(value));
        push_node(node);
    }

    /**
     * Pop element (consumer thread only)
     */
    [[nodiscard]] std::optional<T> pop() noexcept {
        Node* tail = tail_.load(std::memory_order_relaxed);
        Node* next = tail->next.load(std::memory_order_acquire);

        if (tail == stub_) {
            if (next == nullptr) {
                return std::nullopt;  // Empty
            }
            tail_.store(next, std::memory_order_relaxed);
            tail = next;
            next = next->next.load(std::memory_order_acquire);
        }

        if (next != nullptr) {
            tail_.store(next, std::memory_order_relaxed);
            T value = std::move(tail->data);
            delete tail;
            return value;
        }

        Node* head = head_.load(std::memory_order_acquire);
        if (tail != head) {
            return std::nullopt;  // Another push in progress
        }

        // Reinsert stub
        push_node(stub_);

        next = tail->next.load(std::memory_order_acquire);
        if (next != nullptr) {
            tail_.store(next, std::memory_order_relaxed);
            T value = std::move(tail->data);
            delete tail;
            return value;
        }

        return std::nullopt;
    }

    /**
     * Check if empty (approximate)
     */
    [[nodiscard]] bool empty() const noexcept {
        Node* tail = tail_.load(std::memory_order_acquire);
        Node* next = tail->next.load(std::memory_order_acquire);
        return (tail == stub_ && next == nullptr);
    }

private:
    struct Node {
        T data;
        std::atomic<Node*> next{nullptr};

        Node() noexcept = default;

        template<typename U>
        explicit Node(U&& value) : data(std::forward<U>(value)) {}
    };

    void push_node(Node* node) noexcept {
        node->next.store(nullptr, std::memory_order_relaxed);
        Node* prev = head_.exchange(node, std::memory_order_acq_rel);
        prev->next.store(node, std::memory_order_release);
    }

    alignas(CACHE_LINE_SIZE) std::atomic<Node*> head_;
    alignas(CACHE_LINE_SIZE) std::atomic<Node*> tail_;
    Node* stub_;
};

// =============================================================================
// Sequence Lock (for read-heavy workloads)
// =============================================================================

/**
 * Sequence lock for read-heavy scenarios
 *
 * Writers acquire exclusive access, readers retry on conflict
 * Useful for configuration updates read by many threads
 */
class SeqLock {
public:
    SeqLock() noexcept = default;

    /**
     * Begin read operation
     * @return sequence number to verify consistency
     */
    [[nodiscard]] uint64_t read_begin() const noexcept {
        uint64_t seq;
        do {
            seq = seq_.load(std::memory_order_acquire);
        } while (seq & 1);  // Wait if write in progress
        return seq;
    }

    /**
     * Verify read consistency
     * @return true if read was consistent
     */
    [[nodiscard]] bool read_retry(uint64_t seq) const noexcept {
        std::atomic_thread_fence(std::memory_order_acquire);
        return seq_.load(std::memory_order_relaxed) != seq;
    }

    /**
     * Begin write operation
     */
    void write_begin() noexcept {
        uint64_t seq = seq_.load(std::memory_order_relaxed);
        while (!seq_.compare_exchange_weak(seq, seq + 1,
                                           std::memory_order_acquire,
                                           std::memory_order_relaxed)) {
            seq = seq_.load(std::memory_order_relaxed);
        }
    }

    /**
     * End write operation
     */
    void write_end() noexcept {
        seq_.fetch_add(1, std::memory_order_release);
    }

    /**
     * RAII write guard
     */
    class WriteGuard {
    public:
        explicit WriteGuard(SeqLock& lock) noexcept : lock_(lock) {
            lock_.write_begin();
        }
        ~WriteGuard() {
            lock_.write_end();
        }
        WriteGuard(const WriteGuard&) = delete;
        WriteGuard& operator=(const WriteGuard&) = delete;
    private:
        SeqLock& lock_;
    };

private:
    alignas(CACHE_LINE_SIZE) std::atomic<uint64_t> seq_{0};
};

// =============================================================================
// Static Assertions
// =============================================================================

static_assert(sizeof(PaddedAtomic<uint64_t>) == CACHE_LINE_SIZE,
              "PaddedAtomic should be cache-line sized");
static_assert(sizeof(AtomicCounter) >= CACHE_LINE_SIZE,
              "AtomicCounter should be at least cache-line sized");

} // namespace StratCraft::executor::lockfree
