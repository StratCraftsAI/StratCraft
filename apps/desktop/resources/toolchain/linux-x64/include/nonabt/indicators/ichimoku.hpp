#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

class Ichimoku : public Indicator {
public:
    Ichimoku(const Line<double>& high,
             const Line<double>& low,
             const Line<double>& close,
             std::size_t tenkan = 9,
             std::size_t kijun = 26,
             std::size_t senkou = 52,
             std::size_t senkou_lead = 26,
             std::size_t chikou = 26)
        : high_(high)
        , low_(low)
        , close_(close)
        , tenkan_(tenkan == 0 ? 1 : tenkan)
        , kijun_(kijun == 0 ? 1 : kijun)
        , senkou_(senkou == 0 ? 1 : senkou)
        , senkou_lead_(senkou_lead)
        , chikou_(chikou) {}

    void next() override {
        ensure_storage();

        const std::size_t idx = close_.index();
        sync_cursors(idx);

        const double nan = std::numeric_limits<double>::quiet_NaN();
        double tenkan_value = nan;
        double kijun_value = nan;

        if (idx + 1 >= tenkan_) {
            tenkan_value = midpoint(idx, tenkan_);
        }
        line_.data()[idx] = tenkan_value;

        if (idx + 1 >= kijun_) {
            kijun_value = midpoint(idx, kijun_);
        }
        kijun_sen_.data()[idx] = kijun_value;

        if (!std::isnan(tenkan_value) && !std::isnan(kijun_value) && idx + senkou_lead_ < total_bars_) {
            senkou_span_a_.data()[idx + senkou_lead_] = (tenkan_value + kijun_value) / 2.0;
        }

        if (idx + 1 >= senkou_ && idx + senkou_lead_ < total_bars_) {
            senkou_span_b_.data()[idx + senkou_lead_] = midpoint(idx, senkou_);
        }

        if (idx >= chikou_) {
            chikou_span_.data()[idx - chikou_] = close_.data()[idx];
        }
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return tenkan_;
    }

    [[nodiscard]] const Line<double>& tenkan_sen() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& kijun_sen() const noexcept { return kijun_sen_; }
    [[nodiscard]] const Line<double>& senkou_span_a() const noexcept { return senkou_span_a_; }
    [[nodiscard]] const Line<double>& senkou_span_b() const noexcept { return senkou_span_b_; }
    [[nodiscard]] const Line<double>& chikou_span() const noexcept { return chikou_span_; }

private:
    void ensure_storage() {
        if (initialized_) {
            return;
        }

        total_bars_ = close_.size();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        line_.extend(total_bars_, nan);
        kijun_sen_.extend(total_bars_, nan);
        senkou_span_a_.extend(total_bars_, nan);
        senkou_span_b_.extend(total_bars_, nan);
        chikou_span_.extend(total_bars_, nan);
        initialized_ = true;
    }

    void sync_cursors(std::size_t idx) {
        while (line_.index() < idx) {
            line_.advance();
            kijun_sen_.advance();
            senkou_span_a_.advance();
            senkou_span_b_.advance();
            chikou_span_.advance();
        }
    }

    [[nodiscard]] double midpoint(std::size_t idx, std::size_t period) const noexcept {
        double highest = high_.data()[idx];
        double lowest = low_.data()[idx];
        for (std::size_t i = 1; i < period; ++i) {
            highest = std::max(highest, high_.data()[idx - i]);
            lowest = std::min(lowest, low_.data()[idx - i]);
        }
        return (highest + lowest) / 2.0;
    }

    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    std::size_t tenkan_;
    std::size_t kijun_;
    std::size_t senkou_;
    std::size_t senkou_lead_;
    std::size_t chikou_;
    std::size_t total_bars_ = 0;
    bool initialized_ = false;
    Line<double> kijun_sen_;
    Line<double> senkou_span_a_;
    Line<double> senkou_span_b_;
    Line<double> chikou_span_;
};

} // namespace nonabt
