// TICKET_1292_12 (MC-12): unit + golden tests for the C++ sweep-scheduler owner.
//
// Two layers, mirroring test_resource_governance.cpp:
//   1. A JSON golden fixture (scheduler_parity_v1.json) drives the packaged
//      command boundary (run_scheduler) for representative plan / retry /
//      resume cases -- the exact envelopes the TS driver will consume.
//   2. Direct TEST_CASEs on the pure functions assert the parity traps that
//      MUST NOT regress: the ASHA comparator + floor + guard-bar (byte-for-byte
//      vs asha-screening.ts), retry classification, resume-skip, and the full
//      rung0 -> barrier -> rung1 batch state-machine progression.

#include "quantnexus/executor/scheduler/scheduler.hpp"
#include "quantnexus/executor/scheduler/scheduler_json.hpp"

#include <catch2/catch_test_macros.hpp>

#include <nlohmann/json.hpp>

#include <fstream>
#include <string>
#include <vector>

namespace sch = StratCraft::executor::scheduler;

namespace {

#ifndef QNX_SOURCE_ROOT
#error "QNX_SOURCE_ROOT must be defined by the build"
#endif

const std::string kFixture =
    std::string(QNX_SOURCE_ROOT) +
    "/packages/executor/tests/signal/fixtures/scheduler_parity_v1.json";

nlohmann::json read_fixture() {
    std::ifstream input(kFixture);
    REQUIRE(input.is_open());
    nlohmann::json value;
    input >> value;
    return value;
}

void expect_envelope_equal(const nlohmann::json& got, const nlohmann::json& want,
                           const std::string& label) {
    INFO("case: " << label);
    const bool has_decision_id = got.contains("decisionId");
    REQUIRE(got.size() == want.size() + (has_decision_id ? 1U : 0U));
    if (has_decision_id) {
        const std::string decision_id = got.at("decisionId").get<std::string>();
        REQUIRE(decision_id.starts_with("sched-"));
        REQUIRE(decision_id.size() == 22);
    }
    for (const auto& [key, want_val] : want.items()) {
        INFO("field: " << key);
        REQUIRE(got.contains(key));
        REQUIRE(got.at(key) == want_val);
    }
}

// Build an ok rung-0 outcome with a score.
sch::ArmOutcome ok0(int ord, double score, double sharpe = 0.0,
                    double trades = 100.0) {
    sch::ArmOutcome o;
    o.arm_ordinal = ord;
    o.status = sch::ArmStatus::Ok;
    o.rung = 0;
    o.fold0_score = score;
    o.fold0_sharpe = sharpe;
    o.fold0_trades = trades;
    return o;
}

sch::ArmOutcome okRung(int ord, int rung) {
    sch::ArmOutcome o;
    o.arm_ordinal = ord;
    o.status = sch::ArmStatus::Ok;
    o.rung = rung;
    return o;
}

}  // namespace

TEST_CASE("scheduler golden parity envelopes", "[scheduler]") {
    const nlohmann::json fixture = read_fixture();

    SECTION("plan") {
        for (const auto& c : fixture.at("plan")) {
            expect_envelope_equal(
                sch::run_scheduler(c.at("input")), c.at("expected"),
                c.at("label").get<std::string>());
        }
    }
    SECTION("retry-classify") {
        for (const auto& c : fixture.at("retryClassify")) {
            expect_envelope_equal(
                sch::run_scheduler(c.at("input")), c.at("expected"),
                c.at("label").get<std::string>());
        }
    }
    SECTION("resume-skip") {
        for (const auto& c : fixture.at("resumeSkip")) {
            expect_envelope_equal(
                sch::run_scheduler(c.at("input")), c.at("expected"),
                c.at("label").get<std::string>());
        }
    }
}

TEST_CASE("retry classification -- transient retryable, deterministic not",
          "[scheduler]") {
    REQUIRE(sch::is_retryable_status(sch::ArmStatus::IoFailed));
    REQUIRE(sch::is_retryable_status(sch::ArmStatus::Timeout));
    REQUIRE(sch::is_retryable_status(sch::ArmStatus::SpawnFailed));
    REQUIRE_FALSE(sch::is_retryable_status(sch::ArmStatus::Ok));
    REQUIRE_FALSE(sch::is_retryable_status(sch::ArmStatus::Failed));
    REQUIRE_FALSE(sch::is_retryable_status(sch::ArmStatus::FitFailed));
    REQUIRE_FALSE(sch::is_retryable_status(sch::ArmStatus::InvalidParams));
    REQUIRE_FALSE(sch::is_retryable_status(sch::ArmStatus::ManifestInvalid));
    REQUIRE_FALSE(sch::is_retryable_status(sch::ArmStatus::InsufficientSymbols));
    REQUIRE_FALSE(sch::is_retryable_status(sch::ArmStatus::MixedCalendarRejected));
    REQUIRE_FALSE(sch::is_retryable_status(sch::ArmStatus::Cancelled));
}

TEST_CASE("scheduler knows the COMPLETE adapter status vocabulary",
          "[scheduler]") {
    // Every status fit_one.py / fit_universe.py emit + every driver-emitted
    // status must round-trip through the owner. A gap would make the driver's
    // retry-classify call throw on a real adapter status (TICKET_858).
    for (const char* name : {"ok", "failed", "fit_failed", "invalid_params",
                             "io_failed", "manifest_invalid",
                             "insufficient_symbols", "mixed_calendar_rejected",
                             "timeout", "spawn_failed", "cancelled"}) {
        INFO("status: " << name);
        const auto parsed = sch::arm_status_from_name(name);
        REQUIRE(parsed.has_value());
        // Name round-trips exactly.
        REQUIRE(sch::arm_status_name(parsed.value()) == std::string(name));
    }
    REQUIRE_FALSE(sch::arm_status_from_name("bogus_status").has_value());
}

TEST_CASE("resume-skip -- ok + fingerprint match only", "[scheduler]") {
    REQUIRE(sch::resume_should_skip({true, true, true}));
    REQUIRE_FALSE(sch::resume_should_skip({false, true, true}));   // no prior
    REQUIRE_FALSE(sch::resume_should_skip({true, false, true}));   // prior not ok
    REQUIRE_FALSE(sch::resume_should_skip({true, true, false}));   // fp mismatch
}

TEST_CASE("ASHA comparator -- score desc, sharpe desc, fewer trades",
          "[scheduler]") {
    // Higher score wins.
    sch::ArmObservation a{1, "", 0.9, 1.0, 100.0};
    sch::ArmObservation b{2, "", 0.5, 9.0, 10.0};
    REQUIRE(sch::asha_arm_less(a, b));       // a ranks before b
    REQUIRE_FALSE(sch::asha_arm_less(b, a));
    // Equal score -> higher sharpe wins.
    sch::ArmObservation c{3, "", 0.7, 2.0, 100.0};
    sch::ArmObservation d{4, "", 0.7, 1.0, 100.0};
    REQUIRE(sch::asha_arm_less(c, d));
    // Equal score + sharpe -> fewer trades wins.
    sch::ArmObservation e{5, "", 0.7, 1.0, 50.0};
    sch::ArmObservation f{6, "", 0.7, 1.0, 90.0};
    REQUIRE(sch::asha_arm_less(e, f));
    // nullopt score sorts last.
    sch::ArmObservation g{7, "", std::nullopt, std::nullopt, 0.0};
    REQUIRE(sch::asha_arm_less(a, g));
}

TEST_CASE("ASHA barrier -- floor, keep-fraction, guard-bar, unscored kept",
          "[scheduler]") {
    // 30 scored arms, concurrency 3 -> floor = max(12, 6) = 12. keep =
    // max(12, ceil(30/3)=10) = 12. So 12 survive, 18 killed.
    std::vector<sch::ArmObservation> arms;
    for (int i = 1; i <= 30; ++i) {
        // Descending scores so ordinal order == rank order.
        arms.push_back({i, "", 1.0 - static_cast<double>(i) * 0.01, 0.0, 100.0});
    }
    const sch::AshaBarrierDecision d = sch::asha_barrier(arms, /*concurrency=*/3,
                                                         /*guard_bar=*/std::nullopt);
    REQUIRE(d.ranked_count == 30);
    REQUIRE(d.floor == 12);
    REQUIRE(d.keep_count == 12);
    REQUIRE(d.kept_ordinals.size() == 12);
    REQUIRE(d.killed_ordinals.size() == 18);
    REQUIRE(d.kept_ordinals.front() == 1);   // best-first
    REQUIRE(d.killed_ordinals.back() == 30);  // worst-last

    // Guard bar rescues a below-cut arm at/above the family p75. Arm 20 has
    // score 0.80; a guard bar of 0.80 rescues arms 13..20 (>= 0.80).
    const sch::AshaBarrierDecision g =
        sch::asha_barrier(arms, 3, /*guard_bar=*/0.80);
    REQUIRE(g.guard_saved_count == 8);        // arms 13..20 inclusive
    REQUIRE(g.keep_count == 20);

    // Unscored arms are never killed (absence != evidence).
    std::vector<sch::ArmObservation> mixed = arms;
    mixed.push_back({31, "", std::nullopt, std::nullopt, 0.0});
    const sch::AshaBarrierDecision u = sch::asha_barrier(mixed, 3, std::nullopt);
    REQUIRE(u.unscored_count == 1);
    REQUIRE(u.ranked_count == 30);            // the unscored arm is not ranked
    // The unscored arm (ord 31) is in neither kept nor killed lists.
    for (int k : u.killed_ordinals) REQUIRE(k != 31);
}

TEST_CASE("non-ASHA batch -- pool cursor + retry re-dispatch + done",
          "[scheduler]") {
    sch::BatchRequest req;
    req.arm_count = 5;
    req.concurrency = 2;
    req.asha_kill = false;
    req.max_retries = 2;

    // Nothing done yet -> dispatch first 2 (cursor head-limited to concurrency).
    sch::BatchPlan p0 = sch::plan_batch(req, {});
    REQUIRE(p0.phase == sch::BatchPhase::Rung0);
    REQUIRE(p0.dispatch == std::vector<int>{1, 2});
    REQUIRE(p0.resolved == 0);

    // Arm 1 ok, arm 2 io_failed (retryable, attempt 1). Next dispatch: the
    // still-pending arms 3,4 (arm 2 also pending-retry but head-limited to 2).
    std::vector<sch::ArmOutcome> outs;
    outs.push_back(okRung(1, 0));
    { sch::ArmOutcome o; o.arm_ordinal = 2; o.status = sch::ArmStatus::IoFailed;
      o.attempt = 1; outs.push_back(o); }
    sch::BatchPlan p1 = sch::plan_batch(req, outs);
    REQUIRE(p1.phase == sch::BatchPhase::Rung0);
    REQUIRE(p1.resolved == 1);                  // arm 1
    REQUIRE(p1.dispatch.size() == 2);
    REQUIRE(p1.dispatch.front() == 2);          // arm 2 retryable, ascending order

    // Arm 2 fails again at attempt 2 (== max_retries) -> terminal failed.
    { sch::ArmOutcome o; o.arm_ordinal = 2; o.status = sch::ArmStatus::IoFailed;
      o.attempt = 2; outs.push_back(o); }
    for (int i = 3; i <= 5; ++i) outs.push_back(okRung(i, 0));
    sch::BatchPlan p2 = sch::plan_batch(req, outs);
    REQUIRE(p2.phase == sch::BatchPhase::Done);
    REQUIRE(p2.resolved == 5);
    REQUIRE(p2.failed == std::vector<int>{2});
}

TEST_CASE("ASHA batch -- rung0 -> barrier -> rung1 -> done", "[scheduler]") {
    sch::BatchRequest req;
    req.arm_count = 15;
    req.concurrency = 3;
    req.asha_kill = true;
    req.max_retries = 1;

    // Rung 0: no outcomes yet -> dispatch first 3 fold-0.
    sch::BatchPlan p0 = sch::plan_batch(req, {});
    REQUIRE(p0.phase == sch::BatchPhase::Rung0);
    REQUIRE(p0.dispatch == std::vector<int>{1, 2, 3});

    // All 15 finish rung 0 with descending scores (ordinal 1 best).
    std::vector<sch::ArmOutcome> outs;
    for (int i = 1; i <= 15; ++i) {
        outs.push_back(ok0(i, 1.0 - static_cast<double>(i) * 0.01));
    }
    // floor = max(12, 2*3=6) = 12; keep = max(12, ceil(15/3)=5) = 12. So 12
    // survive to rung 1, 3 killed.
    sch::BatchPlan pb = sch::plan_batch(req, outs);
    REQUIRE(pb.phase == sch::BatchPhase::Rung1);
    REQUIRE(pb.barrier_kept.size() == 12);
    REQUIRE(pb.barrier_killed.size() == 3);
    REQUIRE(pb.barrier_killed == std::vector<int>{13, 14, 15});  // worst
    REQUIRE(pb.resolved == 3);                                    // killed parked
    REQUIRE(pb.dispatch == std::vector<int>{1, 2, 3});            // best survivors first

    // All 12 survivors finish rung 1 ok -> done, everyone resolved.
    for (int ord : pb.barrier_kept) outs.push_back(okRung(ord, 1));
    sch::BatchPlan pd = sch::plan_batch(req, outs);
    REQUIRE(pd.phase == sch::BatchPhase::Done);
    REQUIRE(pd.resolved == 15);
    REQUIRE(pd.failed.empty());
}

TEST_CASE("cancellation drains -- no dispatch directives", "[scheduler]") {
    sch::BatchRequest req;
    req.arm_count = 10;
    req.concurrency = 3;
    req.cancelled = true;
    sch::BatchPlan p = sch::plan_batch(req, {});
    REQUIRE(p.phase == sch::BatchPhase::Cancelled);
    REQUIRE(p.dispatch.empty());
}

TEST_CASE("supervision owns heartbeat timeout and escalation", "[scheduler]") {
    sch::SupervisionPolicy policy;
    sch::SupervisionProbe healthy;
    healthy.elapsed_ms = 10;
    healthy.heartbeat_silence_ms = 10;
    REQUIRE(sch::supervise_child(policy, healthy).directive ==
            sch::SupervisionDirective::Wait);

    sch::SupervisionProbe stale = healthy;
    stale.heartbeat_silence_ms = sch::kPythonFitHeartbeatTimeoutMs;
    auto term = sch::supervise_child(policy, stale);
    REQUIRE(term.directive == sch::SupervisionDirective::SendSigterm);
    REQUIRE(term.outcome == sch::ArmStatus::Timeout);

    stale.sigterm_sent = true;
    stale.sigterm_elapsed_ms = sch::kSigtermGraceMs;
    REQUIRE(sch::supervise_child(policy, stale).directive ==
            sch::SupervisionDirective::SendSigkill);
}

TEST_CASE("supervision owns cancel drain crash and malformed output",
          "[scheduler]") {
    sch::SupervisionPolicy policy;
    sch::SupervisionProbe cancel;
    cancel.observation = sch::SupervisionObservation::CancelRequested;
    auto cancelled = sch::supervise_child(policy, cancel);
    REQUIRE(cancelled.directive == sch::SupervisionDirective::SendSigterm);
    REQUIRE(cancelled.outcome == sch::ArmStatus::Cancelled);
    sch::SupervisionProbe drained;
    drained.observation = sch::SupervisionObservation::Exited;
    drained.exit_code = 9;
    drained.cancellation_requested = true;
    const auto drained_decision = sch::supervise_child(policy, drained);
    REQUIRE(drained_decision.directive == sch::SupervisionDirective::Complete);
    REQUIRE(drained_decision.outcome == sch::ArmStatus::Cancelled);
    sch::SupervisionProbe timed_out;
    timed_out.observation = sch::SupervisionObservation::Exited;
    timed_out.exit_code = 9;
    timed_out.timeout_requested = true;
    const auto timeout_decision = sch::supervise_child(policy, timed_out);
    REQUIRE(timeout_decision.directive == sch::SupervisionDirective::Complete);
    REQUIRE(timeout_decision.outcome == sch::ArmStatus::Timeout);

    sch::SupervisionProbe crash;
    crash.observation = sch::SupervisionObservation::Exited;
    crash.exit_code = 9;
    REQUIRE(sch::supervise_child(policy, crash).directive ==
            sch::SupervisionDirective::ReportCrash);
    crash.structured_output = true;
    const auto structured = sch::supervise_child(policy, crash);
    REQUIRE(structured.directive == sch::SupervisionDirective::Complete);
    REQUIRE(structured.reason == "structured_adapter_exit");

    sch::SupervisionProbe malformed;
    malformed.observation = sch::SupervisionObservation::MalformedOutput;
    REQUIRE(sch::supervise_child(policy, malformed).directive ==
            sch::SupervisionDirective::ReportMalformedOutput);

    const nlohmann::json request{
        {"kind", "supervise"},
        {"profile", "python_fit"},
        {"observation", {{"kind", "malformed_output"}}},
    };
    const auto first = sch::run_scheduler(request);
    const auto second = sch::run_scheduler(request);
    REQUIRE(first.at("contract") == sch::kSupervisionContract);
    REQUIRE(first.at("decisionId") == second.at("decisionId"));
    REQUIRE(first.at("decisionId").get<std::string>().starts_with("sched-"));
}

TEST_CASE("unknown scheduler kind throws", "[scheduler]") {
    REQUIRE_THROWS_AS(sch::run_scheduler(nlohmann::json{{"kind", "bogus"}}),
                      std::runtime_error);
}
