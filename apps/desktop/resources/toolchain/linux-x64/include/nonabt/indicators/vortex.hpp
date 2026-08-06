#pragma once

#include <stratforge/indicators/indicator.hpp>
#include <stratforge/indicators/sumn.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Vortex indicator with +VI and -VI lines.
class Vortex : public Indicator {
public:
    explicit Vortex(const Line<double>& high,
                    const Line<double>& low,
                    const Line<double>& close,
                    std::size_t period = 14)
        : high_(high)
        , low_(low)
        , close_(close)
        , period_(period == 0 ? 1 : period)
        , vm_plus_sum_(vm_plus_raw_, period_)
        , vm_minus_sum_(vm_minus_raw_, period_)
        , tr_sum_(true_range_raw_, period_) {}

    void next() override {
        const auto idx = close_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (idx == 0) {
            vm_plus_raw_.forward(nan);
            vm_minus_raw_.forward(nan);
            true_range_raw_.forward(nan);
            vm_plus_sum_.next();
            vm_minus_sum_.next();
            tr_sum_.next();
            line_.forward(nan);
            vi_minus_.forward(nan);
            return;
        }

        const double h0l1 = std::abs(high_.data()[idx] - low_.data()[idx - 1]);
        const double l0h1 = std::abs(low_.data()[idx] - high_.data()[idx - 1]);
        const double h0c1 = std::abs(high_.data()[idx] - close_.data()[idx - 1]);
        const double l0c1 = std::abs(low_.data()[idx] - close_.data()[idx - 1]);
        const double h0l0 = std::abs(high_.data()[idx] - low_.data()[idx]);

        vm_plus_raw_.forward(h0l1);
        vm_minus_raw_.forward(l0h1);
        true_range_raw_.forward(std::max({h0l0, h0c1, l0c1}));

        vm_plus_sum_.next();
        vm_minus_sum_.next();
        tr_sum_.next();

        const double plus_sum = vm_plus_sum_.line().data().back();
        const double minus_sum = vm_minus_sum_.line().data().back();
        const double tr_sum = tr_sum_.line().data().back();
        if (std::isnan(plus_sum) || std::isnan(minus_sum) || std::isnan(tr_sum) || tr_sum == 0.0) {
            line_.forward(nan);
            vi_minus_.forward(nan);
            return;
        }

        line_.forward(plus_sum / tr_sum);
        vi_minus_.forward(minus_sum / tr_sum);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + 1;
    }

    [[nodiscard]] const Line<double>& vi_plus() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& vi_minus() const noexcept { return vi_minus_; }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    std::size_t period_;
    Line<double> vm_plus_raw_;
    Line<double> vm_minus_raw_;
    Line<double> true_range_raw_;
    SumN vm_plus_sum_;
    SumN vm_minus_sum_;
    SumN tr_sum_;
    Line<double> vi_minus_;
};

using VortexIndicator = Vortex;

} // namespace nonabt
