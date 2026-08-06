#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// William Blau's True Strength Indicator.
class TrueStrengthIndicator : public Indicator {
public:
    explicit TrueStrengthIndicator(const Line<double>& source,
                                   std::size_t period1 = 25,
                                   std::size_t period2 = 13,
                                   std::size_t pchange = 1)
        : source_(source)
        , period1_(period1 == 0 ? 1 : period1)
        , period2_(period2 == 0 ? 1 : period2)
        , pchange_(pchange == 0 ? 1 : pchange)
        , alpha1_(2.0 / (static_cast<double>(period1_) + 1.0))
        , alpha2_(2.0 / (static_cast<double>(period2_) + 1.0)) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (idx < pchange_) {
            price_change_.forward(nan);
            abs_price_change_.forward(nan);
            ema_pc_1_.forward(nan);
            ema_abs_1_.forward(nan);
            ema_pc_2_.forward(nan);
            ema_abs_2_.forward(nan);
            line_.forward(nan);
            return;
        }

        const double pc = source_.data()[idx] - source_.data()[idx - pchange_];
        price_change_.forward(pc);
        abs_price_change_.forward(std::abs(pc));

        const double sm1 = next_ema(price_change_, period1_, alpha1_, pc1_initialized_, pc1_prev_);
        const double sm2 = next_ema(abs_price_change_, period1_, alpha1_, abs1_initialized_, abs1_prev_);
        ema_pc_1_.forward(sm1);
        ema_abs_1_.forward(sm2);

        const double sm12 = next_ema(ema_pc_1_, period2_, alpha2_, pc2_initialized_, pc2_prev_);
        const double sm22 = next_ema(ema_abs_1_, period2_, alpha2_, abs2_initialized_, abs2_prev_);
        ema_pc_2_.forward(sm12);
        ema_abs_2_.forward(sm22);

        if (std::isnan(sm12) || std::isnan(sm22) || sm22 == 0.0) {
            line_.forward(nan);
            return;
        }

        line_.forward(100.0 * (sm12 / sm22));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return pchange_ + period1_ + period2_ - 1;
    }

private:
    [[nodiscard]] static double next_ema(const Line<double>& source,
                                         std::size_t period,
                                         double alpha,
                                         bool& initialized,
                                         double& prev) noexcept {
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (source.size() < period) {
            return nan;
        }

        const auto idx = source.index();
        if (!initialized) {
            double sum = 0.0;
            for (std::size_t i = 0; i < period; ++i) {
                const double value = source.data()[idx - i];
                if (std::isnan(value)) {
                    return nan;
                }
                sum += value;
            }
            prev = sum / static_cast<double>(period);
            initialized = true;
            return prev;
        }

        const double current = source.data()[idx];
        if (std::isnan(current)) {
            return nan;
        }

        prev = ((current - prev) * alpha) + prev;
        return prev;
    }

    const Line<double>& source_;
    std::size_t period1_;
    std::size_t period2_;
    std::size_t pchange_;
    double alpha1_;
    double alpha2_;
    Line<double> price_change_;
    Line<double> abs_price_change_;
    Line<double> ema_pc_1_;
    Line<double> ema_abs_1_;
    Line<double> ema_pc_2_;
    Line<double> ema_abs_2_;
    bool pc1_initialized_ = false;
    bool abs1_initialized_ = false;
    bool pc2_initialized_ = false;
    bool abs2_initialized_ = false;
    double pc1_prev_ = 0.0;
    double abs1_prev_ = 0.0;
    double pc2_prev_ = 0.0;
    double abs2_prev_ = 0.0;
};

using TSI = TrueStrengthIndicator;

} // namespace nonabt
