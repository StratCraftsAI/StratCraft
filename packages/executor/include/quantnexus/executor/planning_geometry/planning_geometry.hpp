#pragma once

// TICKET_1292 Phase 5 cut 5B (MC-11): pure C++23 planning-geometry owner.
//
// This header is the SINGLE SOURCE OF TRUTH (TICKET_849) for all
// deterministic integer/window arithmetic in the signal-discovery
// planning layer:
//
//   1. CV sizing    -- required_pull_bars / plan_paths / check_refusal
//                      (was apps/.../cv-sizing-contract.ts; the TS module
//                      now delegates here through the packaged command).
//   2. Embargo      -- effective_memory_bars / auto_embargo (was the
//                      Python subprocess nona_algorithm.signal_sweep.
//                      resolve_embargo -> embargo.py). Ported verbatim so
//                      the resolve_embargo subprocess is removed.
//   3. Bar sufficiency -- required_pull_bars is the single threshold
//                      (TICKET_880_5_9_5 `requiredPullBars`); refusal is
//                      symbol-agnostic window arithmetic.
//   4. Snapshot windows -- bar-index -> epoch-ms projection through the
//                      real bar calendar (TICKET_1133), no dense-grid
//                      fiction.
//   5. Deficit allocation -- the deterministic proportional-allocation
//                      core (the RNG tie-break shuffle stays in TS; only
//                      the geometry crosses the boundary).
//
// Every value here is bar-space integer arithmetic. There is NO
// equal-segment formula and NO hand-authored HMM floor (both banned by
// TICKET_849). Pure: no IO, no allocation on the hot integer paths, no
// throwing on valid contracts.
//
// The math below is a faithful, value-identical port of the TypeScript
// cv-sizing-contract.ts and the Python embargo.py. Golden parity fixtures
// (planning_geometry_parity_v1.json) captured from BOTH sources before
// the rewire pin this equality byte-for-byte across the boundary matrix.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace StratCraft::executor::planning_geometry {

// =============================================================================
// Frozen contract version
// =============================================================================

// Bumped only on a breaking change to the request/plan schema. Every
// emitted plan carries this so UI admission, storage reads, launchers,
// and executor enforcement can reject a plan they do not understand
// (fail-fast, never silently misinterpret).
inline constexpr int kPlanningGeometryVersion = 1;

// =============================================================================
// Embargo constants (ported verbatim from embargo.py section 3.5.3)
// =============================================================================

// Multiplier on top of effective_memory_bars (Lopez de Prado 2018 Ch. 7
// default of 2x).
inline constexpr int kEmbargoMemoryMultiplier = 2;

// Absolute floor for a memoryless / stateless signal.
inline constexpr int kEmbargoMinBars = 5;

// Feature indicator period defaults (from _features_v3.py). These drive
// the enriched-warmup / max-indicator-lookback embargo scaling for the
// v3/v4 ML templates. Kept here so the C++ owner reproduces
// effective_memory_bars without a Python round-trip.
inline constexpr int kRsiDefault = 14;
inline constexpr int kBbDefault = 20;
inline constexpr int kMacdSlowDefault = 26;
inline constexpr int kMacdSignalDefault = 9;
inline constexpr int kVolLongDefault = 40;

// =============================================================================
// CV scheme
// =============================================================================

enum class CvScheme { walk_forward, cpcv, single_split, expanding };

inline std::string_view to_string(CvScheme scheme) noexcept {
    switch (scheme) {
        case CvScheme::walk_forward: return "walk_forward";
        case CvScheme::cpcv:          return "cpcv";
        case CvScheme::single_split:  return "single_split";
        case CvScheme::expanding:     return "expanding";
    }
    return "walk_forward";
}

inline std::optional<CvScheme> parse_scheme(std::string_view s) noexcept {
    if (s == "walk_forward") return CvScheme::walk_forward;
    if (s == "cpcv")          return CvScheme::cpcv;
    if (s == "single_split")  return CvScheme::single_split;
    if (s == "expanding")     return CvScheme::expanding;
    return std::nullopt;
}

// =============================================================================
// CvSizingContract -- one arm's sizing math, bar-space only
// =============================================================================

struct CvSizingContract {
    CvScheme scheme = CvScheme::walk_forward;
    int totalSegments = 2;  // N in AFML notation
    int testSegments = 1;   // k in AFML notation
    int embargoBars = 0;
    int horizonBars = 0;
    int warmupBars = 0;
    int netNewBars = 0;
};

// Fail-loud validation (CLAUDE.md NO SILENT FAILURES). Mirrors
// cv-sizing-contract.validateContract exactly.
inline void validate_contract(const CvSizingContract& c) {
    const int intFields[] = {c.totalSegments, c.testSegments, c.embargoBars,
                             c.horizonBars, c.warmupBars, c.netNewBars};
    for (int v : intFields) {
        if (v < 0) {
            throw std::invalid_argument(
                "[CvSizingContract] fields must be non-negative integers; got " +
                std::to_string(v));
        }
    }
    if (c.totalSegments < 2) {
        throw std::invalid_argument(
            "[CvSizingContract] totalSegments must be >= 2; got " +
            std::to_string(c.totalSegments));
    }
    if (c.testSegments < 1 || c.testSegments >= c.totalSegments) {
        throw std::invalid_argument(
            "[CvSizingContract] testSegments must be in 1..totalSegments-1; got "
            "testSegments=" + std::to_string(c.testSegments) +
            " totalSegments=" + std::to_string(c.totalSegments));
    }
    if ((c.scheme == CvScheme::walk_forward || c.scheme == CvScheme::expanding) &&
        c.testSegments != 1) {
        throw std::invalid_argument(
            "[CvSizingContract] walk_forward/expanding requires testSegments=1; got " +
            std::to_string(c.testSegments));
    }
    if (c.scheme == CvScheme::single_split &&
        (c.totalSegments != 2 || c.testSegments != 1)) {
        throw std::invalid_argument(
            "[CvSizingContract] single_split requires totalSegments=2 testSegments=1");
    }
}

// -----------------------------------------------------------------------------
// Combinatorics (multiplicative binomial + lexicographic k-subsets),
// value-identical to the TS binomial / combinationsByIndex.
// -----------------------------------------------------------------------------

inline std::int64_t binomial(int n, int k) noexcept {
    if (k < 0 || k > n) return 0;
    if (k == 0 || k == n) return 1;
    std::int64_t result = 1;
    const int kk = std::min(k, n - k);
    // Integer multiplicative form: (result * (n - i + 1)) / i is exact at
    // each step because the partial product is a binomial coefficient.
    for (int i = 1; i <= kk; ++i) {
        result = result * static_cast<std::int64_t>(n - i + 1) / i;
    }
    return result;
}

inline std::vector<std::vector<int>> combinations_by_index(int n, int k) {
    std::vector<std::vector<int>> out;
    std::vector<int> cur;
    cur.reserve(static_cast<std::size_t>(std::max(0, k)));
    // Recursive lexicographic enumeration matching the TS recurse().
    auto recurse = [&](auto&& self, int start, int remaining) -> void {
        if (remaining == 0) {
            out.push_back(cur);
            return;
        }
        for (int i = start; i <= n - remaining; ++i) {
            cur.push_back(i);
            self(self, i + 1, remaining - 1);
            cur.pop_back();
        }
    };
    recurse(recurse, 0, k);
    return out;
}

// countPaths: paths emitted by the contract.
inline std::int64_t count_paths(const CvSizingContract& c) {
    switch (c.scheme) {
        case CvScheme::walk_forward:
        case CvScheme::expanding:
            return std::max(0, c.totalSegments - 1);
        case CvScheme::single_split:
            return 1;
        case CvScheme::cpcv:
            return binomial(c.totalSegments, c.testSegments);
    }
    return 0;
}

// pathsPerSegmentFor: number of paths any given segment appears in as a
// test slice.
inline std::int64_t paths_per_segment_for(const CvSizingContract& c) {
    switch (c.scheme) {
        case CvScheme::walk_forward:
        case CvScheme::expanding:
        case CvScheme::single_split:
            return 1;
        case CvScheme::cpcv:
            return binomial(c.totalSegments - 1, c.testSegments - 1);
    }
    return 1;
}

// -----------------------------------------------------------------------------
// Derivation 1: required_pull_bars (bar sufficiency threshold)
// -----------------------------------------------------------------------------

inline std::int64_t required_pull_bars(const CvSizingContract& c) {
    validate_contract(c);
    const std::int64_t pathsPerSegment = paths_per_segment_for(c);
    // ceil(netNewBars / max(1, pathsPerSegment)), floored at 1.
    const std::int64_t denom = std::max<std::int64_t>(1, pathsPerSegment);
    const std::int64_t perSegmentTestBars =
        std::max<std::int64_t>(1, (static_cast<std::int64_t>(c.netNewBars) + denom - 1) / denom);
    const std::int64_t perSegmentTotalBars =
        perSegmentTestBars + 2LL * c.embargoBars + c.horizonBars;
    const std::int64_t testCapacitySegments =
        c.scheme == CvScheme::cpcv ? c.totalSegments : c.totalSegments - 1;
    const std::int64_t warmupHeadBars =
        static_cast<std::int64_t>(c.warmupBars) + 2 +
        (c.scheme == CvScheme::cpcv ? 0 : c.horizonBars);
    return warmupHeadBars + testCapacitySegments * perSegmentTotalBars;
}

// -----------------------------------------------------------------------------
// Derivation 2: plan_paths (window split / snapshot windows in bar-space)
// -----------------------------------------------------------------------------

struct PlannedPath {
    int pathIndex = 0;
    std::int64_t totalPaths = 0;
    std::vector<int> testSegmentIndices;
    std::int64_t isStartBar = 0;
    std::int64_t isEndBar = 0;
    std::int64_t oosStartBar = 0;
    std::int64_t oosEndBar = 0;
    std::int64_t purgedBars = 0;
};

namespace detail {

struct SegmentBoundary {
    std::int64_t startBar;
    std::int64_t endBar;
};

// bodyBarsFor: bars allocated to the test-bearing body (not the warmup
// head). Value-identical to cv-sizing-contract.bodyBarsFor.
inline std::int64_t body_bars_for(const CvSizingContract& c, std::int64_t totalBars) {
    const std::int64_t pathsPerSegment = paths_per_segment_for(c);
    const std::int64_t denom = std::max<std::int64_t>(1, pathsPerSegment);
    const std::int64_t perSegmentTestBars =
        std::max<std::int64_t>(1, (static_cast<std::int64_t>(c.netNewBars) + denom - 1) / denom);
    const std::int64_t perSegmentTotalBars =
        perSegmentTestBars + 2LL * c.embargoBars + c.horizonBars;
    const std::int64_t testCapacitySegments =
        c.scheme == CvScheme::cpcv ? c.totalSegments : c.totalSegments - 1;
    const std::int64_t idealBody = testCapacitySegments * perSegmentTotalBars;
    return std::min(idealBody, std::max<std::int64_t>(0, totalBars - 1));
}

}  // namespace detail

inline std::vector<PlannedPath> plan_paths(const CvSizingContract& c,
                                           std::int64_t totalBars) {
    validate_contract(c);
    if (totalBars <= 0) {
        throw std::invalid_argument(
            "[plan_paths] totalBars must be a positive integer; got " +
            std::to_string(totalBars));
    }

    const std::int64_t bodyBars0 = detail::body_bars_for(c, totalBars);
    const std::int64_t warmupHeadEnd = std::max<std::int64_t>(0, totalBars - bodyBars0);
    const std::int64_t testCapacitySegments =
        c.scheme == CvScheme::cpcv ? c.totalSegments : c.totalSegments - 1;
    const std::int64_t bodyBars = totalBars - warmupHeadEnd;
    const std::int64_t baseSegBodyWidth =
        testCapacitySegments > 0 ? bodyBars / testCapacitySegments : 0;

    std::vector<detail::SegmentBoundary> testSegments;
    testSegments.reserve(static_cast<std::size_t>(std::max<std::int64_t>(0, testCapacitySegments)));
    for (std::int64_t i = 0; i < testCapacitySegments; ++i) {
        const std::int64_t startBar = warmupHeadEnd + i * baseSegBodyWidth;
        const std::int64_t endBar =
            i == testCapacitySegments - 1
                ? totalBars
                : warmupHeadEnd + (i + 1) * baseSegBodyWidth;
        testSegments.push_back({startBar, endBar});
    }

    const std::int64_t numPaths = count_paths(c);
    std::vector<PlannedPath> out;

    if (c.scheme == CvScheme::cpcv) {
        const auto indexSets = combinations_by_index(c.totalSegments, c.testSegments);
        out.reserve(indexSets.size());
        for (std::size_t p = 0; p < indexSets.size(); ++p) {
            const auto& testIdxs = indexSets[p];
            const int firstTest = testIdxs.front();
            const int lastTest = testIdxs.back();
            const std::int64_t oosStart = testSegments[static_cast<std::size_t>(firstTest)].startBar;
            const std::int64_t oosEnd = testSegments[static_cast<std::size_t>(lastTest)].endBar;
            std::int64_t purgedBars = 0;
            for (int idx : testIdxs) {
                const auto& seg = testSegments[static_cast<std::size_t>(idx)];
                purgedBars += seg.endBar - seg.startBar;
            }
            out.push_back(PlannedPath{
                .pathIndex = static_cast<int>(p),
                .totalPaths = numPaths,
                .testSegmentIndices = testIdxs,
                .isStartBar = 0,
                .isEndBar = totalBars,
                .oosStartBar = oosStart,
                .oosEndBar = oosEnd,
                .purgedBars = purgedBars,
            });
        }
        return out;
    }

    if (c.scheme == CvScheme::single_split) {
        out.push_back(PlannedPath{
            .pathIndex = 0,
            .totalPaths = 1,
            .testSegmentIndices = {0},
            .isStartBar = 0,
            .isEndBar = testSegments[0].startBar,
            .oosStartBar = testSegments[0].startBar,
            .oosEndBar = testSegments[0].endBar,
            .purgedBars = 0,
        });
        return out;
    }

    // walk_forward / expanding
    const std::int64_t K = testCapacitySegments;
    out.reserve(static_cast<std::size_t>(std::max<std::int64_t>(0, K)));
    for (std::int64_t p = 0; p < K; ++p) {
        const auto& testSeg = testSegments[static_cast<std::size_t>(p)];
        out.push_back(PlannedPath{
            .pathIndex = static_cast<int>(p),
            .totalPaths = K,
            .testSegmentIndices = {static_cast<int>(p)},
            .isStartBar = 0,
            .isEndBar = testSeg.startBar,
            .oosStartBar = testSeg.startBar,
            .oosEndBar = testSeg.endBar,
            .purgedBars = 0,
        });
    }
    return out;
}

// -----------------------------------------------------------------------------
// Derivation 3: check_refusal (bar sufficiency gate)
// -----------------------------------------------------------------------------

struct CvRefusal {
    std::int64_t totalBars = 0;
    std::int64_t requiredPullBars = 0;
    std::int64_t perPathIsBars = 0;
    std::int64_t floorRequired = 0;
    int embargoBars = 0;
    int totalSegments = 0;
    int testSegments = 0;
    std::string message;
};

inline std::optional<CvRefusal> check_refusal(const CvSizingContract& c,
                                              std::int64_t totalBars) {
    validate_contract(c);
    if (totalBars <= 0) {
        throw std::invalid_argument(
            "[check_refusal] totalBars must be a positive integer; got " +
            std::to_string(totalBars));
    }
    const std::int64_t required = required_pull_bars(c);
    if (totalBars >= required) {
        return std::nullopt;
    }

    const auto planned = plan_paths(c, totalBars);
    std::int64_t perPathIsBars = std::numeric_limits<std::int64_t>::max();
    for (const auto& p : planned) {
        const std::int64_t span = p.isEndBar - p.isStartBar;
        const std::int64_t isAvail =
            c.scheme == CvScheme::cpcv ? span - p.purgedBars : span - c.horizonBars;
        perPathIsBars = std::min(perPathIsBars, isAvail);
    }
    if (planned.empty()) perPathIsBars = 0;
    const std::int64_t floorRequired =
        static_cast<std::int64_t>(c.warmupBars) + c.embargoBars + 2;

    CvRefusal r;
    r.totalBars = totalBars;
    r.requiredPullBars = required;
    r.perPathIsBars = perPathIsBars;
    r.floorRequired = floorRequired;
    r.embargoBars = c.embargoBars;
    r.totalSegments = c.totalSegments;
    r.testSegments = c.testSegments;
    r.message =
        "Per-path IS budget " + std::to_string(perPathIsBars) + " bars < required " +
        std::to_string(floorRequired) + " (warmup=" + std::to_string(c.warmupBars) +
        " + embargo=" + std::to_string(c.embargoBars) + " + 2). Pull width " +
        std::to_string(totalBars) + " bars < required " + std::to_string(required) +
        " bars under scheme=" + std::string(to_string(c.scheme)) +
        " N=" + std::to_string(c.totalSegments) + " k=" + std::to_string(c.testSegments) +
        ". Increase Training bars (N) or reduce total/test segments.";
    return r;
}

// -----------------------------------------------------------------------------
// Contract builders (walk_forward / single_split), matching the TS
// buildWalkForwardContract / buildSingleSplitContract helpers.
// -----------------------------------------------------------------------------

inline CvSizingContract build_walk_forward_contract(int walkForwardFolds,
                                                    int embargoBars, int horizonBars,
                                                    int warmupBars, int netNewBars) {
    return CvSizingContract{
        .scheme = CvScheme::walk_forward,
        .totalSegments = walkForwardFolds + 1,
        .testSegments = 1,
        .embargoBars = embargoBars,
        .horizonBars = horizonBars,
        .warmupBars = warmupBars,
        .netNewBars = netNewBars,
    };
}

inline CvSizingContract build_single_split_contract(int embargoBars, int horizonBars,
                                                   int warmupBars, int netNewBars) {
    return CvSizingContract{
        .scheme = CvScheme::single_split,
        .totalSegments = 2,
        .testSegments = 1,
        .embargoBars = embargoBars,
        .horizonBars = horizonBars,
        .warmupBars = warmupBars,
        .netNewBars = netNewBars,
    };
}

// =============================================================================
// Embargo derivation (ported verbatim from embargo.py; removes the
// resolve_embargo Python subprocess).
// =============================================================================

// _clamp_period from _features_v3.py: max(2, min(default, max(horizon-1, 5))).
inline int clamp_period(int def, int horizon) noexcept {
    return std::max(2, std::min(def, std::max(horizon - 1, 5)));
}

// max_indicator_lookback(horizon) from _features_v3.py.
inline int v3_max_indicator_lookback(int horizon) noexcept {
    const int macdSlow = clamp_period(kMacdSlowDefault, horizon);
    const int volLong = clamp_period(kVolLongDefault, horizon);
    const int bb = clamp_period(kBbDefault, horizon);
    return std::max({macdSlow, volLong, bb});
}

// multi_tf_max_indicator_lookback(horizon, layers) from _features_v4.py.
// `has1d` / `has4h` mirror the "1d" in layers / "4h" in layers membership
// tests; note the elif precedence (1d wins over 4h).
inline int multi_tf_max_indicator_lookback(int horizon, bool has1d, bool has4h) noexcept {
    int base = v3_max_indicator_lookback(horizon);
    if (has1d) {
        const int rsiP = clamp_period(kRsiDefault, horizon);
        base = std::max(base, rsiP * 24);
    } else if (has4h) {
        const int rsiP = clamp_period(kRsiDefault, horizon);
        base = std::max(base, rsiP * 4);
    }
    return base;
}

// Template memory model kinds. The mapping from template_id -> kind is the
// _MEMORY_FNS registry from embargo.py, reproduced in memory_kind_for().
enum class MemoryKind { none, hmm, gmm, ngram, ml, xgboost_v3 };

// Params relevant to the memory model. All optional; a missing field
// falls back to embargo.py's `params.get(key, default)`.
struct EmbargoParams {
    std::optional<int> nStates;      // hmm n_states (default 3)
    std::optional<int> nComponents;  // gmm n_components (default 3)
    std::optional<int> window;       // hmm/gmm/ml window cap (default 0)
    std::optional<int> k;            // ngram gram length (default 3)
    std::optional<int> tau;          // ngram embedding lag (default 1)
    std::optional<int> lookback;     // ml lookback (falls back to window, then 0)
    std::optional<int> horizon;      // xgboost_v3 horizon (default 5)
    // multi_tf raw string "none" or comma-separated layer list; parsed to
    // membership flags by the caller. Empty => no multi_tf layers.
    bool multiTfHas1d = false;
    bool multiTfHas4h = false;
    bool multiTfAny = false;  // any layer present (multi_tf != "none")
    // recommended_embargo_bars declared on the template PARAM_SCHEMA; a
    // positive value overrides the auto-derivation verbatim (embargo.py
    // _resolve_recommended_embargo). nullopt => absent/non-positive.
    std::optional<int> recommendedEmbargoBars;
};

// effective_memory_bars(template_id, params) from embargo.py. Returns 0
// for an unknown template (MemoryKind::none), matching the registry miss.
inline int effective_memory_bars(MemoryKind kind, const EmbargoParams& p) noexcept {
    switch (kind) {
        case MemoryKind::none:
            return 0;
        case MemoryKind::hmm: {
            const int nStates = p.nStates.value_or(3);
            const int window = p.window.value_or(0);
            const int base = 10 * nStates;
            return window > 0 ? std::min(base, window) : base;
        }
        case MemoryKind::gmm: {
            const int nComponents = p.nComponents.value_or(3);
            const int window = p.window.value_or(0);
            const int base = 10 * nComponents;
            return window > 0 ? std::min(base, window) : base;
        }
        case MemoryKind::ngram: {
            const int k = p.k.value_or(3);
            const int tau = p.tau.value_or(1);
            return k + std::max(0, (k - 1) * (tau - 1));
        }
        case MemoryKind::ml: {
            // lookback, falling back to window, then 0.
            return p.lookback.value_or(p.window.value_or(0));
        }
        case MemoryKind::xgboost_v3: {
            const int lookback = p.lookback.value_or(p.window.value_or(0));
            const int horizon = p.horizon.value_or(5);
            int indLookback;
            if (p.multiTfAny) {
                indLookback = multi_tf_max_indicator_lookback(horizon, p.multiTfHas1d,
                                                              p.multiTfHas4h);
            } else {
                indLookback = v3_max_indicator_lookback(horizon);
            }
            return std::max(lookback, indLookback + horizon);
        }
    }
    return 0;
}

// auto_embargo(template_id, params) from embargo.py.
//   1. recommended_embargo_bars (positive) overrides verbatim.
//   2. otherwise max(kEmbargoMinBars, kEmbargoMemoryMultiplier * memory).
inline int auto_embargo(MemoryKind kind, const EmbargoParams& p) noexcept {
    if (p.recommendedEmbargoBars.has_value() && *p.recommendedEmbargoBars > 0) {
        return *p.recommendedEmbargoBars;
    }
    const int memory = effective_memory_bars(kind, p);
    return std::max(kEmbargoMinBars, kEmbargoMemoryMultiplier * memory);
}

// template_id -> MemoryKind, reproducing embargo.py _MEMORY_FNS. A miss
// returns MemoryKind::none (unknown template => memory 0 => min-bars
// embargo), matching the Python registry semantics exactly.
inline MemoryKind memory_kind_for(std::string_view templateId) noexcept {
    if (templateId == "hmm_regime_v1") return MemoryKind::hmm;
    if (templateId == "gmm_regime_v1") return MemoryKind::gmm;
    if (templateId == "ngram_next_bar_v1") return MemoryKind::ngram;
    // _ml_memory_bars family.
    if (templateId == "sklearn_ridge_return_v1" ||
        templateId == "sklearn_lasso_return_v1" ||
        templateId == "sklearn_random_forest_return_v1" ||
        templateId == "sklearn_logistic_return_v1" ||
        templateId == "xgboost_return_v1" ||
        templateId == "xgboost_return_v2" ||
        templateId == "lightgbm_return_v1" ||
        templateId == "pytorch_mlp_return_v1" ||
        templateId == "pytorch_lstm_return_v1" ||
        templateId == "pytorch_gru_return_v1" ||
        templateId == "pytorch_tcn_return_v1" ||
        templateId == "pytorch_ts_transformer_return_v1" ||
        templateId == "sklearn_elasticnet_return_v1" ||
        templateId == "sklearn_bayesian_ridge_return_v1" ||
        templateId == "sklearn_gp_return_v1" ||
        templateId == "isolation_forest_anomaly_v1" ||
        templateId == "sklearn_knn_return_v1" ||
        templateId == "kalman_filter_v1") {
        return MemoryKind::ml;
    }
    // _xgboost_v3_memory_bars family.
    if (templateId == "xgboost_return_v3" ||
        templateId == "catboost_return_v2" ||
        templateId == "double_ensemble_return_v2" ||
        templateId == "ft_transformer_return_v1" ||
        templateId == "lightgbm_return_v2" ||
        templateId == "sklearn_random_forest_return_v2" ||
        templateId == "sklearn_ridge_return_v2" ||
        templateId == "sklearn_lasso_return_v2" ||
        templateId == "sklearn_elasticnet_return_v2" ||
        templateId == "sklearn_bayesian_ridge_return_v2" ||
        templateId == "sklearn_logistic_return_v2" ||
        templateId == "sklearn_knn_return_v2" ||
        templateId == "sklearn_gp_return_v2") {
        return MemoryKind::xgboost_v3;
    }
    return MemoryKind::none;
}

// =============================================================================
// Snapshot windows -- bar-index -> epoch-ms projection (TICKET_1133).
// =============================================================================

// Project a bar index to epoch ms through the REAL bar calendar. An
// exclusive-end index at/after totalBars maps to lastBarTs + barMs (the
// close boundary of the last bar), NEVER the dense-grid projection.
// `calendar` is ascending epoch-ms timestamps, one per in-window bar.
inline std::int64_t bar_index_to_ms(std::int64_t barIndex,
                                    const std::vector<std::int64_t>& calendar,
                                    std::int64_t barMs) {
    const std::int64_t totalBars = static_cast<std::int64_t>(calendar.size());
    if (barIndex >= totalBars) {
        return calendar[static_cast<std::size_t>(totalBars - 1)] + barMs;
    }
    return calendar[static_cast<std::size_t>(barIndex)];
}

// =============================================================================
// Deficit allocation -- deterministic proportional core (TICKET_868).
// The RNG tie-break shuffle stays in TS; this owns only the window/integer
// geometry: target, per-key deficit, proportional split, rounding residual.
// =============================================================================

struct AllocationEntry {
    std::string key;
    int iterations;
};

// Deterministic proportional allocation given an ALREADY-ORDERED list of
// (key, deficit) pairs sorted by deficit descending (the TS layer performs
// the RNG shuffle of tied groups before calling; passing the ordered list
// keeps this pure and deterministic). Mirrors computeDeficitAllocation
// steps 4-7 exactly for the non-uniform branch.
inline std::vector<AllocationEntry> proportional_deficit_allocation(
    const std::vector<std::pair<std::string, int>>& orderedWithDeficit,
    int batchSize) {
    std::vector<AllocationEntry> result;
    std::int64_t totalDeficit = 0;
    for (const auto& [k, d] : orderedWithDeficit) totalDeficit += d;
    if (totalDeficit == 0 || orderedWithDeficit.empty()) {
        return result;  // caller handles the uniform / empty branch
    }

    // Step 5: batchSize <= #deficit keys -> pick top batchSize, 1 each.
    if (static_cast<std::size_t>(batchSize) <= orderedWithDeficit.size()) {
        result.reserve(static_cast<std::size_t>(std::max(0, batchSize)));
        for (int i = 0; i < batchSize; ++i) {
            result.push_back({orderedWithDeficit[static_cast<std::size_t>(i)].first, 1});
        }
        return result;
    }

    // Step 6: proportional allocation.
    std::int64_t allocated = 0;
    result.reserve(orderedWithDeficit.size());
    for (const auto& [k, d] : orderedWithDeficit) {
        const double raw = static_cast<double>(batchSize) * d /
                           static_cast<double>(totalDeficit);
        // Math.round: round-half-up on .5 (banker's-rounding-free), matching JS.
        const int rounded = std::max(1, static_cast<int>(std::floor(raw + 0.5)));
        result.push_back({k, rounded});
        allocated += rounded;
    }
    // Step 7: rounding residual to the largest-deficit (first) key.
    const int residual = batchSize - static_cast<int>(allocated);
    if (residual != 0) {
        const int adjusted = result[0].iterations + residual;
        if (adjusted < 1) {
            throw std::runtime_error(
                "Deficit allocation residual error: adjusted iterations=" +
                std::to_string(adjusted) + ", residual=" + std::to_string(residual));
        }
        result[0].iterations = adjusted;
    }
    return result;
}

}  // namespace StratCraft::executor::planning_geometry
