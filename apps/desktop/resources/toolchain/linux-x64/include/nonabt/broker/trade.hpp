#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace nonabt {

/// Trade status
enum class TradeStatus : std::uint8_t {
    Open,
    Closed,
};

/// Trade - tracks a round-trip trade from open to close
struct Trade {
    std::size_t id = 0;
    std::size_t data_index = 0;
    TradeStatus status = TradeStatus::Open;
    double size = 0.0;            // Trade size (negative = short)
    double entry_price = 0.0;     // Entry / average price while open
    double price = 0.0;           // backtrader-compatible alias
    double exit_price = 0.0;      // Exit price (when closed)
    double value = 0.0;           // Current notional value
    double commission = 0.0;      // Total commission
    double pnl = 0.0;             // Gross realized pnl
    double pnlcomm = 0.0;         // Net realized pnl
    bool justopened = false;
    bool isopen = false;
    bool isclosed = false;
    bool islong = false;
    std::size_t entry_bar = 0;    // Bar index at entry
    std::size_t exit_bar = 0;     // Bar index at exit
    std::size_t barlen = 0;       // Bars elapsed while the trade was open

    /// Update trade with a fill (may close or partially close)
    void update(double fill_size, double fill_price, double comm, std::size_t bar_index) noexcept {
        constexpr double eps = 1e-10;

        if (std::abs(fill_size) < eps) {
            return;
        }

        const double old_size = size;
        commission += comm;
        size += fill_size;

        justopened = std::abs(old_size) < eps;
        if (justopened) {
            entry_bar = bar_index;
            islong = size > 0.0;
        }

        isopen = std::abs(size) >= eps;
        isclosed = std::abs(old_size) >= eps && !isopen;
        barlen = bar_index >= entry_bar ? (bar_index - entry_bar) : 0;

        if (std::abs(size) > std::abs(old_size)) {
            price = ((old_size * price) + (fill_size * fill_price)) / size;
            entry_price = price;
        } else if (std::abs(old_size) >= eps) {
            pnl += (-fill_size) * (fill_price - price);
        }

        pnlcomm = pnl - commission;
        value = size * price;

        if (justopened) {
            price = fill_price;
            entry_price = fill_price;
            value = size * price;
            pnlcomm = pnl - commission;
        }

        if (isclosed) {
            exit_price = fill_price;
            size = 0.0;
            value = 0.0;
            status = TradeStatus::Closed;
            exit_bar = bar_index;
            isopen = false;
        } else {
            status = TradeStatus::Open;
        }
    }

    /// Gross PnL (before commissions)
    [[nodiscard]] double pnl_gross() const noexcept {
        return pnl;
    }

    /// Net PnL (after commissions) for a closed trade
    [[nodiscard]] double closed_pnl(double /*original_size*/) const noexcept {
        return pnlcomm;
    }

    /// Whether trade is open
    [[nodiscard]] bool is_open() const noexcept {
        return status == TradeStatus::Open;
    }

    /// Whether trade is closed
    [[nodiscard]] bool is_closed() const noexcept {
        return status == TradeStatus::Closed;
    }
};

} // namespace nonabt
