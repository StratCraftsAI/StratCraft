#pragma once

#include <stratforge/indicators/average.hpp>
#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// David Varadi's bounded DV2 oscillator.
class DV2 : public Indicator {
public:
    explicit DV2(const Line<double>& high,
                 const Line<double>& low,
                 const Line<double>& close,
                 std::size_t period = 252,
                 std::size_t maperiod = 2)
        : high_(high)
        , low_(low)
        , close_(close)
        , period_(period == 0 ? 1 : period)
        , maperiod_(maperiod == 0 ? 1 : maperiod)
        , close_hl_ratio_avg_(close_hl_ratio_, maperiod_) {}

    void next() override {
        const auto idx = close_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        const double midpoint = (high_.data()[idx] + low_.data()[idx]) / 2.0;

        if (midpoint == 0.0 || std::isnan(midpoint)) {
            close_hl_ratio_.forward(nan);
        } else {
            close_hl_ratio_.forward(close_.data()[idx] / midpoint);
        }

        close_hl_ratio_avg_.next();
        const double smoothed = close_hl_ratio_avg_.line().data().back();
        smoothed_.forward(smoothed);

        if (std::isnan(smoothed) || idx + 1 < (maperiod_ + period_ - 1)) {
            line_.forward(nan);
            return;
        }

        double count = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            count += smoothed_.data()[idx - period_ + 1 + i] < smoothed ? 1.0 : 0.0;
        }

        line_.forward((count / static_cast<double>(period_)) * 100.0);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return maperiod_ + period_ - 1;
    }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    std::size_t period_;
    std::size_t maperiod_;
    Line<double> close_hl_ratio_;
    Average close_hl_ratio_avg_;
    Line<double> smoothed_;
};

} // namespace nonabt
