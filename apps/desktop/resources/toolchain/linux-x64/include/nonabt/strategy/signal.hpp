#pragma once

#include <stratforge/core/line.hpp>

namespace nonabt {

/// Signal values for strategy decisions
enum class Signal : int {
    Sell = -1,
    Neutral = 0,
    Buy = 1,
};

/// Convert a numeric value to a Signal
[[nodiscard]] inline Signal to_signal(double value) noexcept {
    if (value > 0) return Signal::Buy;
    if (value < 0) return Signal::Sell;
    return Signal::Neutral;
}

} // namespace nonabt
