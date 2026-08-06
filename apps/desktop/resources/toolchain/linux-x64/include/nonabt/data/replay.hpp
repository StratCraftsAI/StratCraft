#pragma once

#include <nonabt/data/data_feed.hpp>
#include <nonabt/data/timeframe.hpp>

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <vector>

namespace nonabt {

/// DataReplay - Replays source bars into a higher timeframe, delivering
/// partial (in-progress) bars as they are being built.
///
/// Unlike Resampler which only emits completed bars, DataReplay emits
/// every source bar as an update to the current higher-TF bar being built.
/// The bar's OHLCV is updated progressively until the period completes.
///
/// Usage:
///   - Each bar in the replay output represents the current state of the
///     aggregated higher-TF bar at that point in time.
///   - Size of output equals source size (one output bar per source bar).
///   - The "close" progresses with each source bar; "high" and "low" expand.
class DataReplay : public DataFeed {
public:
    DataReplay(DataFeed& source, TimeFrame target_tf, int target_compression)
        : source_(source), target_tf_(target_tf), target_compression_(target_compression) {
        set_timeframe({target_tf, target_compression});
        set_name(source.name() + "_replay");
    }

    [[nodiscard]] bool load() override {
        return false;
    }

    void preload() override {
        source_.preload();
        if (source_.size() == 0) return;

        double o = 0, h = 0, l = 0, c = 0, v = 0;
        bool first = true;
        std::int64_t current_bucket = -1;

        for (std::size_t i = 0; i < source_.size(); ++i) {
            DateTime dt = source_.datetime().data()[i];
            double bar_o = source_.open().data()[i];
            double bar_h = source_.high().data()[i];
            double bar_l = source_.low().data()[i];
            double bar_c = source_.close().data()[i];
            double bar_v = source_.volume().data()[i];

            std::int64_t bucket = get_bucket(dt, target_tf_, target_compression_);

            if (!first && bucket != current_bucket) {
                // New period -- reset accumulation
                o = bar_o;
                h = bar_h;
                l = bar_l;
                c = bar_c;
                v = bar_v;
            } else {
                if (first) {
                    o = bar_o;
                    h = bar_h;
                    l = bar_l;
                    first = false;
                } else {
                    h = std::max(h, bar_h);
                    l = std::min(l, bar_l);
                }
                c = bar_c;
                v += bar_v;
            }
            current_bucket = bucket;

            // Emit current state of the aggregated bar
            datetime().data().push_back(dt);
            open().data().push_back(o);
            high().data().push_back(h);
            low().data().push_back(l);
            close().data().push_back(c);
            volume().data().push_back(v);
            openinterest().data().push_back(0.0);
        }

        // Reset cursors
        datetime().home();
        open().home();
        high().home();
        low().home();
        close().home();
        volume().home();
        openinterest().home();
    }

    /// Check if the bar at index `i` is the last bar of its period
    [[nodiscard]] bool is_period_end(std::size_t i) const {
        if (i + 1 >= source_.size()) return true;
        DateTime dt = source_.datetime().data()[i];
        DateTime next_dt = source_.datetime().data()[i + 1];
        return get_bucket(dt, target_tf_, target_compression_) !=
               get_bucket(next_dt, target_tf_, target_compression_);
    }

private:
    static std::int64_t get_bucket(DateTime dt, TimeFrame tf, int compression) {
        using namespace std::chrono;

        auto sys_days = floor<days>(dt);
        auto time_of_day = dt - sys_days;

        if (tf == TimeFrame::Minutes) {
            auto total_mins_of_day = duration_cast<minutes>(time_of_day).count();
            auto day_idx = sys_days.time_since_epoch().count();
            return day_idx * 10000 + (total_mins_of_day / compression);
        }

        if (tf == TimeFrame::Days) {
            return sys_days.time_since_epoch().count() / compression;
        }

        if (tf == TimeFrame::Weeks) {
            auto sys_days_val = sys_days.time_since_epoch().count();
            return (sys_days_val + 3) / 7;
        }

        if (tf == TimeFrame::Months) {
            year_month_day ymd{sys_days};
            return static_cast<int>(ymd.year()) * 12 + static_cast<unsigned>(ymd.month());
        }

        return dt.time_since_epoch().count();
    }

    DataFeed& source_;
    TimeFrame target_tf_;
    int target_compression_;
};

} // namespace nonabt
