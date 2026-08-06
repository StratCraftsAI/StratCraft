#pragma once

// TICKET_1292_12 (MC-12): JSON <-> struct bridge for the `--scheduler=` packaged
// command. Shared by src/main.cpp and test_scheduler.cpp so both exercise the
// SAME parse + serialization. Mirrors resource_governance_json.hpp (MC-10).
//
// One command, three request kinds (chosen by "kind"):
//
//   { kind: "plan",
//     request: { armCount, concurrency, ashaKill?, maxRetries?, guardBar?,
//                keepFraction?, cancelled? },
//     outcomes: [ { armOrdinal, status, attempt?, rung?, fold0Score?,
//                   fold0Sharpe?, fold0Trades?, fingerprint? }, ... ] }
//       -> { phase: "rung0"|"barrier"|"rung1"|"done"|"cancelled",
//            dispatch: [ordinal, ...],       // arms to run next (<= concurrency)
//            barrierKept: [...], barrierKilled: [...],  // set at the barrier
//            failed: [...], resolved, total }
//     (discovery-orchestrator.ts runUniverseLoop worker pool + ASHA kill mode.
//      The driver executes `dispatch` under its concurrency pool, reports the
//      terminal outcomes back in the next call, and re-plans until phase=done.)
//
//   { kind: "retry-classify", status }
//       -> { retryable: bool }
//     (fit_one.py/_classify_error retry policy -- the SINGLE owner. The adapter
//      emits a raw status; the scheduler decides retryability.)
//
//   { kind: "resume-skip", hasPrior, priorOk, fingerprintMatch }
//       -> { skip: bool }
//     (TICKET_1289 resume / arm-skip fingerprint gate; runner.py:340-355.)
//
// The envelope always carries `version` (kSchedulerVersion). Contract violations
// throw std::runtime_error / std::invalid_argument; the CLI wraps that into the
// structured stderr error object with exit 2.

#include "quantnexus/executor/scheduler/scheduler.hpp"

#include <nlohmann/json.hpp>

#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

namespace StratCraft::executor::scheduler {

[[nodiscard]] inline std::string scheduler_decision_id(
    const nlohmann::json& input) {
    // Stable FNV-1a over nlohmann's ordered object serialization. This is an
    // audit correlation identifier, not a security primitive.
    std::uint64_t hash = 14695981039346656037ULL;
    for (const unsigned char byte : input.dump()) {
        hash ^= byte;
        hash *= 1099511628211ULL;
    }
    std::ostringstream out;
    out << "sched-" << std::hex << std::setw(16) << std::setfill('0') << hash;
    return out.str();
}

// A JSON number that may be null -> std::nullopt (JSON.stringify emits null for
// NaN / an absent optional metric).
[[nodiscard]] inline std::optional<double> sched_opt(const nlohmann::json& v) {
    if (v.is_null()) return std::nullopt;
    return v.get<double>();
}

// -- plan -----------------------------------------------------------------

[[nodiscard]] inline BatchRequest parse_batch_request(const nlohmann::json& r) {
    BatchRequest req;
    req.arm_count = r.at("armCount").get<int>();
    req.concurrency = r.at("concurrency").get<int>();
    req.asha_kill = r.value("ashaKill", false);
    req.max_retries = r.value("maxRetries", 1);
    req.keep_fraction = r.value("keepFraction", kAshaKeepFraction);
    req.cancelled = r.value("cancelled", false);
    if (r.contains("guardBar") && !r.at("guardBar").is_null()) {
        req.guard_bar = r.at("guardBar").get<double>();
    }
    return req;
}

[[nodiscard]] inline ArmOutcome parse_arm_outcome(const nlohmann::json& o) {
    ArmOutcome out;
    out.arm_ordinal = o.at("armOrdinal").get<int>();
    const std::string status_name = o.at("status").get<std::string>();
    const std::optional<ArmStatus> parsed = arm_status_from_name(status_name);
    if (!parsed.has_value()) {
        throw std::runtime_error(
            "scheduler: unknown arm status '" + status_name + "'");
    }
    out.status = parsed.value();
    out.attempt = o.value("attempt", 1);
    out.rung = o.value("rung", 0);
    if (o.contains("fold0Score")) out.fold0_score = sched_opt(o.at("fold0Score"));
    if (o.contains("fold0Sharpe")) out.fold0_sharpe = sched_opt(o.at("fold0Sharpe"));
    out.fold0_trades = o.value("fold0Trades", 0.0);
    out.fingerprint = o.value("fingerprint", std::string{});
    return out;
}

[[nodiscard]] inline nlohmann::json run_plan(const nlohmann::json& document) {
    const BatchRequest req = parse_batch_request(document.at("request"));
    std::vector<ArmOutcome> outcomes;
    if (document.contains("outcomes") && !document.at("outcomes").is_null()) {
        const auto& arr = document.at("outcomes");
        if (!arr.is_array()) {
            throw std::runtime_error("scheduler plan: outcomes must be an array");
        }
        outcomes.reserve(arr.size());
        for (const auto& o : arr) outcomes.push_back(parse_arm_outcome(o));
    }

    const BatchPlan plan = plan_batch(req, outcomes);
    // Barrier telemetry (present only on the barrier-resolving plan): emitted
    // from the SAME owner that decides the kill/keep so the driver's audit trail
    // never reconstructs the barrier math (TICKET_1292_21 AC-4c / MC-12 C7). Null
    // on every non-barrier plan; the guard bar is null unless a p75 was supplied.
    nlohmann::json barrier = nlohmann::json(nullptr);
    if (plan.barrier.present) {
        barrier = nlohmann::json{
            {"rankedCount", plan.barrier.ranked_count},
            {"unscoredCount", plan.barrier.unscored_count},
            {"keepCount", plan.barrier.keep_count},
            {"floor", plan.barrier.floor},
            {"guardBar", plan.barrier.guard_bar.has_value()
                             ? nlohmann::json(plan.barrier.guard_bar.value())
                             : nlohmann::json(nullptr)},
            {"guardSavedCount", plan.barrier.guard_saved_count},
        };
    }
    return nlohmann::json{
        {"version", plan.version},
        {"decisionId", scheduler_decision_id(document)},
        {"phase", std::string(batch_phase_name(plan.phase))},
        {"dispatch", plan.dispatch},
        {"barrierKept", plan.barrier_kept},
        {"barrierKilled", plan.barrier_killed},
        {"barrier", barrier},
        {"failed", plan.failed},
        {"resolved", plan.resolved},
        {"total", plan.total},
    };
}

// -- retry-classify -------------------------------------------------------

[[nodiscard]] inline nlohmann::json run_retry_classify(
    const nlohmann::json& document) {
    const std::string status_name = document.at("status").get<std::string>();
    const std::optional<ArmStatus> parsed = arm_status_from_name(status_name);
    if (!parsed.has_value()) {
        throw std::runtime_error(
            "scheduler: unknown arm status '" + status_name + "'");
    }
    return nlohmann::json{
        {"version", kSchedulerVersion},
        {"retryable", is_retryable_status(parsed.value())},
    };
}

// -- resume-skip ----------------------------------------------------------

[[nodiscard]] inline nlohmann::json run_resume_skip(const nlohmann::json& document) {
    ResumeProbe p;
    p.has_prior = document.at("hasPrior").get<bool>();
    p.prior_ok = document.at("priorOk").get<bool>();
    p.fingerprint_match = document.at("fingerprintMatch").get<bool>();
    return nlohmann::json{
        {"version", kSchedulerVersion},
        {"skip", resume_should_skip(p)},
    };
}

[[nodiscard]] inline nlohmann::json run_supervise(
    const nlohmann::json& document) {
    const std::string profile = document.at("profile").get<std::string>();
    SupervisionPolicy policy;
    if (profile == "python_fit") {
        policy.heartbeat_timeout_ms = kPythonFitHeartbeatTimeoutMs;
        policy.child_timeout_ms = 0;
    } else if (profile == "factor_eval") {
        policy.heartbeat_timeout_ms = 0;
        policy.child_timeout_ms = kFactorEvalChildTimeoutMs;
    } else {
        throw std::runtime_error(
            "scheduler supervise: profile must be one of "
            "{python_fit,factor_eval}, got '" + profile + "'");
    }
    const auto& o = document.at("observation");
    const std::string name = o.at("kind").get<std::string>();
    SupervisionProbe probe;
    if (name == "started") probe.observation = SupervisionObservation::Started;
    else if (name == "heartbeat")
        probe.observation = SupervisionObservation::Heartbeat;
    else if (name == "exited")
        probe.observation = SupervisionObservation::Exited;
    else if (name == "poll") probe.observation = SupervisionObservation::Poll;
    else if (name == "cancel_requested")
        probe.observation = SupervisionObservation::CancelRequested;
    else if (name == "malformed_output")
        probe.observation = SupervisionObservation::MalformedOutput;
    else
        throw std::runtime_error(
            "scheduler supervise: unknown observation kind '" + name + "'");
    probe.elapsed_ms = o.value("elapsedMs", std::int64_t{0});
    probe.heartbeat_silence_ms =
        o.value("heartbeatSilenceMs", std::int64_t{0});
    probe.sigterm_sent = o.value("sigtermSent", false);
    probe.sigterm_elapsed_ms = o.value("sigtermElapsedMs", std::int64_t{0});
    probe.cancellation_requested = o.value("cancellationRequested", false);
    probe.timeout_requested = o.value("timeoutRequested", false);
    probe.structured_output = o.value("structuredOutput", false);
    if (o.contains("exitCode") && !o.at("exitCode").is_null()) {
        probe.exit_code = o.at("exitCode").get<int>();
    }
    if (probe.elapsed_ms < 0 || probe.heartbeat_silence_ms < 0 ||
        probe.sigterm_elapsed_ms < 0) {
        throw std::runtime_error(
            "scheduler supervise: observation durations must be non-negative");
    }
    const SupervisionDecision decision = supervise_child(policy, probe);
    return nlohmann::json{
        {"version", decision.version},
        {"decisionId", scheduler_decision_id(document)},
        {"contract", decision.contract},
        {"profile", profile},
        {"directive", supervision_directive_name(decision.directive)},
        {"reason", decision.reason},
        {"outcome", arm_status_name(decision.outcome)},
        {"terminal", decision.terminal},
        {"policy",
         {{"heartbeatTimeoutMs", policy.heartbeat_timeout_ms},
          {"childTimeoutMs", policy.child_timeout_ms},
          {"sigtermGraceMs", policy.sigterm_grace_ms}}},
    };
}

// ============================================================================
// Command entry: dispatch on "kind" and return the output envelope.
// ============================================================================

[[nodiscard]] inline nlohmann::json run_scheduler(const nlohmann::json& document) {
    const std::string kind = document.value("kind", std::string{});
    if (kind == "plan") {
        return run_plan(document);
    }
    if (kind == "retry-classify") {
        return run_retry_classify(document);
    }
    if (kind == "resume-skip") {
        return run_resume_skip(document);
    }
    if (kind == "supervise") {
        return run_supervise(document);
    }
    throw std::runtime_error(
        "scheduler: kind must be one of {plan,retry-classify,resume-skip,supervise}, got '" +
        kind + "'");
}

}  // namespace StratCraft::executor::scheduler
