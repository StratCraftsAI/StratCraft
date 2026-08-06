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
#include <stratforge/indicators/zerolag.hpp>
#include <stratforge/indicators/zlema.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Envelope around the source line itself.
class Envelope : public Indicator {
public:
    explicit Envelope(const Line<double>& source, double perc = 2.5)
        : source_(source), factor_(perc / 100.0) {}

    void next() override {
        const double value = source_.data()[source_.index()];
        line_.forward(value);
        top_.forward(value * (1.0 + factor_));
        bottom_.forward(value * (1.0 - factor_));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 1;
    }

    [[nodiscard]] const Line<double>& src() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& top() const noexcept { return top_; }
    [[nodiscard]] const Line<double>& bot() const noexcept { return bottom_; }
    [[nodiscard]] const Line<double>& bottom() const noexcept { return bottom_; }

private:
    const Line<double>& source_;
    double factor_;
    Line<double> top_;
    Line<double> bottom_;
};

template <typename MovingAverageType>
class MovingAverageEnvelope : public Indicator {
public:
    explicit MovingAverageEnvelope(const Line<double>& source,
                                   std::size_t period = 30,
                                   double perc = 2.5)
        : average_(source, period), factor_(perc / 100.0) {}

    void next() override {
        average_.next();

        const double value = average_.line().data().back();
        line_.forward(value);
        if (std::isnan(value)) {
            const double nan = std::numeric_limits<double>::quiet_NaN();
            top_.forward(nan);
            bottom_.forward(nan);
            return;
        }

        top_.forward(value * (1.0 + factor_));
        bottom_.forward(value * (1.0 - factor_));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return average_.minimum_period();
    }

    [[nodiscard]] const Line<double>& src() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& top() const noexcept { return top_; }
    [[nodiscard]] const Line<double>& bot() const noexcept { return bottom_; }
    [[nodiscard]] const Line<double>& bottom() const noexcept { return bottom_; }

private:
    MovingAverageType average_;
    double factor_;
    Line<double> top_;
    Line<double> bottom_;
};

using SMAEnvelope = MovingAverageEnvelope<SMA>;
using SimpleMovingAverageEnvelope = SMAEnvelope;
using MovingAverageSimpleEnvelope = SMAEnvelope;

using EMAEnvelope = MovingAverageEnvelope<EMA>;
using ExponentialMovingAverageEnvelope = EMAEnvelope;
using MovingAverageExponentialEnvelope = EMAEnvelope;

using SMMAEnvelope = MovingAverageEnvelope<SMMA>;
using SmoothedMovingAverageEnvelope = SMMAEnvelope;
using ModifiedMovingAverageEnvelope = SMMAEnvelope;
using WilderMAEnvelope = SMMAEnvelope;
using MovingAverageSmoothedEnvelope = SMMAEnvelope;
using MovingAverageWilderEnvelope = SMMAEnvelope;

using WMAEnvelope = MovingAverageEnvelope<WMA>;
using WeightedMovingAverageEnvelope = WMAEnvelope;
using MovingAverageWeightedEnvelope = WMAEnvelope;

using HMAEnvelope = MovingAverageEnvelope<HMA>;
using HullMAEnvelope = HMAEnvelope;
using HullMovingAverageEnvelope = HMAEnvelope;

using DEMAEnvelope = MovingAverageEnvelope<DEMA>;
using DoubleExponentialMovingAverageEnvelope = DEMAEnvelope;
using MovingAverageDoubleExponentialEnvelope = DEMAEnvelope;

using TEMAEnvelope = MovingAverageEnvelope<TEMA>;
using TripleExponentialMovingAverageEnvelope = TEMAEnvelope;
using MovingAverageTripleExponentialEnvelope = TEMAEnvelope;

class KAMAEnvelope : public Indicator {
public:
    explicit KAMAEnvelope(const Line<double>& source,
                          std::size_t period = 30,
                          std::size_t fast = 2,
                          std::size_t slow = 30,
                          double perc = 2.5)
        : average_(source, period, fast, slow), factor_(perc / 100.0) {}

    void next() override {
        average_.next();

        const double value = average_.line().data().back();
        line_.forward(value);
        if (std::isnan(value)) {
            const double nan = std::numeric_limits<double>::quiet_NaN();
            top_.forward(nan);
            bottom_.forward(nan);
            return;
        }

        top_.forward(value * (1.0 + factor_));
        bottom_.forward(value * (1.0 - factor_));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return average_.minimum_period();
    }

    [[nodiscard]] const Line<double>& src() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& top() const noexcept { return top_; }
    [[nodiscard]] const Line<double>& bot() const noexcept { return bottom_; }
    [[nodiscard]] const Line<double>& bottom() const noexcept { return bottom_; }

private:
    KAMA average_;
    double factor_;
    Line<double> top_;
    Line<double> bottom_;
};

using AdaptiveMovingAverageEnvelope = KAMAEnvelope;
using MovingAverageAdaptiveEnvelope = KAMAEnvelope;

class DMAEnvelope : public Indicator {
public:
    explicit DMAEnvelope(const Line<double>& source,
                         std::size_t period = 20,
                         int gainlimit = 50,
                         std::size_t hperiod = 7,
                         double perc = 2.5)
        : average_(source, period, gainlimit, hperiod), factor_(perc / 100.0) {}

    void next() override {
        average_.next();

        const double value = average_.line().data().back();
        line_.forward(value);
        if (std::isnan(value)) {
            const double nan = std::numeric_limits<double>::quiet_NaN();
            top_.forward(nan);
            bottom_.forward(nan);
            return;
        }

        top_.forward(value * (1.0 + factor_));
        bottom_.forward(value * (1.0 - factor_));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return average_.minimum_period();
    }

    [[nodiscard]] const Line<double>& src() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& top() const noexcept { return top_; }
    [[nodiscard]] const Line<double>& bot() const noexcept { return bottom_; }
    [[nodiscard]] const Line<double>& bottom() const noexcept { return bottom_; }

private:
    DMA average_;
    double factor_;
    Line<double> top_;
    Line<double> bottom_;
};

using DicksonMAEnvelope = DMAEnvelope;
using DicksonMovingAverageEnvelope = DMAEnvelope;

using ZLEMAEnvelope = MovingAverageEnvelope<ZLEMA>;
using ZeroLagEmaEnvelope = ZLEMAEnvelope;
using ZeroLagExponentialMovingAverageEnvelope = ZLEMAEnvelope;

/// ZeroLagIndicator + percentage bands envelope.
class ZLIndicatorEnvelope : public Indicator {
public:
    explicit ZLIndicatorEnvelope(const Line<double>& source,
                                  std::size_t period = 20,
                                  int gainlimit = 50,
                                  double perc = 2.5)
        : average_(source, period, gainlimit), factor_(perc / 100.0) {}

    void next() override {
        average_.next();

        const double value = average_.line().data().back();
        line_.forward(value);
        if (std::isnan(value)) {
            const double nan = std::numeric_limits<double>::quiet_NaN();
            top_.forward(nan);
            bottom_.forward(nan);
            return;
        }

        top_.forward(value * (1.0 + factor_));
        bottom_.forward(value * (1.0 - factor_));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return average_.minimum_period();
    }

    [[nodiscard]] const Line<double>& src() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& top() const noexcept { return top_; }
    [[nodiscard]] const Line<double>& bot() const noexcept { return bottom_; }
    [[nodiscard]] const Line<double>& bottom() const noexcept { return bottom_; }

private:
    ZeroLagIndicator average_;
    double factor_;
    Line<double> top_;
    Line<double> bottom_;
};

using ZeroLagIndicatorEnvelope = ZLIndicatorEnvelope;

} // namespace nonabt
