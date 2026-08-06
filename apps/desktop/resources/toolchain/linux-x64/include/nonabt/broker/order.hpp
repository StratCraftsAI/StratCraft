#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace nonabt {

/// Order execution types
enum class OrderType : std::uint8_t {
    Market,
    Limit,
    Stop,
    StopLimit,
    StopTrail,
    StopTrailLimit,
};

/// Order status state machine:
/// Created -> Submitted -> Accepted -> Completed/Canceled/Rejected/Expired/Margin
enum class OrderStatus : std::uint8_t {
    Created,
    Submitted,
    Accepted,
    Partial,
    Completed,
    Canceled,
    Rejected,
    Expired,
    Margin,
};

/// Order side
enum class OrderSide : std::uint8_t {
    Buy,
    Sell,
};

/// An order submitted to the broker
struct Order {
    std::size_t id = 0;
    OrderType type = OrderType::Market;
    OrderStatus status = OrderStatus::Created;
    OrderSide side = OrderSide::Buy;
    double size = 0.0;
    double price = 0.0;               // For Limit/StopLimit
    std::optional<double> stop_price;  // For Stop/StopLimit
    double executed_price = 0.0;
    double executed_size = 0.0;
    double commission = 0.0;
    std::size_t data_index = 0;        // Index of the data feed

    // --- Expiry ---
    std::optional<std::size_t> valid_until_bar;  // Bar index after which order expires

    // --- Trailing Stop ---
    double trail_amount = 0.0;         // Fixed trail distance
    double trail_percent = 0.0;        // Percentage trail distance
    double trail_stop_price = 0.0;     // Current dynamic stop level

    // --- OCO (One-Cancels-Other) ---
    std::size_t oco_group_id = 0;      // 0 = no OCO group

    // --- Bracket Orders ---
    std::size_t parent_id = 0;         // 0 = no parent
    std::vector<std::size_t> child_ids;
    bool transmit = true;              // If false, order is held until parent fills

    /// Check if order is alive (can still be executed)
    [[nodiscard]] bool is_alive() const noexcept {
        return status == OrderStatus::Created ||
               status == OrderStatus::Submitted ||
               status == OrderStatus::Accepted ||
               status == OrderStatus::Partial;
    }

    /// Check if order is in a terminal state
    [[nodiscard]] bool is_complete() const noexcept {
        return !is_alive();
    }

    /// Submit the order
    void submit() noexcept { status = OrderStatus::Submitted; }

    /// Accept the order
    void accept() noexcept { status = OrderStatus::Accepted; }

    /// Execute (fill) the order
    void execute(double fill_price, double fill_size, double comm) noexcept {
        executed_price = fill_price;
        executed_size = fill_size;
        commission = comm;
        status = OrderStatus::Completed;
    }

    /// Partially fill the order
    void partial_fill(double fill_price, double fill_size, double comm) noexcept {
        executed_price = fill_price;
        executed_size += fill_size;
        commission += comm;
        status = OrderStatus::Partial;
    }

    /// Cancel the order
    void cancel() noexcept { status = OrderStatus::Canceled; }

    /// Reject the order
    void reject() noexcept { status = OrderStatus::Rejected; }

    /// Mark as expired
    void expire() noexcept { status = OrderStatus::Expired; }

    /// Mark as margin call
    void margin() noexcept { status = OrderStatus::Margin; }
};

} // namespace nonabt
