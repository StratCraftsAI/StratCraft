#pragma once

#include <stratforge/analyzers/analyzer.hpp>

#include <cmath>

namespace nonabt {

/// Returns analyzer - computes log total, average, and annualized returns
class Returns : public Analyzer {
public:
    struct Analysis {
        double rtot = 0.0;
        double ravg = 0.0;
        double rnorm = 0.0;
        double rnorm100 = 0.0;
    };

    explicit Returns(double annualization_factor = 252.0)
        : annualization_factor_(annualization_factor) {}

    void start() override {
        analysis_ = {};
        value_start_ = 0.0;
        value_end_ = 0.0;
        period_count_ = 0;
        initialized_ = false;
    }

    void next(const BackBroker& broker, const std::vector<DataFeed*>& feeds) override {
        const double value = broker.portfolio_value(feeds);
        if (!initialized_) {
            value_start_ = value;
            initialized_ = true;
        }
        value_end_ = value;
        ++period_count_;
    }

    void stop() override {
        if (!initialized_ || period_count_ == 0) {
            return;
        }

        if (value_start_ == 0.0) {
            analysis_.rtot = -std::numeric_limits<double>::infinity();
        } else {
            const double ratio = value_end_ / value_start_;
            analysis_.rtot = ratio < 0.0 ? -std::numeric_limits<double>::infinity() : std::log(ratio);
        }

        analysis_.ravg = analysis_.rtot / static_cast<double>(period_count_);
        if (analysis_.ravg > -std::numeric_limits<double>::infinity()) {
            analysis_.rnorm = std::expm1(analysis_.ravg * annualization_factor_);
        } else {
            analysis_.rnorm = analysis_.ravg;
        }
        analysis_.rnorm100 = analysis_.rnorm * 100.0;
    }

    [[nodiscard]] const Analysis& get_analysis() const noexcept { return analysis_; }

private:
    double annualization_factor_;
    Analysis analysis_{};
    double value_start_ = 0.0;
    double value_end_ = 0.0;
    std::size_t period_count_ = 0;
    bool initialized_ = false;
};

} // namespace nonabt
