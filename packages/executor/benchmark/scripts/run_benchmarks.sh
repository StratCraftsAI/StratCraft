#!/bin/bash
#
# Run all StratCraft executor benchmarks
#
# Reference: TICKET_174 - C++ Executor Benchmark Framework
#
# Usage: ./run_benchmarks.sh [options]
#
# Options:
#   --data-file PATH    Parquet file for data loading benchmark
#   --cpu N             Bind to CPU core N
#   --vm-safe           Use VM-safe RDTSC
#   --output DIR        Output directory for results
#   --quick             Quick mode (fewer iterations)
#   --help              Show this help

set -e

# Default configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/../../../build"
BENCH_BIN="${BUILD_DIR}/benchmark"
OUTPUT_DIR="${SCRIPT_DIR}/../results/$(date +%Y%m%d_%H%M%S)"
DATA_FILE=""
CPU_CORE=""
VM_SAFE=""
QUICK_MODE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --data-file)
            DATA_FILE="$2"
            shift 2
            ;;
        --cpu)
            CPU_CORE="--cpu $2"
            shift 2
            ;;
        --vm-safe)
            VM_SAFE="--vm-safe"
            shift
            ;;
        --output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --quick)
            QUICK_MODE="1"
            shift
            ;;
        --help)
            head -20 "$0" | tail -15
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "========================================"
echo "StratCraft Executor Benchmark Suite"
echo "========================================"
echo ""
echo "Output directory: $OUTPUT_DIR"
echo "VM-safe mode:     ${VM_SAFE:-disabled}"
echo "CPU affinity:     ${CPU_CORE:-not set}"
echo ""

# Collect system info
echo "Collecting system information..."
{
    echo "=== System Information ==="
    echo "Date: $(date)"
    echo "Hostname: $(hostname)"
    echo "Kernel: $(uname -r)"
    echo ""
    echo "=== CPU Information ==="
    lscpu | grep -E "Model name|CPU MHz|CPU\(s\)|Thread|Core|Cache"
    echo ""
    echo "=== Memory Information ==="
    free -h
    echo ""
    echo "=== Virtualization ==="
    if grep -q "hypervisor" /proc/cpuinfo 2>/dev/null; then
        echo "Running in virtualized environment"
    else
        echo "Running on bare metal"
    fi
} > "$OUTPUT_DIR/system_info.txt"

# Quick mode iterations
if [[ -n "$QUICK_MODE" ]]; then
    EXEC_ARGS="--warmup 100 --measure 1000"
    SERIAL_ARGS="--warmup 10 --measure 100"
    CACHE_ARGS="--iterations 1000000"
    PREFETCH_ARGS="--iterations 10"
else
    EXEC_ARGS=""
    SERIAL_ARGS=""
    CACHE_ARGS=""
    PREFETCH_ARGS=""
fi

# Function to run a benchmark
run_bench() {
    local name=$1
    local binary=$2
    shift 2
    local args=("$@")

    echo "----------------------------------------"
    echo "Running: $name"
    echo "----------------------------------------"

    if [[ -x "$BENCH_BIN/$binary" ]]; then
        "$BENCH_BIN/$binary" ${args[*]} $VM_SAFE $CPU_CORE 2>&1 | tee "$OUTPUT_DIR/${binary}.txt"
        echo ""
    else
        echo "  [SKIP] Binary not found: $BENCH_BIN/$binary"
        echo ""
    fi
}

# Run benchmarks

# 1. Execution benchmark (no external dependencies)
run_bench "Execution Loop" "bench_execution" $EXEC_ARGS

# 2. Serialization benchmark
run_bench "Serialization" "bench_serialization" $SERIAL_ARGS

# 3. Cache contention benchmark
run_bench "Cache Contention" "bench_cache_contention" $CACHE_ARGS

# 4. Data sensitivity benchmark
run_bench "Data Sensitivity" "bench_data_sensitivity" $EXEC_ARGS

# 5. Prefetch benchmark
run_bench "Prefetch Tuning" "bench_prefetch" $PREFETCH_ARGS

# 6. GIL latency benchmark
run_bench "GIL Latency" "bench_gil_latency"

# 7. Data loading benchmark (requires Parquet file)
if [[ -n "$DATA_FILE" && -f "$DATA_FILE" ]]; then
    run_bench "Data Loading" "bench_data_loading" "$DATA_FILE"
else
    echo "----------------------------------------"
    echo "Running: Data Loading"
    echo "----------------------------------------"
    echo "  [SKIP] No data file specified (use --data-file)"
    echo ""
fi

# Generate summary
echo "========================================"
echo "Benchmark Summary"
echo "========================================"
{
    echo "=== Benchmark Summary ==="
    echo "Date: $(date)"
    echo ""

    for f in "$OUTPUT_DIR"/bench_*.txt; do
        if [[ -f "$f" ]]; then
            echo "--- $(basename "$f" .txt) ---"
            grep -E "PASS|FAIL|Target Comparison" "$f" || true
            echo ""
        fi
    done
} | tee "$OUTPUT_DIR/summary.txt"

echo ""
echo "Results saved to: $OUTPUT_DIR"
echo ""
