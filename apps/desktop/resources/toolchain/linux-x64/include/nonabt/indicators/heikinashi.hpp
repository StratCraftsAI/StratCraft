#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <algorithm>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Heikin Ashi candles exposed as lines; line() is ha_close.
class HeikinAshi : public Indicator {
public:
    HeikinAshi(const Line<double>& open,
               const Line<double>& high,
               const Line<double>& low,
               const Line<double>& close)
        : open_(open), high_(high), low_(low), close_(close) {}

    void next() override {
        const auto idx = close_.index();
        const double ha_close = (open_.data()[idx] + high_.data()[idx] + low_.data()[idx] + close_.data()[idx]) / 4.0;
        line_.forward(ha_close);

        if (idx == 0) {
            ha_open_.forward((open_.data()[idx] + close_.data()[idx]) / 2.0);
            ha_high_.forward(std::numeric_limits<double>::quiet_NaN());
            ha_low_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        } else {
            ha_open_.forward((ha_open_.data()[idx - 1] + line_.data()[idx - 1]) / 2.0);
        }

        ha_high_.forward(std::max({high_.data()[idx], ha_open_.data()[idx], ha_close}));
        ha_low_.forward(std::min({low_.data()[idx], ha_open_.data()[idx], ha_close}));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 1;
    }

    [[nodiscard]] const Line<double>& ha_open() const noexcept { return ha_open_; }
    [[nodiscard]] const Line<double>& ha_high() const noexcept { return ha_high_; }
    [[nodiscard]] const Line<double>& ha_low() const noexcept { return ha_low_; }
    [[nodiscard]] const Line<double>& ha_close() const noexcept { return line_; }

private:
    const Line<double>& open_;
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    Line<double> ha_open_;
    Line<double> ha_high_;
    Line<double> ha_low_;
};

} // namespace nonabt
