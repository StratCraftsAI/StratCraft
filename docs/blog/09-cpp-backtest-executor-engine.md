---
title: "C++ Backtest Executor: High-Performance Strategy Execution with pybind11"
slug: "cpp-backtest-executor-engine"
category: "Technical"
tags: ["c++ backtest engine", "high performance backtesting", "pybind11 executor", "zero-copy numpy"]
excerpt: "StratCraft C++ Executor runs Python strategies at 500-1000x speed using pybind11 embedded Python and zero-copy NumPy data access."
estimated_reading_time: "6 min"
---

## Introduction

The StratCraft C++ Backtest Executor is a high-performance backtest engine that runs Python trading strategies inside a C++ process using pybind11 embedded Python. Instead of running strategies in a separate Python interpreter with data serialization overhead, the Executor loads strategy files and Parquet market data directly, providing zero-copy NumPy array access for 500-1000x performance improvement over pure Python execution.

This is the engine that powers every backtest in StratCraft -- regardless of which builder mode generated the strategy. The Executor is included in the free tier and handles the complete lifecycle: load strategy, load data, execute backtest, write results.

## Key Highlights

- **500-1000x Performance** -- C++ process with embedded Python eliminates inter-process communication overhead and data serialization.
- **Zero-Copy Data Access** -- Market data loaded from Parquet files via Apache Arrow is available as NumPy arrays without copying, using pybind11 bindings.
- **Standard Python Strategies** -- Executes standard `.py` files. Strategies are portable and can run outside StratCraft.
- **File-Based Architecture** -- Input: config.json + strategy.py + data.parquet. Output: result.json. No complex protocols.
- **Free Tier** -- The C++ Executor is available to all users, including free tier.

## How It Works

1. **Strategy Generation** -- Any builder mode generates a standard Python `.py` strategy file.
2. **Data Preparation** -- Market data is cached locally as Parquet files (Apache Arrow format).
3. **Executor Spawn** -- The Electron main process spawns the C++ Executor binary with a config file path.
4. **Execution** -- The Executor reads config.json, loads the Python strategy via pybind11, loads Parquet data as zero-copy NumPy arrays, and runs the backtest.
5. **Results** -- The Executor writes result.json containing trades, equity curve, and performance metrics. The UI displays results in real-time.

### Architecture

```
Electron Main Process
    |
    | spawn with config path
    v
C++ Executor Binary
    |
    |-- reads config.json (strategy path, data path, parameters)
    |-- loads strategy.py via pybind11 (embedded Python)
    |-- loads data.parquet via Apache Arrow (zero-copy to NumPy)
    |-- executes backtest
    |-- writes result.json
    |
    v
Electron Main Process (reads result, sends to renderer via IPC)
```

### Why C++ with Embedded Python?

The previous architecture (V1) used 7+ layers, 5+ processes, and 4 protocols including gRPC, SharedMemory, and an Extension Host. The V3 architecture reduced this to 4 layers, 2 processes, and 1 protocol (IPC).

The key insight: strategies are written in Python (for user accessibility), but execution does not require a standalone Python process. By embedding Python inside C++ via pybind11, the Executor eliminates all inter-process communication, data serialization, and protocol overhead. Market data goes directly from Parquet to NumPy arrays in the same memory space as the strategy execution.

## Screenshots

<!-- SCREENSHOT: Backtest execution in progress showing real-time progress bar and executor status -->
<!-- FILE: images/blog/cpp-backtest-executor-engine/01.png -->

## Why This Matters

Backtest speed directly affects research velocity. A strategy researcher who can run 100 backtests per hour will discover better strategies than one who can run 10. The C++ Executor makes the difference between waiting minutes for a single backtest and running rapid iterations.

The file-based architecture also provides transparency and portability. Every backtest input and output is a readable file -- there is no opaque state trapped inside a running process. You can inspect the generated strategy code, verify the data, and reproduce results independently of StratCraft.

For C++ developers and performance-oriented quants, the Executor source code in `packages/executor/` follows modern C++23 standards with zero-copy data flows, PMR memory pools, and compile-time optimization -- providing a reference implementation for high-performance trading system architecture.

## Getting Started

- **Included in Free Tier** -- The C++ Executor runs for all users
- **Automatic** -- No manual configuration needed. Generate a strategy, click Backtest, and the Executor handles execution
- **Source Code**: `packages/executor/` in the [GitHub repository](https://github.com/StratCraftsAI/StratCraft)
- **Build**: Executor builds automatically via `start.sh` with vcpkg auto-detection

## Technical Details

The Executor binary is built with CMake and vcpkg for dependency management (vcpkg path auto-detected per ). Key dependencies: pybind11 for Python embedding, Apache Arrow for Parquet I/O, and nlohmann/json for config parsing. The build targets C++23 standard with mandatory patterns including `std::expected`, concepts, `constexpr`, and PMR allocators. The Executor queue service (`executor-queue-service.ts`) manages task scheduling with FIFO ordering and serial execution (Phase 1, `MAX_CONCURRENT=1`). Each backtest task has a 60-second retention window after completion for result retrieval.
