#pragma once

// TICKET_1292_10 (MC-10): JSON <-> struct bridge for the `--resource-governance=`
// packaged command. Shared by src/main.cpp and test_resource_governance.cpp so
// both exercise the SAME parse + serialization. Mirrors the
// scoreboard_score_json.hpp / clustering_gate_json.hpp precedent.
//
// One command, four request kinds (the decision surface is chosen by "kind"):
//
//   { kind: "swap-pressure",
//     estimatedPeakMB, memAvailableMB, memTotalMB }
//       -> { pressure: "none"|"unlikely"|"likely" }
//     (pipeline-resource-profile.ts classifySwapPressure)
//
//   { kind: "hysteresis",
//     config: { pausePct, resumePct, swapPausePct, swapResumePct,
//               swapGrowthPauseMb, swapGrowthResumeMb, pollSeconds, enabled },
//     samples: [ { memHeadroomPct, cpuHeadroomPct, swapUsedPct, swapUsedMb }, ... ] }
//       -> { transitions: ["", "pause", "resume", ...],  // one per sample
//            paused: bool,                                // final state
//            pollSeconds }
//     (resource_gate.py update() replayed over an ordered sample stream. Stateful
//      across the array -- the swap delta seam is honored exactly. A caller that
//      owns one long-lived gate serializes one sample per call; the array form is
//      for golden parity + batched decisions.)
//
//   { kind: "budget",
//     rssMb, budgetMb, alreadyDegraded }
//       -> { verdict: "ok"|"degrade"|"abort" }
//     (training_memory.py RssSentinel.observe ladder)
//     -- OR --
//   { kind: "budget", resolveCellBudget: { memTotalBytes, budgetGb?, memtotalFrac? } }
//       -> { budgetMb }
//     (resource_watchdog.py resolve_cell_budget_mb)
//
//   { kind: "capacity",
//     machine: { ncpu, memTotalBytes },
//     capPct, resumeHysteresisPct? }
//       -> { cgroupMemoryMaxGib, cgroupMemoryHighGib, cgroupSwapMaxGib,
//            cgroupCpuQuotaPct, govPausePct, govResumePct }
//     (cgroup-fence.sh compute_cgroup_props + run-*-chain.sh threshold derivation)
//
//   { kind: "sweep-admission",
//     armCount, ncpu, maxConcurrency?, perArmBytes?, maxArmCostFactor?,
//     memAvailableBytes? }
//       -> { concurrency, blasThreadsPerWorker, memoryGateClamped,
//            cpuBaseline, memoryCap }
//     (discovery-orchestrator.ts resolveSweepParallelism + resolveBlasThreadEnv;
//      TICKET_1292_12 MC-12 -- the sweep scheduler consumes this instead of
//      forking the arm-admission math. IO stays in the caller: it resolves
//      SWEEP_MAX_CONCURRENCY from env, reads MemAvailable, counts cores, and
//      passes the sampled values IN.)
//
// Every request carries a non-empty `decisionId`. The C++ owner echoes it in
// every result so UI estimates, admission adapters, child environments, logs,
// and cgroup enforcement can prove that they consumed the same serialized
// decision. The envelope also carries `version` (kResourceGovernanceVersion)
// so a consumer can assert wire compatibility. Contract violations throw
// std::runtime_error / std::invalid_argument; the CLI wraps that into the
// structured stderr error object with exit 2.

#include "quantnexus/executor/resource_governance/resource_governance.hpp"

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

namespace StratCraft::executor::resource_governance {

// A JSON number that may be null (NaN) -- mirrors the packaged-command wire
// convention (JSON.stringify emits null for NaN).
[[nodiscard]] inline double rg_num(const nlohmann::json& v) {
    return v.is_null() ? qnan() : v.get<double>();
}

// -- swap-pressure --------------------------------------------------------

[[nodiscard]] inline nlohmann::json run_swap_pressure(
    const nlohmann::json& document) {
    const double peak = rg_num(document.at("estimatedPeakMB"));
    const double avail = rg_num(document.at("memAvailableMB"));
    const double total = rg_num(document.at("memTotalMB"));
    const SwapPressure p = classify_swap_pressure(peak, avail, total);
    return nlohmann::json{
        {"version", kResourceGovernanceVersion},
        {"pressure", std::string(swap_pressure_name(p))},
    };
}

// -- hysteresis -----------------------------------------------------------

[[nodiscard]] inline HysteresisConfig parse_hysteresis_config(
    const nlohmann::json& c) {
    HysteresisConfig config;
    config.pause_pct = c.value("pausePct", kDefaultPausePct);
    config.resume_pct = c.value("resumePct", kDefaultResumePct);
    config.swap_pause_pct = c.value("swapPausePct", kDefaultSwapPausePct);
    config.swap_resume_pct = c.value("swapResumePct", kDefaultSwapResumePct);
    config.swap_growth_pause_mb =
        c.value("swapGrowthPauseMb", kDefaultSwapGrowthPauseMb);
    config.swap_growth_resume_mb =
        c.value("swapGrowthResumeMb", kDefaultSwapGrowthResumeMb);
    config.poll_seconds = c.value("pollSeconds", kDefaultPollSeconds);
    config.enabled = c.value("enabled", true);
    return config;
}

[[nodiscard]] inline nlohmann::json run_hysteresis(
    const nlohmann::json& document) {
    HysteresisConfig config;
    if (document.contains("config") && !document.at("config").is_null()) {
        config = parse_hysteresis_config(document.at("config"));
    }
    // Enabled gates must satisfy the hysteresis invariant; a disabled gate is a
    // pass-through so its (irrelevant) thresholds are not validated -- exactly
    // resource_gate.py's from_env behavior.
    if (config.enabled) {
        const std::string err = config.validation_error();
        if (!err.empty()) {
            throw std::runtime_error("resource-governance hysteresis: " + err);
        }
    }

    HysteresisGate gate(config);
    // Optional state seed: a caller that owns the long-lived gate (resource_gate.py)
    // threads its retained (paused, prev-swap) pair so a single-sample call
    // reproduces the exact edge. Absent -> fresh gate (the array-replay / golden
    // form). prevSwapMb null/absent -> no predecessor (the first-sample seam).
    if (document.contains("initialPaused")) {
        std::optional<double> prev_swap = std::nullopt;
        if (document.contains("prevSwapMb") && !document.at("prevSwapMb").is_null()) {
            prev_swap = document.at("prevSwapMb").get<double>();
        }
        gate.seed(document.at("initialPaused").get<bool>(), prev_swap);
    }

    nlohmann::json transitions = nlohmann::json::array();
    const auto& samples = document.at("samples");
    if (!samples.is_array()) {
        throw std::runtime_error("resource-governance hysteresis: samples must be an array");
    }
    for (const auto& s : samples) {
        ResourceSnapshot snap;
        snap.mem_headroom_pct = s.at("memHeadroomPct").get<double>();
        snap.cpu_headroom_pct = s.at("cpuHeadroomPct").get<double>();
        snap.swap_used_pct = s.at("swapUsedPct").get<double>();
        snap.swap_used_mb = s.value("swapUsedMb", 0.0);
        const GateTransition t = gate.update(snap);
        transitions.push_back(std::string(gate_transition_name(t)));
    }

    nlohmann::json out{
        {"version", kResourceGovernanceVersion},
        {"transitions", transitions},
        {"paused", gate.paused()},
        {"pollSeconds", config.poll_seconds},
    };
    // Echo the retained previous swap level so the caller can thread it into the
    // next single-sample call (null when no sample was seen).
    const std::optional<double> prev = gate.prev_swap_mb();
    out["prevSwapMb"] = prev.has_value() ? nlohmann::json(*prev)
                                         : nlohmann::json(nullptr);
    return out;
}

// -- budget ---------------------------------------------------------------

[[nodiscard]] inline nlohmann::json run_budget(const nlohmann::json& document) {
    if (document.contains("resolveCellBudget") &&
        !document.at("resolveCellBudget").is_null()) {
        const auto& r = document.at("resolveCellBudget");
        const double mem_total_bytes = r.at("memTotalBytes").get<double>();
        const double budget_gb = r.value("budgetGb", kDefaultCellBudgetGb);
        const double frac = r.value("memtotalFrac", kDefaultCellBudgetMemTotalFrac);
        return nlohmann::json{
            {"version", kResourceGovernanceVersion},
            {"budgetMb", resolve_cell_budget_mb(mem_total_bytes, budget_gb, frac)},
        };
    }

    const double rss_mb = document.at("rssMb").get<double>();
    const double budget_mb = document.at("budgetMb").get<double>();
    const bool already_degraded = document.value("alreadyDegraded", false);
    const BudgetVerdict v = evaluate_budget(rss_mb, budget_mb, already_degraded);
    return nlohmann::json{
        {"version", kResourceGovernanceVersion},
        {"verdict", std::string(budget_verdict_name(v))},
    };
}

// -- capacity -------------------------------------------------------------

[[nodiscard]] inline nlohmann::json run_capacity(const nlohmann::json& document) {
    CapacityRequest req;
    const auto& m = document.at("machine");
    req.machine.ncpu = m.at("ncpu").get<int>();
    req.machine.mem_total_bytes = m.at("memTotalBytes").get<double>();
    req.cap_pct = document.at("capPct").get<double>();
    req.resume_hysteresis_pct =
        document.value("resumeHysteresisPct", kDefaultResumeHysteresisPct);

    const CapacityDecision d = solve_capacity(req);
    return nlohmann::json{
        {"version", kResourceGovernanceVersion},
        {"cgroupMemoryMaxGib", d.cgroup_memory_max_gib},
        {"cgroupMemoryHighGib", d.cgroup_memory_high_gib},
        {"cgroupSwapMaxGib", d.cgroup_swap_max_gib},
        {"cgroupCpuQuotaPct", d.cgroup_cpu_quota_pct},
        {"govPausePct", d.gov_pause_pct},
        {"govResumePct", d.gov_resume_pct},
    };
}

// -- sweep-admission ------------------------------------------------------

[[nodiscard]] inline nlohmann::json run_sweep_admission(
    const nlohmann::json& document) {
    SweepAdmissionRequest req;
    req.arm_count = document.at("armCount").get<int>();
    req.ncpu = document.at("ncpu").get<int>();
    req.max_concurrency =
        document.value("maxConcurrency", kSweepDefaultMaxConcurrency);
    req.per_arm_bytes = document.value("perArmBytes", 0.0);
    req.max_arm_cost_factor = document.value("maxArmCostFactor", 1.0);
    req.mem_available_bytes = document.value("memAvailableBytes", 0.0);

    const SweepAdmissionDecision d = solve_sweep_admission(req);
    return nlohmann::json{
        {"version", kResourceGovernanceVersion},
        {"concurrency", d.concurrency},
        {"blasThreadsPerWorker", d.blas_threads_per_worker},
        {"memoryGateClamped", d.memory_gate_clamped},
        {"cpuBaseline", d.cpu_baseline},
        {"memoryCap", d.memory_cap},
    };
}

// ============================================================================
// Command entry: dispatch on "kind" and return the output envelope.
// ============================================================================

[[nodiscard]] inline nlohmann::json run_resource_governance(
    const nlohmann::json& document) {
    const std::string decision_id =
        document.value("decisionId", std::string{});
    if (decision_id.empty()) {
        throw std::runtime_error(
            "resource-governance: decisionId must be a non-empty string");
    }
    const std::string kind = document.value("kind", std::string{});
    nlohmann::json result;
    if (kind == "swap-pressure") {
        result = run_swap_pressure(document);
    } else if (kind == "hysteresis") {
        result = run_hysteresis(document);
    } else if (kind == "budget") {
        result = run_budget(document);
    } else if (kind == "capacity") {
        result = run_capacity(document);
    } else if (kind == "sweep-admission") {
        result = run_sweep_admission(document);
    } else {
        throw std::runtime_error(
            "resource-governance: kind must be one of "
            "{swap-pressure,hysteresis,budget,capacity,sweep-admission}, got '" +
            kind + "'");
    }
    result["decisionId"] = decision_id;
    return result;
}

}  // namespace StratCraft::executor::resource_governance
