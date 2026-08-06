#pragma once

#include <stratforge/indicators/ema.hpp>
#include <stratforge/indicators/indicator.hpp>
#include <stratforge/indicators/momentum.hpp>
#include <stratforge/indicators/weightedaverage.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Chande Momentum Oscillator.
class ChandeMomentumOscillator : public Indicator {
public:
    explicit ChandeMomentumOscillator(const Line<double>& source, std::size_t period = 14)
        : source_(source), period_(period == 0 ? 1 : period) {}

    void next() override {
        const auto idx = source_.index();
        if (idx < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        double up_sum = 0.0;
        double down_sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            const double delta = source_.data()[idx - i] - source_.data()[idx - i - 1];
            if (delta > 0.0) {
                up_sum += delta;
            } else {
                down_sum -= delta;
            }
        }

        const double denominator = up_sum + down_sum;
        line_.forward(denominator == 0.0 ? 0.0 : (100.0 * (up_sum - down_sum) / denominator));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + 1;
    }

private:
    const Line<double>& source_;
    std::size_t period_;
};

using CMO = ChandeMomentumOscillator;

/// Tillson T3 moving average.
class T3MovingAverage : public Indicator {
public:
    explicit T3MovingAverage(const Line<double>& source, std::size_t period = 5, double vfactor = 0.7)
        : source_(source)
        , period_(period == 0 ? 1 : period)
        , multiplier_(2.0 / (static_cast<double>(period_) + 1.0))
        , a_(vfactor) {}

    void next() override {
        const double e1 = advance_stage(source_.data()[source_.index()], 0);
        const double e2 = advance_stage(e1, 1);
        const double e3 = advance_stage(e2, 2);
        const double e4 = advance_stage(e3, 3);
        const double e5 = advance_stage(e4, 4);
        const double e6 = advance_stage(e5, 5);

        if (std::isnan(e3) || std::isnan(e4) || std::isnan(e5) || std::isnan(e6)) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const double c1 = -a_ * a_ * a_;
        const double c2 = 3.0 * a_ * a_ + 3.0 * a_ * a_ * a_;
        const double c3 = -6.0 * a_ * a_ - 3.0 * a_ - 3.0 * a_ * a_ * a_;
        const double c4 = 1.0 + 3.0 * a_ + 3.0 * a_ * a_ + a_ * a_ * a_;
        line_.forward((c1 * e6) + (c2 * e5) + (c3 * e4) + (c4 * e3));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return (6 * period_) - 5;
    }

private:
    [[nodiscard]] double advance_stage(double input, std::size_t stage) noexcept {
        if (std::isnan(input)) {
            return std::numeric_limits<double>::quiet_NaN();
        }

        if (!initialized_[stage]) {
            seed_sum_[stage] += input;
            ++seed_count_[stage];
            if (seed_count_[stage] < period_) {
                return std::numeric_limits<double>::quiet_NaN();
            }

            prev_[stage] = seed_sum_[stage] / static_cast<double>(period_);
            initialized_[stage] = true;
            return prev_[stage];
        }

        prev_[stage] = ((input - prev_[stage]) * multiplier_) + prev_[stage];
        return prev_[stage];
    }

    const Line<double>& source_;
    std::size_t period_;
    double multiplier_;
    double prev_[6] = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
    double seed_sum_[6] = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
    std::size_t seed_count_[6] = {0, 0, 0, 0, 0, 0};
    bool initialized_[6] = {false, false, false, false, false, false};
    double a_;
};

using T3 = T3MovingAverage;

/// Coppock Curve built from two long ROC terms and a WMA smoother.
class CoppockCurve : public Indicator {
public:
    explicit CoppockCurve(const Line<double>& source,
                          std::size_t period1 = 11,
                          std::size_t period2 = 14,
                          std::size_t wma_period = 10)
        : roc1_(source, period1), roc2_(source, period2), wma_(sum_line_, wma_period) {}

    void next() override {
        roc1_.next();
        roc2_.next();
        const double v1 = roc1_.line().data().back();
        const double v2 = roc2_.line().data().back();
        sum_line_.forward((std::isnan(v1) || std::isnan(v2)) ? std::numeric_limits<double>::quiet_NaN() : ((v1 + v2) * 100.0));
        wma_.next();
        line_.forward(wma_.line().data().back());
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return wma_.minimum_period();
    }

private:
    ROC roc1_;
    ROC roc2_;
    Line<double> sum_line_;
    WeightedAverage wma_;
};

using Coppock = CoppockCurve;

} // namespace nonabt
