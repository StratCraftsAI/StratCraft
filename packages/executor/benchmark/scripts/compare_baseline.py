#!/usr/bin/env python3
"""
Compare benchmark results against baseline

Reference: TICKET_174 - C++ Executor Benchmark Framework

Compares current benchmark results with a baseline and reports regressions.
"""

import argparse
import json
import sys
import re
from pathlib import Path
from typing import Dict, Optional, Tuple


# Regression thresholds (percentage)
THRESHOLDS = {
    "per_bar_latency_p50": 10,      # 10% regression allowed
    "per_bar_latency_p99": 20,      # 20% regression allowed
    "cold_warm_ratio": 20,          # 20% regression allowed
    "data_load_p50": 15,            # 15% regression allowed
    "serialization_p50": 15,        # 15% regression allowed
    "gil_acquire_p50": 25,          # 25% regression allowed (more variable)
}

# Critical metrics (must not regress beyond threshold)
CRITICAL_METRICS = [
    "per_bar_latency_p99",
    "cold_warm_ratio",
]


def parse_benchmark_output(filepath: Path) -> Dict[str, float]:
    """Parse benchmark output file and extract metrics."""
    metrics = {}

    if not filepath.exists():
        return metrics

    content = filepath.read_text()

    # Extract per-bar latency
    match = re.search(r"P50:\s+([\d.]+)\s+ns", content)
    if match:
        metrics["per_bar_latency_p50"] = float(match.group(1))

    match = re.search(r"P99:\s+([\d.]+)\s+ns", content)
    if match:
        metrics["per_bar_latency_p99"] = float(match.group(1))

    # Extract cold/warm ratio
    match = re.search(r"Ratio:\s+([\d.]+)x", content)
    if match:
        metrics["cold_warm_ratio"] = float(match.group(1))

    # Extract data load latency
    match = re.search(r"Warm\s+P50\s+latency:\s+([\d.]+)\s+ms", content)
    if match:
        metrics["data_load_p50"] = float(match.group(1))

    # Extract serialization latency
    match = re.search(r"BacktestResult P50:\s+([\d.]+)\s+ms", content)
    if match:
        metrics["serialization_p50"] = float(match.group(1))

    # Extract GIL latency
    match = re.search(r"GIL acquire P50:\s+([\d.]+)\s+us", content)
    if match:
        metrics["gil_acquire_p50"] = float(match.group(1))

    return metrics


def load_baseline(filepath: Path) -> Dict[str, float]:
    """Load baseline metrics from JSON file."""
    if not filepath.exists():
        return {}

    with open(filepath) as f:
        return json.load(f)


def save_baseline(metrics: Dict[str, float], filepath: Path) -> None:
    """Save metrics as new baseline."""
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w") as f:
        json.dump(metrics, f, indent=2)


def compare_metrics(
    current: Dict[str, float],
    baseline: Dict[str, float]
) -> Tuple[Dict[str, Tuple[float, float, float]], bool]:
    """
    Compare current metrics against baseline.

    Returns:
        (comparisons, passed)
        comparisons: dict of {metric: (current, baseline, change_pct)}
        passed: True if no critical regressions
    """
    comparisons = {}
    passed = True

    for metric, current_value in current.items():
        if metric not in baseline:
            comparisons[metric] = (current_value, None, None)
            continue

        baseline_value = baseline[metric]
        if baseline_value == 0:
            change_pct = 0.0
        else:
            change_pct = ((current_value - baseline_value) / baseline_value) * 100

        comparisons[metric] = (current_value, baseline_value, change_pct)

        # Check for regression
        threshold = THRESHOLDS.get(metric, 10)
        if change_pct > threshold:
            if metric in CRITICAL_METRICS:
                passed = False

    return comparisons, passed


def print_report(
    comparisons: Dict[str, Tuple[float, float, Optional[float]]],
    passed: bool
) -> None:
    """Print comparison report."""
    print("\n" + "=" * 60)
    print("BENCHMARK COMPARISON REPORT")
    print("=" * 60 + "\n")

    print(f"{'Metric':<25} {'Current':>12} {'Baseline':>12} {'Change':>10}")
    print("-" * 60)

    for metric, (current, baseline, change) in sorted(comparisons.items()):
        if baseline is None:
            status = "NEW"
            change_str = "-"
        elif change is None:
            status = "-"
            change_str = "-"
        else:
            threshold = THRESHOLDS.get(metric, 10)
            if change > threshold:
                if metric in CRITICAL_METRICS:
                    status = "FAIL"
                else:
                    status = "WARN"
            elif change < -5:
                status = "GOOD"
            else:
                status = "OK"
            change_str = f"{change:+.1f}%"

        baseline_str = f"{baseline:.2f}" if baseline is not None else "-"
        print(f"{metric:<25} {current:>12.2f} {baseline_str:>12} {change_str:>8} {status}")

    print("-" * 60)
    print(f"\nOverall: {'PASSED' if passed else 'FAILED'}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Compare benchmark results against baseline"
    )
    parser.add_argument(
        "--results-dir",
        type=str,
        required=True,
        help="Directory containing benchmark results"
    )
    parser.add_argument(
        "--baseline",
        type=str,
        default=None,
        help="Path to baseline JSON file"
    )
    parser.add_argument(
        "--save-baseline",
        action="store_true",
        help="Save current results as new baseline"
    )
    parser.add_argument(
        "--ci",
        action="store_true",
        help="CI mode: exit with non-zero on failure"
    )

    args = parser.parse_args()

    results_dir = Path(args.results_dir)
    if not results_dir.exists():
        print(f"Error: Results directory not found: {results_dir}")
        sys.exit(1)

    # Determine baseline path
    if args.baseline:
        baseline_path = Path(args.baseline)
    else:
        baseline_path = results_dir.parent / "baseline.json"

    # Parse all benchmark outputs
    current_metrics = {}

    benchmark_files = [
        ("bench_execution.txt", ["per_bar_latency_p50", "per_bar_latency_p99", "cold_warm_ratio"]),
        ("bench_data_loading.txt", ["data_load_p50"]),
        ("bench_serialization.txt", ["serialization_p50"]),
        ("bench_gil_latency.txt", ["gil_acquire_p50"]),
    ]

    for filename, expected_metrics in benchmark_files:
        filepath = results_dir / filename
        metrics = parse_benchmark_output(filepath)
        current_metrics.update(metrics)

    if not current_metrics:
        print("Warning: No metrics extracted from benchmark results")
        sys.exit(0)

    # Save as baseline if requested
    if args.save_baseline:
        save_baseline(current_metrics, baseline_path)
        print(f"Baseline saved to: {baseline_path}")
        sys.exit(0)

    # Load baseline and compare
    baseline_metrics = load_baseline(baseline_path)

    if not baseline_metrics:
        print(f"Warning: No baseline found at {baseline_path}")
        print("Run with --save-baseline to create one")

        # Just print current metrics
        print("\nCurrent Metrics:")
        for metric, value in sorted(current_metrics.items()):
            print(f"  {metric}: {value:.2f}")
        sys.exit(0)

    # Compare
    comparisons, passed = compare_metrics(current_metrics, baseline_metrics)
    print_report(comparisons, passed)

    # CI mode
    if args.ci and not passed:
        sys.exit(1)


if __name__ == "__main__":
    main()
