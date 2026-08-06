#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Mean absolute deviation over a trailing window.
class MeanDeviation : public Indicator {
public:
    explicit MeanDeviation(const Line<double>& source, std::size_t period)
        : source_(source), period_(period) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();

        if (idx + 1 < period_) {
            mean_.forward(nan);
            absdev_.forward(nan);
            line_.forward(nan);
            return;
        }

        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += source_.data()[idx - i];
        }
        const double mean = sum / static_cast<double>(period_);
        mean_.forward(mean);

        const double absdev = std::abs(source_.data()[idx] - mean);
        absdev_.forward(absdev);

        if (absdev_.size() < (period_ * 2) - 1) {
            line_.forward(nan);
            return;
        }

        double abs_sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            abs_sum += absdev_.data()[idx - i];
        }
        line_.forward(abs_sum / static_cast<double>(period_));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return (period_ * 2) - 1;
    }

private:
    const Line<double>& source_;
    std::size_t period_;
    Line<double> mean_;
    Line<double> absdev_;
};

} // namespace nonabt
