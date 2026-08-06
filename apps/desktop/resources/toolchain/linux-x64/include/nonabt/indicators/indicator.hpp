#pragma once

#include <stratforge/core/line.hpp>

#include <cstddef>

namespace nonabt {

/// Indicator base class.
/// Indicators compute derived values from data feed lines.
class Indicator {
public:
    Indicator() = default;
    virtual ~Indicator() = default;

    Indicator(const Indicator&) = delete;
    Indicator& operator=(const Indicator&) = delete;
    Indicator(Indicator&&) = default;
    Indicator& operator=(Indicator&&) = default;

    /// Compute the indicator value for the current bar
    virtual void next() = 0;

    /// Minimum number of bars required before indicator produces valid output
    [[nodiscard]] virtual std::size_t minimum_period() const noexcept = 0;

    /// Access the output line
    [[nodiscard]] const Line<double>& line() const noexcept { return line_; }
    [[nodiscard]] Line<double>& line() noexcept { return line_; }

    /// Convenience: current value
    [[nodiscard]] double operator[](int offset) const {
        return line_[offset];
    }

protected:
    Line<double> line_;
};

} // namespace nonabt
