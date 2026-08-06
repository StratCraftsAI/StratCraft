#pragma once

#include <stratforge/indicators/heikinashi.hpp>
#include <stratforge/indicators/indicator.hpp>
#include <stratforge/indicators/sma.hpp>

#include <limits>
#include <cstddef>

namespace nonabt {

class haDelta : public Indicator {
public:
    haDelta(const Line<double>& open,
            const Line<double>& high,
            const Line<double>& low,
            const Line<double>& close,
            std::size_t period = 3,
            bool autoheikin = true)
        : open_(open)
        , close_(close)
        , period_(period == 0 ? 1 : period)
        , autoheikin_(autoheikin)
        , heikin_(open, high, low, close)
        , smoothed_sma_(line_, period_) {}

    void next() override {
        const double nan = std::numeric_limits<double>::quiet_NaN();
        double delta = nan;
        if (autoheikin_) {
            heikin_.next();
            if (close_.index() > 0) {
                delta = heikin_.ha_close().data().back() - heikin_.ha_open().data().back();
            }
        } else {
            const std::size_t idx = close_.index();
            delta = close_.data()[idx] - open_.data()[idx];
        }

        line_.forward(delta);
        smoothed_sma_.next();
        smoothed_.forward(smoothed_sma_.line().data().back());
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

    [[nodiscard]] const Line<double>& ha_delta() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& smoothed() const noexcept { return smoothed_; }

private:
    const Line<double>& open_;
    const Line<double>& close_;
    std::size_t period_;
    bool autoheikin_;
    HeikinAshi heikin_;
    SMA smoothed_sma_;
    Line<double> smoothed_;
};

using haD = haDelta;

} // namespace nonabt
