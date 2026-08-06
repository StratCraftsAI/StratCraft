#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>
#include <vector>

namespace nonabt {

class HurstExponent : public Indicator {
public:
    explicit HurstExponent(const Line<double>& source,
                           std::size_t period = 40,
                           std::size_t lag_start = 2,
                           std::size_t lag_end = 0)
        : source_(source)
        , period_(period == 0 ? 1 : period)
        , lag_start_(lag_start)
        , lag_end_(lag_end == 0 ? (period_ / 2) : lag_end) {}

    void next() override {
        const std::size_t idx = source_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        if (idx + 1 < period_ || lag_end_ <= lag_start_) {
            line_.forward(nan);
            return;
        }

        std::vector<double> x_vals;
        std::vector<double> y_vals;
        x_vals.reserve(lag_end_ - lag_start_);
        y_vals.reserve(lag_end_ - lag_start_);

        for (std::size_t lag = lag_start_; lag < lag_end_; ++lag) {
            std::vector<double> diffs;
            diffs.reserve(period_ - lag);
            for (std::size_t i = period_ - 1; i >= lag; --i) {
                diffs.push_back(source_.data()[idx - i + lag] - source_.data()[idx - i]);
                if (i == lag) {
                    break;
                }
            }

            const double std = population_stddev(diffs);
            if (std <= 0.0) {
                continue;
            }

            x_vals.push_back(std::log10(static_cast<double>(lag)));
            y_vals.push_back(std::log10(std::sqrt(std)));
        }

        if (x_vals.size() < 2) {
            line_.forward(nan);
            return;
        }

        const auto [slope, intercept] = linear_regression(x_vals, y_vals);
        static_cast<void>(intercept);
        line_.forward(slope * 2.0);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept {
        return period_;
    }

private:
    static double population_stddev(const std::vector<double>& values) noexcept {
        if (values.empty()) {
            return 0.0;
        }

        double sum = 0.0;
        for (double value : values) {
            sum += value;
        }
        const double mean = sum / static_cast<double>(values.size());

        double variance_sum = 0.0;
        for (double value : values) {
            const double delta = value - mean;
            variance_sum += delta * delta;
        }
        return std::sqrt(variance_sum / static_cast<double>(values.size()));
    }

    static std::pair<double, double> linear_regression(const std::vector<double>& x,
                                                       const std::vector<double>& y) noexcept {
        const std::size_t n = x.size();
        double sum_x = 0.0;
        double sum_y = 0.0;
        for (std::size_t i = 0; i < n; ++i) {
            sum_x += x[i];
            sum_y += y[i];
        }
        const double mean_x = sum_x / static_cast<double>(n);
        const double mean_y = sum_y / static_cast<double>(n);

        double sxx = 0.0;
        double sxy = 0.0;
        for (std::size_t i = 0; i < n; ++i) {
            const double dx = x[i] - mean_x;
            sxx += dx * dx;
            sxy += dx * (y[i] - mean_y);
        }

        const double slope = sxx == 0.0 ? 0.0 : (sxy / sxx);
        return {slope, mean_y - (slope * mean_x)};
    }

    const Line<double>& source_;
    std::size_t period_;
    std::size_t lag_start_;
    std::size_t lag_end_;
};

using Hurst = HurstExponent;

} // namespace nonabt
