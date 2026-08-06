/**
 * Thread-Local Object Pool
 *
 * TICKET_473_8: Ultra-fast thread-local object allocation
 *
 * Provides:
 * - Thread-local singleton (zero contention across threads)
 * - LIFO free stack for O(1) acquire/release
 * - Cache-line aligned storage for optimal cache behavior
 * - PooledPtr<T> RAII wrapper with automatic release
 *
 * Target: ~3-5ns allocation (vs 50-100ns malloc)
 *
 * Usage:
 *   auto& pool = ThreadLocalPool<Order, 1024>::instance();
 *   {
 *       auto ptr = pool.acquire();
 *       ptr->symbol = "AAPL";
 *       ptr->quantity = 100;
 *       // auto-released when ptr goes out of scope
 *   }
 *
 */

#pragma once

#include <cstddef>
#include <cstdint>
#include <array>
#include <memory>
#include <new>
#include <type_traits>
#include <cassert>

#include "hardware_constants.hpp"

namespace StratCraft::executor {

inline constexpr size_t POOL_CACHE_LINE_SIZE = constants::CACHE_LINE_SIZE;

// Forward declaration
template<typename T, size_t Capacity>
class ThreadLocalPool;

// =============================================================================
// PooledPtr - RAII wrapper that auto-releases to pool
// =============================================================================

/**
 * Smart pointer that returns the object to its pool on destruction.
 * Move-only, non-copyable.
 */
template<typename T, size_t Capacity>
class PooledPtr {
public:
    PooledPtr() noexcept : ptr_{nullptr}, pool_{nullptr} {}

    PooledPtr(T* ptr, ThreadLocalPool<T, Capacity>* pool) noexcept
        : ptr_{ptr}, pool_{pool} {}

    ~PooledPtr() {
        if (ptr_ && pool_) {
            pool_->release(ptr_);
        }
    }

    // Move-only
    PooledPtr(PooledPtr&& other) noexcept
        : ptr_{other.ptr_}, pool_{other.pool_} {
        other.ptr_ = nullptr;
        other.pool_ = nullptr;
    }

    PooledPtr& operator=(PooledPtr&& other) noexcept {
        if (this != &other) {
            if (ptr_ && pool_) {
                pool_->release(ptr_);
            }
            ptr_ = other.ptr_;
            pool_ = other.pool_;
            other.ptr_ = nullptr;
            other.pool_ = nullptr;
        }
        return *this;
    }

    // Non-copyable
    PooledPtr(const PooledPtr&) = delete;
    PooledPtr& operator=(const PooledPtr&) = delete;

    // Access
    [[nodiscard]] T* get() const noexcept { return ptr_; }
    [[nodiscard]] T& operator*() const noexcept { return *ptr_; }
    [[nodiscard]] T* operator->() const noexcept { return ptr_; }
    [[nodiscard]] explicit operator bool() const noexcept { return ptr_ != nullptr; }

    /// Release ownership without returning to pool
    T* release() noexcept {
        T* p = ptr_;
        ptr_ = nullptr;
        pool_ = nullptr;
        return p;
    }

private:
    T* ptr_;
    ThreadLocalPool<T, Capacity>* pool_;
};

// =============================================================================
// ThreadLocalPool - Lock-free thread-local object pool
// =============================================================================

/**
 * Thread-local object pool with LIFO free stack.
 *
 * Each thread gets its own pool instance (zero contention).
 * Objects are pre-allocated in a contiguous cache-friendly slab.
 *
 * @tparam T Object type (must be default-constructible)
 * @tparam Capacity Maximum number of pooled objects
 */
template<typename T, size_t Capacity>
class ThreadLocalPool {
    static_assert(Capacity > 0, "Capacity must be > 0");

public:
    /// Get the thread-local pool instance
    [[nodiscard]] static ThreadLocalPool& instance() noexcept {
        thread_local ThreadLocalPool pool;
        return pool;
    }

    ThreadLocalPool() noexcept {
        // Initialize free stack: all slots available
        for (size_t i = 0; i < Capacity; ++i) {
            free_stack_[i] = &storage_[i].object;
        }
        free_count_ = Capacity;
    }

    ~ThreadLocalPool() = default;

    // Non-copyable, non-movable
    ThreadLocalPool(const ThreadLocalPool&) = delete;
    ThreadLocalPool& operator=(const ThreadLocalPool&) = delete;

    /**
     * Acquire an object from the pool.
     * Returns nullptr-wrapping PooledPtr if pool is exhausted.
     */
    [[nodiscard]] PooledPtr<T, Capacity> acquire() noexcept {
        if (free_count_ == 0) [[unlikely]] {
            return PooledPtr<T, Capacity>{nullptr, nullptr};
        }

        --free_count_;
        T* ptr = free_stack_[free_count_];
        return PooledPtr<T, Capacity>{ptr, this};
    }

    /**
     * Release an object back to the pool.
     * Called automatically by PooledPtr destructor.
     */
    void release(T* ptr) noexcept {
        assert(ptr != nullptr);
        assert(free_count_ < Capacity);

        // Reset object to default state
        ptr->~T();
        new (ptr) T();

        free_stack_[free_count_] = ptr;
        ++free_count_;
    }

    // --- Statistics ---

    [[nodiscard]] size_t available() const noexcept { return free_count_; }
    [[nodiscard]] size_t in_use() const noexcept { return Capacity - free_count_; }
    [[nodiscard]] static constexpr size_t capacity() noexcept { return Capacity; }

private:
    /// Cache-line aligned storage slot
    struct alignas(POOL_CACHE_LINE_SIZE) Slot {
        T object{};
    };

    std::array<Slot, Capacity> storage_{};
    std::array<T*, Capacity> free_stack_{};
    size_t free_count_{0};
};

// =============================================================================
// Static Assertions
// =============================================================================

// Verify pool slot alignment
static_assert(alignof(typename ThreadLocalPool<int, 4>::PooledPtr) <= POOL_CACHE_LINE_SIZE,
              "PooledPtr should fit within alignment constraints");

} // namespace StratCraft::executor
