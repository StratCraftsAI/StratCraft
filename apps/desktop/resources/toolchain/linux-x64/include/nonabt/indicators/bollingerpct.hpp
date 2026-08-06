#pragma once

#include <stratforge/indicators/bollinger.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Bollinger Bands extended with the %B line.
class BollingerBandsPct : public Indicator {
public:
    explicit BollingerBandsPct(const Line<double>& source, std::size_t period = 20, double devfactor = 2.0)
        : source_(source), bands_(source, period, devfactor) {}

    void next() override {
        bands_.next();

        const double mid = bands_.mid().data().back();
        const double top = bands_.top().data().back();
        const double bot = bands_.bottom().data().back();

        line_.forward(mid);
        top_.forward(top);
        bottom_.forward(bot);

        if (std::isnan(mid) || std::isnan(top) || std::isnan(bot)) {
            pctb_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        pctb_.forward((source_.data()[source_.index()] - bot) / (top - bot));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return bands_.minimum_period();
    }

    [[nodiscard]] const Line<double>& mid() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& top() const noexcept { return top_; }
    [[nodiscard]] const Line<double>& bot() const noexcept { return bottom_; }
    [[nodiscard]] const Line<double>& bottom() const noexcept { return bottom_; }
    [[nodiscard]] const Line<double>& pctb() const noexcept { return pctb_; }

private:
    const Line<double>& source_;
    BollingerBands bands_;
    Line<double> top_;
    Line<double> bottom_;
    Line<double> pctb_;
};

using BBandsPct = BollingerBandsPct;

} // namespace nonabt
