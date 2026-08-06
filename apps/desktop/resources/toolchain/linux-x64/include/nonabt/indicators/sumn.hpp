#pragma once

#include <stratforge/indicators/periodn.hpp>

#include <cmath>
#include <limits>

namespace nonabt {

/// Sum of the trailing period using fsum-style precision.
class SumN : public PeriodN {
public:
    explicit SumN(const Line<double>& source, std::size_t period)
        : PeriodN(source, period) {}

    void next() override {
        if (in_warmup()) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const auto idx = source().index();
        double total = 0.0;
        for (std::size_t i = 0; i < period(); ++i) {
            total += source().data()[idx - period() + 1 + i];
        }

        line_.forward(total);
    }
};

using Sum = SumN;

} // namespace nonabt
