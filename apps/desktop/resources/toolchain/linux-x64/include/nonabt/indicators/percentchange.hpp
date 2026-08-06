#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cstddef>
#include <limits>

namespace nonabt {

/// Percentage change relative to N bars ago.
class PercentChange : public Indicator {
public:
    explicit PercentChange(const Line<double>& source, std::size_t period = 30)
        : source_(source), period_(period) {}

    void next() override {
        const auto idx = source_.index();
        if (idx < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward((source_.data()[idx] / source_.data()[idx - period_]) - 1.0);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + 1;
    }

private:
    const Line<double>& source_;
    std::size_t period_;
};

using PctChange = PercentChange;

} // namespace nonabt
