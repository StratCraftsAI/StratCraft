#pragma once

#include <stratforge/broker/trade.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>
#include <span>
#include <utility>
#include <vector>

namespace nonabt {

struct ExtendedMetricsConfig {
    double initial_capital = 0.0;
    double risk_free_rate = 0.0;
    std::size_t trading_days_per_year = 252;
    double value_at_risk_quantile = 0.05;
};

struct ExtendedPerformanceMetrics {
    double annualized_return = 0.0;
    double cagr = 0.0;
    double volatility = 0.0;
    double sortino_ratio = 0.0;
    double calmar_ratio = 0.0;
    double profit_factor = 0.0;
    double expectancy = 0.0;
    double value_at_risk95 = 0.0;
    double max_drawdown = 0.0;
    std::size_t total_trades = 0;
    std::size_t winning_trades = 0;
    std::size_t losing_trades = 0;
    double win_rate = 0.0;
    double average_win = 0.0;
    double average_loss = 0.0;
};

class ExtendedMetricsCalculator {
public:
    static ExtendedPerformanceMetrics compute(std::span<const double> equity_curve,
                                              std::span<const double> trade_pnls,
                                              ExtendedMetricsConfig config = {}) {
        ExtendedPerformanceMetrics metrics;
        if (equity_curve.empty()) {
            return metrics;
        }

        const double initial_capital =
            config.initial_capital > 0.0 ? config.initial_capital : equity_curve.front();

        const auto returns = calculate_returns(equity_curve);
        metrics.annualized_return = calculate_annualized_return_percent(
            initial_capital, equity_curve.back(), equity_curve.size(), config.trading_days_per_year);
        metrics.cagr = calculate_cagr_percent(
            initial_capital, equity_curve.back(), equity_curve.size(), config.trading_days_per_year);
        metrics.max_drawdown = calculate_max_drawdown_percent(equity_curve);
        metrics.volatility = calculate_volatility_percent(returns, config.trading_days_per_year);
        metrics.sortino_ratio = calculate_sortino_ratio(
            returns, config.risk_free_rate, config.trading_days_per_year);
        metrics.calmar_ratio =
            metrics.max_drawdown > 0.0 ? (metrics.cagr / metrics.max_drawdown) : 0.0;
        metrics.value_at_risk95 = calculate_value_at_risk_percent(
            returns, config.value_at_risk_quantile);

        metrics.total_trades = trade_pnls.size();
        double total_wins = 0.0;
        double total_losses = 0.0;
        for (double pnl : trade_pnls) {
            if (pnl > 0.0) {
                ++metrics.winning_trades;
                total_wins += pnl;
            } else if (pnl < 0.0) {
                ++metrics.losing_trades;
                total_losses += -pnl;
            }
        }

        if (metrics.total_trades > 0) {
            metrics.win_rate =
                static_cast<double>(metrics.winning_trades) /
                static_cast<double>(metrics.total_trades) * 100.0;
        }
        if (metrics.winning_trades > 0) {
            metrics.average_win = total_wins / static_cast<double>(metrics.winning_trades);
        }
        if (metrics.losing_trades > 0) {
            metrics.average_loss = total_losses / static_cast<double>(metrics.losing_trades);
        }

        metrics.profit_factor =
            total_losses > 0.0 ? (total_wins / total_losses)
                               : (total_wins > 0.0 ? std::numeric_limits<double>::infinity() : 0.0);

        const double win_rate_decimal = metrics.win_rate / 100.0;
        metrics.expectancy =
            (win_rate_decimal * metrics.average_win) -
            ((1.0 - win_rate_decimal) * metrics.average_loss);

        return metrics;
    }

    static ExtendedPerformanceMetrics compute(
        std::span<const double> equity_curve,
        std::span<const std::pair<Trade, double>> closed_trades,
        ExtendedMetricsConfig config = {}) {
        std::vector<double> trade_pnls;
        trade_pnls.reserve(closed_trades.size());
        for (const auto& [trade, original_size] : closed_trades) {
            trade_pnls.push_back(trade.closed_pnl(original_size));
        }
        return compute(equity_curve, trade_pnls, config);
    }

private:
    static std::vector<double> calculate_returns(std::span<const double> equity_curve) {
        std::vector<double> returns;
        if (equity_curve.size() < 2) {
            return returns;
        }

        returns.reserve(equity_curve.size() - 1);
        for (std::size_t i = 1; i < equity_curve.size(); ++i) {
            const double prev_equity = equity_curve[i - 1];
            const double curr_equity = equity_curve[i];
            if (prev_equity > 0.0) {
                returns.push_back((curr_equity - prev_equity) / prev_equity);
            }
        }

        return returns;
    }

    static double mean(std::span<const double> values) {
        if (values.empty()) {
            return 0.0;
        }

        double sum = 0.0;
        for (double value : values) {
            sum += value;
        }
        return sum / static_cast<double>(values.size());
    }

    static double standard_deviation(std::span<const double> values) {
        if (values.size() < 2) {
            return 0.0;
        }

        const double avg = mean(values);
        double square_diff_sum = 0.0;
        for (double value : values) {
            const double diff = value - avg;
            square_diff_sum += diff * diff;
        }
        return std::sqrt(square_diff_sum / static_cast<double>(values.size()));
    }

    static double calculate_annualized_return_percent(double initial_capital, double final_equity,
                                                      std::size_t bars,
                                                      std::size_t trading_days_per_year) {
        if (initial_capital <= 0.0) {
            return 0.0;
        }

        const double total_return_percent = (final_equity - initial_capital) / initial_capital * 100.0;
        if (bars < 2 || trading_days_per_year == 0) {
            return total_return_percent;
        }

        const double years_elapsed =
            static_cast<double>(bars - 1) / static_cast<double>(trading_days_per_year);
        return years_elapsed > 0.0 ? (total_return_percent / years_elapsed) : total_return_percent;
    }

    static double calculate_cagr_percent(double initial_capital, double final_equity,
                                         std::size_t bars,
                                         std::size_t trading_days_per_year) {
        if (initial_capital <= 0.0 || final_equity <= 0.0 || bars == 0 || trading_days_per_year == 0) {
            return 0.0;
        }

        const double exponent =
            static_cast<double>(trading_days_per_year) / static_cast<double>(bars);
        return (std::pow(final_equity / initial_capital, exponent) - 1.0) * 100.0;
    }

    static double calculate_max_drawdown_percent(std::span<const double> equity_curve) {
        if (equity_curve.empty()) {
            return 0.0;
        }

        double peak = equity_curve.front();
        double max_drawdown = 0.0;
        for (double equity : equity_curve) {
            peak = std::max(peak, equity);
            if (peak > 0.0) {
                max_drawdown = std::max(max_drawdown, (peak - equity) / peak * 100.0);
            }
        }
        return max_drawdown;
    }

    static double calculate_volatility_percent(std::span<const double> returns,
                                               std::size_t trading_days_per_year) {
        if (returns.empty() || trading_days_per_year == 0) {
            return 0.0;
        }

        return standard_deviation(returns) *
               std::sqrt(static_cast<double>(trading_days_per_year)) * 100.0;
    }

    static double calculate_sortino_ratio(std::span<const double> returns, double risk_free_rate,
                                          std::size_t trading_days_per_year) {
        if (returns.empty() || trading_days_per_year == 0) {
            return 0.0;
        }

        const double annualized_mean_return = mean(returns) * static_cast<double>(trading_days_per_year);
        const double daily_risk_free = risk_free_rate / static_cast<double>(trading_days_per_year);

        std::vector<double> downside_returns;
        downside_returns.reserve(returns.size());
        for (double value : returns) {
            if (value < daily_risk_free) {
                downside_returns.push_back(value);
            }
        }

        if (downside_returns.size() < 2) {
            return 0.0;
        }

        const double downside_deviation =
            standard_deviation(downside_returns) *
            std::sqrt(static_cast<double>(trading_days_per_year));
        if (downside_deviation <= 0.0) {
            return 0.0;
        }

        return (annualized_mean_return - risk_free_rate) / downside_deviation;
    }

    static double calculate_value_at_risk_percent(std::span<const double> returns, double quantile) {
        if (returns.empty()) {
            return 0.0;
        }

        std::vector<double> sorted_returns(returns.begin(), returns.end());
        std::sort(sorted_returns.begin(), sorted_returns.end());

        const double clamped_quantile = std::clamp(quantile, 0.0, 1.0);
        const double position =
            clamped_quantile * static_cast<double>(sorted_returns.size() - 1);
        const auto lower_index = static_cast<std::size_t>(std::floor(position));
        const auto upper_index = static_cast<std::size_t>(std::ceil(position));

        double quantile_value = sorted_returns[lower_index];
        if (upper_index != lower_index) {
            const double weight = position - static_cast<double>(lower_index);
            quantile_value +=
                (sorted_returns[upper_index] - sorted_returns[lower_index]) * weight;
        }

        return std::max(0.0, -quantile_value * 100.0);
    }
};

} // namespace nonabt
