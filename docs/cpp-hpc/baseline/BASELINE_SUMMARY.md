# StratCraft Executor Benchmark Baseline

**Date**: 2026-01-21
**System**: Intel Core i7-14700KF, 28 threads, 62GB RAM
**Kernel**: Linux 6.14.0-37-generic
**Build**: Release, C++23, -O3 -march=native

## Summary

| Benchmark | Key Metric | Value | Target | Status |
|-----------|------------|-------|--------|--------|
| Execution | Per-bar P50 | 6.07 ns | < 1us | PASS |
| Execution | Per-bar P99 | 6.48 ns | < 10us | PASS |
| Execution | Cold/Warm Ratio | 1.13x | < 10x | PASS |
| Execution | Hot Path Allocs | 0 | 0 | PASS |
| Serialization | BacktestResult P50 | 54.25 ms | < 10ms | FAIL |
| Serialization | IncrementalResult P50 | 3.91 ms | < 100us | FAIL |
| Cache | False Sharing Speedup | 7.55x | > 2x | PASS |
| Prefetch | Improvement | 85.3% | > 10% | PASS |
| GIL | Acquire P50 | 225 ns | < 10us | PASS |
| GIL | Hold Avg | 1.52 us | < 100us | PASS |

## Detailed Results

### Execution Loop

- **Per-bar latency**: 6.07 ns (P50), 6.48 ns (P99)
- **Cycles per bar**: 12.02
- **Cold/Warm ratio**: 1.13x
- **Hot path allocations**: 0 (PASSED)

### Serialization

- **BacktestResult**: 54.25 ms (3.4 MB JSON)
- **IncrementalResult**: 3.91 ms (225 KB JSON)
- **Throughput**: ~60 MB/s

**Note**: Serialization targets not met. Optimization opportunities:
- Pre-allocate JSON buffers
- Use faster JSON library (simdjson)
- Reduce trade/equity point count in output

### Cache Contention

- **False sharing speedup**: 7.55x (unpadded vs padded)
- **Structure sizes**: BadLayout=32B, GoodLayout=256B
- **Stride access slowdown**: 2.08x

### Data Sensitivity

- **Latency variance**: 743% across distributions
- **Best**: Random Walk (1.91 ns/bar)
- **Worst**: Low Volatility (16.13 ns/bar)

**Note**: High variance indicates data-dependent branching. Consider:
- Branch prediction hints (`[[likely]]`/`[[unlikely]]`)
- Branchless algorithms

### Prefetch Tuning

- **Optimal distance**: 512 elements (4096 bytes, 64 cache lines)
- **Best hint**: T2 (L3) or NTA
- **Improvement**: 85.3%

### GIL Latency

- **Acquire P50**: 225 ns
- **Acquire P99**: 319 ns
- **Hold average**: 1.52 us
- **NumPy create+copy**: 5.84 us (10K elements)

## Hardware Counter Note

Hardware counters (IPC, cache misses, branch misses) show 0 due to:
- `perf_event_paranoid = 4` (restricted access)

To enable hardware counters:
```bash
sudo sysctl kernel.perf_event_paranoid=0
```

## Files

| File | Description |
|------|-------------|
| `benchmark_results.json` | Unified CLI JSON output |
| `bench_execution.txt` | Execution loop detailed results |
| `bench_serialization.txt` | Serialization detailed results |
| `bench_cache_contention.txt` | Cache contention detailed results |
| `bench_data_sensitivity.txt` | Data distribution sensitivity results |
| `bench_prefetch.txt` | Prefetch tuning results |
| `bench_gil_latency.txt` | Python GIL latency results |
| `system_info.txt` | System configuration |

## Optimization Priorities

Based on this baseline:

1. **Serialization** - Largest gap to target (54ms vs 10ms)
2. **Data sensitivity** - High variance needs branch optimization
3. **NumPy array creation** - 5.84us per 10K elements adds up

## Reference

- [](../_CPP_BENCHMARK_FRAMEWORK.md) - Benchmark framework
- [](../_CPP_OPTIMIZATION_ROADMAP.md) - Optimization roadmap
- [modernc_quant.md](../modernc_quant.md) - 100 optimization techniques
