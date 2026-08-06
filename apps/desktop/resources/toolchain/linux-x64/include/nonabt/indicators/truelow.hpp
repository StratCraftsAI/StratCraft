#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <algorithm>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Minimum of current low and previous close.
class TrueLow : public Indicator {
public:
    TrueLow(const Line<double>& low, const Line<double>& close)
        : low_(low), close_(close) {}

    void next() override {
        const auto idx = close_.index();
        if (idx == 0) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(std::min(low_.data()[idx], close_.data()[idx - 1]));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 2;
    }

private:
    const Line<double>& low_;
    const Line<double>& close_;
};

} // namespace nonabt
