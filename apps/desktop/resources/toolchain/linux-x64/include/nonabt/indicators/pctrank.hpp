#pragma once

#include <stratforge/indicators/periodn.hpp>

#include <cmath>
#include <limits>

namespace nonabt {

/// Fraction of values in the trailing window that are strictly below the current value.
class PercentRank : public PeriodN {
public:
    explicit PercentRank(const Line<double>& source, std::size_t period = 50)
        : PeriodN(source, period) {}

    void next() override {
        if (in_warmup()) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const auto idx = source().index();
        const double current = source().data()[idx];
        double count = 0.0;
        for (std::size_t i = 0; i < period(); ++i) {
            count += source().data()[idx - period() + 1 + i] < current ? 1.0 : 0.0;
        }

        line_.forward(count / static_cast<double>(period()));
    }
};

using PctRank = PercentRank;

} // namespace nonabt
