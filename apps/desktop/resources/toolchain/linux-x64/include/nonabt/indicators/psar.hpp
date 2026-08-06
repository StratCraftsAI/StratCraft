#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <algorithm>
#include <cstddef>
#include <limits>
#include <vector>

namespace nonabt {

/// Parabolic SAR.
class ParabolicSAR : public Indicator {
public:
    struct Status {
        double sar = 0.0;
        bool tr = false;
        double af = 0.0;
        double ep = 0.0;
    };

    ParabolicSAR(const Line<double>& high,
                 const Line<double>& low,
                 const Line<double>& close,
                 std::size_t period = 2,
                 double af = 0.02,
                 double afmax = 0.20)
        : high_(high), low_(low), close_(close), period_(period), af_step_(af), af_max_(afmax) {}

    void next() override {
        const auto len = close_.index() + 1;
        const double nan = std::numeric_limits<double>::quiet_NaN();

        if (len == 1) {
            status_.clear();
            line_.forward(nan);
            return;
        }

        if (len == 2 && status_.empty()) {
            status_.resize(2);
            const auto plenidx = (len - 1) % 2;
            auto& prev = status_[plenidx];
            prev.sar = (high_.data()[0] + low_.data()[0]) / 2.0;
            prev.af = af_step_;
            if (close_.data()[1] >= close_.data()[0]) {
                prev.tr = false;
                prev.ep = low_.data()[0];
            } else {
                prev.tr = true;
                prev.ep = high_.data()[0];
            }
        }

        const auto plenidx = (len - 1) % 2;
        const auto& prev = status_[plenidx];

        const double hi = high_.data()[len - 1];
        const double lo = low_.data()[len - 1];
        bool tr = prev.tr;
        double sar = prev.sar;
        double ep = prev.ep;
        double af = prev.af;

        if ((tr && sar >= lo) || (!tr && sar <= hi)) {
            tr = !tr;
            sar = prev.ep;
            ep = tr ? hi : lo;
            af = af_step_;
        }

        line_.forward(sar);

        if (tr) {
            if (hi > ep) {
                ep = hi;
                af = std::min(af + af_step_, af_max_);
            }
        } else {
            if (lo < ep) {
                ep = lo;
                af = std::min(af + af_step_, af_max_);
            }
        }

        sar = sar + af * (ep - sar);
        if (tr) {
            const double lo1 = low_.data()[len - 2];
            if (sar > lo || sar > lo1) {
                sar = std::min(lo, lo1);
            }
        } else {
            const double hi1 = high_.data()[len - 2];
            if (sar < hi || sar < hi1) {
                sar = std::max(hi, hi1);
            }
        }

        auto& next = status_[plenidx == 0 ? 1 : 0];
        next.tr = tr;
        next.sar = sar;
        next.ep = ep;
        next.af = af;

        if (len < period_) {
            line_.set(nan);
        }
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_ + 1;
    }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    std::size_t period_;
    double af_step_;
    double af_max_;
    std::vector<Status> status_;
};

using PSAR = ParabolicSAR;

} // namespace nonabt
