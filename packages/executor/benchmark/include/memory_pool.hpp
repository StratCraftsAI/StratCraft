/**
 * @file memory_pool.hpp
 * @brief PMR-based memory pools for zero-syscall allocation
 *
 * Reference: TICKET_216 - Modern C++ Optimization Research
 *
 * Key Features:
 * - FixedPool: O(1) lock-free allocation from fixed-size blocks
 * - MonotonicPool: PMR wrapper with bulk deallocation
 * - TieredPool: Size-class allocation (small/medium/large)
 *
 * Performance Benefits:
 * - Zero syscalls during allocation (malloc eliminated)
 * - O(1) allocation from pre-allocated pool
 * - No memory fragmentation
 * - Predictable latency
 */

#pragma once

#include <array>
#include <bit>
#include <cstddef>
#include <cstdint>
#include <memory_resource>
#include <new>
#include <span>

namespace qnx::bench {

// ============================================================================
// Constants
// ============================================================================

/// Cache line size for x86-64 (use fixed value for ABI stability)
inline constexpr size_t CACHE_LINE_SIZE = 64;

// ============================================================================
// Fixed-Size Pool Allocator (Lock-free, O(1) allocation)
// ============================================================================

/**
 * @brief Pool of fixed-size blocks with O(1) allocation
 *
 * Uses free-list technique: each free block stores pointer to next free block.
 * No syscalls on hot path - all memory pre-allocated.
 *
 * @tparam BlockSize Size of each block in bytes (must be >= sizeof(void*))
 * @tparam NumBlocks Number of blocks in the pool
 *
 * Example:
 *   FixedPool<256, 1024> pool;  // 1024 blocks of 256 bytes
 *   void* p = pool.allocate();
 *   // ... use p ...
 *   pool.deallocate(p);
 */
template <size_t BlockSize, size_t NumBlocks>
class alignas(CACHE_LINE_SIZE) FixedPool {
public:
    static_assert(BlockSize >= sizeof(void*), "Block must hold a pointer");
    static_assert(std::has_single_bit(BlockSize), "Block size should be power of 2");

    FixedPool() noexcept {
        // Initialize free list: each block points to next
        for (size_t i = 0; i < NumBlocks - 1; ++i) {
            *reinterpret_cast<void**>(&storage_[i * BlockSize]) =
                &storage_[(i + 1) * BlockSize];
        }
        // Last block points to nullptr
        *reinterpret_cast<void**>(&storage_[(NumBlocks - 1) * BlockSize]) = nullptr;
        free_head_ = storage_.data();
    }

    // Non-copyable, non-movable (owns fixed storage)
    FixedPool(const FixedPool&) = delete;
    FixedPool& operator=(const FixedPool&) = delete;
    FixedPool(FixedPool&&) = delete;
    FixedPool& operator=(FixedPool&&) = delete;

    /**
     * @brief Allocate a block (O(1), no syscall)
     * @return Pointer to allocated block, or nullptr if pool exhausted
     */
    [[nodiscard]] void* allocate() noexcept {
        if (free_head_ == nullptr) {
            return nullptr;  // Pool exhausted
        }
        void* block = free_head_;
        free_head_ = *reinterpret_cast<void**>(free_head_);
        ++allocated_count_;
        return block;
    }

    /**
     * @brief Deallocate a block (O(1), no syscall)
     * @param ptr Pointer previously returned by allocate()
     */
    void deallocate(void* ptr) noexcept {
        if (ptr == nullptr) return;
        *reinterpret_cast<void**>(ptr) = free_head_;
        free_head_ = ptr;
        --allocated_count_;
    }

    /**
     * @brief Check if pointer belongs to this pool
     */
    [[nodiscard]] bool owns(const void* ptr) const noexcept {
        const char* p = static_cast<const char*>(ptr);
        return p >= storage_.data() && p < storage_.data() + storage_.size();
    }

    [[nodiscard]] size_t allocated() const noexcept { return allocated_count_; }
    [[nodiscard]] size_t available() const noexcept { return NumBlocks - allocated_count_; }
    [[nodiscard]] static constexpr size_t block_size() noexcept { return BlockSize; }
    [[nodiscard]] static constexpr size_t capacity() noexcept { return NumBlocks; }

private:
    alignas(CACHE_LINE_SIZE) std::array<char, BlockSize * NumBlocks> storage_{};
    void* free_head_{nullptr};
    size_t allocated_count_{0};
};

// ============================================================================
// PMR Monotonic Buffer Resource Wrapper
// ============================================================================

/**
 * @brief Monotonic buffer resource with pre-allocated backing storage
 *
 * Allocations are fast O(1) bump-pointer. Deallocation is no-op (individual).
 * Call reset() to release all memory at once.
 *
 * @tparam Size Total pool size in bytes
 *
 * Example:
 *   MonotonicPool<1024 * 1024> pool;  // 1MB pool
 *   auto alloc = pool.allocator();
 *   std::pmr::vector<int> vec(alloc);
 *   vec.push_back(42);  // No malloc!
 *   pool.reset();  // Release all
 */
template <size_t Size>
class MonotonicPool : public std::pmr::memory_resource {
public:
    MonotonicPool() noexcept
        : upstream_{std::pmr::null_memory_resource()}
        , resource_{buffer_.data(), buffer_.size(), upstream_} {}

    /**
     * @brief Reset the pool (invalidates all allocations)
     */
    void reset() noexcept {
        resource_.release();
    }

    /**
     * @brief Get the PMR allocator for use with containers
     */
    [[nodiscard]] std::pmr::polymorphic_allocator<char> allocator() noexcept {
        return std::pmr::polymorphic_allocator<char>{&resource_};
    }

    /**
     * @brief Get bytes used
     */
    [[nodiscard]] size_t used() const noexcept {
        return bytes_used_;
    }

    [[nodiscard]] static constexpr size_t capacity() noexcept { return Size; }

private:
    void* do_allocate(size_t bytes, size_t alignment) override {
        bytes_used_ += bytes;
        return resource_.allocate(bytes, alignment);
    }

    void do_deallocate([[maybe_unused]] void* p, [[maybe_unused]] size_t bytes,
                        [[maybe_unused]] size_t alignment) override {
        // Monotonic buffer doesn't deallocate individual blocks
    }

    bool do_is_equal(const memory_resource& other) const noexcept override {
        return this == &other;
    }

    alignas(CACHE_LINE_SIZE) std::array<char, Size> buffer_{};
    std::pmr::memory_resource* upstream_;
    std::pmr::monotonic_buffer_resource resource_;
    size_t bytes_used_{0};
};

// ============================================================================
// Tiered Pool for Variable-Size Allocations
// ============================================================================

/**
 * @brief Tiered pool with small/medium/large buckets
 *
 * Automatically selects appropriate bucket based on requested size.
 *
 * Example:
 *   TieredPool pool;
 *   auto buf = pool.allocate(128);  // Uses small pool
 *   // ... use buf ...
 *   pool.deallocate(buf);
 */
class TieredPool {
public:
    static constexpr size_t SMALL_SIZE = 256;
    static constexpr size_t MEDIUM_SIZE = 1024;
    static constexpr size_t LARGE_SIZE = 4096;

    static constexpr size_t SMALL_COUNT = 1024;
    static constexpr size_t MEDIUM_COUNT = 256;
    static constexpr size_t LARGE_COUNT = 64;

    TieredPool() = default;

    // Non-copyable, non-movable
    TieredPool(const TieredPool&) = delete;
    TieredPool& operator=(const TieredPool&) = delete;

    /**
     * @brief Allocate buffer of at least `size` bytes
     * @return Span to allocated buffer, empty if pool exhausted
     */
    [[nodiscard]] std::span<char> allocate(size_t size) noexcept {
        if (size <= SMALL_SIZE) {
            if (void* p = small_pool_.allocate()) {
                return std::span<char>{static_cast<char*>(p), SMALL_SIZE};
            }
        }
        if (size <= MEDIUM_SIZE) {
            if (void* p = medium_pool_.allocate()) {
                return std::span<char>{static_cast<char*>(p), MEDIUM_SIZE};
            }
        }
        if (size <= LARGE_SIZE) {
            if (void* p = large_pool_.allocate()) {
                return std::span<char>{static_cast<char*>(p), LARGE_SIZE};
            }
        }
        // Pool exhausted or size too large
        return {};
    }

    /**
     * @brief Deallocate buffer
     */
    void deallocate(std::span<char> buffer) noexcept {
        void* ptr = buffer.data();
        if (small_pool_.owns(ptr)) {
            small_pool_.deallocate(ptr);
        } else if (medium_pool_.owns(ptr)) {
            medium_pool_.deallocate(ptr);
        } else if (large_pool_.owns(ptr)) {
            large_pool_.deallocate(ptr);
        }
    }

    struct Stats {
        size_t small_allocated;
        size_t small_available;
        size_t medium_allocated;
        size_t medium_available;
        size_t large_allocated;
        size_t large_available;
    };

    [[nodiscard]] Stats stats() const noexcept {
        return Stats{
            .small_allocated = small_pool_.allocated(),
            .small_available = small_pool_.available(),
            .medium_allocated = medium_pool_.allocated(),
            .medium_available = medium_pool_.available(),
            .large_allocated = large_pool_.allocated(),
            .large_available = large_pool_.available()
        };
    }

private:
    FixedPool<SMALL_SIZE, SMALL_COUNT> small_pool_;
    FixedPool<MEDIUM_SIZE, MEDIUM_COUNT> medium_pool_;
    FixedPool<LARGE_SIZE, LARGE_COUNT> large_pool_;
};

// ============================================================================
// RAII Buffer Handle
// ============================================================================

/**
 * @brief RAII wrapper for pooled buffer (returns to pool on destruction)
 *
 * Example:
 *   TieredPool pool;
 *   {
 *       PooledBuffer buf(pool, 128);
 *       std::memcpy(buf.data(), src, 128);
 *   }  // Automatically returned to pool
 */
class PooledBuffer {
public:
    PooledBuffer() noexcept : pool_{nullptr}, buffer_{} {}

    PooledBuffer(TieredPool& pool, size_t size) noexcept
        : pool_{&pool}, buffer_{pool.allocate(size)} {}

    ~PooledBuffer() {
        if (pool_ && !buffer_.empty()) {
            pool_->deallocate(buffer_);
        }
    }

    // Move-only
    PooledBuffer(const PooledBuffer&) = delete;
    PooledBuffer& operator=(const PooledBuffer&) = delete;

    PooledBuffer(PooledBuffer&& other) noexcept
        : pool_{other.pool_}, buffer_{other.buffer_} {
        other.pool_ = nullptr;
        other.buffer_ = {};
    }

    PooledBuffer& operator=(PooledBuffer&& other) noexcept {
        if (this != &other) {
            if (pool_ && !buffer_.empty()) {
                pool_->deallocate(buffer_);
            }
            pool_ = other.pool_;
            buffer_ = other.buffer_;
            other.pool_ = nullptr;
            other.buffer_ = {};
        }
        return *this;
    }

    [[nodiscard]] std::span<char> get() noexcept { return buffer_; }
    [[nodiscard]] std::span<const char> get() const noexcept { return buffer_; }
    [[nodiscard]] char* data() noexcept { return buffer_.data(); }
    [[nodiscard]] const char* data() const noexcept { return buffer_.data(); }
    [[nodiscard]] size_t size() const noexcept { return buffer_.size(); }
    [[nodiscard]] bool empty() const noexcept { return buffer_.empty(); }

    [[nodiscard]] explicit operator bool() const noexcept { return !empty(); }

private:
    TieredPool* pool_;
    std::span<char> buffer_;
};

// ============================================================================
// Thread-Local Pool (Zero Contention)
// ============================================================================

/**
 * @brief Get thread-local tiered pool
 *
 * Each thread gets its own pool instance, eliminating all lock contention.
 *
 * Example:
 *   auto& pool = get_thread_local_pool();
 *   auto buf = pool.allocate(256);
 */
[[nodiscard]] inline TieredPool& get_thread_local_pool() noexcept {
    thread_local TieredPool tls_pool;
    return tls_pool;
}

}  // namespace qnx::bench
