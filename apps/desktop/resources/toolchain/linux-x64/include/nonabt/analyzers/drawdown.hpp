#pragma once

#include <stratforge/analyzers/analyzer.hpp>

#include <algorithm>
#include <cmath>
#include <vector>

namespace nonabt {

/// Drawdown analyzer - tracks maximum drawdown during backtest
class Drawdown : public Analyzer {
public:
    struct Analysis {
        std::size_t len = 0;
        double drawdown = 0.0;
        double moneydown = 0.0;

        struct Max {
            std::size_t len = 0;
            double drawdown = 0.0;
            double moneydown = 0.0;
        } max;
    };

    void start() override {
        peak_ = 0.0;
        analysis_ = {};
        drawdown_values_.clear();
    }

    void next(const BackBroker& broker, const std::vector<DataFeed*>& feeds) override {
        const double value = broker.portfolio_value(feeds);

        if (value > peak_) {
            peak_ = value;
        }

        const double moneydown = peak_ - value;
        const double drawdown = (peak_ > 0.0) ? (moneydown / peak_ * 100.0) : 0.0;

        drawdown_values_.push_back(moneydown);
        analysis_.moneydown = moneydown;
        analysis_.drawdown = drawdown;

        analysis_.max.moneydown = std::max(analysis_.max.moneydown, moneydown);
        analysis_.max.drawdown = std::max(analysis_.max.drawdown, drawdown);
        analysis_.len = drawdown > 0.0 ? (analysis_.len + 1U) : 0U;
        analysis_.max.len = std::max(analysis_.max.len, analysis_.len);
    }

    /// Maximum drawdown in absolute terms
    [[nodiscard]] double max_drawdown() const noexcept { return analysis_.max.moneydown; }

    /// Maximum drawdown as percentage
    [[nodiscard]] double max_drawdown_pct() const noexcept { return analysis_.max.drawdown; }

    /// Full analysis snapshot
    [[nodiscard]] const Analysis& get_analysis() const noexcept { return analysis_; }

    /// Drawdown values per bar
    [[nodiscard]] const std::vector<double>& values() const noexcept { return drawdown_values_; }

private:
    double peak_ = 0.0;
    Analysis analysis_{};
    std::vector<double> drawdown_values_;
};

using DrawDown = Drawdown;

} // namespace nonabt
