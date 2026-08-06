#pragma once

// TICKET_1292_10 (MC-10): C++23 resource-governance owner -- the single source
// of truth for the resource-admission / capacity decision that was implemented
// three independent times (Python resource_gate.py + resource_watchdog.py +
// training_memory.py RssSentinel; TS pipeline-resource-profile.ts +
// compute-environment.ts swap classification; shell cgroup-fence.sh cap->quota
// derivation). Three copies of the same headroom / swap-pressure / cap math had
// already diverged into OOM incident history (TICKET_1071, TICKET_1288_3), a
// single-source-of-truth violation (TICKET_849 class).
//
// This header owns the DECISION math only, as pure C++23 free functions (no IO,
// no threads, no clock). The consumers keep exactly what is legitimately theirs:
//   * sampling  -- reading /proc (MemAvailable, loadavg, swap, self VmRSS/VmHWM,
//                  cgroup memory.current). That is platform IO and stays in the
//                  caller (Python psutil, TS fs, shell). The sampled numbers are
//                  passed IN to these functions.
//   * enforcement -- pausing at a safe epoch/cell boundary, rebuilding a
//                  DataLoader, applying systemd properties. That stays in the
//                  caller too; these functions only return the verdict.
//
// Three decision surfaces, mirroring the three Python engines byte-for-byte:
//   1. classify_swap_pressure  -- TS pipeline-resource-profile.ts three-tier
//                                 none/unlikely/likely classifier.
//   2. HysteresisGate          -- resource_gate.py OR-pause / AND-resume state
//                                 machine incl. the TICKET_1285 swap sub-terms.
//   3. evaluate_budget         -- resource_watchdog.py / RssSentinel per-cell RSS
//                                 budget + VmHWM closed-loop degrade->abort ladder
//                                 + resolve_cell_budget_mb.
//   plus solve_capacity        -- the capacity/geometry + cgroup cap->limit
//                                 derivation (cgroup-fence.sh compute_cgroup_props
//                                 + the CPU/mem cap math the TS estimate uses).
//
// All thresholds are named constants here (NO MAGIC NUMBERS / TICKET_179) and are
// the ONLY definition; the Python/TS/shell mirrors become thin consumers of the
// serialized decision. Values are frozen against the audited sources:
//   resource_gate.py:64-79, resource_watchdog.py:34-36, cgroup-fence.sh:36-52,
//   compute-environment.ts SWAP_PRESSURE_HIGH_MEM_FRACTION, pipeline-resource-
//   profile.ts classifySwapPressure.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <string_view>

namespace StratCraft::executor::resource_governance {

// Frozen wire-contract version. Bump only on a breaking envelope change.
inline constexpr int kResourceGovernanceVersion = 1;

// ============================================================================
// Constants -- the single definition of every governance threshold.
// ============================================================================

// -- Admission hysteresis (resource_gate.py:64-79) --
inline constexpr double kDefaultPausePct = 30.0;
inline constexpr double kDefaultResumeHysteresisPct = 10.0;
inline constexpr double kDefaultResumePct =
    kDefaultPausePct + kDefaultResumeHysteresisPct;  // 40.0
inline constexpr double kDefaultSwapPausePct = 70.0;
inline constexpr double kDefaultSwapResumePct = 60.0;
inline constexpr double kDefaultSwapGrowthPauseMb = 500.0;
inline constexpr double kDefaultSwapGrowthResumeMb = 0.0;
inline constexpr double kDefaultPollSeconds = 10.0;

// -- Per-cell RSS budget (resource_watchdog.py:34-36) --
inline constexpr double kDefaultCellBudgetGb = 24.0;
inline constexpr double kDefaultCellBudgetMemTotalFrac = 0.40;
inline constexpr double kBytesPerMb = 1024.0 * 1024.0;
inline constexpr double kBytesPerGb = 1024.0 * 1024.0 * 1024.0;
inline constexpr double kMbPerGb = 1024.0;

// -- Swap-pressure classification (compute-environment.ts) --
inline constexpr double kSwapPressureHighMemFraction = 0.85;

// -- cgroup cap->limit derivation (cgroup-fence.sh:36-52) --
// MemoryHigh is 92% of MemoryMax; swap partition is MemoryMax/6.
inline constexpr int kCgroupMemoryHighPctOfMax = 92;  // cgroup-fence.sh:49
inline constexpr int kCgroupSwapMaxDivisor = 6;       // cgroup-fence.sh:45

// -- Per-arm sweep admission (discovery-orchestrator.ts resolveSweepParallelism
//    + resolveBlasThreadEnv). TICKET_1292_12 (MC-12) folds the sweep-scheduler's
//    arm-admission math into this single capacity owner so it is no longer a
//    fourth private copy of the cores x arms x cost x memory-gate formula.
//    Values frozen against discovery-orchestrator.ts:10546-10731. --
inline constexpr int kSweepDefaultMaxConcurrency = 3;   // SWEEP_MAX_CONCURRENCY
inline constexpr double kFitMatrixBytesPerCell = 4.0 * 2.0;   // FIT_MATRIX_BYTES_PER_CELL
inline constexpr double kFitEstimateCalibrationDivisor = 1.0;  // FIT_ESTIMATE_CALIBRATION_DIVISOR
inline constexpr std::int64_t kSweepSystemReserveBytes =
    static_cast<std::int64_t>(15) * 1024 * 1024 * 1024;  // SWEEP_SYSTEM_RESERVE_BYTES (15 GiB)
// resolveSweepParallelism:10672 -- cost re-split only kicks in above a 2x arm.
inline constexpr double kSweepCostSplitThreshold = 2.0;
// resolveSweepParallelism:10673 -- floor when the cost split applies.
inline constexpr int kSweepCostSplitFloor = 2;

// ============================================================================
// NaN <-> JSON-null helper (mirrors the packaged-command wire convention).
// ============================================================================

[[nodiscard]] inline double qnan() noexcept {
    return std::numeric_limits<double>::quiet_NaN();
}

// ============================================================================
// 1. Swap-pressure classification (pipeline-resource-profile.ts classifySwapPressure).
//
//    Derived from the memory estimate -- never an independent model (SSOT). The
//    three tiers:
//      likely   : estimatedPeakMB > memAvailableMB          (active swap / thrash)
//      unlikely : peak + current-used > total  OR  peak >= 0.85 * available
//      none     : fits comfortably
//    `current-used` = memTotalMB - memAvailableMB (what else is resident).
// ============================================================================

enum class SwapPressure { None, Unlikely, Likely };

[[nodiscard]] inline std::string_view swap_pressure_name(SwapPressure p) noexcept {
    switch (p) {
        case SwapPressure::None:
            return "none";
        case SwapPressure::Unlikely:
            return "unlikely";
        case SwapPressure::Likely:
            return "likely";
    }
    return "none";
}

[[nodiscard]] inline SwapPressure classify_swap_pressure(
    double estimated_peak_mb, double mem_available_mb,
    double mem_total_mb) noexcept {
    const double current_used_mb = mem_total_mb - mem_available_mb;
    if (estimated_peak_mb > mem_available_mb) {
        return SwapPressure::Likely;
    }
    if (estimated_peak_mb + current_used_mb > mem_total_mb ||
        estimated_peak_mb >= mem_available_mb * kSwapPressureHighMemFraction) {
        return SwapPressure::Unlikely;
    }
    return SwapPressure::None;
}

// ============================================================================
// 2. Admission hysteresis gate (resource_gate.py).
//
//    A pure state machine. The caller samples /proc, hands a ResourceSnapshot to
//    `update()`, and receives a transition edge. Swap rate-of-change (delta) is
//    stamped inside `update()` from the retained previous swap level, exactly as
//    resource_gate.py:_with_swap_delta does (the first sample's delta is 0 --
//    the first-sample seam, TICKET_1285 F1). Enforcement (blocking until the gate
//    reopens) stays in the caller's `wait_until_clear`; this owner only decides.
// ============================================================================

struct ResourceSnapshot {
    double mem_headroom_pct = 0.0;
    double cpu_headroom_pct = 0.0;
    double swap_used_pct = 0.0;
    double swap_used_mb = 0.0;
    // The delta the gate stamps; a directly-constructed snapshot defaults to 0,
    // matching resource_gate.py's frozen-dataclass default (first-sample seam).
    double swap_delta_mb = 0.0;
};

// Transition edges as an enum so callers never string-compare. `None` is the
// unchanged state ("" in the Python contract).
enum class GateTransition { None, Pause, Resume };

[[nodiscard]] inline std::string_view gate_transition_name(
    GateTransition t) noexcept {
    switch (t) {
        case GateTransition::None:
            return "";
        case GateTransition::Pause:
            return "pause";
        case GateTransition::Resume:
            return "resume";
    }
    return "";
}

struct HysteresisConfig {
    double pause_pct = kDefaultPausePct;
    double resume_pct = kDefaultResumePct;
    double swap_pause_pct = kDefaultSwapPausePct;
    double swap_resume_pct = kDefaultSwapResumePct;
    double swap_growth_pause_mb = kDefaultSwapGrowthPauseMb;
    double swap_growth_resume_mb = kDefaultSwapGrowthResumeMb;
    double poll_seconds = kDefaultPollSeconds;
    bool enabled = true;

    // Mirrors resource_gate.py __init__ validation (raises on inverted
    // hysteresis). Returns the offending message, or empty when valid.
    [[nodiscard]] std::string validation_error() const {
        if (resume_pct < pause_pct) {
            return "resume_pct (" + std::to_string(resume_pct) +
                   ") must be >= pause_pct (" + std::to_string(pause_pct) +
                   ") for hysteresis";
        }
        if (swap_resume_pct > swap_pause_pct) {
            return "swap_resume_pct (" + std::to_string(swap_resume_pct) +
                   ") must be <= swap_pause_pct (" +
                   std::to_string(swap_pause_pct) + ") for hysteresis";
        }
        if (swap_growth_resume_mb > swap_growth_pause_mb) {
            return "swap_growth_resume_mb (" +
                   std::to_string(swap_growth_resume_mb) +
                   ") must be <= swap_growth_pause_mb (" +
                   std::to_string(swap_growth_pause_mb) + ") for hysteresis";
        }
        return {};
    }
};

class HysteresisGate {
   public:
    explicit HysteresisGate(HysteresisConfig config) : config_(config) {}

    // Seed the gate's paused state + previous swap level. Used when a caller owns
    // the long-lived gate state (e.g. resource_gate.py's ResourceGate) and
    // delegates a single sample's edge per call: the retained (paused, prev-swap)
    // pair is threaded in so one stateless C++ call reproduces the exact edge.
    void seed(bool paused, std::optional<double> prev_swap_mb) noexcept {
        paused_ = paused;
        prev_swap_mb_ = prev_swap_mb;
    }
    [[nodiscard]] std::optional<double> prev_swap_mb() const noexcept {
        return prev_swap_mb_;
    }

    // OR-pause: any axis below its floor pauses (resource_gate.py:_should_pause).
    [[nodiscard]] bool should_pause(const ResourceSnapshot& snap) const noexcept {
        const bool swap_pause =
            snap.swap_used_pct > config_.swap_pause_pct ||
            snap.swap_delta_mb > config_.swap_growth_pause_mb;
        return snap.mem_headroom_pct < config_.pause_pct ||
               snap.cpu_headroom_pct < config_.pause_pct || swap_pause;
    }

    // AND-resume: all axes recovered AND swap stable (resource_gate.py:_should_resume).
    [[nodiscard]] bool should_resume(const ResourceSnapshot& snap) const noexcept {
        const bool swap_resume =
            snap.swap_used_pct <= config_.swap_resume_pct &&
            snap.swap_delta_mb <= config_.swap_growth_resume_mb;
        return snap.mem_headroom_pct >= config_.resume_pct &&
               snap.cpu_headroom_pct >= config_.resume_pct && swap_resume;
    }

    // Advance the state machine one sample. Stamps the swap delta from the
    // retained previous level (first sample -> delta 0). Returns the edge.
    GateTransition update(ResourceSnapshot snap) noexcept {
        if (!config_.enabled) {
            return GateTransition::None;
        }
        const double delta =
            prev_swap_mb_.has_value() ? snap.swap_used_mb - *prev_swap_mb_ : 0.0;
        prev_swap_mb_ = snap.swap_used_mb;
        snap.swap_delta_mb = delta;

        GateTransition transition = GateTransition::None;
        if (paused_) {
            if (should_resume(snap)) {
                paused_ = false;
                transition = GateTransition::Resume;
            }
        } else {
            if (should_pause(snap)) {
                paused_ = true;
                transition = GateTransition::Pause;
            }
        }
        last_snapshot_ = snap;
        return transition;
    }

    [[nodiscard]] bool paused() const noexcept { return paused_; }
    [[nodiscard]] const ResourceSnapshot& last_snapshot() const noexcept {
        return last_snapshot_;
    }
    [[nodiscard]] const HysteresisConfig& config() const noexcept {
        return config_;
    }

   private:
    HysteresisConfig config_;
    bool paused_ = false;
    std::optional<double> prev_swap_mb_ = std::nullopt;
    ResourceSnapshot last_snapshot_{};
};

// ============================================================================
// 3. Per-cell RSS budget + closed-loop degradation ladder.
//
//    resolve_cell_budget_mb (resource_watchdog.py:53-62): the hard per-cell line,
//    min(budget_gb, memtotal_frac * MemTotal), in MB.
//
//    evaluate_budget: the RssSentinel.observe ladder (training_memory.py:142-210)
//    expressed as a pure decision. Given the sampled RSS, the budget, and whether
//    a degradation has ALREADY been applied, it returns Ok / Degrade / Abort. The
//    caller enforces (rebuild DataLoader on Degrade, raise on Abort) at its safe
//    batch boundary -- no preemption-semantics change.
// ============================================================================

[[nodiscard]] inline double resolve_cell_budget_mb(
    double mem_total_bytes, double budget_gb = kDefaultCellBudgetGb,
    double memtotal_frac = kDefaultCellBudgetMemTotalFrac) noexcept {
    const double frac_gb = (mem_total_bytes / kBytesPerGb) * memtotal_frac;
    return std::min(budget_gb, frac_gb) * kMbPerGb;
}

enum class BudgetVerdict { Ok, Degrade, Abort };

[[nodiscard]] inline std::string_view budget_verdict_name(
    BudgetVerdict v) noexcept {
    switch (v) {
        case BudgetVerdict::Ok:
            return "ok";
        case BudgetVerdict::Degrade:
            return "degrade";
        case BudgetVerdict::Abort:
            return "abort";
    }
    return "ok";
}

// One rung of the RssSentinel ladder. `rss_mb` is the sampled resident set (the
// cgroup-tree aggregate in DDP mode, else self VmRSS -- the caller resolves which
// and passes the chosen quantity, exactly as observe() does). `already_degraded`
// is the sentinel's own `_degraded` flag threaded back in.
[[nodiscard]] inline BudgetVerdict evaluate_budget(
    double rss_mb, double budget_mb, bool already_degraded) noexcept {
    if (rss_mb <= budget_mb) {
        return BudgetVerdict::Ok;
    }
    // First breach -> degrade the loader and grant one more interval to recover.
    // Persisting breach after degradation -> abort (TICKET_857 fail-fast).
    return already_degraded ? BudgetVerdict::Abort : BudgetVerdict::Degrade;
}

// The per-cell watchdog breach check (resource_watchdog.py:_sample_once +
// raise_if_breached). Pure: given the peak seen so far and a new sample, report
// the new peak and whether the budget line was crossed.
struct CellWatchdogState {
    double peak_rss_mb = 0.0;
    bool breached = false;
};

[[nodiscard]] inline CellWatchdogState cell_watchdog_observe(
    CellWatchdogState prior, double rss_mb, double budget_mb) noexcept {
    CellWatchdogState next = prior;
    if (rss_mb > next.peak_rss_mb) {
        next.peak_rss_mb = rss_mb;
    }
    if (rss_mb > budget_mb) {
        next.breached = true;
    }
    return next;
}

// ============================================================================
// 4. Capacity solver + cgroup cap->limit derivation.
//
//    solve_capacity resolves the effective CPU share, memory budget, and the
//    systemd/cgroup hard limits from a workload cap % (Electron settings) against
//    the live machine. This is the C++ owner for cgroup-fence.sh:compute_cgroup_props
//    (cap% -> MemoryMax/MemoryHigh/MemorySwapMax/CPUQuota) and for the cap-derived
//    pause/resume thresholds that run-*-chain.sh re-derived in shell
//    (GOV_PAUSE_PCT = cap, GOV_RESUME_PCT = cap + hysteresis).
// ============================================================================

struct MachineState {
    int ncpu = 1;
    double mem_total_bytes = 0.0;
};

struct CapacityRequest {
    MachineState machine;
    // Workload cap as a percentage of the machine (Electron per-workload setting).
    double cap_pct = kDefaultPausePct;
    double resume_hysteresis_pct = kDefaultResumeHysteresisPct;
};

struct CapacityDecision {
    // Systemd/cgroup hard limits (cgroup-fence.sh compute_cgroup_props). GiB and
    // percent, integer-floored exactly as the shell `$(( ))` arithmetic does so
    // the C++ value and the shell value are identical.
    std::int64_t cgroup_memory_max_gib = 0;
    std::int64_t cgroup_memory_high_gib = 0;
    std::int64_t cgroup_swap_max_gib = 0;
    std::int64_t cgroup_cpu_quota_pct = 0;
    // Admission thresholds derived from the same cap (run-*-chain.sh:70-71).
    double gov_pause_pct = 0.0;
    double gov_resume_pct = 0.0;
};

[[nodiscard]] inline CapacityDecision solve_capacity(
    const CapacityRequest& req) noexcept {
    CapacityDecision d;
    const double mem_total_gib = req.machine.mem_total_bytes / kBytesPerGb;

    // cgroup-fence.sh:47-51 -- integer GiB arithmetic (bash truncates toward 0).
    //   mem_max_g  = cap% of MemTotal (GiB)
    //   swap_max_g = mem_max_g / 6
    //   mem_high   = mem_max_g * 92 / 100
    //   cpu_quota  = cap% * NCPU
    const auto mem_max_g = static_cast<std::int64_t>(
        (mem_total_gib * req.cap_pct) / 100.0);
    d.cgroup_memory_max_gib = mem_max_g;
    d.cgroup_swap_max_gib = mem_max_g / kCgroupSwapMaxDivisor;
    d.cgroup_memory_high_gib =
        (mem_max_g * kCgroupMemoryHighPctOfMax) / 100;
    d.cgroup_cpu_quota_pct = static_cast<std::int64_t>(
        req.cap_pct * static_cast<double>(req.machine.ncpu));

    // run-*-chain.sh:70-71 -- pause = cap, resume = cap + hysteresis.
    d.gov_pause_pct = req.cap_pct;
    d.gov_resume_pct = req.cap_pct + req.resume_hysteresis_pct;
    return d;
}

// ============================================================================
// 5. Per-arm sweep admission (discovery-orchestrator.ts resolveSweepParallelism
//    + resolveBlasThreadEnv + estimatePerArmFitBytes).
//
//    The sweep scheduler's arm-admission decision: given a resolved arm count,
//    a per-arm peak-RSS estimate, the worst arm cost factor, and the live
//    machine (cores + available memory), resolve the worker-pool width and the
//    per-worker BLAS/OpenMP thread cap. This was TS-owned in
//    resolveSweepParallelism (10657-10697); MC-12 makes it a consumer of this
//    single C++ capacity owner instead of a fourth private copy.
//
//    IO stays in the caller (exactly like solve_capacity): the caller resolves
//    SWEEP_MAX_CONCURRENCY from env (resolveSweepMaxConcurrency), reads
//    MemAvailable (getAvailableMemoryBytes -> /proc/meminfo), and counts cores
//    (os.availableParallelism). Those sampled numbers are passed IN; this
//    function is pure arithmetic with no clock, IO, or thread.
// ============================================================================

struct SweepAdmissionRequest {
    int arm_count = 0;
    int ncpu = 1;
    // resolveSweepMaxConcurrency() result (env override already applied by the
    // caller; absent env -> kSweepDefaultMaxConcurrency).
    int max_concurrency = kSweepDefaultMaxConcurrency;
    // estimatePerArmFitBytes(...) result. 0 for non-ML / factor sweeps -> the
    // memory gate is skipped (resolveSweepParallelism:10680 `perArmBytes > 0`).
    double per_arm_bytes = 0.0;
    // Max modelCostFactor across the grid (resolveSweepParallelism:10672). 1 for
    // factor universes and cheap arms.
    double max_arm_cost_factor = 1.0;
    // getAvailableMemoryBytes() (MemAvailable, not MemFree -- TICKET_1184).
    double mem_available_bytes = 0.0;
};

struct SweepAdmissionDecision {
    // Resolved worker-pool width (resolveSweepParallelism return).
    int concurrency = 1;
    // floor(cores / concurrency), min 1 (resolveBlasThreadEnv:10722). The caller
    // fans this into OPENBLAS/OMP/MKL/NUMEXPR_NUM_THREADS + SWEEP_FIT_N_JOBS.
    int blas_threads_per_worker = 1;
    // Whether the memory gate clamped below the CPU-side baseline (for the
    // caller's telemetry line; resolveSweepParallelism:10686 log).
    bool memory_gate_clamped = false;
    // The pre-memory-gate baseline, exposed so the caller can log the
    // baseline->memCap transition exactly as the TS did.
    int cpu_baseline = 1;
    // The memory-derived cap (only meaningful when per_arm_bytes > 0; equals
    // cpu_baseline when the gate was skipped).
    int memory_cap = 1;
};

// estimatePerArmFitBytes (discovery-orchestrator.ts:10633). Pure; returns 0 for
// non-ML sweeps so the caller can skip the memory gate. Exposed here so the
// estimate and the gate share one owner.
[[nodiscard]] inline double estimate_per_arm_fit_bytes(
    int symbol_count, int bars_per_symbol, int feature_dim) noexcept {
    if (symbol_count <= 0 || bars_per_symbol <= 0 || feature_dim <= 0) {
        return 0.0;
    }
    return static_cast<double>(symbol_count) *
           static_cast<double>(bars_per_symbol) *
           static_cast<double>(feature_dim) * kFitMatrixBytesPerCell;
}

// resolveBlasThreadEnv (discovery-orchestrator.ts:10717). floor(cores/conc), >=1.
[[nodiscard]] inline int resolve_blas_threads(int ncpu, int concurrency) noexcept {
    const int denom = concurrency > 1 ? concurrency : 1;
    const int per_worker = ncpu / denom;
    return per_worker > 1 ? per_worker : 1;
}

[[nodiscard]] inline SweepAdmissionDecision solve_sweep_admission(
    const SweepAdmissionRequest& req) noexcept {
    SweepAdmissionDecision d;
    // resolveSweepParallelism:10663 -- a single arm never parallelises.
    if (req.arm_count <= 1) {
        d.concurrency = 1;
        d.cpu_baseline = 1;
        d.memory_cap = 1;
        d.blas_threads_per_worker = resolve_blas_threads(req.ncpu, 1);
        return d;
    }

    const int cores = req.ncpu > 1 ? req.ncpu : 1;
    // resolveSweepParallelism:10671 -- min(cores, arms, maxConcurrency).
    int baseline = std::min({cores, req.arm_count,
                             std::max(1, req.max_concurrency)});
    // resolveSweepParallelism:10672-10674 -- cost re-split above a 2x arm.
    if (req.max_arm_cost_factor > kSweepCostSplitThreshold) {
        const int split = static_cast<int>(
            std::floor(static_cast<double>(baseline) / req.max_arm_cost_factor));
        baseline = std::max(kSweepCostSplitFloor, split);
    }
    d.cpu_baseline = baseline;
    d.memory_cap = baseline;

    // resolveSweepParallelism:10680-10695 -- memory gate (skipped when the
    // per-arm estimate is 0, i.e. factor / non-ML sweeps).
    if (req.per_arm_bytes > 0.0) {
        const double calibrated =
            req.per_arm_bytes / kFitEstimateCalibrationDivisor;
        const double available = std::max(
            0.0, req.mem_available_bytes -
                     static_cast<double>(kSweepSystemReserveBytes));
        int mem_cap = baseline;
        if (calibrated > 0.0) {
            mem_cap = std::max(
                1, static_cast<int>(std::floor(available / calibrated)));
        }
        d.memory_cap = mem_cap;
        if (mem_cap < baseline) {
            d.memory_gate_clamped = true;
            baseline = mem_cap;
        }
    }

    d.concurrency = baseline;
    d.blas_threads_per_worker = resolve_blas_threads(cores, baseline);
    return d;
}

}  // namespace StratCraft::executor::resource_governance
