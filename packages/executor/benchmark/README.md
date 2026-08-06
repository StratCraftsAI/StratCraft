# StratCraft Executor Benchmark Framework

Reference:  - C++ Executor Benchmark Framework

## Quick Start

```bash
# Build benchmarks
cd packages/executor
cmake -B build -DEXECUTOR_BUILD_BENCHMARKS=ON
cmake --build build

# Run all benchmarks
./build/benchmark/qnx-executor-bench --all

# Run specific benchmark
./build/benchmark/qnx-executor-bench --bench=execution,serialization

# Output JSON for CI
./build/benchmark/qnx-executor-bench --all --format=json --output=results.json
```

## Available Benchmarks

| Benchmark | Description | Key Metrics |
|-----------|-------------|-------------|
| `execution` | Per-bar execution latency | P50/P99 latency, IPC |
| `serialization` | JSON serialization throughput | MB/s, P50 latency |
| `memory` | Allocation tracking | Peak bytes, hot path violations |
| `cache` | Cache behavior analysis | L1/LLC misses |
| `perf_counters` | Hardware counter verification | IPC, branch miss rate |

## Individual Benchmark Binaries

For detailed analysis, run individual benchmarks:

```bash
# Data loading (requires Parquet file)
./build/benchmark/bench_data_loading data/test_1000k.parquet

# Execution loop
./build/benchmark/bench_execution --bars 100000

# Serialization
./build/benchmark/bench_serialization --trades 1000

# Cache contention (false sharing test)
./build/benchmark/bench_cache_contention --threads 4

# Data sensitivity (distribution impact)
./build/benchmark/bench_data_sensitivity

# GIL latency (Python interop)
./build/benchmark/bench_gil_latency

# Prefetch tuning
./build/benchmark/bench_prefetch --size 64
```

## Command Line Options

```
--all                 Run all benchmarks
--bench=NAME[,NAME]   Run specific benchmarks
--list                List available benchmarks
--format=FORMAT       Output format: text, json, csv (default: text)
--output=FILE         Write results to file
--iterations=N        Measurement iterations (default: 1000)
--warmup=N            Warmup iterations (default: 100)
--cpu=N               Bind to CPU core N
--realtime            Enable real-time scheduling (requires root)
--vm-safe             Use VM-safe RDTSC (for cloud environments)
--strict              Fail on any hot path allocation
--quiet               Minimal output
```

## Test Data Generation

```bash
# Generate single file
python3 scripts/generate_test_data.py --bars 1000000

# Generate multiple sizes
python3 scripts/generate_test_data.py --sizes
# Creates: test_10k.parquet, test_100k.parquet, test_1000k.parquet, test_10000k.parquet
```

## CI Integration

The benchmark suite is integrated into GitHub Actions:

- **Functional benchmarks**: Run on every PR affecting `packages/executor/`
- **Real-time benchmarks**: Run on main branch with elevated permissions
- **Baseline comparison**: Detect regressions against stored baseline

### Updating Baseline

```bash
# Save current results as new baseline
python3 scripts/compare_baseline.py --results-dir build --save-baseline
```

## Performance Targets

| Metric | Target | Action if exceeded |
|--------|--------|-------------------|
| Per-bar latency P50 | < 1us | Optimize hot path |
| Per-bar latency P99 | < 10us | Investigate outliers |
| Hot path allocations | 0 | Use PMR pools |
| Cold/warm ratio | < 10x | Improve warmup |
| Branch miss rate | < 1% | Add [[likely]]/[[unlikely]] |
| GIL acquire P50 | < 10us | Batch Python calls |

## Directory Structure

```
benchmark/
+-- include/
|   +-- benchmark_utils.hpp    # RDTSC, CPU affinity, statistics
|   +-- memory_tracker.hpp     # Allocation tracking, hot path audit
|   +-- perf_counters.hpp      # Linux perf_event wrapper
+-- src/
|   +-- bench_runner.cpp       # Unified CLI
|   +-- bench_data_loading.cpp # Parquet loading
|   +-- bench_execution.cpp    # Per-bar latency
|   +-- bench_serialization.cpp
|   +-- bench_cache_contention.cpp
|   +-- bench_data_sensitivity.cpp
|   +-- bench_gil_latency.cpp
|   +-- bench_prefetch.cpp
+-- scripts/
|   +-- run_benchmarks.sh      # Run all benchmarks
|   +-- audit_assembly.sh      # Assembly verification
|   +-- generate_test_data.py  # Parquet data generator
|   +-- compare_baseline.py    # Regression detection
+-- data/                      # Test data files
+-- CMakeLists.txt
```

## Troubleshooting

### VM Exit Penalty

If running on virtualized environments (AWS, GCP, Azure), always use `--vm-safe`:

```bash
./qnx-executor-bench --all --vm-safe
```

The `cpuid` instruction used for precise timing triggers VM Exit, adding thousands of cycles.

### Real-time Scheduling

Real-time scheduling requires root or `CAP_SYS_NICE`:

```bash
# With sudo
sudo ./qnx-executor-bench --all --realtime --cpu=3

# With capabilities
sudo setcap cap_sys_nice=ep ./qnx-executor-bench
./qnx-executor-bench --all --realtime --cpu=3
```

### Missing perf_event

If hardware counters show 0:

```bash
# Check perf_event access
cat /proc/sys/kernel/perf_event_paranoid

# Allow non-root access (temporarily)
sudo sysctl kernel.perf_event_paranoid=0
```

## References

- [modernc_quant.md](../../docs/cpp-hpc/modernc_quant.md) - 100 Modern C++ techniques
- [](../../docs/cpp-hpc/_CPP_BENCHMARK_FRAMEWORK.md) - Full specification
- [](../../docs/cpp-hpc/_CPP_OPTIMIZATION_ROADMAP.md) - Optimization plan
