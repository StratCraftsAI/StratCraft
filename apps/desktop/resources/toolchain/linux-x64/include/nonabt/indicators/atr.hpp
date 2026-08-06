#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Average True Range using Wilder smoothing.
class ATR : public Indicator {
public:
    ATR(const Line<double>& high, const Line<double>& low, const Line<double>& close, std::size_t period = 14)
        : high_(high), low_(low), close_(close), period_(period) {}

    void next() override {
        const auto idx = close_.index();
        if (idx == 0) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const double high_low = high_.data()[idx] - low_.data()[idx];
        const double high_prev_close = std::abs(high_.data()[idx] - close_.data()[idx - 1]);
        const double low_prev_close = std::abs(low_.data()[idx] - close_.data()[idx - 1]);
        const double true_range = std::max({high_low, high_prev_close, low_prev_close});

        if (!initialized_) {
            tr_sum_ += true_range;
            tr_count_++;

            if (tr_count_ < period_) {
                line_.forward(std::numeric_limits<double>::quiet_NaN());
                return;
            }

            prev_atr_ = tr_sum_ / static_cast<double>(period_);
            initialized_ = true;
            line_.forward(prev_atr_);
            return;
        }

        const double period_d = static_cast<double>(period_);
        prev_atr_ = ((prev_atr_ * (period_d - 1.0)) + true_range) / period_d;
        line_.forward(prev_atr_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + 1;
    }

    [[nodiscard]] std::size_t period() const noexcept { return period_; }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    std::size_t period_;
    double tr_sum_ = 0.0;
    std::size_t tr_count_ = 0;
    double prev_atr_ = 0.0;
    bool initialized_ = false;
};

} // namespace nonabt
