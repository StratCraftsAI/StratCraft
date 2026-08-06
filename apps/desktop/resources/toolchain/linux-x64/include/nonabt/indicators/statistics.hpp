#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Pearson correlation over a trailing window.
class Correlation : public Indicator {
public:
    Correlation(const Line<double>& data0, const Line<double>& data1, std::size_t period = 20)
        : data0_(data0), data1_(data1), period_(period == 0 ? 1 : period) {}

    void next() override {
        const auto idx = data0_.index();
        if (idx + 1 < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        double sum_x = 0.0;
        double sum_y = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            sum_x += data0_.data()[idx - i];
            sum_y += data1_.data()[idx - i];
        }

        const double mean_x = sum_x / static_cast<double>(period_);
        const double mean_y = sum_y / static_cast<double>(period_);

        double covariance = 0.0;
        double var_x = 0.0;
        double var_y = 0.0;
        for (std::size_t i = 0; i < period_; ++i) {
            const double dx = data0_.data()[idx - i] - mean_x;
            const double dy = data1_.data()[idx - i] - mean_y;
            covariance += dx * dy;
            var_x += dx * dx;
            var_y += dy * dy;
        }

        const double denominator = std::sqrt(var_x * var_y);
        if (denominator == 0.0) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(covariance / denominator);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

private:
    const Line<double>& data0_;
    const Line<double>& data1_;
    std::size_t period_;
};

using Correl = Correlation;

/// Coefficient of determination from the trailing Pearson correlation.
class RSquared : public Indicator {
public:
    RSquared(const Line<double>& data0, const Line<double>& data1, std::size_t period = 20)
        : correlation_(data0, data1, period) {}

    void next() override {
        correlation_.next();
        const double corr = correlation_.line().data().back();
        if (std::isnan(corr)) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(corr * corr);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return correlation_.minimum_period();
    }

private:
    Correlation correlation_;
};

} // namespace nonabt
