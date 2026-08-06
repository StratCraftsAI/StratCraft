/**
 * Live Engine Event Types
 *
 * TICKET_613: Actor Model event system for live execution.
 * Uses std::variant for cache-friendly dispatch (no virtual dispatch on hot path).
 */

#pragma once

#include <cstdint>
#include <string>
#include <variant>

namespace StratCraft::executor::live {

// =============================================================================
// Event Type Enum
// =============================================================================

enum class EventType : uint8_t {
    BAR = 0,
    ORDER_FILLED = 1,
    TIMER = 2,
    SHUTDOWN = 255
};

// =============================================================================
// Event Structs
// =============================================================================

struct BarEvent {
    int64_t timestamp;
    double open, high, low, close, volume;
    uint32_t bar_index;  // Monotonically increasing
};

struct OrderFilledEvent {
    std::string order_id;
    std::string symbol;
    std::string side;    // "buy" | "sell"
    double price;
    double qty;
    int64_t timestamp;
};

struct TimerEvent {
    int64_t timestamp;
    std::string timer_id;
};

struct ShutdownEvent {};

// Discriminated union -- no virtual dispatch, cache-friendly
using Event = std::variant<BarEvent, OrderFilledEvent, TimerEvent, ShutdownEvent>;

} // namespace StratCraft::executor::live
