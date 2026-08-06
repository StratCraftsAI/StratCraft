#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Average Directional Index and related DI lines.
class DirectionalMovement : public Indicator {
public:
    DirectionalMovement(const Line<double>& high,
                        const Line<double>& low,
                        const Line<double>& close,
                        std::size_t period = 14)
        : high_(high), low_(low), close_(close), period_(period) {}

    void next() override {
        const auto idx = close_.index();
        const double nan = std::numeric_limits<double>::quiet_NaN();

        if (idx == 0) {
            true_range_.forward(nan);
            plus_dm_raw_.forward(nan);
            minus_dm_raw_.forward(nan);
            atr_.forward(nan);
            plus_dm_smoothed_.forward(nan);
            minus_dm_smoothed_.forward(nan);
            plus_di_.forward(nan);
            minus_di_.forward(nan);
            dx_.forward(nan);
            line_.forward(nan);
            adxr_.forward(nan);
            return;
        }

        const double upmove = high_.data()[idx] - high_.data()[idx - 1];
        const double downmove = low_.data()[idx - 1] - low_.data()[idx];
        const double plus_dm = (upmove > downmove && upmove > 0.0) ? upmove : 0.0;
        const double minus_dm = (downmove > upmove && downmove > 0.0) ? downmove : 0.0;
        const double tr = compute_true_range(idx);

        true_range_.forward(tr);
        plus_dm_raw_.forward(plus_dm);
        minus_dm_raw_.forward(minus_dm);

        if (!atr_initialized_) {
            tr_sum_ += tr;
            plus_dm_sum_ += plus_dm;
            minus_dm_sum_ += minus_dm;
            ++seed_count_;

            atr_.forward(nan);
            plus_dm_smoothed_.forward(nan);
            minus_dm_smoothed_.forward(nan);
            plus_di_.forward(nan);
            minus_di_.forward(nan);
            dx_.forward(nan);
            line_.forward(nan);
            adxr_.forward(nan);

            if (seed_count_ == period_) {
                prev_atr_ = tr_sum_ / static_cast<double>(period_);
                prev_plus_dm_ = plus_dm_sum_ / static_cast<double>(period_);
                prev_minus_dm_ = minus_dm_sum_ / static_cast<double>(period_);
                atr_.set(prev_atr_);
                plus_dm_smoothed_.set(prev_plus_dm_);
                minus_dm_smoothed_.set(prev_minus_dm_);

                const double plus_di = prev_atr_ == 0.0 ? 0.0 : 100.0 * (prev_plus_dm_ / prev_atr_);
                const double minus_di = prev_atr_ == 0.0 ? 0.0 : 100.0 * (prev_minus_dm_ / prev_atr_);
                plus_di_.set(plus_di);
                minus_di_.set(minus_di);

                const double denominator = plus_di + minus_di;
                const double dx = denominator == 0.0 ? 0.0 : 100.0 * (std::abs(plus_di - minus_di) / denominator);
                dx_.set(dx);
                dx_sum_ += dx;
                ++dx_count_;

                if (dx_count_ == period_) {
                    prev_adx_ = dx_sum_ / static_cast<double>(period_);
                    line_.set(prev_adx_);
                    adx_initialized_ = true;
                }
                atr_initialized_ = true;
            }

            return;
        }

        const double period_d = static_cast<double>(period_);
        prev_atr_ = ((prev_atr_ * (period_d - 1.0)) + tr) / period_d;
        prev_plus_dm_ = ((prev_plus_dm_ * (period_d - 1.0)) + plus_dm) / period_d;
        prev_minus_dm_ = ((prev_minus_dm_ * (period_d - 1.0)) + minus_dm) / period_d;

        atr_.forward(prev_atr_);
        plus_dm_smoothed_.forward(prev_plus_dm_);
        minus_dm_smoothed_.forward(prev_minus_dm_);

        const double plus_di = prev_atr_ == 0.0 ? 0.0 : 100.0 * (prev_plus_dm_ / prev_atr_);
        const double minus_di = prev_atr_ == 0.0 ? 0.0 : 100.0 * (prev_minus_dm_ / prev_atr_);
        plus_di_.forward(plus_di);
        minus_di_.forward(minus_di);

        const double denominator = plus_di + minus_di;
        const double dx = denominator == 0.0 ? 0.0 : 100.0 * (std::abs(plus_di - minus_di) / denominator);
        dx_.forward(dx);

        if (!adx_initialized_) {
            dx_sum_ += dx;
            ++dx_count_;
            line_.forward(nan);
            adxr_.forward(nan);

            if (dx_count_ == period_) {
                prev_adx_ = dx_sum_ / static_cast<double>(period_);
                line_.set(prev_adx_);
                adx_initialized_ = true;
            }
            return;
        }

        prev_adx_ = ((prev_adx_ * (period_d - 1.0)) + dx) / period_d;
        line_.forward(prev_adx_);

        if (line_.size() <= period_ || std::isnan(line_.data()[line_.size() - 1 - period_])) {
            adxr_.forward(nan);
        } else {
            adxr_.forward((prev_adx_ + line_.data()[line_.size() - 1 - period_]) / 2.0);
        }
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return (period_ * 2);
    }

    [[nodiscard]] const Line<double>& adx() const noexcept { return line_; }
    [[nodiscard]] const Line<double>& adxr() const noexcept { return adxr_; }
    [[nodiscard]] const Line<double>& plus_di() const noexcept { return plus_di_; }
    [[nodiscard]] const Line<double>& minus_di() const noexcept { return minus_di_; }

private:
    [[nodiscard]] double compute_true_range(std::size_t idx) const noexcept {
        const double high_low = high_.data()[idx] - low_.data()[idx];
        const double high_prev_close = std::abs(high_.data()[idx] - close_.data()[idx - 1]);
        const double low_prev_close = std::abs(low_.data()[idx] - close_.data()[idx - 1]);
        return std::max({high_low, high_prev_close, low_prev_close});
    }

    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
    std::size_t period_;
    Line<double> true_range_;
    Line<double> plus_dm_raw_;
    Line<double> minus_dm_raw_;
    Line<double> atr_;
    Line<double> plus_dm_smoothed_;
    Line<double> minus_dm_smoothed_;
    Line<double> plus_di_;
    Line<double> minus_di_;
    Line<double> dx_;
    Line<double> adxr_;
    double tr_sum_ = 0.0;
    double plus_dm_sum_ = 0.0;
    double minus_dm_sum_ = 0.0;
    double dx_sum_ = 0.0;
    double prev_atr_ = 0.0;
    double prev_plus_dm_ = 0.0;
    double prev_minus_dm_ = 0.0;
    double prev_adx_ = 0.0;
    std::size_t seed_count_ = 0;
    std::size_t dx_count_ = 0;
    bool atr_initialized_ = false;
    bool adx_initialized_ = false;
};

class PlusDirectionalIndicator : public Indicator {
public:
    PlusDirectionalIndicator(const Line<double>& high,
                             const Line<double>& low,
                             const Line<double>& close,
                             std::size_t period = 14)
        : dm_(high, low, close, period) {}

    void next() override {
        dm_.next();
        line_.forward(dm_.plus_di().data().back());
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return dm_.minimum_period();
    }

private:
    DirectionalMovement dm_;
};

class MinusDirectionalIndicator : public Indicator {
public:
    MinusDirectionalIndicator(const Line<double>& high,
                              const Line<double>& low,
                              const Line<double>& close,
                              std::size_t period = 14)
        : dm_(high, low, close, period) {}

    void next() override {
        dm_.next();
        line_.forward(dm_.minus_di().data().back());
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return dm_.minimum_period();
    }

private:
    DirectionalMovement dm_;
};

class ADX : public Indicator {
public:
    ADX(const Line<double>& high,
        const Line<double>& low,
        const Line<double>& close,
        std::size_t period = 14)
        : dm_(high, low, close, period) {}

    void next() override {
        dm_.next();
        line_.forward(dm_.adx().data().back());
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return dm_.minimum_period();
    }

private:
    DirectionalMovement dm_;
};

class DirectionalIndicator : public Indicator {
public:
    DirectionalIndicator(const Line<double>& high,
                         const Line<double>& low,
                         const Line<double>& close,
                         std::size_t period = 14)
        : dm_(high, low, close, period) {}

    void next() override {
        dm_.next();
        line_.forward(std::numeric_limits<double>::quiet_NaN());
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return dm_.minimum_period();
    }

    [[nodiscard]] const Line<double>& plus_di() const noexcept { return dm_.plus_di(); }
    [[nodiscard]] const Line<double>& minus_di() const noexcept { return dm_.minus_di(); }

private:
    DirectionalMovement dm_;
};

class ADXR : public Indicator {
public:
    ADXR(const Line<double>& high,
         const Line<double>& low,
         const Line<double>& close,
         std::size_t period = 14)
        : dm_(high, low, close, period), period_(period) {}

    void next() override {
        dm_.next();
        line_.forward(dm_.adxr().data().back());
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return dm_.minimum_period() + period_;
    }

private:
    DirectionalMovement dm_;
    std::size_t period_;
};

} // namespace nonabt
