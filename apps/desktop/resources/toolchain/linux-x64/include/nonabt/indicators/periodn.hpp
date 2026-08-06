#pragma once

#include <stratforge/indicators/indicator.hpp>

#include <cstddef>

namespace nonabt {

/// Shared base for indicators that operate on a trailing period.
class PeriodN : public Indicator {
public:
    explicit PeriodN(const Line<double>& source, std::size_t period)
        : source_(source), period_(period == 0 ? 1 : period) {}

    [[nodiscard]] std::size_t minimum_period() const noexcept override {
        return period_;
    }

    [[nodiscard]] std::size_t period() const noexcept {
        return period_;
    }

protected:
    [[nodiscard]] bool in_warmup() const noexcept {
        return source_.index() + 1 < period_;
    }

    [[nodiscard]] const Line<double>& source() const noexcept {
        return source_;
    }

private:
    const Line<double>& source_;
    std::size_t period_;
};

} // namespace nonabt
