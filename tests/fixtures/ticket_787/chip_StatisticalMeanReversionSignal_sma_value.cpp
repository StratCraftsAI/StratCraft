// TICKET_787 reproducer -- `Indicator<T>::value()` hallucination.
//
// Source: apps/desktop/logs/main.log:144444 (2026-05-18 08:12:32 UTC)
// Compile-gate temp dir (cleaned): /tmp/qnx-compile-gate-b3mY3S/
// Round 4 chip name: StatisticalMeanReversionSignal
//
// Expected diagnostic when compiled with
//   clang++ -std=c++23 -fsyntax-only -I<stratforge>/include this.cpp
//
//   error: no member named 'value' in 'stratforge::SMA'
//
// Truth: stratforge::IndicatorBase exposes
//   const Line<double>& line() const noexcept
//   Line<double>&       line() noexcept
//   double              operator[](int offset) const
// SMA / EMA / RSI / MACD / ... inherit this surface. The correct
// "current value" form is `(*sma_)[0]` or `sma_->line()[0]`.
// `value()`, `current()`, `last()`, `get()` are NOT in the SDK.
//
// This file is a minimal TU; the verbatim Round 4 source the LLM
// produced was not preserved (compile-gate cleans tempdir on
// rejection; see tests/fixtures/ticket_787/README.md).

#include <memory>
#include <stratforge/core/line.hpp>
#include <stratforge/indicators/sma.hpp>

void use_sma(std::unique_ptr<stratforge::SMA>& sma_) {
    // Hallucinated API -- error line: 'value' does not exist
    double sma_val = sma_->value();
    (void)sma_val;
}
