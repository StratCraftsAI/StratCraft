#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Exponential smoothing seeded with a simple average over the first period.
class ExponentialSmoothing : public Indicator {
public:
    explicit ExponentialSmoothing(const Line<double>& source,
                                  std::size_t period = 1,
                                  double alpha = std::numeric_limits<double>::quiet_NaN())
        : source_(source)
        , period_(period == 0 ? 1 : period)
        , alpha_(std::isnan(alpha) ? 2.0 / (1.0 + static_cast<double>(period_)) : alpha)
        , alpha1_(1.0 - alpha_) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();

        if (idx + 1 < period_) {
            line_.forward(nan);
            return;
        }

        if (!initialized_) {
            double sum = 0.0;
            for (std::size_t i = 0; i < period_; ++i) {
                sum += source_.data()[idx - period_ + 1 + i];
            }

            previous_ = sum / static_cast<double>(period_);
            initialized_ = true;
            line_.forward(previous_);
            return;
        }

        previous_ = (previous_ * alpha1_) + (source_.data()[idx] * alpha_);
        line_.forward(previous_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

private:
    const Line<double>& source_;
    std::size_t period_;
    double alpha_;
    double alpha1_;
    double previous_ = 0.0;
    bool initialized_ = false;
};

using ExpSmoothing = ExponentialSmoothing;

/// Exponential smoothing driven by a per-bar alpha line.
class ExponentialSmoothingDynamic : public Indicator {
public:
    explicit ExponentialSmoothingDynamic(const Line<double>& source,
                                         const Line<double>& alpha,
                                         std::size_t period = 1)
        : source_(source), alpha_(alpha), period_(period == 0 ? 1 : period) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();

        if (idx + 1 < period_) {
            line_.forward(nan);
            return;
        }

        if (!initialized_) {
            double sum = 0.0;
            for (std::size_t i = 0; i < period_; ++i) {
                sum += source_.data()[idx - period_ + 1 + i];
            }

            previous_ = sum / static_cast<double>(period_);
            initialized_ = true;
            line_.forward(previous_);
            return;
        }

        const double alpha = alpha_.data()[alpha_.index()];
        previous_ = (previous_ * (1.0 - alpha)) + (source_.data()[idx] * alpha);
        line_.forward(previous_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

private:
    const Line<double>& source_;
    const Line<double>& alpha_;
    std::size_t period_;
    double previous_ = 0.0;
    bool initialized_ = false;
};

using ExpSmoothingDynamic = ExponentialSmoothingDynamic;

} // namespace nonabt
