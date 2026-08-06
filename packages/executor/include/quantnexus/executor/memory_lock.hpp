/**
 * Memory Locking - Prevent Page Faults on Hot Paths
 *
 * TICKET_473_10: mlock/mlockall wrappers for latency-critical pages
 *
 * Provides:
 * - lock_pages() / unlock_pages() for specific address ranges
 * - lock_all_pages() for entire process address space
 * - prefault_memory() to touch pages before execution
 * - ScopedMemoryLock RAII guard
 *
 * All functions return Expected<void> using existing error_types.
 *
 * Platform support:
 * - Linux: mlock/mlockall/munlock (requires CAP_IPC_LOCK or ulimit)
 * - macOS: mlock/munlock (no mlockall)
 * - Windows: VirtualLock/VirtualUnlock
 *
 * Usage:
 *   // Lock strategy data pages
 *   auto result = lock_pages(data_ptr, data_size);
 *   if (!result) { log_warning(result.error().message); }
 *
 *   // RAII guard for temporary locking
 *   {
 *       ScopedMemoryLock lock(buffer, buffer_size);
 *       execute_backtest(buffer);
 *   } // auto-unlocked
 *
 */

#pragma once

#include "error_types.hpp"
#include "hardware_constants.hpp"

#include <cstddef>
#include <cstdint>

#if defined(__linux__)
    #include <sys/mman.h>
    #define QNX_HAS_MLOCK 1
#elif defined(__APPLE__)
    #include <sys/mman.h>
    #define QNX_HAS_MLOCK 1
#elif defined(_WIN32)
    #include <windows.h>
    #define QNX_HAS_MLOCK 1
#else
    #define QNX_HAS_MLOCK 0
#endif

namespace StratCraft::executor {

// =============================================================================
// Memory Lock Functions
// =============================================================================

/**
 * Lock a memory range into physical RAM (prevent swapping).
 *
 * @param addr Start address (should be page-aligned for best results)
 * @param len Number of bytes to lock
 * @return Success or error with system error message
 */
[[nodiscard]] inline Expected<void> lock_pages(void* addr, size_t len) noexcept {
    if (addr == nullptr || len == 0) {
        return make_error(ErrorCode::ConfigInvalidValue, "lock_pages: null address or zero length");
    }

#if defined(__linux__) || defined(__APPLE__)
    if (mlock(addr, len) != 0) {
        return make_error(ErrorCode::IOError,
            std::string("mlock failed: errno=") + std::to_string(errno));
    }
    return {};
#elif defined(_WIN32)
    if (!VirtualLock(addr, len)) {
        return make_error(ErrorCode::IOError,
            std::string("VirtualLock failed: error=") + std::to_string(GetLastError()));
    }
    return {};
#else
    (void)addr; (void)len;
    return make_error(ErrorCode::IOError, "mlock not supported on this platform");
#endif
}

/**
 * Lock all current and future pages of the process.
 *
 * Requires elevated permissions (CAP_IPC_LOCK on Linux).
 * Not available on macOS or Windows.
 */
[[nodiscard]] inline Expected<void> lock_all_pages() noexcept {
#if defined(__linux__)
    if (mlockall(MCL_CURRENT | MCL_FUTURE) != 0) {
        return make_error(ErrorCode::IOError,
            std::string("mlockall failed: errno=") + std::to_string(errno));
    }
    return {};
#else
    return make_error(ErrorCode::IOError, "mlockall not supported on this platform");
#endif
}

/**
 * Unlock a previously locked memory range.
 *
 * @param addr Start address
 * @param len Number of bytes to unlock
 */
[[nodiscard]] inline Expected<void> unlock_pages(void* addr, size_t len) noexcept {
    if (addr == nullptr || len == 0) {
        return make_error(ErrorCode::ConfigInvalidValue, "unlock_pages: null address or zero length");
    }

#if defined(__linux__) || defined(__APPLE__)
    if (munlock(addr, len) != 0) {
        return make_error(ErrorCode::IOError,
            std::string("munlock failed: errno=") + std::to_string(errno));
    }
    return {};
#elif defined(_WIN32)
    if (!VirtualUnlock(addr, len)) {
        return make_error(ErrorCode::IOError,
            std::string("VirtualUnlock failed: error=") + std::to_string(GetLastError()));
    }
    return {};
#else
    (void)addr; (void)len;
    return make_error(ErrorCode::IOError, "munlock not supported on this platform");
#endif
}

// =============================================================================
// Prefault Memory
// =============================================================================

/**
 * Touch every page in a memory range to trigger page faults now
 * (before latency-critical execution begins).
 *
 * Reads one byte per page to force the OS to map physical pages.
 *
 * @param addr Start address
 * @param len Number of bytes to prefault
 */
inline void prefault_memory(const void* addr, size_t len) noexcept {
    const volatile char* p = static_cast<const volatile char*>(addr);
    for (size_t offset = 0; offset < len; offset += constants::PAGE_SIZE) {
        (void)p[offset];  // Force page fault
    }
}

/**
 * Write-prefault: touch pages for write to ensure copy-on-write is resolved.
 *
 * @param addr Start address (must be writable)
 * @param len Number of bytes to prefault
 */
inline void prefault_memory_write(void* addr, size_t len) noexcept {
    volatile char* p = static_cast<volatile char*>(addr);
    for (size_t offset = 0; offset < len; offset += constants::PAGE_SIZE) {
        p[offset] = p[offset];  // Read-modify-write to trigger CoW
    }
}

// =============================================================================
// ScopedMemoryLock - RAII Guard
// =============================================================================

/**
 * RAII guard that locks memory on construction and unlocks on destruction.
 *
 * If locking fails, the guard is a no-op on destruction (safe to use
 * even without elevated permissions).
 */
class ScopedMemoryLock {
public:
    ScopedMemoryLock(void* addr, size_t len) noexcept
        : addr_{addr}, len_{len}, locked_{false}
    {
        if (addr && len > 0) {
            auto result = lock_pages(addr, len);
            locked_ = result.has_value();
        }
    }

    ~ScopedMemoryLock() {
        if (locked_) {
            (void)unlock_pages(addr_, len_);
        }
    }

    // Non-copyable, non-movable
    ScopedMemoryLock(const ScopedMemoryLock&) = delete;
    ScopedMemoryLock& operator=(const ScopedMemoryLock&) = delete;

    [[nodiscard]] bool is_locked() const noexcept { return locked_; }

private:
    void* addr_;
    size_t len_;
    bool locked_;
};

} // namespace StratCraft::executor
