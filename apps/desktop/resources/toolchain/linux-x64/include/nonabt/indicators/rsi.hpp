#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

enum class RsiMovAv {
    Smoothed,
    Simple,
    Exponential,
};

/// Relative Strength Index indicator
class RSI : public Indicator {
public:
    explicit RSI(const Line<double>& source,
                 std::size_t period = 14,
                 RsiMovAv movav = RsiMovAv::Smoothed,
                 bool safediv = false,
                 double safehigh = 100.0,
                 double safelow = 50.0,
                 std::size_t lookback = 1)
        : source_(source)
        , period_(period == 0 ? 1 : period)
        , movav_(movav)
        , safediv_(safediv)
        , safehigh_(safehigh)
        , safelow_(safelow)
        , lookback_(lookback == 0 ? 1 : lookback)
        , ema_alpha_(2.0 / (1.0 + static_cast<double>(period_))) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();

        if (idx < lookback_) {
            line_.forward(nan);
            return;
        }

        const double change = source_.data()[idx] - source_.data()[idx - lookback_];
        const double gain = std::max(change, 0.0);
        const double loss = std::max(-change, 0.0);

        gains_.forward(gain);
        losses_.forward(loss);

        if (gains_.size() < period_) {
            line_.forward(nan);
            return;
        }

        if (!initialized_) {
            avg_gain_ = seed_average(gains_);
            avg_loss_ = seed_average(losses_);
            initialized_ = true;
        } else if (movav_ == RsiMovAv::Smoothed) {
            const double period_d = static_cast<double>(period_);
            avg_gain_ = (avg_gain_ * (period_d - 1.0) + gain) / period_d;
            avg_loss_ = (avg_loss_ * (period_d - 1.0) + loss) / period_d;
        } else if (movav_ == RsiMovAv::Exponential) {
            avg_gain_ = (avg_gain_ * (1.0 - ema_alpha_)) + (gain * ema_alpha_);
            avg_loss_ = (avg_loss_ * (1.0 - ema_alpha_)) + (loss * ema_alpha_);
        } else {
            avg_gain_ = seed_average(gains_);
            avg_loss_ = seed_average(losses_);
        }

        if (!safediv_) {
            if (avg_loss_ == 0.0) {
                if (avg_gain_ == 0.0) {
                    line_.forward(nan);
                } else {
                    line_.forward(100.0);
                }
                return;
            }

            const double rs = avg_gain_ / avg_loss_;
            line_.forward(100.0 - (100.0 / (1.0 + rs)));
            return;
        }

        if (avg_loss_ == 0.0) {
            const double rs = avg_gain_ == 0.0 ? rs_from_rsi(safelow_) : rs_from_rsi(safehigh_);
            if (std::isinf(rs)) {
                line_.forward(100.0);
            } else {
                line_.forward(100.0 - (100.0 / (1.0 + rs)));
            }
        } else {
            const double rs = avg_gain_ / avg_loss_;
            line_.forward(100.0 - (100.0 / (1.0 + rs)));
        }
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + lookback_;
    }

    [[nodiscard]] std::size_t period() const noexcept { return period_; }
    [[nodiscard]] std::size_t lookback() const noexcept { return lookback_; }

protected:
    [[nodiscard]] static double rs_from_rsi(double rsi) noexcept {
        if (rsi == 100.0) {
            return std::numeric_limits<double>::infinity();
        }

        return (-100.0 / (rsi - 100.0)) - 1.0;
    }

    [[nodiscard]] double seed_average(const Line<double>& line) const noexcept {
        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += line.data()[line.size() - period_ + i];
        }
        return sum / static_cast<double>(period_);
    }

private:
    const Line<double>& source_;
    std::size_t period_;
    RsiMovAv movav_;
    bool safediv_;
    double safehigh_;
    double safelow_;
    std::size_t lookback_;
    double ema_alpha_;
    Line<double> gains_;
    Line<double> losses_;
    double avg_gain_ = 0.0;
    double avg_loss_ = 0.0;
    bool initialized_ = false;
};

class RSI_Safe : public RSI {
public:
    explicit RSI_Safe(const Line<double>& source,
                      std::size_t period = 14,
                      RsiMovAv movav = RsiMovAv::Smoothed,
                      double safehigh = 100.0,
                      double safelow = 50.0,
                      std::size_t lookback = 1)
        : RSI(source, period, movav, true, safehigh, safelow, lookback) {}
};

class RSI_SMA : public RSI {
public:
    explicit RSI_SMA(const Line<double>& source,
                     std::size_t period = 14,
                     bool safediv = false,
                     double safehigh = 100.0,
                     double safelow = 50.0,
                     std::size_t lookback = 1)
        : RSI(source, period, RsiMovAv::Simple, safediv, safehigh, safelow, lookback) {}
};

class RSI_EMA : public RSI {
public:
    explicit RSI_EMA(const Line<double>& source,
                     std::size_t period = 14,
                     bool safediv = false,
                     double safehigh = 100.0,
                     double safelow = 50.0,
                     std::size_t lookback = 1)
        : RSI(source, period, RsiMovAv::Exponential, safediv, safehigh, safelow, lookback) {}
};

class RelativeMomentumIndex : public RSI {
public:
    explicit RelativeMomentumIndex(const Line<double>& source,
                                   std::size_t period = 20,
                                   std::size_t lookback = 5)
        : RSI(source, period, RsiMovAv::Smoothed, false, 100.0, 50.0, lookback) {}
};

using RMI = RelativeMomentumIndex;

} // namespace nonabt
