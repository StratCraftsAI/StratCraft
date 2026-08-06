#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <algorithm>
#include <cstddef>
#include <limits>

namespace nonabt {

/// Maximum of current high and previous close.
class TrueHigh : public Indicator {
public:
    TrueHigh(const Line<double>& high, const Line<double>& close)
        : high_(high), close_(close) {}

    void next() override {
        const auto idx = close_.index();
        if (idx == 0) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(std::max(high_.data()[idx], close_.data()[idx - 1]));
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 2;
    }

private:
    const Line<double>& high_;
    const Line<double>& close_;
};

} // namespace nonabt
