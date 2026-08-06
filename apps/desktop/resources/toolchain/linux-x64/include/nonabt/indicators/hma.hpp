#pragma once

#include <stratforge/core/line.hpp>
#include <stratforge/indicators/indicator.hpp>
#include <stratforge/indicators/wma.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Hull Moving Average.
class HMA : public Indicator {
public:
    explicit HMA(const Line<double>& source, std::size_t period)
        : source_(source)
        , period_(period)
        , half_period_(period / 2)
        , sqrt_period_(static_cast<std::size_t>(std::sqrt(static_cast<double>(period))))
        , wma_full_(source, period)
        , wma_half_(source, half_period_ == 0 ? 1 : half_period_)
        , wma_final_(diff_, sqrt_period_ == 0 ? 1 : sqrt_period_) {}

    void next() override {
        const double nan = std::numeric_limits<double>::quiet_NaN();

        wma_full_.next();
        wma_half_.next();

        const double full = wma_full_.line().data().back();
        const double half = wma_half_.line().data().back();
        if (std::isnan(full) || std::isnan(half)) {
            diff_.forward(nan);
            wma_final_.next();
            line_.forward(nan);
            return;
        }

        diff_.forward((2.0 * half) - full);
        wma_final_.next();
        line_.forward(wma_final_.line().data().back());
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + sqrt_period_ - 1;
    }

private:
    const Line<double>& source_;
    std::size_t period_;
    std::size_t half_period_;
    std::size_t sqrt_period_;
    Line<double> diff_;
    WMA wma_full_;
    WMA wma_half_;
    WMA wma_final_;
};

} // namespace nonabt
