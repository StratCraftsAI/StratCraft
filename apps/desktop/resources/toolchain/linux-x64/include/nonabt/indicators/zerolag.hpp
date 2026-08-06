#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Ehlers/Way zero-lag error-correcting moving average.
class ZeroLagIndicator : public Indicator {
public:
    explicit ZeroLagIndicator(const Line<double>& source,
                              std::size_t period = 20,
                              int gainlimit = 50)
        : source_(source)
        , period_(period)
        , gainlimit_(gainlimit)
        , alpha_(2.0 / (static_cast<double>(period) + 1.0))
        , alpha1_(1.0 - alpha_) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();

        if (idx + 1 < period_) {
            line_.forward(nan);
            return;
        }

        if (!ema_initialized_) {
            ema_prev_ = seed_sma(idx);
            ema_initialized_ = true;
            line_.forward(ema_prev_);
            ec_prev_ = ema_prev_;
            return;
        }

        ema_prev_ = ((source_.data()[idx] - ema_prev_) * alpha_) + ema_prev_;

        double least_error = std::numeric_limits<double>::max();
        double best_ec = ema_prev_;
        const double price = source_.data()[idx];
        const double ec1 = ec_prev_;

        for (int step = -gainlimit_; step <= gainlimit_; ++step) {
            const double gain = static_cast<double>(step) / 10.0;
            const double ec = alpha_ * (ema_prev_ + gain * (price - ec1)) + alpha1_ * ec1;
            const double error = std::fabs(price - ec);
            if (error < least_error) {
                least_error = error;
                best_ec = ec;
            }
        }

        line_.forward(best_ec);
        ec_prev_ = best_ec;
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

private:
    [[nodiscard]] double seed_sma(std::size_t idx) const noexcept {
        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += source_.data()[idx - i];
        }
        return sum / static_cast<double>(period_);
    }

    const Line<double>& source_;
    std::size_t period_;
    int gainlimit_;
    double alpha_;
    double alpha1_;
    double ema_prev_ = 0.0;
    double ec_prev_ = 0.0;
    bool ema_initialized_ = false;
};

using ZLIndicator = ZeroLagIndicator;
using ZLInd = ZeroLagIndicator;
using EC = ZeroLagIndicator;
using ErrorCorrecting = ZeroLagIndicator;

} // namespace nonabt
