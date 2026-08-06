#pragma once

#include <stratforge/indicators/dema.hpp>
#include <stratforge/indicators/dma.hpp>
#include <stratforge/core/line.hpp>
#include <stratforge/indicators/ema.hpp>
#include <stratforge/indicators/hma.hpp>
#include <stratforge/indicators/indicator.hpp>
#include <stratforge/indicators/kama.hpp>
#include <stratforge/indicators/sma.hpp>
#include <stratforge/indicators/smma.hpp>
#include <stratforge/indicators/tema.hpp>
#include <stratforge/indicators/wma.hpp>
#include <stratforge/indicators/zlema.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Oscillation of one line around another.
class Oscillator : public Indicator {
public:
    explicit Oscillator(const Line<double>& source, const Line<double>& osc)
        : source_(source), osc_(osc) {}

    void next() override {
        const auto idx = std::min(source_.index(), osc_.index());
        line_.forward(source_.data()[idx] - osc_.data()[idx]);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 1;
    }

private:
    const Line<double>& source_;
    const Line<double>& osc_;
};

template <typename MovingAverageType>
class MovingAverageOscillator : public Indicator {
public:
    explicit MovingAverageOscillator(const Line<double>& source, std::size_t period = 30)
        : source_(source), average_(source, period) {}

    void next() override {
        average_.next();

        const double average = average_.line().data().back();
        if (std::isnan(average)) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(source_.data()[source_.index()] - average);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return average_.minimum_period();
    }

private:
    const Line<double>& source_;
    MovingAverageType average_;
};

using SMAOscillator = MovingAverageOscillator<SMA>;
using SimpleMovingAverageOscillator = SMAOscillator;
using MovingAverageSimpleOscillator = SMAOscillator;

using EMAOscillator = MovingAverageOscillator<EMA>;
using ExponentialMovingAverageOscillator = EMAOscillator;
using MovingAverageExponentialOscillator = EMAOscillator;

using SMMAOscillator = MovingAverageOscillator<SMMA>;
using SmoothedMovingAverageOscillator = SMMAOscillator;
using ModifiedMovingAverageOscillator = SMMAOscillator;
using WilderMAOscillator = SMMAOscillator;
using MovingAverageSmoothedOscillator = SMMAOscillator;
using MovingAverageWilderOscillator = SMMAOscillator;

using WMAOscillator = MovingAverageOscillator<WMA>;
using WeightedMovingAverageOscillator = WMAOscillator;
using MovingAverageWeightedOscillator = WMAOscillator;

using HMAOscillator = MovingAverageOscillator<HMA>;
using HullMAOscillator = HMAOscillator;
using HullMovingAverageOscillator = HMAOscillator;

using DEMAOscillator = MovingAverageOscillator<DEMA>;
using DoubleExponentialMovingAverageOscillator = DEMAOscillator;
using MovingAverageDoubleExponentialOscillator = DEMAOscillator;

using TEMAOscillator = MovingAverageOscillator<TEMA>;
using TripleExponentialMovingAverageOscillator = TEMAOscillator;
using MovingAverageTripleExponentialOscillator = TEMAOscillator;

class KAMAOscillator : public Indicator {
public:
    explicit KAMAOscillator(const Line<double>& source,
                            std::size_t period = 30,
                            std::size_t fast = 2,
                            std::size_t slow = 30)
        : source_(source), average_(source, period, fast, slow) {}

    void next() override {
        average_.next();

        const double average = average_.line().data().back();
        if (std::isnan(average)) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(source_.data()[source_.index()] - average);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return average_.minimum_period();
    }

private:
    const Line<double>& source_;
    KAMA average_;
};

using AdaptiveMovingAverageOscillator = KAMAOscillator;
using MovingAverageAdaptiveOscillator = KAMAOscillator;

class DMAOscillator : public Indicator {
public:
    explicit DMAOscillator(const Line<double>& source,
                           std::size_t period = 20,
                           int gainlimit = 50,
                           std::size_t hperiod = 7)
        : source_(source), average_(source, period, gainlimit, hperiod) {}

    void next() override {
        average_.next();

        const double average = average_.line().data().back();
        if (std::isnan(average)) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(source_.data()[source_.index()] - average);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return average_.minimum_period();
    }

private:
    const Line<double>& source_;
    DMA average_;
};

using DicksonMAOscillator = DMAOscillator;
using DicksonMovingAverageOscillator = DMAOscillator;

using ZLEMAOscillator = MovingAverageOscillator<ZLEMA>;
using ZeroLagEmaOscillator = ZLEMAOscillator;
using ZeroLagExponentialMovingAverageOscillator = ZLEMAOscillator;

/// EMA-based price oscillator (APO).
class PriceOscillator : public Indicator {
public:
    explicit PriceOscillator(const Line<double>& source,
                             std::size_t period1 = 12,
                             std::size_t period2 = 26)
        : fast_(source, period1), slow_(source, period2) {}

    void next() override {
        fast_.next();
        slow_.next();

        const double fast = fast_.line().data().back();
        const double slow = slow_.line().data().back();
        if (std::isnan(fast) || std::isnan(slow)) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(fast - slow);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return std::max(fast_.minimum_period(), slow_.minimum_period());
    }

    [[nodiscard]] const Line<double>& po() const noexcept { return line_; }

private:
    EMA fast_;
    EMA slow_;
};

using PriceOsc = PriceOscillator;
using AbsolutePriceOscillator = PriceOscillator;
using APO = PriceOscillator;
using AbsPriceOsc = PriceOscillator;

/// Percentage price oscillator (PPO) with signal and histogram lines.
class PercentagePriceOscillator : public Indicator {
public:
    explicit PercentagePriceOscillator(const Line<double>& source,
                                       std::size_t period1 = 12,
                                       std::size_t period2 = 26,
                                       std::size_t period_signal = 9)
        : fast_(source, period1)
        , slow_(source, period2)
        , signal_period_(period_signal)
        , signal_multiplier_(2.0 / (static_cast<double>(period_signal) + 1.0)) {}

    void next() override {
        fast_.next();
        slow_.next();

        const double fast = fast_.line().data().back();
        const double slow = slow_.line().data().back();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (std::isnan(fast) || std::isnan(slow)) {
            line_.forward(nan);
            signal_.forward(nan);
            histogram_.forward(nan);
            return;
        }

        const double ppo = 100.0 * ((fast - slow) / denominator(fast, slow));
        line_.forward(ppo);

        valid_count_++;
        if (valid_count_ < signal_period_) {
            signal_.forward(nan);
            histogram_.forward(nan);
            return;
        }

        if (!signal_initialized_) {
            double sum = 0.0;
            for (std::size_t i = 0; i < signal_period_; ++i) {
                sum += line_.data()[line_.size() - 1 - i];
            }
            signal_prev_ = sum / static_cast<double>(signal_period_);
            signal_initialized_ = true;
        } else {
            signal_prev_ = ((ppo - signal_prev_) * signal_multiplier_) + signal_prev_;
        }

        signal_.forward(signal_prev_);
        histogram_.forward(ppo - signal_prev_);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return std::max(fast_.minimum_period(), slow_.minimum_period()) + signal_period_ - 1;
    }

    [[nodiscard]] const Line<double>& ppo() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& signal() const noexcept { return signal_; }
    [[nodiscard]] const Line<double>& histo() const noexcept { return histogram_; }
    [[nodiscard]] const Line<double>& histogram() const noexcept { return histogram_; }

protected:
    [[nodiscard]] virtual double denominator(double fast, double slow) const noexcept {
        static_cast<void>(fast);
        return slow;
    }

private:
    EMA fast_;
    EMA slow_;
    std::size_t signal_period_;
    double signal_multiplier_;
    Line<double> signal_;
    Line<double> histogram_;
    double signal_prev_ = 0.0;
    std::size_t valid_count_ = 0;
    bool signal_initialized_ = false;
};

using PPO = PercentagePriceOscillator;
using PercPriceOsc = PercentagePriceOscillator;

/// PPO variant using the short EMA as denominator.
class PercentagePriceOscillatorShort : public PercentagePriceOscillator {
public:
    using PercentagePriceOscillator::PercentagePriceOscillator;

protected:
    [[nodiscard]] double denominator(double fast, double slow) const noexcept override {
        static_cast<void>(slow);
        return fast;
    }
};

using PPOShort = PercentagePriceOscillatorShort;
using PercPriceOscShort = PercentagePriceOscillatorShort;

} // namespace nonabt
