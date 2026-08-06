#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Variable Index Dynamic Average using Chande Momentum Oscillator scaling.
class VIDYA : public Indicator {
public:
    explicit VIDYA(const Line<double>& source, std::size_t period = 14, std::size_t momentum_period = 9)
        : source_(source)
        , period_(period == 0 ? 1 : period)
        , momentum_period_(momentum_period == 0 ? 1 : momentum_period)
        , base_alpha_(2.0 / (static_cast<double>(period_) + 1.0)) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (idx < momentum_period_) {
            line_.forward(nan);
            return;
        }

        double up_sum = 0.0;
        double down_sum = 0.0;
        for (std::size_t i = 0; i < momentum_period_; ++i) {
            const double delta = source_.data()[idx - i] - source_.data()[idx - i - 1];
            if (delta > 0.0) {
                up_sum += delta;
            } else {
                down_sum -= delta;
            }
        }

        const double denominator = up_sum + down_sum;
        const double cmo = denominator == 0.0 ? 0.0 : std::fabs((up_sum - down_sum) / denominator);
        const double alpha = base_alpha_ * cmo;

        if (!initialized_) {
            prev_vidya_ = source_.data()[idx];
            initialized_ = true;
        } else {
            prev_vidya_ = (alpha * source_.data()[idx]) + ((1.0 - alpha) * prev_vidya_);
        }

        line_.forward(prev_vidya_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return momentum_period_ + 1;
    }

private:
    const Line<double>& source_;
    std::size_t period_;
    std::size_t momentum_period_;
    double base_alpha_;
    double prev_vidya_ = 0.0;
    bool initialized_ = false;
};

/// Fractal Adaptive Moving Average using fractal-dimension smoothing.
class FRAMA : public Indicator {
public:
    explicit FRAMA(const Line<double>& source,
                   std::size_t period = 16,
                   std::size_t fast = 4,
                   std::size_t slow = 300)
        : source_(source)
        , period_(normalize_period(period))
        , fast_alpha_(2.0 / (static_cast<double>(fast == 0 ? 1 : fast) + 1.0))
        , slow_alpha_(2.0 / (static_cast<double>(slow == 0 ? 1 : slow) + 1.0)) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (idx + 1 < period_) {
            line_.forward(nan);
            return;
        }

        const std::size_t half = period_ / 2;
        const std::size_t start = idx - period_ + 1;
        double n1_high = source_.data()[start];
        double n1_low = source_.data()[start];
        for (std::size_t pos = start; pos < start + half; ++pos) {
            n1_high = std::max(n1_high, source_.data()[pos]);
            n1_low = std::min(n1_low, source_.data()[pos]);
        }

        double n2_high = source_.data()[start + half];
        double n2_low = source_.data()[start + half];
        for (std::size_t pos = start + half; pos <= idx; ++pos) {
            n2_high = std::max(n2_high, source_.data()[pos]);
            n2_low = std::min(n2_low, source_.data()[pos]);
        }

        double n3_high = source_.data()[start];
        double n3_low = source_.data()[start];
        for (std::size_t pos = start; pos <= idx; ++pos) {
            n3_high = std::max(n3_high, source_.data()[pos]);
            n3_low = std::min(n3_low, source_.data()[pos]);
        }

        const double n1 = (n1_high - n1_low) / static_cast<double>(half);
        const double n2 = (n2_high - n2_low) / static_cast<double>(half);
        const double n3 = (n3_high - n3_low) / static_cast<double>(period_);

        double alpha = slow_alpha_;
        if (n1 > 0.0 && n2 > 0.0 && n3 > 0.0) {
            const double dimension = (std::log(n1 + n2) - std::log(n3)) / std::log(2.0);
            alpha = std::exp(-4.6 * (dimension - 1.0));
            alpha = std::clamp(alpha, slow_alpha_, fast_alpha_);
        }

        if (!initialized_) {
            prev_frama_ = source_.data()[idx];
            initialized_ = true;
        } else {
            prev_frama_ = (alpha * source_.data()[idx]) + ((1.0 - alpha) * prev_frama_);
        }

        line_.forward(prev_frama_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

private:
    [[nodiscard]] static std::size_t normalize_period(std::size_t period) noexcept {
        std::size_t normalized = period < 2 ? 2 : period;
        if (normalized % 2 != 0) {
            ++normalized;
        }
        return normalized;
    }

    const Line<double>& source_;
    std::size_t period_;
    double fast_alpha_;
    double slow_alpha_;
    double prev_frama_ = 0.0;
    bool initialized_ = false;
};

} // namespace nonabt
