#  Benchmark Comparison

## Test Date: 2026-01-28

## Test Environment
- CPU: AMD/Intel (see system_info.txt)
- SIMD: AVX2 available, AVX-512 not available

---

## SIMD Benchmark

| Metric | Baseline | Optimized | Change |
|--------|----------|-----------|--------|
| Sum Reduction | 3.97x | 3.96x | ~same |
| Std Deviation | 2.26x | 2.26x | ~same |
| Average Speedup | 2.35x | 2.34x | ~same |

**Note**: SIMD performance is consistent - these are library-level optimizations already in place.

---

## Hash Map Benchmark (Swiss Tables)

| Elements | Baseline Lookup | Optimized Lookup | Change |
|----------|-----------------|------------------|--------|
| 10K | 4.63x | 5.11x | +10% |
| 100K | 4.35x | 4.41x | +1% |
| 1M | 1.99x | 2.01x | +1% |

**Note**: Minor variance due to CPU cache state.

---

## Prefetch Benchmark

| Metric | Baseline | Optimized |
|--------|----------|-----------|
| Optimal Distance | 64 elements | 16 elements |
| Improvement | 85.0% | 85.1% |

**Note**: Optimal prefetch distance varies by run; improvement consistent.

---

## Execution Loop Benchmark

| Metric | Baseline | Optimized | Change |
|--------|----------|-----------|--------|
| P50 Latency | 2.67 ns | 2.66 ns | ~same |
| P99 Latency | 3.07 ns | 2.87 ns | **-7%** |
| Cold/Warm Ratio | 1.09x | 1.14x | ~same |
| Hot Path Allocs | 0 | 0 | PASS |

---

## Executor Runtime Integration

| Optimization | Baseline | Optimized |
|--------------|----------|-----------|
| CPU Affinity | Not used | **Integrated** |
| Branch Hints | [[likely]] | **QNX_LIKELY** |
| Prefetch | Basic | **Enhanced** |

---

## Summary

The  optimizations have been successfully integrated:

1. **CPU Affinity**: Now pins executor to dedicated core at startup
2. **Branch Hints**: Unified macros (QNX_LIKELY/UNLIKELY) for better portability
3. **Prefetch**: Enhanced data cache warmup with explicit prefetch calls

**Performance Impact**:
- Benchmark tools show consistent performance
- Runtime integration provides infrastructure for future optimizations
- P99 latency improved by ~7% in execution loop

---

## Files

```
results/
+-- baseline/           # Before  integration
|   +-- bench_simd.txt
|   +-- bench_hash_map.txt
|   +-- bench_prefetch.txt
|   +-- bench_execution.txt
+-- 20260128_optimized/ # After  integration
|   +-- bench_simd.txt
|   +-- bench_hash_map.txt
|   +-- bench_prefetch.txt
|   +-- bench_execution.txt
|   +-- bench_memory_pool.txt
|   +-- system_info.txt
|   +-- summary.txt
+-- COMPARISON.md       # This file
```
