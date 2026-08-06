#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cstddef>

namespace nonabt {

/// Cumulative sum of source values with an optional seed.
class Accum : public Indicator {
public:
    explicit Accum(const Line<double>& source, double seed = 0.0)
        : source_(source), seed_(seed) {}

    void next() override {
        const auto idx = source_.index();
        if (idx == 0) {
            line_.forward(seed_ + source_.data()[idx]);
            return;
        }

        line_.forward(line_.data().back() + source_.data()[idx]);
    }

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return 1;
    }

private:
    const Line<double>& source_;
    double seed_;
};

using CumSum = Accum;
using CumulativeSum = Accum;

} // namespace nonabt
