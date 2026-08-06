---
title: "StratCraft: The Open Source Quant Trading Platform with AI Strategy Generation"
slug: "StratCraft-open-source-quant-trading-platform"
category: "Product"
tags: ["open source", "quant trading platform", "algorithmic trading", "desktop app"]
excerpt: "StratCraft is a free, open-source desktop platform for AI-powered algorithmic trading strategy generation, backtesting, and analysis."
estimated_reading_time: "5 min"
---

## Introduction

StratCraft is an open source quant trading platform that brings institutional-grade algorithmic trading tools to every trader's desktop. Built as a native Electron application, it combines AI-powered strategy generation with a high-performance C++ backtest engine -- all running locally on your machine with full data sovereignty.

Whether you are a retail trader exploring systematic strategies or a quantitative researcher building signal pipelines, StratCraft provides the complete workflow: generate strategies with AI, backtest them against historical data, and analyze results -- without sending your trading logic to the cloud.

## Key Highlights

- **Fully Open Source (Apache-2.0 License)** -- Clone, build, and run the complete application from source. No hidden server dependencies for core functionality.
- **AI Strategy Generation with BYOK** -- Bring Your Own Key for OpenAI, Claude, Gemini, DeepSeek, Grok, or Qwen. Generate Python trading strategies through multiple AI-powered builder modes.
- **High-Performance C++ Executor** -- Backtest engine built in C++ with pybind11 embedded Python delivers 500-1000x performance improvement over pure Python execution.
- **Multi-Source Market Data** -- Access free data from YFinance and Dukascopy out of the box, with optional ClickHouse cloud data for Pro users.
- **Plugin Architecture** -- Extensible plugin system with a marketplace for community and advanced plugins like Quant Lab's Alpha Factory.

## How It Works

1. **Install and Launch** -- Clone the repository, run `npm run dev`, and the desktop application starts with a fully functional environment. No account required for free features.
2. **Choose a Builder Mode** -- Select from 10 strategy builder modes ranging from indicator-based entry signals (free) to AI-powered autonomous trading agents (Pro). Each mode generates standard Python `.py` strategy files.
3. **Configure and Generate** -- Set your technical indicators, market regime, risk parameters, or simply describe your strategy in natural language. The AI generates a complete, portable Python strategy.
4. **Backtest** -- Run your strategy against historical market data using the C++ Executor. Results appear in real-time with equity curves, trade logs, and performance metrics.
5. **Analyze and Iterate** -- Review Sharpe ratio, maximum drawdown, win rate, and trade-by-trade analysis. Refine your strategy and backtest again.

## Screenshots

<!-- SCREENSHOT: StratCraft Nexus Hub landing page showing all available plugins -->
<!-- FILE: images/blog/StratCraft-open-source-quant-trading-platform/01.png -->

<!-- SCREENSHOT: Strategy Builder page with indicator selection and regime configuration -->
<!-- FILE: images/blog/StratCraft-open-source-quant-trading-platform/02.png -->

<!-- SCREENSHOT: Backtest results page with equity curve and performance metrics -->
<!-- FILE: images/blog/StratCraft-open-source-quant-trading-platform/03.png -->

## Free vs Pro

StratCraft follows an Open Core model. The free tier provides a complete, functional trading platform:

**Free (Apache-2.0 License)**:
- Regime Detector and Indicator Entry Signal builder modes
- C++ Backtest Executor with full performance
- YFinance and Dukascopy market data providers
- Backtest results visualization and analysis
- Plugin SDK for building your own plugins
- Local SQLite storage, Parquet data caching

**Pro**:
- Kronos AI Predictor (time-series forecasting)
- Trader AI Entry, AI Libero, AI Strategy Studio
- Market Observer and Indicator Exit risk management
- ClickHouse cloud data access
- Priority support

**Marketplace Plugins** (separate purchase):
- Quant Lab -- Alpha Factory with Simons-style signal fusion

## Why This Matters

The algorithmic trading tool landscape has long been split between expensive institutional platforms and fragmented open-source libraries that require significant engineering effort to assemble. StratCraft bridges this gap by providing a cohesive desktop application that handles the entire strategy development lifecycle.

By running locally with BYOK (Bring Your Own Key) LLM integration, StratCraft ensures your trading strategies, market data, and research remain on your machine. The Open Core model means the essential tools are genuinely free -- you can clone the repository, build from source, and have a working quant trading platform without creating an account or paying anything.

## Getting Started

- **GitHub**: [github.com/StratCraftsAI/StratCraft](https://github.com/StratCraftsAI/StratCraft)
- **Quick Start**: `git clone https://github.com/StratCraftsAI/StratCraft.git && cd StratCraft && npm install && npm run dev`
- **Documentation**: See the `docs/` directory in the repository for architecture guides and design documents
- **Community**: File issues and contribute on GitHub

## Technical Details

StratCraft uses a V3 Builder-Executor architecture with 4 layers, 2 processes, and 1 protocol (IPC). The Builder component generates standard Python `.py` files using configurable templates and LLM-powered code generation. The Executor process is a C++ binary with pybind11 that loads strategy files and Parquet market data, executing backtests with zero-copy NumPy data access.

The plugin system implements a tier model: Tier 0 foundation plugins (shared data providers) and Tier 1 business plugins (Strategy Builder, Backtest, Quant Lab). Third-party plugins use an IIFE module format with a host shared module registry. The application supports 7 LLM providers (Nona, Claude, OpenAI, Gemini, DeepSeek, Grok, Qwen) through a unified API routing layer, with OAuth authentication via WordPress and API tunneling through a Python backend.
