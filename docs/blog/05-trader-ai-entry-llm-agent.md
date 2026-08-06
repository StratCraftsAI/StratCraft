---
title: "Trader AI Entry: Per-Bar LLM Trading Agent for Autonomous Decision Making"
slug: "trader-ai-entry-llm-agent"
category: "Feature"
tags: ["ai trading agent", "llm trading bot", "autonomous trading", "per-bar ai decision"]
excerpt: "Trader AI Entry uses LLM reasoning on every bar to make autonomous buy/sell decisions based on your trading prompt and market context."
estimated_reading_time: "6 min"
---

## Introduction

Trader AI Entry is an AI trading agent in StratCraft that invokes a Large Language Model on every price bar to make autonomous buy, sell, or hold decisions. Unlike indicator-based strategies that follow fixed rules, Trader AI Entry gives the LLM full context -- your trading philosophy, technical indicators, and current market state -- and lets it reason about each trading decision independently.

This is the most granular AI trading mode in StratCraft: the LLM evaluates every single bar, making it suitable for strategies that require nuanced, context-aware decision making. Available to Pro plan users with BYOK (Bring Your Own Key) support for OpenAI, Claude, Gemini, DeepSeek, Grok, or Qwen.

## Key Highlights

- **Per-Bar LLM Decision** -- The AI evaluates every price bar individually, making fully reasoned buy/sell/hold decisions based on current market context.
- **Preset Trading Styles** -- Choose Monk (conservative, fewer trades), Warrior (aggressive, more trades), Baseline (balanced), or Bespoke (fully custom parameters).
- **Natural Language Prompts** -- Describe your trading logic in plain English. The LLM interprets your instructions and applies them to each market situation.
- **Indicator Context** -- Provide technical indicators as additional context for the LLM's decision making, combining quantitative data with AI reasoning.
- **BYOK Support** -- Use your own API keys for any supported LLM provider.

## How It Works

1. **Select a Preset Mode** -- Choose your trading personality:
   - **Monk**: Conservative approach with strict entry criteria and fewer trades
   - **Warrior**: Aggressive approach that seeks more trading opportunities
   - **Baseline**: Balanced approach between Monk and Warrior
   - **Bespoke**: Define custom parameters for full control
2. **Add Indicator Context** (optional) -- Select technical indicators like RSI, MACD, or Bollinger Bands. These values are passed to the LLM as structured context alongside price data.
3. **Write Your Trading Prompt** -- Describe your trading logic in natural language. For example: "Buy when the market shows signs of a trend reversal with increasing volume. Sell when momentum fades or when RSI enters overbought territory."
4. **Generate** -- The AI produces a Python strategy inheriting from `TraderAIEntryBase` that calls the LLM on every bar with your prompt and market context.
5. **Backtest** -- Run the strategy. Each bar triggers an LLM inference call, and the model's decision (BUY/SELL/HOLD) is executed as a trade.

### Example Prompt

```
You are a momentum trader. Look for strong directional moves confirmed
by volume expansion. Enter long when price breaks above the 20-period
high with RSI between 50-70 (not yet overbought). Exit when RSI exceeds
80 or when price closes below the 10-period moving average. Avoid
trading in low-volume periods.
```

## Screenshots

<!-- SCREENSHOT: Trader AI Entry page with preset mode selector (Monk/Warrior/Baseline/Bespoke) -->
<!-- FILE: images/blog/trader-ai-entry-llm-agent/01.png -->

<!-- SCREENSHOT: Prompt input area with indicator context blocks configured -->
<!-- FILE: images/blog/trader-ai-entry-llm-agent/02.png -->

<!-- SCREENSHOT: Backtest results from a Trader AI Entry strategy showing trade decisions -->
<!-- FILE: images/blog/trader-ai-entry-llm-agent/03.png -->

## Why This Matters

Traditional algorithmic strategies encode trading logic as fixed rules: "if RSI < 30, buy." These rules cannot adapt to context -- they fire the same way regardless of broader market dynamics, news events, or pattern nuances that an experienced trader would naturally consider.

Trader AI Entry represents a fundamentally different approach: instead of encoding rules, you encode trading philosophy. The LLM reads your instructions and the current market state, then reasons about what a trader following your philosophy would do in that specific situation. This produces more nuanced decisions that can adapt to market context in ways that fixed rules cannot.

The tradeoff is performance -- calling an LLM on every bar is computationally expensive and introduces latency. For strategies where this granularity is not needed, consider [AI Libero](/blog/ai-libero-interval-trading-agent) which calls the LLM at configurable intervals instead of every bar.

## Getting Started

- **Requires Pro Plan** -- Trader AI Entry is a Pro feature
- **BYOK Required** -- Bring your own API key for OpenAI, Claude, Gemini, DeepSeek, Grok, or Qwen
- **Optional**: Pair with [Market Observer](/blog/market-observer-precondition-filter) for precondition filtering
- **GitHub**: [github.com/StratCraftsAI/StratCraft](https://github.com/StratCraftsAI/StratCraft)

## Technical Details

Trader AI Entry generates `strategy_type: 1` (Execution) with `signal_source: llmtrader`. The API endpoint is `/api/llm_trader`. Generated strategies inherit from `TraderAIEntryBase`. Each bar triggers an LLM API call with the current market state (OHLCV data, configured indicator values) and the user's prompt. The LLM returns a structured decision (BUY/SELL/HOLD with optional position sizing), which the strategy framework executes. Preset modes (Monk/Warrior/Baseline) modify the system prompt to adjust trading aggressiveness and risk tolerance.
