#pragma once

#include <stratforge/indicators/indicator.hpp>
#include <stratforge/indicators/sumn.hpp>
#include <stratforge/indicators/truelow.hpp>
#include <stratforge/indicators/truerange.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Larry Williams Ultimate Oscillator.
class UltimateOscillator : public Indicator {
public:
    explicit UltimateOscillator(const Line<double>& high,
                                const Line<double>& low,
                                const Line<double>& close,
                                std::size_t p1 = 7,
                                std::size_t p2 = 14,
                                std::size_t p3 = 28)
        : close_(close)
        , p1_(p1)
        , p2_(p2)
        , p3_(p3)
        , true_low_(low, close)
        , true_range_(high, low, close)
        , bp_sum_1_(buying_pressure_, p1_)
        , bp_sum_2_(buying_pressure_, p2_)
        , bp_sum_3_(buying_pressure_, p3_)
        , tr_sum_1_(true_range_.line(), p1_)
        , tr_sum_2_(true_range_.line(), p2_)
        , tr_sum_3_(true_range_.line(), p3_) {}

    void next() override {
        true_low_.next();
        true_range_.next();

        const double nan = std::numeric_limits<double>::quiet_NaN();
        const double tl = true_low_.line().data().back();
        if (std::isnan(tl)) {
            buying_pressure_.forward(nan);
        } else {
            buying_pressure_.forward(close_.data()[close_.index()] - tl);
        }

        bp_sum_1_.next();
        bp_sum_2_.next();
        bp_sum_3_.next();
        tr_sum_1_.next();
        tr_sum_2_.next();
        tr_sum_3_.next();

        const double bp1 = bp_sum_1_.line().data().back();
        const double bp2 = bp_sum_2_.line().data().back();
        const double bp3 = bp_sum_3_.line().data().back();
        const double tr1 = tr_sum_1_.line().data().back();
        const double tr2 = tr_sum_2_.line().data().back();
        const double tr3 = tr_sum_3_.line().data().back();

        if (std::isnan(bp1) || std::isnan(bp2) || std::isnan(bp3) ||
            std::isnan(tr1) || std::isnan(tr2) || std::isnan(tr3) ||
            tr1 == 0.0 || tr2 == 0.0 || tr3 == 0.0) {
            line_.forward(nan);
            return;
        }

        const double factor = 100.0 / 7.0;
        line_.forward((4.0 * factor) * (bp1 / tr1) +
                      (2.0 * factor) * (bp2 / tr2) +
                      factor * (bp3 / tr3));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return std::max({p1_, p2_, p3_}) + 1;
    }

    [[nodiscard]] const Line<double>& uo() const noexcept { return line_; }

private:
    const Line<double>& close_;
    std::size_t p1_;
    std::size_t p2_;
    std::size_t p3_;
    TrueLow true_low_;
    TrueRange true_range_;
    Line<double> buying_pressure_;
    SumN bp_sum_1_;
    SumN bp_sum_2_;
    SumN bp_sum_3_;
    SumN tr_sum_1_;
    SumN tr_sum_2_;
    SumN tr_sum_3_;
};

using UltimateOsc = UltimateOscillator;
using UO = UltimateOscillator;

} // namespace nonabt
