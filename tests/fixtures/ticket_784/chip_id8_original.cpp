// =============================================================================
// TICKET_784 R9-B regression fixture
//
// PURPOSE
//   Verbatim source of the chip that caused the live SIGABRT in Alpha
//   Factory task af_1779066921901 (2026-05-18 01:15). Backend C++
//   validator must REJECT this source with an R9-B error rather than
//   persist it. Acceptance #4 of the backend handoff doc replays this
//   fixture through the new validator.
//
// PROVENANCE
//   - Table: nona_signal
//   - Row id: 8
//   - Column: code
//   - Strategy name: StatisticalDistributionAnomalySignal_v2
//   - record_type: indicator
//   - strategy_type: 1
//   - Dumped from: apps/desktop/data/StratCraft.db (StratCraft dev DB)
//   - Dump command:
//       sqlite3 apps/desktop/data/StratCraft.db \
//         "SELECT code FROM nona_signal WHERE id=8"
//   - Source size at dump time: 81 lines, 3287 bytes
//
// CROSS-REPO PATH MAPPING
//   This fixture is committed in the StratCraft (frontend) repo at:
//     tests/fixtures/ticket_784/chip_id8_original.cpp
//   The backend handoff doc references the same fixture in the backend
//   (nona_server) repo at:
//     tests/fixtures/ticket_784/chip_id8_original.cpp
//   Backend maintainer should copy this file verbatim (everything below
//   the END-OF-METADATA marker) into the backend repo at that path.
//
// VIOLATION SUMMARY
//   Line 30 (relative to the source-body block below, i.e. raw chip line):
//
//       closes.push_back(data().close()[i]);
//
//   Rule:        R9-B (non-negative variable subscript on data-feed
//                accessor)
//   Surrounding: for (std::size_t i = 0; i < lookback && i < data().close().size(); ++i)
//                where lookback = 252.
//   Crash mode:  stratforge::Line<T>::operator[] uses backtrader-style
//                indexing -- close()[i] with i >= 1 reads the i-th
//                future bar, which is not loaded at the cursor. The
//                runtime check at line.hpp:55-57 throws
//                std::out_of_range("Line index out of range") on the
//                second iteration; terminate -> SIGABRT -> executor
//                exits with code null.
//
// EXPECTED VALIDATOR OUTPUT (acceptance #3 + #4)
//   Severity: fatal error (block persistence; do not auto-fix).
//   Message:  [R9-B] Forward / non-historical line subscript on
//             'data().close()[i]' at chip line 30: stratforge::Line
//             uses backtrader-style indexing. Rewrite as
//             'data().close()[-static_cast<int>(i)]' for historical
//             access, or 'data().close()[0]' for the current bar.
//             Forward indices crash at runtime (std::out_of_range /
//             SIGABRT).
//
// REFERENCE CORRECT REWRITE (for the prompt's "two correct templates"
// teaching example -- NOT for auto-fix; cleanup is out of scope per
// the handoff doc)
//
//   Newest-first (i=0 is current, i=lookback-1 is lookback-1 bars ago):
//
//       const std::size_t avail = data().close().index() + 1;
//       if (avail < lookback) return stratforge::EntrySignal{};
//       std::vector<double> closes;
//       closes.reserve(lookback);
//       for (std::size_t i = 0; i < lookback; ++i) {
//           closes.push_back(data().close()[-static_cast<int>(i)]);
//       }
//       // closes is newest-first; downstream hurst/garch/adf/hmm expect
//       // oldest-first chronological -- keep the existing std::reverse.
//
// REGRESSION CHECK PSEUDOCODE (acceptance #4)
//   src = read_file("tests/fixtures/ticket_784/chip_id8_original.cpp")
//   src = strip_metadata_header(src)   # everything above END-OF-METADATA
//   result = backend_validator.run(src)
//   assert result.persisted == False
//   assert any(e.rule == "R9-B" and "data().close()[i]" in e.message
//              for e in result.errors)
//
// =============================================================================
// END-OF-METADATA
// (Everything below this line is the verbatim source as written by the
//  LLM and stored in nona_signal.id=8. Do not edit; this is the
//  regression input.)
// =============================================================================

#include <stratforge/strategy/signal_entry_strategy.hpp>
#include <stratforge/strategy/entry_signal.hpp>
#include <stratforge/engine/cerebro.hpp>
#include <stratforge/stats/adf.hpp>
#include <stratforge/stats/hurst_rs.hpp>
#include <stratforge/stats/garch11.hpp>
#include <stratforge/stats/hmm2.hpp>
#include <vector>
#include <span>
#include <cmath>
#include <algorithm>
#include <cstddef>
#include <numeric>

class StatisticalDistributionAnomalySignal : public stratforge::SignalEntryStrategy {
public:
    void initialize_indicators() override {
        // No streaming indicators needed; all calculations are batch-based.
    }

    void update_indicators() override {
        // No streaming indicators to update.
    }

    stratforge::EntrySignal check_open_conditions() override {
        // Compute Hurst exponent over lookback_window
        const std::size_t lookback = 252;
        std::vector<double> closes;
        for (std::size_t i = 0; i < lookback && i < data().close().size(); ++i) {
            closes.push_back(data().close()[i]);
        }
        if (closes.size() < lookback) return stratforge::EntrySignal{};
        std::reverse(closes.begin(), closes.end());
        const double hurst = stratforge::stats::hurst_rs(closes);
        const bool low_hurst = hurst < 0.5;

        // Compute GARCH(1,1) conditional variance
        std::vector<double> returns(closes.size() - 1);
        for (std::size_t i = 1; i < closes.size(); ++i) {
            returns[i-1] = std::log(closes[i] / closes[i-1]);
        }
        const auto garch = stratforge::stats::garch11_fit(returns);
        // Approximate conditional variance from GARCH parameters: omega + alpha * last_return^2 + beta * previous_variance
        // We use a simple estimate: omega / (1 - alpha - beta) as long-run variance.
        const double long_run_var = garch.omega / (1.0 - garch.alpha - garch.beta);
        const bool low_garch_var = long_run_var < 0.0001; // arbitrary threshold

        // Compute ADF test statistic
        const auto adf = stratforge::stats::adf_test(closes);
        const bool strong_mean_reversion = adf.statistic < -2.86; // ~5% critical value

        // Compute HMM regime probabilities
        const auto hmm = stratforge::stats::hmm2_gaussian(returns);
        const double p_low_vol = hmm.p_state0.empty() ? 0.5 : hmm.p_state0.back();
        const bool regime_switch = p_low_vol < 0.5; // low-vol regime probability low -> likely high vol

        // Combine conditions: entry on low Hurst + low GARCH variance + strong mean reversion + regime switch
        if (low_hurst && low_garch_var && strong_mean_reversion && regime_switch) {
            return stratforge::EntrySignal{.long_signal = true};
        }
        return stratforge::EntrySignal{};
    }

    bool check_close_conditions() override {
        // Close after 10 bars
        static std::size_t bars_in_position = 0;
        if (position().is_long() || position().is_short()) {
            ++bars_in_position;
            if (bars_in_position >= 10) {
                bars_in_position = 0;
                return true;
            }
        } else {
            bars_in_position = 0;
        }
        return false;
    }

private:
    static constexpr std::size_t lookback_window_ = 252;
};
