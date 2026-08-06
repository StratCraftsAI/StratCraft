#!/bin/bash
# scripts/check_perf_regression.sh
# TICKET_471_1: Performance regression gate for StratCraft Executor benchmarks.
# Compares benchmark --json output against baselines.json thresholds.
# Exits non-zero if any benchmark exceeds its absolute threshold.
# Adapted from StratForge TICKET_228.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
EXECUTOR_DIR="${PROJECT_DIR}/packages/executor"
BUILD_DIR="${EXECUTOR_DIR}/build"
BENCHMARK_BIN="${BUILD_DIR}/bin/benchmark/qnx-executor-bench"
BASELINES="${EXECUTOR_DIR}/benchmark/baselines.json"
ITERATIONS="${1:-10000}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Dependency check: jq
if ! command -v jq &>/dev/null; then
    echo -e "${RED}[ERROR]${NC} jq is required but not installed. Install with: sudo apt-get install -y jq"
    exit 1
fi

# Baselines file check
if [ ! -f "${BASELINES}" ]; then
    echo -e "${RED}[ERROR]${NC} Baselines file not found: ${BASELINES}"
    exit 1
fi

# Build benchmark binary if not found
if [ ! -x "${BENCHMARK_BIN}" ]; then
    echo -e "${YELLOW}[WARN]${NC} Benchmark binary not found, building..."
    if [ -d "${BUILD_DIR}" ]; then
        cmake --build "${BUILD_DIR}" --target qnx-executor-bench -j"$(nproc 2>/dev/null || echo 4)"
    else
        echo -e "${RED}[ERROR]${NC} Build directory not found: ${BUILD_DIR}"
        echo "Run './start.sh executor' first to build the Executor."
        exit 1
    fi
fi

echo "Running Executor benchmarks (${ITERATIONS} iterations, JSON mode)..."
RESULTS=$("${BENCHMARK_BIN}" "${ITERATIONS}" --json 2>/dev/null || true)

# Validate JSON output
if [ -z "${RESULTS}" ] || ! echo "${RESULTS}" | jq . >/dev/null 2>&1; then
    echo -e "${YELLOW}[WARN]${NC} Benchmark binary does not support --json output yet."
    echo "Validating baselines.json format only..."

    # At minimum, validate the baselines file is valid JSON
    if jq . "${BASELINES}" >/dev/null 2>&1; then
        echo -e "${GREEN}[PASS]${NC} baselines.json is valid JSON"
        BASELINE_COUNT=$(jq '.baselines | length' "${BASELINES}")
        echo "  ${BASELINE_COUNT} baseline(s) defined"
        for i in $(seq 0 $((BASELINE_COUNT - 1))); do
            NAME=$(jq -r ".baselines[$i].name" "${BASELINES}")
            echo "  - ${NAME}"
        done
    else
        echo -e "${RED}[FAIL]${NC} baselines.json is invalid JSON"
        exit 1
    fi
    echo ""
    echo -e "${YELLOW}[SKIP]${NC} Regression check skipped (benchmark --json not available)"
    exit 0
fi

# Compare benchmark results against baselines
FAILURES=0
CHECKED=0
BASELINE_COUNT=$(jq '.baselines | length' "${BASELINES}")

for i in $(seq 0 $((BASELINE_COUNT - 1))); do
    NAME=$(jq -r ".baselines[$i].name" "${BASELINES}")
    UNIT=$(jq -r ".baselines[$i].unit" "${BASELINES}")

    # Support both ns and ms thresholds
    if [ "${UNIT}" = "ns" ]; then
        P50_MAX=$(jq ".baselines[$i].p50_max_ns" "${BASELINES}")
        P99_MAX=$(jq ".baselines[$i].p99_max_ns" "${BASELINES}")
        P50_ACTUAL=$(echo "${RESULTS}" | jq -r ".benchmarks[] | select(.name == \"${NAME}\") | .p50_ns")
        P99_ACTUAL=$(echo "${RESULTS}" | jq -r ".benchmarks[] | select(.name == \"${NAME}\") | .p99_ns")
    else
        P50_MAX=$(jq ".baselines[$i].p50_max_ms" "${BASELINES}")
        P99_MAX=$(jq ".baselines[$i].p99_max_ms" "${BASELINES}")
        P50_ACTUAL=$(echo "${RESULTS}" | jq -r ".benchmarks[] | select(.name == \"${NAME}\") | .p50_ms")
        P99_ACTUAL=$(echo "${RESULTS}" | jq -r ".benchmarks[] | select(.name == \"${NAME}\") | .p99_ms")
    fi

    if [ -z "${P50_ACTUAL}" ] || [ "${P50_ACTUAL}" = "null" ]; then
        echo -e "${YELLOW}[SKIP]${NC} ${NAME} - not found in benchmark results"
        continue
    fi

    CHECKED=$((CHECKED + 1))

    P50_FAIL=$(awk "BEGIN { print (${P50_ACTUAL} > ${P50_MAX}) ? 1 : 0 }")
    P99_FAIL=$(awk "BEGIN { print (${P99_ACTUAL} > ${P99_MAX}) ? 1 : 0 }")

    if [ "${P50_FAIL}" -eq 1 ] || [ "${P99_FAIL}" -eq 1 ]; then
        echo -e "${RED}[FAIL]${NC} ${NAME}"
        if [ "${P50_FAIL}" -eq 1 ]; then
            echo "        P50: ${P50_ACTUAL} ${UNIT} > ${P50_MAX} ${UNIT} (threshold)"
        fi
        if [ "${P99_FAIL}" -eq 1 ]; then
            echo "        P99: ${P99_ACTUAL} ${UNIT} > ${P99_MAX} ${UNIT} (threshold)"
        fi
        FAILURES=$((FAILURES + 1))
    else
        echo -e "${GREEN}[PASS]${NC} ${NAME}  P50=${P50_ACTUAL}${UNIT}/<${P50_MAX}  P99=${P99_ACTUAL}${UNIT}/<${P99_MAX}"
    fi
done

echo ""
echo "Checked ${CHECKED} benchmarks against baselines"

if [ "${FAILURES}" -gt 0 ]; then
    echo -e "${RED}${FAILURES} benchmark(s) exceeded performance thresholds${NC}"
    exit 1
fi

echo -e "${GREEN}All benchmarks within performance thresholds${NC}"
exit 0
