#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Kaufman adaptive moving average.
class AdaptiveMovingAverage : public Indicator {
public:
    explicit AdaptiveMovingAverage(const Line<double>& source,
                                   std::size_t period = 30,
                                   std::size_t fast = 2,
                                   std::size_t slow = 30)
        : source_(source)
        , period_(period)
        , fast_(2.0 / (static_cast<double>(fast) + 1.0))
        , slow_(2.0 / (static_cast<double>(slow) + 1.0)) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();

        if (idx < period_) {
            line_.forward(nan);
            return;
        }

        if (!initialized_) {
            prev_kama_ = seed_sma(idx);
            initialized_ = true;
            line_.forward(prev_kama_);
            return;
        }

        const double direction = std::fabs(source_.data()[idx] - source_.data()[idx - period_]);
        double volatility = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            volatility += std::fabs(source_.data()[idx - i] - source_.data()[idx - i - 1]);
        }

        const double efficiency_ratio = volatility == 0.0 ? 0.0 : (direction / volatility);
        const double smoothing_constant =
            std::pow((efficiency_ratio * (fast_ - slow_)) + slow_, 2.0);

        prev_kama_ =
            (prev_kama_ * (1.0 - smoothing_constant)) + (source_.data()[idx] * smoothing_constant);
        line_.forward(prev_kama_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + 1;
    }

private:
    [[nodiscard]] double seed_sma(std::size_t idx) const noexcept {
        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += source_.data()[idx - i];
        }
        return sum / static_cast<double>(period_);
    }

    const Line<double>& source_;
    std::size_t period_;
    double fast_;
    double slow_;
    double prev_kama_ = 0.0;
    bool initialized_ = false;
};

using KAMA = AdaptiveMovingAverage;
using MovingAverageAdaptive = AdaptiveMovingAverage;

} // namespace nonabt
