<p align="center">
  <img src="images/logo.png" alt="StratCraft" width="120" />
</p>

<h1 align="center">StratCraft</h1>

<p align="center">
  <strong>Open-source quant backtesting platform. Build strategies in Python, backtest locally with a C++23 engine. No signup, no cloud dependency for core workflows, runs on your machine.</strong>
</p>

<p align="center">
  <a href="https://github.com/StratCraftsAI/StratCraft/actions/workflows/build.yml"><img src="https://github.com/StratCraftsAI/StratCraft/actions/workflows/build.yml/badge.svg" alt="Build" /></a>
  <a href="https://github.com/StratCraftsAI/StratCraft/actions/workflows/cpp-build.yml"><img src="https://github.com/StratCraftsAI/StratCraft/actions/workflows/cpp-build.yml/badge.svg" alt="C++ Build" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
</p>

---

## What is StratCraft?

StratCraft is a desktop application for building and backtesting trading strategies. You write strategies as standard Python files, and a high-performance C++23 executor runs them against historical market data locally on your machine.

**No account required for local backtesting. Your data stays on your machine.**

## Features

- **Strategy Builder** - Configure regime detection and entry signals, then generate a Python strategy file
- **C++23 Backtest Executor** - High-performance backtesting with embedded Python (pybind11) and zero-copy NumPy via Apache Arrow
- **Free Data Providers** - YFinance and Dukascopy integration for downloading historical market data
- **BYOK (Bring Your Own Key)** - Use your own LLM API key (OpenAI, Anthropic, and others) for AI-assisted strategy generation
- **Result Visualization** - Equity curves, trade tables, and performance metrics
- **Cross-Platform** - Windows, macOS, and Linux
- **Plugin Architecture** - Extend functionality with community plugins

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- CMake 3.20+ (for the C++ executor)
- Python 3.10+ (for the strategy framework)

### Install and Run

```bash
git clone https://github.com/StratCraftsAI/StratCraft.git
cd StratCraft

pnpm install
pnpm dev:desktop
```

### Package for Distribution

```bash
cd apps/desktop
pnpm package:win
pnpm package:mac
pnpm package:linux
```

## How It Works

```text
You configure a strategy
        |
        v
Strategy Builder generates a .py file
        |
        v
C++23 Executor loads the .py + Parquet data
        |
        v
Backtest runs locally
        |
        v
Results written to result.json and displayed in the UI
```

**Strategies are standard Python files.** You can edit them by hand, version-control them, and share them. The executor is a separate C++23 process that reads config, strategy, and data and produces results.

### AI-Assisted Generation (BYOK)

When you use the Strategy Builder, parameters are sent to the StratCraft generation server. If you configure a BYOK key, your key is used for the LLM call and is **never stored** on our servers.

You can also skip AI generation entirely and write strategies by hand.

## Architecture

```text
Renderer (React UI)
    | IPC
Main Process (Electron)
    | spawn + file I/O
Executor (C++23 with embedded Python)
```

| Component | Technology |
|-----------|------------|
| Desktop | Electron 28, TypeScript, React |
| Executor | C++23, pybind11, Apache Arrow |
| Strategies | Python, pandas, NumPy |
| Build | pnpm, Turborepo, CMake, vcpkg |

## Project Structure

```text
StratCraft/
  apps/desktop/              # Electron desktop application
    src/
      main/                  # Electron main process
      renderer/              # React UI
      preload/               # IPC bridge
      shared/                # Types, constants, utils
  packages/
    executor/                # C++23 backtest executor
    builder-templates/       # Python strategy framework
    bridge/                  # IPC bridge package
    types/                   # Shared TypeScript types
    sdk/                     # Plugin SDK
  plugins/
    data-plugin/             # Tier 0: shared data components
    strategy-builder-nexus/  # Tier 1: Strategy Builder
    back-test-nexus/         # Tier 1: Backtest execution
```

## Open-Source Release and Paid Features

This repository is the canonical open-source StratCraft desktop release.

Some advanced workflows, advanced data paths, and hosted services are not shipped in this repository. The public app still supports local strategy authoring, data download, and backtesting without requiring an account.

Learn more about paid offerings at [stratcraft.ai](https://stratcraft.ai).

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution scope and review flow.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting guidelines.

## License

[AGPL-3.0](LICENSE)

Copyright (c) 2026 StratCraftsAI
