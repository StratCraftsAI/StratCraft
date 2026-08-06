---
title: "Quant Lab Alpha Factory: Simons-Style Signal Fusion for Quantitative Trading"
slug: "quant-lab-alpha-factory-signal-fusion"
category: "Feature"
tags: ["alpha factory signal fusion", "quant lab simons style", "signal combinator", "quantitative research"]
excerpt: "Quant Lab's Alpha Factory combines multiple trading signals into composite strategies using Simons-style signal fusion and five combination methods."
estimated_reading_time: "6 min"
---

## Introduction

Quant Lab is a bundled plugin for StratCraft that provides an Alpha Factory -- a Simons-style signal fusion system for combining multiple independent trading signals into composite strategies. Inspired by Renaissance Technologies' approach of aggregating many weak signals into a strong ensemble, Alpha Factory lets you register signal sources, configure combination methods, and generate strategies that fuse multiple alpha signals.

This is the most advanced strategy development tool in StratCraft, designed for quantitative researchers who want to move beyond single-signal strategies to multi-signal ensemble approaches.

## Key Highlights

- **Signal Factory + Combinator** -- Two-layer architecture: Signal Factory generates individual alpha signals, Combinator fuses them into trading decisions.
- **Five Combination Methods** -- Equal Weight, Confidence Weighted, Voting, Max Confidence, and Min Confidence -- each implementing a different signal aggregation strategy.
- **Custom Signal Sources** -- Register your own signal source modules. Each signal source produces directional signals with confidence scores.
- **Python Backtest + C++23 Live Execution** -- Backtests run in Python for rapid iteration; production execution targets C++23 for performance.
- **Marketplace Plugin** -- Quant Lab is a separate paid plugin, not included in the base application.

## How It Works

1. **Register Signal Sources** -- Define independent signal generators. Each source analyzes market data and outputs a directional signal (LONG/SHORT/NEUTRAL) with a confidence score (0-1).
2. **Select Signals** -- Choose which registered signals to include in your composite strategy.
3. **Choose Combination Method**:
   - **Equal Weight** -- All signals contribute equally to the final decision
   - **Confidence Weighted** -- Signals with higher confidence scores have more influence
   - **Voting** -- Majority vote determines direction; trade only when majority agrees
   - **Max Confidence** -- Follow the signal with the highest confidence score
   - **Min Confidence** -- Conservative approach: only trade when even the least confident signal agrees
4. **Execute** -- Alpha Factory generates a composite strategy, runs a backtest, and displays the fused signal performance.
5. **Analyze** -- Compare the composite strategy against individual signal performance to verify that fusion improves results.

### Signal Fusion Example

```
Signal Sources:
  1. Momentum Signal (RSI + MACD) -> LONG, confidence: 0.7
  2. Mean Reversion Signal (Bollinger) -> SHORT, confidence: 0.4
  3. Trend Signal (SMA crossover) -> LONG, confidence: 0.8

Combination: Confidence Weighted
  Weighted LONG:  0.7 + 0.8 = 1.5
  Weighted SHORT: 0.4 = 0.4
  Result: LONG (weighted score 1.5 vs 0.4)

Combination: Voting
  LONG votes: 2, SHORT votes: 1
  Result: LONG (majority)

Combination: Min Confidence
  LONG confidence minimum: 0.7
  SHORT confidence minimum: 0.4
  Agreement check: Not unanimous
  Result: NEUTRAL (not all signals agree)
```

## Screenshots

<!-- SCREENSHOT: Alpha Factory main page showing registered signal sources and combination method selector -->
<!-- FILE: images/blog/quant-lab-alpha-factory-signal-fusion/01.png -->

<!-- SCREENSHOT: Signal source configuration with confidence scores and directional outputs -->
<!-- FILE: images/blog/quant-lab-alpha-factory-signal-fusion/02.png -->

<!-- SCREENSHOT: Composite strategy backtest results comparing fused signal vs individual signals -->
<!-- FILE: images/blog/quant-lab-alpha-factory-signal-fusion/03.png -->

## Why This Matters

The most successful quantitative trading firms do not rely on single strategies. They aggregate many independent, modestly profitable signals into portfolios where the ensemble outperforms any individual component. This is the core insight behind Renaissance Technologies' Medallion Fund and similar systematic trading operations.

Alpha Factory brings this institutional approach to individual quants. Instead of searching for one perfect strategy, you build many imperfect signals and let the combinator find the optimal aggregation. The five combination methods let you experiment with different fusion approaches -- from simple equal weighting to confidence-based allocation.

The Signal Factory + Combinator architecture also promotes research modularity. You can develop and test signal sources independently, then combine them without rewriting code. This makes it practical to maintain a growing library of signal generators and systematically test which combinations produce the best risk-adjusted returns.

## Getting Started

- **Marketplace Plugin** -- Quant Lab is a paid plugin, available in the StratCraft Plugin Marketplace
- **Requires Pro Plan** -- Plugin activation requires a Pro subscription
- **Navigate**: Nexus Hub > Quant Lab (after plugin installation)
- **GitHub**: [github.com/StratCraftsAI/StratCraft](https://github.com/StratCraftsAI/StratCraft)

## Technical Details

Quant Lab is a Tier 1 business plugin (`com.StratCraft.quant-lab-nexus`) with `authRequired: true`. IPC channels include `alpha-factory:execute`, `alpha-factory:cancel`, `alpha-factory:get-result`, and `alpha-factory:list-signals`, with event channels for progress, completion, error, and cancellation. The Alpha Factory configuration is stored in the local SQLite database via dedicated migration tables. Signal sources are registered through a module system that supports custom signal implementations. The 2-layer architecture (Signal Factory + Combinator) follows the design in , with Python execution for backtests and a C++23 execution target for live trading performance.
