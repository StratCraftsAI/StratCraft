// TICKET_1292_10 (MC-10): C++ resource-governance owner parity.
//
// Reads the language-neutral golden fixture
// tests/signal/fixtures/resource_governance_parity_v1.json (generated from the
// retained-as-drift-reference Python engines: resource_gate.ResourceGate,
// resource_watchdog.resolve_cell_budget_mb, the RssSentinel budget ladder, and
// the cgroup-fence cap->limit arithmetic) and asserts the C++ owner reproduces
// every transition edge / verdict / budget / cgroup limit byte-for-byte. The
// desktop resource-governance-runner test reads the SAME fixture, so all three
// languages agree on one contract.
//
// Plus targeted asserts on the parity traps that MUST NOT regress:
//   (1) OR-pause / AND-resume shape (the tighter axis trips the gate),
//   (2) the first-sample swap-delta seam (delta 0 -> never pauses on growth alone),
//   (3) the degrade->abort ladder ordering (first breach degrades, not aborts),
//   (4) resolve_cell_budget_mb = min(24 GB, 0.40 * MemTotal),
//   (5) cgroup cap->limit integer-GiB truncation matching bash arithmetic.

#include "quantnexus/executor/resource_governance/resource_governance.hpp"
#include "quantnexus/executor/resource_governance/resource_governance_json.hpp"

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include <filesystem>
#include <fstream>
#include <string>

#include <nlohmann/json.hpp>

namespace fs = std::filesystem;
namespace rg = StratCraft::executor::resource_governance;
using Catch::Matchers::WithinAbs;

namespace {

const fs::path kFixture = fs::path{QNX_SOURCE_ROOT} /
    "packages/executor/tests/signal/fixtures/resource_governance_parity_v1.json";

constexpr double kAbsTol = 1e-9;

nlohmann::json read_fixture() {
    std::ifstream input(kFixture);
    REQUIRE(input.is_open());
    nlohmann::json value;
    input >> value;
    return value;
}

// Compare produced vs expected envelope: strings/bools/ints exact, doubles WithinAbs.
void expect_envelope_equal(const nlohmann::json& got, const nlohmann::json& want,
                           const std::string& label) {
    INFO("case: " << label);
    REQUIRE(got.size() == want.size() + 1);
    REQUIRE(got.at("decisionId") == "test-resource-governance");
    for (const auto& [key, want_val] : want.items()) {
        INFO("field: " << key);
        REQUIRE(got.contains(key));
        const auto& got_val = got.at(key);
        if (want_val.is_number_float()) {
            REQUIRE_THAT(got_val.get<double>(),
                         WithinAbs(want_val.get<double>(), kAbsTol));
        } else {
            REQUIRE(got_val == want_val);
        }
    }
}

nlohmann::json run_with_decision_id(nlohmann::json request) {
    request["decisionId"] = "test-resource-governance";
    return rg::run_resource_governance(request);
}

}  // namespace

TEST_CASE("resource-governance golden parity vs Python engines", "[resource_governance]") {
    const nlohmann::json fixture = read_fixture();

    SECTION("swap-pressure classifier") {
        for (const auto& c : fixture.at("swapPressure")) {
            expect_envelope_equal(
                run_with_decision_id(c.at("input")), c.at("expected"),
                c.at("label").get<std::string>());
        }
    }

    SECTION("hysteresis state machine") {
        for (const auto& c : fixture.at("hysteresis")) {
            expect_envelope_equal(
                run_with_decision_id(c.at("input")), c.at("expected"),
                c.at("label").get<std::string>());
        }
    }

    SECTION("budget ladder + cell budget") {
        for (const auto& c : fixture.at("budget")) {
            expect_envelope_equal(
                run_with_decision_id(c.at("input")), c.at("expected"),
                c.at("label").get<std::string>());
        }
    }

    SECTION("capacity cgroup cap->limit derivation") {
        for (const auto& c : fixture.at("capacity")) {
            expect_envelope_equal(
                run_with_decision_id(c.at("input")), c.at("expected"),
                c.at("label").get<std::string>());
        }
    }

    // TICKET_1292_12 (MC-12): sweep-admission is the same arm-admission decision
    // resolveSweepParallelism owned in TS. Golden values are the TS formula
    // evaluated by hand (single-arm, factor no-gate, cost-split, memory clamp).
    SECTION("sweep-admission resolveSweepParallelism parity") {
        for (const auto& c : fixture.at("sweepAdmission")) {
            expect_envelope_equal(
                run_with_decision_id(c.at("input")), c.at("expected"),
                c.at("label").get<std::string>());
        }
    }
}

TEST_CASE("resource-governance requires and echoes decisionId",
          "[resource_governance]") {
    nlohmann::json request{
        {"kind", "swap-pressure"},
        {"estimatedPeakMB", 1000.0},
        {"memAvailableMB", 8000.0},
        {"memTotalMB", 16000.0},
    };
    REQUIRE_THROWS_WITH(
        rg::run_resource_governance(request),
        "resource-governance: decisionId must be a non-empty string");
    request["decisionId"] = "resource-profile-1";
    REQUIRE(rg::run_resource_governance(request).at("decisionId") ==
            "resource-profile-1");
}

TEST_CASE("swap-pressure three tiers", "[resource_governance]") {
    // likely: peak exceeds available.
    REQUIRE(rg::classify_swap_pressure(9000.0, 8000.0, 16000.0) ==
            rg::SwapPressure::Likely);
    // unlikely: peak >= 0.85 * available (6800), even if it fits.
    REQUIRE(rg::classify_swap_pressure(7000.0, 8000.0, 16000.0) ==
            rg::SwapPressure::Unlikely);
    // none: comfortably below the high-mem fraction.
    REQUIRE(rg::classify_swap_pressure(1000.0, 8000.0, 16000.0) ==
            rg::SwapPressure::None);
    // boundary: exactly at the fraction is unlikely (>=), one below is none.
    REQUIRE(rg::classify_swap_pressure(6800.0, 8000.0, 16000.0) ==
            rg::SwapPressure::Unlikely);
    REQUIRE(rg::classify_swap_pressure(6799.0, 8000.0, 16000.0) ==
            rg::SwapPressure::None);
}

TEST_CASE("hysteresis OR-pause / AND-resume + swap-delta seam", "[resource_governance]") {
    rg::HysteresisConfig cfg;  // defaults: pause 30, resume 40, swap 70/60, growth 500/0
    rg::HysteresisGate gate(cfg);

    // Trap (1): OR-pause -- the tighter axis trips. cpu below floor pauses even
    // with healthy mem/swap.
    rg::ResourceSnapshot ok{.mem_headroom_pct = 80.0, .cpu_headroom_pct = 80.0,
                            .swap_used_pct = 0.0};
    REQUIRE(gate.update(ok) == rg::GateTransition::None);
    rg::ResourceSnapshot cpu_tight{
        .mem_headroom_pct = 80.0, .cpu_headroom_pct = 10.0, .swap_used_pct = 0.0};
    REQUIRE(gate.update(cpu_tight) == rg::GateTransition::Pause);
    REQUIRE(gate.paused());

    // AND-resume: mem recovered but cpu still tight -> no resume.
    rg::ResourceSnapshot cpu_still_tight{
        .mem_headroom_pct = 90.0, .cpu_headroom_pct = 20.0, .swap_used_pct = 0.0};
    REQUIRE(gate.update(cpu_still_tight) == rg::GateTransition::None);
    REQUIRE(gate.paused());
    // Both axes recovered above resume line -> resume.
    rg::ResourceSnapshot recovered{
        .mem_headroom_pct = 90.0, .cpu_headroom_pct = 90.0, .swap_used_pct = 0.0};
    REQUIRE(gate.update(recovered) == rg::GateTransition::Resume);
    REQUIRE_FALSE(gate.paused());
}

TEST_CASE("hysteresis swap-delta first-sample seam", "[resource_governance]") {
    // Trap (2): the opening sample has delta 0 even if swap_used_mb is huge, so
    // it never pauses on growth alone. The F2 absolute breaker still guards it.
    rg::HysteresisGate gate(rg::HysteresisConfig{});
    rg::ResourceSnapshot first{.mem_headroom_pct = 80.0,
                               .cpu_headroom_pct = 80.0,
                               .swap_used_pct = 10.0,
                               .swap_used_mb = 100000.0};
    // Below the 70% absolute line, delta 0 -> no pause on the first sample.
    REQUIRE(gate.update(first) == rg::GateTransition::None);
    // Second sample grows +600 MB (> 500) -> pause on growth.
    rg::ResourceSnapshot second{.mem_headroom_pct = 80.0,
                                .cpu_headroom_pct = 80.0,
                                .swap_used_pct = 10.0,
                                .swap_used_mb = 100600.0};
    REQUIRE(gate.update(second) == rg::GateTransition::Pause);
}

TEST_CASE("budget degrade->abort ladder", "[resource_governance]") {
    // Trap (3): first breach degrades (not abort); persisting breach aborts.
    REQUIRE(rg::evaluate_budget(1000.0, 24000.0, false) == rg::BudgetVerdict::Ok);
    REQUIRE(rg::evaluate_budget(30000.0, 24000.0, false) ==
            rg::BudgetVerdict::Degrade);
    REQUIRE(rg::evaluate_budget(30000.0, 24000.0, true) ==
            rg::BudgetVerdict::Abort);
}

TEST_CASE("resolve_cell_budget_mb = min(24GB, 0.40*MemTotal)", "[resource_governance]") {
    // Trap (4): 24 GB hard cap wins on a large box; 40% fraction on a small box.
    const double large = 128.0 * rg::kBytesPerGb;
    REQUIRE_THAT(rg::resolve_cell_budget_mb(large),
                 WithinAbs(24.0 * rg::kMbPerGb, kAbsTol));  // 24576 MB
    const double small = 32.0 * rg::kBytesPerGb;
    REQUIRE_THAT(rg::resolve_cell_budget_mb(small),
                 WithinAbs(0.40 * 32.0 * rg::kMbPerGb, kAbsTol));  // 13107.2 MB
}

TEST_CASE("capacity cgroup cap->limit integer-GiB truncation", "[resource_governance]") {
    // Trap (5): matches bash `$(( ))` truncation exactly. 62 GiB @ 30% = 18 GiB.
    rg::CapacityRequest req;
    req.machine.ncpu = 16;
    req.machine.mem_total_bytes = 62.0 * rg::kBytesPerGb;
    req.cap_pct = 30.0;
    const rg::CapacityDecision d = rg::solve_capacity(req);
    REQUIRE(d.cgroup_memory_max_gib == 18);      // int(62*0.30)=18
    REQUIRE(d.cgroup_memory_high_gib == 16);      // 18*92/100=16 (trunc)
    REQUIRE(d.cgroup_swap_max_gib == 3);          // 18/6=3
    REQUIRE(d.cgroup_cpu_quota_pct == 480);       // 30*16
    REQUIRE_THAT(d.gov_pause_pct, WithinAbs(30.0, kAbsTol));
    REQUIRE_THAT(d.gov_resume_pct, WithinAbs(40.0, kAbsTol));
}

TEST_CASE("sweep-admission parity traps", "[resource_governance]") {
    // Trap (6a): a single arm never parallelises regardless of cores/memory
    // (resolveSweepParallelism:10663).
    {
        rg::SweepAdmissionRequest req;
        req.arm_count = 1;
        req.ncpu = 16;
        const rg::SweepAdmissionDecision d = rg::solve_sweep_admission(req);
        REQUIRE(d.concurrency == 1);
        REQUIRE(d.blas_threads_per_worker == 16);  // floor(16/1)
    }

    // Trap (6b): factor / non-ML sweeps (perArmBytes == 0) skip the memory gate;
    // concurrency is the pure CPU baseline min(cores, arms, maxConc).
    {
        rg::SweepAdmissionRequest req;
        req.arm_count = 20;
        req.ncpu = 16;
        req.max_concurrency = 3;
        const rg::SweepAdmissionDecision d = rg::solve_sweep_admission(req);
        REQUIRE(d.concurrency == 3);
        REQUIRE_FALSE(d.memory_gate_clamped);
        REQUIRE(d.blas_threads_per_worker == 5);  // floor(16/3)
    }

    // Trap (6c): cost re-split only above a 2x arm, floored at 2
    // (resolveSweepParallelism:10672-10674). baseline 6 / cost 3 = 2.
    {
        rg::SweepAdmissionRequest req;
        req.arm_count = 8;
        req.ncpu = 16;
        req.max_concurrency = 6;
        req.max_arm_cost_factor = 3.0;
        const rg::SweepAdmissionDecision d = rg::solve_sweep_admission(req);
        REQUIRE(d.cpu_baseline == 2);
        REQUIRE(d.concurrency == 2);
        REQUIRE(d.blas_threads_per_worker == 8);  // floor(16/2)
    }

    // Trap (6d): the memory gate clamps below the CPU baseline. baseline 6, but
    // (40 GB - 15 GiB reserve) / 6 GB per arm = 3 workers.
    {
        rg::SweepAdmissionRequest req;
        req.arm_count = 10;
        req.ncpu = 16;
        req.max_concurrency = 6;
        req.per_arm_bytes = 6.0e9;
        req.mem_available_bytes = 40.0e9;
        const rg::SweepAdmissionDecision d = rg::solve_sweep_admission(req);
        REQUIRE(d.cpu_baseline == 6);
        REQUIRE(d.memory_cap == 3);
        REQUIRE(d.memory_gate_clamped);
        REQUIRE(d.concurrency == 3);
    }

    // estimate_per_arm_fit_bytes: 0 for degenerate inputs (skips the gate),
    // symbolCount*bars*featureDim*8 otherwise (FIT_MATRIX_BYTES_PER_CELL).
    REQUIRE(rg::estimate_per_arm_fit_bytes(0, 1000, 48) == 0.0);
    REQUIRE_THAT(rg::estimate_per_arm_fit_bytes(28, 8000, 48),
                 WithinAbs(28.0 * 8000.0 * 48.0 * 8.0, kAbsTol));
}

TEST_CASE("hysteresis config validation rejects inverted thresholds", "[resource_governance]") {
    rg::HysteresisConfig bad;
    bad.pause_pct = 40.0;
    bad.resume_pct = 30.0;  // resume < pause
    REQUIRE_FALSE(bad.validation_error().empty());

    nlohmann::json doc = {
        {"kind", "hysteresis"},
        {"config", {{"pausePct", 40.0}, {"resumePct", 30.0}, {"enabled", true}}},
        {"samples", nlohmann::json::array()},
    };
    REQUIRE_THROWS_AS(rg::run_resource_governance(doc), std::runtime_error);
}

TEST_CASE("unknown kind throws", "[resource_governance]") {
    REQUIRE_THROWS_AS(
        rg::run_resource_governance(nlohmann::json{{"kind", "bogus"}}),
        std::runtime_error);
}
