#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Population standard deviation over the trailing period.
class StdDev : public Indicator {
public:
    explicit StdDev(const Line<double>& source, std::size_t period)
        : source_(source), period_(period == 0 ? 1 : period) {}

    void next() override {
        const auto idx = source_.index();
        if (idx + 1 < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += source_.data()[idx - i];
        }
        const double mean = sum / static_cast<double>(period_);

        double variance_sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            const double delta = source_.data()[idx - i] - mean;
            variance_sum += delta * delta;
        }

        line_.forward(std::sqrt(variance_sum / static_cast<double>(period_)));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

    [[nodiscard]] std::size_t period() const noexcept { return period_; }

private:
    const Line<double>& source_;
    std::size_t period_;
};

} // namespace nonabt
