#pragma once

#include <stratforge/analyzers/analyzer.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Trade Analyzer - collects trade statistics
class TradeAnalyzer : public Analyzer {
public:
    struct Analysis {
        struct Total {
            std::size_t total = 0;
            std::size_t open = 0;
            std::size_t closed = 0;
        };

        struct Streak {
            std::size_t current = 0;
            std::size_t longest = 0;
        };

        struct PnlSummary {
            double total = 0.0;
            double average = 0.0;
            double max = 0.0;
        };

        struct PnlStats {
            PnlSummary gross;
            PnlSummary net;
        };

        struct WonLost {
            std::size_t total = 0;
            PnlSummary pnl;
        };

        struct Directional {
            std::size_t total = 0;
            std::size_t won = 0;
            std::size_t lost = 0;
            struct {
                double total = 0.0;
                double average = 0.0;
                PnlSummary won;
                PnlSummary lost;
            } pnl;
        };

        struct LengthStats {
            std::size_t total = 0;
            double average = 0.0;
            std::size_t max = 0;
            std::size_t min = 0;
        };

        struct DirectionalLength {
            LengthStats total_stats;
            LengthStats won;
            LengthStats lost;
        };

        Total total;
        struct {
            Streak won;
            Streak lost;
        } streak;
        PnlStats pnl;
        WonLost won;
        WonLost lost;
        Directional long_side;
        Directional short_side;
        struct {
            LengthStats total_stats;
            LengthStats won;
            LengthStats lost;
            DirectionalLength long_side;
            DirectionalLength short_side;
        } len;
    };

    void start() override {
        analysis_ = {};
        last_broker_ = nullptr;
    }

    void next(const BackBroker& broker, const std::vector<DataFeed*>&) override {
        last_broker_ = &broker;
    }

    void stop() override {
        if (last_broker_ != nullptr) {
            analyze(*last_broker_);
        }
    }

    /// Analyze trades from a broker
    void analyze(const BackBroker& broker) {
        analysis_ = {};
        analysis_.total.open = broker.open_trades().size();
        analysis_.total.closed = broker.closed_trades().size();
        analysis_.total.total = analysis_.total.open + analysis_.total.closed;
        analysis_.len.total_stats.min = 0;
        analysis_.len.long_side.total_stats.min = 0;
        analysis_.len.short_side.total_stats.min = 0;

        bool have_won_trade = false;
        bool have_lost_trade = false;
        bool have_long_trade = false;
        bool have_short_trade = false;
        bool have_long_won_trade = false;
        bool have_long_lost_trade = false;
        bool have_short_won_trade = false;
        bool have_short_lost_trade = false;

        for (const auto& [trade, orig_size] : broker.closed_trades()) {
            const double gross_pnl = trade.pnl;
            const double net_pnl = trade.closed_pnl(orig_size);
            const bool won = net_pnl >= 0.0;
            const bool is_long = trade.islong;

            analysis_.pnl.gross.total += gross_pnl;
            analysis_.pnl.net.total += net_pnl;

            if (won) {
                ++analysis_.won.total;
                ++analysis_.streak.won.current;
                analysis_.streak.lost.current = 0;
                analysis_.won.pnl.total += net_pnl;
                analysis_.won.pnl.max = have_won_trade ? std::max(analysis_.won.pnl.max, net_pnl) : net_pnl;
                have_won_trade = true;
            } else {
                ++analysis_.lost.total;
                ++analysis_.streak.lost.current;
                analysis_.streak.won.current = 0;
                analysis_.lost.pnl.total += net_pnl;
                analysis_.lost.pnl.max = have_lost_trade ? std::min(analysis_.lost.pnl.max, net_pnl) : net_pnl;
                have_lost_trade = true;
            }

            analysis_.streak.won.longest = std::max(analysis_.streak.won.longest, analysis_.streak.won.current);
            analysis_.streak.lost.longest = std::max(analysis_.streak.lost.longest, analysis_.streak.lost.current);

            auto& side = is_long ? analysis_.long_side : analysis_.short_side;
            auto& side_len = is_long ? analysis_.len.long_side : analysis_.len.short_side;
            ++side.total;
            side.pnl.total += net_pnl;
            if (won) {
                ++side.won;
                side.pnl.won.total += net_pnl;
                side.pnl.won.max = (is_long ? have_long_won_trade : have_short_won_trade)
                    ? std::max(side.pnl.won.max, net_pnl)
                    : net_pnl;
            } else {
                ++side.lost;
                side.pnl.lost.total += net_pnl;
                side.pnl.lost.max = (is_long ? have_long_lost_trade : have_short_lost_trade)
                    ? std::min(side.pnl.lost.max, net_pnl)
                    : net_pnl;
            }

            if (is_long) {
                have_long_trade = true;
                have_long_won_trade = have_long_won_trade || won;
                have_long_lost_trade = have_long_lost_trade || !won;
            } else {
                have_short_trade = true;
                have_short_won_trade = have_short_won_trade || won;
                have_short_lost_trade = have_short_lost_trade || !won;
            }

            const std::size_t barlen = trade.barlen;
            update_length_summary(analysis_.len.total_stats, barlen);
            update_length_summary(won ? analysis_.len.won : analysis_.len.lost, barlen);
            update_length_summary(side_len.total_stats, barlen);
            update_length_summary(won ? side_len.won : side_len.lost, barlen);
        }

        const double closed = static_cast<double>(analysis_.total.closed);
        if (closed > 0.0) {
            analysis_.pnl.gross.average = analysis_.pnl.gross.total / closed;
            analysis_.pnl.net.average = analysis_.pnl.net.total / closed;
            analysis_.len.total_stats.average =
                static_cast<double>(analysis_.len.total_stats.total) / closed;
        }

        if (analysis_.won.total > 0) {
            analysis_.won.pnl.average =
                analysis_.won.pnl.total / static_cast<double>(analysis_.won.total);
            analysis_.len.won.average =
                static_cast<double>(analysis_.len.won.total) / static_cast<double>(analysis_.won.total);
        }

        if (analysis_.lost.total > 0) {
            analysis_.lost.pnl.average =
                analysis_.lost.pnl.total / static_cast<double>(analysis_.lost.total);
            analysis_.len.lost.average =
                static_cast<double>(analysis_.len.lost.total) / static_cast<double>(analysis_.lost.total);
        }

        finalize_directional(analysis_.long_side, analysis_.len.long_side, have_long_trade);
        finalize_directional(analysis_.short_side, analysis_.len.short_side, have_short_trade);

        if (!have_won_trade) {
            analysis_.won.pnl.max = 0.0;
        }
        if (!have_lost_trade) {
            analysis_.lost.pnl.max = 0.0;
        }
    }

    // --- Accessors ---

    [[nodiscard]] const Analysis& get_analysis() const noexcept { return analysis_; }

    [[nodiscard]] std::size_t total_trades() const noexcept { return analysis_.total.total; }
    [[nodiscard]] std::size_t won() const noexcept { return analysis_.won.total; }
    [[nodiscard]] std::size_t lost() const noexcept { return analysis_.lost.total; }
    [[nodiscard]] double total_pnl() const noexcept { return analysis_.pnl.net.total; }
    [[nodiscard]] double avg_pnl() const noexcept { return analysis_.pnl.net.average; }
    [[nodiscard]] double total_won() const noexcept { return analysis_.won.pnl.total; }
    [[nodiscard]] double total_lost() const noexcept { return analysis_.lost.pnl.total; }

    [[nodiscard]] double win_rate() const noexcept {
        if (analysis_.total.total == 0) return 0.0;
        return static_cast<double>(analysis_.won.total) /
               static_cast<double>(analysis_.total.total) * 100.0;
    }

private:
    static void update_length_summary(Analysis::LengthStats& stats, std::size_t barlen) {
        stats.total += barlen;
        stats.max = std::max(stats.max, barlen);
        if (stats.min == 0 || barlen < stats.min) {
            stats.min = barlen;
        }
    }

    static void finalize_directional(Analysis::Directional& side,
                                     Analysis::DirectionalLength& side_len,
                                     bool have_trade) {
        if (side.total > 0) {
            side.pnl.average = side.pnl.total / static_cast<double>(side.total);
            side_len.total_stats.average =
                static_cast<double>(side_len.total_stats.total) / static_cast<double>(side.total);
        }
        if (side.won > 0) {
            side.pnl.won.average = side.pnl.won.total / static_cast<double>(side.won);
            side_len.won.average =
                static_cast<double>(side_len.won.total) / static_cast<double>(side.won);
        } else {
            side.pnl.won.max = 0.0;
        }
        if (side.lost > 0) {
            side.pnl.lost.average = side.pnl.lost.total / static_cast<double>(side.lost);
            side_len.lost.average =
                static_cast<double>(side_len.lost.total) / static_cast<double>(side.lost);
        } else {
            side.pnl.lost.max = 0.0;
        }

        if (!have_trade) {
            side_len.total_stats.min = 0;
        }
        if (side.won == 0) {
            side_len.won.min = 0;
        }
        if (side.lost == 0) {
            side_len.lost.min = 0;
        }
    }

    Analysis analysis_{};
    const BackBroker* last_broker_ = nullptr;
};

} // namespace nonabt
