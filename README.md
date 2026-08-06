# StratCraft

[![Build](https://github.com/StratCraftsAI/StratCraft/actions/workflows/build.yml/badge.svg)](https://github.com/StratCraftsAI/StratCraft/actions/workflows/build.yml)
[![C++ Build](https://github.com/StratCraftsAI/StratCraft/actions/workflows/cpp-build.yml/badge.svg)](https://github.com/StratCraftsAI/StratCraft/actions/workflows/cpp-build.yml)


**The AI-native Quant Trading Platform.** Build, backtest, and analyze trading strategies with a high-performance C++ executor and modern desktop UI.

## Features

- **Strategy Builder** - AI-assisted strategy generation with multiple modes (Regime Detector, Indicator Entry, and more)
- **C++ Backtest Executor** - High-performance native backtesting engine with zero-copy Apache Arrow Parquet data
- **Plugin Architecture** - Extensible system with official and community plugins via Marketplace
- **Free Data Providers** - YFinance and Dukascopy integration for market data download
- **Result Visualization** - Interactive charts, equity curves, trade tables, and performance metrics
- **Cross-Platform** - Windows, macOS, and Linux

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- CMake 3.20+ (for C++ executor)
- C++23 compiler (GCC 13+, Clang 16+, or MSVC 2022+)

**Optional:**
- ClickHouse (for advanced data providers; free users use YFinance/Dukascopy)
- vcpkg (auto-detected; downloaded automatically if not present)

### Installation

```bash
git clone https://github.com/StratCraftsAI/StratCraft.git
cd StratCraft

# Install dependencies
pnpm install

# Run development mode
pnpm dev:desktop
```

### Package for Distribution

```bash
cd apps/desktop
pnpm package:win    # Windows
pnpm package:mac    # macOS
pnpm package:linux  # Linux
```

## Architecture (V3)

```
Renderer (React UI)
    | IPC
Main Process (Electron)
    | spawn + file I/O
stratforge-runner (pure C++23)
```

**Key design**: Strategies are compiled C++ `.so` libraries (ABI v2 factory pattern). The executor (stratforge-runner) compiles strategy code, loads the shared library, reads Parquet data via Apache Arrow, runs the backtest, and writes `result.json`. No gRPC, no Extension Host, no shared memory.

## Project Structure

```
StratCraft/
  apps/desktop/            # Electron desktop application
    src/
      main/                # Electron main process
      renderer/            # React UI (StratCraftsAI design)
      preload/             # IPC bridge
      shared/              # Types, constants, utils
  packages/
    executor/              # C++23 backtest executor (stratforge-runner)
    builder-templates/     # Strategy code generation and validation tools
    bridge/                # IPC bridge package
    types/                 # Shared TypeScript types
    plugin-verifier/       # Plugin signature verification
    sdk/                   # Plugin SDK
  plugins/
    data-plugin/           # Tier 0: shared data components
    strategy-builder-nexus/  # Tier 1: Strategy Builder
    back-test-nexus/       # Tier 1: Backtest execution
```

## How Strategy Generation Works

StratCraft uses a server-assisted strategy generation model:

1. You configure your strategy parameters in the desktop app (open-source)
2. Parameters are sent to our generation server
3. The server applies advanced prompt engineering and code templates
4. If using BYOK (Bring Your Own Key), your API key is used only for the LLM call and is never stored on our servers
5. Generated C++ strategy code is returned to your desktop app
6. The strategy is compiled to a shared library (.so/.dll) and backtested locally by the C++ executor

**Why not call the LLM directly?**
The generation quality comes from our curated prompt templates and multi-step pipelines, not from a simple LLM call. The server adds significant value beyond proxying API requests.

**Your API Key is safe:**
- Transmitted over HTTPS only
- Used per-request, never persisted
- Not included in server logs

## Plugins

Extend StratCraft with plugins from the built-in Marketplace:

| Plugin | Type | Description |
|--------|------|-------------|
| Strategy Builder | Bundled | AI-assisted strategy code generation |
| Backtest | Bundled | Strategy backtesting and result visualization |
| Data | Bundled | Multi-source data provider |
| Quant Lab | Marketplace | Alpha Factory, Signal Factory, Factor Library |

See [Plugin Development Guide](docs/plugin/) for creating your own plugins.
Use the [Plugin Template](https://github.com/StratCraftsAI/StratCraft-plugin-template) to scaffold a new plugin project.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop | Electron 28, TypeScript, React |
| Executor | C++23, Apache Arrow, nonabackTrader |
| Strategies | C++23 (compiled .so via ABI v2 factory) |
| Build | pnpm, Turborepo, CMake, vcpkg |
| UI | Tailwind CSS, StratCraftsAI Design |

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## Security

See [Security Policy](SECURITY.md) for vulnerability reporting and API key handling details.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

## Links

- [Plugin Registry](https://github.com/StratCraftsAI/StratCraft-plugin-registry) - Marketplace plugin index
- [Plugin Template](https://github.com/StratCraftsAI/StratCraft-plugin-template) - Starter template for building plugins
