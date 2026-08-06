#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cstddef>
#include <limits>

namespace nonabt {

/// Previous minus current value.
class DownMove : public Indicator {
public:
    explicit DownMove(const Line<double>& source)
        : source_(source) {}

    void next() override {
        const auto idx = source_.index();
        if (idx == 0) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        line_.forward(source_.data()[idx - 1] - source_.data()[idx]);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 2;
    }

private:
    const Line<double>& source_;
};

} // namespace nonabt
