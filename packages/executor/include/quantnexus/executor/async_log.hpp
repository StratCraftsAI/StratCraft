/**
 * Async Log - Low-Latency Logging for Hot Path
 *
 * TICKET_470 Phase 3.2: Quill async logging integration
 *
 * Provides near-zero-latency logging (~12ns) for the executor hot path.
 * Formatting is deferred to a background thread via lock-free SPSC queue.
 *
 * When QNX_HAS_QUILL is defined, uses Quill library.
 * Otherwise, falls back to buffered std::cout (higher latency but functional).
 *
 * Source pattern: NexusFIX Quill integration (84% latency reduction)
 *
 * Usage:
 *   qnx::log::init();
 *   QNX_LOG_INFO("Loaded {} bars for {}", bar_count, symbol);
 *   QNX_LOG_WARN("Slow tick: {}ns", latency);
 */

#pragma once

#include <string_view>
#include <format>
#include <iostream>

#if defined(QNX_HAS_QUILL) && QNX_HAS_QUILL
#include <quill/Backend.h>
#include <quill/Frontend.h>
#include <quill/LogMacros.h>
#include <quill/Logger.h>
#include <quill/sinks/ConsoleSink.h>
#define QNX_QUILL_ENABLED 1
#else
#define QNX_QUILL_ENABLED 0
#endif

namespace StratCraft::executor::log {

// =============================================================================
// Initialization
// =============================================================================

#if QNX_QUILL_ENABLED

inline quill::Logger* get_logger() noexcept {
    static quill::Logger* logger = [] {
        quill::Backend::start();
        auto console_sink = quill::Frontend::create_or_get_sink<quill::ConsoleSink>("console");
        return quill::Frontend::create_or_get_logger("executor", std::move(console_sink));
    }();
    return logger;
}

inline void init() {
    (void)get_logger();
}

#else

inline void init() {}

#endif

// =============================================================================
// Log Macros
// =============================================================================

#if QNX_QUILL_ENABLED

#define QNX_LOG_TRACE(fmt, ...) \
    LOG_TRACE_L1(StratCraft::executor::log::get_logger(), fmt, ##__VA_ARGS__)

#define QNX_LOG_DEBUG(fmt, ...) \
    LOG_DEBUG(StratCraft::executor::log::get_logger(), fmt, ##__VA_ARGS__)

#define QNX_LOG_INFO(fmt, ...) \
    LOG_INFO(StratCraft::executor::log::get_logger(), fmt, ##__VA_ARGS__)

#define QNX_LOG_WARN(fmt, ...) \
    LOG_WARNING(StratCraft::executor::log::get_logger(), fmt, ##__VA_ARGS__)

#define QNX_LOG_ERROR(fmt, ...) \
    LOG_ERROR(StratCraft::executor::log::get_logger(), fmt, ##__VA_ARGS__)

#else

// Fallback: buffered std::cout with std::format
// Higher latency (~100ns+) but functional without Quill dependency

#define QNX_LOG_TRACE(fmt, ...) \
    do { \
        std::cout << "[TRACE] " << std::format(fmt, ##__VA_ARGS__) << '\n'; \
    } while (0)

#define QNX_LOG_DEBUG(fmt, ...) \
    do { \
        std::cout << "[DEBUG] " << std::format(fmt, ##__VA_ARGS__) << '\n'; \
    } while (0)

#define QNX_LOG_INFO(fmt, ...) \
    do { \
        std::cout << "[INFO] " << std::format(fmt, ##__VA_ARGS__) << '\n'; \
    } while (0)

#define QNX_LOG_WARN(fmt, ...) \
    do { \
        std::cerr << "[WARN] " << std::format(fmt, ##__VA_ARGS__) << '\n'; \
    } while (0)

#define QNX_LOG_ERROR(fmt, ...) \
    do { \
        std::cerr << "[ERROR] " << std::format(fmt, ##__VA_ARGS__) << '\n'; \
    } while (0)

#endif

// =============================================================================
// Compile-time Info
// =============================================================================

[[nodiscard]] inline constexpr bool has_quill() noexcept {
    return QNX_QUILL_ENABLED != 0;
}

[[nodiscard]] inline const char* log_backend() noexcept {
#if QNX_QUILL_ENABLED
    return "Quill (async, ~12ns)";
#else
    return "std::cout (sync, fallback)";
#endif
}

} // namespace StratCraft::executor::log
