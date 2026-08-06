#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Bollinger Bands with middle, top, and bottom output lines.
class BollingerBands : public Indicator {
public:
    explicit BollingerBands(const Line<double>& source, std::size_t period = 20, double devfactor = 2.0)
        : source_(source), period_(period), devfactor_(devfactor) {}

    void next() override {
        const auto idx = source_.index();
        if (idx + 1 < period_) {
            const double nan = std::numeric_limits<double>::quiet_NaN();
            line_.forward(nan);
            top_.forward(nan);
            bottom_.forward(nan);
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

        const double stddev = std::sqrt(variance_sum / static_cast<double>(period_));
        line_.forward(mean);
        top_.forward(mean + devfactor_ * stddev);
        bottom_.forward(mean - devfactor_ * stddev);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

    [[nodiscard]] std::size_t period() const noexcept { return period_; }
    [[nodiscard]] double devfactor() const noexcept { return devfactor_; }

    [[nodiscard]] const Line<double>& mid() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& top() const noexcept { return top_; }
    [[nodiscard]] const Line<double>& bottom() const noexcept { return bottom_; }

private:
    const Line<double>& source_;
    std::size_t period_;
    double devfactor_;
    Line<double> top_;
    Line<double> bottom_;
};

} // namespace nonabt
