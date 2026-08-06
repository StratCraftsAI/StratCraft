#pragma once

#include <stratforge/indicators/indicator.hpp>
#include <stratforge/indicators/sma.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Detrended Price Oscillator.
class DetrendedPriceOscillator : public Indicator {
public:
    explicit DetrendedPriceOscillator(const Line<double>& source, std::size_t period = 20)
        : source_(source)
        , period_(period)
        , offset_((period > 0 ? period - 1 : 0) / 2)
        , average_(source, period) {}

    void next() override {
        average_.next();

        const auto idx = source_.index();
        if (idx < offset_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const double shifted_average = average_.line().data()[idx - offset_];
        if (std::isnan(shifted_average)) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(source_.data()[idx] - shifted_average);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + offset_;
    }

private:
    const Line<double>& source_;
    std::size_t period_;
    std::size_t offset_;
    SMA average_;
};

using DPO = DetrendedPriceOscillator;
using DetrendedPriceOsc = DetrendedPriceOscillator;

} // namespace nonabt
