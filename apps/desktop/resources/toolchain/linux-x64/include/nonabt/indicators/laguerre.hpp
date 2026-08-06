#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

class LaguerreRSI : public Indicator {
public:
    explicit LaguerreRSI(const Line<double>& source, double gamma = 0.5, std::size_t period = 6)
        : source_(source), gamma_(gamma), period_(period) {}

    void next() override {
        const std::size_t idx = source_.index();
        if (idx + 1 < period_) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const double l0_prev = l0_;
        const double l1_prev = l1_;
        const double l2_prev = l2_;

        const double value = source_.data()[source_.index()];
        l0_ = ((1.0 - gamma_) * value) + (gamma_ * l0_prev);
        l1_ = (-gamma_ * l0_) + l0_prev + (gamma_ * l1_prev);
        l2_ = (-gamma_ * l1_) + l1_prev + (gamma_ * l2_prev);
        l3_ = (-gamma_ * l2_) + l2_prev + (gamma_ * l3_);

        double cu = 0.0;
        double cd = 0.0;
        accumulate_delta(l0_, l1_, cu, cd);
        accumulate_delta(l1_, l2_, cu, cd);
        accumulate_delta(l2_, l3_, cu, cd);

        const double denominator = cu + cd;
        line_.forward(denominator == 0.0 ? 1.0 : (cu / denominator));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 1;
    }

private:
    static void accumulate_delta(double lhs, double rhs, double& cu, double& cd) noexcept {
        if (lhs >= rhs) {
            cu += lhs - rhs;
        } else {
            cd += rhs - lhs;
        }
    }

    const Line<double>& source_;
    double gamma_;
    std::size_t period_;
    double l0_ = 0.0;
    double l1_ = 0.0;
    double l2_ = 0.0;
    double l3_ = 0.0;
};

using LRSI = LaguerreRSI;

class LaguerreFilter : public Indicator {
public:
    explicit LaguerreFilter(const Line<double>& source, double gamma = 0.5)
        : source_(source), gamma_(gamma) {}

    void next() override {
        const double l0_prev = l0_;
        const double l1_prev = l1_;
        const double l2_prev = l2_;

        const double value = source_.data()[source_.index()];
        l0_ = ((1.0 - gamma_) * value) + (gamma_ * l0_prev);
        l1_ = (-gamma_ * l0_) + l0_prev + (gamma_ * l1_prev);
        l2_ = (-gamma_ * l1_) + l1_prev + (gamma_ * l2_prev);
        l3_ = (-gamma_ * l2_) + l2_prev + (gamma_ * l3_);

        line_.forward((l0_ + (2.0 * l1_) + (2.0 * l2_) + l3_) / 6.0);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 1;
    }

    [[nodiscard]] const Line<double>& lfilter() const noexcept { return line_; }

private:
    const Line<double>& source_;
    double gamma_;
    double l0_ = 0.0;
    double l1_ = 0.0;
    double l2_ = 0.0;
    double l3_ = 0.0;
};

using LAGF = LaguerreFilter;

} // namespace nonabt
