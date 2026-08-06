#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cstddef>
#include <limits>

namespace nonabt {

/// Smoothed Moving Average using Wilder smoothing.
class SMMA : public Indicator {
public:
    explicit SMMA(const Line<double>& source, std::size_t period)
        : source_(source), period_(period) {}

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
            prev_smma_ = sum / static_cast<double>(period_);
            initialized_ = true;
            line_.forward(prev_smma_);
            return;
        }

        const double period_d = static_cast<double>(period_);
        prev_smma_ = ((prev_smma_ * (period_d - 1.0)) + source_.data()[idx]) / period_d;
        line_.forward(prev_smma_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

private:
    const Line<double>& source_;
    std::size_t period_;
    double prev_smma_ = 0.0;
    bool initialized_ = false;
};

} // namespace nonabt
