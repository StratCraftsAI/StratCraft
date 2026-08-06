#pragma once

#include <stratforge/indicators/atr.hpp>
#include <stratforge/indicators/highest.hpp>
#include <stratforge/indicators/indicator.hpp>
#include <stratforge/indicators/lowest.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// SuperTrend using ATR bands and directional band switching.
class SuperTrend : public Indicator {
public:
    SuperTrend(const Line<double>& high,
               const Line<double>& low,
               const Line<double>& close,
               std::size_t period = 10,
               double multiplier = 3.0)
        : high_(high), low_(low), close_(close), atr_(high, low, close, period), multiplier_(multiplier) {}

    void next() override {
        atr_.next();
        const auto idx = close_.index();
        const double atr = atr_.line().data().back();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (std::isnan(atr)) {
            upper_band_.forward(nan);
            lower_band_.forward(nan);
            line_.forward(nan);
            return;
        }

        const double hl2 = (high_.data()[idx] + low_.data()[idx]) / 2.0;
        const double basic_upper = hl2 + (multiplier_ * atr);
        const double basic_lower = hl2 - (multiplier_ * atr);

        double final_upper = basic_upper;
        double final_lower = basic_lower;
        if (!upper_band_.empty() && !std::isnan(upper_band_.data().back())) {
            const double prev_upper = upper_band_.data().back();
            const double prev_lower = lower_band_.data().back();
            const double prev_close = close_.data()[idx - 1];

            if (!(basic_upper < prev_upper || prev_close > prev_upper)) {
                final_upper = prev_upper;
            }
            if (!(basic_lower > prev_lower || prev_close < prev_lower)) {
                final_lower = prev_lower;
            }
        }

        upper_band_.forward(final_upper);
        lower_band_.forward(final_lower);

        if (line_.empty() || std::isnan(line_.data().back())) {
            line_.forward(close_.data()[idx] <= final_upper ? final_upper : final_lower);
            return;
        }

        const double prev_supertrend = line_.data().back();
        const double prev_upper = upper_band_.data()[upper_band_.size() - 2];
        if (prev_supertrend == prev_upper) {
            line_.forward(close_.data()[idx] <= final_upper ? final_upper : final_lower);
            return;
        }

        line_.forward(close_.data()[idx] >= final_lower ? final_lower : final_upper);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return atr_.minimum_period();
    }

    [[nodiscard]] const Line<double>& upper_band() const noexcept { return upper_band_; }
    [[nodiscard]] const Line<double>& lower_band() const noexcept { return lower_band_; }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    ATR atr_;
    double multiplier_;
    Line<double> upper_band_;
    Line<double> lower_band_;
};

/// Chandelier Exit exposing long and short stops.
class ChandelierExit : public Indicator {
public:
    ChandelierExit(const Line<double>& high,
                   const Line<double>& low,
                   const Line<double>& close,
                   std::size_t period = 22,
                   double multiplier = 3.0)
        : atr_(high, low, close, period)
        , highest_(high, period)
        , lowest_(low, period)
        , multiplier_(multiplier) {}

    void next() override {
        atr_.next();
        highest_.next();
        lowest_.next();

        const double atr = atr_.line().data().back();
        const double highest = highest_.line().data().back();
        const double lowest = lowest_.line().data().back();
        if (std::isnan(atr) || std::isnan(highest) || std::isnan(lowest)) {
            const double nan = std::numeric_limits<double>::quiet_NaN();
            line_.forward(nan);
            short_exit_.forward(nan);
            return;
        }

        line_.forward(highest - (atr * multiplier_));
        short_exit_.forward(lowest + (atr * multiplier_));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return std::max({atr_.minimum_period(), highest_.minimum_period(), lowest_.minimum_period()});
    }

    [[nodiscard]] const Line<double>& long_exit() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& short_exit() const noexcept { return short_exit_; }

private:
    ATR atr_;
    Highest highest_;
    Lowest lowest_;
    double multiplier_;
    Line<double> short_exit_;
};

} // namespace nonabt
