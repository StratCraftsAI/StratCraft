#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cstddef>
#include <limits>

namespace nonabt {

/// Triple exponential moving average.
class TripleExponentialMovingAverage : public Indicator {
public:
    explicit TripleExponentialMovingAverage(const Line<double>& source, std::size_t period = 30)
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
            ema3_.forward(nan);
            return;
        }

        if (!ema1_initialized_) {
            ema1_prev_ = seed_sma_source(idx);
            ema1_initialized_ = true;
        } else {
            ema1_prev_ = advance_ema(source_.data()[idx], ema1_prev_);
        }
        ema1_.forward(ema1_prev_);

        if (!ema1_seed_window_ready()) {
            ema2_.forward(nan);
            ema3_.forward(nan);
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

        if (!ema2_seed_window_ready()) {
            ema3_.forward(nan);
            line_.forward(nan);
            return;
        }

        if (!ema3_initialized_) {
            ema3_prev_ = seed_sma_ema2();
            ema3_initialized_ = true;
        } else {
            ema3_prev_ = advance_ema(ema2_prev_, ema3_prev_);
        }
        ema3_.forward(ema3_prev_);

        line_.forward((3.0 * ema1_prev_) - (3.0 * ema2_prev_) + ema3_prev_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return (3 * period_) - 2;
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

    [[nodiscard]] bool ema2_seed_window_ready() const noexcept {
        return ema2_.size() >= ((3 * period_) - 2);
    }

    [[nodiscard]] double seed_sma_ema1() const noexcept {
        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += ema1_.data()[ema1_.size() - 1 - i];
        }
        return sum / static_cast<double>(period_);
    }

    [[nodiscard]] double seed_sma_ema2() const noexcept {
        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += ema2_.data()[ema2_.size() - 1 - i];
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
    Line<double> ema3_;
    double ema1_prev_ = 0.0;
    double ema2_prev_ = 0.0;
    double ema3_prev_ = 0.0;
    bool ema1_initialized_ = false;
    bool ema2_initialized_ = false;
    bool ema3_initialized_ = false;
};

using TEMA = TripleExponentialMovingAverage;
using MovingAverageTripleExponential = TripleExponentialMovingAverage;

} // namespace nonabt
