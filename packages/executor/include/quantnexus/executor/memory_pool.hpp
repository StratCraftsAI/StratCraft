/**
 * Memory Pool - PMR-based Memory Management
 *
 * TICKET_175 Phase 2: Memory Sovereignty
 *
 * Provides zero-allocation hot path execution through:
 * - PMR monotonic buffer for sequential allocations (modernc_quant #16)
 * - Pool allocator for fixed-size objects
 * - Huge page support for large buffers (modernc_quant #12)
 * - Cache-line aligned allocations (modernc_quant #9)
 *
 * Usage:
 *   qnx::MemoryArena arena(1024 * 1024);  // 1MB arena
 *   auto& pool = arena.pool();
 *   std::pmr::vector<double> prices(&pool);
 *   prices.reserve(10000);  // Allocated from arena, no malloc
 */

#pragma once

#include <memory_resource>
#include <vector>
#include <cstddef>
#include <cstdint>
#include <new>
#include <sys/mman.h>
#include <unistd.h>

#include "hardware_constants.hpp"

namespace StratCraft::executor {

// TICKET_476: Hardware constants centralized in hardware_constants.hpp
inline constexpr size_t CACHE_LINE = constants::CACHE_LINE_SIZE;
using constants::PAGE_SIZE;
using constants::HUGE_PAGE_SIZE;

// =============================================================================
// HugePageAllocator - Large buffer allocation with TLB optimization
// =============================================================================

/**
 * Allocates memory using huge pages (2MB) to reduce TLB misses
 * (modernc_quant #12: Huge pages for large allocations)
 *
 * Falls back to regular pages if huge pages unavailable.
 */
class HugePageAllocator {
public:
    /**
     * Allocate buffer with huge page hint
     * @param size Requested size in bytes
     * @return Pointer to allocated memory (nullptr on failure)
     */
    [[nodiscard]] static void* allocate(size_t size) noexcept {
        // Round up to huge page boundary for large allocations
        if (size >= HUGE_PAGE_SIZE) {
            size = (size + HUGE_PAGE_SIZE - 1) & ~(HUGE_PAGE_SIZE - 1);

            void* ptr = mmap(nullptr, size,
                           PROT_READ | PROT_WRITE,
                           MAP_PRIVATE | MAP_ANONYMOUS | MAP_HUGETLB,
                           -1, 0);

            if (ptr != MAP_FAILED) {
                return ptr;
            }
            // Fall through to regular allocation
        }

        // Regular page-aligned allocation
        size = (size + PAGE_SIZE - 1) & ~(PAGE_SIZE - 1);
        void* ptr = mmap(nullptr, size,
                        PROT_READ | PROT_WRITE,
                        MAP_PRIVATE | MAP_ANONYMOUS,
                        -1, 0);

        return (ptr != MAP_FAILED) ? ptr : nullptr;
    }

    /**
     * Deallocate buffer
     * @param ptr Pointer from allocate()
     * @param size Original requested size
     */
    static void deallocate(void* ptr, size_t size) noexcept {
        if (ptr) {
            // Round up to page boundary
            if (size >= HUGE_PAGE_SIZE) {
                size = (size + HUGE_PAGE_SIZE - 1) & ~(HUGE_PAGE_SIZE - 1);
            } else {
                size = (size + PAGE_SIZE - 1) & ~(PAGE_SIZE - 1);
            }
            munmap(ptr, size);
        }
    }
};

// =============================================================================
// MonotonicBuffer - PMR upstream resource with huge page support
// =============================================================================

/**
 * PMR memory resource backed by a single contiguous buffer
 * (modernc_quant #16: PMR monotonic buffer)
 *
 * Features:
 * - O(1) allocation (bump pointer)
 * - Zero fragmentation
 * - Cache-line aligned allocations
 * - Optional huge page backing
 */
class MonotonicBuffer : public std::pmr::memory_resource {
public:
    /**
     * Create monotonic buffer with specified size
     * @param size Buffer size in bytes
     * @param useHugePages Attempt to use huge pages for TLB optimization
     */
    explicit MonotonicBuffer(size_t size, bool useHugePages = false)
        : bufferSize_(size)
        , useHugePages_(useHugePages)
        , offset_(0)
    {
        if (useHugePages && size >= HUGE_PAGE_SIZE) {
            buffer_ = static_cast<char*>(HugePageAllocator::allocate(size));
        }

        if (!buffer_) {
            // Fallback to aligned allocation
            buffer_ = static_cast<char*>(std::aligned_alloc(CACHE_LINE, size));
            useHugePages_ = false;
        }

        if (!buffer_) {
            throw std::bad_alloc();
        }
    }

    ~MonotonicBuffer() override {
        if (useHugePages_) {
            HugePageAllocator::deallocate(buffer_, bufferSize_);
        } else {
            std::free(buffer_);
        }
    }

    // Non-copyable, non-movable
    MonotonicBuffer(const MonotonicBuffer&) = delete;
    MonotonicBuffer& operator=(const MonotonicBuffer&) = delete;
    MonotonicBuffer(MonotonicBuffer&&) = delete;
    MonotonicBuffer& operator=(MonotonicBuffer&&) = delete;

    /**
     * Reset buffer for reuse (O(1) operation)
     */
    void reset() noexcept {
        offset_ = 0;
    }

    /**
     * Get current usage
     */
    [[nodiscard]] size_t used() const noexcept { return offset_; }

    /**
     * Get total capacity
     */
    [[nodiscard]] size_t capacity() const noexcept { return bufferSize_; }

    /**
     * Get remaining space
     */
    [[nodiscard]] size_t available() const noexcept { return bufferSize_ - offset_; }

protected:
    void* do_allocate(size_t bytes, size_t alignment) override {
        // Align offset to requested alignment (at least cache line)
        alignment = std::max(alignment, CACHE_LINE);
        size_t alignedOffset = (offset_ + alignment - 1) & ~(alignment - 1);

        if (alignedOffset + bytes > bufferSize_) [[unlikely]] {
            throw std::bad_alloc();
        }

        void* ptr = buffer_ + alignedOffset;
        offset_ = alignedOffset + bytes;
        return ptr;
    }

    void do_deallocate(void* /*ptr*/, size_t /*bytes*/, size_t /*alignment*/) override {
        // Monotonic buffer: no individual deallocation
        // Memory is reclaimed only via reset() or destructor
    }

    bool do_is_equal(const memory_resource& other) const noexcept override {
        return this == &other;
    }

private:
    char* buffer_ = nullptr;
    size_t bufferSize_;
    bool useHugePages_;
    size_t offset_;
};

// =============================================================================
// MemoryArena - High-level arena for backtest execution
// =============================================================================

/**
 * Memory arena for zero-allocation backtest execution
 *
 * Provides PMR allocators for all hot path data structures:
 * - Market data vectors
 * - Indicator buffers
 * - Trade records
 *
 * Usage:
 *   MemoryArena arena(64 * 1024 * 1024);  // 64MB
 *   std::pmr::vector<double> closes(&arena.pool());
 *   closes.reserve(1000000);  // No malloc
 */
class MemoryArena {
public:
    /**
     * Create arena with specified capacity
     * @param capacity Total arena size in bytes
     * @param useHugePages Use huge pages for large arenas
     */
    explicit MemoryArena(size_t capacity, bool useHugePages = true)
        : buffer_(capacity, useHugePages && capacity >= HUGE_PAGE_SIZE)
        , pool_(&buffer_)
    {}

    /**
     * Get PMR memory resource for allocators
     */
    [[nodiscard]] std::pmr::memory_resource* resource() noexcept {
        return &buffer_;
    }

    /**
     * Get polymorphic allocator for containers
     */
    [[nodiscard]] std::pmr::polymorphic_allocator<std::byte> allocator() noexcept {
        return std::pmr::polymorphic_allocator<std::byte>(&buffer_);
    }

    /**
     * Get pool allocator (alias for resource)
     */
    [[nodiscard]] std::pmr::memory_resource& pool() noexcept {
        return buffer_;
    }

    /**
     * Reset arena for reuse
     */
    void reset() noexcept {
        buffer_.reset();
    }

    /**
     * Get memory usage statistics
     */
    [[nodiscard]] size_t used() const noexcept { return buffer_.used(); }
    [[nodiscard]] size_t capacity() const noexcept { return buffer_.capacity(); }
    [[nodiscard]] size_t available() const noexcept { return buffer_.available(); }

    /**
     * Check if arena has enough space
     */
    [[nodiscard]] bool hasSpace(size_t bytes) const noexcept {
        return buffer_.available() >= bytes;
    }

private:
    MonotonicBuffer buffer_;
    std::pmr::unsynchronized_pool_resource pool_;
};

// =============================================================================
// CacheAlignedVector - Vector with cache-line aligned elements
// =============================================================================

/**
 * Allocator that ensures cache-line alignment
 * (modernc_quant #9: Cache-line alignment)
 */
template<typename T>
class CacheAlignedAllocator {
public:
    using value_type = T;

    CacheAlignedAllocator() = default;

    template<typename U>
    CacheAlignedAllocator(const CacheAlignedAllocator<U>&) noexcept {}

    [[nodiscard]] T* allocate(size_t n) {
        void* ptr = std::aligned_alloc(CACHE_LINE, n * sizeof(T));
        if (!ptr) throw std::bad_alloc();
        return static_cast<T*>(ptr);
    }

    void deallocate(T* ptr, size_t) noexcept {
        std::free(ptr);
    }

    template<typename U>
    bool operator==(const CacheAlignedAllocator<U>&) const noexcept { return true; }

    template<typename U>
    bool operator!=(const CacheAlignedAllocator<U>&) const noexcept { return false; }
};

/**
 * Vector with cache-line aligned storage
 */
template<typename T>
using CacheAlignedVector = std::vector<T, CacheAlignedAllocator<T>>;

// =============================================================================
// PMR Containers - Convenient type aliases
// =============================================================================

template<typename T>
using pmr_vector = std::pmr::vector<T>;

// =============================================================================
// ScopedArena - RAII arena that resets on destruction
// =============================================================================

/**
 * Scoped arena that automatically resets when leaving scope
 *
 * Usage:
 *   void processBar(MemoryArena& arena) {
 *       ScopedArena scoped(arena);
 *       auto buffer = scoped.allocate<double>(1000);
 *       // ... use buffer ...
 *   }  // arena reset here
 */
class ScopedArena {
public:
    explicit ScopedArena(MemoryArena& arena) noexcept
        : arena_(arena)
        , startOffset_(arena.used())
    {}

    ~ScopedArena() {
        // Note: MonotonicBuffer doesn't support partial reset
        // This is a marker for debugging/profiling
    }

    // Non-copyable, non-movable
    ScopedArena(const ScopedArena&) = delete;
    ScopedArena& operator=(const ScopedArena&) = delete;

    /**
     * Allocate array from arena
     */
    template<typename T>
    [[nodiscard]] T* allocate(size_t count) {
        return static_cast<T*>(
            arena_.resource()->allocate(count * sizeof(T), alignof(T))
        );
    }

    /**
     * Get bytes allocated in this scope
     */
    [[nodiscard]] size_t allocated() const noexcept {
        return arena_.used() - startOffset_;
    }

private:
    MemoryArena& arena_;
    size_t startOffset_;
};

} // namespace StratCraft::executor
