#pragma once

#include <stratforge/analyzers/drawdown.hpp>
#include <stratforge/analyzers/sharpe_ratio.hpp>
#include <stratforge/analyzers/trade_analyzer.hpp>
#include <stratforge/analytics/extended_metrics.hpp>
#include <stratforge/broker/broker.hpp>
#include <stratforge/data/data_feed.hpp>
#include <stratforge/observers/cash_value.hpp>
#include <stratforge/serialization/json_writer.hpp>

#include <chrono>
#include <cstddef>
#include <string>
#include <vector>

namespace nonabt {

/// Serialization context holding references to all analyzers/observers.
/// The caller must attach the relevant components before calling serialize().
struct SerializationContext {
    const BackBroker* broker = nullptr;
    const std::vector<DataFeed*>* data_feeds = nullptr;

    // Analyzers (optional — null fields are omitted from output)
    const TradeAnalyzer* trade_analyzer = nullptr;
    const SharpeRatio* sharpe_ratio = nullptr;
    const Drawdown* drawdown = nullptr;

    // Observer (optional)
    const CashValue* cash_value = nullptr;

    // Metadata
    double initial_cash = 100000.0;
    std::size_t bars_processed = 0;
    int64_t execution_time_ms = 0;
    std::string symbol;
};

/// Serialize backtest results to JSON compatible with StratCraft ExecutorResult.
///
/// Output schema matches:
///   packages/executor/include/quantnexus/executor/result_types.hpp
///   apps/desktop/src/main/services/executor-service.ts
[[nodiscard]] inline std::string serialize_results(const SerializationContext& ctx) {
    JsonWriter w;
    w.begin_object();

    w.kv_bool("success", true);
    w.kv_string("errorMessage", "");

    // Timestamps from data feed
    int64_t start_time = 0;
    int64_t end_time = 0;
    if (ctx.data_feeds && !ctx.data_feeds->empty()) {
        const auto* feed = (*ctx.data_feeds)[0];
        if (feed->size() > 0) {
            const auto& dt_data = feed->datetime().data();
            if (!dt_data.empty()) {
                start_time = std::chrono::duration_cast<std::chrono::milliseconds>(
                    dt_data.front().time_since_epoch()).count();
                end_time = std::chrono::duration_cast<std::chrono::milliseconds>(
                    dt_data.back().time_since_epoch()).count();
            }
        }
    }
    w.kv_int("startTime", start_time);
    w.kv_int("endTime", end_time);
    w.kv_int("executionTimeMs", ctx.execution_time_ms);
    w.kv_int("executionCycles", 0);

    // --- metrics ---
    w.key("metrics");
    w.begin_object();
    {
        double total_pnl = 0.0;
        double total_return = 0.0;
        double sharpe = 0.0;
        double max_dd = 0.0;
        std::size_t total_trades = 0;
        std::size_t winning = 0;
        std::size_t losing = 0;
        double win_rate = 0.0;
        double avg_win = 0.0;
        double avg_loss = 0.0;
        double profit_factor = 0.0;

        if (ctx.trade_analyzer) {
            const auto& a = ctx.trade_analyzer->get_analysis();
            total_trades = a.total.closed;
            winning = a.won.total;
            losing = a.lost.total;
            total_pnl = a.pnl.net.total;
            win_rate = total_trades > 0
                ? static_cast<double>(winning) / static_cast<double>(total_trades)
                : 0.0;
            avg_win = a.won.pnl.average;
            avg_loss = a.lost.pnl.average;
            profit_factor = (a.lost.pnl.total < -1e-10)
                ? (a.won.pnl.total / -a.lost.pnl.total)
                : (a.won.pnl.total > 0.0 ? 1e9 : 0.0);
        }

        if (ctx.initial_cash > 0.0) {
            total_return = (total_pnl / ctx.initial_cash) * 100.0;
        }

        if (ctx.sharpe_ratio) {
            sharpe = ctx.sharpe_ratio->value();
        }

        if (ctx.drawdown) {
            max_dd = -ctx.drawdown->max_drawdown();
        }

        // Compute extended metrics from equity curve if cash_value observer is available
        double annualized_return = 0.0;
        double sortino = 0.0;
        double calmar = 0.0;
        double volatility = 0.0;
        double var95 = 0.0;
        double expectancy = 0.0;

        if (ctx.cash_value && ctx.cash_value->value().size() > 1 && ctx.trade_analyzer) {
            const auto& eq_data = ctx.cash_value->value().data();
            std::vector<double> trade_pnls;
            if (ctx.broker) {
                for (const auto& [trade, orig_size] : ctx.broker->closed_trades()) {
                    trade_pnls.push_back(trade.pnlcomm);
                }
            }
            ExtendedMetricsConfig cfg;
            cfg.initial_capital = ctx.initial_cash;
            auto ext = ExtendedMetricsCalculator::compute(eq_data, trade_pnls, cfg);
            annualized_return = ext.annualized_return;
            sortino = ext.sortino_ratio;
            calmar = ext.calmar_ratio;
            volatility = ext.volatility;
            var95 = ext.value_at_risk95;
            expectancy = ext.expectancy;
        }

        w.kv_double("totalPnl", total_pnl, 2);
        w.kv_double("totalReturn", total_return, 4);
        w.kv_double("annualizedReturn", annualized_return, 4);
        w.kv_double("sharpeRatio", sharpe, 4);
        w.kv_double("sortinoRatio", sortino, 4);
        w.kv_double("calmarRatio", calmar, 4);
        w.kv_double("maxDrawdown", max_dd, 2);
        w.kv_double("maxDrawdownDuration", ctx.drawdown
            ? static_cast<double>(ctx.drawdown->get_analysis().max.len) : 0.0, 0);
        w.kv_uint("totalTrades", total_trades);
        w.kv_uint("winningTrades", winning);
        w.kv_uint("losingTrades", losing);
        w.kv_double("winRate", win_rate, 4);
        w.kv_double("averageWin", avg_win, 2);
        w.kv_double("averageLoss", avg_loss, 2);
        w.kv_double("profitFactor", profit_factor, 4);
        w.kv_double("expectancy", expectancy, 2);
        w.kv_double("volatility", volatility, 4);
        w.kv_double("valueAtRisk95", var95, 2);
    }
    w.end_object();

    // --- equityCurve ---
    w.key("equityCurve");
    w.begin_array();
    if (ctx.cash_value && ctx.data_feeds && !ctx.data_feeds->empty()) {
        const auto& val_data = ctx.cash_value->value().data();
        const auto* feed = (*ctx.data_feeds)[0];
        const auto& dt_data = feed->datetime().data();
        double peak = 0.0;

        for (std::size_t i = 0; i < val_data.size() && i < dt_data.size(); ++i) {
            w.begin_object();
            auto ts = std::chrono::duration_cast<std::chrono::milliseconds>(
                dt_data[i].time_since_epoch()).count();
            w.kv_int("timestamp", ts);
            w.kv_double("equity", val_data[i], 2);

            if (val_data[i] > peak) peak = val_data[i];
            double dd = (peak > 0.0) ? (peak - val_data[i]) : 0.0;
            w.kv_double("drawdown", dd, 2);
            w.end_object();
        }
    }
    w.end_array();

    // --- trades ---
    w.key("trades");
    w.begin_array();
    if (ctx.broker && ctx.data_feeds && !ctx.data_feeds->empty()) {
        const auto* feed = (*ctx.data_feeds)[0];
        const auto& dt_data = feed->datetime().data();

        for (const auto& [trade, orig_size] : ctx.broker->closed_trades()) {
            w.begin_object();

            int64_t entry_ts = 0;
            int64_t exit_ts = 0;
            if (trade.entry_bar < dt_data.size()) {
                entry_ts = std::chrono::duration_cast<std::chrono::milliseconds>(
                    dt_data[trade.entry_bar].time_since_epoch()).count();
            }
            if (trade.exit_bar < dt_data.size()) {
                exit_ts = std::chrono::duration_cast<std::chrono::milliseconds>(
                    dt_data[trade.exit_bar].time_since_epoch()).count();
            }

            w.kv_int("entryTime", entry_ts);
            w.kv_int("exitTime", exit_ts);
            w.kv_string("symbol", ctx.symbol);
            w.kv_string("side", trade.islong ? "buy" : "sell");
            w.kv_double("entryPrice", trade.entry_price, 6);
            w.kv_double("exitPrice", trade.exit_price, 6);
            w.kv_double("quantity", std::abs(orig_size), 6);
            w.kv_double("pnl", trade.pnlcomm, 2);
            w.kv_double("commission", trade.commission, 4);
            w.kv_string("reason", "");
            w.end_object();
        }
    }
    w.end_array();

    // --- candles ---
    w.key("candles");
    w.begin_array();
    if (ctx.data_feeds && !ctx.data_feeds->empty()) {
        const auto* feed = (*ctx.data_feeds)[0];
        const auto& dt_data = feed->datetime().data();
        const auto& o_data = feed->open().data();
        const auto& h_data = feed->high().data();
        const auto& l_data = feed->low().data();
        const auto& c_data = feed->close().data();
        const auto& v_data = feed->volume().data();
        const std::size_t n = dt_data.size();

        for (std::size_t i = 0; i < n; ++i) {
            w.begin_object();
            auto ts = std::chrono::duration_cast<std::chrono::milliseconds>(
                dt_data[i].time_since_epoch()).count();
            w.kv_int("timestamp", ts);
            w.kv_double("open", i < o_data.size() ? o_data[i] : 0.0, 6);
            w.kv_double("high", i < h_data.size() ? h_data[i] : 0.0, 6);
            w.kv_double("low", i < l_data.size() ? l_data[i] : 0.0, 6);
            w.kv_double("close", i < c_data.size() ? c_data[i] : 0.0, 6);
            w.kv_double("volume", i < v_data.size() ? v_data[i] : 0.0, 0);
            w.end_object();
        }
    }
    w.end_array();

    // --- dryRunInfo (placeholder, not applicable for C++ strategies) ---
    w.key("dryRunInfo");
    w.begin_object();
    w.kv_bool("isDryRun", false);
    w.kv_uint("totalBars", ctx.bars_processed);
    w.kv_uint("totalLlmCalls", 0);
    w.key("llmCalls");
    w.begin_array();
    w.end_array();
    w.end_object();

    w.end_object();
    return w.str();
}

} // namespace nonabt
