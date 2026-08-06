#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cstddef>
#include <limits>
#include <numeric>

namespace nonabt {

/// Simple Moving Average indicator
class SMA : public Indicator {
public:
    explicit SMA(const Line<double>& source, std::size_t period)
        : source_(source), period_(period == 0 ? 1 : period) {}

    void next() override {
        auto idx = source_.index();
        if (idx + 1 < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += source_.data()[idx - i];
        }
        line_.forward(sum / static_cast<double>(period_));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

    [[nodiscard]] std::size_t period() const noexcept { return period_; }

private:
    const Line<double>& source_;
    std::size_t period_;
};

/// MA is an alias for SMA (default moving average type)
using MA = SMA;

} // namespace nonabt
