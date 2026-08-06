#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Chaikin Accumulation/Distribution line.
class AccumulationDistribution : public Indicator {
public:
    AccumulationDistribution(const Line<double>& high,
                             const Line<double>& low,
                             const Line<double>& close,
                             const Line<double>& volume)
        : high_(high), low_(low), close_(close), volume_(volume) {}

    void next() override {
        const auto idx = close_.index();
        const double high = high_.data()[idx];
        const double low = low_.data()[idx];
        const double close = close_.data()[idx];
        const double volume = volume_.data()[idx];

        double money_flow_multiplier = 0.0;
        const double range = high - low;
        if (range != 0.0) {
            money_flow_multiplier = ((close - low) - (high - close)) / range;
        }

        const double mfv = money_flow_multiplier * volume;
        if (idx == 0) {
            line_.forward(mfv);
            return;
        }

        line_.forward(line_.data()[idx - 1] + mfv);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 1;
    }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    const Line<double>& volume_;
};

using AD = AccumulationDistribution;
using AccDist = AccumulationDistribution;

/// Price Volume Trend.
class PriceVolumeTrend : public Indicator {
public:
    PriceVolumeTrend(const Line<double>& close, const Line<double>& volume)
        : close_(close), volume_(volume) {}

    void next() override {
        const auto idx = close_.index();
        if (idx == 0) {
            line_.forward(0.0);
            return;
        }

        const double prev_close = close_.data()[idx - 1];
        const double delta = prev_close == 0.0 ? 0.0 : ((close_.data()[idx] - prev_close) / prev_close);
        line_.forward(line_.data()[idx - 1] + (volume_.data()[idx] * delta));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 2;
    }

private:
    const Line<double>& close_;
    const Line<double>& volume_;
};

using PVT = PriceVolumeTrend;

/// Cumulative volume weighted average price using the typical price.
class VolumeWeightedAveragePrice : public Indicator {
public:
    VolumeWeightedAveragePrice(const Line<double>& high,
                               const Line<double>& low,
                               const Line<double>& close,
                               const Line<double>& volume)
        : high_(high), low_(low), close_(close), volume_(volume) {}

    void next() override {
        const auto idx = close_.index();
        const double typical_price = (high_.data()[idx] + low_.data()[idx] + close_.data()[idx]) / 3.0;

        cumulative_price_volume_ += typical_price * volume_.data()[idx];
        cumulative_volume_ += volume_.data()[idx];

        if (cumulative_volume_ == 0.0) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(cumulative_price_volume_ / cumulative_volume_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 1;
    }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    const Line<double>& volume_;
    double cumulative_price_volume_ = 0.0;
    double cumulative_volume_ = 0.0;
};

using VWAP = VolumeWeightedAveragePrice;

/// Chaikin Money Flow over a trailing window.
class ChaikinMoneyFlow : public Indicator {
public:
    ChaikinMoneyFlow(const Line<double>& high,
                     const Line<double>& low,
                     const Line<double>& close,
                     const Line<double>& volume,
                     std::size_t period = 20)
        : high_(high), low_(low), close_(close), volume_(volume), period_(period == 0 ? 1 : period) {}

    void next() override {
        const auto idx = close_.index();
        if (idx + 1 < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        double flow_sum = 0.0;
        double volume_sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            const std::size_t pos = idx - i;
            const double high = high_.data()[pos];
            const double low = low_.data()[pos];
            const double close = close_.data()[pos];
            const double volume = volume_.data()[pos];
            const double range = high - low;
            const double multiplier = range == 0.0 ? 0.0 : (((close - low) - (high - close)) / range);
            flow_sum += multiplier * volume;
            volume_sum += volume;
        }

        line_.forward(volume_sum == 0.0 ? 0.0 : (flow_sum / volume_sum));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    const Line<double>& volume_;
    std::size_t period_;
};

using CMF = ChaikinMoneyFlow;

/// Money Flow Index.
class MoneyFlowIndex : public Indicator {
public:
    MoneyFlowIndex(const Line<double>& high,
                   const Line<double>& low,
                   const Line<double>& close,
                   const Line<double>& volume,
                   std::size_t period = 14)
        : high_(high), low_(low), close_(close), volume_(volume), period_(period == 0 ? 1 : period) {}

    void next() override {
        const auto idx = close_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (idx == 0) {
            positive_flow_.forward(0.0);
            negative_flow_.forward(0.0);
            line_.forward(nan);
            return;
        }

        const double typical = typical_price(idx);
        const double previous_typical = typical_price(idx - 1);
        const double raw_flow = typical * volume_.data()[idx];

        positive_flow_.forward(typical > previous_typical ? raw_flow : 0.0);
        negative_flow_.forward(typical < previous_typical ? raw_flow : 0.0);

        if (idx < period_) {
            line_.forward(nan);
            return;
        }

        double positive_sum = 0.0;
        double negative_sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            positive_sum += positive_flow_.data()[positive_flow_.size() - 1 - i];
            negative_sum += negative_flow_.data()[negative_flow_.size() - 1 - i];
        }

        if (negative_sum == 0.0) {
            line_.forward(100.0);
            return;
        }

        const double money_ratio = positive_sum / negative_sum;
        line_.forward(100.0 - (100.0 / (1.0 + money_ratio)));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + 1;
    }

private:
    [[nodiscard]] double typical_price(std::size_t idx) const noexcept {
        return (high_.data()[idx] + low_.data()[idx] + close_.data()[idx]) / 3.0;
    }

    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    const Line<double>& volume_;
    std::size_t period_;
    Line<double> positive_flow_;
    Line<double> negative_flow_;
};

using MFI = MoneyFlowIndex;

/// Ease of Movement with SMA smoothing.
class EaseOfMovement : public Indicator {
public:
    EaseOfMovement(const Line<double>& high,
                   const Line<double>& low,
                   const Line<double>& volume,
                   std::size_t period = 14,
                   double divisor = 10000.0)
        : high_(high), low_(low), volume_(volume), period_(period == 0 ? 1 : period), divisor_(divisor) {}

    void next() override {
        const auto idx = high_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (idx == 0) {
            raw_.forward(nan);
            line_.forward(nan);
            return;
        }

        const double midpoint_move =
            ((high_.data()[idx] + low_.data()[idx]) / 2.0) - ((high_.data()[idx - 1] + low_.data()[idx - 1]) / 2.0);
        const double range = high_.data()[idx] - low_.data()[idx];
        const double volume_box = volume_.data()[idx] / divisor_;
        const double raw = (range == 0.0 || volume_box == 0.0) ? 0.0 : (midpoint_move * range / volume_box);
        raw_.forward(raw);

        if (raw_.size() < period_ + 1) {
            line_.forward(nan);
            return;
        }

        double sum = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum += raw_.data()[raw_.size() - 1 - i];
        }
        line_.forward(sum / static_cast<double>(period_));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + 1;
    }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& volume_;
    std::size_t period_;
    double divisor_;
    Line<double> raw_;
};

using EMV = EaseOfMovement;

/// Klinger volume oscillator with signal line.
class KlingerOscillator : public Indicator {
public:
    KlingerOscillator(const Line<double>& high,
                      const Line<double>& low,
                      const Line<double>& close,
                      const Line<double>& volume,
                      std::size_t fast_period = 34,
                      std::size_t slow_period = 55,
                      std::size_t signal_period = 13)
        : high_(high)
        , low_(low)
        , close_(close)
        , volume_(volume)
        , fast_period_(fast_period == 0 ? 1 : fast_period)
        , slow_period_(slow_period == 0 ? 1 : slow_period)
        , signal_period_(signal_period == 0 ? 1 : signal_period)
        , fast_alpha_(2.0 / (static_cast<double>(fast_period_) + 1.0))
        , slow_alpha_(2.0 / (static_cast<double>(slow_period_) + 1.0))
        , signal_alpha_(2.0 / (static_cast<double>(signal_period_) + 1.0)) {}

    void next() override {
        const auto idx = close_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (idx == 0) {
            trend_ = 0;
            prev_dm_ = high_.data()[idx] - low_.data()[idx];
            prev_cm_ = prev_dm_;
            line_.forward(nan);
            signal_.forward(nan);
            return;
        }

        const double hlc3 = high_.data()[idx] + low_.data()[idx] + close_.data()[idx];
        const double prev_hlc3 = high_.data()[idx - 1] + low_.data()[idx - 1] + close_.data()[idx - 1];
        const int current_trend = hlc3 > prev_hlc3 ? 1 : (hlc3 < prev_hlc3 ? -1 : trend_);

        const double dm = high_.data()[idx] - low_.data()[idx];
        const double cm = (current_trend == trend_) ? (prev_cm_ + dm) : (prev_dm_ + dm);
        const double ratio = cm == 0.0 ? 0.0 : std::fabs(2.0 * ((dm / cm) - 1.0));
        const double vf = volume_.data()[idx] * ratio * static_cast<double>(current_trend) * 100.0;

        if (!fast_initialized_) {
            fast_ema_ = vf;
            slow_ema_ = vf;
            fast_initialized_ = true;
            line_.forward(nan);
            signal_.forward(nan);
        } else {
            fast_ema_ += fast_alpha_ * (vf - fast_ema_);
            slow_ema_ += slow_alpha_ * (vf - slow_ema_);
            const double kvo = fast_ema_ - slow_ema_;
            line_.forward(kvo);

            if (!signal_initialized_) {
                signal_ema_ = kvo;
                signal_initialized_ = true;
            } else {
                signal_ema_ += signal_alpha_ * (kvo - signal_ema_);
            }
            signal_.forward(signal_ema_);
        }

        trend_ = current_trend;
        prev_dm_ = dm;
        prev_cm_ = cm;
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 2;
    }

    [[nodiscard]] const Line<double>& kvo() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& signal() const noexcept { return signal_; }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    const Line<double>& volume_;
    std::size_t fast_period_;
    std::size_t slow_period_;
    std::size_t signal_period_;
    double fast_alpha_;
    double slow_alpha_;
    double signal_alpha_;
    int trend_ = 0;
    double prev_dm_ = 0.0;
    double prev_cm_ = 0.0;
    double fast_ema_ = 0.0;
    double slow_ema_ = 0.0;
    double signal_ema_ = 0.0;
    bool fast_initialized_ = false;
    bool signal_initialized_ = false;
    Line<double> signal_;
};

using Klinger = KlingerOscillator;

} // namespace nonabt
