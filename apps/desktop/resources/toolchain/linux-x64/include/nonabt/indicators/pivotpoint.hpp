#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cstddef>

namespace nonabt {

class PivotPoint : public Indicator {
public:
    PivotPoint(const Line<double>& open,
               const Line<double>& high,
               const Line<double>& low,
               const Line<double>& close,
               bool use_open = false,
               bool use_close_twice = false)
        : open_(open)
        , high_(high)
        , low_(low)
        , close_(close)
        , use_open_(use_open)
        , use_close_twice_(use_close_twice) {}

    void next() override {
        const std::size_t idx = close_.index();
        const double pivot = calculate_pivot(idx);
        const double range = high_.data()[idx] - low_.data()[idx];

        line_.forward(pivot);
        s1_.forward((2.0 * pivot) - high_.data()[idx]);
        s2_.forward(pivot - range);
        r1_.forward((2.0 * pivot) - low_.data()[idx]);
        r2_.forward(pivot + range);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 1;
    }

    [[nodiscard]] const Line<double>& p() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& s1() const noexcept { return s1_; }
    [[nodiscard]] const Line<double>& s2() const noexcept { return s2_; }
    [[nodiscard]] const Line<double>& r1() const noexcept { return r1_; }
    [[nodiscard]] const Line<double>& r2() const noexcept { return r2_; }

protected:
    [[nodiscard]] double calculate_pivot(std::size_t idx) const noexcept {
        if (use_close_twice_) {
            return (high_.data()[idx] + low_.data()[idx] + (2.0 * close_.data()[idx])) / 4.0;
        }
        if (use_open_) {
            return (high_.data()[idx] + low_.data()[idx] + close_.data()[idx] + open_.data()[idx]) / 4.0;
        }
        return (high_.data()[idx] + low_.data()[idx] + close_.data()[idx]) / 3.0;
    }

    const Line<double>& open_;
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    bool use_open_;
    bool use_close_twice_;
    Line<double> s1_;
    Line<double> s2_;
    Line<double> r1_;
    Line<double> r2_;
};

class FibonacciPivotPoint : public Indicator {
public:
    FibonacciPivotPoint(const Line<double>& open,
                        const Line<double>& high,
                        const Line<double>& low,
                        const Line<double>& close,
                        bool use_open = false,
                        bool use_close_twice = false,
                        double level1 = 0.382,
                        double level2 = 0.618,
                        double level3 = 1.0)
        : pivot_(open, high, low, close, use_open, use_close_twice)
        , high_(high)
        , low_(low)
        , level1_(level1)
        , level2_(level2)
        , level3_(level3) {}

    void next() override {
        pivot_.next();

        const std::size_t idx = high_.index();
        const double pivot = pivot_.p().data().back();
        const double range = high_.data()[idx] - low_.data()[idx];

        line_.forward(pivot);
        s1_.forward(pivot - (level1_ * range));
        s2_.forward(pivot - (level2_ * range));
        s3_.forward(pivot - (level3_ * range));
        r1_.forward(pivot + (level1_ * range));
        r2_.forward(pivot + (level2_ * range));
        r3_.forward(pivot + (level3_ * range));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 1;
    }

    [[nodiscard]] const Line<double>& p() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& s1() const noexcept { return s1_; }
    [[nodiscard]] const Line<double>& s2() const noexcept { return s2_; }
    [[nodiscard]] const Line<double>& s3() const noexcept { return s3_; }
    [[nodiscard]] const Line<double>& r1() const noexcept { return r1_; }
    [[nodiscard]] const Line<double>& r2() const noexcept { return r2_; }
    [[nodiscard]] const Line<double>& r3() const noexcept { return r3_; }

private:
    PivotPoint pivot_;
    const Line<double>& high_;
    const Line<double>& low_;
    double level1_;
    double level2_;
    double level3_;
    Line<double> s1_;
    Line<double> s2_;
    Line<double> s3_;
    Line<double> r1_;
    Line<double> r2_;
    Line<double> r3_;
};

class DemarkPivotPoint : public Indicator {
public:
    DemarkPivotPoint(const Line<double>& open,
                     const Line<double>& high,
                     const Line<double>& low,
                     const Line<double>& close)
        : open_(open), high_(high), low_(low), close_(close) {}

    void next() override {
        const std::size_t idx = close_.index();
        const double x = compare(close_.data()[idx], open_.data()[idx]);

        line_.forward(x / 4.0);
        s1_.forward((x / 2.0) - high_.data()[idx]);
        r1_.forward((x / 2.0) - low_.data()[idx]);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 1;
    }

    [[nodiscard]] const Line<double>& p() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& s1() const noexcept { return s1_; }
    [[nodiscard]] const Line<double>& r1() const noexcept { return r1_; }

private:
    [[nodiscard]] static double compare(double lhs, double rhs) noexcept {
        if (lhs < rhs) {
            return -1.0;
        }
        if (lhs > rhs) {
            return 1.0;
        }
        return 0.0;
    }

    const Line<double>& open_;
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    Line<double> s1_;
    Line<double> r1_;
};

} // namespace nonabt
