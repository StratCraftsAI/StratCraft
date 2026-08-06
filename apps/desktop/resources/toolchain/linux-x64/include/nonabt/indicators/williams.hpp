#pragma once

#include <stratforge/indicators/highest.hpp>
#include <stratforge/indicators/indicator.hpp>
#include <stratforge/indicators/lowest.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Larry Williams accumulation/distribution line.
class WilliamsAD : public Indicator {
public:
    WilliamsAD(const Line<double>& high, const Line<double>& low, const Line<double>& close)
        : high_(high), low_(low), close_(close) {}

    void next() override {
        const auto idx = close_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (idx == 0) {
            line_.forward(nan);
            return;
        }

        const double prev_close = close_.data()[idx - 1];
        const double close = close_.data()[idx];

        double delta = 0.0;
        if (close > prev_close) {
            delta = close - std::min(low_.data()[idx], prev_close);
        } else if (close < prev_close) {
            delta = close - std::max(high_.data()[idx], prev_close);
        }

        if (line_.empty() || std::isnan(line_.data().back())) {
            line_.forward(delta);
            return;
        }

        line_.forward(line_.data().back() + delta);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 2;
    }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
};

using WAD = WilliamsAD;

/// Williams %R oscillator.
class WilliamsR : public Indicator {
public:
    explicit WilliamsR(const Line<double>& high,
                       const Line<double>& low,
                       const Line<double>& close,
                       std::size_t period = 14)
        : close_(close), highest_(high, period), lowest_(low, period) {}

    void next() override {
        highest_.next();
        lowest_.next();

        const double highest = highest_.line().data().back();
        const double lowest = lowest_.line().data().back();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (std::isnan(highest) || std::isnan(lowest)) {
            line_.forward(nan);
            return;
        }

        const double denominator = highest - lowest;
        if (denominator == 0.0) {
            line_.forward(nan);
            return;
        }

        const double close = close_.data()[close_.index()];
        line_.forward(-100.0 * ((highest - close) / denominator));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return highest_.minimum_period();
    }

private:
    const Line<double>& close_;
    Highest highest_;
    Lowest lowest_;
};

using WillR = WilliamsR;

} // namespace nonabt
