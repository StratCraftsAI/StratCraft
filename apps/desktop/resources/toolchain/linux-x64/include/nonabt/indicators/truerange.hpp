#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>

namespace nonabt {

/// True Range indicator.
class TrueRange : public Indicator {
public:
    TrueRange(const Line<double>& high, const Line<double>& low, const Line<double>& close)
        : high_(high), low_(low), close_(close) {}

    void next() override {
        const auto idx = close_.index();
        if (idx == 0) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const double high_low = high_.data()[idx] - low_.data()[idx];
        const double high_prev_close = std::abs(high_.data()[idx] - close_.data()[idx - 1]);
        const double low_prev_close = std::abs(low_.data()[idx] - close_.data()[idx - 1]);
        line_.forward(std::max({high_low, high_prev_close, low_prev_close}));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 2;
    }

private:
    const Line<double>& high_;
    const Line<double>& low_;
    const Line<double>& close_;
};

} // namespace nonabt
