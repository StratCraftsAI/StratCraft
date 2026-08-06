#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cstddef>
#include <limits>

namespace nonabt {

/// MACD with macd, signal, and histogram lines.
class MACD : public Indicator {
public:
    explicit MACD(const Line<double>& source,
                  std::size_t fast_period = 12,
                  std::size_t slow_period = 26,
                  std::size_t signal_period = 9)
        : source_(source)
        , fast_period_(fast_period)
        , slow_period_(slow_period)
        , signal_period_(signal_period)
        , fast_multiplier_(2.0 / (static_cast<double>(fast_period) + 1.0))
        , slow_multiplier_(2.0 / (static_cast<double>(slow_period) + 1.0))
        , signal_multiplier_(2.0 / (static_cast<double>(signal_period) + 1.0)) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();

        if (idx + 1 < fast_period_) {
            fast_ema_.forward(nan);
        } else if (!fast_initialized_) {
            fast_prev_ema_ = seed_sma(idx, fast_period_);
            fast_initialized_ = true;
            fast_ema_.forward(fast_prev_ema_);
        } else {
            fast_prev_ema_ = advance_ema(source_.data()[idx], fast_prev_ema_, fast_multiplier_);
            fast_ema_.forward(fast_prev_ema_);
        }

        if (idx + 1 < slow_period_) {
            slow_ema_.forward(nan);
            line_.forward(nan);
            signal_.forward(nan);
            histogram_.forward(nan);
            return;
        }

        if (!slow_initialized_) {
            slow_prev_ema_ = seed_sma(idx, slow_period_);
            slow_initialized_ = true;
            slow_ema_.forward(slow_prev_ema_);
        } else {
            slow_prev_ema_ = advance_ema(source_.data()[idx], slow_prev_ema_, slow_multiplier_);
            slow_ema_.forward(slow_prev_ema_);
        }

        const double macd_value = fast_prev_ema_ - slow_prev_ema_;
        line_.forward(macd_value);

        macd_valid_count_++;
        if (macd_valid_count_ < signal_period_) {
            signal_.forward(nan);
            histogram_.forward(nan);
            return;
        }

        if (!signal_initialized_) {
            double signal_sum = 0.0;
            for (std::size_t i = 0; i < signal_period_; ++i) {
                signal_sum += line_.data()[idx - i];
            }
            signal_prev_ema_ = signal_sum / static_cast<double>(signal_period_);
            signal_initialized_ = true;
        } else {
            signal_prev_ema_ = advance_ema(macd_value, signal_prev_ema_, signal_multiplier_);
        }

        signal_.forward(signal_prev_ema_);
        histogram_.forward(macd_value - signal_prev_ema_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return slow_period_ + signal_period_ - 1;
    }

    [[nodiscard]] const Line<double>& macd() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& signal() const noexcept { return signal_; }
    [[nodiscard]] const Line<double>& histogram() const noexcept { return histogram_; }

private:
    [[nodiscard]] double seed_sma(std::size_t idx, std::size_t period) const noexcept {
        double sum = 0.0;
        for (std::size_t i = 0; i < period; ++i) {
            sum += source_.data()[idx - i];
        }
        return sum / static_cast<double>(period);
    }

    [[nodiscard]] static double advance_ema(double current, double prev, double multiplier) noexcept {
        return (current - prev) * multiplier + prev;
    }

    const Line<double>& source_;
    std::size_t fast_period_;
    std::size_t slow_period_;
    std::size_t signal_period_;
    double fast_multiplier_;
    double slow_multiplier_;
    double signal_multiplier_;
    Line<double> fast_ema_;
    Line<double> slow_ema_;
    Line<double> signal_;
    Line<double> histogram_;
    double fast_prev_ema_ = 0.0;
    double slow_prev_ema_ = 0.0;
    double signal_prev_ema_ = 0.0;
    std::size_t macd_valid_count_ = 0;
    bool fast_initialized_ = false;
    bool slow_initialized_ = false;
    bool signal_initialized_ = false;
};

/// MACD Histogram wrapper with backtrader-compatible histo naming.
class MACDHisto : public MACD {
public:
    using MACD::MACD;

    [[nodiscard]] const Line<double>& histo() const noexcept {
        return histogram();
    }
};

} // namespace nonabt
