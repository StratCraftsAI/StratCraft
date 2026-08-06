#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cstddef>
#include <limits>

namespace nonabt {

/// Exponential Moving Average indicator
class EMA : public Indicator {
public:
    explicit EMA(const Line<double>& source, std::size_t period)
        : source_(source)
        , period_(period == 0 ? 1 : period)
        , multiplier_(2.0 / (static_cast<double>(period_) + 1.0)) {}

    void next() override {
        const auto idx = source_.index();

        if (idx + 1 < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        if (!initialized_) {
            double sum = 0.0;
            for (std::size_t i = 0; i < period_; ++i) {
                sum += source_.data()[idx - i];
            }
            double sma = sum / static_cast<double>(period_);
            line_.forward(sma);
            prev_ema_ = sma;
            initialized_ = true;
            return;
        }

        const double current = source_.data()[idx];
        const double ema = (current - prev_ema_) * multiplier_ + prev_ema_;
        line_.forward(ema);
        prev_ema_ = ema;
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

    [[nodiscard]] std::size_t period() const noexcept { return period_; }

private:
    const Line<double>& source_;
    std::size_t period_;
    double multiplier_;
    double prev_ema_ = 0.0;
    bool initialized_ = false;
};

} // namespace nonabt
