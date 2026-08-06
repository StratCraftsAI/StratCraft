#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Triple exponential moving average rate of change.
class Trix : public Indicator {
public:
    explicit Trix(const Line<double>& source, std::size_t period = 15, std::size_t rocperiod = 1)
        : source_(source)
        , period_(period)
        , rocperiod_(rocperiod)
        , multiplier_(2.0 / (static_cast<double>(period) + 1.0)) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();

        if (idx + 1 < period_) {
            line_.forward(nan);
            ema1_.forward(nan);
            ema2_.forward(nan);
            ema3_.forward(nan);
            return;
        }

        if (!ema1_initialized_) {
            ema1_prev_ = seed_sma_source(idx);
            ema1_initialized_ = true;
        } else {
            ema1_prev_ = advance_ema(source_.data()[idx], ema1_prev_);
        }
        ema1_.forward(ema1_prev_);

        if (ema1_.size() < ((2 * period_) - 1)) {
            ema2_.forward(nan);
            ema3_.forward(nan);
            line_.forward(nan);
            return;
        }

        if (!ema2_initialized_) {
            ema2_prev_ = seed_sma(ema1_);
            ema2_initialized_ = true;
        } else {
            ema2_prev_ = advance_ema(ema1_prev_, ema2_prev_);
        }
        ema2_.forward(ema2_prev_);

        if (ema2_.size() < ((3 * period_) - 2)) {
            ema3_.forward(nan);
            line_.forward(nan);
            return;
        }

        if (!ema3_initialized_) {
            ema3_prev_ = seed_sma(ema2_);
            ema3_initialized_ = true;
        } else {
            ema3_prev_ = advance_ema(ema2_prev_, ema3_prev_);
        }
        ema3_.forward(ema3_prev_);

        if (ema3_.size() <= rocperiod_) {
            line_.forward(nan);
            return;
        }

        const double previous = ema3_.data()[ema3_.size() - 1 - rocperiod_];
        line_.forward(100.0 * ((ema3_prev_ / previous) - 1.0));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return (3 * period_) - 2 + rocperiod_;
    }

private:
    [[nodiscard]] double seed_sma_source(std::size_t idx) const noexcept {
        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += source_.data()[idx - i];
        }
        return sum / static_cast<double>(period_);
    }

    [[nodiscard]] double seed_sma(const Line<double>& line) const noexcept {
        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += line.data()[line.size() - 1 - i];
        }
        return sum / static_cast<double>(period_);
    }

    [[nodiscard]] double advance_ema(double value, double previous) const noexcept {
        return ((value - previous) * multiplier_) + previous;
    }

    const Line<double>& source_;
    std::size_t period_;
    std::size_t rocperiod_;
    double multiplier_;
    Line<double> ema1_;
    Line<double> ema2_;
    Line<double> ema3_;
    double ema1_prev_ = 0.0;
    double ema2_prev_ = 0.0;
    double ema3_prev_ = 0.0;
    bool ema1_initialized_ = false;
    bool ema2_initialized_ = false;
    bool ema3_initialized_ = false;
};

using TRIX = Trix;

class TrixSignal : public Trix {
public:
    explicit TrixSignal(const Line<double>& source,
                        std::size_t period = 15,
                        std::size_t rocperiod = 1,
                        std::size_t sigperiod = 9)
        : Trix(source, period, rocperiod)
        , sigperiod_(sigperiod)
        , signal_multiplier_(2.0 / (static_cast<double>(sigperiod) + 1.0)) {}

    void next() override {
        Trix::next();

        const double nan = std::numeric_limits<double>::quiet_NaN();
        const double current = line().data().back();
        if (std::isnan(current)) {
            signal_.forward(nan);
            return;
        }

        valid_trix_.forward(current);
        if (valid_trix_.size() < sigperiod_) {
            signal_.forward(nan);
            return;
        }

        if (!signal_initialized_) {
            double sum = 0.0;
            for (std::size_t i = 0; i < sigperiod_; ++i) {
                sum += valid_trix_.data()[valid_trix_.size() - sigperiod_ + i];
            }
            signal_previous_ = sum / static_cast<double>(sigperiod_);
            signal_initialized_ = true;
            signal_.forward(signal_previous_);
            return;
        }

        signal_previous_ =
            ((current - signal_previous_) * signal_multiplier_) + signal_previous_;
        signal_.forward(signal_previous_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return Trix::minimum_period() + sigperiod_ - 1;
    }

    [[nodiscard]] const Line<double>& signal() const noexcept {
        return signal_;
    }

private:
    std::size_t sigperiod_;
    double signal_multiplier_;
    Line<double> valid_trix_;
    Line<double> signal_;
    double signal_previous_ = 0.0;
    bool signal_initialized_ = false;
};

using TRIXSignal = TrixSignal;

} // namespace nonabt
