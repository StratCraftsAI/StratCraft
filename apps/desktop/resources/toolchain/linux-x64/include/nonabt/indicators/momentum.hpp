#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Momentum: current price minus price N bars ago.
class Momentum : public Indicator {
public:
    explicit Momentum(const Line<double>& source, std::size_t period = 12)
        : source_(source), period_(period) {}

    void next() override {
        const auto idx = source_.index();
        if (idx < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(source_.data()[idx] - source_.data()[idx - period_]);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + 1;
    }

private:
    const Line<double>& source_;
    std::size_t period_;
};

/// Rate of change: percent change relative to N bars ago.
class ROC : public Indicator {
public:
    explicit ROC(const Line<double>& source, std::size_t period = 12)
        : source_(source), period_(period) {}

    void next() override {
        const auto idx = source_.index();
        if (idx < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const double previous = source_.data()[idx - period_];
        line_.forward((source_.data()[idx] - previous) / previous);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + 1;
    }

private:
    const Line<double>& source_;
    std::size_t period_;
};

/// Rate of change with base 100.
class ROC100 : public Indicator {
public:
    explicit ROC100(const Line<double>& source, std::size_t period = 12)
        : roc_(source, period) {}

    void next() override {
        roc_.next();
        const double value = roc_.line().data().back();
        line_.forward(std::isnan(value) ? value : (value * 100.0));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return roc_.minimum_period();
    }

private:
    ROC roc_;
};

/// Momentum oscillator expressed as 100 * current / previous-N.
class MomentumOscillator : public Indicator {
public:
    explicit MomentumOscillator(const Line<double>& source, std::size_t period = 12)
        : source_(source), period_(period) {}

    void next() override {
        const auto idx = source_.index();
        if (idx < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(100.0 * (source_.data()[idx] / source_.data()[idx - period_]));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + 1;
    }

private:
    const Line<double>& source_;
    std::size_t period_;
};

} // namespace nonabt
