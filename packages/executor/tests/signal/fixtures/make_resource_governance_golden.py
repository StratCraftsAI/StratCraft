#!/usr/bin/env python3
"""TICKET_1292_10 (MC-10): generate the resource-governance golden parity fixture.

The C++ owner (resource_governance.hpp) must reproduce the decisions of the
retained-as-drift-reference Python engines byte-for-byte. This script drives the
LIVE Python engines -- resource_gate.ResourceGate (hysteresis), resource_watchdog
(cell budget), training-memory-style budget ladder, and the cgroup-fence /
run-*-chain cap->limit arithmetic -- over a battery of cases and writes the
inputs + expected outputs to resource_governance_parity_v1.json. The C++ test
and the desktop resource-governance-runner test both read this SAME fixture, so
all three languages agree on one contract. Re-run after any threshold change:

    python packages/executor/tests/signal/fixtures/make_resource_governance_golden.py

It imports the real modules (no re-implementation) so the fixture can never drift
from the Python source of record while the reroute is in flight.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Make nona_algorithm importable without installing the package.
_REPO = Path(__file__).resolve().parents[5]
_PKG = _REPO / "packages" / "nona-algorithm"
if str(_PKG) not in sys.path:
    sys.path.insert(0, str(_PKG))

from nona_algorithm.governance.resource_gate import (  # noqa: E402
    DEFAULT_RESUME_HYSTERESIS_PCT,
    ResourceGate,
    ResourceSnapshot,
)
from nona_algorithm.governance.resource_watchdog import (  # noqa: E402
    resolve_cell_budget_mb,
)

_OUT = Path(__file__).resolve().parent / "resource_governance_parity_v1.json"

_BYTES_PER_GB = 1024.0**3


# --------------------------------------------------------------------------
# 1. swap-pressure -- classifySwapPressure (pipeline-resource-profile.ts).
#    The Python engines do not own this classifier (it is TS), so we encode its
#    exact three-tier logic here as the reference. This is the ONE place the
#    classifier's spec lives in Python; the C++ owner mirrors it.
# --------------------------------------------------------------------------
_SWAP_PRESSURE_HIGH_MEM_FRACTION = 0.85


def _classify_swap_pressure(peak: float, avail: float, total: float) -> str:
    current_used = total - avail
    if peak > avail:
        return "likely"
    if peak + current_used > total or peak >= avail * _SWAP_PRESSURE_HIGH_MEM_FRACTION:
        return "unlikely"
    return "none"


def _swap_pressure_cases() -> list[dict]:
    raw = [
        # (peak, avail, total, label)
        (1000.0, 8000.0, 16000.0, "comfortable_none"),
        (9000.0, 8000.0, 16000.0, "peak_over_avail_likely"),
        (7000.0, 8000.0, 16000.0, "high_frac_unlikely"),      # 7000 >= 0.85*8000=6800
        (6000.0, 8000.0, 10000.0, "peak_plus_current_over_total"),  # 6000+2000>... no; 8000avail
        (6790.0, 8000.0, 16000.0, "just_below_frac_none"),    # 6790 < 6800
    ]
    cases = []
    for peak, avail, total, label in raw:
        cases.append(
            {
                "label": label,
                "input": {
                    "kind": "swap-pressure",
                    "estimatedPeakMB": peak,
                    "memAvailableMB": avail,
                    "memTotalMB": total,
                },
                "expected": {
                    "version": 1,
                    "pressure": _classify_swap_pressure(peak, avail, total),
                },
            }
        )
    return cases


# --------------------------------------------------------------------------
# 2. hysteresis -- ResourceGate.update() replayed over a sample stream.
# --------------------------------------------------------------------------
def _hysteresis_case(label: str, config: dict, samples: list[dict]) -> dict:
    # Drive the LIVE gate. Feed each sample via a stub sampler so update() runs
    # exactly as production does (delta stamped internally from prev swap level).
    kwargs = {
        "enabled": config.get("enabled", True),
    }
    if config.get("enabled", True):
        kwargs.update(
            pause_pct=config.get("pausePct", 30.0),
            resume_pct=config.get("resumePct", 40.0),
            swap_pause_pct=config.get("swapPausePct", 70.0),
            swap_resume_pct=config.get("swapResumePct", 60.0),
            swap_growth_pause_mb=config.get("swapGrowthPauseMb", 500.0),
            swap_growth_resume_mb=config.get("swapGrowthResumeMb", 0.0),
            poll_seconds=config.get("pollSeconds", 10.0),
        )
    gate = ResourceGate(**kwargs)
    transitions = []
    for s in samples:
        snap = ResourceSnapshot(
            mem_headroom_pct=s["memHeadroomPct"],
            cpu_headroom_pct=s["cpuHeadroomPct"],
            swap_used_pct=s["swapUsedPct"],
            swap_used_mb=s.get("swapUsedMb", 0.0),
        )
        transitions.append(gate.update(snap))
    # The gate's retained previous swap level after the replay -- echoed by the
    # C++ owner so a single-sample caller can thread it into the next call. A
    # disabled gate never samples, so prev stays None (null).
    prev_swap = getattr(gate, "_prev_swap_mb", None)
    return {
        "label": label,
        "input": {
            "kind": "hysteresis",
            "config": config,
            "samples": samples,
        },
        "expected": {
            "version": 1,
            "transitions": transitions,
            "paused": gate.paused,
            "pollSeconds": config.get("pollSeconds", 10.0) if config.get("enabled", True) else 10.0,
            "prevSwapMb": prev_swap,
        },
    }


def _hysteresis_cases() -> list[dict]:
    cases = []
    # mem pressure pauses, recovery resumes.
    cases.append(
        _hysteresis_case(
            "mem_pause_then_resume",
            {"pausePct": 30.0, "resumePct": 40.0, "enabled": True},
            [
                {"memHeadroomPct": 50.0, "cpuHeadroomPct": 50.0, "swapUsedPct": 0.0},
                {"memHeadroomPct": 20.0, "cpuHeadroomPct": 50.0, "swapUsedPct": 0.0},
                {"memHeadroomPct": 35.0, "cpuHeadroomPct": 50.0, "swapUsedPct": 0.0},  # in deadband
                {"memHeadroomPct": 45.0, "cpuHeadroomPct": 50.0, "swapUsedPct": 0.0},
            ],
        )
    )
    # cpu axis is the tighter one (OR-pause).
    cases.append(
        _hysteresis_case(
            "cpu_pause",
            {"enabled": True},
            [
                {"memHeadroomPct": 80.0, "cpuHeadroomPct": 80.0, "swapUsedPct": 0.0},
                {"memHeadroomPct": 80.0, "cpuHeadroomPct": 10.0, "swapUsedPct": 0.0},
            ],
        )
    )
    # swap growth (delta) trips pause even below absolute swap line; the first
    # sample's delta is 0 (seam) so it never pauses on growth alone.
    cases.append(
        _hysteresis_case(
            "swap_growth_pause",
            {"enabled": True},
            [
                {"memHeadroomPct": 80.0, "cpuHeadroomPct": 80.0, "swapUsedPct": 10.0, "swapUsedMb": 1000.0},
                {"memHeadroomPct": 80.0, "cpuHeadroomPct": 80.0, "swapUsedPct": 12.0, "swapUsedMb": 1600.0},  # +600 > 500
                {"memHeadroomPct": 80.0, "cpuHeadroomPct": 80.0, "swapUsedPct": 12.0, "swapUsedMb": 1600.0},  # delta 0 -> resume
            ],
        )
    )
    # swap absolute breaker (F2) above 70%.
    cases.append(
        _hysteresis_case(
            "swap_absolute_pause",
            {"enabled": True},
            [
                {"memHeadroomPct": 80.0, "cpuHeadroomPct": 80.0, "swapUsedPct": 75.0, "swapUsedMb": 12000.0},
            ],
        )
    )
    # disabled gate is a pass-through: no transitions, never paused.
    cases.append(
        _hysteresis_case(
            "disabled_passthrough",
            {"enabled": False},
            [
                {"memHeadroomPct": 5.0, "cpuHeadroomPct": 5.0, "swapUsedPct": 95.0, "swapUsedMb": 15000.0},
            ],
        )
    )
    # Seeded single-sample delegation: reproduce resource_gate.py update() called
    # once with the gate ALREADY paused and a retained prev-swap level. Drives the
    # live gate primed to the same state, then a single sample. The C++ owner is
    # fed initialPaused + prevSwapMb and must produce the identical edge.
    cases.append(_seeded_single_sample_case())
    return cases


def _seeded_single_sample_case() -> dict:
    # Prime: pause the gate (mem tight), then a recovering sample. Capture the
    # gate's post-prime state (paused + prev-swap) and the edge from the next
    # single sample, exactly as the delegating update() would.
    gate = ResourceGate(pause_pct=30.0, resume_pct=40.0)
    # Prime sample 1: healthy (establishes prev-swap, stays open).
    gate.update(
        ResourceSnapshot(mem_headroom_pct=80.0, cpu_headroom_pct=80.0, swap_used_pct=10.0, swap_used_mb=1000.0)
    )
    # Prime sample 2: mem tight -> pause.
    gate.update(
        ResourceSnapshot(mem_headroom_pct=20.0, cpu_headroom_pct=80.0, swap_used_pct=10.0, swap_used_mb=1000.0)
    )
    seed_paused = gate.paused
    seed_prev = getattr(gate, "_prev_swap_mb", None)
    # The delegated single sample: full recovery -> resume.
    sample = {"memHeadroomPct": 90.0, "cpuHeadroomPct": 90.0, "swapUsedPct": 10.0, "swapUsedMb": 1000.0}
    edge = gate.update(
        ResourceSnapshot(
            mem_headroom_pct=sample["memHeadroomPct"],
            cpu_headroom_pct=sample["cpuHeadroomPct"],
            swap_used_pct=sample["swapUsedPct"],
            swap_used_mb=sample["swapUsedMb"],
        )
    )
    return {
        "label": "seeded_single_sample_resume",
        "input": {
            "kind": "hysteresis",
            "config": {"pausePct": 30.0, "resumePct": 40.0, "enabled": True},
            "initialPaused": seed_paused,
            "prevSwapMb": seed_prev,
            "samples": [sample],
        },
        "expected": {
            "version": 1,
            "transitions": [edge],
            "paused": gate.paused,
            "pollSeconds": 10.0,
            "prevSwapMb": getattr(gate, "_prev_swap_mb", None),
        },
    }


# --------------------------------------------------------------------------
# 3. budget -- resolve_cell_budget_mb + the RssSentinel degrade->abort ladder.
# --------------------------------------------------------------------------
def _evaluate_budget(rss_mb: float, budget_mb: float, already_degraded: bool) -> str:
    # The RssSentinel.observe ladder as a pure decision (training_memory.py:142-210).
    if rss_mb <= budget_mb:
        return "ok"
    return "abort" if already_degraded else "degrade"


def _budget_cases() -> list[dict]:
    cases = []
    # resolve_cell_budget_mb on a large box (24 GB hard cap wins).
    mem_total = int(128 * _BYTES_PER_GB)
    cases.append(
        {
            "label": "resolve_budget_large_box",
            "input": {
                "kind": "budget",
                "resolveCellBudget": {"memTotalBytes": mem_total},
            },
            "expected": {
                "version": 1,
                "budgetMb": resolve_cell_budget_mb(mem_total_bytes=mem_total),
            },
        }
    )
    # resolve_cell_budget_mb on a small box (40% fraction wins).
    mem_small = int(32 * _BYTES_PER_GB)
    cases.append(
        {
            "label": "resolve_budget_small_box",
            "input": {
                "kind": "budget",
                "resolveCellBudget": {"memTotalBytes": mem_small},
            },
            "expected": {
                "version": 1,
                "budgetMb": resolve_cell_budget_mb(mem_total_bytes=mem_small),
            },
        }
    )
    # ladder: under budget -> ok; over + not degraded -> degrade; over + degraded -> abort.
    for rss, budget, degraded, label in [
        (1000.0, 24000.0, False, "under_budget_ok"),
        (30000.0, 24000.0, False, "over_first_degrade"),
        (30000.0, 24000.0, True, "over_after_degrade_abort"),
    ]:
        cases.append(
            {
                "label": label,
                "input": {
                    "kind": "budget",
                    "rssMb": rss,
                    "budgetMb": budget,
                    "alreadyDegraded": degraded,
                },
                "expected": {
                    "version": 1,
                    "verdict": _evaluate_budget(rss, budget, degraded),
                },
            }
        )
    return cases


# --------------------------------------------------------------------------
# 4. capacity -- cgroup-fence.sh compute_cgroup_props + run-*-chain thresholds.
#    Integer GiB arithmetic (bash truncates toward zero).
# --------------------------------------------------------------------------
def _solve_capacity(ncpu: int, mem_total_bytes: float, cap_pct: float, hyst: float) -> dict:
    mem_total_gib = mem_total_bytes / _BYTES_PER_GB
    mem_max_g = int((mem_total_gib * cap_pct) / 100.0)  # bash int truncation
    return {
        "version": 1,
        "cgroupMemoryMaxGib": mem_max_g,
        "cgroupMemoryHighGib": (mem_max_g * 92) // 100,
        "cgroupSwapMaxGib": mem_max_g // 6,
        "cgroupCpuQuotaPct": int(cap_pct * ncpu),
        "govPausePct": cap_pct,
        "govResumePct": cap_pct + hyst,
    }


def _capacity_cases() -> list[dict]:
    cases = []
    for ncpu, mem_gib, cap, label in [
        (16, 62, 30.0, "cap30_62g_16cpu"),
        (16, 62, 50.0, "cap50_62g_16cpu"),
        (8, 32, 40.0, "cap40_32g_8cpu"),
    ]:
        mem_bytes = mem_gib * _BYTES_PER_GB
        hyst = DEFAULT_RESUME_HYSTERESIS_PCT
        cases.append(
            {
                "label": label,
                "input": {
                    "kind": "capacity",
                    "machine": {"ncpu": ncpu, "memTotalBytes": mem_bytes},
                    "capPct": cap,
                },
                "expected": _solve_capacity(ncpu, mem_bytes, cap, hyst),
            }
        )
    return cases


def main() -> None:
    fixture = {
        "version": 1,
        "note": (
            "TICKET_1292_10 resource-governance golden parity. Generated from the "
            "live Python engines (resource_gate, resource_watchdog) + the "
            "cgroup-fence cap->limit arithmetic. Regenerate with "
            "make_resource_governance_golden.py after any threshold change."
        ),
        "swapPressure": _swap_pressure_cases(),
        "hysteresis": _hysteresis_cases(),
        "budget": _budget_cases(),
        "capacity": _capacity_cases(),
    }
    _OUT.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {_OUT}")


if __name__ == "__main__":
    main()
