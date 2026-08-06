#pragma once

#include <stratforge/core/line.hpp>
#include <stratforge/observers/observer.hpp>

#include <cmath>
#include <limits>
#include <vector>

namespace nonabt {

/// BuySell observer - records per-bar average buy/sell execution price
class BuySellObserver : public Observer {
public:
    explicit BuySellObserver(bool barplot = false, double bardist = 0.015,
                             std::size_t data_index = 0)
        : barplot_(barplot)
        , bardist_(bardist)
        , data_index_(data_index) {}

    void start() override {
        pending_buys_.clear();
        pending_sells_.clear();
    }

    void notify_order(const Order& order) override {
        if (order.status != OrderStatus::Completed || order.executed_size == 0.0 ||
            order.data_index != data_index_) {
            return;
        }

        if (order.side == OrderSide::Buy) {
            pending_buys_.push_back(order.executed_price);
        } else {
            pending_sells_.push_back(order.executed_price);
        }
    }

    void next(const BackBroker&, const std::vector<DataFeed*>& feeds) override {
        const double nan = std::numeric_limits<double>::quiet_NaN();
        double buy_value = nan;
        double sell_value = nan;

        if (!pending_buys_.empty()) {
            buy_value = average(pending_buys_);
            if (barplot_ && data_index_ < feeds.size()) {
                buy_value = feeds[data_index_]->low()[0] * (1.0 - bardist_);
            }
        }

        if (!pending_sells_.empty()) {
            sell_value = average(pending_sells_);
            if (barplot_ && data_index_ < feeds.size()) {
                sell_value = feeds[data_index_]->high()[0] * (1.0 + bardist_);
            }
        }

        buy_.forward(buy_value);
        sell_.forward(sell_value);
        pending_buys_.clear();
        pending_sells_.clear();
    }

    [[nodiscard]] const Line<double>& buy() const noexcept { return buy_; }
    [[nodiscard]] const Line<double>& sell() const noexcept { return sell_; }

private:
    static double average(const std::vector<double>& values) {
        double sum = 0.0;
        for (double value : values) {
            sum += value;
        }
        return sum / static_cast<double>(values.size());
    }

    bool barplot_;
    double bardist_;
    std::size_t data_index_;
    std::vector<double> pending_buys_;
    std::vector<double> pending_sells_;
    Line<double> buy_;
    Line<double> sell_;
};

} // namespace nonabt
