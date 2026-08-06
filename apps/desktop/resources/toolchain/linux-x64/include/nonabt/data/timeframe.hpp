#pragma once

#include <cstdint>

namespace nonabt {

/// TimeFrame enumeration for bar duration classification
enum class TimeFrame : std::uint8_t {
    Tick,
    Seconds,
    Minutes,
    Days,
    Weeks,
    Months,
    Years,
};

/// TimeFrame with compression factor (e.g., 5-minute bars = {Minutes, 5})
struct TimeFrameCompression {
    TimeFrame timeframe = TimeFrame::Days;
    int compression = 1;
};

} // namespace nonabt
