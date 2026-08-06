#pragma once

#include <stratforge/indicators/atr.hpp>
#include <stratforge/indicators/ema.hpp>
#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Donchian channels with middle, top, and bottom lines.
class DonchianChannels : public Indicator {
public:
    DonchianChannels(const Line<double>& high, const Line<double>& low, std::size_t period = 20)
        : high_(high), low_(low), period_(period == 0 ? 1 : period) {}

    void next() override {
        const auto idx = high_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (idx + 1 < period_) {
            line_.forward(nan);
            top_.forward(nan);
            bottom_.forward(nan);
            return;
        }

        double highest = high_.data()[idx];
        double lowest = low_.data()[idx];
        for (std::size_t i = 1; i < period_; ++i) {
            highest = std::max(highest, high_.data()[idx - i]);
            lowest = std::min(lowest, low_.data()[idx - i]);
        }

        line_.forward((highest + lowest) / 2.0);
        top_.forward(highest);
        bottom_.forward(lowest);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

    [[nodiscard]] const Line<double>& mid() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& top() const noexcept { return top_; }
    [[nodiscard]] const Line<double>& bottom() const noexcept { return bottom_; }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    std::size_t period_;
    Line<double> top_;
    Line<double> bottom_;
};

using Donchian = DonchianChannels;

/// Keltner channel using EMA midline and ATR bands.
class KeltnerChannel : public Indicator {
public:
    KeltnerChannel(const Line<double>& high,
                   const Line<double>& low,
                   const Line<double>& close,
                   std::size_t period = 20,
                   double devfactor = 2.0)
        : mid_(close, period), atr_(high, low, close, period), devfactor_(devfactor) {}

    void next() override {
        mid_.next();
        atr_.next();

        const double mid = mid_.line().data().back();
        const double atr = atr_.line().data().back();
        if (std::isnan(mid) || std::isnan(atr)) {
            const double nan = std::numeric_limits<double>::quiet_NaN();
            line_.forward(nan);
            top_.forward(nan);
            bottom_.forward(nan);
            return;
        }

        line_.forward(mid);
        top_.forward(mid + (atr * devfactor_));
        bottom_.forward(mid - (atr * devfactor_));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return std::max(mid_.minimum_period(), atr_.minimum_period());
    }

    [[nodiscard]] const Line<double>& mid() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& top() const noexcept { return top_; }
    [[nodiscard]] const Line<double>& bottom() const noexcept { return bottom_; }

private:
    EMA mid_;
    ATR atr_;
    double devfactor_;
    Line<double> top_;
    Line<double> bottom_;
};

using Keltner = KeltnerChannel;

/// Ulcer Index over the trailing close window.
class UlcerIndex : public Indicator {
public:
    explicit UlcerIndex(const Line<double>& close, std::size_t period = 14)
        : close_(close), period_(period == 0 ? 1 : period) {}

    void next() override {
        const auto idx = close_.index();
        if (idx + 1 < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        double squared_drawdown_sum = 0.0;
        const std::size_t window_start = idx - period_ + 1;
        double highest_close = close_.data()[window_start];
        for (std::size_t pos = window_start; pos <= idx; ++pos) {
            highest_close = std::max(highest_close, close_.data()[pos]);
            const double value = close_.data()[pos];
            const double drawdown = highest_close == 0.0 ? 0.0 : ((value / highest_close) - 1.0) * 100.0;
            squared_drawdown_sum += drawdown * drawdown;
        }

        line_.forward(std::sqrt(squared_drawdown_sum / static_cast<double>(period_)));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

private:
    const Line<double>& close_;
    std::size_t period_;
};

using Ulcer = UlcerIndex;

/// Chaikin volatility: ROC of an EMA applied to the high-low spread.
class ChaikinVolatility : public Indicator {
public:
    ChaikinVolatility(const Line<double>& high,
                      const Line<double>& low,
                      std::size_t ema_period = 10,
                      std::size_t roc_period = 10)
        : high_(high), low_(low), ema_(range_line_, ema_period), roc_period_(roc_period == 0 ? 1 : roc_period) {}

    void next() override {
        const auto idx = high_.index();
        range_line_.forward(high_.data()[idx] - low_.data()[idx]);
        ema_.next();

        const double ema_value = ema_.line().data().back();
        ema_values_.forward(ema_value);

        if (std::isnan(ema_value) || ema_values_.size() <= roc_period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const double previous = ema_values_.data()[ema_values_.size() - 1 - roc_period_];
        if (std::isnan(previous) || previous == 0.0) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(((ema_value - previous) / previous) * 100.0);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return ema_.minimum_period() + roc_period_;
    }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    Line<double> range_line_;
    EMA ema_;
    std::size_t roc_period_;
    Line<double> ema_values_;
};

} // namespace nonabt
