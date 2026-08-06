#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cstddef>
#include <limits>

namespace nonabt {

/// Double exponential moving average.
class DoubleExponentialMovingAverage : public Indicator {
public:
    explicit DoubleExponentialMovingAverage(const Line<double>& source, std::size_t period = 30)
        : source_(source)
        , period_(period)
        , multiplier_(2.0 / (static_cast<double>(period) + 1.0)) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();

        if (idx + 1 < period_) {
            line_.forward(nan);
            ema1_.forward(nan);
            ema2_.forward(nan);
            return;
        }

        if (!ema1_initialized_) {
            ema1_prev_ = seed_sma_source(idx);
            ema1_initialized_ = true;
        } else {
            ema1_prev_ = advance_ema(source_.data()[idx], ema1_prev_);
        }
        ema1_.forward(ema1_prev_);

        if (ema1_.size() < period_ || !ema1_seed_window_ready()) {
            ema2_.forward(nan);
            line_.forward(nan);
            return;
        }

        if (!ema2_initialized_) {
            ema2_prev_ = seed_sma_ema1();
            ema2_initialized_ = true;
        } else {
            ema2_prev_ = advance_ema(ema1_prev_, ema2_prev_);
        }
        ema2_.forward(ema2_prev_);

        line_.forward((2.0 * ema1_prev_) - ema2_prev_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return (2 * period_) - 1;
    }

private:
    [[nodiscard]] double seed_sma_source(std::size_t idx) const noexcept {
        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += source_.data()[idx - i];
        }
        return sum / static_cast<double>(period_);
    }

    [[nodiscard]] bool ema1_seed_window_ready() const noexcept {
        return ema1_.size() >= ((2 * period_) - 1);
    }

    [[nodiscard]] double seed_sma_ema1() const noexcept {
        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += ema1_.data()[ema1_.size() - 1 - i];
        }
        return sum / static_cast<double>(period_);
    }

    [[nodiscard]] double advance_ema(double value, double previous) const noexcept {
        return ((value - previous) * multiplier_) + previous;
    }

    const Line<double>& source_;
    std::size_t period_;
    double multiplier_;
    Line<double> ema1_;
    Line<double> ema2_;
    double ema1_prev_ = 0.0;
    double ema2_prev_ = 0.0;
    bool ema1_initialized_ = false;
    bool ema2_initialized_ = false;
};

using DEMA = DoubleExponentialMovingAverage;
using MovingAverageDoubleExponential = DoubleExponentialMovingAverage;

} // namespace nonabt
