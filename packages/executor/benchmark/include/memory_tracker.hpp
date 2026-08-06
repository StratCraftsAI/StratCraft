/**
 * @file memory_tracker.hpp
 * @brief Memory allocation tracking for hot path audit
 *
 * Reference: TICKET_174 - C++ Executor Benchmark Framework
 * Reference: modernc_quant.md #16 - PMR Pools
 *
 * Critical Rule: Any malloc/new call on hot path is a benchmark FAILURE
 */

#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>
#include <mutex>
#include <fstream>

#include "benchmark_utils.hpp"

namespace qnx::bench {

// ============================================================================
// Basic Allocation Statistics
// ============================================================================

/**
 * @brief Basic allocation statistics
 */
struct MemoryStats {
    std::atomic<size_t> allocation_count{0};
    std::atomic<size_t> deallocation_count{0};
    std::atomic<size_t> bytes_allocated{0};
    std::atomic<size_t> bytes_deallocated{0};
    std::atomic<size_t> peak_bytes{0};
    std::atomic<size_t> current_bytes{0};

    void record_allocation(size_t size) noexcept {
        allocation_count.fetch_add(1, std::memory_order_relaxed);
        bytes_allocated.fetch_add(size, std::memory_order_relaxed);
        size_t current = current_bytes.fetch_add(size, std::memory_order_relaxed) + size;

        // Update peak (lockless)
        size_t peak = peak_bytes.load(std::memory_order_relaxed);
        while (current > peak &&
               !peak_bytes.compare_exchange_weak(peak, current, std::memory_order_relaxed)) {
            // Retry
        }
    }

    void record_deallocation(size_t size) noexcept {
        deallocation_count.fetch_add(1, std::memory_order_relaxed);
        bytes_deallocated.fetch_add(size, std::memory_order_relaxed);
        current_bytes.fetch_sub(size, std::memory_order_relaxed);
    }

    void reset() noexcept {
        allocation_count.store(0, std::memory_order_relaxed);
        deallocation_count.store(0, std::memory_order_relaxed);
        bytes_allocated.store(0, std::memory_order_relaxed);
        bytes_deallocated.store(0, std::memory_order_relaxed);
        peak_bytes.store(0, std::memory_order_relaxed);
        current_bytes.store(0, std::memory_order_relaxed);
    }

    [[nodiscard]] bool has_leaks() const noexcept {
        return allocation_count.load(std::memory_order_relaxed) !=
               deallocation_count.load(std::memory_order_relaxed);
    }
};

// ============================================================================
// PMR Pool Statistics
// ============================================================================

/**
 * @brief PMR Pool audit statistics
 * Reference: modernc_quant.md #16 - PMR Pools
 */
struct PMRStats {
    std::atomic<size_t> pool_allocations{0};
    std::atomic<size_t> upstream_allocations{0};  // Fallback to upstream (BAD)
    std::atomic<size_t> pool_deallocations{0};
    std::atomic<size_t> pool_bytes_used{0};
    std::atomic<size_t> pool_capacity{0};

    [[nodiscard]] double hit_rate() const noexcept {
        size_t total = pool_allocations.load(std::memory_order_relaxed) +
                       upstream_allocations.load(std::memory_order_relaxed);
        return total > 0
            ? static_cast<double>(pool_allocations.load(std::memory_order_relaxed)) / total
            : 1.0;
    }

    [[nodiscard]] double usage_ratio() const noexcept {
        size_t cap = pool_capacity.load(std::memory_order_relaxed);
        return cap > 0
            ? static_cast<double>(pool_bytes_used.load(std::memory_order_relaxed)) / cap
            : 0.0;
    }

    void reset() noexcept {
        pool_allocations.store(0, std::memory_order_relaxed);
        upstream_allocations.store(0, std::memory_order_relaxed);
        pool_deallocations.store(0, std::memory_order_relaxed);
        pool_bytes_used.store(0, std::memory_order_relaxed);
    }
};

// ============================================================================
// Hot Path Violation Tracking
// ============================================================================

/**
 * @brief Record of a hot path allocation violation
 */
struct HotPathViolation {
    std::string location;       // Source file:line
    size_t size;                // Allocation size
    uint64_t timestamp_cycles;  // When it occurred
};

/**
 * @brief Hot path allocation audit
 * Critical: Hot path malloc count MUST be 0
 */
class HotPathAudit {
public:
    static constexpr size_t MAX_VIOLATIONS = 100;

    void enable() noexcept {
        enabled_.store(true, std::memory_order_release);
    }

    void disable() noexcept {
        enabled_.store(false, std::memory_order_release);
    }

    [[nodiscard]] bool is_enabled() const noexcept {
        return enabled_.load(std::memory_order_acquire);
    }

    void record_violation(size_t size, const char* file, int line) {
        violation_count_.fetch_add(1, std::memory_order_relaxed);

        std::lock_guard<std::mutex> lock(mutex_);
        if (violations_.size() < MAX_VIOLATIONS) {
            violations_.push_back({
                std::string(file) + ":" + std::to_string(line),
                size,
                rdtsc()
            });
        }
    }

    [[nodiscard]] size_t violation_count() const noexcept {
        return violation_count_.load(std::memory_order_relaxed);
    }

    [[nodiscard]] bool passed() const noexcept {
        return violation_count_.load(std::memory_order_relaxed) == 0;
    }

    [[nodiscard]] const std::vector<HotPathViolation>& violations() const {
        return violations_;
    }

    void reset() {
        std::lock_guard<std::mutex> lock(mutex_);
        violation_count_.store(0, std::memory_order_relaxed);
        violations_.clear();
    }

    void dump_report(std::ostream& os) const {
        os << "=== Hot Path Audit Report ===\n";
        os << "Violations: " << violation_count_.load(std::memory_order_relaxed) << "\n";
        os << "Status: " << (passed() ? "PASSED" : "FAILED") << "\n";

        if (!passed()) {
            os << "\nViolation Details:\n";
            std::lock_guard<std::mutex> lock(mutex_);
            for (const auto& v : violations_) {
                os << "  " << v.location << " : " << v.size << " bytes\n";
            }
        }
    }

private:
    std::atomic<bool> enabled_{false};
    std::atomic<size_t> violation_count_{0};
    mutable std::mutex mutex_;
    std::vector<HotPathViolation> violations_;
};

// ============================================================================
// Global Instances
// ============================================================================

inline MemoryStats& global_memory_stats() {
    static MemoryStats instance;
    return instance;
}

inline PMRStats& global_pmr_stats() {
    static PMRStats instance;
    return instance;
}

inline HotPathAudit& global_hotpath_audit() {
    static HotPathAudit instance;
    return instance;
}

// ============================================================================
// RAII Guards
// ============================================================================

/**
 * @brief RAII guard to enable hot path auditing
 */
class ScopedHotPathAudit {
public:
    ScopedHotPathAudit() {
        global_hotpath_audit().reset();
        global_hotpath_audit().enable();
    }

    ~ScopedHotPathAudit() {
        global_hotpath_audit().disable();
    }

    [[nodiscard]] bool passed() const {
        return global_hotpath_audit().passed();
    }

    [[nodiscard]] size_t violation_count() const {
        return global_hotpath_audit().violation_count();
    }

    ScopedHotPathAudit(const ScopedHotPathAudit&) = delete;
    ScopedHotPathAudit& operator=(const ScopedHotPathAudit&) = delete;
};

/**
 * @brief RAII guard to track memory stats for a scope
 */
class ScopedMemoryTracker {
public:
    ScopedMemoryTracker() {
        auto& stats = global_memory_stats();
        start_allocs_ = stats.allocation_count.load(std::memory_order_relaxed);
        start_bytes_ = stats.bytes_allocated.load(std::memory_order_relaxed);
    }

    [[nodiscard]] size_t allocations() const {
        return global_memory_stats().allocation_count.load(std::memory_order_relaxed) - start_allocs_;
    }

    [[nodiscard]] size_t bytes_allocated() const {
        return global_memory_stats().bytes_allocated.load(std::memory_order_relaxed) - start_bytes_;
    }

    ScopedMemoryTracker(const ScopedMemoryTracker&) = delete;
    ScopedMemoryTracker& operator=(const ScopedMemoryTracker&) = delete;

private:
    size_t start_allocs_;
    size_t start_bytes_;
};

// ============================================================================
// Proc Memory Info
// ============================================================================

/**
 * @brief Get current process memory from /proc/self/status
 */
struct ProcMemInfo {
    size_t vm_peak_kb = 0;   // Peak virtual memory
    size_t vm_size_kb = 0;   // Current virtual memory
    size_t vm_rss_kb = 0;    // Resident set size
    size_t vm_data_kb = 0;   // Data segment size

    static ProcMemInfo read() {
        ProcMemInfo info;
        std::ifstream status("/proc/self/status");
        std::string line;

        while (std::getline(status, line)) {
            if (line.starts_with("VmPeak:")) {
                info.vm_peak_kb = std::stoull(line.substr(7));
            } else if (line.starts_with("VmSize:")) {
                info.vm_size_kb = std::stoull(line.substr(7));
            } else if (line.starts_with("VmRSS:")) {
                info.vm_rss_kb = std::stoull(line.substr(6));
            } else if (line.starts_with("VmData:")) {
                info.vm_data_kb = std::stoull(line.substr(7));
            }
        }

        return info;
    }
};

}  // namespace qnx::bench

// ============================================================================
// Allocation Interception Macros (Optional)
// ============================================================================

#ifdef QNX_BENCH_TRACK_ALLOCATIONS

// Override global new/delete when tracking is enabled
void* operator new(std::size_t size) {
    void* ptr = std::malloc(size);
    if (ptr) {
        qnx::bench::global_memory_stats().record_allocation(size);
        if (qnx::bench::global_hotpath_audit().is_enabled()) {
            qnx::bench::global_hotpath_audit().record_violation(size, __FILE__, __LINE__);
        }
    }
    return ptr;
}

void operator delete(void* ptr) noexcept {
    if (ptr) {
        // Note: We don't know the size here, tracking is approximate
        qnx::bench::global_memory_stats().record_deallocation(0);
    }
    std::free(ptr);
}

void operator delete(void* ptr, std::size_t size) noexcept {
    if (ptr) {
        qnx::bench::global_memory_stats().record_deallocation(size);
    }
    std::free(ptr);
}

#endif  // QNX_BENCH_TRACK_ALLOCATIONS
