#pragma once

#include <stratforge/analyzers/analyzer.hpp>

#include <cmath>
#include <limits>
#include <vector>

namespace nonabt {

/// Sharpe Ratio analyzer - computes annualized Sharpe ratio
class SharpeRatio : public Analyzer {
public:
    struct Analysis {
        double sharperatio = 0.0;
    };

    /// risk_free_rate: annualized risk-free rate (default 0)
    /// trading_days: number of trading days per year (default 252)
    explicit SharpeRatio(double risk_free_rate = 0.0, int trading_days = 252)
        : risk_free_rate_(risk_free_rate)
        , trading_days_(trading_days) {}

    void start() override {
        prev_value_ = 0.0;
        analysis_ = {};
        returns_.clear();
        initialized_ = false;
    }

    void next(const BackBroker& broker, const std::vector<DataFeed*>& feeds) override {
        const double value = broker.portfolio_value(feeds);

        if (!initialized_) {
            prev_value_ = broker.initial_cash();
            initialized_ = true;
        }

        if (prev_value_ > 0.0) {
            const double ret = (value - prev_value_) / prev_value_;
            returns_.push_back(ret);
        }

        prev_value_ = value;
    }

    void stop() override {
        if (returns_.size() < 2) {
            analysis_.sharperatio = 0.0;
            return;
        }

        const double factor = static_cast<double>(trading_days_);
        const double period_rf = std::pow(1.0 + risk_free_rate_, 1.0 / factor) - 1.0;

        double sum = 0.0;
        std::vector<double> excess_returns;
        excess_returns.reserve(returns_.size());
        for (double ret : returns_) {
            excess_returns.push_back(ret - period_rf);
            sum += excess_returns.back();
        }
        const double mean = sum / static_cast<double>(excess_returns.size());

        double sq_sum = 0.0;
        for (double ret : excess_returns) {
            const double diff = ret - mean;
            sq_sum += diff * diff;
        }
        const double stddev = std::sqrt(sq_sum / static_cast<double>(excess_returns.size()));

        if (stddev < 1e-10) {
            analysis_.sharperatio = 0.0;
            return;
        }

        analysis_.sharperatio = mean / stddev * std::sqrt(factor);
    }

    /// Get the computed Sharpe ratio
    [[nodiscard]] double value() const noexcept { return analysis_.sharperatio; }

    [[nodiscard]] const Analysis& get_analysis() const noexcept { return analysis_; }

    /// Get the daily returns
    [[nodiscard]] const std::vector<double>& returns() const noexcept { return returns_; }

private:
    double risk_free_rate_;
    int trading_days_;
    double prev_value_ = 0.0;
    Analysis analysis_{};
    std::vector<double> returns_;
    bool initialized_ = false;
};

} // namespace nonabt
