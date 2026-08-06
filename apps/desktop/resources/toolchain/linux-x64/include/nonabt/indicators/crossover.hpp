#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Difference that keeps the last non-zero value when the current difference is zero.
class NonZeroDifference : public Indicator {
public:
    NonZeroDifference(const Line<double>& line1, const Line<double>& line2)
        : line1_(line1), line2_(line2) {}

    void next() override {
        const auto idx1 = line1_.index();
        const auto idx2 = line2_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        const double curr1 = line1_.data()[idx1];
        const double curr2 = line2_.data()[idx2];

        if (std::isnan(curr1) || std::isnan(curr2)) {
            line_.forward(nan);
            return;
        }

        const double diff = curr1 - curr2;
        if (line_.empty()) {
            line_.forward(diff);
            return;
        }

        line_.forward(diff != 0.0 ? diff : line_.data().back());
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 1;
    }

private:
    const Line<double>& line1_;
    const Line<double>& line2_;
};

/// Upward-only crossover detection.
class CrossUp : public Indicator {
public:
    CrossUp(const Line<double>& line1, const Line<double>& line2)
        : line1_(line1), line2_(line2), nzd_(line1, line2) {}

    void next() override {
        const auto idx1 = line1_.index();
        const auto idx2 = line2_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        const double curr1 = line1_.data()[idx1];
        const double curr2 = line2_.data()[idx2];

        nzd_.next();

        if (std::isnan(curr1) || std::isnan(curr2) || nzd_.line().size() < 2) {
            line_.forward(nan);
            return;
        }

        const double prev_diff = nzd_.line().data()[nzd_.line().size() - 2];
        line_.forward(prev_diff < 0.0 && curr1 > curr2 ? 1.0 : 0.0);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 2;
    }

private:
    const Line<double>& line1_;
    const Line<double>& line2_;
    NonZeroDifference nzd_;
};

/// Downward-only crossover detection.
class CrossDown : public Indicator {
public:
    CrossDown(const Line<double>& line1, const Line<double>& line2)
        : line1_(line1), line2_(line2), nzd_(line1, line2) {}

    void next() override {
        const auto idx1 = line1_.index();
        const auto idx2 = line2_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        const double curr1 = line1_.data()[idx1];
        const double curr2 = line2_.data()[idx2];

        nzd_.next();

        if (std::isnan(curr1) || std::isnan(curr2) || nzd_.line().size() < 2) {
            line_.forward(nan);
            return;
        }

        const double prev_diff = nzd_.line().data()[nzd_.line().size() - 2];
        line_.forward(prev_diff > 0.0 && curr1 < curr2 ? 1.0 : 0.0);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 2;
    }

private:
    const Line<double>& line1_;
    const Line<double>& line2_;
    NonZeroDifference nzd_;
};

/// CrossOver - detects when one line crosses over/under another.
/// Output: +1 (cross over), -1 (cross under), 0 (no cross)
class CrossOver : public Indicator {
public:
    CrossOver(const Line<double>& line1, const Line<double>& line2)
        : line1_(line1), line2_(line2) {}

    void next() override {
        auto idx1 = line1_.index();
        auto idx2 = line2_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        const double curr1 = line1_.data()[idx1];
        const double curr2 = line2_.data()[idx2];

        if (std::isnan(curr1) || std::isnan(curr2)) {
            line_.forward(nan);
            return;
        }

        if (idx1 == 0 || idx2 == 0) {
            last_non_zero_diff_ = curr1 - curr2;
            non_zero_initialized_ = true;
            line_.forward(nan);
            return;
        }
        const double prev1 = line1_.data()[idx1 - 1];
        const double prev2 = line2_.data()[idx2 - 1];
        if (std::isnan(prev1) || std::isnan(prev2)) {
            last_non_zero_diff_ = curr1 - curr2;
            non_zero_initialized_ = true;
            line_.forward(nan);
            return;
        }

        const double diff = curr1 - curr2;

        const double reference_diff = non_zero_initialized_ ? last_non_zero_diff_ : diff;
        const bool cross_up = reference_diff < 0.0 && curr1 > curr2;
        const bool cross_down = reference_diff > 0.0 && curr1 < curr2;

        if (diff != 0.0) {
            last_non_zero_diff_ = diff;
            non_zero_initialized_ = true;
        }

        line_.forward(cross_up ? 1.0 : (cross_down ? -1.0 : 0.0));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 2; // Caller-specific warmup may be longer if inputs emit NaN first.
    }

private:
    const Line<double>& line1_;
    const Line<double>& line2_;
    double last_non_zero_diff_ = 0.0;
    bool non_zero_initialized_ = false;
};

using NZD = NonZeroDifference;

} // namespace nonabt
