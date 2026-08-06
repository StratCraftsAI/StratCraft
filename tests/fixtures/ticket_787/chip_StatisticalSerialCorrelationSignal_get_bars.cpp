// TICKET_787 reproducer -- `DataFeed::get_bars()` hallucination.
//
// Source: apps/desktop/logs/main.log:144401 (2026-05-18 07:56:18 UTC)
// Compile-gate temp dir (cleaned): /tmp/qnx-compile-gate-mfEN09/
// Round 4 chip name: StatisticalSerialCorrelationSignal
//
// Expected diagnostic when compiled with
//   clang++ -std=c++23 -fsyntax-only -I<stratforge>/include this.cpp
//
//   error: no member named 'get_bars' in 'stratforge::DataFeed'
//
// Truth: stratforge::DataFeed exposes per-line accessors only
// (datetime / open / high / low / close / volume / openinterest),
// each returning `const Line<double>&`. There is no aggregate
// "bars" accessor. Historical access uses
// `close()[-static_cast<int>(i)]` per TICKET_784 sections 4 / 6.
//
// This file is a minimal TU; the verbatim Round 4 source the LLM
// produced was not preserved (compile-gate cleans tempdir on
// rejection; see tests/fixtures/ticket_787/README.md).

#include <stratforge/data/data_feed.hpp>

void use_data_feed(const stratforge::DataFeed& data) {
    // Hallucinated API -- error line: 'get_bars' does not exist
    const auto& bars = data.get_bars();
    (void)bars;
}
