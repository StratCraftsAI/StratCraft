---
title: "Kronos AI Predictor: Time-Series Forecasting for Trading Strategy Entry"
slug: "kronos-ai-predictor-entry-system"
category: "Feature"
tags: ["ai time series prediction", "kronos predictor", "trading forecast", "ai entry signal"]
excerpt: "Kronos AI Predictor uses time-series forecasting to predict market direction, then generates entry strategies from those predictions."
estimated_reading_time: "7 min"
---

## Introduction

The Kronos AI Predictor is a time-series prediction system in StratCraft that forecasts future market direction, then generates entry strategies based on those predictions. Unlike indicator-based approaches that react to past data, Kronos attempts to anticipate future price movement using dedicated forecasting models.

This is a three-component workflow: the Kronos Predictor generates directional forecasts (UP/DOWN/NEUTRAL), then either Kronos Indicator Entry or Kronos AI Entry translates those forecasts into executable trading signals. This Prediction-to-Entry pipeline is available to Pro plan users.

## Key Highlights

- **Three Kronos Model Sizes** -- Choose from kronos-mini, kronos-small, or kronos-base depending on your accuracy and performance requirements.
- **Multi-Dimensional Signal Filtering** -- Filter predictions by confidence threshold, expected return, direction, magnitude, and consistency before generating trades.
- **Two Entry Modes** -- Kronos Indicator Entry uses fixed indicator conditions with prediction direction; Kronos AI Entry uses LLM runtime decisions for more adaptive entries.
- **Configurable Prediction Parameters** -- Control lookback window, prediction length, temperature, top-P, and top-K sampling parameters for fine-grained forecast tuning.
- **Pro Feature** -- Kronos requires a Pro plan subscription.

## How It Works

### Stage 1: Kronos Predictor

1. **Select Model** -- Choose kronos-mini (fast), kronos-small (balanced), or kronos-base (highest accuracy).
2. **Configure Prediction Parameters** -- Set the lookback window (how much history to analyze), prediction length (how far ahead to forecast), and sampling parameters (temperature, top-P, top-K).
3. **Set Signal Filters** -- Define thresholds for confidence, expected return, direction filter, magnitude, and consistency. Only predictions that pass all filters generate signals.
4. **Select Time Range** -- Choose latest data or a custom date range.
5. **Generate** -- The system produces a Python strategy inheriting from `KronosStateBase` that outputs directional predictions per bar.

### Stage 2a: Kronos Indicator Entry

1. **Add Technical Indicators** -- Select indicators that confirm the Kronos prediction direction (e.g., RSI > 50 for UP predictions).
2. **Write Custom Expressions** (optional) -- Add conditions that must be met alongside the prediction.
3. **Generate** -- Produces a strategy inheriting from `KronosEntryBase` that combines prediction direction with indicator conditions.

### Stage 2b: Kronos AI Entry (Alternative)

1. **Select Preset Mode** -- Choose Monk (conservative), Warrior (aggressive), Baseline, or Bespoke (custom).
2. **Add Indicator Context** (optional) -- Provide indicators as context for the LLM decision.
3. **Write Entry Prompt** -- Describe your entry logic in natural language. The LLM uses prediction direction plus your prompt to make runtime trading decisions.
4. **Generate** -- Produces a strategy inheriting from `KronosAIEntryBase` with LLM-powered entry decisions.

### Indicator Entry vs AI Entry

| Aspect | Kronos Indicator Entry | Kronos AI Entry |
|--------|----------------------|----------------|
| Decision Method | Fixed indicator conditions | LLM runtime decisions |
| Configuration | Indicators + thresholds | Prompt + optional indicators |
| Adaptability | Static rules | Adaptive per-bar reasoning |
| Latency | Fast (no LLM call) | Slower (LLM call per decision) |
| Use Case | Clear, rule-based confirmation | Nuanced, context-aware entries |

## Screenshots

<!-- SCREENSHOT: Kronos Predictor page with model selector, prediction parameters, and signal filters -->
<!-- FILE: images/blog/kronos-ai-predictor-entry-system/01.png -->

<!-- SCREENSHOT: Kronos Indicator Entry page with indicator blocks for prediction confirmation -->
<!-- FILE: images/blog/kronos-ai-predictor-entry-system/02.png -->

<!-- SCREENSHOT: Kronos AI Entry page with preset selector and prompt input -->
<!-- FILE: images/blog/kronos-ai-predictor-entry-system/03.png -->

## Why This Matters

Traditional technical analysis is inherently backward-looking -- indicators summarize past price action and traders extrapolate future behavior from those summaries. Kronos takes a fundamentally different approach by using dedicated time-series forecasting models to predict future direction directly.

The two-entry-mode design gives traders flexibility: use Kronos Indicator Entry when you have clear confirmation rules you trust, or use Kronos AI Entry when you want the LLM to make nuanced decisions based on the prediction context. The signal filtering system ensures that only high-confidence predictions reach the entry stage, reducing noise and false signals.

For quantitative researchers, the configurable model parameters and multi-dimensional filtering provide a rich parameter space for optimization and research.

## Getting Started

- **Requires Pro Plan** -- Kronos features are available to Pro subscribers
- **Workflow**: Navigate to Strategy Builder > Kronos Predictor > Generate prediction > Then open Kronos Indicator Entry or Kronos AI Entry
- **GitHub**: [github.com/StratCraftsAI/StratCraft](https://github.com/StratCraftsAI/StratCraft)

## Technical Details

Kronos Predictor uses `strategy_type: 9` (Analysis) with `signal_source: kronos_prediction`. Kronos Indicator Entry produces `strategy_type: 1` (Execution) with `signal_source: kronosIndicatorEntry`. Kronos AI Entry produces `strategy_type: 1` with `signal_source: kronos_llm_entry`. The API endpoints are `/api/start_kronos_prediction`, `/api/start_kronos_indicator_entry`, and `/api/kronos_llm_entry` respectively. Prediction strategies inherit from `KronosStateBase`, while entry strategies inherit from `KronosEntryBase` or `KronosAIEntryBase`.
