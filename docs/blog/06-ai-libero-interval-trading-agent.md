---
title: "AI Libero: Interval-Based LLM Trading Agent for Efficient AI Strategy Execution"
slug: "ai-libero-interval-trading-agent"
category: "Feature"
tags: ["ai libero trading agent", "interval ai trading", "batch prediction", "llm strategy"]
excerpt: "AI Libero calls the LLM at configurable intervals instead of every bar, balancing AI reasoning with execution efficiency."
estimated_reading_time: "6 min"
---

## Introduction

AI Libero is an interval-based AI trading agent in StratCraft that calls a Large Language Model at configurable intervals rather than on every price bar. Where Trader AI Entry invokes the LLM per-bar for maximum granularity, AI Libero optimizes for efficiency by batching decisions -- making it practical for longer backtests and strategies where per-bar reasoning is unnecessary.

The name "Libero" comes from football -- like a sweeper who reads the entire field before making a decisive play. AI Libero surveys the market periodically, makes informed batch decisions, and executes them until the next analysis interval. Available to Pro plan users with BYOK support.

## Key Highlights

- **Configurable Analysis Interval** -- Set how often the LLM is called (e.g., every 5 bars, every 20 bars). Fewer calls mean faster backtests and lower API costs.
- **Batch Prediction** -- The LLM can output decisions for multiple upcoming bars in a single call, providing a lookahead trading plan.
- **Warmup Period** -- Define a warmup period where the strategy collects data before the first LLM call, ensuring the AI has sufficient context.
- **Same Preset System** -- Uses Monk/Warrior/Baseline/Bespoke presets like Trader AI Entry for consistent trading personality configuration.
- **Pro Feature with BYOK** -- Requires Pro plan and your own LLM API key.

## How It Works

1. **Select a Preset Mode** -- Choose Monk, Warrior, Baseline, or Bespoke to define trading aggressiveness.
2. **Add Indicator Context** (optional) -- Provide technical indicators as decision context for the LLM.
3. **Write Your Trading Prompt** -- Describe your trading strategy in natural language, same as Trader AI Entry.
4. **Configure Prediction Settings**:
   - **Analysis Interval** -- How many bars between LLM calls (e.g., every 10 bars)
   - **Batch Size** -- How many forward decisions the LLM generates per call
   - **Warmup Period** -- How many bars of data to collect before the first LLM call
5. **Generate** -- Produces a Python strategy inheriting from `AILiberoStrategyBase` with interval-based LLM decision making.

### Trader AI Entry vs AI Libero

| Aspect | Trader AI Entry | AI Libero |
|--------|----------------|-----------|
| LLM Call Frequency | Every bar | Every N bars |
| Decision Style | Reactive, per-bar | Strategic, batch |
| Backtest Speed | Slow (many LLM calls) | Fast (fewer LLM calls) |
| API Cost | Higher | Lower |
| Best For | Short-term, high-frequency logic | Swing trading, position management |

### Example Configuration

```
Analysis Interval: 10 bars
Batch Size: 5 predictions
Warmup Period: 50 bars

Prompt: "Analyze the market trend over the past 50 bars. If a clear
uptrend is forming with higher highs and higher lows, go long. If the
trend is breaking down, go short. Hold through minor pullbacks unless
the trend structure is violated."
```

## Screenshots

<!-- SCREENSHOT: AI Libero page with preset selector and prediction config (interval, batch size, warmup) -->
<!-- FILE: images/blog/ai-libero-interval-trading-agent/01.png -->

<!-- SCREENSHOT: Prediction configuration panel showing analysis interval and batch size settings -->
<!-- FILE: images/blog/ai-libero-interval-trading-agent/02.png -->

## Why This Matters

The practical challenge with per-bar LLM trading (as in Trader AI Entry) is cost and speed. A backtest over 1,000 bars requires 1,000 LLM API calls, which can be slow and expensive. For many trading strategies -- particularly swing trading or position management approaches -- per-bar decisions are unnecessary. A trader does not re-evaluate their thesis on every 5-minute candle.

AI Libero solves this by matching the LLM's decision frequency to the strategy's natural time horizon. A swing trader might only need the AI to analyze the market every 20 bars. A position trader might only need daily analysis even on hourly data. This reduces API calls by 10-20x while preserving the AI's ability to make nuanced, context-aware decisions.

The batch prediction feature adds another layer of efficiency: instead of one decision per call, the LLM generates a plan for multiple upcoming bars, creating a forward-looking trading schedule that executes until the next analysis point.

## Getting Started

- **Requires Pro Plan** -- AI Libero is a Pro feature
- **BYOK Required** -- Bring your own API key for any supported LLM provider
- **Navigate**: Strategy Builder > AI Libero
- **GitHub**: [github.com/StratCraftsAI/StratCraft](https://github.com/StratCraftsAI/StratCraft)

## Technical Details

AI Libero generates `strategy_type: 1` (Execution) with `signal_source: aiLibero`. The API endpoint is `/api/agent_llm`. Generated strategies inherit from `AILiberoStrategyBase`. The strategy maintains an internal bar counter and only triggers LLM inference when `bar_count % analysis_interval == 0`. Between intervals, the strategy follows the most recent batch prediction plan. The warmup period ensures sufficient price history is available for meaningful AI analysis on the first call.
