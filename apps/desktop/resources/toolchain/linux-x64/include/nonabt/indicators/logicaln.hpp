#pragma once

#include <stratforge/indicators/periodn.hpp>

#include <cmath>
#include <limits>

namespace nonabt {

/// Whether any value in the trailing period evaluates to true.
class AnyN : public PeriodN {
public:
    explicit AnyN(const Line<double>& source, std::size_t period)
        : PeriodN(source, period) {}

    void next() override {
        if (in_warmup()) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const auto idx = source().index();
        bool result = false;
        for (std::size_t i = 0; i < period(); ++i) {
            const double value = source().data()[idx - period() + 1 + i];
            result = result || (value != 0.0 && !std::isnan(value));
        }

        line_.forward(result ? 1.0 : 0.0);
    }
};

/// Whether all values in the trailing period evaluate to true.
class AllN : public PeriodN {
public:
    explicit AllN(const Line<double>& source, std::size_t period)
        : PeriodN(source, period) {}

    void next() override {
        if (in_warmup()) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const auto idx = source().index();
        bool result = true;
        for (std::size_t i = 0; i < period(); ++i) {
            const double value = source().data()[idx - period() + 1 + i];
            result = result && (value != 0.0 && !std::isnan(value));
        }

        line_.forward(result ? 1.0 : 0.0);
    }
};

} // namespace nonabt
