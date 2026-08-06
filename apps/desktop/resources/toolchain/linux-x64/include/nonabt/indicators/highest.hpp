#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cstddef>
#include <limits>

namespace nonabt {

/// Highest value over the trailing period, inclusive of the current bar.
class Highest : public Indicator {
public:
    explicit Highest(const Line<double>& source, std::size_t period)
        : source_(source), period_(period) {}

    void next() override {
        const auto idx = source_.index();
        if (idx + 1 < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        double highest = source_.data()[idx];
        for (std::size_t i = 1; i < period_; ++i) {
            const double candidate = source_.data()[idx - i];
            if (candidate > highest) {
                highest = candidate;
            }
        }

        line_.forward(highest);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

    [[nodiscard]] std::size_t period() const noexcept { return period_; }

private:
    const Line<double>& source_;
    std::size_t period_;
};

using MaxN = Highest;

} // namespace nonabt
