#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Fisher transform of a normalized median-price oscillator.
class FisherTransform : public Indicator {
public:
    FisherTransform(const Line<double>& high, const Line<double>& low, std::size_t period = 10)
        : high_(high), low_(low), period_(period == 0 ? 1 : period) {}

    void next() override {
        const auto idx = high_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (idx + 1 < period_) {
            value_.forward(nan);
            trigger_.forward(nan);
            line_.forward(nan);
            return;
        }

        double highest = high_.data()[idx];
        double lowest = low_.data()[idx];
        for (std::size_t i = 1; i < period_; ++i) {
            highest = std::max(highest, high_.data()[idx - i]);
            lowest = std::min(lowest, low_.data()[idx - i]);
        }

        const double median = (high_.data()[idx] + low_.data()[idx]) / 2.0;
        const double range = highest - lowest;
        double normalized = range == 0.0 ? 0.0 : (2.0 * ((median - lowest) / range) - 1.0);

        const double prev_value = value_.empty() || std::isnan(value_.data().back()) ? 0.0 : value_.data().back();
        normalized = std::clamp((0.33 * normalized) + (0.67 * prev_value), -0.999, 0.999);
        value_.forward(normalized);

        const double prev_fisher = line_.empty() || std::isnan(line_.data().back()) ? 0.0 : line_.data().back();
        const double fisher = (0.5 * std::log((1.0 + normalized) / (1.0 - normalized))) + (0.5 * prev_fisher);
        line_.forward(fisher);
        trigger_.forward(prev_fisher);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

    [[nodiscard]] const Line<double>& fisher() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& trigger() const noexcept { return trigger_; }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    std::size_t period_;
    Line<double> value_;
    Line<double> trigger_;
};

using Fisher = FisherTransform;

/// Bill Williams style 5-bar fractal pivots.
class Fractal : public Indicator {
public:
    Fractal(const Line<double>& high, const Line<double>& low)
        : high_(high), low_(low) {}

    void next() override {
        const auto idx = high_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        line_.forward(nan);
        down_fractal_.forward(nan);

        if (idx < 4) {
            return;
        }

        const std::size_t center = idx - 2;
        const double center_high = high_.data()[center];
        const double center_low = low_.data()[center];

        bool up = true;
        bool down = true;
        for (int offset = -2; offset <= 2; ++offset) {
            if (offset == 0) {
                continue;
            }
            const std::size_t pos = static_cast<std::size_t>(static_cast<long long>(center) + offset);
            up = up && (center_high > high_.data()[pos]);
            down = down && (center_low < low_.data()[pos]);
        }

        if (up) {
            line_.data()[center] = center_high;
        }
        if (down) {
            down_fractal_.data()[center] = center_low;
        }
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 5;
    }

    [[nodiscard]] const Line<double>& up_fractal() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& down_fractal() const noexcept { return down_fractal_; }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    Line<double> down_fractal_;
};

/// Percent-threshold ZigZag pivot detector with backfilled pivot values.
class ZigZag : public Indicator {
public:
    explicit ZigZag(const Line<double>& source, double retrace = 0.05)
        : source_(source), retrace_(retrace <= 0.0 ? 0.05 : retrace) {}

    void next() override {
        const auto idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        line_.forward(nan);

        const double price = source_.data()[idx];
        if (!initialized_) {
            pivot_idx_ = idx;
            pivot_price_ = price;
            candidate_idx_ = idx;
            candidate_price_ = price;
            initialized_ = true;
            return;
        }

        if (direction_ == 0) {
            const double change = relative_change(price, pivot_price_);
            if (std::fabs(change) >= retrace_) {
                direction_ = change > 0.0 ? 1 : -1;
                candidate_idx_ = idx;
                candidate_price_ = price;
            } else {
                if ((price > candidate_price_ && candidate_idx_ == pivot_idx_) || (price < candidate_price_ && candidate_idx_ == pivot_idx_)) {
                    candidate_idx_ = idx;
                    candidate_price_ = price;
                }
            }
            return;
        }

        if (direction_ > 0) {
            if (price >= candidate_price_) {
                candidate_idx_ = idx;
                candidate_price_ = price;
                return;
            }

            if (relative_change(price, candidate_price_) <= -retrace_) {
                line_.data()[candidate_idx_] = candidate_price_;
                pivot_idx_ = candidate_idx_;
                pivot_price_ = candidate_price_;
                direction_ = -1;
                candidate_idx_ = idx;
                candidate_price_ = price;
            }
            return;
        }

        if (price <= candidate_price_) {
            candidate_idx_ = idx;
            candidate_price_ = price;
            return;
        }

        if (relative_change(price, candidate_price_) >= retrace_) {
            line_.data()[candidate_idx_] = candidate_price_;
            pivot_idx_ = candidate_idx_;
            pivot_price_ = candidate_price_;
            direction_ = 1;
            candidate_idx_ = idx;
            candidate_price_ = price;
        }
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 2;
    }

private:
    [[nodiscard]] double relative_change(double current, double reference) const noexcept {
        if (reference == 0.0) {
            return 0.0;
        }
        return (current - reference) / std::fabs(reference);
    }

    const Line<double>& source_;
    double retrace_;
    bool initialized_ = false;
    int direction_ = 0;
    std::size_t pivot_idx_ = 0;
    double pivot_price_ = 0.0;
    std::size_t candidate_idx_ = 0;
    double candidate_price_ = 0.0;
};

} // namespace nonabt
