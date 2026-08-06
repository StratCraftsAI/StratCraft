// TICKET_1292 Phase 5 5B (MC-11): C++ planning-geometry owner parity + boundary.
//
// Proves the pure C++ planner (planning_geometry.hpp + its JSON bridge)
// reproduces the pre-rewire authorities value-identically:
//
//   - CV sizing (requiredPullBars / planPaths / checkRefusal) vs the golden
//     fixture planning_geometry_parity_v1.json captured from the TypeScript
//     cv-sizing-contract.ts BEFORE any consumer was rewired (TICKET_849
//     single source of truth preservation).
//   - Embargo (auto_embargo / effective_memory_bars) vs embargo_parity_v1.json
//     captured from the Python nona_algorithm.signal_sweep.embargo module the
//     resolve_embargo.py subprocess used to invoke.
//
// Plus exhaustive boundary asserts required by the ticket: integer limits,
// thin data (below requiredPullBars), window endpoints (first/last bar),
// missing/invalid inputs + error propagation, and cross-layer agreement
// (the same serialized plan is read identically through the JSON command).

#include "quantnexus/executor/planning_geometry/planning_geometry.hpp"
#include "quantnexus/executor/planning_geometry/planning_geometry_json.hpp"

#include <catch2/catch_test_macros.hpp>

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>

#include <nlohmann/json.hpp>

namespace pg = StratCraft::executor::planning_geometry;
namespace fs = std::filesystem;

namespace {

const fs::path kCvFixture = fs::path{QNX_SOURCE_ROOT} /
    "packages/executor/tests/fixtures/planning_geometry_parity_v1.json";
const fs::path kEmbargoFixture = fs::path{QNX_SOURCE_ROOT} /
    "packages/executor/tests/fixtures/embargo_parity_v1.json";

nlohmann::json load(const fs::path& p) {
    std::ifstream f(p);
    REQUIRE(f.is_open());
    nlohmann::json doc;
    f >> doc;
    return doc;
}

pg::CvSizingContract parse_contract(const nlohmann::json& c) {
    pg::CvSizingContract out;
    out.scheme = *pg::parse_scheme(c.at("scheme").get<std::string>());
    out.totalSegments = c.at("totalSegments").get<int>();
    out.testSegments = c.at("testSegments").get<int>();
    out.embargoBars = c.at("embargoBars").get<int>();
    out.horizonBars = c.at("horizonBars").get<int>();
    out.warmupBars = c.at("warmupBars").get<int>();
    out.netNewBars = c.at("netNewBars").get<int>();
    return out;
}

}  // namespace

TEST_CASE("CV sizing math is value-identical to the TS contract", "[planning_geometry]") {
    const auto fixture = load(kCvFixture);
    REQUIRE(fixture.at("version").get<int>() == 1);
    const auto& cases = fixture.at("cases");
    REQUIRE(cases.size() > 500);  // full boundary matrix captured

    std::size_t checkedPaths = 0;
    for (const auto& tc : cases) {
        const std::string label = tc.at("label").get<std::string>();
        INFO("case " << label);
        const auto c = parse_contract(tc.at("contract"));
        const auto totalBars = tc.at("totalBars").get<std::int64_t>();

        // 1. requiredPullBars parity (bar sufficiency threshold).
        REQUIRE(pg::required_pull_bars(c) == tc.at("requiredPullBars").get<std::int64_t>());

        // 2. checkRefusal parity (presence + all fields).
        const auto refusal = pg::check_refusal(c, totalBars);
        const auto& expRefusal = tc.at("refusal");
        if (expRefusal.is_null()) {
            REQUIRE_FALSE(refusal.has_value());
        } else {
            REQUIRE(refusal.has_value());
            CHECK(refusal->totalBars == expRefusal.at("totalBars").get<std::int64_t>());
            CHECK(refusal->requiredPullBars == expRefusal.at("requiredPullBars").get<std::int64_t>());
            CHECK(refusal->perPathIsBars == expRefusal.at("perPathIsBars").get<std::int64_t>());
            CHECK(refusal->floorRequired == expRefusal.at("floorRequired").get<std::int64_t>());
            CHECK(refusal->embargoBars == expRefusal.at("embargoBars").get<int>());
            CHECK(refusal->totalSegments == expRefusal.at("totalSegments").get<int>());
            CHECK(refusal->testSegments == expRefusal.at("testSegments").get<int>());
        }

        // 3. planPaths parity (only when not refused, matching the generator).
        const auto& expPaths = tc.at("paths");
        if (expPaths.empty()) continue;
        const auto paths = pg::plan_paths(c, totalBars);
        REQUIRE(paths.size() == expPaths.size());
        for (std::size_t i = 0; i < paths.size(); ++i) {
            const auto& got = paths[i];
            const auto& exp = expPaths[i];
            INFO("path " << i);
            CHECK(got.pathIndex == exp.at("pathIndex").get<int>());
            CHECK(got.totalPaths == exp.at("totalPaths").get<std::int64_t>());
            CHECK(got.isStartBar == exp.at("isStartBar").get<std::int64_t>());
            CHECK(got.isEndBar == exp.at("isEndBar").get<std::int64_t>());
            CHECK(got.oosStartBar == exp.at("oosStartBar").get<std::int64_t>());
            CHECK(got.oosEndBar == exp.at("oosEndBar").get<std::int64_t>());
            CHECK(got.purgedBars == exp.at("purgedBars").get<std::int64_t>());
            const auto expIdx = exp.at("testSegmentIndices").get<std::vector<int>>();
            CHECK(got.testSegmentIndices == expIdx);
            ++checkedPaths;
        }
    }
    REQUIRE(checkedPaths > 0);
}

TEST_CASE("Embargo derivation is value-identical to the Python module", "[planning_geometry]") {
    const auto fixture = load(kEmbargoFixture);
    REQUIRE(fixture.at("version").get<int>() == 1);
    const auto& cases = fixture.at("cases");
    REQUIRE(cases.size() >= 20);

    for (const auto& tc : cases) {
        const std::string templateId = tc.at("templateId").get<std::string>();
        INFO("template " << templateId);
        // Drive the parse through the SAME JSON bridge the command uses.
        nlohmann::json req = tc;
        req["params"] = tc.at("params");
        const pg::MemoryKind kind = pg::memory_kind_for(templateId);
        const pg::EmbargoParams params = pg::parse_embargo_params(req);
        CHECK(pg::effective_memory_bars(kind, params) ==
              tc.at("effectiveMemoryBars").get<int>());
        CHECK(pg::auto_embargo(kind, params) == tc.at("embargoBars").get<int>());
    }
}

TEST_CASE("binomial and combinations are exact integer arithmetic", "[planning_geometry]") {
    CHECK(pg::binomial(0, 0) == 1);
    CHECK(pg::binomial(5, 0) == 1);
    CHECK(pg::binomial(5, 5) == 1);
    CHECK(pg::binomial(5, 2) == 10);
    CHECK(pg::binomial(12, 3) == 220);
    CHECK(pg::binomial(12, 6) == 924);
    CHECK(pg::binomial(3, 5) == 0);   // k > n
    CHECK(pg::binomial(4, -1) == 0);  // k < 0

    const auto combos = pg::combinations_by_index(4, 2);
    REQUIRE(combos.size() == 6);
    CHECK(combos.front() == std::vector<int>{0, 1});  // lexicographic first
    CHECK(combos.back() == std::vector<int>{2, 3});   // lexicographic last
}

TEST_CASE("boundary: thin data refuses, generous data admits", "[planning_geometry]") {
    // warmup=362 walk-forward k=5 -> a Run #51-style contract.
    const auto c = pg::build_walk_forward_contract(/*folds*/ 5, /*embargo*/ 24,
                                                   /*horizon*/ 0, /*warmup*/ 362,
                                                   /*netNew*/ 600);
    const auto required = pg::required_pull_bars(c);
    REQUIRE(required > 362);

    // Thin data (1 bar below the threshold) refuses.
    const auto refusalThin = pg::check_refusal(c, required - 1);
    REQUIRE(refusalThin.has_value());
    CHECK(refusalThin->requiredPullBars == required);

    // Exactly at the threshold admits (by-construction invariant: no refusal
    // implies every planned path clears the warmup floor).
    REQUIRE_FALSE(pg::check_refusal(c, required).has_value());
    const auto paths = pg::plan_paths(c, required);
    REQUIRE(paths.size() == 5);  // walk_forward emits N-1 paths
}

TEST_CASE("boundary: window endpoints and remainder accrual", "[planning_geometry]") {
    // A 3-segment walk-forward (folds=2). The last test-bearing segment must
    // extend to exactly totalBars (remainder accrues to the last segment; no
    // silent drops).
    const auto c = pg::build_walk_forward_contract(2, 0, 0, 0, 1);
    const std::int64_t totalBars = 101;  // deliberately not divisible
    const auto paths = pg::plan_paths(c, totalBars);
    REQUIRE(paths.size() == 2);
    // Last path's OOS ends at the final bar boundary.
    CHECK(paths.back().oosEndBar == totalBars);
    // First path starts at the window origin.
    CHECK(paths.front().isStartBar == 0);
}

TEST_CASE("boundary: snapshot window projection through the real calendar", "[planning_geometry]") {
    // Sparse calendar: bar indices must map through the actual timestamps,
    // never a dense grid. Exclusive-end index at totalBars -> lastTs + barMs.
    std::vector<std::int64_t> calendar = {1000, 1500, 3000, 3200, 9000};
    const std::int64_t barMs = 60000;
    CHECK(pg::bar_index_to_ms(0, calendar, barMs) == 1000);
    CHECK(pg::bar_index_to_ms(2, calendar, barMs) == 3000);
    CHECK(pg::bar_index_to_ms(4, calendar, barMs) == 9000);
    // Exclusive end past the last bar -> close boundary of the last bar.
    CHECK(pg::bar_index_to_ms(5, calendar, barMs) == 9000 + barMs);
}

TEST_CASE("boundary: deterministic deficit allocation core", "[planning_geometry]") {
    using P = std::pair<std::string, int>;
    // batchSize <= #keys: top-k get 1 each.
    {
        std::vector<P> ordered = {{"a", 10}, {"b", 5}, {"c", 3}};
        const auto alloc = pg::proportional_deficit_allocation(ordered, 2);
        REQUIRE(alloc.size() == 2);
        CHECK(alloc[0].key == "a");
        CHECK(alloc[0].iterations == 1);
        CHECK(alloc[1].key == "b");
    }
    // batchSize > #keys: proportional split with residual to the top key.
    {
        std::vector<P> ordered = {{"a", 6}, {"b", 4}};
        const auto alloc = pg::proportional_deficit_allocation(ordered, 10);
        REQUIRE(alloc.size() == 2);
        int total = 0;
        for (const auto& e : alloc) total += e.iterations;
        CHECK(total == 10);  // residual absorbed
        CHECK(alloc[0].key == "a");
    }
    // Zero total deficit -> empty (caller applies the uniform branch).
    {
        std::vector<P> ordered = {};
        const auto alloc = pg::proportional_deficit_allocation(ordered, 5);
        CHECK(alloc.empty());
    }
}

TEST_CASE("error propagation: malformed contracts and requests throw", "[planning_geometry]") {
    // Invalid contract: k >= N.
    pg::CvSizingContract bad;
    bad.scheme = pg::CvScheme::cpcv;
    bad.totalSegments = 3;
    bad.testSegments = 3;
    CHECK_THROWS(pg::required_pull_bars(bad));

    // totalSegments < 2.
    pg::CvSizingContract bad2;
    bad2.totalSegments = 1;
    CHECK_THROWS(pg::validate_contract(bad2));

    // plan_paths on non-positive totalBars.
    const auto ok = pg::build_walk_forward_contract(3, 0, 0, 0, 1);
    CHECK_THROWS(pg::plan_paths(ok, 0));
    CHECK_THROWS(pg::plan_paths(ok, -5));

    // JSON bridge: unknown kind.
    CHECK_THROWS(pg::run_planning_geometry(
        nlohmann::json{{"version", 1}, {"kind", "does_not_exist"}}));
    // JSON bridge: wrong version.
    CHECK_THROWS(pg::run_planning_geometry(
        nlohmann::json{{"version", 999}, {"kind", "required_pull_bars"}}));
    // JSON bridge: unknown scheme.
    CHECK_THROWS(pg::run_planning_geometry(nlohmann::json{
        {"version", 1}, {"kind", "required_pull_bars"},
        {"contract", {{"scheme", "nope"}, {"totalSegments", 2}, {"testSegments", 1}}}}));
}

TEST_CASE("cross-layer agreement: JSON command reproduces the struct plan", "[planning_geometry]") {
    // One serialized request must yield the same numbers as the direct struct
    // API -- proving UI admission / storage / executor all agree from one plan.
    nlohmann::json req{
        {"version", 1},
        {"kind", "plan"},
        {"contract",
         {{"scheme", "walk_forward"}, {"totalSegments", 6}, {"testSegments", 1},
          {"embargoBars", 5}, {"horizonBars", 0}, {"warmupBars", 100}, {"netNewBars", 600}}},
        {"totalBars", 4000},
    };
    const auto out = pg::run_planning_geometry(req);
    REQUIRE(out.at("version").get<int>() == 1);

    const auto c = pg::build_walk_forward_contract(5, 5, 0, 100, 600);
    CHECK(out.at("requiredPullBars").get<std::int64_t>() == pg::required_pull_bars(c));
    const auto paths = pg::plan_paths(c, 4000);
    REQUIRE(out.at("paths").size() == paths.size());
    for (std::size_t i = 0; i < paths.size(); ++i) {
        CHECK(out.at("paths")[i].at("isEndBar").get<std::int64_t>() == paths[i].isEndBar);
        CHECK(out.at("paths")[i].at("oosEndBar").get<std::int64_t>() == paths[i].oosEndBar);
    }

    // ms projection through the command matches bar_index_to_ms.
    std::vector<std::int64_t> cal;
    cal.reserve(4000);
    for (std::int64_t i = 0; i < 4000; ++i) cal.push_back(1'700'000'000'000 + i * 60000);
    nlohmann::json req2 = req;
    req2["barTimestampsMs"] = cal;
    req2["barMs"] = 60000;
    const auto out2 = pg::run_planning_geometry(req2);
    CHECK(out2.at("paths")[0].at("isStartMs").get<std::int64_t>() == cal[0]);
}
