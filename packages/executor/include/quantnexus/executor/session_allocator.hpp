/**
 * Session Allocator - Per-Session Memory Isolation
 *
 * TICKET_470 Phase 2.2: mimalloc per-session heap integration
 *
 * Provides per-backtest-task memory isolation with O(1) cleanup.
 * When a backtest completes, all memory is freed instantly by
 * destroying the session heap, avoiding individual deallocation.
 *
 * When QNX_HAS_MIMALLOC is not defined, falls back to standard
 * new/delete with explicit cleanup.
 *
 * Source pattern: NexusFIX session memory isolation
 *
 * Usage:
 *   {
 *       SessionAllocator session;
 *       auto* trades = session.allocate<Trade>(1000);
 *       // ... backtest execution ...
 *   }  // O(1) cleanup: all memory freed instantly
 */

#pragma once

#include <cstddef>
#include <memory>
#include <new>
#include <vector>
#include <memory_resource>

#if defined(QNX_HAS_MIMALLOC) && QNX_HAS_MIMALLOC
#include <mimalloc.h>
#define QNX_MIMALLOC_ENABLED 1
#else
#define QNX_MIMALLOC_ENABLED 0
#endif

namespace StratCraft::executor {

// =============================================================================
// SessionAllocator - Per-session heap with O(1) cleanup
// =============================================================================

class SessionAllocator {
public:
    SessionAllocator() noexcept {
#if QNX_MIMALLOC_ENABLED
        heap_ = mi_heap_new();
#endif
    }

    ~SessionAllocator() {
#if QNX_MIMALLOC_ENABLED
        if (heap_) {
            mi_heap_destroy(heap_);  // O(1) bulk free
            heap_ = nullptr;
        }
#else
        // Standard mode: free tracked allocations
        for (auto* ptr : allocations_) {
            ::operator delete(ptr);
        }
        allocations_.clear();
#endif
    }

    // Non-copyable, non-movable (owns heap resource)
    SessionAllocator(const SessionAllocator&) = delete;
    SessionAllocator& operator=(const SessionAllocator&) = delete;
    SessionAllocator(SessionAllocator&&) = delete;
    SessionAllocator& operator=(SessionAllocator&&) = delete;

    /**
     * Allocate array of T from session heap
     *
     * @param count Number of elements
     * @return Pointer to uninitialized memory
     */
    template<typename T>
    [[nodiscard]] T* allocate(size_t count) {
        const size_t bytes = count * sizeof(T);
#if QNX_MIMALLOC_ENABLED
        void* ptr = mi_heap_malloc_aligned(heap_, bytes, alignof(T));
#else
        void* ptr = ::operator new(bytes, std::align_val_t{alignof(T)});
        allocations_.push_back(ptr);
#endif
        if (!ptr) throw std::bad_alloc();
        return static_cast<T*>(ptr);
    }

    /**
     * Allocate and zero-initialize array of T
     */
    template<typename T>
    [[nodiscard]] T* allocate_zeroed(size_t count) {
        const size_t bytes = count * sizeof(T);
#if QNX_MIMALLOC_ENABLED
        void* ptr = mi_heap_zalloc_aligned(heap_, bytes, alignof(T));
#else
        void* ptr = ::operator new(bytes, std::align_val_t{alignof(T)});
        allocations_.push_back(ptr);
        std::memset(ptr, 0, bytes);
#endif
        if (!ptr) throw std::bad_alloc();
        return static_cast<T*>(ptr);
    }

    /**
     * Get memory statistics for this session
     */
    struct Stats {
        size_t allocated_bytes;
        size_t reserved_bytes;
    };

    [[nodiscard]] Stats stats() const noexcept {
        Stats s{};
#if QNX_MIMALLOC_ENABLED
        // Walk heap to collect stats is expensive; return 0 as approximation
        // Production use should rely on mi_stats_print for profiling
        s.allocated_bytes = 0;
        s.reserved_bytes = 0;
#else
        s.allocated_bytes = allocations_.size();  // count only in fallback
        s.reserved_bytes = 0;
#endif
        return s;
    }

    /**
     * Check if mimalloc is active
     */
    [[nodiscard]] static constexpr bool is_mimalloc() noexcept {
        return QNX_MIMALLOC_ENABLED != 0;
    }

private:
#if QNX_MIMALLOC_ENABLED
    mi_heap_t* heap_ = nullptr;
#else
    std::vector<void*> allocations_;
#endif
};

// =============================================================================
// SessionPmrResource - PMR adapter for SessionAllocator
// =============================================================================

/**
 * PMR memory resource backed by SessionAllocator
 *
 * Enables use of std::pmr containers with session-scoped memory.
 *
 * Usage:
 *   SessionAllocator session;
 *   SessionPmrResource resource(session);
 *   std::pmr::vector<double> data(&resource);
 */
class SessionPmrResource : public std::pmr::memory_resource {
public:
    explicit SessionPmrResource(SessionAllocator& session) noexcept
        : session_(session) {}

protected:
    void* do_allocate(size_t bytes, size_t alignment) override {
        (void)alignment;
        return session_.allocate<std::byte>(bytes);
    }

    void do_deallocate(void* /*ptr*/, size_t /*bytes*/, size_t /*alignment*/) override {
        // Session allocator: no individual deallocation
        // All memory freed when SessionAllocator is destroyed
    }

    bool do_is_equal(const memory_resource& other) const noexcept override {
        return this == &other;
    }

private:
    SessionAllocator& session_;
};

} // namespace StratCraft::executor
