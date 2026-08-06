#pragma once

#include <cmath>
#include <cstddef>

namespace nonabt {

/// Position tracking for a single instrument
struct Position {
    std::size_t data_index = 0;  // Which data feed
    double size = 0.0;           // Current position size (negative = short)
    double avg_price = 0.0;      // Average entry price
    double price = 0.0;          // backtrader-compatible alias for avg_price
    double price_orig = 0.0;     // Price before the latest update
    double total_cost = 0.0;     // Total cost basis
    double upopened = 0.0;       // Signed quantity used to open/increase
    double upclosed = 0.0;       // Signed quantity used to reduce/close

    /// Update position after a fill
    void update(double fill_size, double fill_price) noexcept {
        constexpr double eps = 1e-10;

        price_orig = price;
        const double old_size = size;
        const double new_size = old_size + fill_size;

        if (std::abs(old_size) < eps) {
            upopened = fill_size;
            upclosed = 0.0;
        } else if (old_size > 0.0) {
            if (fill_size > 0.0) {
                upopened = fill_size;
                upclosed = 0.0;
            } else if (new_size >= 0.0) {
                upopened = 0.0;
                upclosed = fill_size;
            } else {
                upopened = new_size;
                upclosed = -old_size;
            }
        } else {
            if (fill_size < 0.0) {
                upopened = fill_size;
                upclosed = 0.0;
            } else if (new_size <= 0.0) {
                upopened = 0.0;
                upclosed = fill_size;
            } else {
                upopened = new_size;
                upclosed = -old_size;
            }
        }

        size = new_size;

        if (std::abs(size) < eps) {
            size = 0.0;
            avg_price = 0.0;
            price = 0.0;
            total_cost = 0.0;
            return;
        }

        if (std::abs(old_size) < eps) {
            avg_price = fill_price;
            price = fill_price;
        } else if ((old_size > 0.0 && fill_size > 0.0) || (old_size < 0.0 && fill_size < 0.0)) {
            avg_price = ((price * old_size) + (fill_size * fill_price)) / size;
            price = avg_price;
        } else if ((old_size > 0.0 && size < 0.0) || (old_size < 0.0 && size > 0.0)) {
            avg_price = fill_price;
            price = fill_price;
        }

        total_cost = std::abs(size) * avg_price;
    }

    /// Unrealized PnL at a given market price
    [[nodiscard]] double unrealized_pnl(double market_price) const noexcept {
        return size * (market_price - avg_price);
    }

    /// Whether position is flat
    [[nodiscard]] bool is_flat() const noexcept {
        return std::abs(size) < 1e-10;
    }

    /// Whether position is long
    [[nodiscard]] bool is_long() const noexcept {
        return size > 1e-10;
    }

    /// Whether position is short
    [[nodiscard]] bool is_short() const noexcept {
        return size < -1e-10;
    }
};

} // namespace nonabt
