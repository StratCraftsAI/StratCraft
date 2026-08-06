# Benchmark Result Interpretation Guide

Reference:  - C++ Executor Benchmark Framework

## Understanding Latency Metrics

### Percentiles Explained

| Percentile | Meaning | Use Case |
|------------|---------|----------|
| P50 (Median) | 50% of samples below this value | Typical performance |
| P90 | 90% of samples below this value | Good performance |
| P99 | 99% of samples below this value | Tail latency |
| P99.9 | 99.9% of samples below this value | Worst case (1 in 1000) |
| Max | Absolute worst case | Outlier detection |

### Interpretation Guidelines

**P50 vs P99 Ratio**:
- Ratio < 2x: Very consistent, good determinism
- Ratio 2x-5x: Normal variation
- Ratio 5x-10x: Some outliers, investigate
- Ratio > 10x: Significant issues (GC, page faults, context switches)

**Cold vs Warm**:
- Ratio < 5x: I-Cache well utilized
- Ratio 5x-10x: Acceptable, warmup helps
- Ratio > 10x: Large code footprint, consider `[[gnu::hot]]`

## Hardware Counter Analysis

### IPC (Instructions Per Cycle)

| IPC Value | Interpretation | Action |
|-----------|----------------|--------|
| > 2.0 | Excellent utilization | None |
| 1.0-2.0 | Good | Monitor |
| 0.5-1.0 | Memory bound or stalls | Profile memory access |
| < 0.5 | Severe bottleneck | Deep investigation |

### Cache Miss Rates

| Cache Level | Good | Warning | Critical |
|-------------|------|---------|----------|
| L1D | < 5% | 5-10% | > 10% |
| L1I | < 1% | 1-5% | > 5% |
| LLC | < 1% | 1-5% | > 5% |

### Branch Misprediction

| Rate | Interpretation | Action |
|------|----------------|--------|
| < 1% | Excellent | None |
| 1-3% | Normal | Consider `[[likely]]` |
| 3-5% | High | Profile branches |
| > 5% | Critical | Restructure code |

### TLB Misses

| Type | Good | Warning | Action |
|------|------|---------|--------|
| iTLB | < 0.1% | > 0.1% | Reduce code size, use huge pages |
| dTLB | < 0.5% | > 0.5% | Improve locality, use huge pages |

## Memory Analysis

### Hot Path Allocations

**Target: 0 allocations**

Any allocation on hot path is a failure. Common causes:

1. `std::vector` growth without pre-allocation
2. `std::string` construction
3. Exception handling (`std::exception`)
4. STL container operations

**Fix**: Use PMR pools, pre-allocate, avoid copies.

### PMR Pool Hit Rate

| Rate | Interpretation |
|------|----------------|
| > 99.9% | Optimal pool sizing |
| 99-99.9% | Acceptable, monitor |
| < 99% | Pool too small, resize |

### Pool Usage Ratio

| Ratio | Interpretation |
|-------|----------------|
| < 50% | Oversized pool, wasting memory |
| 50-80% | Optimal |
| > 80% | Risk of exhaustion, increase size |

## GIL Latency Analysis

### Acquire Latency

| P50 | Interpretation | Action |
|-----|----------------|--------|
| < 1us | No contention | None |
| 1-10us | Low contention | Monitor |
| 10-100us | Moderate contention | Batch calls |
| > 100us | High contention | Redesign |

### Hold Duration

| P50 | Interpretation | Action |
|-----|----------------|--------|
| < 10us | Fast callbacks | None |
| 10-100us | Acceptable | Monitor |
| 100us-1ms | Slow Python code | Optimize Python |
| > 1ms | Critical | Move to C++ |

### Acquire vs Hold Analysis

| High Acquire | High Hold | Diagnosis |
|--------------|-----------|-----------|
| No | No | Healthy |
| Yes | No | GIL contention, reduce threads |
| No | Yes | Slow Python, optimize code |
| Yes | Yes | Systemic problem, redesign |

## Cache Contention Analysis

### False Sharing Detection

Compare padded vs unpadded performance:

| Speedup | Interpretation |
|---------|----------------|
| < 2x | Minimal false sharing |
| 2x-5x | Moderate false sharing |
| > 5x | Severe false sharing (padding critical) |

### Stride Access

Compare sequential vs strided access:

| Slowdown | Interpretation |
|----------|----------------|
| < 2x | Good cache utilization |
| 2x-10x | Normal memory behavior |
| > 10x | Severe cache pollution |

## Data Sensitivity Analysis

### Distribution Impact

Variance across distributions should be < 20%:

| Variance | Interpretation |
|----------|----------------|
| < 10% | Data-independent (good) |
| 10-20% | Minor sensitivity |
| 20-50% | Moderate sensitivity |
| > 50% | High sensitivity (investigate) |

### Signal Density Impact

| Signal Density | Expected Behavior |
|----------------|-------------------|
| Sparse (< 1/1000) | Lower latency (fewer state changes) |
| Dense (> 1/100) | Higher latency (more branches taken) |

## Prefetch Analysis

### Optimal Distance

The "sweet spot" is where latency is minimized:

| Platform | Typical Range |
|----------|---------------|
| Intel Xeon | 16-32 elements |
| AMD EPYC | 8-16 elements |
| Apple M-series | 32-64 elements |

### Prefetch Hint Selection

| Hint | Use Case |
|------|----------|
| T0 (L1) | Data reused immediately |
| T1 (L2) | Data reused soon |
| T2 (L3) | Data reused later |
| NTA | Streaming, no reuse |

## Common Patterns

### "Sawtooth" Latency Pattern

**Symptom**: Periodic latency spikes every N iterations.

**Causes**:
- Garbage collection (Python side)
- Timer interrupts
- Background processes

**Fix**: Isolate CPU, disable interrupts, increase Python callback batch size.

### "Cliff" Latency Pattern

**Symptom**: Sudden permanent increase in latency.

**Causes**:
- Memory threshold crossed
- Pool exhaustion
- Cache capacity exceeded

**Fix**: Profile memory, increase pool sizes, improve locality.

### "Jitter" Pattern

**Symptom**: High variance, no clear pattern.

**Causes**:
- Context switching
- NUMA effects
- Hyperthreading interference

**Fix**: Pin to isolated core, disable HT, check NUMA topology.

## Actionable Thresholds

| Metric | Pass | Warn | Fail |
|--------|------|------|------|
| Per-bar P50 | < 1us | 1-10us | > 10us |
| Per-bar P99 | < 10us | 10-100us | > 100us |
| Cold/warm ratio | < 5x | 5-10x | > 10x |
| Hot path allocs | 0 | - | > 0 |
| Branch miss | < 1% | 1-3% | > 3% |
| IPC | > 1.0 | 0.5-1.0 | < 0.5 |
| GIL acquire P50 | < 10us | 10-100us | > 100us |
| GIL hold P50 | < 100us | 100us-1ms | > 1ms |
