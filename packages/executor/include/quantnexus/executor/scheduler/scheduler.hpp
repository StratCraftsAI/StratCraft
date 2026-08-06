#pragma once

// TICKET_1292_12 (MC-12): C++23 sweep-scheduler state machine -- the single
// owner of the sweep scheduler's control-plane DECISIONS: arm admission
// (worker-pool cursor over the resolved concurrency), ASHA successive-halving
// (rung0 -> barrier rank -> rung1), per-arm retry / kill classification, and the
// resume / arm-skip fingerprint gate. This was TS-owned and duplicated three
// ways (discovery-orchestrator.ts worker pools, packages/sweep-runner/runner.py,
// fit_one.py/_classify_error). MC-12 makes it ONE deterministic C++ owner.
//
// The scheduler owns DECISIONS, not IO. It never spawns a child, reads a clock,
// or touches a thread. The caller (the TS driver) owns the process lifecycle:
// it spawns fit_one.py / fit_universe.py / the factor executor, enforces the
// heartbeat / PER_ARM_EXECUTOR_TIMEOUT_MS liveness, sends SIGTERM/SIGKILL, and
// reports each arm's terminal outcome back as an event. The scheduler consumes
// the ordered event stream and returns the next batch of directives (dispatch
// arm i / kill arm i / run the ASHA barrier / done). Same "IO stays in the
// caller, DECISION is delegated" contract as resource_governance.hpp (MC-10).
//
// Capacity is NOT re-derived here: the resolved `concurrency` is supplied by the
// MC-10 `sweep-admission` decision (solve_sweep_admission). MC-12 consumes it.
//
// This header is pure logic so it is exhaustively golden-testable in isolation
// (state x event -> next-directives), mirroring evaluateAshaShadow's unit shape.
// The ASHA ranking (comparator / floor / guard-bar) is a byte-for-byte port of
// asha-screening.ts:135-195 so the C++ owner and the retained TS drift sentinel
// stay identical under the shared fixture.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace StratCraft::executor::scheduler {

// Frozen wire-contract version. Bump only on a breaking envelope change.
inline constexpr int kSchedulerVersion = 1;
inline constexpr std::string_view kSupervisionContract =
    "qnx.scheduler-supervision/1.0.0";

// ============================================================================
// Constants -- ASHA successive-halving (asha-screening.ts:37-44). Single
// definition; the TS module is retained only as a drift sentinel.
// ============================================================================

inline constexpr double kAshaKeepFraction = 1.0 / 3.0;  // ASHA_KEEP_FRACTION
inline constexpr int kAshaKeepFloorBase = 12;           // ASHA_KEEP_FLOOR_BASE

// ============================================================================
// Arm outcome status -- the structured status the fit adapter emits (6C-3). The
// scheduler classifies retryability from it; the adapter no longer decides
// (fit_one.py/_classify_error moves here). `Ok` resolves the arm; everything
// else is a failure class the scheduler dispositions.
// ============================================================================

// The COMPLETE status vocabulary the scheduler must classify. Two sources:
//   * Adapter-emitted (fit_one.py / fit_universe.py envelope status): ok,
//     failed, fit_failed, invalid_params, io_failed, manifest_invalid,
//     insufficient_symbols, mixed_calendar_rejected. The adapter maps its own
//     exception taxonomy to these (a fit-domain fact it legitimately owns via
//     `_classify_error`) but NEVER decides retryability -- that is here.
//   * Driver-emitted (the TS spawner, not the adapter): timeout,
//     spawn_failed, cancelled. The process supervisor produces these when no
//     envelope arrives (hang / crash / abort).
// A status the owner does not know is a contract violation, not a silent pass:
// arm_status_from_name returns nullopt and the caller throws (TICKET_858).
enum class ArmStatus {
    Ok,                    // fit succeeded, envelope status=="ok"
    Failed,                // generic refusal (walker-floor etc.) -- NOT retryable
    FitFailed,             // model fit raised (HMMFitError/NGramFitError) -- NOT
    InvalidParams,         // validate_params / decode error -- NOT (bad arm)
    IoFailed,              // parquet / manifest read error -- retryable (transient)
    ManifestInvalid,       // universe manifest malformed -- NOT retryable
    InsufficientSymbols,   // <2 surviving symbols -- NOT retryable
    MixedCalendarRejected, // ragged cross-calendar universe -- NOT retryable
    Timeout,               // liveness / PER_ARM_EXECUTOR_TIMEOUT_MS -- retryable
    SpawnFailed,           // no envelope on stdout / process crash -- retryable
    Cancelled,             // aborted mid-flight -- terminal, not a failure
};

// ============================================================================
// Child supervision state machine.
//
// The caller owns clocks, signals, pipes, and process handles. It reports an
// observation carrying monotonic elapsed/silence values; this owner returns the
// only permitted OS-I/O directive. This keeps timeout, cancellation drain, and
// TERM->KILL escalation policy out of Electron/Python spawners.
// ============================================================================

inline constexpr std::int64_t kPythonFitHeartbeatTimeoutMs = 180'000;
inline constexpr std::int64_t kFactorEvalChildTimeoutMs = 120'000;
inline constexpr std::int64_t kSigtermGraceMs = 5'000;

enum class SupervisionObservation {
    Started,
    Heartbeat,
    Exited,
    Poll,
    CancelRequested,
    MalformedOutput,
};

enum class SupervisionDirective {
    Wait,
    SendSigterm,
    SendSigkill,
    Complete,
    ReportCrash,
    ReportMalformedOutput,
};

[[nodiscard]] inline std::string_view supervision_directive_name(
    SupervisionDirective directive) noexcept {
    switch (directive) {
        case SupervisionDirective::Wait: return "wait";
        case SupervisionDirective::SendSigterm: return "send_sigterm";
        case SupervisionDirective::SendSigkill: return "send_sigkill";
        case SupervisionDirective::Complete: return "complete";
        case SupervisionDirective::ReportCrash: return "report_crash";
        case SupervisionDirective::ReportMalformedOutput:
            return "report_malformed_output";
    }
    return "report_crash";
}

struct SupervisionPolicy {
    // Zero disables a policy dimension. Python fits are heartbeat-governed
    // without a fixed wall timeout; factor_eval is wall-time-governed without
    // requiring stdout heartbeats.
    std::int64_t heartbeat_timeout_ms = kPythonFitHeartbeatTimeoutMs;
    std::int64_t child_timeout_ms = 0;
    std::int64_t sigterm_grace_ms = kSigtermGraceMs;
};

struct SupervisionProbe {
    SupervisionObservation observation = SupervisionObservation::Poll;
    std::int64_t elapsed_ms = 0;
    std::int64_t heartbeat_silence_ms = 0;
    bool sigterm_sent = false;
    std::int64_t sigterm_elapsed_ms = 0;
    std::optional<int> exit_code;
    bool structured_output = false;
    bool cancellation_requested = false;
    bool timeout_requested = false;
};

struct SupervisionDecision {
    int version = kSchedulerVersion;
    std::string_view contract = kSupervisionContract;
    SupervisionDirective directive = SupervisionDirective::Wait;
    std::string_view reason = "healthy";
    ArmStatus outcome = ArmStatus::Ok;
    bool terminal = false;
};

[[nodiscard]] inline SupervisionDecision supervise_child(
    const SupervisionPolicy& policy, const SupervisionProbe& probe) noexcept {
    SupervisionDecision decision;
    if (probe.observation == SupervisionObservation::MalformedOutput) {
        decision.directive = SupervisionDirective::ReportMalformedOutput;
        decision.reason = "malformed_output";
        decision.outcome = ArmStatus::SpawnFailed;
        decision.terminal = true;
        return decision;
    }
    if (probe.observation == SupervisionObservation::Exited) {
        decision.terminal = true;
        if (probe.cancellation_requested) {
            decision.directive = SupervisionDirective::Complete;
            decision.reason = "cancellation_drained";
            decision.outcome = ArmStatus::Cancelled;
        } else if (probe.timeout_requested) {
            decision.directive = SupervisionDirective::Complete;
            decision.reason = "timeout_drained";
            decision.outcome = ArmStatus::Timeout;
        } else if (probe.exit_code.value_or(-1) == 0 ||
                   probe.structured_output) {
            decision.directive = SupervisionDirective::Complete;
            decision.reason = probe.exit_code.value_or(-1) == 0
                                  ? "clean_exit"
                                  : "structured_adapter_exit";
            decision.outcome = ArmStatus::Ok;
        } else {
            decision.directive = SupervisionDirective::ReportCrash;
            decision.reason = "child_crash";
            decision.outcome = ArmStatus::SpawnFailed;
        }
        return decision;
    }
    const bool cancellation =
        probe.cancellation_requested ||
        probe.observation == SupervisionObservation::CancelRequested;
    const bool heartbeat_expired =
        policy.heartbeat_timeout_ms > 0 &&
        probe.heartbeat_silence_ms >= policy.heartbeat_timeout_ms;
    const bool wall_expired =
        policy.child_timeout_ms > 0 &&
        probe.elapsed_ms >= policy.child_timeout_ms;
    if (probe.sigterm_sent) {
        if (probe.sigterm_elapsed_ms >= policy.sigterm_grace_ms) {
            decision.directive = SupervisionDirective::SendSigkill;
            decision.reason = "sigterm_grace_expired";
            decision.outcome = cancellation ? ArmStatus::Cancelled
                                            : ArmStatus::Timeout;
            return decision;
        }
        decision.reason = "cancellation_drain";
        decision.outcome = cancellation ? ArmStatus::Cancelled
                                        : ArmStatus::Timeout;
        return decision;
    }
    if (cancellation || heartbeat_expired || wall_expired) {
        decision.directive = SupervisionDirective::SendSigterm;
        decision.reason = cancellation ? "cancel_requested"
                         : heartbeat_expired ? "heartbeat_timeout"
                                             : "child_timeout";
        decision.outcome = cancellation ? ArmStatus::Cancelled
                                        : ArmStatus::Timeout;
        return decision;
    }
    return decision;
}

[[nodiscard]] inline std::string_view arm_status_name(ArmStatus s) noexcept {
    switch (s) {
        case ArmStatus::Ok:                    return "ok";
        case ArmStatus::Failed:                return "failed";
        case ArmStatus::FitFailed:             return "fit_failed";
        case ArmStatus::InvalidParams:         return "invalid_params";
        case ArmStatus::IoFailed:              return "io_failed";
        case ArmStatus::ManifestInvalid:       return "manifest_invalid";
        case ArmStatus::InsufficientSymbols:   return "insufficient_symbols";
        case ArmStatus::MixedCalendarRejected: return "mixed_calendar_rejected";
        case ArmStatus::Timeout:               return "timeout";
        case ArmStatus::SpawnFailed:           return "spawn_failed";
        case ArmStatus::Cancelled:             return "cancelled";
    }
    return "fit_failed";
}

[[nodiscard]] inline std::optional<ArmStatus> arm_status_from_name(
    std::string_view name) noexcept {
    if (name == "ok")                     return ArmStatus::Ok;
    if (name == "failed")                 return ArmStatus::Failed;
    if (name == "fit_failed")             return ArmStatus::FitFailed;
    if (name == "invalid_params")         return ArmStatus::InvalidParams;
    if (name == "io_failed")              return ArmStatus::IoFailed;
    if (name == "manifest_invalid")       return ArmStatus::ManifestInvalid;
    if (name == "insufficient_symbols")   return ArmStatus::InsufficientSymbols;
    if (name == "mixed_calendar_rejected") return ArmStatus::MixedCalendarRejected;
    if (name == "timeout")                return ArmStatus::Timeout;
    if (name == "spawn_failed")           return ArmStatus::SpawnFailed;
    if (name == "cancelled")              return ArmStatus::Cancelled;
    return std::nullopt;
}

// ----------------------------------------------------------------------------
// Retry classification -- the single owner. A retryable failure that has not
// exhausted its budget is re-dispatched; otherwise the arm is terminal-failed.
// This replaces sweep-runner's "all non-ok forces refit" and fit_one's
// _classify_error, both of which conflated status with retry policy.
// ----------------------------------------------------------------------------

[[nodiscard]] inline bool is_retryable_status(ArmStatus s) noexcept {
    switch (s) {
        case ArmStatus::IoFailed:
        case ArmStatus::Timeout:
        case ArmStatus::SpawnFailed:
            return true;  // transient -- a fresh spawn may succeed
        case ArmStatus::Ok:
        case ArmStatus::Failed:                 // deterministic refusal
        case ArmStatus::FitFailed:              // deterministic model failure
        case ArmStatus::InvalidParams:          // the arm itself is bad
        case ArmStatus::ManifestInvalid:        // bad manifest -- retry won't fix
        case ArmStatus::InsufficientSymbols:    // universe too small
        case ArmStatus::MixedCalendarRejected:  // data shape -- deterministic
        case ArmStatus::Cancelled:              // never retried
            return false;
    }
    return false;
}

// ============================================================================
// ASHA rung-0 observation + ranking (byte-for-byte port of asha-screening.ts).
// ============================================================================

struct ArmObservation {
    int arm_ordinal = 0;                          // 1-based, log-correlatable
    std::string fingerprint;                      // identity across resume/dedup
    std::optional<double> fold0_score;            // nullopt == unscored (cache/fail)
    std::optional<double> fold0_sharpe;           // tie-break 1
    double fold0_trades = 0.0;                     // tie-break 2 (fewer ranks lower)
};

// D1 comparator (asha-screening.ts:135-143): fold0_score desc, oos_sharpe desc,
// then FEWER trades ranks better. nullopt score/sharpe -> -inf (sorts last).
[[nodiscard]] inline bool asha_arm_less(const ArmObservation& a,
                                        const ArmObservation& b) noexcept {
    const double neg_inf = -std::numeric_limits<double>::infinity();
    const double score_a = a.fold0_score.value_or(neg_inf);
    const double score_b = b.fold0_score.value_or(neg_inf);
    if (score_a != score_b) return score_a > score_b;  // desc
    const double sharpe_a = a.fold0_sharpe.value_or(neg_inf);
    const double sharpe_b = b.fold0_sharpe.value_or(neg_inf);
    if (sharpe_a != sharpe_b) return sharpe_a > sharpe_b;  // desc
    return a.fold0_trades < b.fold0_trades;  // fewer ranks better
}

struct AshaBarrierDecision {
    int ranked_count = 0;     // arms with a usable fold-0 score
    int unscored_count = 0;   // arms without a score (never killed)
    int keep_count = 0;       // rank survivors + guard-saved
    int floor = 0;            // max(kAshaKeepFloorBase, 2*concurrency)
    std::optional<double> guard_bar;  // family fold-run score p75
    int guard_saved_count = 0;        // arms below rank cut rescued by guard bar
    std::vector<int> kept_ordinals;      // best-ranked first (survive to rung 1)
    std::vector<int> killed_ordinals;    // worst-ranked last (park as screened)
};

// evaluateAshaShadow (asha-screening.ts:153-195), acting form: unscored arms are
// NEVER killed (absence != evidence, TICKET_1138); the guard bar rescues a
// strong-in-absolute-terms arm below the rank cut.
[[nodiscard]] inline AshaBarrierDecision asha_barrier(
    const std::vector<ArmObservation>& arms, int concurrency,
    std::optional<double> guard_bar,
    double keep_fraction = kAshaKeepFraction) {
    AshaBarrierDecision d;
    d.guard_bar = guard_bar;

    std::vector<ArmObservation> scored;
    scored.reserve(arms.size());
    for (const auto& a : arms) {
        if (a.fold0_score.has_value()) {
            scored.push_back(a);
        }
    }
    d.unscored_count = static_cast<int>(arms.size() - scored.size());
    d.floor = std::max(kAshaKeepFloorBase, 2 * std::max(1, concurrency));

    std::stable_sort(scored.begin(), scored.end(), asha_arm_less);
    d.ranked_count = static_cast<int>(scored.size());

    // rankKeep = max(floor, ceil(n * keepFraction)) (asha-screening.ts:164).
    const int ceil_keep = static_cast<int>(std::ceil(
        static_cast<double>(scored.size()) * keep_fraction));
    const int rank_keep = std::max(d.floor, ceil_keep);

    for (int idx = 0; idx < static_cast<int>(scored.size()); ++idx) {
        const ArmObservation& arm = scored[static_cast<std::size_t>(idx)];
        if (idx < rank_keep) {
            d.kept_ordinals.push_back(arm.arm_ordinal);
            continue;
        }
        // D3 absolute-bar guard.
        if (guard_bar.has_value() && arm.fold0_score.has_value() &&
            arm.fold0_score.value() >= guard_bar.value()) {
            ++d.guard_saved_count;
            d.kept_ordinals.push_back(arm.arm_ordinal);
            continue;
        }
        d.killed_ordinals.push_back(arm.arm_ordinal);
    }
    d.keep_count = static_cast<int>(d.kept_ordinals.size());
    return d;
}

// ============================================================================
// Resume / arm-skip fingerprint gate (TICKET_1289, sweep-runner grid.py +
// runner.py). An arm is skipped iff a prior result exists, parsed, has
// status=="ok", AND its fingerprint matches. Non-ok prior results are failures
// that force a refit -- never a skip. The fingerprint itself (SHA-256 of
// canonical {template,params}) is computed by the caller; the scheduler owns the
// SKIP DECISION over the (has_prior, prior_ok, fingerprint_match) triple.
// ============================================================================

struct ResumeProbe {
    bool has_prior = false;       // a persisted arm result file exists + parsed
    bool prior_ok = false;        // its status == "ok"
    bool fingerprint_match = false;  // persisted params fingerprint == grid's
};

[[nodiscard]] inline bool resume_should_skip(const ResumeProbe& p) noexcept {
    return p.has_prior && p.prior_ok && p.fingerprint_match;
}

// ============================================================================
// Batch phase state machine.
//
// The scheduler is driven as a pure planner: the caller supplies the batch
// shape + the ordered outcomes observed so far, and the scheduler returns the
// current phase and the set of arms the driver should dispatch next (the pool
// executes them concurrently up to `concurrency`, then reports outcomes and
// re-plans). This models the exact TS control flow:
//   * non-ASHA: one worker pool over all arms; retryable failures re-dispatch.
//   * ASHA kill: rung0 (fold-0 only, all arms) -> barrier (rank) -> rung1
//                (survivors continue folds 1..K-1). Killed arms park.
// Cancellation is an input flag: once cancelled the planner drains (emits no
// further dispatch directives; in-flight arms are the caller's to unwind).
// ============================================================================

enum class BatchPhase {
    Rung0,     // dispatching fold-0 (ASHA) or full arms (non-ASHA)
    Barrier,   // all rung-0 arms resolved; the ASHA rank decision is due
    Rung1,     // dispatching survivors' folds 1..K-1
    Done,      // every arm terminal (resolved / killed / failed)
    Cancelled, // drained on abort
};

[[nodiscard]] inline std::string_view batch_phase_name(BatchPhase p) noexcept {
    switch (p) {
        case BatchPhase::Rung0:     return "rung0";
        case BatchPhase::Barrier:   return "barrier";
        case BatchPhase::Rung1:     return "rung1";
        case BatchPhase::Done:      return "done";
        case BatchPhase::Cancelled: return "cancelled";
    }
    return "done";
}

// One observed arm outcome, fed back in the ordered stream.
struct ArmOutcome {
    int arm_ordinal = 0;   // 1-based
    ArmStatus status = ArmStatus::Ok;
    int attempt = 1;       // 1 for the first try; the driver increments on retry
    // Which rung produced this outcome. 0 for the non-ASHA single pool and for
    // ASHA rung-0 (fold 0); 1 for an ASHA survivor's folds 1..K-1. Lets the
    // planner tell "arm finished fold 0" from "arm finished the full K-fold".
    int rung = 0;
    // ASHA rung-0 metrics (only meaningful for rung 0; ignored otherwise).
    std::optional<double> fold0_score;
    std::optional<double> fold0_sharpe;
    double fold0_trades = 0.0;
    std::string fingerprint;  // carried for the barrier observation
};

struct BatchRequest {
    int arm_count = 0;
    int concurrency = 1;      // from MC-10 sweep-admission
    bool asha_kill = false;   // isAshaKillEnabled() && !revive && ML universe
    int max_retries = 1;      // retryable failures re-dispatched up to this many
    std::optional<double> guard_bar;  // family fold-run score p75 (barrier D3)
    double keep_fraction = kAshaKeepFraction;
    bool cancelled = false;   // abort seen -> drain
};

// Authoritative barrier diagnostics, populated on the plan that resolves the
// ASHA barrier. Surfaced so the driver's audit trail reports EXACTLY what the
// C++ owner decided (ranked/unscored/keep/floor/guard-bar/guard-saved) rather
// than reconstructing them in TS -- there is one owner of the barrier math, and
// its telemetry is emitted from that same owner (TICKET_1292_21 AC-4c / MC-12
// C7). `present` is false on every non-barrier plan.
struct BarrierSummary {
    bool present = false;
    int ranked_count = 0;
    int unscored_count = 0;
    int keep_count = 0;
    int floor = 0;
    std::optional<double> guard_bar;
    int guard_saved_count = 0;
};

struct BatchPlan {
    int version = kSchedulerVersion;
    BatchPhase phase = BatchPhase::Rung0;
    // Arm ordinals to dispatch next (bounded by `concurrency` at the head; the
    // driver's pool takes them in order and reports outcomes as they finish).
    std::vector<int> dispatch;
    // Populated only when phase == Barrier just resolved into Rung1: the arms
    // that survived / were killed. The driver parks killed arms as screened_fold0.
    std::vector<int> barrier_kept;
    std::vector<int> barrier_killed;
    // Barrier telemetry (present only on the barrier-resolving plan).
    BarrierSummary barrier;
    // Terminal-failed arms (retry budget exhausted or non-retryable status).
    std::vector<int> failed;
    // Progress: resolved = ok + terminal-failed + killed.
    int resolved = 0;
    int total = 0;
};

namespace detail {

// Per-arm rolled-up state for ONE rung, derived from the outcome stream (last
// write wins; attempts counts dispatches of that rung).
struct ArmRoll {
    bool has_outcome = false;
    ArmStatus last_status = ArmStatus::Ok;
    int attempts = 0;
    std::optional<double> fold0_score;
    std::optional<double> fold0_sharpe;
    double fold0_trades = 0.0;
    std::string fingerprint;
};

// Roll the ordered outcome stream into per-arm state for a specific rung.
// `rung_filter < 0` accepts any rung (the non-ASHA single pool).
[[nodiscard]] inline std::vector<ArmRoll> roll_outcomes(
    int arm_count, const std::vector<ArmOutcome>& outcomes, int rung_filter) {
    std::vector<ArmRoll> roll(static_cast<std::size_t>(std::max(0, arm_count)));
    for (const auto& o : outcomes) {
        if (rung_filter >= 0 && o.rung != rung_filter) continue;
        const int idx0 = o.arm_ordinal - 1;
        if (idx0 < 0 || idx0 >= arm_count) continue;
        ArmRoll& r = roll[static_cast<std::size_t>(idx0)];
        r.has_outcome = true;
        r.last_status = o.status;
        r.attempts = std::max(r.attempts, o.attempt);
        r.fold0_score = o.fold0_score;
        r.fold0_sharpe = o.fold0_sharpe;
        r.fold0_trades = o.fold0_trades;
        if (!o.fingerprint.empty()) r.fingerprint = o.fingerprint;
    }
    return roll;
}

// Is this arm terminal (needs no further dispatch)? Ok / non-retryable failure /
// retryable-but-exhausted are all terminal.
[[nodiscard]] inline bool arm_terminal(const ArmRoll& r, int max_retries) {
    if (!r.has_outcome) return false;
    if (r.last_status == ArmStatus::Ok) return true;
    if (r.last_status == ArmStatus::Cancelled) return true;
    if (!is_retryable_status(r.last_status)) return true;
    return r.attempts >= std::max(1, max_retries);  // retry budget spent
}

// Is this arm a terminal FAILURE (not a success, not still-retrying)?
[[nodiscard]] inline bool arm_failed(const ArmRoll& r, int max_retries) {
    return arm_terminal(r, max_retries) && r.last_status != ArmStatus::Ok &&
           r.last_status != ArmStatus::Cancelled;
}

// Arms that still need a dispatch this phase: never dispatched, OR a retryable
// failure with retry budget left. Returns ordinals in ascending order (the
// cursor order); the driver's pool head-limits to `concurrency`.
[[nodiscard]] inline std::vector<int> arms_needing_dispatch(
    const std::vector<ArmRoll>& roll, int max_retries) {
    std::vector<int> out;
    for (int i = 0; i < static_cast<int>(roll.size()); ++i) {
        const ArmRoll& r = roll[static_cast<std::size_t>(i)];
        if (!r.has_outcome) { out.push_back(i + 1); continue; }
        if (r.last_status == ArmStatus::Ok) continue;
        if (r.last_status == ArmStatus::Cancelled) continue;
        if (is_retryable_status(r.last_status) &&
            r.attempts < std::max(1, max_retries)) {
            out.push_back(i + 1);
        }
    }
    return out;
}

}  // namespace detail

// Plan the next step of the batch from the ordered outcome stream. Pure and
// deterministic: same (request, outcomes) -> same plan.
[[nodiscard]] inline BatchPlan plan_batch(const BatchRequest& req,
                                          const std::vector<ArmOutcome>& outcomes) {
    BatchPlan plan;
    plan.total = req.arm_count;
    const int conc = std::max(1, req.concurrency);

    if (req.cancelled) {
        plan.phase = BatchPhase::Cancelled;
        return plan;  // drain: no dispatch directives
    }
    if (req.arm_count <= 0) {
        plan.phase = BatchPhase::Done;
        return plan;
    }

    // ---- Non-ASHA: single pool over all arms; retries re-dispatch. ----------
    if (!req.asha_kill) {
        const std::vector<detail::ArmRoll> roll =
            detail::roll_outcomes(req.arm_count, outcomes, /*rung_filter=*/-1);
        for (int i = 0; i < req.arm_count; ++i) {
            const detail::ArmRoll& r = roll[static_cast<std::size_t>(i)];
            if (detail::arm_terminal(r, req.max_retries)) ++plan.resolved;
            if (detail::arm_failed(r, req.max_retries)) plan.failed.push_back(i + 1);
        }
        std::vector<int> pending =
            detail::arms_needing_dispatch(roll, req.max_retries);
        if (pending.empty()) {
            plan.phase = BatchPhase::Done;
            return plan;
        }
        plan.phase = BatchPhase::Rung0;
        const int take = std::min<int>(conc, static_cast<int>(pending.size()));
        plan.dispatch.assign(pending.begin(), pending.begin() + take);
        return plan;
    }

    // ---- ASHA kill: rung0 -> barrier -> rung1. ------------------------------
    // Rung 0 completes when every arm has a terminal fold-0 outcome. Until then,
    // keep dispatching fold-0 (rung 0 outcomes only).
    const std::vector<detail::ArmRoll> r0 =
        detail::roll_outcomes(req.arm_count, outcomes, /*rung_filter=*/0);
    std::vector<int> rung0_pending =
        detail::arms_needing_dispatch(r0, req.max_retries);
    if (!rung0_pending.empty()) {
        plan.phase = BatchPhase::Rung0;
        const int take =
            std::min<int>(conc, static_cast<int>(rung0_pending.size()));
        plan.dispatch.assign(rung0_pending.begin(), rung0_pending.begin() + take);
        // Fold-0 failures that exhausted their retries are terminal-failed now.
        for (int i = 0; i < req.arm_count; ++i) {
            if (detail::arm_failed(r0[static_cast<std::size_t>(i)],
                                   req.max_retries)) {
                plan.failed.push_back(i + 1);
                ++plan.resolved;
            }
        }
        return plan;
    }
    // Rung 0 fully resolved -- fold-0 failures are terminal, ok arms rank.
    for (int i = 0; i < req.arm_count; ++i) {
        if (detail::arm_failed(r0[static_cast<std::size_t>(i)], req.max_retries)) {
            plan.failed.push_back(i + 1);
            ++plan.resolved;
        }
    }

    // Barrier: rank the ok fold-0 arms (deterministic; recomputed every call).
    std::vector<ArmObservation> obs;
    for (int i = 0; i < req.arm_count; ++i) {
        const detail::ArmRoll& r = r0[static_cast<std::size_t>(i)];
        if (r.has_outcome && r.last_status == ArmStatus::Ok) {
            ArmObservation o;
            o.arm_ordinal = i + 1;
            o.fingerprint = r.fingerprint;
            o.fold0_score = r.fold0_score;
            o.fold0_sharpe = r.fold0_sharpe;
            o.fold0_trades = r.fold0_trades;
            obs.push_back(o);
        }
    }
    const AshaBarrierDecision bar =
        asha_barrier(obs, conc, req.guard_bar, req.keep_fraction);
    plan.barrier_kept = bar.kept_ordinals;
    plan.barrier_killed = bar.killed_ordinals;
    plan.barrier.present = true;
    plan.barrier.ranked_count = bar.ranked_count;
    plan.barrier.unscored_count = bar.unscored_count;
    plan.barrier.keep_count = bar.keep_count;
    plan.barrier.floor = bar.floor;
    plan.barrier.guard_bar = bar.guard_bar;
    plan.barrier.guard_saved_count = bar.guard_saved_count;
    // Killed arms are parked -> resolved. Survivors continue to rung 1.
    plan.resolved += static_cast<int>(bar.killed_ordinals.size());
    if (bar.kept_ordinals.empty()) {
        plan.phase = BatchPhase::Done;
        return plan;
    }

    // Rung 1: dispatch survivors that have not yet finished folds 1..K-1, in
    // barrier (best-first) order. A survivor is done when it has a terminal
    // rung-1 outcome.
    const std::vector<detail::ArmRoll> r1 =
        detail::roll_outcomes(req.arm_count, outcomes, /*rung_filter=*/1);
    std::vector<int> rung1_pending;
    for (int ord : bar.kept_ordinals) {
        const detail::ArmRoll& r = r1[static_cast<std::size_t>(ord - 1)];
        if (detail::arm_terminal(r, req.max_retries)) {
            ++plan.resolved;
            if (detail::arm_failed(r, req.max_retries)) plan.failed.push_back(ord);
        } else {
            rung1_pending.push_back(ord);  // preserves best-first order
        }
    }
    if (rung1_pending.empty()) {
        plan.phase = BatchPhase::Done;
        return plan;
    }
    plan.phase = BatchPhase::Rung1;
    const int take = std::min<int>(conc, static_cast<int>(rung1_pending.size()));
    plan.dispatch.assign(rung1_pending.begin(), rung1_pending.begin() + take);
    return plan;
}

}  // namespace StratCraft::executor::scheduler
