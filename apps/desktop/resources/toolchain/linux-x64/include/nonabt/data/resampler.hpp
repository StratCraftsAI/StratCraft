#pragma once

#include <nonabt/data/data_feed.hpp>
#include <nonabt/data/timeframe.hpp>

#include <algorithm>
#include <chrono>
#include <memory>
#include <vector>

namespace nonabt {

/// Resampler - Aggregates bars from a source DataFeed into a higher timeframe.
/// Supports Minutes, Days, Weeks, and Months.
class Resampler : public DataFeed {
public:
    Resampler(DataFeed& source, TimeFrame target_tf, int target_compression)
        : source_(source), target_tf_(target_tf), target_compression_(target_compression) {
        set_timeframe({target_tf, target_compression});
        set_name(source.name() + "_resampled");
    }

    [[nodiscard]] bool load() override {
        // Resampler is fully populated during preload()
        return false;
    }

    void preload() override {
        source_.preload();
        if (source_.size() == 0) return;

        double o = 0, h = 0, l = 0, c = 0, v = 0;
        bool first = true;
        std::int64_t current_bucket = -1;
        DateTime last_dt = {};

        for (std::size_t i = 0; i < source_.size(); ++i) {
            DateTime dt = source_.datetime().data()[i];
            double bar_o = source_.open().data()[i];
            double bar_h = source_.high().data()[i];
            double bar_l = source_.low().data()[i];
            double bar_c = source_.close().data()[i];
            double bar_v = source_.volume().data()[i];

            std::int64_t bucket = get_bucket(dt, target_tf_, target_compression_);

            if (!first && bucket != current_bucket) {
                // Determine if this bucket change is due to a day change (for minute TF)
                bool is_day_boundary = target_tf_ == TimeFrame::Minutes &&
                    std::chrono::floor<std::chrono::days>(last_dt) !=
                    std::chrono::floor<std::chrono::days>(dt);

                // Save accumulated bar with appropriate timestamp
                datetime().data().push_back(
                    is_day_boundary ? end_of_day(last_dt) : compute_bar_timestamp(last_dt));
                open().data().push_back(o);
                high().data().push_back(h);
                low().data().push_back(l);
                close().data().push_back(c);
                volume().data().push_back(v);
                openinterest().data().push_back(0.0);

                // Start new bar
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
            last_dt = dt;
        }

        // Final bar
        if (!first) {
            datetime().data().push_back(compute_bar_timestamp(last_dt));
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

private:
    /// End-of-day timestamp for a given bar (date + 23:59:59)
    static DateTime end_of_day(DateTime dt) {
        using namespace std::chrono;
        auto day = floor<days>(dt);
        return DateTime(day + hours(23) + minutes(59) + seconds(59));
    }

    /// Compute the output bar timestamp matching backtrader conventions:
    /// - For daily source resampled to weeks/months: last bar's date + 23:59:59
    /// - For minute source resampled to larger minutes: bucket-end timestamp
    [[nodiscard]] DateTime compute_bar_timestamp(DateTime last_bar_dt) const {
        using namespace std::chrono;

        if (target_tf_ == TimeFrame::Minutes) {
            // Minute resample: use bucket-end time (e.g., 09:00-09:14 -> 09:15:00)
            return get_bucket_timestamp(last_bar_dt, target_tf_, target_compression_);
        }

        // Daily source resampled to weeks/months: backtrader convention is
        // last trading day of period + 23:59:59.999989
        // We use 23:59:59 which matches when substr(0,19) is compared.
        return end_of_day(last_bar_dt);
    }

    static std::int64_t get_bucket(DateTime dt, TimeFrame tf, int compression) {
        using namespace std::chrono;
        
        auto sys_days = floor<days>(dt);
        auto time_of_day = dt - sys_days;
        
        if (tf == TimeFrame::Minutes) {
            auto total_mins_of_day = duration_cast<minutes>(time_of_day).count();
            // backtrader [0, 15) boundaries
            auto day_idx = sys_days.time_since_epoch().count();
            return day_idx * 10000 + (total_mins_of_day / compression);
        }
        
        if (tf == TimeFrame::Days) {
             return sys_days.time_since_epoch().count() / compression;
        }

        if (tf == TimeFrame::Weeks) {
            auto sys_days_val = sys_days.time_since_epoch().count();
            // 1970-01-01 was Thursday. (sys_days + 3) / 7 gives weeks starting Monday
            return (sys_days_val + 3) / 7;
        }
        
        if (tf == TimeFrame::Months) {
            year_month_day ymd{sys_days};
            return static_cast<int>(ymd.year()) * 12 + static_cast<unsigned>(ymd.month());
        }

        return dt.time_since_epoch().count();
    }

    static DateTime get_bucket_timestamp(DateTime dt, TimeFrame tf, int compression) {
        using namespace std::chrono;
        auto sys_days_val = floor<days>(dt);
        auto time_of_day = dt - sys_days_val;
        
        if (tf == TimeFrame::Minutes) {
            auto total_mins_of_day = duration_cast<minutes>(time_of_day).count();
            auto bucket_end_mins = (total_mins_of_day / compression + 1) * compression;
            return DateTime(sys_days_val + minutes(bucket_end_mins));
        }
        
        if (tf == TimeFrame::Days) {
             return DateTime(sys_days_val + days(compression - 1) + hours(23) + minutes(59) + seconds(59));
        }

        if (tf == TimeFrame::Weeks) {
            weekday wd{sys_days_val};
            int wd_val = static_cast<int>(wd.c_encoding());
            if (wd_val == 0) wd_val = 7; 
            auto days_to_sunday = 7 - wd_val;
            return DateTime(sys_days_val + days(days_to_sunday) + hours(23) + minutes(59) + seconds(59));
        }
        
        if (tf == TimeFrame::Months) {
            year_month_day ymd{sys_days_val};
            auto last_day_ymd = year_month_day_last(ymd.year(), month_day_last(ymd.month()));
            return DateTime(sys_days{last_day_ymd} + hours(23) + minutes(59) + seconds(59));
        }

        return dt;
    }

    DataFeed& source_;
    TimeFrame target_tf_;
    int target_compression_;
};

} // namespace nonabt
